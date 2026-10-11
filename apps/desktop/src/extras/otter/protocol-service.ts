import { execFile as execFileCallback } from "node:child_process";
import { builtinModules } from "node:module";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import type {
  OtterContextRef,
  OtterContextResult,
  OtterRouteInput,
  OtterStageDraftInput,
  OtterWorkflowInput
} from "@deepwrite/contracts";
import type { OtterProjectAdapter } from "./project-adapter";
import {
  renderOtterContext,
  type ContextPack,
  type PreflightResult
} from "./context-service";

type RecordValue = Record<string, unknown>;
interface V1Module {
  loadProject(workspaceRoot: string, projectRelativePath: string): unknown;
  checkPack(project: unknown, pack: ContextPack, receipt: RecordValue): unknown;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isV1Module(value: unknown): value is V1Module {
  return (
    isRecord(value) &&
    typeof value.loadProject === "function" &&
    typeof value.checkPack === "function"
  );
}

function isPreflight(value: unknown): value is PreflightResult {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.context_id === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isContextPack(value: unknown): value is ContextPack {
  if (!isRecord(value)) return false;
  const requiredStrings = [
    "context_id",
    "task_id",
    "project",
    "project_root",
    "task",
    "scope",
    "target",
    "pov",
    "baseline_hash"
  ];
  if (!requiredStrings.every((key) => typeof value[key] === "string"))
    return false;
  if (
    !("sources" in value) ||
    !Array.isArray(value.sources) ||
    !value.sources.every(
      (source) =>
        isRecord(source) &&
        typeof source.path === "string" &&
        typeof source.hash === "string" &&
        typeof source.role === "string" &&
        typeof source.line_start === "number" &&
        typeof source.line_end === "number"
    )
  )
    return false;
  return [
    "relevant_characters",
    "relevant_relationships",
    "knowledge_boundary",
    "intentional_unknowns",
    "recent_context",
    "author_instructions",
    "skills_allowed",
    "reference_scope",
    "forbidden_future_info",
    "warnings"
  ].every((key) => isStringArray(value[key]));
}

const MUTATING_ACTIONS = new Set([
  "deliver-plan",
  "select-outline",
  "deliver-draft",
  "accept",
  "candidates",
  "decision",
  "commit"
]);
const ALLOWED_ACTIONS = new Set([
  "prepare",
  "preflight",
  "deliver-plan",
  "select-outline",
  "deliver-draft",
  "accept",
  "candidates",
  "decision",
  "commit",
  "derived"
]);
const CTX_RE = /^\.novel\/context\/CTX-[\w-]+\.json$/;
const RCPT_RE = /^\.novel\/receipts\/RCPT-[\w-]+\.json$/;
export interface OtterProtocolServiceOptions {
  v1CliPath?: string;
  /** Main-only trust root required when explicitly overriding the live V1 entry. */
  trustedCliRoot?: string;
  userDataPath?: string;
  /** Test seam. Production callers should use the built-in V1 module loader. */
  loadV1?: () => Promise<unknown>;
  /** Test seam for the fixed CLI process invocation. */
  runCli?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

const execFile = promisify(execFileCallback);

function parseLastJson(stdout: string): RecordValue {
  const starts = [...stdout.matchAll(/^\s*\{/gm)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .reverse();
  for (const start of starts) {
    try {
      return JSON.parse(stdout.slice(start).trim()) as RecordValue;
    } catch {
      /* try the previous object start */
    }
  }
  throw new Error(
    `V1 CLI did not return a final JSON object: ${stdout.slice(-800)}`
  );
}

function parseRecordJson(content: string, description: string): RecordValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${description} is not valid JSON.`);
  }
  if (!isRecord(parsed))
    throw new Error(`${description} must be a JSON object.`);
  return parsed;
}

/**
 * Thin desktop facade over the canonical V1 CLI. It invokes a fixed command
 * allowlist in-process (no shell, executable path, or caller-supplied command).
 */
export function createOtterProtocolService(
  workspaceRoot: string,
  adapter: OtterProjectAdapter,
  options: OtterProtocolServiceOptions = {}
) {
  const workspace = resolve(workspaceRoot);
  const userDataPath = resolve(options.userDataPath ?? adapter.userDataPath);
  const cliPath = resolve(
    options.v1CliPath ??
      join(workspace, "06_脚本工具", "写作协议V1", "novel-cli.mjs")
  );
  const cliRoot = resolve(
    options.trustedCliRoot ?? join(workspace, "06_脚本工具", "写作协议V1")
  );
  if (options.v1CliPath && !options.trustedCliRoot)
    throw new Error(
      "A custom V1 CLI path requires an explicit trusted code root."
    );
  let sourceTreePromise: Promise<void> | undefined;
  const verifyV1SourceTree = () =>
    (sourceTreePromise ??= validateV1SourceTree(
      workspace,
      cliRoot,
      cliPath,
      !options.v1CliPath
    ));
  let modulePromise: Promise<unknown> | undefined;
  const loadV1 = async (): Promise<V1Module> => {
    if (!options.loadV1) await verifyV1SourceTree();
    const loaded = await (modulePromise ??= options.loadV1
      ? options.loadV1()
      : import(pathToFileURL(cliPath).href));
    if (!isV1Module(loaded))
      throw new Error(
        "Current V1 CLI does not export the required read-only adapter functions."
      );
    return loaded;
  };

  async function runCommand(args: string[]): Promise<RecordValue> {
    const env = { ...process.env };
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    let output: { stdout: string; stderr: string };
    try {
      output = options.runCli
        ? await options.runCli(args)
        : await (async () => {
            await verifyV1SourceTree();
            return execFile(process.execPath, [cliPath, ...args], {
              cwd: workspace,
              env,
              encoding: "utf8",
              windowsHide: true,
              shell: false,
              timeout: 120_000,
              maxBuffer: 32 * 1024 * 1024
            });
          })();
    } catch (error) {
      const details =
        (error as { stderr?: string; message?: string }).stderr ??
        (error as Error).message;
      let parsed: RecordValue | undefined;
      try {
        parsed = parseLastJson(details);
      } catch {
        /* keep process diagnostic */
      }
      throw new Error(
        (typeof parsed?.reason === "string" ? parsed.reason : undefined) ??
          `V1 CLI command failed: ${details.slice(-1200)}`
      );
    }
    const result = parseLastJson(output.stdout);
    if (result.status === "FAIL")
      throw new Error(
        typeof result.reason === "string" ? result.reason : "V1 command failed."
      );
    return result;
  }

  async function projectArgs(
    projectId: string
  ): Promise<{ relativePath: string; workspaceRoot: string }> {
    const project = await adapter.resolveProject(projectId);
    if (project.workspaceRoot !== workspace)
      throw new Error(
        "Otter workspace root differs from the root selected in this session."
      );
    return {
      relativePath: project.relativePath,
      workspaceRoot: project.workspaceRoot
    };
  }

  async function stageInput(input: RecordValue): Promise<string> {
    await mkdir(userDataPath, { recursive: true });
    const dir = join(userDataPath, "otter-v1-input");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `input-${cryptoRandomId()}.json`);
    await writeFile(file, `${JSON.stringify(input, null, 2)}\n`, {
      flag: "wx",
      encoding: "utf8"
    });
    return file;
  }

  async function withInput<T>(
    input: RecordValue,
    action: (path: string) => Promise<T>
  ): Promise<T> {
    const file = await stageInput(input);
    try {
      return await action(file);
    } finally {
      await rm(file, { force: true });
    }
  }

  const service = {
    async registerNewProject(
      relativePath: string,
      input: RecordValue
    ): Promise<void> {
      if (
        !relativePath.startsWith("00_创作项目/项目/") ||
        relativePath.includes("..") ||
        relativePath.includes("\\")
      )
        throw new Error("新作品必须位于当前工作区的项目目录。");
      await withInput(input, (file) =>
        runCommand([
          "register",
          "--workspace",
          workspace,
          "--project",
          relativePath,
          "--input",
          file
        ])
      );
    },
    async route(input: OtterRouteInput): Promise<RecordValue> {
      if (!Number.isInteger(input.chapter) || input.chapter < 1)
        throw new Error("Route requires a positive chapter number.");
      const project = await projectArgs(input.projectId);
      return runCommand([
        "route",
        "--workspace",
        project.workspaceRoot,
        "--project",
        project.relativePath,
        "--task",
        input.task === "discuss" ? "discussion" : input.task,
        "--chapter",
        String(input.chapter),
        ...(input.volume ? ["--volume", input.volume] : [])
      ]);
    },

    async workflow(input: OtterWorkflowInput): Promise<RecordValue> {
      if (!ALLOWED_ACTIONS.has(input.action))
        throw new Error("Unsupported Otter workflow action.");
      if (MUTATING_ACTIONS.has(input.action) && !input.authorIntent?.trim())
        throw new Error(
          `Action ${input.action} requires an explicit author-intent statement in addition to V1 evidence.`
        );
      const project = await projectArgs(input.projectId);
      const common = [
        "--workspace",
        project.workspaceRoot,
        "--project",
        project.relativePath
      ];
      if (input.action === "derived") return runCommand(["derived", ...common]);
      if (input.action === "preflight") {
        if (
          !input.contextPath ||
          !CTX_RE.test(input.contextPath) ||
          !input.receiptPath ||
          !RCPT_RE.test(input.receiptPath)
        )
          throw new Error(
            "Preflight requires project-local V1 context and receipt paths."
          );
        return runCommand([
          "preflight",
          ...common,
          "--context",
          input.contextPath,
          "--receipt",
          input.receiptPath
        ]);
      }
      const payload = input.input;
      if (!payload)
        throw new Error(
          `${input.action} requires a structured V1 input object.`
        );
      return withInput(payload, (inputFile) => {
        const flags = ["--input", inputFile];
        if (input.action === "prepare") flags.push("--agent", "deepwrite");
        if (["preflight", "deliver-draft"].includes(input.action)) {
          if (input.contextPath) flags.push("--context", input.contextPath);
          if (input.receiptPath) flags.push("--receipt", input.receiptPath);
        }
        if (input.planPath && ["prepare", "route"].includes(input.action))
          flags.push("--plan", input.planPath);
        return runCommand([input.action, ...common, ...flags]);
      });
    },

    async context(input: OtterContextRef): Promise<OtterContextResult> {
      if (!CTX_RE.test(input.contextPath))
        throw new Error(
          "Context path must point to a V1 .novel/context/CTX-*.json file."
        );
      if (input.receiptPath && !RCPT_RE.test(input.receiptPath))
        throw new Error(
          "Receipt path must point to a V1 .novel/receipts/RCPT-*.json file."
        );
      const project = await projectArgs(input.projectId);
      const contextDoc = await adapter.readDocument(
        input.projectId,
        input.contextPath
      );
      const rawPack = parseRecordJson(contextDoc.content, "V1 Context");
      if (!isContextPack(rawPack))
        throw new Error("V1 Context has an invalid structure.");
      const pack = rawPack;
      const runDoc = await adapter.readDocument(
        input.projectId,
        `.novel/state/runs/${pack.task_id}.json`
      );
      const run = parseRecordJson(runDoc.content, "V1 task run");
      const receiptPath = input.receiptPath ?? run.receipt;
      if (typeof receiptPath !== "string" || !RCPT_RE.test(receiptPath))
        throw new Error(
          "No matching V1 reader receipt is recorded for this task."
        );
      if (
        run.context !== input.contextPath ||
        run.receipt !== receiptPath ||
        run.baseline_hash !== pack.baseline_hash
      )
        throw new Error(
          "Task run does not bind the requested Context, Receipt, and integrity baseline."
        );
      const receiptDoc = await adapter.readDocument(
        input.projectId,
        receiptPath
      );
      const receipt = parseRecordJson(receiptDoc.content, "V1 receipt");
      const preflightPath = run.preflight;
      if (
        run.phase !== "ready" ||
        typeof preflightPath !== "string" ||
        !/^\.novel\/state\/preflight\/[\w.-]+\.json$/.test(preflightPath)
      )
        throw new Error(
          "The task is not in ready state or its saved V1 preflight is missing; context expansion fails closed."
        );
      const preflightDoc = await adapter.readDocument(
        input.projectId,
        preflightPath
      );
      const savedPreflight = parseRecordJson(
        preflightDoc.content,
        "V1 saved preflight"
      );
      if (!isPreflight(savedPreflight))
        throw new Error("V1 saved preflight has an invalid structure.");
      const v1 = await loadV1();
      const loaded = v1.loadProject(
        project.workspaceRoot,
        project.relativePath
      );
      const currentResult = v1.checkPack(loaded, pack, receipt);
      if (!isPreflight(currentResult))
        throw new Error(
          "Current V1 checkPack returned an invalid preflight result."
        );
      const current = currentResult;
      if (savedPreflight.status === "FAIL" || current.status === "FAIL")
        throw new Error(
          "Saved or current V1 preflight failed; no context is expanded."
        );
      if (savedPreflight.context_id !== pack.context_id)
        throw new Error(
          "Saved preflight does not match the selected context integrity baseline."
        );
      const sourceLineCounts: Record<string, number> = {};
      for (const source of pack.sources) {
        if (Object.hasOwn(sourceLineCounts, source.path)) continue;
        const original = await adapter.readDocument(
          input.projectId,
          source.path
        );
        if (original.hash !== source.hash)
          throw new Error(
            `Context source changed while building navigation: ${source.path}`
          );
        sourceLineCounts[source.path] = original.content
          .replace(/^\uFEFF/, "")
          .split(/\r?\n/).length;
      }
      const rendered = renderOtterContext({
        pack,
        preflight: current,
        savedPreflight,
        sourceLineCounts
      });
      return {
        contextId: rendered.contextId,
        baselineHash: rendered.baselineHash,
        comparisonBaselineHash: rendered.comparisonBaselineHash,
        apiText: rendered.apiText,
        agentText: rendered.agentText
      };
    },

    async stageDraft(
      input: OtterStageDraftInput & {
        sessionFile?: string | undefined;
        sessionId?: string | undefined;
      }
    ): Promise<RecordValue> {
      if (!input.authorIntent.trim())
        throw new Error("Draft delivery requires an explicit author intent.");
      if (
        !input.body.trim() ||
        Buffer.byteLength(input.body, "utf8") > 8 * 1024 * 1024
      )
        throw new Error("Draft body is empty or exceeds the 8 MiB limit.");
      const view = await service.context({
        projectId: input.projectId,
        contextPath: input.contextPath,
        receiptPath: input.receiptPath
      });
      const project = await adapter.resolveProject(input.projectId);
      const packDoc = await adapter.readDocument(
        input.projectId,
        input.contextPath
      );
      const rawPack = parseRecordJson(packDoc.content, "V1 Context");
      if (!isContextPack(rawPack))
        throw new Error("V1 Context has an invalid structure.");
      const pack = rawPack;
      if (
        !/^TASK-[\w-]+$/.test(pack.task_id) ||
        !["draft", "continue", "revise"].includes(pack.task)
      )
        throw new Error("V1 context is not an authorized prose task.");
      // Preserve an immutable, task-scoped input file. This is the only direct
      // project write here; final delivery and all metadata remain V1-owned.
      const relPath = `.novel/state/task-inputs/${pack.task_id}/deepwrite-${cryptoRandomId()}.md`;
      const parts = relPath.split("/");
      let cursor = project.projectRoot;
      for (const part of parts.slice(0, -1)) {
        cursor = join(cursor, part);
        const existing = await lstat(cursor).catch(() => null);
        if (existing?.isSymbolicLink())
          throw new Error(`Refusing symlink in task input path: ${relPath}`);
      }
      const bodyFile = resolve(project.projectRoot, relPath);
      await mkdir(
        join(
          project.projectRoot,
          ".novel",
          "state",
          "task-inputs",
          pack.task_id
        ),
        { recursive: true }
      );
      await writeFile(bodyFile, input.body, { flag: "wx", encoding: "utf8" });
      const delivery = await this.workflow({
        projectId: input.projectId,
        action: "deliver-draft",
        authorIntent: input.authorIntent,
        contextPath: input.contextPath,
        receiptPath: input.receiptPath,
        input: {
          body_file: relPath,
          title: input.title,
          revision: input.revision,
          used_skills: [],
          summary:
            "DeepWrite draft delivered through the approved V1 Context and Receipt; runtime model identity is based on a workspace-bound local runtime record, not independently verified physical upstream response.",
          generator: "deepwrite",
          ...(input.sessionFile && input.sessionId
            ? {
                session_file: await requireRuntimeEvidenceFile(
                  input.sessionFile,
                  userDataPath
                ),
                session_id: input.sessionId
              }
            : {})
        }
      });
      return {
        ...delivery,
        stagedBody: relPath,
        contextId: view.contextId,
        baselineHash: view.baselineHash,
        comparisonBaselineHash: view.comparisonBaselineHash,
        model:
          isRecord(delivery.identity) &&
          typeof delivery.identity.model === "string"
            ? delivery.identity.model
            : "unknown"
      };
    }
  };
  return service;
}

async function requireRuntimeEvidenceFile(
  value: string,
  userDataPath: string
): Promise<string> {
  const userDataInput = resolve(userDataPath);
  const userData = await realpath(userDataInput);
  const candidate = resolve(value);
  const lexicalRel = relative(userDataInput, candidate);
  if (
    lexicalRel === ".." ||
    lexicalRel.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRel)
  )
    throw new Error(
      "DeepWrite identity evidence must come from the Main-owned userData/otter/runtime-evidence store."
    );
  let lexicalCursor = userDataInput;
  for (const part of lexicalRel.split(/[\\/]/)) {
    lexicalCursor = join(lexicalCursor, part);
    const stat = await lstat(lexicalCursor);
    if (stat.isSymbolicLink())
      throw new Error(
        "DeepWrite runtime evidence path cannot contain symbolic links."
      );
  }
  const actual = await realpath(candidate);
  const rel = relative(userData, actual);
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    !rel.startsWith(join("otter", "runtime-evidence") + sep) ||
    extname(candidate).toLowerCase() !== ".jsonl"
  )
    throw new Error(
      "DeepWrite identity evidence must come from the Main-owned userData/otter/runtime-evidence store."
    );
  const stat = await lstat(actual);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("DeepWrite runtime evidence must be a regular file.");
  return actual;
}

let nextInputId = 0;
function cryptoRandomId(): string {
  // Uniqueness is only for wx-created temporary input names; not a project identity.
  return `${Date.now().toString(36)}-${(++nextInputId).toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

async function rejectSymlinkComponents(
  root: string,
  target: string
): Promise<void> {
  const rootAbs = resolve(root);
  const targetAbs = resolve(target);
  const rel = relative(rootAbs, targetAbs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("V1 runtime file escapes its trusted source root.");
  let cursor = rootAbs;
  const rootStat = await lstat(cursor);
  if (rootStat.isSymbolicLink())
    throw new Error("V1 runtime root cannot be a symbolic link.");
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink())
      throw new Error(
        `V1 runtime path cannot contain symbolic links: ${cursor}`
      );
  }
}

function importSpecifiers(source: string, file: string): string[] {
  if (/\brequire\s*\(/.test(source))
    throw new Error(
      `V1 runtime may not use untracked CommonJS imports: ${file}`
    );
  const specifiers: string[] = [];
  const staticPattern =
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(staticPattern))
    specifiers.push(match[1]!);
  const dynamicPattern = /\bimport\s*\(([^)]*)\)/g;
  for (const match of source.matchAll(dynamicPattern)) {
    const literal = /^\s*(['"])([^'"]+)\1\s*$/.exec(match[1]!);
    if (!literal)
      throw new Error(
        `V1 runtime contains a non-literal dynamic import: ${file}`
      );
    specifiers.push(literal[2]!);
  }
  return specifiers;
}

async function validateV1SourceTree(
  workspaceInput: string,
  trustedRootInput: string,
  entryInput: string,
  requireWorkspaceContainment: boolean
): Promise<void> {
  const workspace = await realpath(workspaceInput);
  const root = await realpath(trustedRootInput);
  const entry = resolve(entryInput);
  const realEntry = await realpath(entry);
  if (!isWithin(root, realEntry) || !isWithin(root, entry))
    throw new Error("V1 CLI entry must remain inside its trusted code root.");
  if (requireWorkspaceContainment && !isWithin(workspace, root))
    throw new Error(
      "Live V1 code root must remain inside the selected workspace."
    );
  await rejectSymlinkComponents(root, entry);
  if (!entry.endsWith(".mjs"))
    throw new Error("V1 CLI entry must be an .mjs file.");
  const builtins = new Set(
    builtinModules.flatMap((name) => [name, `node:${name}`])
  );
  const pending = [realEntry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!isWithin(root, file))
      throw new Error("V1 runtime dependency escaped its trusted code root.");
    const source = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(source, file)) {
      if (builtins.has(specifier)) continue;
      if (!specifier.startsWith(".") || !specifier.endsWith(".mjs"))
        throw new Error(
          `V1 runtime may import only node built-ins or local .mjs files: ${specifier}`
        );
      const dependency = resolve(dirname(file), specifier);
      await rejectSymlinkComponents(root, dependency);
      const realDependency = await realpath(dependency);
      if (!isWithin(root, realDependency))
        throw new Error(
          `V1 runtime dependency escaped its trusted code root: ${specifier}`
        );
      pending.push(realDependency);
    }
  }
}
