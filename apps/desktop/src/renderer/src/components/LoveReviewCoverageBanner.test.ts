import { describe, expect, it } from "vitest";
import messageItemSource from "./ConversationMessageItem.vue?raw";
import bannerSource from "./LoveReviewCoverageBanner.vue?raw";

describe("LOVE review coverage banner", () => {
  it("shows the parent's machine coverage on the completed assistant turn", () => {
    expect(messageItemSource).toContain("message.reviewCoverage");
    expect(messageItemSource).toContain("<LoveReviewCoverageBanner");
  });

  it("uses an explicit status region and never labels review readiness as author approval", () => {
    expect(bannerSource).toContain('role="status"');
    expect(bannerSource).toContain("loveReviewCoverageLabel(coverage)");
    expect(bannerSource).toContain("data-love-review-coverage");
  });
});
