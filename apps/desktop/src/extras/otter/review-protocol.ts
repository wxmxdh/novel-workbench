import { realpath, access } from "node:fs/promises";
import { lstat, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { protocol, type WebContents } from "electron";

export const OTTER_REVIEW_SCHEME = "otter-review";
export const OTTER_REVIEW_ORIGIN = "otter-review://app";
export const OTTER_REVIEW_URL = `${OTTER_REVIEW_ORIGIN}/`;
export const OTTER_REVIEW_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  nodeIntegration: false,
  contextIsolation: true,
  webSecurity: true,
  allowRunningInsecureContent: false
});

export interface OtterReviewProtocolRegistrar {
  registerSchemesAsPrivileged(
    schemes: Parameters<typeof protocol.registerSchemesAsPrivileged>[0]
  ): void;
}

export interface OtterReviewProtocolInstaller {
  handle(
    scheme: string,
    handler: (request: Request) => Promise<Response>
  ): void;
  unhandle(scheme: string): void;
}

export interface OtterReviewRequestHandler {
  handleRequest(
    request: Request,
    options: { transport: "protocol"; signal?: AbortSignal }
  ): Promise<Response>;
}

export interface OtterReviewWorkbenchModule {
  createWorkbench(options: {
    workspace: string;
    dataDir: string;
  }): Promise<OtterReviewRequestHandler>;
}

export function registerOtterReviewScheme(
  registrar: OtterReviewProtocolRegistrar = protocol
): void {
  registrar.registerSchemesAsPrivileged([
    {
      scheme: OTTER_REVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

export function createOtterReviewProtocolHandler(
  workbench: OtterReviewRequestHandler,
  lifecycle: {
    createSignal?: (request: Request) => {
      signal: AbortSignal;
      release(response: Response): Response;
    };
  } = {}
): (request: Request) => Promise<Response> {
  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("Invalid URL", { status: 400 });
    }
    if (
      url.protocol !== `${OTTER_REVIEW_SCHEME}:` ||
      url.hostname !== "app" ||
      url.port ||
      url.username ||
      url.password
    ) {
      return new Response("Invalid review origin", { status: 403 });
    }
    const origin = request.headers.get("origin");
    if (origin && origin !== OTTER_REVIEW_ORIGIN) {
      return new Response("Invalid request origin", { status: 403 });
    }
    const active = lifecycle.createSignal?.(request);
    try {
      const response = await workbench.handleRequest(request, {
        transport: "protocol",
        ...(active
          ? { signal: AbortSignal.any([request.signal, active.signal]) }
          : {})
      });
      return active ? active.release(response) : response;
    } catch {
      if (active) active.release(new Response(null, { status: 500 }));
      return new Response(JSON.stringify({ error: "审阅工作台请求失败" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
  };
}

export interface InstallOtterReviewProtocolOptions {
  workspaceRoot: string;
  userDataPath: string;
  reviewModulePath: string;
  protocolInstaller?: OtterReviewProtocolInstaller;
  importReviewModule?: (url: string) => Promise<OtterReviewWorkbenchModule>;
}

const NODE_BUILTINS = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`])
);

/** Verify the live Page-turn server's static module closure before importing it. */
export async function validateOtterReviewModuleClosure(
  workspaceRoot: string,
  entryModule: string
): Promise<string[]> {
  const workspace = await realpath(workspaceRoot);
  const visited = new Set<string>();
  const modules: string[] = [];
  const visit = async (candidate: string): Promise<void> => {
    const absolute = path.resolve(candidate);
    if (!pathInside(workspace, absolute)) {
      throw new Error("页间服务依赖路径不能位于小说工作区之外");
    }
    const resolved = await realpath(absolute);
    if (!pathInside(workspace, resolved)) {
      throw new Error("页间服务依赖不能解析到小说工作区之外");
    }
    const extension = path.extname(resolved).toLowerCase();
    if (extension !== ".mjs" && extension !== ".json") {
      throw new Error("页间服务只允许本地 .mjs/.json 模块和 Node 内置模块");
    }
    if (visited.has(resolved)) return;
    visited.add(resolved);
    modules.push(resolved);
    const relative = path.relative(workspace, absolute);
    let cursor = workspace;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        throw new Error("页间服务依赖路径不能经过符号链接");
      }
    }
    if (extension === ".json") {
      JSON.parse(await readFile(resolved, "utf8"));
      return;
    }
    const source = await readFile(resolved, "utf8");
    const specifiers = new Set<string>();
    const staticImport =
      /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s*)?['"]([^'"]+)['"]/g;
    const dynamicImport = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
    for (const match of source.matchAll(staticImport)) {
      if (match[1]) specifiers.add(match[1]);
    }
    for (const match of source.matchAll(dynamicImport)) {
      if (match[2]) specifiers.add(match[2]);
    }
    if (/\bimport\s*\(/.test(source.replace(dynamicImport, ""))) {
      throw new Error("页间服务不能包含无法静态验证的动态模块加载");
    }
    if (/\brequire\s*\(/.test(source)) {
      throw new Error("页间服务不能使用未经验证的 CommonJS 加载");
    }
    for (const specifier of specifiers) {
      if (NODE_BUILTINS.has(specifier)) continue;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        throw new Error("页间服务不能依赖工作区外的包");
      }
      const dependency = path.resolve(path.dirname(resolved), specifier);
      const dependencyExtension = path.extname(dependency).toLowerCase();
      if (dependencyExtension !== ".mjs" && dependencyExtension !== ".json") {
        throw new Error("页间服务本地依赖必须显式使用 .mjs 或 .json 扩展名");
      }
      await visit(dependency);
    }
  };
  await visit(entryModule);
  return modules;
}

function pathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

let activeInstallation: { close(): void } | null = null;

function retainRequestUntilBodyEnds(
  response: Response,
  controller: AbortController,
  active: Set<AbortController>
): Response {
  if (!response.body) {
    active.delete(controller);
    return response;
  }
  const reader = response.body.getReader();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    active.delete(controller);
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(target) {
      try {
        const result = await reader.read();
        if (result.done) {
          release();
          target.close();
        } else target.enqueue(result.value);
      } catch (cause) {
        release();
        target.error(cause);
      }
    },
    async cancel(reason) {
      controller.abort(reason);
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    }
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

/**
 * Installs the live review app directly into Electron's protocol handler.
 * Review JSON and Markdown remain in the live app's existing data/project paths;
 * userDataPath is reserved for desktop-owned cache/log data and is not used as
 * a replacement for the established current-context handoff location.
 */
export async function installOtterReviewProtocol({
  workspaceRoot,
  userDataPath,
  reviewModulePath,
  protocolInstaller = protocol,
  importReviewModule = (url) =>
    import(url) as Promise<OtterReviewWorkbenchModule>
}: InstallOtterReviewProtocolOptions): Promise<{ url: string; close(): void }> {
  activeInstallation?.close();
  activeInstallation = null;
  const workspace = await realpath(workspaceRoot);
  const modulePath = await realpath(reviewModulePath);
  const expectedModule = path.join(
    workspace,
    "06_脚本工具",
    "小说对照工作台",
    "server.mjs"
  );
  if (
    path.basename(modulePath).toLowerCase() !== "server.mjs" ||
    path.resolve(modulePath).toLowerCase() !==
      path.resolve(expectedModule).toLowerCase()
  ) {
    throw new Error(
      "页间入口必须指向当前工作区的 live server.mjs，不能加载历史快照"
    );
  }
  await validateOtterReviewModuleClosure(workspace, modulePath);
  const reviewRoot = path.dirname(modulePath);
  await Promise.all([
    access(path.join(reviewRoot, "public", "index.html")),
    access(path.join(reviewRoot, "package.json"))
  ]);
  // Keep compatibility with the existing page handoff contract beside live source.
  const dataDir = path.join(reviewRoot, "data");
  void userDataPath;
  const reviewModule = await importReviewModule(pathToFileURL(modulePath).href);
  const workbench = await reviewModule.createWorkbench({ workspace, dataDir });
  const requests = new Set<AbortController>();
  const handler = createOtterReviewProtocolHandler(workbench, {
    createSignal: () => {
      const controller = new AbortController();
      requests.add(controller);
      return {
        signal: controller.signal,
        release: (response) =>
          retainRequestUntilBodyEnds(response, controller, requests)
      };
    }
  });
  protocolInstaller.handle(OTTER_REVIEW_SCHEME, handler);
  const installation = {
    close(): void {
      for (const controller of requests) controller.abort();
      requests.clear();
      protocolInstaller.unhandle(OTTER_REVIEW_SCHEME);
      if (activeInstallation === installation) activeInstallation = null;
    }
  };
  activeInstallation = installation;
  return { url: OTTER_REVIEW_URL, close: installation.close };
}

/** Apply to a dedicated WebContentsView; this app never needs child frames or popups. */
export function constrainOtterReviewWebContents(
  webContents: Pick<WebContents, "setWindowOpenHandler" | "on">
): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, target) => {
    const destination = typeof target === "string" ? target : "";
    if (destination !== OTTER_REVIEW_URL) {
      (event as { preventDefault?: () => void })?.preventDefault?.();
    }
  });
  webContents.on("will-frame-navigate", (details) => {
    if (!details.isMainFrame || details.url !== OTTER_REVIEW_URL) {
      details.preventDefault();
    }
  });
}
