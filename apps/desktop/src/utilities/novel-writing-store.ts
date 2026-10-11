import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import {
  OtterSaveWritingInputSchema,
  OtterSettingsSchema,
  LongPrepareComparisonDraftInputSchema,
  LongPrepareComparisonDraftResultSchema,
  LongDeliverComparisonDraftInputSchema,
  LongDeliverComparisonDraftResultSchema,
  OtterSelectWritingInputSchema,
  type OtterSaveWritingInput
} from "@deepwrite/contracts";
import type {
  LongPrepareComparisonDraftInput,
  LongDeliverComparisonDraftInput
} from "@deepwrite/contracts";
import { OtterProjectAdapter } from "../extras/otter/project-adapter";
import { withExternalProjectLock } from "./external-project-operations";
import {
  registerNativeComparison,
  type NativeComparisonSource
} from "./native-comparison-registration";

const safeName = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .slice(0, 50) || "unknown";
const quote = (value: string) => JSON.stringify(value);
const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const LOVE_PROJECT_PATH = "00_创作项目/项目/LOVE";
const WRITING_CATALOG_PATH = ".novel/notes/writing/catalog.json";

interface WritingSource {
  title: string;
  model: string;
  version: string;
  outline?: string;
  revisionOf?: string;
  revisionOfHash?: string;
  changeSummary?: string;
  savedAt: string;
}
interface WritingCatalogRecord {
  path: string;
  hash: string;
  contentHash: string;
  kind: "outline" | "draft";
  volume: string;
  chapter: number;
  sources: WritingSource[];
  nativeScope?: { bookId: string; chapterCardId: string };
  important?: boolean;
}
interface WritingCatalogSelection {
  kind: "outline" | "draft";
  volume: string;
  chapter: number;
  path: string;
  hash: string;
  nativeScope?: { bookId: string; chapterCardId: string };
}
interface WritingCatalog {
  schemaVersion: 1;
  records: WritingCatalogRecord[];
  selections: WritingCatalogSelection[];
}
import {
  prepareComparisonCli,
  deliverComparisonCli,
  type ComparisonCliPreparation
} from "./comparison-cli-bridge";

const preparationTtlMs = 30 * 60_000;

interface ComparisonDraftPreparation {
  preparationId: string;
  authorizationId: string;
  workspaceRoot: string;
  projectId: string;
  projectRoot: string;
  projectName: string;
  chapter: number;
  chapterCardId: string;
  cardTitle: string;
  cardContent: string;
  cardHash: string;
  volumeId: string;
  volumeLabel: string;
  volumeContent: string;
  volumeHash: string;
  selectedOutline: {
    path: string;
    hash: string;
    version: string;
    content: string;
    selectionEvidence: { path: string; sha256: string; quote: string };
  };
  volumeEvidence: { path: string; sha256: string; quote: string };
  authorRequestId: string;
  authorRequestQuote: string;
  cli: ComparisonCliPreparation;
  nativeEvidenceHash?: string;
  expiresAt: number;
}

const comparisonDraftPreparations = new Map<
  string,
  ComparisonDraftPreparation
>();

/** Narrow read-only view used by the LOVE local-revision Core path. */
export function getLoveComparisonPreparation(
  preparationId: string,
  authorizationId: string
) {
  const prepared = comparisonDraftPreparations.get(preparationId);
  if (
    !prepared ||
    prepared.expiresAt <= Date.now() ||
    prepared.authorizationId !== authorizationId
  )
    throw new Error("本轮比较写作准备记录缺失、过期或不属于当前作者授权。");
  return {
    workspaceRoot: prepared.workspaceRoot,
    projectId: prepared.projectId,
    projectRoot: prepared.projectRoot,
    chapter: prepared.chapter,
    chapterCardId: prepared.chapterCardId,
    volumeLabel: prepared.volumeLabel,
    selectedOutline: structuredClone(prepared.selectedOutline),
    authorRequestQuote: prepared.authorRequestQuote,
    authorizationId: prepared.authorizationId,
    expiresAt: prepared.expiresAt
  };
}
const authorizationBaselines = new Map<
  string,
  { hash: string; expiresAt: number }
>();
export function comparisonDraftCardId(
  preparationId: string,
  authorizationId: string
): string {
  const prepared = comparisonDraftPreparations.get(preparationId);
  if (!prepared || prepared.authorizationId !== authorizationId)
    throw new Error("本轮准备记录不存在或授权不符。");
  return prepared.chapterCardId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireAuthorEvidence(
  value: unknown,
  scope: { project: string; chapter: number; volume: string },
  label: string
): { path: string; sha256: string; quote: string } {
  if (!isRecord(value) || value.actor !== "user" || !isRecord(value.scope))
    throw new Error(`${label}缺少作者确认来源。`);
  const path = value.path;
  const hash = value.hash;
  const text = value.quote;
  const evidenceScope = value.scope;
  if (
    typeof path !== "string" ||
    typeof hash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(hash) ||
    typeof text !== "string" ||
    !text.trim() ||
    evidenceScope.project !== scope.project ||
    Number(evidenceScope.chapter) !== scope.chapter ||
    evidenceScope.volume !== scope.volume
  )
    throw new Error(`${label}的作者确认范围与卷章不匹配。`);
  return { path, sha256: hash, quote: text };
}

export async function requireProject(
  userDataPath: string,
  register?: (location: {
    workspaceRoot: string;
    projectRoot: string;
    relativePath: string;
  }) => Promise<void>
) {
  const settings = OtterSettingsSchema.parse(
    JSON.parse(
      await readFile(
        join(userDataPath, "config", "otter-workspace.json"),
        "utf8"
      )
    )
  );
  if (!settings.workspaceRoot) throw new Error("请先选择小说工作区目录。");
  const adapter = new OtterProjectAdapter(settings.workspaceRoot, userDataPath);
  if (register) {
    const location =
      await adapter.resolveProjectRegistrationDirectory(LOVE_PROJECT_PATH);
    await register(location);
  }
  const projects = await adapter.listProjects();
  const target = projects.find(
    ({ relativePath }) =>
      relativePath.replace(/\\/g, "/").replace(/\/$/u, "") === LOVE_PROJECT_PATH
  );
  if (!target)
    throw new Error(`小说工作区中没有登记独立 LOVE 项目：${LOVE_PROJECT_PATH}`);
  const project = await adapter.resolveProject(target.id);
  return { adapter, target, project };
}

function outlineVersion(content: string): string {
  return (
    content
      .replace(/^\uFEFF/u, "")
      .match(/^---\r?\n[\s\S]*?^version:\s*["']?([^\r\n"']+)["']?\s*$/mu)?.[1]
      ?.trim() || "unknown"
  );
}

export async function prepareNovelComparisonDraft(
  userDataPath: string,
  raw: LongPrepareComparisonDraftInput,
  source: NativeComparisonSource
) {
  const input = LongPrepareComparisonDraftInputSchema.parse(raw);
  if (
    source.chapterCardId !== input.chapterCardId ||
    sha256(source.cardContent) !== input.chapterCardSha256 ||
    sha256(source.volumeContent) !== input.volumeSha256 ||
    source.volumeId !== input.volumeId
  )
    throw new Error("章卡或卷卡读取版本与当前 LOVE 运行不一致，请重新读取。");
  for (const key of comparisonDraftPreparations.keys()) {
    const value = comparisonDraftPreparations.get(key);
    if (!value || value.expiresAt <= Date.now())
      comparisonDraftPreparations.delete(key);
  }
  if (comparisonDraftPreparations.size >= 500)
    throw new Error("对照稿准备队列已满，请稍后重试。");
  const { adapter, target, project } = await requireProject(
    userDataPath,
    async (location) => {
      await registerNativeComparison({
        workspace: location.workspaceRoot,
        relative: location.relativePath,
        root: location.projectRoot,
        request: input,
        source
      });
    }
  );
  const manifest = JSON.parse(
    (await adapter.readDocument(target.id, ".novel/project.json")).content
  ) as Record<string, unknown>;
  if (manifest.project !== "LOVE")
    throw new Error(
      "交付入口必须登记 LOVE 身份，不能复制其它项目的 manifest 或正典。"
    );
  const stateDocument = await adapter.readDocument(
    target.id,
    ".novel/chapter-state.json"
  );
  const state = JSON.parse(stateDocument.content) as Record<string, unknown>;
  if (
    state.schema_version !== 1 ||
    state.project !== manifest.project ||
    !Array.isArray(state.chapters)
  )
    throw new Error("LOVE 章节状态入口缺失或项目身份不匹配。");
  const matches = state.chapters.filter(
    (entry) =>
      isRecord(entry) &&
      Number(entry.chapter) === input.chapter &&
      entry.status !== "retired"
  );
  if (matches.length !== 1)
    throw new Error("本章卷次登记缺失或不唯一，不能推测卷次。");
  const entry = matches[0] as Record<string, unknown>;
  if (typeof entry.volume !== "string" || entry.volume !== source.volumeLabel)
    throw new Error("项目登记卷次与当前长篇卷卡不一致。");
  const scope = {
    project: manifest.project,
    chapter: input.chapter,
    volume: entry.volume
  };
  const selected = entry.selected_outline;
  if (!isRecord(selected) || typeof selected.path !== "string")
    throw new Error(
      "本章没有作者选定的大纲；请先由作者明确选择，不猜测最新版本。"
    );
  const outline = await adapter.readDocument(target.id, selected.path);
  if (
    outline.hash !== selected.hash ||
    sha256(outline.content) !== selected.hash ||
    outline.content.length > 500_000
  )
    throw new Error("作者选定的大纲缺失、过大或 hash 已变化，请重新准备。");
  const confirmedOutline = requireAuthorEvidence(
    selected.selection_evidence,
    scope,
    "大纲选择"
  );
  const volumeEvidence = requireAuthorEvidence(
    entry.volume_confirmation,
    scope,
    "卷次"
  );
  const [selectionDocument, volumeEvidenceDocument] = await Promise.all([
    adapter.readDocument(target.id, confirmedOutline.path),
    adapter.readDocument(target.id, volumeEvidence.path)
  ]);
  for (const [evidence, document, label] of [
    [confirmedOutline, selectionDocument, "大纲选择"],
    [volumeEvidence, volumeEvidenceDocument, "卷次"]
  ] as const) {
    if (
      document.hash !== evidence.sha256 ||
      sha256(document.content) !== evidence.sha256 ||
      !document.content.includes(evidence.quote)
    )
      throw new Error(`${label}作者原话来源已变化或不匹配。`);
  }
  if (typeof entry.comparison_task !== "string")
    throw new Error(
      "本章尚未登记实际写作任务，需先保存作者选择的大纲与任务来源；不会从聊天摘要猜测。"
    );
  const cli = await prepareComparisonCli({
    workspace: project.workspaceRoot,
    projectRelative: LOVE_PROJECT_PATH,
    projectRoot: project.projectRoot,
    chapter: input.chapter,
    volume: entry.volume,
    outline: { path: outline.path, hash: outline.hash },
    taskPath: entry.comparison_task,
    authorizationId: input.authorizationId,
    authorText: input.authorRequest.exactText,
    ...(source.nativeEvidence ? { nativeEvidence: source.nativeEvidence } : {}),
    ...(input.sourceMode ? { sourceMode: input.sourceMode } : {})
  });
  for (const [id, baseline] of authorizationBaselines)
    if (baseline.expiresAt <= Date.now()) authorizationBaselines.delete(id);
  const previousBaseline = authorizationBaselines.get(input.authorizationId);
  const batchHash = sha256(
    JSON.stringify([
      cli.comparisonBaseline,
      input.chapterCardSha256,
      input.volumeSha256
    ])
  );
  if (previousBaseline && previousBaseline.hash !== batchHash)
    throw new Error(
      "本批写作材料版本已变化；其他成员的旧版稿不能混为同一比较批次，请重新发起本章写作。"
    );
  authorizationBaselines.set(input.authorizationId, {
    hash: batchHash,
    expiresAt: Date.now() + preparationTtlMs
  });
  const preparationId = randomUUID();
  const preparation: ComparisonDraftPreparation = {
    preparationId,
    authorizationId: input.authorizationId,
    workspaceRoot: project.workspaceRoot,
    projectId: target.id,
    projectRoot: project.projectRoot,
    projectName: manifest.project,
    chapter: input.chapter,
    chapterCardId: input.chapterCardId,
    cardTitle: source.cardTitle,
    cardContent: source.cardContent,
    cardHash: input.chapterCardSha256,
    volumeId: source.volumeId,
    volumeLabel: entry.volume,
    volumeContent: source.volumeContent,
    volumeHash: input.volumeSha256,
    selectedOutline: {
      path: outline.path,
      hash: outline.hash,
      version: outlineVersion(outline.content),
      content: outline.content,
      selectionEvidence: confirmedOutline
    },
    volumeEvidence,
    authorRequestId: input.authorRequestId,
    authorRequestQuote: input.authorRequest.exactText,
    cli,
    ...(source.nativeEvidence
      ? { nativeEvidenceHash: sha256(source.nativeEvidence) }
      : {}),
    expiresAt: Date.now() + preparationTtlMs
  };
  comparisonDraftPreparations.set(preparationId, preparation);
  return LongPrepareComparisonDraftResultSchema.parse({
    preparationId,
    bookId: input.bookId,
    chapter: input.chapter,
    chapterCardId: input.chapterCardId,
    chapterCardSha256: input.chapterCardSha256,
    chapterCardContent: source.cardContent,
    volumeId: source.volumeId,
    selectedOutline: {
      path: outline.path,
      sha256: outline.hash,
      version: outlineVersion(outline.content),
      content: outline.content,
      selectionEvidence: confirmedOutline
    },
    volume: {
      label: entry.volume,
      content: source.volumeContent,
      evidence: volumeEvidence
    },
    readEvidence: [
      { path: outline.path, sha256: outline.hash, role: "outline" },
      {
        path: `deepwrite-index:chapters/${input.chapterCardId}/card`,
        sha256: input.chapterCardSha256,
        role: "chapter-card"
      },
      {
        path: volumeEvidence.path,
        sha256: volumeEvidence.sha256,
        role: "volume-evidence"
      }
    ],
    preparedAt: new Date().toISOString(),
    contextReadContent: cli.readContent
  });
}

export async function deliverNovelComparisonDraft(
  userDataPath: string,
  raw: LongDeliverComparisonDraftInput,
  source: {
    chapterCardId: string;
    cardContent: string;
    volumeContent: string;
    nativeEvidence?: string;
  }
) {
  const input = LongDeliverComparisonDraftInputSchema.parse(raw);
  const prepared = comparisonDraftPreparations.get(input.preparationId);
  if (
    !prepared ||
    prepared.expiresAt <= Date.now() ||
    prepared.authorizationId !== input.authorizationId ||
    prepared.chapterCardId !== source.chapterCardId
  )
    throw new Error("本次对照稿准备记录缺失、过期或不属于当前作者授权。");
  if (
    sha256(source.cardContent) !== prepared.cardHash ||
    sha256(source.volumeContent) !== prepared.volumeHash ||
    (prepared.nativeEvidenceHash !== undefined &&
      (!source.nativeEvidence ||
        sha256(source.nativeEvidence) !== prepared.nativeEvidenceHash))
  )
    throw new Error("章卡或卷卡在写作期间已变化，请重新读取后再交付。");
  if (input.runtime.mode !== "provider" || !input.runtime.configId)
    throw new Error("无法从本次 Main 模型配置确认真实运行身份。");
  const { adapter, target, project } = await requireProject(userDataPath);
  if (
    target.id !== prepared.projectId ||
    project.relativePath.replace(/\\/g, "/").replace(/\/$/u, "") !==
      LOVE_PROJECT_PATH
  )
    throw new Error("LOVE 对照稿输出项目发生变化，拒绝写入。");
  return await withExternalProjectLock(project.projectRoot, async () => {
    const current = await adapter.readDocument(
      target.id,
      prepared.selectedOutline.path
    );
    if (
      current.hash !== prepared.selectedOutline.hash ||
      sha256(current.content) !== prepared.selectedOutline.hash
    )
      throw new Error("作者选定的大纲在生成期间已变化；本稿未保存。");
    const result = await deliverComparisonCli({
      workspace: prepared.workspaceRoot,
      projectRelative: LOVE_PROJECT_PATH,
      projectRoot: project.projectRoot,
      projectId: target.id,
      prepared: prepared.cli,
      content: input.content,
      title: input.title?.trim() || prepared.cardTitle,
      runtime: input.runtime
    });
    comparisonDraftPreparations.delete(prepared.preparationId);
    return LongDeliverComparisonDraftResultSchema.parse({
      bookId: input.bookId,
      preparationId: prepared.preparationId,
      status: "待审阅",
      ...result
    });
  });
}

export interface NativeWritingScope {
  bookId: string;
  chapterCardId: string;
  chapter: number;
  volume: string;
  cardTitle: string;
}

/** Registry-resolved callers only: native identity is part of every catalog lookup. */
export async function saveNativeNovelWriting(
  projectRoot: string,
  scope: NativeWritingScope,
  input: {
    role: "work" | "candidate";
    content: string;
    title: string;
    model: string;
    version: string;
    origin?: "author-input" | "cli-delivery";
    expectedHash?: string;
    revisionOf?: string;
    revisionOfHash?: string;
    changeSummary?: string;
  }
) {
  if (!input.content.trim()) throw new Error("稿件正文不能为空。");
  const root = await realpath(projectRoot);
  return await withExternalProjectLock(root, async () => {
    const directory = await ensureWritingDirectory(root);
    const catalog = await readWritingCatalog(root);
    const binding = { bookId: scope.bookId, chapterCardId: scope.chapterCardId };
    const contentHash = sha256(input.content);
    const source: WritingSource = {
      title: input.title,
      model: input.model || "unknown",
      version: input.version,
      ...(input.revisionOf ? { revisionOf: input.revisionOf } : {}),
      ...(input.revisionOfHash ? { revisionOfHash: input.revisionOfHash } : {}),
      ...(input.changeSummary ? { changeSummary: input.changeSummary } : {}),
      savedAt: new Date().toISOString()
    };
    const metadataLines = [
      "workbench: novel-author-candidate-v1",
      `generator: ${input.origin ?? "author-input"}`,
      "kind: draft",
      `status: ${input.role === "work" ? "author-work-draft" : "author-candidate"}`,
      `writing_role: ${input.role}`,
      `title: ${quote(input.title)}`,
      `volume: ${quote(scope.volume)}`,
      `chapter: ${scope.chapter}`,
      `model: ${quote(input.model || "unknown")}`,
      `version: ${quote(input.version)}`,
      `native_book_id: ${scope.bookId}`,
      `native_chapter_card_id: ${scope.chapterCardId}`,
      ...(input.revisionOf ? [`revision_of: ${quote(input.revisionOf)}`] : []),
      ...(input.revisionOfHash ? [`revision_of_sha256: ${input.revisionOfHash}`] : []),
      ...(input.changeSummary ? [`change_summary: ${quote(input.changeSummary)}`] : []),
      `content_sha256: ${contentHash}`
    ];
    const body = `---\n${metadataLines.join("\n")}\n---\n\n${input.content}`;
    if (input.role === "work") {
      const filename = `工作稿_${sha256(`${scope.bookId}:${scope.chapterCardId}`).slice(0, 24)}.md`;
      const path = `.novel/notes/writing/${filename}`;
      const target = join(directory, filename);
      const existingFile = await safeWritingFile(root, path).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      const existing = existingFile ? await readFile(existingFile, "utf8") : null;
      if (existing !== null) {
        const existingMetadata = parseWritingMetadata(existing);
        if (existingMetadata.native_book_id !== scope.bookId || existingMetadata.native_chapter_card_id !== scope.chapterCardId || existingMetadata.status !== "author-work-draft")
          throw new Error("该章工作稿身份不匹配，拒绝覆盖。");
        if (!input.expectedHash || sha256(existing) !== input.expectedHash)
          throw new Error("工作稿已变化，请重新读取后再保存。");
        await atomicReplace(target, body);
      } else {
        if (input.expectedHash) throw new Error("工作稿已不存在，请重新读取后再保存。");
        await atomicCreate(target, body);
      }
      return { path, hash: sha256(body), role: "work" as const, deduplicated: false };
    }
    const duplicate = await findExactDuplicate(root, directory, {
      kind: "draft", volume: scope.volume, chapter: scope.chapter, content: input.content
    } as OtterSaveWritingInput, binding);
    if (duplicate) {
      const record = catalog.records.find((entry) => entry.path === duplicate.path && entry.hash === duplicate.hash && sameNativeScope(entry.nativeScope, binding));
      if (record) {
        if (!record.sources.some((item) => sameSource(item, source))) record.sources.push(source);
      } else {
        catalog.records.push({ path: duplicate.path, hash: duplicate.hash, contentHash, kind: "draft", volume: scope.volume, chapter: scope.chapter, sources: [source], nativeScope: binding });
      }
      await writeWritingCatalog(root, catalog);
      return { path: duplicate.path, hash: duplicate.hash, role: "candidate" as const, deduplicated: true };
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `第${String(scope.chapter).padStart(3, "0")}章_原生候选_${safeName(scope.chapterCardId)}_${safeName(input.model || "unknown")}_${stamp}-${randomUUID().slice(0, 8)}.md`;
    const path = `.novel/notes/writing/${filename}`;
    const target = join(directory, filename);
    await atomicCreate(target, body);
    const hash = sha256(body);
    catalog.records.push({ path, hash, contentHash, kind: "draft", volume: scope.volume, chapter: scope.chapter, sources: [source], nativeScope: binding });
    await writeWritingCatalog(root, catalog);
    return { path, hash, role: "candidate" as const, deduplicated: false };
  });
}

export async function listNativeNovelWriting(projectRoot: string, scope: NativeWritingScope) {
  const root = await realpath(projectRoot);
  return await withExternalProjectLock(root, async () => {
    const catalog = await readWritingCatalog(root);
    const binding = { bookId: scope.bookId, chapterCardId: scope.chapterCardId };
    const selected = catalog.selections.find((item) => item.kind === "draft" && sameNativeScope(item.nativeScope, binding));
    const items: Array<{
      path: string; hash: string; contentHash: string; role: "work" | "candidate";
      title: string; model: string; version: string; important: boolean;
      selectedReference: boolean; sources: WritingSource[];
    }> = [];
    const workPath = `.novel/notes/writing/工作稿_${sha256(`${scope.bookId}:${scope.chapterCardId}`).slice(0, 24)}.md`;
    const workFile = await safeWritingFile(root, workPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (workFile) {
      const text = await readFile(workFile, "utf8");
      const metadata = parseWritingMetadata(text);
      if (metadata.native_book_id === scope.bookId && metadata.native_chapter_card_id === scope.chapterCardId) {
        const body = writingBody(text);
        items.push({ path: workPath, hash: sha256(text), contentHash: sha256(body), role: "work", title: metadata.title ?? scope.cardTitle, model: metadata.model ?? "unknown", version: metadata.version ?? "unknown", important: false, selectedReference: false, sources: [{ title: metadata.title ?? scope.cardTitle, model: metadata.model ?? "unknown", version: metadata.version ?? "unknown", ...(metadata.revision_of ? { revisionOf: metadata.revision_of } : {}), ...(metadata.revision_of_sha256 ? { revisionOfHash: metadata.revision_of_sha256 } : {}), ...(metadata.change_summary ? { changeSummary: metadata.change_summary } : {}), savedAt: "unknown" }] });
      }
    }
    for (const record of catalog.records) {
      if (!sameNativeScope(record.nativeScope, binding)) continue;
      const first = record.sources[0];
      items.push({ path: record.path, hash: record.hash, contentHash: record.contentHash, role: "candidate", title: first?.title ?? scope.cardTitle, model: first?.model ?? "unknown", version: first?.version ?? "unknown", important: record.important === true, selectedReference: selected?.path === record.path && selected.hash === record.hash, sources: record.sources });
    }
    return items;
  });
}

export async function readNativeNovelWriting(projectRoot: string, scope: NativeWritingScope, input: { path: string; hash: string }) {
  const root = await realpath(projectRoot);
  return await withExternalProjectLock(root, async () => {
    const binding = { bookId: scope.bookId, chapterCardId: scope.chapterCardId };
    const workPath = `.novel/notes/writing/工作稿_${sha256(`${scope.bookId}:${scope.chapterCardId}`).slice(0, 24)}.md`;
    let role: "work" | "candidate";
    if (input.path === workPath) role = "work";
    else {
      const catalog = await readWritingCatalog(root);
      if (!catalog.records.some((item) => item.path === input.path && item.hash === input.hash && sameNativeScope(item.nativeScope, binding)))
        throw new Error("所选稿件不属于当前章节，请刷新后重试。");
      role = "candidate";
    }
    const text = await readNativeRecordFile(root, input.path);
    if (!text || sha256(text) !== input.hash) throw new Error("稿件版本已变化，请刷新后重试。");
    if (role === "work") {
      const metadata = parseWritingMetadata(text);
      if (metadata.native_book_id !== scope.bookId || metadata.native_chapter_card_id !== scope.chapterCardId || metadata.status !== "author-work-draft")
        throw new Error("工作稿身份与当前章节不符，拒绝打开。");
    }
    return { path: input.path, hash: input.hash, role, content: writingBody(text) };
  });
}

export async function selectNativeNovelWriting(projectRoot: string, scope: NativeWritingScope, input: { path: string; hash: string; action: "reference" | "important" }) {
  const root = await realpath(projectRoot);
  return await withExternalProjectLock(root, async () => {
    const catalog = await readWritingCatalog(root);
    const binding = { bookId: scope.bookId, chapterCardId: scope.chapterCardId };
    const record = catalog.records.find((item) => item.path === input.path && item.hash === input.hash && sameNativeScope(item.nativeScope, binding));
    if (!record) throw new Error("所选稿件不属于当前章节或版本已变化，请刷新后重试。");
    const text = await readNativeRecordFile(root, input.path);
    if (!text || sha256(text) !== input.hash) throw new Error("稿件内容已变化，请刷新后重试。");
    if (input.action === "important") record.important = true;
    else {
      catalog.selections = catalog.selections.filter((item) => !sameNativeScope(item.nativeScope, binding));
      catalog.selections.push({ kind: "draft", volume: scope.volume, chapter: scope.chapter, path: input.path, hash: input.hash, nativeScope: binding });
    }
    await writeWritingCatalog(root, catalog);
    return { selected: true as const, path: input.path, hash: input.hash, action: input.action };
  });
}

function writingBody(text: string) {
  return text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n\r?\n/u, "");
}

async function readNativeRecordFile(root: string, path: string): Promise<string | null> {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith(".novel/notes/writing/")) {
    const file = await safeWritingFile(root, normalized).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    return file ? await readFile(file, "utf8") : null;
  }
  if (!normalized.startsWith("004_写作中/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) return null;
  let cursor = root;
  for (const part of normalized.split("/")) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error("正文稿件路径包含链接，拒绝访问。");
  }
  const actual = await realpath(cursor);
  const rel = relative(root, actual);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || !(await lstat(actual)).isFile()) return null;
  return await readFile(actual, "utf8");
}

function sameNativeScope(left: WritingCatalogRecord["nativeScope"], right: NonNullable<WritingCatalogRecord["nativeScope"]>) {
  return left?.bookId === right.bookId && left.chapterCardId === right.chapterCardId;
}


/** Core owns all new author-candidate writes; neither paths nor overwrites are exposed. */
export async function saveNovelWriting(
  userDataPath: string,
  raw: OtterSaveWritingInput
) {
  const input = OtterSaveWritingInputSchema.parse(raw);
  const settings = OtterSettingsSchema.parse(
    JSON.parse(
      await readFile(
        join(userDataPath, "config", "otter-workspace.json"),
        "utf8"
      )
    )
  );
  if (!settings.workspaceRoot) throw new Error("请先选择小说工作区目录。");
  const adapter = new OtterProjectAdapter(settings.workspaceRoot, userDataPath);
  await adapter.listProjects();
  const project = await adapter.resolveProject(input.projectId);
  return await withExternalProjectLock(
    project.projectRoot,
    async () => await saveNovelWritingUnlocked(userDataPath, input)
  );
}

async function saveNovelWritingUnlocked(
  userDataPath: string,
  raw: OtterSaveWritingInput
) {
  const input = OtterSaveWritingInputSchema.parse(raw);
  const settings = OtterSettingsSchema.parse(
    JSON.parse(
      await readFile(
        join(userDataPath, "config", "otter-workspace.json"),
        "utf8"
      )
    )
  );
  if (!settings.workspaceRoot) throw new Error("请先选择小说工作区目录。");
  const adapter = new OtterProjectAdapter(settings.workspaceRoot, userDataPath);
  await adapter.listProjects();
  const project = await adapter.resolveProject(input.projectId);
  for (const path of [input.outline, input.revisionOf]) {
    if (!path) continue;
    if (/^workspace:/i.test(path))
      throw new Error("大纲和修订引用必须是当前作品内的相对路径。");
    await adapter.readDocument(input.projectId, path);
  }
  const root = await realpath(project.projectRoot);
  const cursor = await ensureWritingDirectory(root);
  const catalog = await readWritingCatalog(root);
  const contentHash = sha256(input.content);
  if (input.mode === "work") {
    const filename = `工作稿_第${String(input.chapter).padStart(3, "0")}章_${safeName(input.volume)}_${input.kind}.md`;
    const path = `.novel/notes/writing/${filename}`;
    const target = join(cursor, filename);
    const existingPath = await safeWritingFile(root, path).catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    );
    const existing = existingPath ? await readFile(existingPath, "utf8") : null;
    if (existing !== null) {
      const existingMetadata = parseWritingMetadata(existing);
      if (
        existingMetadata.status !== "author-work-draft" ||
        existingMetadata.kind !== input.kind ||
        existingMetadata.volume !== input.volume ||
        Number(existingMetadata.chapter) !== input.chapter
      )
        throw new Error("工作稿文件的卷章范围与当前任务不一致，拒绝覆盖。");
      if (!input.expectedHash || sha256(existing) !== input.expectedHash)
        throw new Error(
          "工作稿已变化或本轮未读取其当前版本；为保护并发修改，请重新打开后再保存。"
        );
      const metadata = [
        "workbench: novel-author-candidate-v1",
        "generator: author-input",
        `kind: ${input.kind}`,
        "status: author-work-draft",
        "writing_role: work",
        `title: ${quote(input.title)}`,
        `volume: ${quote(input.volume)}`,
        `chapter: ${input.chapter}`,
        `model: ${quote(input.model)}`,
        `version: ${quote(input.version)}`,
        `content_sha256: ${contentHash}`,
        ...(input.outline ? [`outline: ${quote(input.outline)}`] : []),
        ...(input.revisionOf ? [`revision_of: ${quote(input.revisionOf)}`] : [])
      ];
      const body = `---\n${metadata.join("\n")}\n---\n\n${input.content}`;
      const nextHash = sha256(body);
      await atomicReplace(target, body);
      return {
        path,
        hash: nextHash,
        status: "author-work-draft" as const,
        deduplicated: false
      };
    }
    if (input.expectedHash)
      throw new Error(
        "工作稿目标已不存在；请重新读取后再保存，避免用旧稿覆盖。"
      );
    const metadata = [
      "workbench: novel-author-candidate-v1",
      "generator: author-input",
      `kind: ${input.kind}`,
      "status: author-work-draft",
      "writing_role: work",
      `title: ${quote(input.title)}`,
      `volume: ${quote(input.volume)}`,
      `chapter: ${input.chapter}`,
      `model: ${quote(input.model)}`,
      `version: ${quote(input.version)}`,
      `content_sha256: ${contentHash}`,
      ...(input.outline ? [`outline: ${quote(input.outline)}`] : []),
      ...(input.revisionOf ? [`revision_of: ${quote(input.revisionOf)}`] : [])
    ];
    const body = `---\n${metadata.join("\n")}\n---\n\n${input.content}`;
    const targetHash = sha256(body);
    await atomicCreate(target, body);
    return {
      path,
      hash: targetHash,
      status: "author-work-draft" as const,
      deduplicated: false
    };
  }

  const duplicate = await findExactDuplicate(root, cursor, input);
  if (duplicate) {
    const record = catalog.records.find(({ path }) => path === duplicate.path);
    const source = sourceFor(input);
    if (record) {
      if (!record.sources.some((item) => sameSource(item, source)))
        record.sources.push(source);
    } else {
      catalog.records.push({
        path: duplicate.path,
        hash: duplicate.hash,
        contentHash,
        kind: input.kind,
        volume: input.volume,
        chapter: input.chapter,
        sources: [source]
      });
    }
    await writeWritingCatalog(root, catalog);
    return {
      path: duplicate.path,
      hash: duplicate.hash,
      status: "author-candidate" as const,
      deduplicated: true
    };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = ".novel/notes/writing";
  const filename = `第${String(input.chapter).padStart(3, "0")}章_${input.kind === "outline" ? "大纲" : "正文"}_作者候选_${safeName(input.model)}_${safeName(input.version)}_${stamp}-${randomUUID().slice(0, 8)}.md`;
  const path = `${directory}/${filename}`;
  const metadata = [
    "workbench: novel-author-candidate-v1",
    "generator: author-input",
    `kind: ${input.kind}`,
    "status: author-candidate",
    `title: ${quote(input.title)}`,
    `volume: ${quote(input.volume)}`,
    `chapter: ${input.chapter}`,
    `model: ${quote(input.model)}`,
    `version: ${quote(input.version)}`,
    "writing_role: candidate",
    `content_sha256: ${contentHash}`,
    ...(input.outline ? [`outline: ${quote(input.outline)}`] : []),
    ...(input.revisionOf ? [`revision_of: ${quote(input.revisionOf)}`] : [])
  ];
  const body = `---\n${metadata.join("\n")}\n---\n\n${input.content}`;
  const target = join(cursor, filename);
  const temporary = join(cursor, `.${filename}.${randomUUID()}.tmp`);
  await writeFile(temporary, body, { flag: "wx", encoding: "utf8" });
  try {
    // Hard-link creation publishes the complete file atomically and fails if target exists.
    await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  const bodyHash = sha256(body);
  catalog.records.push({
    path,
    hash: bodyHash,
    contentHash,
    kind: input.kind,
    volume: input.volume,
    chapter: input.chapter,
    sources: [sourceFor(input)]
  });
  await writeWritingCatalog(root, catalog);
  return {
    path,
    hash: bodyHash,
    status: "author-candidate" as const,
    deduplicated: false
  };
}

export async function selectNovelWriting(userDataPath: string, raw: unknown) {
  const input = OtterSelectWritingInputSchema.parse(raw);
  const settings = OtterSettingsSchema.parse(
    JSON.parse(
      await readFile(
        join(userDataPath, "config", "otter-workspace.json"),
        "utf8"
      )
    )
  );
  if (!settings.workspaceRoot) throw new Error("请先选择小说工作区目录。");
  const adapter = new OtterProjectAdapter(settings.workspaceRoot, userDataPath);
  await adapter.listProjects();
  const project = await adapter.resolveProject(input.projectId);
  return await withExternalProjectLock(project.projectRoot, async () => {
    const root = await realpath(project.projectRoot);
    const isManagedCandidate = input.path.startsWith(".novel/notes/writing/");
    const isProtocolDelivery = input.path.startsWith("004_写作中/");
    if (
      (!isManagedCandidate && !isProtocolDelivery) ||
      !input.path.endsWith(".md")
    )
      throw new Error("只能引用本作品写作区内的 Markdown 稿件。");
    const opened = await adapter.readDocument(input.projectId, input.path);
    const text = opened.content;
    if (opened.hash !== input.hash)
      throw new Error("候选稿内容已变化，请重新打开后再选择。");
    const metadata = parseWritingMetadata(text);
    const protocolDraft =
      isProtocolDelivery &&
      metadata.workbench === "novel-draft-v1" &&
      metadata.kind === "draft";
    if (
      input.action === "reference" &&
      !protocolDraft &&
      (metadata.status !== "author-candidate" ||
        metadata.writing_role === "work")
    )
      throw new Error("当前参考稿只能从已交付候选或 V1 正文交付稿中选择。");
    if (input.action === "important" && metadata.writing_role === "work")
      throw new Error("工作稿会持续修改，不能直接标为重要节点；请先另存候选稿。");
    const catalog = await readWritingCatalog(root);
    if (input.action === "important") {
      const chapter = Number(metadata.chapter);
      const volume = metadata.volume ?? "";
      if (!volume || !Number.isInteger(chapter) || chapter < 1)
        throw new Error("候选稿缺少有效卷章范围，不能标记为重要节点。");
      const record = catalog.records.find(
        (entry) => entry.path === input.path && entry.hash === input.hash
      );
      if (record) record.important = true;
      else {
        catalog.records.push({
          path: input.path,
          hash: input.hash,
          contentHash: metadata.content_sha256 ?? sha256(text),
          kind: metadata.kind === "outline" ? "outline" : "draft",
          volume,
          chapter,
          sources: [],
          important: true
        });
      }
      await writeWritingCatalog(root, catalog);
      return {
        selected: true as const,
        path: input.path,
        hash: input.hash,
        status: "important-checkpoint" as const
      };
    }
    const selection: WritingCatalogSelection = {
      kind: metadata.kind === "outline" ? "outline" : "draft",
      volume: metadata.volume ?? "",
      chapter: Number(metadata.chapter),
      path: input.path,
      hash: input.hash
    };
    if (
      !selection.volume ||
      !Number.isInteger(selection.chapter) ||
      selection.chapter < 1
    )
      throw new Error("候选稿缺少有效卷章范围，不能登记选择。");
    catalog.selections = catalog.selections.filter(
      (entry) =>
        entry.kind !== selection.kind ||
        entry.volume !== selection.volume ||
        entry.chapter !== selection.chapter
    );
    catalog.selections.push(selection);
    await writeWritingCatalog(root, catalog);
    return {
      selected: true as const,
      path: input.path,
      hash: input.hash,
      status: "current-reference-candidate" as const
    };
  });
}

async function ensureWritingDirectory(root: string): Promise<string> {
  const directory = ".novel/notes/writing";
  let cursor = root;
  for (const component of directory.split("/")) {
    cursor = join(cursor, component);
    try {
      await mkdir(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = await lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("候选稿目录包含非普通目录或链接，拒绝写入。");
    const rel = relative(root, await realpath(cursor));
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
      throw new Error("候选稿目录越出作品范围。");
  }
  return cursor;
}

async function safeWritingFile(root: string, path: string): Promise<string> {
  const normalized = path.replace(/\\/g, "/");
  if (
    !normalized.startsWith(".novel/notes/writing/") ||
    normalized.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Error("候选稿路径无效。");
  let cursor = root;
  for (const part of normalized.split("/")) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink())
      throw new Error("候选稿路径包含链接，拒绝访问。");
  }
  const actual = await realpath(cursor);
  const rel = relative(root, actual);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("候选稿路径越出作品范围。");
  if (!(await lstat(actual)).isFile()) throw new Error("候选稿不是普通文件。");
  return actual;
}

function parseWritingMetadata(text: string): Record<string, string> {
  const match = text.slice(0, 16_384).match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const result: Record<string, string> = {};
  for (const line of match?.[1]?.split(/\r?\n/) ?? []) {
    const field = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
    if (!field) continue;
    let value = field[2]!.trim();
    try {
      if (value.startsWith('"')) value = JSON.parse(value) as string;
    } catch {
      /* preserve malformed legacy value */
    }
    result[field[1]!] = value;
  }
  return result;
}

function emptyWritingCatalog(): WritingCatalog {
  return { schemaVersion: 1, records: [], selections: [] };
}

async function readWritingCatalog(root: string): Promise<WritingCatalog> {
  try {
    const text = await readFile(
      await safeWritingFile(root, WRITING_CATALOG_PATH),
      "utf8"
    );
    const value = JSON.parse(text) as Partial<WritingCatalog>;
    if (
      value.schemaVersion !== 1 ||
      !Array.isArray(value.records) ||
      !Array.isArray(value.selections)
    )
      throw new Error("候选稿目录清单格式不受支持；保留原文件并停止写入。");
    return value as WritingCatalog;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return emptyWritingCatalog();
    throw error;
  }
}

async function writeWritingCatalog(
  root: string,
  catalog: WritingCatalog
): Promise<void> {
  const directory = await ensureWritingDirectory(root);
  const target = join(directory, "catalog.json");
  const temporary = join(directory, `.catalog.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, {
    flag: "wx",
    encoding: "utf8"
  });
  await rename(temporary, target);
}

function sourceFor(input: OtterSaveWritingInput): WritingSource {
  return {
    title: input.title,
    model: input.model,
    version: input.version,
    ...(input.outline ? { outline: input.outline } : {}),
    ...(input.revisionOf ? { revisionOf: input.revisionOf } : {}),
    savedAt: new Date().toISOString()
  };
}

function sameSource(left: WritingSource, right: WritingSource): boolean {
  return (
    left.title === right.title &&
    left.model === right.model &&
    left.version === right.version &&
    left.outline === right.outline &&
    left.revisionOf === right.revisionOf &&
    left.revisionOfHash === right.revisionOfHash &&
    left.changeSummary === right.changeSummary
  );
}

async function findExactDuplicate(
  root: string,
  directory: string,
  input: Pick<OtterSaveWritingInput, "kind" | "volume" | "chapter" | "content">,
  nativeScope?: { bookId: string; chapterCardId: string }
): Promise<{ path: string; hash: string } | undefined> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = `.novel/notes/writing/${entry.name}`;
    let file: string;
    try {
      file = await safeWritingFile(root, path);
    } catch {
      continue;
    }
    const text = await readFile(file, "utf8");
    const metadata = parseWritingMetadata(text);
    if (
      metadata.status !== "author-candidate" ||
      metadata.kind !== input.kind ||
      (nativeScope !== undefined
        ? metadata.native_book_id !== nativeScope.bookId ||
          metadata.native_chapter_card_id !== nativeScope.chapterCardId
        : metadata.volume !== input.volume || Number(metadata.chapter) !== input.chapter)
    )
      continue;
    const body = writingBody(text);
    if (body === input.content) return { path, hash: sha256(text) };
  }
  return undefined;
}

async function atomicReplace(target: string, text: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, { flag: "wx", encoding: "utf8" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function atomicCreate(target: string, text: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, { flag: "wx", encoding: "utf8" });
  try {
    await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
