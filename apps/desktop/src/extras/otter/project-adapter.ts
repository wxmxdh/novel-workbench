import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  HiddenBooksSchema,
  type OtterProject,
  type OtterProjectView
} from "@deepwrite/contracts";

export type OtterSourceKind =
  | "canon"
  | "confirmed"
  | "derived-character"
  | "derived-relationship"
  | "plan"
  | "outline"
  | "draft"
  | "jsonl"
  | "project-entry"
  | "other";

export interface OtterSourceRecord {
  path: string;
  kind: OtterSourceKind;
  hash: string;
  bytes: number;
  content?: string;
  status: "current" | "partial" | "stale" | "unverified";
  authority:
    | "canon"
    | "confirmed"
    | "derived"
    | "candidate"
    | "project-entry"
    | "unknown";
  sourceHash?: string;
  coverage?: "partial" | "full";
  reason?: string;
}

export interface OtterProjectSummary {
  id: string;
  relativePath: string;
  displayName: string;
  hasManifest: boolean;
  activeSource?: string;
  canon?: {
    source: string;
    version: string;
    hash: string;
    status: "current" | "stale" | "unverified";
  };
  derived: Array<
    Pick<
      OtterSourceRecord,
      "path" | "kind" | "hash" | "status" | "coverage" | "sourceHash" | "reason"
    >
  >;
  warnings: string[];
}

export interface OtterProjectAdapterOptions {
  maxDepth?: number;
  maxProjects?: number;
  maxEntries?: number;
  maxFileBytes?: number;
}

export type OtterProjectListItem = OtterProject;

export interface OtterProjectDocument {
  id: string;
  path: string;
  title: string;
  category:
    | "entry"
    | "canon"
    | "character"
    | "relationship"
    | "timeline"
    | "workflow"
    | "writing-support"
    | "plan"
    | "draft"
    | "annotation"
    | "concept"
    | "world"
    | "map"
    | "protocol";
  kind?: string;
  volume?: string;
  chapter?: string;
  model?: string;
  outline?: string;
  revision?: string;
  version?: string;
  workbench?: string;
  revisionOf?: string;
  writingRole?: "candidate" | "work";
  importantCheckpoint?: boolean;
  selectedReference?: boolean;
  sourceCount?: number;
  writingSources?: NonNullable<
    OtterProjectView["documents"][number]["writingSources"]
  >;
  status: string;
  readOnly: true;
}

const DEFAULTS = {
  maxDepth: 6,
  maxProjects: 500,
  maxEntries: 8_000,
  maxFileBytes: 2 * 1024 * 1024
};
const MAX_MAP_BYTES = 10_000_000;
interface ManifestRecord {
  project?: string;
  active_source?: string;
  derived_registry?: string;
  entry_sources?: string[];
  canon?: { source?: string; version?: string | number; hash?: string };
  confirmed_sources?: Array<{ path: string; hash?: string }>;
  support_sources?: Array<{
    path: string;
    hash?: string;
    authority?: string;
    scope?: string;
  }>;
}
interface DerivedRecord {
  path: string;
  hash: string;
  source_canon?: string;
  source_hash?: string;
  coverage?: "partial" | "full";
  status?: string;
  dependencies?: Array<{ path: string; hash: string }>;
}
interface DerivedRegistry {
  records?: DerivedRecord[];
}
const EXCLUDED =
  /^(?:archive|archived|archives|history|historical|backup|backups|备份|历史|归档|回滚点|审核材料|实施记录|旧版|旧稿|source|third-party|test|tests|fixtures|fixture|data|node_modules|\.git|\.novel|\.agents|\.codex|06_脚本工具)$/i;
const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const toPosix = (value: string) => value.split(sep).join("/");

type WritingMetadata = Pick<
  OtterProjectDocument,
  | "kind"
  | "volume"
  | "chapter"
  | "model"
  | "outline"
  | "revision"
  | "revisionOf"
> & {
  version?: string;
  workbench?: string;
  status?: string;
  title?: string;
  writingRole?: "candidate" | "work";
};

/** Read only a bounded YAML front matter block; never infer authority from recency. */
function writingMetadata(content: string): WritingMetadata {
  const match = content
    .slice(0, 16_384)
    .match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const metadata: WritingMetadata = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = line.match(
      /^(kind|volume|chapter|model|outline|revision|revision_of|version|workbench|status|title|writing_role):\s*(.*?)\s*$/
    );
    if (!field) continue;
    const value = field[2]!.replace(/^['"]|['"]$/g, "").trim();
    if (value && value.length <= 500) {
      const fieldName =
        field[1] === "revision_of"
          ? "revisionOf"
          : field[1] === "writing_role"
            ? "writingRole"
            : field[1];
      metadata[fieldName as keyof WritingMetadata] = value as never;
    }
  }
  return metadata;
}

function classifyWritingFile(
  path: string,
  metadata: WritingMetadata
): {
  category: "plan" | "draft" | "writing-support";
  metadata: WritingMetadata;
} {
  const name = basename(path);
  const chapter = name.match(/第[0-9零一二三四五六七八九十百千]+章/);
  const volume = name.match(/第[0-9零一二三四五六七八九十百千]+卷/);
  const revision = name.match(/(?:修订|修稿|revision|rev)[ _-]*0*(\d+)/i);
  const explicitModel = name.match(
    /(?:gemini|gpt|deepseek|claude)[-_ ]?[a-z0-9]+(?:[.-][a-z0-9]+)*/i
  );
  const filenameModel = explicitModel?.[0].replace(/\.md$/i, "");
  metadata = {
    ...metadata,
    ...(metadata.chapter || !chapter ? {} : { chapter: chapter[0] }),
    ...(metadata.volume || !volume ? {} : { volume: volume[0] }),
    ...(metadata.revision || !revision
      ? {}
      : { revision: `修订${revision[1]}` }),
    ...(metadata.revision ||
    !metadata.version ||
    !/修订|修稿|revision|rev/i.test(metadata.version)
      ? {}
      : { revision: metadata.version }),
    ...(metadata.model || !filenameModel ? {} : { model: filenameModel }),
    ...(metadata.model || metadata.workbench !== "novel-author-candidate-v1"
      ? {}
      : { model: "unknown" })
  };
  if (metadata.revisionOf && !metadata.revision)
    metadata.revision = metadata.version ?? "修订";
  const normalizedKind = metadata.kind?.toLowerCase();
  if (["draft", "正文", "prose"].includes(normalizedKind ?? ""))
    return { category: "draft", metadata };
  if (["outline", "plan", "大纲"].includes(normalizedKind ?? ""))
    return { category: "plan", metadata };
  if (/提示词|prompt|审阅|审查|回执|receipt|交接|review|复盘/i.test(name))
    return { category: "writing-support", metadata };
  if (/正文|草稿|draft/i.test(name)) return { category: "draft", metadata };
  if (/大纲|outline|plan/i.test(name)) return { category: "plan", metadata };
  return { category: "writing-support", metadata };
}

function inRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

function sameDirectory(left: string, right: string): boolean {
  const leftPath = resolve(left).replace(/[\\/]+$/u, "");
  const rightPath = resolve(right).replace(/[\\/]+$/u, "");
  return process.platform === "win32"
    ? leftPath.toLocaleLowerCase("en-US") ===
        rightPath.toLocaleLowerCase("en-US")
    : leftPath === rightPath;
}

async function regularPath(
  root: string,
  relPath: string,
  maxBytes: number
): Promise<string> {
  if (
    !relPath ||
    isAbsolute(relPath) ||
    relPath.split(/[\\/]/).some((part) => part === ".." || part === ".")
  )
    throw new Error(
      `Project path must be a normalized relative path: ${relPath}`
    );
  const abs = resolve(root, relPath);
  if (!inRoot(root, abs))
    throw new Error(`Project path escapes selected root: ${relPath}`);
  let cursor = root;
  for (const part of relPath.split(/[\\/]/)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink())
      throw new Error(
        `Symbolic links are not readable through Otter: ${relPath}`
      );
  }
  const real = await realpath(abs);
  if (!inRoot(root, real))
    throw new Error(`Resolved project path escapes selected root: ${relPath}`);
  const stat = await lstat(real);
  if (!stat.isFile()) throw new Error(`Not a regular file: ${relPath}`);
  if (stat.size > maxBytes)
    throw new Error(
      `File exceeds Otter read limit (${maxBytes} bytes): ${relPath}`
    );
  return real;
}

async function safeJson(
  root: string,
  relPath: string,
  maxBytes: number
): Promise<unknown | null> {
  try {
    const file = await regularPath(root, relPath, maxBytes);
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceList(value: unknown): value is Array<{
  path: string;
  hash?: string;
  authority?: string;
  scope?: string;
}> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.path === "string" &&
        (item.hash === undefined || typeof item.hash === "string") &&
        (item.authority === undefined || typeof item.authority === "string") &&
        (item.scope === undefined || typeof item.scope === "string")
    )
  );
}

function isManifestRecord(value: unknown): value is ManifestRecord {
  if (!isRecord(value)) return false;
  if (value.project !== undefined && typeof value.project !== "string")
    return false;
  if (
    value.active_source !== undefined &&
    typeof value.active_source !== "string"
  )
    return false;
  if (
    value.derived_registry !== undefined &&
    typeof value.derived_registry !== "string"
  )
    return false;
  if (
    value.entry_sources !== undefined &&
    (!Array.isArray(value.entry_sources) ||
      !value.entry_sources.every((item) => typeof item === "string"))
  )
    return false;
  if (
    value.confirmed_sources !== undefined &&
    !isSourceList(value.confirmed_sources)
  )
    return false;
  if (
    value.support_sources !== undefined &&
    !isSourceList(value.support_sources)
  )
    return false;
  if (value.canon !== undefined) {
    if (!isRecord(value.canon)) return false;
    if (
      value.canon.source !== undefined &&
      typeof value.canon.source !== "string"
    )
      return false;
    if (value.canon.hash !== undefined && typeof value.canon.hash !== "string")
      return false;
    if (
      value.canon.version !== undefined &&
      typeof value.canon.version !== "string" &&
      typeof value.canon.version !== "number"
    )
      return false;
  }
  return true;
}

function isDerivedRegistry(value: unknown): value is DerivedRegistry {
  return (
    isRecord(value) &&
    (value.records === undefined ||
      (Array.isArray(value.records) &&
        value.records.every(
          (record) =>
            isRecord(record) &&
            typeof record.path === "string" &&
            typeof record.hash === "string" &&
            (record.source_canon === undefined ||
              typeof record.source_canon === "string") &&
            (record.source_hash === undefined ||
              typeof record.source_hash === "string") &&
            (record.status === undefined ||
              typeof record.status === "string") &&
            (record.coverage === undefined ||
              record.coverage === "partial" ||
              record.coverage === "full") &&
            (record.dependencies === undefined ||
              (Array.isArray(record.dependencies) &&
                record.dependencies.every(
                  (dep) =>
                    isRecord(dep) &&
                    typeof dep.path === "string" &&
                    typeof dep.hash === "string"
                )))
        )))
  );
}

async function readManifest(
  root: string,
  relPath: string,
  maxBytes: number
): Promise<ManifestRecord | null> {
  const value = await safeJson(root, relPath, maxBytes);
  return value && isManifestRecord(value) ? value : null;
}

async function readRegistry(
  root: string,
  relPath: string,
  maxBytes: number
): Promise<DerivedRegistry | null> {
  const value = await safeJson(root, relPath, maxBytes);
  return value && isDerivedRegistry(value) ? value : null;
}

function kindFor(path: string, role?: string): OtterSourceKind {
  const p = path.toLowerCase();
  if (/concept|构想|情节想法/.test(p)) return "other";
  if (/world|世界观|设定/.test(p)) return "other";
  if (/map|地图|地理/.test(p)) return "other";
  if (role === "canon" || (/active-source|canon/.test(p) && !/derived/.test(p)))
    return "canon";
  if (role === "confirmed" || role === "later-evidence") return "confirmed";
  if (/relationship|关系/.test(p)) return "derived-relationship";
  if (/character|人物|角色/.test(p)) return "derived-character";
  if (/(^|\/)\.novel\/plans\//.test(p)) return "plan";
  if (/outline|大纲|骨架/.test(p)) return "outline";
  if (/\.jsonl$/i.test(p)) return "jsonl";
  if (/draft|正文|写作中/.test(p)) return "draft";
  if (/agents\.md$|\.rules\//.test(p)) return "project-entry";
  return "other";
}

function excluded(name: string, includeHistoricalWriting = false): boolean {
  if (
    includeHistoricalWriting &&
    /^(?:archive|archived|archives|history|historical|backup|backups|备份|历史|归档|旧版|旧稿)$/i.test(
      name
    )
  )
    return false;
  return (
    EXCLUDED.test(name) || /backup|history|archive|备份|历史|归档/i.test(name)
  );
}

/** Read-only adapter for user-selected, file-backed Otter projects. All IDs are explicitly device-local. */
export class OtterProjectAdapter {
  private readonly limits: typeof DEFAULTS;
  private readonly workspaceRoot: string;
  /** Kept as a boundary for future local cache use; no project files are cached or changed. */
  readonly userDataPath: string;
  private projectsById = new Map<string, OtterProjectSummary>();

  constructor(
    workspaceRoot: string,
    userDataPath: string,
    options: OtterProjectAdapterOptions = {}
  ) {
    if (!workspaceRoot.trim() || !userDataPath.trim())
      throw new Error(
        "Otter requires a selected workspace root and user data path."
      );
    this.workspaceRoot = resolve(workspaceRoot);
    this.userDataPath = resolve(userDataPath);
    this.limits = { ...DEFAULTS, ...options };
  }

  async listProjects(): Promise<OtterProjectListItem[]> {
    const summaries = await this.discover(this.workspaceRoot);
    this.projectsById = new Map(
      summaries.map((project) => [project.id, project])
    );
    const workspace = await realpath(this.workspaceRoot);
    const protocolStat = await lstat(
      join(workspace, ".novel", "protocol", "task-routing.md")
    ).catch(() => null);
    const hasProtocol = Boolean(
      protocolStat?.isFile() && !protocolStat.isSymbolicLink()
    );
    return summaries.map((project) => ({
      id: project.id,
      title: project.displayName,
      relativePath: project.relativePath,
      hasProtocol: project.hasManifest && hasProtocol,
      identityScope: "device-local"
    }));
  }

  async openProject(projectId: string): Promise<{
    project: OtterProjectListItem;
    activeSource: string | null;
    documents: OtterProjectDocument[];
    protocolSummary: Record<string, unknown>;
  }> {
    const summary = this.projectsById.get(projectId);
    if (!summary)
      throw new Error(
        "Project is not in the current selected-workspace catalog; refresh the list first."
      );
    const workspace = await realpath(this.workspaceRoot);
    const root = await realpath(resolve(workspace, summary.relativePath));
    if (!inRoot(workspace, root))
      throw new Error(
        "Selected project resolved outside the selected workspace."
      );
    const manifest = await readManifest(
      root,
      ".novel/project.json",
      this.limits.maxFileBytes
    );
    const protocolStat = await lstat(
      join(workspace, ".novel", "protocol", "task-routing.md")
    ).catch(() => null);
    const listedProject: OtterProjectListItem = {
      id: summary.id,
      title: summary.displayName,
      relativePath: summary.relativePath,
      hasProtocol:
        summary.hasManifest &&
        Boolean(protocolStat?.isFile() && !protocolStat.isSymbolicLink()),
      identityScope: "device-local"
    };
    const documents: OtterProjectDocument[] = [];
    const seen = new Set<string>();
    const writingCatalog = await safeJson(
      root,
      ".novel/notes/writing/catalog.json",
      this.limits.maxFileBytes
    );
    const catalogRecord = isRecord(writingCatalog) ? writingCatalog : undefined;
    const catalogRecords = Array.isArray(catalogRecord?.records)
      ? catalogRecord.records.filter(isRecord)
      : [];
    const catalogSelections = Array.isArray(catalogRecord?.selections)
      ? catalogRecord.selections.filter(isRecord)
      : [];
    const add = async (
      path: string,
      category: OtterProjectDocument["category"],
      status = "current",
      maxBytes = this.limits.maxFileBytes
    ) => {
      if (seen.has(path)) {
        // A manifest source keeps its authority/status, while the navigation
        // category may still be refined by writing metadata and filename.
        const existing = documents.find((document) => document.path === path);
        if (
          existing?.category === "canon" &&
          (category === "plan" || category === "draft")
        )
          existing.category = category;
        return;
      }
      if (documents.length >= 20_000) return;
      try {
        await regularPath(root, path, maxBytes);
      } catch {
        return;
      }
      seen.add(path);
      documents.push({
        id: `${projectId}#${path}`,
        path,
        title: basename(path),
        category,
        status,
        readOnly: true
      });
    };
    for (const path of manifest?.entry_sources ?? ["AGENTS.md"])
      if (path !== manifest?.active_source) await add(path, "entry");
    if (manifest?.active_source) await add(manifest.active_source, "entry");
    if (manifest?.canon?.source)
      await add(
        manifest.canon.source,
        "canon",
        summary.canon?.status ?? "unverified"
      );
    for (const record of summary.derived) {
      const category =
        record.kind === "derived-relationship" ? "relationship" : "character";
      await add(record.path, category, record.status);
    }
    for (const source of [
      ...(manifest?.confirmed_sources ?? []),
      ...(manifest?.support_sources ?? [])
    ])
      await add(source.path, "canon");
    const plans = await this.listFiles(root, ".novel/plans", /\.json$/i);
    for (const path of plans) await add(path, "workflow", "candidate");
    const dynamicRoots: Array<[string, OtterProjectDocument["category"]]> = [
      ["timeline", "timeline"],
      [".novel/notes/concepts", "concept"],
      [".novel/notes/writing", "writing-support"],
      [".novel/notes/world", "world"],
      [".novel/notes/maps", "map"],
      ["创作构想", "concept"],
      ["世界观", "world"],
      ["地图", "map"],
      ["004_写作中", "writing-support"],
      ["006_批注", "annotation"]
    ];
    for (const [dir, category] of dynamicRoots) {
      for (const path of await this.listFiles(
        root,
        dir,
        category === "timeline"
          ? /\.(?:md|jsonl)$/i
          : category === "map"
            ? /\.(?:md|png|jpe?g|webp)$/i
            : /\.md$/i,
        dir === "004_写作中"
      )) {
        if (
          (dir === "004_写作中" || dir === ".novel/notes/writing") &&
          /\.md$/i.test(path)
        ) {
          try {
            const absolute = await regularPath(
              root,
              path,
              this.limits.maxFileBytes
            );
            const text = await readFile(absolute, "utf8");
            const metadata = writingMetadata(text);
            const classified = classifyWritingFile(path, metadata);
            await add(
              path,
              classified.category,
              metadata.status === "author-candidate" ? "candidate" : "current"
            );
            const document = documents.find((item) => item.path === path);
            if (document) {
              const { status: _authorStatus, ...displayMetadata } =
                classified.metadata;
              Object.assign(document, displayMetadata);
              // YAML's author-candidate is a writing-workbench marker, while
              // the document status vocabulary is current/candidate/stale.
              if (metadata.status === "author-candidate")
                document.status = "candidate";
              if (
                metadata.status === "author-candidate" ||
                metadata.status === "author-work-draft" ||
                (path.startsWith("004_写作中/") &&
                  metadata.workbench === "novel-draft-v1" &&
                  metadata.kind === "draft")
              ) {
                document.writingRole =
                  metadata.writingRole === "work" ||
                  metadata.status === "author-work-draft"
                    ? "work"
                    : "candidate";
                if (metadata.workbench === "novel-draft-v1")
                  document.writingRole = "candidate";
                if (document.writingRole === "work")
                  document.status = "work-draft";
                const fileHash = sha256(text);
                const catalogEntry = catalogRecords.find(
                  (entry) =>
                    entry.path === path &&
                    entry.hash === fileHash &&
                    Array.isArray(entry.sources)
                );
                if (catalogEntry && Array.isArray(catalogEntry.sources)) {
                  document.writingSources = catalogEntry.sources
                    .filter(isRecord)
                    .flatMap((source) => {
                      if (
                        typeof source.title !== "string" ||
                        typeof source.model !== "string" ||
                        typeof source.version !== "string" ||
                        typeof source.savedAt !== "string"
                      )
                        return [];
                      return [
                        {
                          title: source.title,
                          model: source.model,
                          version: source.version,
                          ...(typeof source.outline === "string"
                            ? { outline: source.outline }
                            : {}),
                          ...(typeof source.revisionOf === "string"
                            ? { revisionOf: source.revisionOf }
                            : {}),
                          savedAt: source.savedAt
                        }
                      ];
                    });
                  if (document.writingSources.length > 0)
                    document.sourceCount = document.writingSources.length;
                }
                if (catalogEntry?.important === true)
                  document.importantCheckpoint = true;
                document.selectedReference = catalogSelections.some(
                  (selection) =>
                    selection.path === path &&
                    selection.hash === fileHash &&
                    selection.kind ===
                      (metadata.kind === "outline" ? "outline" : "draft") &&
                    selection.volume === metadata.volume &&
                    Number(selection.chapter) === Number(metadata.chapter)
                );
              }
            }
          } catch {
            /* Unreadable sources remain omitted from the read-only catalogue. */
          }
        } else {
          await add(
            path,
            category,
            dir.startsWith(".novel/notes/") ? "candidate" : "current",
            category === "map" && /\.(?:png|jpe?g|webp)$/i.test(path)
              ? MAX_MAP_BYTES
              : this.limits.maxFileBytes
          );
        }
      }
    }
    for (const path of [
      ".novel/protocol/authority.md",
      ".novel/protocol/task-routing.md",
      ".novel/protocol/context-policy.md",
      ".novel/protocol/chapter-workflow.md",
      ".novel/protocol/canon-policy.md",
      ".novel/protocol/review-policy.md",
      ".novel/protocol/skill-permissions.md",
      ".novel/protocol/third-party-policy.md"
    ]) {
      try {
        await regularPath(workspace, path, this.limits.maxFileBytes);
        documents.push({
          id: `${projectId}#workspace:${path}`,
          path: `workspace:${path}`,
          title: basename(path),
          category: "protocol",
          status: "current",
          readOnly: true
        });
      } catch {
        /* protocol files are optional only for legacy projects */
      }
    }
    return {
      project: listedProject,
      activeSource: summary.activeSource ?? null,
      documents,
      protocolSummary: {
        identityScope: "device-local",
        manifest: Boolean(manifest),
        canon: summary.canon ?? null,
        derived: summary.derived.map(({ path, status, coverage, reason }) => ({
          path,
          status,
          coverage,
          reason
        })),
        warnings: summary.warnings
      }
    };
  }

  async readDocument(
    projectId: string,
    path: string
  ): Promise<{ path: string; content: string; hash: string }> {
    const summary = this.projectsById.get(projectId);
    if (!summary)
      throw new Error(
        "Project is not in the current selected-workspace catalog; refresh the list first."
      );
    if (path.startsWith("workspace:")) {
      const workspace = await realpath(this.workspaceRoot);
      const rel = path.slice("workspace:".length);
      const file = await regularPath(workspace, rel, this.limits.maxFileBytes);
      const bytes = await readFile(file);
      return { path, content: bytes.toString("utf8"), hash: sha256(bytes) };
    }
    const workspace = await realpath(this.workspaceRoot);
    const root = await realpath(resolve(workspace, summary.relativePath));
    if (!inRoot(workspace, root))
      throw new Error(
        "Selected project resolved outside the selected workspace."
      );
    const file = await regularPath(root, path, this.limits.maxFileBytes);
    const bytes = await readFile(file);
    return { path, content: bytes.toString("utf8"), hash: sha256(bytes) };
  }

  /** Core registration can locate a declared entry before its manifest exists. */
  async resolveProjectRegistrationDirectory(relativePath: string): Promise<{
    workspaceRoot: string;
    projectRoot: string;
    relativePath: string;
  }> {
    const workspaceRoot = await realpath(this.workspaceRoot);
    const normalized = toPosix(relativePath);
    if (
      isAbsolute(relativePath) ||
      normalized
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Project registration requires a relative directory.");
    const projectRoot = await this.resolveNonSymlinkDirectory(
      workspaceRoot,
      resolve(workspaceRoot, relativePath)
    );
    if (!projectRoot)
      throw new Error("Project registration directory is missing or unsafe.");
    await regularPath(projectRoot, "AGENTS.md", this.limits.maxFileBytes);
    const projectId = `otter_${sha256(normalized).slice(0, 16)}`;
    await this.assertNotDeleting(projectId, workspaceRoot, projectRoot);
    return { workspaceRoot, projectRoot, relativePath: normalized };
  }

  async resolveProject(projectId: string): Promise<{
    workspaceRoot: string;
    projectRoot: string;
    relativePath: string;
    summary: OtterProjectSummary;
  }> {
    const summary = this.projectsById.get(projectId);
    if (!summary)
      throw new Error(
        "Project is not in the current selected-workspace catalog; refresh the list first."
      );
    const workspaceRoot = await realpath(this.workspaceRoot);
    const projectRoot = await realpath(
      resolve(workspaceRoot, summary.relativePath)
    );
    if (!inRoot(workspaceRoot, projectRoot))
      throw new Error(
        "Selected project resolved outside the selected workspace."
      );
    await this.assertNotDeleting(projectId, workspaceRoot, projectRoot);
    return {
      workspaceRoot,
      projectRoot,
      relativePath: summary.relativePath,
      summary
    };
  }

  private async assertNotDeleting(
    projectId: string,
    workspaceRoot: string,
    projectRoot: string
  ): Promise<void> {
    let hidden: ReturnType<typeof HiddenBooksSchema.parse>;
    try {
      hidden = HiddenBooksSchema.parse(
        JSON.parse(
          await readFile(
            join(this.userDataPath, "config", "hidden-books.json"),
            "utf8"
          )
        )
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const pending = hidden.some(
      (book) =>
        book.kind === "external" &&
        book.deletePending &&
        book.id === projectId &&
        book.workspaceRoot !== undefined &&
        sameDirectory(book.workspaceRoot, workspaceRoot) &&
        sameDirectory(book.projectDirectory, projectRoot)
    );
    if (pending)
      throw new Error("本书正在永久删除，拒绝使用旧工作区缓存执行操作。");
  }

  private async listFiles(
    root: string,
    relDir: string,
    filter: RegExp,
    includeHistoricalWriting = false
  ): Promise<string[]> {
    const start = join(root, relDir);
    const startInfo = await lstat(start).catch(() => null);
    if (!startInfo?.isDirectory() || startInfo.isSymbolicLink()) return [];
    const out: string[] = [];
    const queue = [start];
    let visited = 0;
    while (
      queue.length &&
      out.length < this.limits.maxEntries &&
      visited < this.limits.maxEntries
    ) {
      const dir = queue.shift()!;
      visited++;
      const entries = await readdir(dir, { withFileTypes: true }).catch(
        () => []
      );
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const abs = join(dir, entry.name);
        if (
          entry.isDirectory() &&
          !excluded(entry.name, includeHistoricalWriting)
        )
          queue.push(abs);
        else if (entry.isFile() && filter.test(entry.name))
          out.push(toPosix(relative(root, abs)));
      }
    }
    return out.sort();
  }

  async discover(workspaceRoot: string): Promise<OtterProjectSummary[]> {
    const root = await realpath(resolve(workspaceRoot));
    if (!(await lstat(root)).isDirectory())
      throw new Error("Selected workspace root is not a directory.");
    const centralPath = join(root, "00_创作项目", "项目");
    const central = await lstat(centralPath).catch(() => null);
    if (central?.isDirectory() && !central.isSymbolicLink()) {
      const safeCentral = await this.resolveNonSymlinkDirectory(
        root,
        centralPath
      );
      if (safeCentral) return this.discoverDirectProjects(root, safeCentral);
    }
    const found: OtterProjectSummary[] = [];
    const queue: Array<{ dir: string; depth: number }> = [
      { dir: root, depth: 0 }
    ];
    let visited = 0;
    while (
      queue.length &&
      found.length < this.limits.maxProjects &&
      visited < this.limits.maxEntries
    ) {
      const current = queue.shift()!;
      visited++;
      const novelDirectory = await lstat(join(current.dir, ".novel")).catch(
        () => null
      );
      const manifestPath = join(current.dir, ".novel", "project.json");
      const manifestStat =
        novelDirectory?.isDirectory() && !novelDirectory.isSymbolicLink()
          ? await lstat(manifestPath).catch(() => null)
          : null;
      const manifest =
        manifestStat?.isFile() && !manifestStat.isSymbolicLink()
          ? await readManifest(
              root,
              toPosix(relative(root, manifestPath)),
              this.limits.maxFileBytes
            )
          : null;
      const entryStat = await lstat(join(current.dir, "AGENTS.md")).catch(
        () => null
      );
      const rulesStat = await lstat(join(current.dir, ".rules")).catch(
        () => null
      );
      const relPath = toPosix(relative(root, current.dir)) || ".";
      const isWorkspaceRoot = current.depth === 0;
      const writerEntry = await this.hasWriterEntry(current.dir);
      const isProject =
        Boolean(manifest) ||
        (!isWorkspaceRoot &&
          rulesStat?.isDirectory() &&
          (entryStat?.isFile() || writerEntry));
      if (isProject)
        found.push(
          await this.summarize(
            root,
            current.dir,
            relPath,
            manifest ?? undefined
          )
        );
      if (current.depth >= this.limits.maxDepth) continue;
      let entries;
      try {
        entries = await readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          excluded(entry.name)
        )
          continue;
        const next = join(current.dir, entry.name);
        const resolved = await realpath(next).catch(() => null);
        if (resolved && inRoot(root, resolved))
          queue.push({ dir: resolved, depth: current.depth + 1 });
      }
    }
    return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  private async resolveNonSymlinkDirectory(
    root: string,
    target: string
  ): Promise<string | null> {
    const rel = relative(root, target);
    let cursor = root;
    for (const part of rel.split(sep).filter(Boolean)) {
      cursor = join(cursor, part);
      const stat = await lstat(cursor).catch(() => null);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) return null;
    }
    const real = await realpath(target).catch(() => null);
    return real && inRoot(root, real) ? real : null;
  }

  private async hasWriterEntry(dir: string): Promise<boolean> {
    for (const name of ["README_写作入口.md", "agent-start.md", "README.md"]) {
      const stat = await lstat(join(dir, name)).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) return true;
    }
    return false;
  }

  private async discoverDirectProjects(
    workspace: string,
    central: string
  ): Promise<OtterProjectSummary[]> {
    const found: OtterProjectSummary[] = [];
    const entries = await readdir(central, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        excluded(entry.name)
      )
        continue;
      if (found.length >= this.limits.maxProjects) break;
      const projectRoot = join(central, entry.name);
      const safeRoot = await this.resolveNonSymlinkDirectory(
        workspace,
        projectRoot
      );
      if (!safeRoot) continue;
      const novelDirectory = await lstat(join(safeRoot, ".novel")).catch(
        () => null
      );
      const manifestStat =
        novelDirectory?.isDirectory() && !novelDirectory.isSymbolicLink()
          ? await lstat(join(safeRoot, ".novel", "project.json")).catch(
              () => null
            )
          : null;
      const manifest =
        manifestStat?.isFile() && !manifestStat.isSymbolicLink()
          ? await readManifest(
              workspace,
              toPosix(
                relative(workspace, join(safeRoot, ".novel", "project.json"))
              ),
              this.limits.maxFileBytes
            )
          : null;
      const agents = await lstat(join(safeRoot, "AGENTS.md")).catch(() => null);
      const rules = await lstat(join(safeRoot, ".rules")).catch(() => null);
      const isLegacy =
        rules?.isDirectory() &&
        !rules.isSymbolicLink() &&
        ((agents?.isFile() && !agents.isSymbolicLink()) ||
          (await this.hasWriterEntry(safeRoot)));
      if (!manifest && !isLegacy) continue;
      found.push(
        await this.summarize(
          workspace,
          safeRoot,
          toPosix(relative(workspace, safeRoot)),
          manifest ?? undefined
        )
      );
    }
    return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  async summarize(
    workspaceRoot: string,
    projectPath: string,
    relativePath?: string,
    suppliedManifest?: ManifestRecord
  ): Promise<OtterProjectSummary> {
    const workspace = await realpath(resolve(workspaceRoot));
    const root = await realpath(resolve(projectPath));
    if (!inRoot(workspace, root))
      throw new Error(
        "Selected project must remain inside the selected workspace root."
      );
    const rel = toPosix(relativePath ?? (relative(workspace, root) || "."));
    const manifest =
      suppliedManifest ??
      (await readManifest(
        root,
        ".novel/project.json",
        this.limits.maxFileBytes
      ));
    const warnings: string[] = [];
    let activeSource: string | undefined;
    let canon: OtterProjectSummary["canon"];
    const derived: OtterProjectSummary["derived"] = [];
    if (manifest) {
      if (typeof manifest.active_source === "string")
        activeSource = manifest.active_source;
      if (manifest.canon?.source && manifest.canon?.hash) {
        let status: "current" | "stale" | "unverified";
        try {
          const file = await regularPath(
            root,
            manifest.canon.source,
            this.limits.maxFileBytes
          );
          status =
            sha256(await readFile(file)) === manifest.canon.hash
              ? "current"
              : "stale";
        } catch (error) {
          status = "stale";
          warnings.push(
            `Canon source unavailable: ${(error as Error).message}`
          );
        }
        if (status === "stale")
          warnings.push(
            "Manifest canon hash does not match the current source."
          );
        canon = {
          source: manifest.canon.source,
          version: String(manifest.canon.version ?? "unknown"),
          hash: manifest.canon.hash,
          status
        };
      }
      const registryPath =
        manifest.derived_registry ?? ".novel/derived-registry.json";
      const registry = await readRegistry(
        root,
        registryPath,
        this.limits.maxFileBytes
      );
      for (const record of registry?.records ?? []) {
        const sourcePath = record.source_canon ?? manifest.canon?.source;
        let status: "current" | "partial" | "stale" | "unverified" =
          record.coverage === "partial" ? "partial" : "unverified";
        let reason: string | undefined;
        try {
          const derivedFile = await regularPath(
            root,
            record.path,
            this.limits.maxFileBytes
          );
          const bytes = await readFile(derivedFile);
          if (sha256(bytes) !== record.hash) {
            status = "stale";
            reason = "Derived file hash changed.";
          }
          if (sourcePath) {
            const sourceFile = await regularPath(
              root,
              sourcePath,
              this.limits.maxFileBytes
            );
            const sourceHash = sha256(await readFile(sourceFile));
            if (sourceHash !== (record.source_hash ?? manifest.canon?.hash)) {
              status = "stale";
              reason = "Source canon hash changed.";
            }
          }
          if (record.status !== "current") {
            status = "stale";
            reason ??= "Registry marks this record stale or unverified.";
          }
          for (const dep of record.dependencies ?? []) {
            const depFile = await regularPath(
              root,
              dep.path,
              this.limits.maxFileBytes
            );
            if (sha256(await readFile(depFile)) !== dep.hash) {
              status = "stale";
              reason = `Dependency changed: ${dep.path}`;
              break;
            }
          }
        } catch (error) {
          status = "stale";
          reason = (error as Error).message;
        }
        derived.push({
          path: record.path,
          kind: kindFor(record.path),
          hash: record.hash,
          status,
          ...(record.coverage ? { coverage: record.coverage } : {}),
          ...(record.source_hash ? { sourceHash: record.source_hash } : {}),
          ...(reason ? { reason } : {})
        });
      }
    } else {
      warnings.push(
        "No .novel/project.json; project is identified only from local AGENTS/.rules markers."
      );
    }
    const id = `otter_${sha256(rel).slice(0, 16)}`;
    return {
      id,
      relativePath: rel,
      displayName: manifest?.project ?? basename(root),
      hasManifest: Boolean(manifest),
      ...(activeSource ? { activeSource } : {}),
      ...(canon ? { canon } : {}),
      derived,
      warnings
    };
  }

  async readSource(
    workspaceRoot: string,
    projectRelativePath: string,
    sourceRelativePath: string
  ): Promise<OtterSourceRecord> {
    const workspace = await realpath(resolve(workspaceRoot));
    const projectRoot = await realpath(resolve(workspace, projectRelativePath));
    if (!inRoot(workspace, projectRoot))
      throw new Error("Project is outside the selected workspace.");
    const file = await regularPath(
      projectRoot,
      sourceRelativePath,
      this.limits.maxFileBytes
    );
    const bytes = await readFile(file);
    const text = bytes.toString("utf8");
    const manifest = await readManifest(
      projectRoot,
      ".novel/project.json",
      this.limits.maxFileBytes
    );
    const registry = await readRegistry(
      projectRoot,
      manifest?.derived_registry ?? ".novel/derived-registry.json",
      this.limits.maxFileBytes
    );
    const rec = registry?.records?.find(
      (item) => item.path === sourceRelativePath
    );
    const candidateMetadata = sourceRelativePath.startsWith(
      ".novel/notes/writing/"
    )
      ? writingMetadata(text)
      : {};
    const writingMetadataForPath =
      sourceRelativePath.startsWith("004_写作中/") ||
      sourceRelativePath.startsWith(".novel/notes/writing/")
        ? writingMetadata(text)
        : {};
    const isAuthorCandidate =
      candidateMetadata.workbench === "novel-author-candidate-v1" &&
      (candidateMetadata.status === "author-candidate" ||
        candidateMetadata.status === "author-work-draft");
    const writingCategory =
      sourceRelativePath.startsWith("004_写作中/") || isAuthorCandidate
        ? classifyWritingFile(sourceRelativePath, writingMetadataForPath)
            .category
        : undefined;
    const role =
      sourceRelativePath === manifest?.canon?.source
        ? "canon"
        : (manifest?.confirmed_sources ?? []).some(
              (x) => x.path === sourceRelativePath
            )
          ? "confirmed"
          : undefined;
    let status: OtterSourceRecord["status"] =
      rec?.coverage === "partial" ? "partial" : "current";
    let reason: string | undefined;
    if (rec) {
      if (rec.hash !== sha256(bytes) || rec.status !== "current") {
        status = "stale";
        reason = "Derived record hash/status is stale.";
      }
      if (rec.source_canon) {
        const source = await regularPath(
          projectRoot,
          rec.source_canon,
          this.limits.maxFileBytes
        );
        if (sha256(await readFile(source)) !== rec.source_hash) {
          status = "stale";
          reason = "Derived source hash has changed.";
        }
      }
    }
    const authority: OtterSourceRecord["authority"] =
      role === "canon"
        ? "canon"
        : role === "confirmed"
          ? "confirmed"
          : rec
            ? "derived"
            : isAuthorCandidate
              ? "candidate"
              : /\.novel\/plans\//.test(sourceRelativePath)
                ? "candidate"
                : "unknown";
    return {
      path: sourceRelativePath,
      kind:
        writingCategory === "plan" || writingCategory === "draft"
          ? writingCategory
          : kindFor(sourceRelativePath, role),
      hash: sha256(bytes),
      bytes: bytes.byteLength,
      content: text,
      status,
      authority,
      ...(rec?.source_hash ? { sourceHash: rec.source_hash } : {}),
      ...(rec?.coverage ? { coverage: rec.coverage } : {}),
      ...(reason ? { reason } : {})
    };
  }
}

export const OTTER_PROJECT_DEFAULT_LIMITS = Object.freeze({ ...DEFAULTS });
