import { describe, expect, it } from "vitest";
import { findDeepWriteRuntimeModel } from "./runtime-model-catalog";

describe("DeepWrite runtime model catalog", () => {
  it("matches provider route suffixes by model id prefix", () => {
    expect(findDeepWriteRuntimeModel("deepseek-v4-flash-0731-high")?.id).toBe(
      "deepseek-v4-flash-0731"
    );
  });

  it("prefers the longest matching prefix", () => {
    expect(
      findDeepWriteRuntimeModel("deepseek-v4-flash-0731-preview")?.id
    ).toBe("deepseek-v4-flash-0731");
  });

  it("matches provider route prefixes by model id suffix", () => {
    expect(
      findDeepWriteRuntimeModel("enterprise-deepseek-v4-flash-0731")?.id
    ).toBe("deepseek-v4-flash-0731");
  });

  it("keeps prefix matching case-insensitive", () => {
    expect(findDeepWriteRuntimeModel("DEEPSEEK-V4-FLASH-ROUTED")?.id).toBe(
      "deepseek-v4-flash"
    );
  });

  it("treats DeepSeek V4 Flash Vision Exp as a multimodal Flash model", () => {
    expect(
      findDeepWriteRuntimeModel("deepseek-v4-flash-vision-exp")
    ).toMatchObject({
      id: "deepseek-v4-flash-vision-exp",
      input: ["text", "image"],
      reasoning: true,
      contextWindow: 1_000_000,
      maxTokens: 384_000
    });
  });

  it.each(["grok-4.5", "grok-4.6"])(
    "keeps the full 500K capacity for %s custom routes",
    (modelId) => {
      expect(findDeepWriteRuntimeModel(`${modelId}-routed`)).toMatchObject({
        id: modelId,
        contextWindow: 500_000,
        maxTokens: 500_000
      });
    }
  );

  it("exposes the official GLM-5.3 capacity and mandatory thinking levels", () => {
    expect(findDeepWriteRuntimeModel("glm-5.3-routed")).toMatchObject({
      id: "glm-5.3",
      input: ["text"],
      contextWindow: 1_000_000,
      maxTokens: 131_072,
      thinkingLevelMap: {
        off: null,
        low: "low",
        high: "high",
        xhigh: "max"
      }
    });
  });

  it("does not match an unrelated model id", () => {
    expect(findDeepWriteRuntimeModel("unrelated-model-route")).toBeUndefined();
  });
});
