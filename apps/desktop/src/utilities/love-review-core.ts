import {
  LoveReviewSnapshotSchema,
  type LongPrepareLoveReviewInput,
  type LongSubmitLoveReviewInput
} from "@deepwrite/contracts";
import type { LongWorkspaceFileReference } from "@deepwrite/contracts";
import type { LongWorkspaceService } from "./long-workspace-service";
import { readNativeComparisonEvidence } from "./native-comparison-evidence";
import { requireProject } from "./novel-writing-store";
import { readReviewFile } from "./love-review-files";
import {
  findLatestLoveReviewIdAtRoot,
  prepareLoveReviewAtRoot,
  submitLoveReviewAtRoot,
  type NativeReviewSources
} from "./love-review-store";

const LOVE_BOOK_ID = "longbook_9a146bbe" as const;
const MAX_DOCUMENT_CHARACTERS = 500_000;
const DOCUMENT_PAGE_SIZE = 32_768;

interface ReviewLocator {
  chapter?: number;
  volume: string;
}

async function locatorFromReview(
  root: string,
  reviewId: string,
  sessionId: string
): Promise<ReviewLocator> {
  if (!/^review-[a-zA-Z0-9-]{16,100}$/u.test(reviewId))
    throw new Error("审阅批次标识无效。");
  const parsed = JSON.parse(
    await readReviewFile(root, `.novel/reviews/${reviewId}/manifest.json`)
  ) as { sessionId?: unknown; snapshot?: unknown };
  const snapshot = LoveReviewSnapshotSchema.parse(parsed.snapshot);
  if (parsed.sessionId !== sessionId || snapshot.reviewId !== reviewId)
    throw new Error("审阅批次不属于当前作品会话，不能借用其他会话结果。");
  return { chapter: snapshot.chapter, volume: snapshot.volume };
}

async function readWholeDocument(
  service: LongWorkspaceService,
  input: {
    bookId: string;
    file: LongWorkspaceFileReference;
  }
): Promise<string> {
  let offset = 0;
  let expectedTotal: number | undefined;
  let content = "";
  let charactersRead = 0;
  for (;;) {
    const page = await service.readDocument({
      bookId: input.bookId,
      fileId: input.file.id,
      offset,
      maxCharacters: DOCUMENT_PAGE_SIZE
    });
    if (
      page.bookId !== input.bookId ||
      page.file.id !== input.file.id ||
      page.file.path !== input.file.path ||
      page.file.updatedAt !== input.file.updatedAt ||
      page.offset !== offset ||
      (expectedTotal !== undefined && page.totalCharacters !== expectedTotal)
    )
      throw new Error(`审阅资料在分页读取中变化：${input.file.path}`);
    expectedTotal = page.totalCharacters;
    if (expectedTotal > MAX_DOCUMENT_CHARACTERS)
      throw new Error(`审阅资料超过完整读取上限：${input.file.path}`);
    content += page.content;
    charactersRead += Array.from(page.content).length;
    if (content.length > MAX_DOCUMENT_CHARACTERS)
      throw new Error(`审阅资料超过完整读取上限：${input.file.path}`);
    if (page.nextOffset === null) {
      if (charactersRead !== expectedTotal)
        throw new Error(`审阅资料分页不完整：${input.file.path}`);
      return content;
    }
    if (page.nextOffset <= offset)
      throw new Error(`审阅资料分页游标异常：${input.file.path}`);
    offset = page.nextOffset;
  }
}

async function resolveNativeSources(
  service: LongWorkspaceService,
  root: string,
  locator: ReviewLocator
): Promise<{ root: string; native: NativeReviewSources }> {
  const { bookId, workspaceIndex: index } = await service.getWorkspaceIndex({
    bookId: LOVE_BOOK_ID
  });
  if (bookId !== LOVE_BOOK_ID || index.bookId !== LOVE_BOOK_ID)
    throw new Error("当前长篇不是登记的 LOVE 原生书库。");

  const volumes = new Map(
    index.plot.volumes.map((volume) => [volume.id, volume])
  );
  let cards =
    locator.chapter === undefined
      ? [...index.plot.chapterCards]
      : index.plot.chapterCards.filter(
          (card) => card.narrativeOrder === locator.chapter
        );
  if (locator.volume)
    cards = cards.filter(
      (card) => volumes.get(card.volumeId)?.title === locator.volume
    );
  if (cards.length !== 1)
    throw new Error(
      cards.length === 0
        ? "LOVE 原生书库中找不到指定卷章。"
        : "该章号在多个卷中重复，请同时指定卷名；不会猜测目标。"
    );
  const card = cards[0]!;
  const chapter = card.narrativeOrder;
  const volume = volumes.get(card.volumeId);
  if (!volume) throw new Error("LOVE 章卡所属卷不存在。");
  const chapterEntry = index.chapters.filter(
    (entry) => entry.chapterCardId === card.id
  );
  if (chapterEntry.length !== 1)
    throw new Error("LOVE 原生章卡与正文索引缺失或不唯一。");
  const files = chapterEntry[0]!;
  const [cardContent, bodyContent, evidence] = await Promise.all([
    readWholeDocument(service, { bookId, file: files.card }),
    readWholeDocument(service, { bookId, file: files.body }),
    readNativeComparisonEvidence(service, index)
  ]);
  if (!cardContent.trim() || !evidence.trim())
    throw new Error("LOVE 章卡或项目原生资料为空，审阅准备未完成。");
  return {
    root,
    native: {
      chapter,
      volume: volume.title,
      cardPath: files.card.path,
      cardContent,
      bodyPath: files.body.path,
      bodyContent,
      evidence
    }
  };
}

async function locateRequest(
  root: string,
  sessionId: string,
  input: {
    reviewId?: string;
    chapter?: number;
    volume?: string;
  }
): Promise<ReviewLocator> {
  if (input.reviewId) {
    const stored = await locatorFromReview(root, input.reviewId, sessionId);
    if (
      (input.chapter !== undefined && input.chapter !== stored.chapter) ||
      (input.volume !== undefined && input.volume !== stored.volume)
    )
      throw new Error("卷章与既有审阅批次不一致。");
    return stored;
  }
  return {
    ...(input.chapter !== undefined ? { chapter: input.chapter } : {}),
    volume: input.volume ?? ""
  };
}

export async function prepareLoveReviewCore(
  service: LongWorkspaceService,
  userDataPath: string,
  sessionId: string,
  request: LongPrepareLoveReviewInput
) {
  if (request.bookId !== LOVE_BOOK_ID)
    throw new Error("LOVE 审阅入口只接受 LOVE 原生书库。");
  // A reviewId is resolved from its same-session manifest before requiring the
  // current index, so retries remain attached to the original target version.
  const { project } = await requireProject(userDataPath);
  if (!sessionId.trim()) throw new Error("LOVE 审阅需要当前会话身份。");
  if (
    request.resumeLatest &&
    (request.chapter === undefined || !request.volume?.trim())
  )
    throw new Error("恢复最新审阅批次必须明确提供卷名和章号。");
  const reviewId =
    request.reviewId ??
    (request.resumeLatest
      ? await findLatestLoveReviewIdAtRoot({
          root: project.projectRoot,
          sessionId,
          chapter: request.chapter!,
          volume: request.volume!,
          targetKind: request.targetKind
        })
      : undefined);
  const locator = await locateRequest(project.projectRoot, sessionId, {
    ...(reviewId ? { reviewId } : {}),
    ...(request.chapter !== undefined ? { chapter: request.chapter } : {}),
    ...(request.volume !== undefined ? { volume: request.volume } : {})
  });
  const { root, native } = await resolveNativeSources(
    service,
    project.projectRoot,
    locator
  );
  return await prepareLoveReviewAtRoot({
    root,
    sessionId,
    request: {
      ...request,
      ...(!request.resumeLatest && reviewId ? { reviewId } : {})
    },
    native
  });
}

export async function submitLoveReviewCore(
  service: LongWorkspaceService,
  userDataPath: string,
  sessionId: string,
  request: LongSubmitLoveReviewInput
) {
  if (request.bookId !== LOVE_BOOK_ID)
    throw new Error("LOVE 审阅入口只接受 LOVE 原生书库。");
  const { project } = await requireProject(userDataPath);
  if (!sessionId.trim()) throw new Error("LOVE 审阅需要当前会话身份。");
  const locator = await locatorFromReview(
    project.projectRoot,
    request.reviewId,
    sessionId
  );
  const { root, native } = await resolveNativeSources(
    service,
    project.projectRoot,
    locator
  );
  return await submitLoveReviewAtRoot({ root, sessionId, request, native });
}
