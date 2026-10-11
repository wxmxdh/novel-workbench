import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OTTER_REVIEW_ORIGIN,
  OTTER_REVIEW_SCHEME,
  OTTER_REVIEW_URL,
  constrainOtterReviewWebContents,
  createOtterReviewProtocolHandler,
  installOtterReviewProtocol,
  registerOtterReviewScheme,
  validateOtterReviewModuleClosure,
  type OtterReviewProtocolInstaller,
  type OtterReviewProtocolRegistrar
} from "./review-protocol";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("Otter review protocol", () => {
  it("registers the secure standard scheme before Electron app readiness", () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerOtterReviewScheme({
      registerSchemesAsPrivileged
    } as OtterReviewProtocolRegistrar);
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
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
  });

  it("rejects a live server dependency that escapes the current workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "otter-review-closure-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const live = path.join(workspace, "06_脚本工具", "小说对照工作台");
    const outside = path.join(root, "outside.mjs");
    const entry = path.join(live, "server.mjs");
    await mkdir(path.join(live, "public"), { recursive: true });
    await Promise.all([
      writeFile(entry, 'import "../../../outside.mjs";\n'),
      writeFile(outside, "export {};\n"),
      writeFile(path.join(live, "public", "index.html"), "fixture"),
      writeFile(path.join(live, "package.json"), "{}")
    ]);
    await expect(
      validateOtterReviewModuleClosure(workspace, entry)
    ).rejects.toThrow("小说工作区之外");
    const importReviewModule = vi.fn();
    await expect(
      installOtterReviewProtocol({
        workspaceRoot: workspace,
        userDataPath: path.join(root, "user-data"),
        reviewModulePath: entry,
        protocolInstaller: { handle: vi.fn(), unhandle: vi.fn() },
        importReviewModule
      })
    ).rejects.toThrow("小说工作区之外");
    expect(importReviewModule).not.toHaveBeenCalled();
  });

  it("forwards same-origin requests to the shared live request handler and rejects foreign origins", async () => {
    const handleRequest = vi.fn(async () => new Response("ok"));
    const handler = createOtterReviewProtocolHandler({ handleRequest });
    const valid = await handler(
      new Request(`${OTTER_REVIEW_ORIGIN}/api/projects`)
    );
    expect(valid.status).toBe(200);
    expect(handleRequest).toHaveBeenCalledWith(expect.any(Request), {
      transport: "protocol"
    });
    const invalid = await handler(
      new Request(`${OTTER_REVIEW_ORIGIN}/api/projects`, {
        headers: { origin: "otter-review://other" }
      })
    );
    expect(invalid.status).toBe(403);
    expect(handleRequest).toHaveBeenCalledOnce();
  });

  it("loads the supplied live source and retains its existing handoff data directory without listening", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "otter-review-install-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const live = path.join(workspace, "06_脚本工具", "小说对照工作台");
    const userData = path.join(root, "desktop-user-data");
    await Promise.all([
      mkdir(path.join(live, "public"), { recursive: true }),
      mkdir(userData, { recursive: true })
    ]);
    const reviewModulePath = path.join(live, "server.mjs");
    await Promise.all([
      writeFile(reviewModulePath, "// fixture"),
      writeFile(path.join(live, "public", "index.html"), "fixture"),
      writeFile(path.join(live, "package.json"), "{}")
    ]);
    const handle = vi.fn();
    const unhandle = vi.fn();
    const createWorkbench = vi.fn(async () => ({
      handleRequest: vi.fn(async () => new Response("ok"))
    }));
    const installer = { handle, unhandle } as OtterReviewProtocolInstaller;
    const result = await installOtterReviewProtocol({
      workspaceRoot: workspace,
      userDataPath: userData,
      reviewModulePath,
      protocolInstaller: installer,
      importReviewModule: vi.fn(async () => ({ createWorkbench }))
    });
    expect(result.url).toBe(OTTER_REVIEW_URL);
    expect(createWorkbench).toHaveBeenCalledWith({
      workspace,
      dataDir: path.join(live, "data")
    });
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[0]).toBe(OTTER_REVIEW_SCHEME);
    result.close();
    expect(unhandle).toHaveBeenCalledWith(OTTER_REVIEW_SCHEME);
  });

  it("blocks popup, cross-origin navigation, and child frames on its dedicated view", () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const setWindowOpenHandler = vi.fn();
    const webContents = {
      setWindowOpenHandler,
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) =>
        handlers.set(event, listener)
      )
    };
    constrainOtterReviewWebContents(webContents as never);
    expect(setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
    const preventDefault = vi.fn();
    handlers.get("will-navigate")?.({ preventDefault }, OTTER_REVIEW_URL);
    expect(preventDefault).not.toHaveBeenCalled();
    handlers.get("will-navigate")?.(
      { preventDefault },
      "https://example.test/"
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    handlers.get("will-frame-navigate")?.({
      preventDefault,
      isMainFrame: true,
      url: OTTER_REVIEW_URL
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    handlers.get("will-frame-navigate")?.({
      preventDefault,
      isMainFrame: false,
      url: OTTER_REVIEW_URL
    });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    handlers.get("will-frame-navigate")?.({
      preventDefault,
      isMainFrame: true,
      url: "https://example.test/"
    });
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });
});
