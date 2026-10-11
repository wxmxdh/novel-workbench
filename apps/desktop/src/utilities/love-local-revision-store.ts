import { createHash, randomUUID } from "node:crypto";
import {
  LongApplyLoveLocalRevisionInputSchema,
  LongApplyLoveLocalRevisionResultSchema,
  LongPrepareLoveLocalRevisionInputSchema,
  LongPrepareLoveLocalRevisionResultSchema,
  type LongApplyLoveLocalRevisionInput,
  type LongPrepareLoveLocalRevisionInput
} from "@deepwrite/contracts";
import { withExternalProjectLock } from "./external-project-operations";
import {
  getLoveComparisonPreparation,
  requireProject
} from "./novel-writing-store";
import {
  deliverComparisonCli,
  type ComparisonCliPreparation
} from "./comparison-cli-bridge";
import { prepareLoveLocalRevisionCli } from "./love-local-revision-cli-bridge";
import { previewLoveLocalRevision } from "./love-local-revision";

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const LOVE_PROJECT_PATH = "00_创作项目/项目/LOVE";
const ttlMs = 30 * 60_000;

interface LocalRevisionPreparation {
  revisionPreparationId: string;
  comparisonPreparationId: string;
  authorizationId: string;
  workspaceRoot: string;
  projectId: string;
  projectRoot: string;
  chapter: number;
  volume: string;
  selectedOutline: { path: string; hash: string };
  sourcePath: string;
  sourceSha256: string;
  sourceContent: string;
  sourceTitle: string;
  sourceModel: string;
  authorRevisionEvidence: { path: string; sha256: string; quote: string };
  nativeEvidenceHash: string;
  cliPreparation: ComparisonCliPreparation;
  expiresAt: number;
}

const preparations = new Map<string, LocalRevisionPreparation>();

function metadataField(source: string, name: string): string | undefined {
  const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1];
  if (!header) return undefined;
  const value = header.match(new RegExp(`^${name}:\\s*(.*)$`, "mu"))?.[1];
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return value.trim().replace(/^['"]|['"]$/gu, "") || undefined;
  }
}

function chapterDraftPath(path: string, chapter: number): boolean {
  const normalized = path.replace(/\\/g, "/");
  const prefix = `004_写作中/第${String(chapter).padStart(3, "0")}章_正文草稿_`;
  return (
    normalized.startsWith(prefix) &&
    normalized.endsWith(".md") &&
    !normalized.split("/").includes("..")
  );
}

function expirePreparations() {
  for (const [id, value] of preparations)
    if (value.expiresAt <= Date.now()) preparations.delete(id);
}

export async function prepareNovelLoveLocalRevision(
  userDataPath: string,
  raw: LongPrepareLoveLocalRevisionInput,
  source: { nativeEvidence: string }
) {
  const input = LongPrepareLoveLocalRevisionInputSchema.parse(raw);
  const comparison = getLoveComparisonPreparation(
    input.comparisonPreparationId,
    input.authorizationId
  );
  if (!source.nativeEvidence.trim())
    throw new Error("局部修订缺少Core本轮重建的LOVE原生资料，请重新读取后准备。");
  const nativeEvidenceHash = sha256(source.nativeEvidence);
  if (!chapterDraftPath(input.sourcePath, comparison.chapter))
    throw new Error("待修订来源不属于本章 004_写作中 的独立稿件。");
  const { adapter, target, project } = await requireProject(userDataPath);
  if (
    target.id !== comparison.projectId ||
    project.relativePath.replace(/\\/g, "/").replace(/\/$/u, "") !==
      LOVE_PROJECT_PATH ||
    project.projectRoot !== comparison.projectRoot
  )
    throw new Error("LOVE 项目位置已变化，请重新读取并准备本轮任务。");
  const current = await adapter.readDocument(target.id, input.sourcePath);
  if (
    current.hash !== input.sourceSha256 ||
    sha256(current.content) !== input.sourceSha256 ||
    current.content.length > 200_000
  )
    throw new Error("待修订稿 hash 不匹配或超过范围；没有修改任何文件。");
  const authorRequestPath = `.novel/author-requests/${comparison.authorizationId}.md`;
  const authorRequest = await adapter.readDocument(
    target.id,
    authorRequestPath
  );
  if (
    !authorRequest.content.includes(comparison.authorRequestQuote) ||
    authorRequest.content.length > 20_000
  )
    throw new Error("本轮 V1 作者修订请求来源缺失或与 Main 授权不一致。");
  const chapterState = JSON.parse(
    (await adapter.readDocument(target.id, ".novel/chapter-state.json")).content
  ) as { chapters?: unknown };
  const entries = Array.isArray(chapterState.chapters)
    ? chapterState.chapters.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          Number((entry as Record<string, unknown>).chapter) ===
            comparison.chapter &&
          (entry as Record<string, unknown>).volume === comparison.volumeLabel
      )
    : [];
  if (entries.length !== 1 || typeof entries[0]!.comparison_task !== "string")
    throw new Error("本章当前 V1 写作任务登记缺失或不唯一。");
  const cliPreparation = await prepareLoveLocalRevisionCli({
    workspace: comparison.workspaceRoot,
    projectRelative: LOVE_PROJECT_PATH,
    projectRoot: project.projectRoot,
    chapter: comparison.chapter,
    volume: comparison.volumeLabel,
    selectedOutline: {
      path: comparison.selectedOutline.path,
      hash: comparison.selectedOutline.hash
    },
    chapterTaskPath: entries[0]!.comparison_task,
    sourcePath: current.path,
    sourceSha256: input.sourceSha256,
    authorizationId: comparison.authorizationId,
    authorRevisionText: comparison.authorRequestQuote,
    authorRevisionEvidence: {
      path: authorRequestPath,
      sha256: authorRequest.hash,
      quote: comparison.authorRequestQuote
    },
    nativeEvidence: source.nativeEvidence
  });
  expirePreparations();
  if (preparations.size >= 500)
    throw new Error("局部修订准备队列已满，请稍后重试。");
  const revisionPreparationId = randomUUID();
  const preparation: LocalRevisionPreparation = {
    revisionPreparationId,
    comparisonPreparationId: input.comparisonPreparationId,
    authorizationId: input.authorizationId,
    workspaceRoot: comparison.workspaceRoot,
    projectId: comparison.projectId,
    projectRoot: comparison.projectRoot,
    chapter: comparison.chapter,
    volume: comparison.volumeLabel,
    selectedOutline: {
      path: comparison.selectedOutline.path,
      hash: comparison.selectedOutline.hash
    },
    sourcePath: current.path,
    sourceSha256: input.sourceSha256,
    sourceContent: current.content,
    sourceTitle:
      metadataField(current.content, "title") ??
      `第${String(comparison.chapter).padStart(3, "0")}章局部修订`,
    sourceModel:
      metadataField(current.content, "model_raw") ??
      metadataField(current.content, "model") ??
      "unknown",
    authorRevisionEvidence: {
      path: authorRequestPath,
      sha256: authorRequest.hash,
      quote: comparison.authorRequestQuote
    },
    nativeEvidenceHash,
    cliPreparation,
    expiresAt: Date.now() + ttlMs
  };
  preparations.set(revisionPreparationId, preparation);
  return LongPrepareLoveLocalRevisionResultSchema.parse({
    bookId: input.bookId,
    revisionPreparationId,
    comparisonPreparationId: input.comparisonPreparationId,
    sourcePath: preparation.sourcePath,
    sourceSha256: preparation.sourceSha256,
    sourceContent: preparation.sourceContent,
    readContent: cliPreparation.readContent,
    chapter: preparation.chapter,
    volume: preparation.volume,
    sourceModel: preparation.sourceModel,
    sourceTitle: preparation.sourceTitle,
    authorRevisionEvidence: preparation.authorRevisionEvidence
  });
}

export async function applyNovelLoveLocalRevision(
  userDataPath: string,
  raw: LongApplyLoveLocalRevisionInput,
  source: { nativeEvidence: string }
) {
  const input = LongApplyLoveLocalRevisionInputSchema.parse(raw);
  const prepared = preparations.get(input.revisionPreparationId);
  if (
    !prepared ||
    prepared.expiresAt <= Date.now() ||
    prepared.authorizationId !== input.authorizationId
  )
    throw new Error("局部修订准备记录缺失、过期或授权不匹配，请重新读取底稿。");

  const { adapter, target, project } = await requireProject(userDataPath);
  if (
    target.id !== prepared.projectId ||
    project.relativePath.replace(/\\/g, "/").replace(/\/$/u, "") !==
      LOVE_PROJECT_PATH ||
    project.projectRoot !== prepared.projectRoot
  )
    throw new Error("LOVE 项目位置已变化；局部修订已停止。");

  return await withExternalProjectLock(project.projectRoot, async () => {
    if (
      !source.nativeEvidence.trim() ||
      sha256(source.nativeEvidence) !== prepared.nativeEvidenceHash
    )
      throw new Error(
        "LOVE原生资料在准备后已变化；请从工作台重新读取并准备局部修订。"
      );
    const current = await adapter.readDocument(target.id, prepared.sourcePath);
    if (
      current.hash !== prepared.sourceSha256 ||
      sha256(current.content) !== prepared.sourceSha256 ||
      current.content !== prepared.sourceContent
    )
      throw new Error("底稿在准备后已变化；拒绝把旧批注套到新版本。");
    const preview = previewLoveLocalRevision({
      source: current.content,
      expectedSourceSha256: prepared.sourceSha256,
      patches: input.patches
    });
    if (input.action === "preview")
      return LongApplyLoveLocalRevisionResultSchema.parse({
        bookId: input.bookId,
        revisionPreparationId: input.revisionPreparationId,
        action: "preview",
        sourcePath: prepared.sourcePath,
        sourceSha256: prepared.sourceSha256,
        previewContent: preview.content,
        previewSha256: preview.outputSha256,
        patches: input.patches,
        writes: 0
      });

    const evidence = input.authorRevisionEvidence;
    if (
      !evidence ||
      JSON.stringify(evidence) !==
        JSON.stringify(prepared.authorRevisionEvidence)
    )
      throw new Error(
        "Core 未收到与准备阶段一致的本轮作者局部修订授权；只能预览。"
      );
    if (
      !input.runtime ||
      input.runtime.mode !== "provider" ||
      !input.runtime.configId
    )
      throw new Error("本次正文修订运行型号无法由 Main 配置核实。");

    const delivered = await deliverComparisonCli({
      workspace: prepared.workspaceRoot,
      projectRelative: LOVE_PROJECT_PATH,
      projectRoot: project.projectRoot,
      projectId: prepared.projectId,
      prepared: prepared.cliPreparation,
      content: preview.content,
      title: prepared.sourceTitle,
      runtime: input.runtime
    });
    if (delivered.path === prepared.sourcePath)
      throw new Error("局部修订交付路径与来源稿相同；原稿未修改。");
    preparations.delete(prepared.revisionPreparationId);
    return LongApplyLoveLocalRevisionResultSchema.parse({
      bookId: input.bookId,
      revisionPreparationId: input.revisionPreparationId,
      action: "deliver",
      sourcePath: prepared.sourcePath,
      sourceSha256: prepared.sourceSha256,
      previewContent: preview.content,
      previewSha256: preview.outputSha256,
      patches: input.patches,
      writes: 1,
      path: delivered.path,
      deliveryRecord: delivered.deliveryRecord,
      outputSha256: delivered.sha256,
      model: delivered.model
    });
  });
}
