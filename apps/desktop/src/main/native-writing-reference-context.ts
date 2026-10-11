import { createHash } from "node:crypto";
import { createId } from "@deepwrite/shared";
import {
  CommandEnvelopeSchema,
  LongNativeWritingListResultSchema,
  LongNativeWritingReadResultSchema,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  createEnvelope,
  createLongWorkspaceNavigationSnapshot,
  type CommandEnvelope,
  type CommandResult,
  type LongSelectedDraftReferenceSnapshot,
  type LongSelectedChapterOutlineSnapshot,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

type CoreRequest = (command: CommandEnvelope) => Promise<CommandResult>;
const LOVE_BOOK_ID = "longbook_9a146bbe";
const MAX_CONTENT = 100_000;
const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Replaces renderer-provided reference packets with author selections freshly verified by Core. */
export async function prepareNativeWritingReferenceContext(
  context: WorkspaceRuntimeContext | undefined,
  request: CoreRequest,
  options: { required: boolean; targetChapterCardId?: string }
): Promise<WorkspaceRuntimeContext | undefined> {
  const workspace = context?.longWorkspace;
  if (!context || !workspace) return context;
  const {
    selectedDraftReferences: _untrustedRefs,
    selectedChapterOutline: _untrustedOutline,
    ...clean
  } = workspace;
  if (
    workspace.bookId !== LOVE_BOOK_ID ||
    !options.required ||
    !options.targetChapterCardId
  )
    return { ...context, longWorkspace: clean };

  const query = async (type: string, payload: object): Promise<unknown> => {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id: createId("native-writing-context") })
    );
    const reply = await request(command);
    if (reply.status !== "accepted") throw new Error(reply.error.message);
    return reply.payload;
  };
  const readIndex = async () => {
    const result = LongWorkspaceIndexResultSchema.parse(
      await query("long.getWorkspaceIndex", { bookId: LOVE_BOOK_ID })
    );
    if (
      result.bookId !== LOVE_BOOK_ID ||
      result.workspaceIndex.bookId !== LOVE_BOOK_ID
    )
      throw new Error("LOVE作品索引不匹配，已停止本轮写稿。");
    return result.workspaceIndex;
  };
  const initial = await readIndex();
  const cards = initial.plot.chapterCards;
  const targetCard = cards.find(
    (card) => card.id === options.targetChapterCardId
  );
  if (
    !targetCard ||
    cards.filter((card) => card.id === targetCard.id).length !== 1
  )
    throw new Error("目标章节已变化或不唯一，请刷新后重新发送。");
  const targetIndex = initial.chapters.findIndex(
    (chapter) => chapter.chapterCardId === targetCard.id
  );
  const targetEntry = initial.chapters[targetIndex];
  if (!targetEntry) throw new Error("目标章节正文索引缺失，请刷新后重新发送。");
  const orderedCards = [...cards].sort((a, b) => {
    const av =
      initial.plot.volumes.find((v) => v.id === a.volumeId)?.order ??
      Number.MAX_SAFE_INTEGER;
    const bv =
      initial.plot.volumes.find((v) => v.id === b.volumeId)?.order ??
      Number.MAX_SAFE_INTEGER;
    return av - bv || a.narrativeOrder - b.narrativeOrder;
  });
  const previousCardId =
    orderedCards[
      orderedCards.findIndex((card) => card.id === targetCard.id) - 1
    ]?.id;
  const refs: LongSelectedDraftReferenceSnapshot[] = [];
  for (const [chapterCardId, relation] of [
    [targetCard.id, "current"],
    [previousCardId, "previous"]
  ] as const) {
    if (!chapterCardId) continue;
    const listed = LongNativeWritingListResultSchema.parse(
      await query("long.nativeWritingList", {
        bookId: LOVE_BOOK_ID,
        chapterCardId
      })
    );
    if (
      listed.bookId !== LOVE_BOOK_ID ||
      listed.chapterCardId !== chapterCardId
    )
      throw new Error("章节参考稿索引范围不匹配，请重新选择。");
    const selected = listed.items.filter(
      (item) => item.role === "candidate" && item.selectedReference
    );
    if (selected.length > 1)
      throw new Error("该章有多个被标记的参考稿，请重新选择唯一参考稿。");
    const item = selected[0];
    if (!item) continue;
    const read = LongNativeWritingReadResultSchema.parse(
      await query("long.nativeWritingRead", {
        bookId: LOVE_BOOK_ID,
        chapterCardId,
        path: item.path,
        hash: item.hash
      })
    );
    const after = LongNativeWritingListResultSchema.parse(
      await query("long.nativeWritingList", {
        bookId: LOVE_BOOK_ID,
        chapterCardId
      })
    );
    const stillSelected = after.items.filter(
      (candidate) =>
        candidate.role === "candidate" && candidate.selectedReference
    );
    if (
      after.bookId !== LOVE_BOOK_ID ||
      after.chapterCardId !== chapterCardId ||
      read.path !== item.path ||
      read.hash !== item.hash ||
      read.role !== "candidate" ||
      hash(read.content) !== item.contentHash ||
      stillSelected.length !== 1 ||
      stillSelected[0]?.path !== item.path ||
      stillSelected[0]?.hash !== item.hash ||
      read.content.length > MAX_CONTENT
    )
      throw new Error(
        "作者选用的章节参考稿读取失败或期间发生变化，请重新选择后再写稿。"
      );
    refs.push({
      bookId: LOVE_BOOK_ID,
      chapterCardId,
      relation,
      title: item.title,
      path: item.path,
      hash: item.hash,
      content: read.content,
      model: item.model,
      version: item.version
    });
  }

  let outline: LongSelectedChapterOutlineSnapshot | undefined;
  const selection = targetCard.outlineSelection;
  if (selection) {
    if (
      selection.status === "needs-recheck" ||
      selection.sourceFileId !== targetEntry.card.id
    )
      throw new Error(
        "本章选用大纲已失效或来源不匹配，请重新选择大纲后再写稿。"
      );
    const parts: string[] = [];
    let offset = 0;
    let total: number | undefined;
    let fileUpdatedAt: string | undefined;
    while (true) {
      const page = LongReadDocumentResultSchema.parse(
        await query("long.readDocument", {
          bookId: LOVE_BOOK_ID,
          fileId: selection.sourceFileId,
          offset,
          maxCharacters: 32_768
        })
      );
      if (
        page.bookId !== LOVE_BOOK_ID ||
        page.file.id !== targetEntry.card.id ||
        page.offset !== offset ||
        page.totalCharacters > MAX_CONTENT ||
        (total !== undefined && total !== page.totalCharacters) ||
        (fileUpdatedAt !== undefined && fileUpdatedAt !== page.file.updatedAt)
      )
        throw new Error(
          "本章选用大纲读取期间发生变化或超过安全上限，请重新选择后再写稿。"
        );
      total = page.totalCharacters;
      fileUpdatedAt = page.file.updatedAt;
      parts.push(page.content);
      if (page.nextOffset === null) break;
      if (page.nextOffset <= offset)
        throw new Error("本章选用大纲分页游标异常，请重新选择后再写稿。");
      offset = page.nextOffset;
    }
    const content = parts.join("");
    if (
      !content.trim() ||
      content.length > MAX_CONTENT ||
      hash(content) !== selection.sha256
    )
      throw new Error("本章选用大纲全文hash不匹配或超过安全上限，请重新选择。");
    outline = {
      bookId: LOVE_BOOK_ID,
      chapterCardId: targetCard.id,
      version: selection.version,
      path: targetEntry.card.path,
      hash: selection.sha256,
      content
    };
  }
  for (const reference of refs) {
    const after = LongNativeWritingListResultSchema.parse(
      await query("long.nativeWritingList", {
        bookId: LOVE_BOOK_ID,
        chapterCardId: reference.chapterCardId
      })
    );
    const selected = after.items.filter(
      (item) => item.role === "candidate" && item.selectedReference
    );
    if (
      after.bookId !== LOVE_BOOK_ID ||
      after.chapterCardId !== reference.chapterCardId ||
      selected.length !== 1 ||
      selected[0]?.path !== reference.path ||
      selected[0]?.hash !== reference.hash ||
      hash(reference.content) !== selected[0]?.contentHash
    )
      throw new Error(
        "作者选用的章节参考稿在上下文准备期间发生变化，请重新选择后再写稿。"
      );
  }
  const checked = await readIndex();
  const checkedCard = checked.plot.chapterCards.find(
    (card) => card.id === targetCard.id
  );
  const checkedOrder = [...checked.plot.chapterCards].sort((a, b) => {
    const av =
      checked.plot.volumes.find((v) => v.id === a.volumeId)?.order ??
      Number.MAX_SAFE_INTEGER;
    const bv =
      checked.plot.volumes.find((v) => v.id === b.volumeId)?.order ??
      Number.MAX_SAFE_INTEGER;
    return av - bv || a.narrativeOrder - b.narrativeOrder;
  });
  const checkedPrevious =
    checkedOrder[
      checkedOrder.findIndex((card) => card.id === targetCard.id) - 1
    ]?.id;
  const initialPrevious = previousCardId
    ? cards.find((card) => card.id === previousCardId)
    : undefined;
  const checkedPreviousCard = checkedPrevious
    ? checked.plot.chapterCards.find((card) => card.id === checkedPrevious)
    : undefined;
  const sameOrderAnchor = (
    before: typeof targetCard | undefined,
    after: typeof targetCard | undefined
  ) => {
    if (!before || !after) return before === after;
    const beforeVolumeOrder = initial.plot.volumes.find(
      (volume) => volume.id === before.volumeId
    )?.order;
    const afterVolumeOrder = checked.plot.volumes.find(
      (volume) => volume.id === after.volumeId
    )?.order;
    return (
      before.id === after.id &&
      before.volumeId === after.volumeId &&
      before.narrativeOrder === after.narrativeOrder &&
      beforeVolumeOrder === afterVolumeOrder
    );
  };
  if (
    !checkedCard ||
    JSON.stringify(checkedCard.outlineSelection ?? null) !==
      JSON.stringify(selection ?? null) ||
    checked.chapters.find((chapter) => chapter.chapterCardId === targetCard.id)
      ?.card.id !== targetEntry.card.id ||
    checkedPrevious !== previousCardId ||
    !sameOrderAnchor(targetCard, checkedCard) ||
    !sameOrderAnchor(initialPrevious, checkedPreviousCard)
  )
    throw new Error(
      "本章选择的大纲、章节来源或相邻章顺序在读取期间变化，请重新发送。"
    );
  return {
    ...context,
    longWorkspace: {
      ...clean,
      activeChapterCardId: targetCard.id,
      navigation: createLongWorkspaceNavigationSnapshot(checked),
      ...(refs.length ? { selectedDraftReferences: refs } : {}),
      ...(outline ? { selectedChapterOutline: outline } : {})
    }
  };
}
