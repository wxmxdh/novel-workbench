import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import {
  OtterManualHandoffInputSchema,
  OtterManualReportInputSchema,
  type OtterContextRef,
  type OtterManualHandoffInput,
  type OtterManualHandoffResult,
  type OtterManualReport
} from "@deepwrite/contracts";

const REPORT_NAME = "意见.md";
const MANIFEST_NAME = ".handoff.json";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_REPORT_BYTES = 250 * 1024;
const TEXT_SOURCE_EXTENSIONS = /\.(?:md|markdown|txt|json|jsonl|ya?ml|csv)$/i;

type Project = {
  workspaceRoot: string;
  projectRoot: string;
  relativePath: string;
};
export interface ManualHandoffDependencies {
  resolveProject(projectId: string): Promise<Project>;
  readSource(
    projectId: string,
    path: string
  ): Promise<{ path: string; content: string }>;
  /** Must re-run V1 Context/Receipt/preflight validation against current sources. */
  resolveContext?(reference: OtterContextRef): Promise<{ apiText: string }>;
}

type Manifest = {
  schema: 1;
  id: string;
  projectId: string;
  workspaceRoot: string;
  projectRoot: string;
  projectRelativePath: string;
  createdAt: string;
  snapshots: Array<{
    path: string;
    scope: "project" | "workspace";
    hash: string;
    bytes: number;
  }>;
  notEvaluated: string[];
};

const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const inRoot = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
};
function normalizeRelativePath(value: string): string {
  if (
    !value ||
    isAbsolute(value) ||
    value
      .split(/[\\/]/)
      .some((part) => part === ".." || part === "." || part === "")
  )
    throw new Error(
      `Expected a normalized project-relative source path: ${value}`
    );
  return value.split(sep).join("/");
}
function sourceTarget(
  project: Project,
  value: string
): { relativePath: string; scope: "project" | "workspace"; root: string } {
  const workspaceScoped = value.startsWith("workspace:");
  const relativePath = normalizeRelativePath(
    workspaceScoped ? value.slice("workspace:".length) : value
  );
  return {
    relativePath,
    scope: workspaceScoped ? "workspace" : "project",
    root: workspaceScoped ? project.workspaceRoot : project.projectRoot
  };
}
async function readSafeFile(
  root: string,
  path: string,
  maxBytes: number
): Promise<Buffer> {
  const relativePath = normalizeRelativePath(path);
  const absolute = resolve(root, relativePath);
  if (!inRoot(root, absolute))
    throw new Error("Source path escapes its authorized root.");
  let cursor = root;
  for (const part of relativePath.split(/[\\/]/)) {
    cursor = join(cursor, part);
    const partStat = await lstat(cursor);
    if (partStat.isSymbolicLink())
      throw new Error("Source path contains a symbolic link.");
  }
  const resolved = await realpath(absolute);
  if (!inRoot(root, resolved))
    throw new Error("Resolved source escapes its authorized root.");
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.size > maxBytes)
    throw new Error(
      "Source is not a regular file within the review size limit."
    );
  return readFile(resolved);
}
function escapeMarkdown(value: string): string {
  return value.replace(/[<>]/g, "");
}

export class OtterManualHandoffService {
  private readonly userDataRoot: string;
  private readonly handoffRoot: string;
  private readonly macKeyPath: string;
  constructor(
    userDataPath: string,
    private readonly dependencies: ManualHandoffDependencies
  ) {
    this.userDataRoot = resolve(userDataPath);
    this.handoffRoot = resolve(this.userDataRoot, "otter", "manual-handoffs");
    this.macKeyPath = resolve(
      this.userDataRoot,
      "config",
      "otter-handoff-mac.key"
    );
  }

  private async ensureManagedDirectory(path: string): Promise<string> {
    const userDataReal = await realpath(this.userDataRoot);
    if (!inRoot(userDataReal, resolve(path)))
      throw new Error("Manual handoff storage escaped application data.");
    const relativePath = relative(userDataReal, resolve(path));
    let cursor = userDataReal;
    for (const part of relativePath.split(sep).filter(Boolean)) {
      cursor = join(cursor, part);
      if (!(await lstat(cursor).catch(() => null))) {
        await mkdir(cursor).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        });
      }
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(
          "Manual handoff storage contains a symbolic link or non-directory."
        );
      const actual = await realpath(cursor);
      if (!inRoot(userDataReal, actual))
        throw new Error(
          "Manual handoff storage resolves outside application data."
        );
      cursor = actual;
    }
    return cursor;
  }

  private async assertManagedPath(path: string): Promise<void> {
    const userDataReal = await realpath(this.userDataRoot);
    const absolute = resolve(path);
    if (!inRoot(userDataReal, absolute))
      throw new Error("Manual handoff path escaped application data.");
    let cursor = userDataReal;
    for (const part of relative(userDataReal, absolute)
      .split(sep)
      .filter(Boolean)) {
      cursor = join(cursor, part);
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(
          "Manual handoff path contains a symbolic link or non-directory."
        );
    }
    const actual = await realpath(absolute);
    if (!inRoot(userDataReal, actual))
      throw new Error("Manual handoff path resolves outside application data.");
  }

  private async macKey(): Promise<Buffer> {
    await this.ensureManagedDirectory(dirname(this.macKeyPath));
    let stat = await lstat(this.macKeyPath).catch(() => null);
    if (!stat) {
      try {
        await writeFile(this.macKeyPath, randomBytes(32), {
          flag: "wx",
          mode: 0o600
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      stat = await lstat(this.macKeyPath);
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== 32)
      throw new Error("Manual handoff integrity key is missing or unsafe.");
    const key = await readFile(this.macKeyPath);
    const userDataReal = await realpath(this.userDataRoot);
    const keyReal = await realpath(this.macKeyPath);
    if (!inRoot(userDataReal, keyReal))
      throw new Error("Manual handoff integrity key escaped application data.");
    return key;
  }

  async create(
    rawInput: OtterManualHandoffInput
  ): Promise<OtterManualHandoffResult> {
    const input = OtterManualHandoffInputSchema.parse(rawInput);
    const project = await this.dependencies.resolveProject(input.projectId);
    const workspaceRoot = await realpath(project.workspaceRoot);
    const projectRoot = await realpath(project.projectRoot);
    if (!inRoot(workspaceRoot, projectRoot))
      throw new Error(
        "Selected project resolves outside the current novel workspace."
      );
    const projectRelativePath = normalizeRelativePath(project.relativePath);
    if (!inRoot(workspaceRoot, resolve(workspaceRoot, projectRelativePath)))
      throw new Error("Project path escapes current novel workspace.");

    let authorizedPaths: string[] = [];
    const sourceNotes = new Map<string, string>();
    let contextMustNotRead: string[] = [];
    let contextUnknowns: string[] = [];
    if (input.context) {
      if (input.context.projectId !== input.projectId)
        throw new Error("Context belongs to a different project.");
      if (!this.dependencies.resolveContext)
        throw new Error("V1 Context validation is unavailable.");
      const current = await this.dependencies.resolveContext(input.context);
      // Context provides the task's source navigation, but the receipt is never treated as proof of comprehension.
      const rawContext = await this.dependencies.readSource(
        input.projectId,
        input.context.contextPath
      );
      const contextValue = JSON.parse(rawContext.content) as {
        sources?: unknown;
        must_not_read?: unknown;
        intentional_unknowns?: unknown;
      };
      if (Array.isArray(contextValue.must_not_read))
        contextMustNotRead = contextValue.must_not_read
          .filter((item): item is string => typeof item === "string")
          .slice(0, 100);
      if (Array.isArray(contextValue.intentional_unknowns))
        contextUnknowns = contextValue.intentional_unknowns
          .filter((item): item is string => typeof item === "string")
          .slice(0, 100);
      if (
        !Array.isArray(contextValue.sources) ||
        !contextValue.sources.every(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as { path?: unknown }).path === "string"
        )
      )
        throw new Error("V1 Context has no valid source navigation list.");
      authorizedPaths = (
        contextValue.sources as Array<{
          path: string;
          role?: string;
          section?: string;
          line_start?: number;
          line_end?: number;
        }>
      ).map((source) => {
        const normalized = source.path.startsWith("workspace:")
          ? `workspace:${normalizeRelativePath(source.path.slice("workspace:".length))}`
          : normalizeRelativePath(source.path);
        if (typeof source.role === "string" && source.role.trim())
          sourceNotes.set(
            normalized,
            `V1 Context role metadata: ${source.role}${source.section ? `; section: ${source.section}` : ""}${Number.isInteger(source.line_start) && Number.isInteger(source.line_end) ? `; authorized lines ${source.line_start}-${source.line_end}` : ""}`
          );
        return normalized;
      });
      // The API text is deliberately not copied into the handoff bundle; Codex is directed to the verified files.
      if (!current.apiText.trim())
        throw new Error("V1 Context did not produce current navigation.");
    }
    const requestedPaths = input.sources.map(normalizeRelativePath);
    const protocolPaths = [
      "workspace:AGENTS.md",
      ...[
        "authority",
        "task-routing",
        "chapter-workflow",
        "context-policy",
        "review-policy",
        "canon-policy",
        "third-party-policy",
        "skill-permissions"
      ].map((name) => `workspace:.novel/protocol/${name}.md`)
    ];
    const sourcePaths = [
      ...new Set([...authorizedPaths, ...requestedPaths, ...protocolPaths])
    ];
    if (sourcePaths.length === 0)
      throw new Error(
        "Choose a verified V1 Context or explicitly select sources."
      );
    if (sourcePaths.length > 40)
      throw new Error(
        "A manual review can include at most 40 sources including the required V1 policy set."
      );

    const snapshots: Manifest["snapshots"] = [];
    const summary: OtterManualHandoffResult["sourceSummary"] = [];
    const notEvaluated: string[] = [];
    let totalBytes = 0;
    for (const path of sourcePaths) {
      const target = sourceTarget(project, path);
      if (!TEXT_SOURCE_EXTENSIONS.test(extname(target.relativePath)))
        throw new Error(
          `Only text sources can be handed off; use an image's written map/location notes instead: ${path}`
        );
      let loaded: { path: string; content: string };
      try {
        loaded = await this.dependencies.readSource(input.projectId, path);
      } catch (error) {
        if (protocolPaths.includes(path)) {
          notEvaluated.push(
            `${path}: ${error instanceof Error ? error.message : "source unavailable"}`
          );
          continue;
        }
        throw error;
      }
      const bytes = Buffer.byteLength(loaded.content, "utf8");
      if (bytes > MAX_SOURCE_BYTES)
        throw new Error(
          `Selected source exceeds the 2 MiB handoff limit: ${path}`
        );
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES)
        throw new Error("Selected sources exceed the 8 MiB review boundary.");
      snapshots.push({
        path: target.relativePath,
        scope: target.scope,
        hash: digest(loaded.content),
        bytes
      });
      if (!protocolPaths.includes(path))
        summary.push({
          path,
          title: basename(sourceTarget(project, path).relativePath)
        });
    }

    const id = randomUUID();
    const rootReal = await this.ensureManagedDirectory(this.handoffRoot);
    const directory = join(rootReal, id);
    await mkdir(directory, { recursive: false });
    const reportPath = join(directory, REPORT_NAME);
    const manifest: Manifest = {
      schema: 1,
      id,
      projectId: input.projectId,
      workspaceRoot,
      projectRoot,
      projectRelativePath,
      createdAt: new Date().toISOString(),
      snapshots,
      notEvaluated
    };
    const signature = createHmac("sha256", await this.macKey())
      .update(JSON.stringify(manifest))
      .digest("hex");
    await writeFile(
      join(directory, MANIFEST_NAME),
      JSON.stringify({ ...manifest, signature }, null, 2),
      { flag: "wx" }
    );

    const contextDescription = input.context
      ? `A V1 Context was validated for this review: ${resolve(projectRoot, input.context.contextPath)}${input.context.receiptPath ? `; Receipt: ${resolve(projectRoot, input.context.receiptPath)}` : ""}. Read actual sources within the exact section/line scope listed below. The Receipt records a read/preflight operation; it does not prove you understood the outline or materials.`
      : "No V1 Context was supplied. Review only explicitly selected project sources and the current public V1/workspace policy sources listed below. Treat missing project context, outline, canon, chronology, or author intent as not evaluated; do not infer permissions or story facts.";
    const prompt = [
      "# Codex manual review handoff",
      "",
      "You are performing a read-only review for the author. Do not modify any project file, story source, canon, outline, draft, annotation, or V1 state. You may write only the review report at the exact report path below (and an optional companion 意见.json in the same handoff directory).",
      "",
      `Project: ${escapeMarkdown(project.projectRoot)}`,
      `Project relative path: ${escapeMarkdown(projectRelativePath)}`,
      `Workspace: ${escapeMarkdown(workspaceRoot)}`,
      `Review report path: ${escapeMarkdown(reportPath)}`,
      `Handoff directory (the only writable location): ${escapeMarkdown(directory)}`,
      "",
      "## Author's request for this review",
      input.instructions.trim() ||
        "Review the selected material for the author's current question. If the question is underspecified, report the limit and do not invent story facts.",
      "",
      "## Scope and sources",
      contextDescription,
      ...summary.map((source) => {
        const target = sourceTarget(project, source.path);
        const note =
          sourceNotes.get(source.path) ??
          "explicitly selected by the author; authority not inferred";
        return `- ${escapeMarkdown(source.path)} (${escapeMarkdown(note)}; absolute: ${escapeMarkdown(resolve(target.root, target.relativePath))})`;
      }),
      ...(contextMustNotRead.length
        ? [
            "",
            "## V1 sources this task forbids reading",
            ...contextMustNotRead.map((path) => `- ${escapeMarkdown(path)}`)
          ]
        : []),
      ...(contextUnknowns.length
        ? [
            "",
            "## Intentional unknowns: do not fill gaps or treat guesses as facts",
            ...contextUnknowns.map((item) => `- ${escapeMarkdown(item)}`)
          ]
        : []),
      "",
      "## Read the governing V1 navigation",
      "Read the following project-workspace documents as the current workflow and authority rules. Follow their order and project-specific effective sources. Do not treat third-party Skills or reference materials as superior to the project's canon.",
      ...protocolPaths.map((path) => {
        const source = snapshots.find(
          (item) =>
            item.scope === "workspace" &&
            item.path === path.slice("workspace:".length)
        );
        return source
          ? `- ${escapeMarkdown(path)} (snapshotted in this handoff; absolute: ${escapeMarkdown(resolve(workspaceRoot, source.path))})`
          : `- ${escapeMarkdown(path)} (missing; not evaluated)`;
      }),
      ...(notEvaluated.length
        ? [
            "",
            "## Not evaluated",
            ...notEvaluated.map((item) => `- ${escapeMarkdown(item)}`)
          ]
        : []),
      "",
      "Read each selected source as authorized. When a V1 Context provides a specific section or line range, stay within that range; read the full source only when the Context marks it full. Do not rely on filenames, summaries, hashes, Context or Receipt metadata as proof of comprehension. V1 source roles are navigation/authority metadata, not permission to promote third-party references or candidates into story facts. Preserve intentional unknowns; separate established facts, candidate ideas, and advice. Report any required source you could not read as not evaluated.",
      "",
      "## Report format",
      "Write a concise human-readable Markdown report with: review scope; sources actually read; findings with exact source/section evidence; advice separated from hard boundary violations; unresolved or not-evaluated items; and a short conclusion. Do not promote suggestions or hypotheses into canon. Save only to the specified report path."
    ].join("\n");

    await writeFile(join(directory, "交接说明.md"), prompt, { flag: "wx" });
    return {
      handoffId: id,
      directory,
      prompt,
      reportPath,
      sourceSummary: summary
    };
  }

  async readReport(rawInput: {
    handoffId: string;
  }): Promise<OtterManualReport> {
    const { handoffId } = OtterManualReportInputSchema.parse(rawInput);
    const directory = resolve(this.handoffRoot, handoffId);
    try {
      await this.assertManagedPath(this.handoffRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          handoffId,
          status: "no-report",
          markdown: null,
          updatedAt: null
        };
      throw error;
    }
    const userDataReal = await realpath(this.userDataRoot);
    const rootReal = await realpath(this.handoffRoot).catch(() => null);
    if (!rootReal)
      return {
        handoffId,
        status: "no-report",
        markdown: null,
        updatedAt: null
      };
    if (!inRoot(userDataReal, rootReal))
      throw new Error("Manual handoff root escaped application data.");
    const dirReal = await realpath(directory).catch(() => null);
    if (!dirReal || !inRoot(rootReal, dirReal) || dirReal === rootReal)
      return {
        handoffId,
        status: "no-report",
        markdown: null,
        updatedAt: null
      };
    const dirStat = await lstat(directory);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory())
      throw new Error("Manual handoff directory must be a real directory.");
    const manifestPath = join(directory, MANIFEST_NAME);
    const manifestStat = await lstat(manifestPath);
    if (
      manifestStat.isSymbolicLink() ||
      !manifestStat.isFile() ||
      manifestStat.size > 100_000
    )
      throw new Error("Manual handoff metadata is unsafe or too large.");
    const signedManifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as Manifest & { signature?: unknown };
    const { signature, ...manifest } = signedManifest;
    if (
      manifest.schema !== 1 ||
      manifest.id !== handoffId ||
      typeof manifest.projectId !== "string" ||
      typeof manifest.workspaceRoot !== "string" ||
      typeof manifest.projectRoot !== "string" ||
      typeof manifest.projectRelativePath !== "string" ||
      !Array.isArray(manifest.snapshots) ||
      manifest.snapshots.length > 40 ||
      !Array.isArray(manifest.notEvaluated) ||
      !manifest.snapshots.every(
        (item) =>
          typeof item.path === "string" &&
          (item.scope === "project" || item.scope === "workspace") &&
          /^[a-f0-9]{64}$/.test(item.hash) &&
          Number.isSafeInteger(item.bytes) &&
          item.bytes >= 0 &&
          item.bytes <= MAX_SOURCE_BYTES
      )
    )
      throw new Error("Manual handoff metadata is invalid.");
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature))
      throw new Error("Manual handoff integrity signature is missing.");
    const expectedSignature = createHmac("sha256", await this.macKey())
      .update(JSON.stringify(manifest))
      .digest();
    if (!timingSafeEqual(expectedSignature, Buffer.from(signature, "hex")))
      throw new Error("Manual handoff metadata changed after it was created.");
    const currentProject = await this.dependencies.resolveProject(
      manifest.projectId
    );
    if (
      (await realpath(currentProject.workspaceRoot)) !==
        (await realpath(manifest.workspaceRoot)) ||
      (await realpath(currentProject.projectRoot)) !==
        (await realpath(manifest.projectRoot))
    )
      throw new Error(
        "Manual handoff no longer matches the selected project roots."
      );
    const reportPath = join(directory, REPORT_NAME);
    const reportStat = await lstat(reportPath).catch(() => null);
    if (
      reportStat &&
      (reportStat.isSymbolicLink() ||
        !reportStat.isFile() ||
        reportStat.size > MAX_REPORT_BYTES)
    )
      throw new Error(
        "Review report must be a regular Markdown file under 250 KiB."
      );
    const markdown = reportStat ? await readFile(reportPath, "utf8") : null;
    let stale = false;
    for (const source of manifest.snapshots) {
      const path = source.path;
      try {
        const base =
          source.scope === "workspace"
            ? manifest.workspaceRoot
            : manifest.projectRoot;
        const content = await readSafeFile(base, path, MAX_SOURCE_BYTES);
        if (
          content.byteLength !== source.bytes ||
          digest(content) !== source.hash
        ) {
          stale = true;
          break;
        }
      } catch {
        stale = true;
        break;
      }
    }
    return {
      handoffId,
      status: stale ? "stale" : "pending",
      markdown: markdown?.trim() ? markdown : null,
      updatedAt: reportStat ? reportStat.mtime.toISOString() : null
    };
  }
}
