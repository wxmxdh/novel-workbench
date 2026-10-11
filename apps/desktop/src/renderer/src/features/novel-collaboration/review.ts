import type {
  NovelPlotCandidateSet,
  NovelRequirementCheck,
  NovelRequirementReview,
  VersionedNovelSource
} from "@deepwrite/contracts";

const NOISE = [
  "请帮我",
  "帮我",
  "请找",
  "找一下",
  "查询",
  "查找",
  "搜索",
  "前文中",
  "前文",
  "相关内容",
  "相关片段",
  "那一段",
  "那段",
  "哪一章",
  "在哪里",
  "出现过",
  "提到过",
  "写到过",
  "的地方",
  "的内容",
  "一下",
  "时候",
  "当时"
];

export function extractSearchQueries(question: string): string[] {
  let cleaned = question.normalize("NFC").trim();
  for (const noise of NOISE) cleaned = cleaned.replaceAll(noise, " ");
  const clauses = cleaned
    .split(/[，。！？、；;,.!?\n]+/u)
    .map((part) => part.replace(/[“”"'「」『』]/gu, "").trim())
    .filter((part) => Array.from(part).length >= 2);
  const result: string[] = [];
  for (const clause of clauses) {
    const normalized = clause.replace(/\s+/gu, " ").trim();
    if (normalized && !result.includes(normalized)) result.push(normalized);
    const chinesePhrases = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
    for (const phrase of chinesePhrases) {
      if (phrase.length < 3) continue;
      if (phrase !== normalized && !result.includes(phrase))
        result.push(phrase);
      const searchable = phrase.replace(/[的了在着过]/gu, "");
      const tail = Array.from(searchable).slice(-2).join("");
      if (tail.length === 2 && !result.includes(tail)) result.push(tail);
    }
  }
  return result.slice(0, 5);
}

export interface ReviewFreshness {
  currentBookId: string;
  currentChapterCardId: string;
  currentSources: readonly VersionedNovelSource[];
  currentTextByFileId: ReadonlyMap<string, string>;
}

export interface CheckedNovelRequirement {
  check: NovelRequirementCheck;
  stale: boolean;
  message?: "source-changed" | "wrong-book";
}

export function validateRequirementReview(
  review: NovelRequirementReview,
  current: ReviewFreshness
): CheckedNovelRequirement[] {
  const sourceByKey = new Map(
    current.currentSources.map((source) => [sourceKey(source), source])
  );
  const reviewSourcesChanged = review.sources.some((source) => {
    if (source.bookId !== current.currentBookId) return true;
    const latest = sourceByKey.get(sourceKey(source));
    return (
      !latest ||
      latest.updatedAt !== source.updatedAt ||
      latest.sha256 !== source.sha256
    );
  });
  return review.checks.map((check) => {
    if (
      review.bookId !== current.currentBookId ||
      review.chapterCardId !== current.currentChapterCardId ||
      check.evidence.some(
        (item) => item.source.bookId !== current.currentBookId
      )
    ) {
      return {
        check: {
          ...check,
          status: "uncertain",
          note: "来源不属于当前作品或章节，需重新核对。"
        },
        stale: true,
        message: "wrong-book"
      };
    }
    if (reviewSourcesChanged) {
      return {
        check: {
          ...check,
          status: "uncertain",
          note: "核对所依据的大纲或正文已更新，需要重新检查。"
        },
        stale: true,
        message: "source-changed"
      };
    }
    for (const evidence of check.evidence) {
      const latest = sourceByKey.get(sourceKey(evidence.source));
      if (
        !latest ||
        latest.updatedAt !== evidence.source.updatedAt ||
        latest.sha256 !== evidence.source.sha256
      ) {
        return {
          check: {
            ...check,
            status: "uncertain",
            note: "原文或大纲已更新，这条结论需要重新核对。"
          },
          stale: true,
          message: "source-changed"
        };
      }
      const currentText = current.currentTextByFileId.get(
        evidence.source.fileId
      );
      if (
        currentText === undefined ||
        currentText.slice(evidence.start, evidence.end) !== evidence.quote
      ) {
        return {
          check: {
            ...check,
            status: "uncertain",
            note: "引用位置无法与当前原文对应。"
          },
          stale: true,
          message: "source-changed"
        };
      }
    }
    return { check, stale: false };
  });
}

function sourceKey(
  source: Pick<VersionedNovelSource, "bookId" | "fileId">
): string {
  return `${source.bookId}\u0000${source.fileId}`;
}

export function candidateSetIsCurrent(
  candidateSet: NovelPlotCandidateSet,
  currentBookId: string,
  currentChapterCardId: string,
  currentSources: readonly VersionedNovelSource[],
  currentOutlineSelection?: NovelPlotCandidateSet["outlineSelection"]
): boolean {
  if (
    candidateSet.bookId !== currentBookId ||
    candidateSet.chapterCardId !== currentChapterCardId
  )
    return false;
  if (
    JSON.stringify(candidateSet.outlineSelection ?? null) !==
    JSON.stringify(currentOutlineSelection ?? null)
  )
    return false;
  const current = new Map(
    currentSources.map((source) => [sourceKey(source), source])
  );
  return candidateSet.sources.every((source) => {
    const latest = current.get(sourceKey(source));
    return (
      latest?.updatedAt === source.updatedAt && latest.sha256 === source.sha256
    );
  });
}
