import type {
  WorkbenchPrepared,
  DeepWriteApi
} from "@deepwrite/contracts/renderer";

export interface CodexCandidate {
  content: string;
  model: string;
  threadId: string;
  scopeKey: string;
}

export async function saveCodexCandidate(
  api: DeepWriteApi,
  prepared: WorkbenchPrepared,
  candidate: CodexCandidate
): Promise<{ fileId: string; path: string }> {
  if (
    candidate.scopeKey !== `${prepared.bookId}:${prepared.id}` ||
    !candidate.content.trim()
  )
    throw new Error("候选不属于本次作品资料。");
  if (!api.workbenchCollaboration) throw new Error("本地协作服务暂不可用。");
  const content = `---\nworkbench: novel-collaboration-v1\nstatus: candidate\nmodel: ${JSON.stringify(candidate.model)}\nthread: ${JSON.stringify(candidate.threadId)}\n---\n\n${candidate.content}\n\n---\n资料来源：\n${prepared.sources.map((source) => `- ${source.path} (${source.sha256})`).join("\n")}`;
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))
    )
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const sourceName = `Codex候选_${digest}.md`;
  const current = await api.long.getWorkspaceIndex({ bookId: prepared.bookId });
  const prior = current.workspaceIndex.importedSources.find(
    (source) =>
      source.sourceName === sourceName && source.sourceSha256 === digest
  );
  if (prior) return { fileId: prior.file.id, path: prior.file.path };
  if (current.workspaceIndex.updatedAt !== prepared.indexUpdatedAt)
    throw new Error("作品资料已变化，请重新准备并审阅后保存。");
  const automaticFiles = new Set([current.workspaceIndex.bookLine?.id]);
  const selectedOutline = current.workspaceIndex.plot?.chapterCards.find(
    (card) => card.id === prepared.chapterCardId
  )?.outlineSelection;
  if (selectedOutline) automaticFiles.add(selectedOutline.sourceFileId);
  const checked = await api.workbenchCollaboration.request({
    operation: "prepare",
    bookId: prepared.bookId,
    ...(prepared.chapterCardId
      ? { chapterCardId: prepared.chapterCardId }
      : {}),
    fileIds: prepared.sources
      .filter((source) => !automaticFiles.has(source.fileId))
      .map((source) => source.fileId)
  });
  if (
    checked.kind !== "prepared" ||
    checked.prepared.indexUpdatedAt !== prepared.indexUpdatedAt ||
    checked.prepared.agentsMd !== prepared.agentsMd ||
    prepared.sources.some(
      (source) =>
        !checked.prepared.sources.some(
          (latest) =>
            latest.fileId === source.fileId && latest.sha256 === source.sha256
        )
    )
  )
    throw new Error("候选所用资料已变化，停止保存。");
  const staged = await api.long.stageSourceImport({
    bookId: prepared.bookId,
    title: "Codex讨论候选",
    sourceName,
    content,
    purpose: "discussion",
    authority: "candidate",
    expectedIndexUpdatedAt: prepared.indexUpdatedAt,
    purposeNote: "作者主动保存的独立 Codex 讨论结果。未选为大纲、正文或正典。"
  });
  if (
    staged.bookId !== prepared.bookId ||
    staged.sourceSha256 !== digest ||
    staged.content !== content
  )
    throw new Error("候选导入预览与原文不一致。");
  const result = await api.long.confirmSourceImport({
    bookId: prepared.bookId,
    previewId: staged.previewId
  });
  return { fileId: result.source.file.id, path: result.source.file.path };
}
