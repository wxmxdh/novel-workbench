import type { LongSourceFolder } from "@deepwrite/contracts";

/** A local-path request opens the existing picker; it never grants filesystem access. */
export function localSourceRequest(
  prompt: string,
  folders: readonly LongSourceFolder[] = []
): { suggestedPath?: string } | undefined {
  if (
    /(?:不要|先别|不用|别|do not|don't)\s*.{0,12}(?:读|看|打开|接入|导入|连接|read|open|connect)/iu.test(
      prompt
    )
  )
    return;
  if (
    !/(?:读|看|打开|访问|扫描|导入|接入|连接|read|open|connect|import)/iu.test(
      prompt
    )
  )
    return;
  const quoted = prompt.match(
    /[`"'“]([A-Za-z]:[\\/][^`"'“”\r\n]+)[`"'”]/u
  )?.[1];
  const unquoted = prompt.match(
    /[A-Za-z]:[\\/][^\r\n"“”<>|?*，。；！？]+/u
  )?.[0];
  const markdownFilePath = unquoted?.match(
    /^.*?\.md(?=$|[^A-Za-z0-9_])/iu
  )?.[0];
  const path = (quoted ?? markdownFilePath ?? unquoted)?.trim();
  if (path) {
    const normalize = (value: string) =>
      value.replaceAll("/", "\\").replace(/\\+$/u, "").toLowerCase();
    const requested = normalize(path);
    if (
      folders.some(
        ({ rootPath }) =>
          requested === normalize(rootPath) ||
          requested.startsWith(`${normalize(rootPath)}\\`)
      )
    )
      return;
    return { suggestedPath: path };
  }
  if (
    !folders.length &&
    /(?:本地|电脑|文件夹|资料库|local.{0,12}folder)/iu.test(prompt)
  )
    return {};
}

const LOVE_BOOK_ID = "longbook_9a146bbe";

/**
 * Routes the LOVE annotation handoff through Main. This is UI routing only;
 * Main/Core still validates the active book and every requested file path.
 */
export function localSourceRequestForConversation(
  prompt: string,
  bookId: string | undefined,
  hasAttachments: boolean,
  folders: readonly LongSourceFolder[] = []
): { suggestedPath?: string } | undefined {
  if (hasAttachments || isLoveAnnotationReviewRequest(prompt, bookId))
    return undefined;
  return localSourceRequest(prompt, folders);
}

function isLoveAnnotationReviewRequest(
  prompt: string,
  bookId: string | undefined
): boolean {
  if (bookId !== LOVE_BOOK_ID) return false;
  if (/\bWhat\s+Is\s+Love\b/iu.test(prompt)) return false;
  const leadingRequest = prompt.trimStart().slice(0, 64);
  if (
    /^(?:请)?(?:不要|先别|暂不|不必|不用|别|请勿|do not|don't)\s*.{0,12}(?:读|看|打开|访问|核对|审阅|read|open)/iu.test(
      leadingRequest
    )
  )
    return false;
  if (/(?:导入|接入|连接|import|connect)/iu.test(prompt)) return false;
  const isHandoffHeader = /^\s*(?:#{1,6}\s*)?作者批注回读/u.test(prompt);
  const isNaturalChapterReview =
    /(?:批注|作者意见|审阅意见)/u.test(prompt) &&
    /(?:回读|读取|读|看|核对|审阅|讨论|梳理)/u.test(prompt) &&
    /第\s*(?:\d{1,3}|[一二三四五六七八九十百零〇两]+)\s*章/u.test(prompt);
  if (!isHandoffHeader && !isNaturalChapterReview) return false;

  const pathStarts = [...prompt.matchAll(/[A-Za-z]:[\\/]/gu)].map(
    (match) => match.index ?? -1
  );
  if (pathStarts.length === 0) return isNaturalChapterReview;
  if (!isHandoffHeader || !hasLoveProjectRootHeader(prompt)) return false;
  return pathStarts.every((index, pathIndex) => {
    const end = pathStarts[pathIndex + 1] ?? prompt.length;
    return hasLoveProjectPathShape(prompt.slice(index, end));
  });
}

function hasLoveProjectRootHeader(prompt: string): boolean {
  const match =
    /(?:项目根目录|项目路径)\s*[:：]\s*[`"'“]?([A-Za-z]:[\\/][^`"'“”\r\n]+)/iu.exec(
      prompt
    );
  if (!match?.[1]) return false;
  return hasLoveProjectPathShape(match[1]);
}

function hasLoveProjectPathShape(path: string): boolean {
  return /(?:^|[\\/])00_创作项目[\\/]项目[\\/]LOVE(?:[\\/\s`"']|$)/iu.test(
    normalizeWindowsPath(path)
  );
}

function normalizeWindowsPath(value: string): string {
  return value.replaceAll("/", "\\").replace(/\\+/gu, "\\");
}
