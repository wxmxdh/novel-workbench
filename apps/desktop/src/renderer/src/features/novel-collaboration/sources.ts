import type {
  LongWorkspaceIndexSnapshot,
  VersionedNovelSource
} from "@deepwrite/contracts";
import { extractSearchQueries } from "./review";

export interface NovelChapterSource extends VersionedNovelSource {
  content: string;
  role: "bookLine" | "outline" | "draft";
  outlineState:
    "unselected" | "selected-current" | "selected-stale" | "not-applicable";
  outlineVersion?: string;
}

export type NovelOutlineSelectionState =
  "unselected" | "selected-current" | "selected-stale" | "not-applicable";

export function classifyOutlineSelection(
  selection:
    | {
        sha256: string;
        status?: "current" | "needs-recheck" | undefined;
      }
    | undefined,
  currentSha256: string
): Exclude<NovelOutlineSelectionState, "not-applicable"> {
  if (!selection) return "unselected";
  if (
    selection.status === "needs-recheck" ||
    selection.sha256 !== currentSha256
  )
    return "selected-stale";
  return "selected-current";
}

export interface NovelSearchHit {
  fileId: string;
  path: string;
  start: number;
  end: number;
  snippet: string;
  updatedAt: string;
}

export async function readNovelChapterSources(
  bookId: string,
  chapterCardId: string,
  snapshot: LongWorkspaceIndexSnapshot
): Promise<{
  sources: NovelChapterSource[];
  snapshot: LongWorkspaceIndexSnapshot;
  warning: string;
}> {
  if (snapshot.bookId !== bookId)
    throw new Error("当前选择的作品与章节资料不匹配。");
  const api = window.deepwrite?.long;
  if (!api) throw new Error("长篇工作区暂时不可用。");
  const initial = await api.getWorkspaceIndex({ bookId });
  if (initial.bookId !== bookId || initial.workspaceIndex.bookId !== bookId)
    throw new Error("当前作品已变化，不能读取其他作品的章节资料。");
  const current = initial.workspaceIndex;
  const files = current.chapters.find(
    (entry) => entry.chapterCardId === chapterCardId
  );
  if (!files) throw new Error("没有找到这一章的规划和正文文件。");
  const sources: NovelChapterSource[] = [];
  const bookLine = current.bookLine;
  const bookLineRead = await readAll(bookId, bookLine.id);
  const bookLineIndex = await api.getWorkspaceIndex({ bookId });
  if (
    bookLineIndex.bookId !== bookId ||
    bookLineIndex.workspaceIndex.bookId !== bookId ||
    bookLineIndex.workspaceIndex.bookLine.id !== bookLine.id ||
    bookLineIndex.workspaceIndex.bookLine.updatedAt !== bookLine.updatedAt ||
    bookLineRead.updatedAt !== bookLine.updatedAt
  )
    throw new Error("作品主线在读取时发生变化，请刷新后重试。");
  sources.push({
    bookId,
    fileId: bookLine.id,
    path: bookLine.path,
    updatedAt: bookLine.updatedAt,
    sha256: await sha256(bookLineRead.content),
    content: bookLineRead.content,
    role: "bookLine",
    outlineState: "not-applicable"
  });
  let currentSnapshot = bookLineIndex.workspaceIndex;
  for (const { role, file } of [
    { role: "outline" as const, file: files.card },
    { role: "draft" as const, file: files.body }
  ]) {
    const read = await readAll(bookId, file.id);
    const index = await api.getWorkspaceIndex({ bookId });
    if (index.bookId !== bookId || index.workspaceIndex.bookId !== bookId)
      throw new Error("返回的资料属于其他作品，已停止读取。");
    const latestFile = index.workspaceIndex.chapters.find(
      (entry) => entry.chapterCardId === chapterCardId
    )?.[role === "outline" ? "card" : "body"];
    if (
      !latestFile ||
      latestFile.id !== file.id ||
      latestFile.updatedAt !== file.updatedAt ||
      read.updatedAt !== file.updatedAt
    )
      throw new Error("大纲或正文在读取时发生变化，请刷新后重试。");
    const outlineSelection = index.workspaceIndex.plot.chapterCards.find(
      (item) => item.id === chapterCardId
    )?.outlineSelection;
    const digest = await sha256(read.content);
    const outlineState =
      role === "draft"
        ? "not-applicable"
        : classifyOutlineSelection(outlineSelection, digest);
    sources.push({
      bookId,
      fileId: file.id,
      path: file.path,
      updatedAt: file.updatedAt,
      sha256: digest,
      content: read.content,
      role,
      outlineState,
      ...(role === "outline" && outlineSelection
        ? { outlineVersion: outlineSelection.version }
        : {})
    });
    currentSnapshot = index.workspaceIndex;
  }
  const card = currentSnapshot.plot.chapterCards.find(
    (item) => item.id === chapterCardId
  );
  const outlineSource = sources.find((source) => source.role === "outline");
  const warning =
    card?.outlineSelection?.status === "needs-recheck" ||
    outlineSource?.outlineState === "selected-stale"
      ? "当前选定的大纲需要重新核对，仍可查找原文，但暂不能调用模型。"
      : card?.outlineSelection
        ? ""
        : "本章尚未明确选定大纲；模型只会收到当前章节卡和正文。";
  return { sources, snapshot: currentSnapshot, warning };
}

export function outlineSelectionDescription(
  snapshot: LongWorkspaceIndexSnapshot | null,
  chapterCardId: string
): string {
  const selection = snapshot?.plot.chapterCards.find(
    (item) => item.id === chapterCardId
  )?.outlineSelection;
  if (!selection) return "作者尚未将当前章节规划卡的某一版本明确选为本章大纲。";
  return `作者明确选定的本章大纲版本为「${selection.version}」，选择记录状态为「${selection.status ?? "未标记需复核"}」。本任务只按这份已选版本理解；不要把通用规划卡中的内容视作作者已确认的大纲以外的新正典。`;
}

export async function searchNovelPreviousText(
  bookId: string,
  chapterCardId: string,
  question: string,
  scope: "draft" | "all"
): Promise<{
  queries: string[];
  hits: NovelSearchHit[];
  snapshot: LongWorkspaceIndexSnapshot;
}> {
  const api = window.deepwrite?.long;
  if (!api) throw new Error("长篇工作区暂时不可用。");
  const index = await api.getWorkspaceIndex({ bookId });
  if (index.bookId !== bookId || index.workspaceIndex.bookId !== bookId)
    throw new Error("当前作品已变化，不能搜索其他作品的内容。");
  const queries = extractSearchQueries(question);
  if (!queries.length)
    throw new Error("没有提取到可搜索的词，请改写问题或直接输入原文词语。");
  const found = new Map<string, NovelSearchHit>();
  for (const query of queries) {
    const results = await api.search({
      bookId,
      query,
      scope,
      limit: 40,
      maxSnippetCharacters: 420
    });
    if (results.bookId !== bookId)
      throw new Error("搜索结果属于其他作品，已停止显示。");
    for (const hit of results.hits) {
      const reference = findFileReference(index.workspaceIndex, hit.fileId);
      if (
        !reference ||
        (scope === "draft" &&
          isAfterCurrentChapter(
            index.workspaceIndex,
            chapterCardId,
            hit.fileId
          ))
      )
        continue;
      const page = await api.readDocument({
        bookId,
        fileId: hit.fileId,
        offset: hit.start,
        maxCharacters: Math.min(16_000, Math.max(80, hit.end - hit.start + 40))
      });
      if (
        page.bookId !== bookId ||
        page.file.id !== hit.fileId ||
        page.offset !== hit.start ||
        page.file.updatedAt !== reference.updatedAt ||
        page.content.slice(0, Array.from(query).length).normalize("NFC") !==
          query.normalize("NFC")
      )
        continue;
      found.set(`${hit.fileId}:${hit.start}`, {
        fileId: hit.fileId,
        path: hit.path,
        start: hit.start,
        end: hit.end,
        snippet: hit.snippet,
        updatedAt: reference.updatedAt
      });
    }
  }
  const latest = await api.getWorkspaceIndex({ bookId });
  if (latest.bookId !== bookId || latest.workspaceIndex.bookId !== bookId)
    throw new Error("当前作品已变化，不能显示这些结果。");
  const hits = [...found.values()]
    .filter(
      (hit) =>
        findFileReference(latest.workspaceIndex, hit.fileId)?.updatedAt ===
        hit.updatedAt
    )
    .slice(0, 30);
  return { queries, hits, snapshot: latest.workspaceIndex };
}

async function readAll(
  bookId: string,
  fileId: string
): Promise<{ content: string; updatedAt: string }> {
  const api = window.deepwrite?.long;
  if (!api) throw new Error("长篇工作区暂时不可用。");
  const pages: string[] = [];
  let offset = 0;
  let expectedTotal: number | undefined;
  let expectedUpdatedAt: string | undefined;
  do {
    const page = await api.readDocument({
      bookId,
      fileId,
      offset,
      maxCharacters: 16_000
    });
    if (
      page.bookId !== bookId ||
      page.file.id !== fileId ||
      page.offset !== offset
    )
      throw new Error("来源读取过程中发生变化，请刷新后重试。");
    expectedTotal ??= page.totalCharacters;
    expectedUpdatedAt ??= page.file.updatedAt;
    if (
      page.totalCharacters !== expectedTotal ||
      page.file.updatedAt !== expectedUpdatedAt
    )
      throw new Error("来源读取过程中发生变化，请刷新后重试。");
    pages.push(page.content);
    offset = page.nextOffset ?? expectedTotal;
    if (
      pages.reduce((size, part) => size + Array.from(part).length, 0) > 100_000
    )
      throw new Error(
        "本次资料超过协作服务的单文件长度限制，请缩小范围后再试。"
      );
  } while (offset < (expectedTotal ?? 0));
  return { content: pages.join(""), updatedAt: expectedUpdatedAt ?? "" };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function findFileReference(
  snapshot: LongWorkspaceIndexSnapshot,
  fileId: string
): { id: string; path: string; updatedAt: string } | undefined {
  const visited = new Set<object>();
  const visit = (
    value: unknown
  ): { id: string; path: string; updatedAt: string } | undefined => {
    if (!value || typeof value !== "object" || visited.has(value))
      return undefined;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = visit(item);
        if (result) return result;
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (
      record.id === fileId &&
      typeof record.path === "string" &&
      typeof record.updatedAt === "string"
    )
      return { id: fileId, path: record.path, updatedAt: record.updatedAt };
    for (const child of Object.values(record)) {
      const result = visit(child);
      if (result) return result;
    }
    return undefined;
  };
  return visit(snapshot);
}

export function hasCurrentNovelSourceVersion(
  snapshot: LongWorkspaceIndexSnapshot,
  fileId: string,
  updatedAt: string
): boolean {
  return findFileReference(snapshot, fileId)?.updatedAt === updatedAt;
}

function isAfterCurrentChapter(
  snapshot: LongWorkspaceIndexSnapshot,
  chapterCardId: string,
  fileId: string
): boolean {
  const cards = [...snapshot.plot.chapterCards].sort(
    (left, right) => left.narrativeOrder - right.narrativeOrder
  );
  const currentOrder = cards.find(
    (card) => card.id === chapterCardId
  )?.narrativeOrder;
  if (currentOrder === undefined) return true;
  return snapshot.chapters.some((entry) => {
    const order = cards.find(
      (card) => card.id === entry.chapterCardId
    )?.narrativeOrder;
    return (
      entry.body.id === fileId && order !== undefined && order > currentOrder
    );
  });
}
