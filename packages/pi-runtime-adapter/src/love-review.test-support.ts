import { createHash } from "node:crypto";
import type { LoveReviewSnapshot, CommandResult } from "@deepwrite/contracts";
import type { LoveReviewCommandExecutor } from "./love-review-runtime";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function reviewFixture(
  authorText: string,
  reviewers = ["love-outline"]
) {
  const entry = (id: string, content: string) => ({
    id,
    path: `${id}.md`,
    role: id,
    sha256: hash(content),
    content
  });
  const targets = [
    {
      ...entry("draft-1", "实际磁盘稿件：我把表格放在桌上。"),
      version: "fixture-current"
    }
  ];
  const sources = [
    entry("author-request", authorText),
    entry("rules", "局部批评保持局部，允许正常情绪。")
  ];
  const setHash = (entries: typeof sources) =>
    hash(JSON.stringify(entries.map(({ id, sha256 }) => ({ id, sha256 }))));
  const snapshot: LoveReviewSnapshot = {
    reviewId: "review-1234567890123456",
    bookId: "longbook_9a146bbe",
    chapter: 1,
    volume: "第一卷",
    targetKind: "drafts",
    reviewerIds: reviewers,
    authorText,
    targets,
    sources,
    targetSetSha256: setHash(targets),
    sourceSetSha256: setHash(sources),
    reports: [],
    coverage: {
      reviewId: "review-1234567890123456",
      targetSetSha256: setHash(targets),
      state: "incomplete",
      expectedCount: reviewers.length,
      completedCount: 0,
      missingReviewerIds: reviewers,
      phase: "specialist"
    }
  };
  const executor: LoveReviewCommandExecutor = async (command) => {
    let payload: unknown;
    if (command.type === "long.prepareLoveReview")
      payload = structuredClone(snapshot);
    else {
      const { reviewerId, phase, report, runtime } = command.payload;
      snapshot.reports = snapshot.reports.filter(
        (entry) =>
          entry.reviewerId !== reviewerId &&
          (phase === "independent" || entry.phase !== "independent") &&
          (phase !== "specialist" || entry.phase !== "summary")
      );
      snapshot.reports.push({ reviewerId, phase, report, runtime });
      const missingReviewerIds = reviewers.filter(
        (id) =>
          !snapshot.reports.some(
            (entry) =>
              entry.reviewerId === id && entry.report.status === "reviewed"
          )
      );
      snapshot.coverage = {
        ...snapshot.coverage,
        phase,
        completedCount: reviewers.length - missingReviewerIds.length,
        missingReviewerIds,
        state: missingReviewerIds.length
          ? "incomplete"
          : phase === "independent"
            ? "ready"
            : "needs_independent_review"
      };
      payload = { coverage: structuredClone(snapshot.coverage) };
    }
    return {
      status: "accepted",
      requestId: command.id,
      payload
    } satisfies CommandResult;
  };
  const report = (extraIds: string[] = []) =>
    JSON.stringify({
      status: "reviewed",
      summary: "逐篇审阅，仅为建议。",
      findings: [],
      missingSources: [],
      reviewedSourceIds: [...targets, ...sources]
        .map((entry) => entry.id)
        .concat(extraIds)
    });
  return { snapshot, executor, report };
}
