import { describe, expect, it } from "vitest";
import {
  ModelConfigInputSchema,
  ModelConfigStoredSchema,
  modelCapacityIssue
} from "./model-configuration";

const baseModel = {
  id: "writer",
  label: "Writer",
  provider: "custom",
  modelId: "writer-v1",
  api: "openai-completions" as const,
  baseUrl: "https://example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off" as const,
  thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
  temperatureOptions: [0.1, 0.7, 1]
};

describe("model capacity validation", () => {
  it("rejects equal context and output limits on new or edited settings", () => {
    const saved = ModelConfigInputSchema.safeParse({
      ...baseModel,
      contextWindow: 1_000_000,
      maxTokens: 1_000_000
    });
    expect(saved.success).toBe(false);
    expect(modelCapacityIssue(1_000_000, 1_000_000)).toContain(
      "at least 8,192"
    );
  });

  it("accepts capacity that reserves runtime overhead and input", () => {
    expect(
      ModelConfigInputSchema.safeParse({
        ...baseModel,
        contextWindow: 1_000_000,
        maxTokens: 4_096
      }).success
    ).toBe(true);
    expect(modelCapacityIssue(1_000_000, 4_096)).toBeUndefined();
  });

  it("keeps a legacy invalid saved model readable for correction", () => {
    const legacy = {
      ...baseModel,
      contextWindow: 1_000_000,
      maxTokens: 1_000_000
    };
    expect(ModelConfigStoredSchema.safeParse(legacy).success).toBe(true);
    expect(ModelConfigInputSchema.safeParse(legacy).success).toBe(false);
  });
});
