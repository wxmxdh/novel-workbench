import { createHash, randomUUID } from "node:crypto";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  createLongWorkspaceNavigationSnapshot,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  LongListBooksResultSchema,
  LongReadAgentsMdResultSchema,
  type CommandEnvelope,
  type CommandResult,
  type WorkbenchPrepared,
  type LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";

export type CoreRequest = (command: CommandEnvelope) => Promise<CommandResult>;
export const hashText = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");
export async function corePayload(
  request: CoreRequest,
  type: CommandEnvelope["type"],
  payload: unknown
) {
  const result = await request(
    CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id: randomUUID() })
    )
  );
  if (result.status === "rejected") throw new Error(result.error.message);
  return result.payload;
}
export async function readWhole(
  request: CoreRequest,
  bookId: string,
  fileId: string
) {
  let offset = 0;
  let text = "";
  let updatedAt: string | undefined;
  let total: number | undefined;
  for (;;) {
    const page = LongReadDocumentResultSchema.parse(
      await corePayload(request, "long.readDocument", {
        bookId,
        fileId,
        offset,
        maxCharacters: 32_768
      })
    );
    if (
      page.bookId !== bookId ||
      page.file.id !== fileId ||
      page.offset !== offset ||
      page.totalCharacters > 100_000 ||
      (total !== undefined && page.totalCharacters !== total) ||
      (updatedAt !== undefined && page.file.updatedAt !== updatedAt)
    )
      throw new Error("资料变化或超过本次完整读取上限，请缩小范围后重新准备。");
    total = page.totalCharacters;
    updatedAt = page.file.updatedAt;
    text += page.content;
    if (page.nextOffset === null) {
      if ([...text].length !== total) throw new Error("资料未完整读取。");
      return {
        fileId,
        title: page.file.path.split("/").at(-1) ?? fileId,
        path: page.file.path,
        sha256: hashText(text),
        content: text
      };
    }
    if (page.nextOffset <= offset) throw new Error("无效资料分页。");
    offset = page.nextOffset;
  }
}
export async function prepareContext(
  request: CoreRequest,
  input: {
    bookId: string;
    chapterCardId?: string | undefined;
    fileIds?: string[] | undefined;
  }
): Promise<{
  prepared: WorkbenchPrepared;
  runtime: LongWorkspaceRuntimeContext;
}> {
  const books = LongListBooksResultSchema.parse(
    await corePayload(request, "long.list", {})
  );
  const book = books.books.find(({ id }) => id === input.bookId);
  if (!book) throw new Error("作品尚未注册到工作台。");
  const { workspaceIndex: index } = LongWorkspaceIndexResultSchema.parse(
    await corePayload(request, "long.getWorkspaceIndex", {
      bookId: input.bookId
    })
  );
  const card = input.chapterCardId
    ? index.plot.chapterCards.find(({ id }) => id === input.chapterCardId)
    : undefined;
  if (input.chapterCardId && !card) throw new Error("章节不属于当前作品。");
  const files = new Set([index.bookLine.id, ...(input.fileIds ?? [])]);
  if (card?.outlineSelection) {
    if (card.outlineSelection.status === "needs-recheck")
      throw new Error("本章大纲标记为需要复核，不能作为本次协作来源。");
    files.add(card.outlineSelection.sourceFileId);
  }
  if (card) {
    const chapter = index.chapters.find(
      ({ chapterCardId }) => chapterCardId === card.id
    );
    if (chapter) files.add(chapter.card.id);
  }
  const sources = [];
  for (const fileId of files)
    sources.push(await readWhole(request, input.bookId, fileId));
  if (
    card?.outlineSelection &&
    !sources.some(
      (source) =>
        source.fileId === card.outlineSelection!.sourceFileId &&
        source.sha256 === card.outlineSelection!.sha256
    )
  )
    throw new Error("作者所选大纲版本与当前文件不一致，请先复核或重新选择。");
  if (sources.reduce((sum, item) => sum + item.content.length, 0) > 180_000)
    throw new Error("本次资料过多，请缩小范围。");
  const rules = LongReadAgentsMdResultSchema.parse(
    await corePayload(request, "long.readAgentsMd", { bookId: input.bookId })
  );
  if (rules.truncated) throw new Error("作品规则未完整读取，停止准备任务。");
  const after = LongWorkspaceIndexResultSchema.parse(
    await corePayload(request, "long.getWorkspaceIndex", {
      bookId: input.bookId
    })
  );
  if (after.workspaceIndex.updatedAt !== index.updatedAt)
    throw new Error("准备期间作品发生变化，请重新准备。");
  const prepared: WorkbenchPrepared = {
    id: randomUUID(),
    bookId: input.bookId,
    title: book.title,
    indexUpdatedAt: index.updatedAt,
    ...(card ? { chapterCardId: card.id } : {}),
    sources,
    agentsMd: rules.content,
    createdAt: new Date().toISOString()
  };
  return {
    prepared,
    runtime: {
      bookId: input.bookId,
      title: book.title,
      activeRoot: "sources",
      activeAgentId: "long",
      interactionMode: "discussion",
      readOnly: true,
      navigation: createLongWorkspaceNavigationSnapshot(index),
      agentsMd: rules.content,
      ...(card ? { activeChapterCardId: card.id } : {})
    }
  };
}
export async function verifyPrepared(
  request: CoreRequest,
  prepared: WorkbenchPrepared
) {
  const { workspaceIndex } = LongWorkspaceIndexResultSchema.parse(
    await corePayload(request, "long.getWorkspaceIndex", {
      bookId: prepared.bookId
    })
  );
  if (workspaceIndex.updatedAt !== prepared.indexUpdatedAt)
    throw new Error("作品资料已变化，请重新准备任务。");
  const rules = LongReadAgentsMdResultSchema.parse(
    await corePayload(request, "long.readAgentsMd", { bookId: prepared.bookId })
  );
  if (hashText(rules.content) !== hashText(prepared.agentsMd))
    throw new Error("作品规则已变化，请重新准备任务。");
  for (const source of prepared.sources) {
    if (
      (await readWhole(request, prepared.bookId, source.fileId)).sha256 !==
      source.sha256
    )
      throw new Error("来源已变化，请重新准备任务。");
  }
  const latest = LongWorkspaceIndexResultSchema.parse(
    await corePayload(request, "long.getWorkspaceIndex", {
      bookId: prepared.bookId
    })
  );
  if (latest.workspaceIndex.updatedAt !== prepared.indexUpdatedAt)
    throw new Error("核验期间作品资料发生变化，请重新准备任务。");
}
