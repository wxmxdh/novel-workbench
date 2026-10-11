import type { LoveReviewCoverage } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
const t = createScopedTranslator("components.subagentRunPresentation");

export function loveReviewCoverageLabel(coverage: LoveReviewCoverage): string {
  if (coverage.state === "stale") return t("loveReviewTargetChanged");
  if (coverage.state === "incomplete")
    return t("loveReviewIncomplete", {
      arg0: coverage.completedCount,
      arg1: coverage.expectedCount,
      arg2: coverage.missingReviewerIds.length
    });
  if (coverage.state === "ready") return t("loveReviewReadyForAuthor");
  if (coverage.phase === "specialist")
    return t("loveReviewReportsReady");
  if (coverage.phase === "summary")
    return t("loveReviewSummaryAwaitingIndependentCheck");
  return t("loveReviewIndependentCheckInProgress");
}

