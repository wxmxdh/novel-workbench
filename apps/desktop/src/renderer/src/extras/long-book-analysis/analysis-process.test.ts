import { describe, expect, it } from "vitest";
import { formatAnalysisProgress } from "./analysis-process";

describe("long-book analysis progress labels", () => {
  it("does not add a phantom step after the selected preset completes", () => {
    expect(formatAnalysisProgress("final", 1, 2)).toBe(
      "生成正式结果 · 处理步骤 1/2"
    );
    expect(formatAnalysisProgress("final", 2, 2)).toBe(
      "生成正式结果 · 处理步骤 2/2"
    );
  });
});
