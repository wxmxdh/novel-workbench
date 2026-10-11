import { describe, expect, it } from "vitest";
import { normalizeDiskModelSettings } from "./free-model-settings-state";

describe("saved model capacity compatibility", () => {
  it("preserves a legacy capacity conflict so settings can display and fix it", () => {
    const settings = normalizeDiskModelSettings({
      version: 2,
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "custom",
          modelId: "writer-v1",
          api: "openai-completions",
          baseUrl: "https://example.test/v1",
          reasoning: false,
          defaultThinkingLevel: "off",
          thinkingLevelOptions: [
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ],
          temperatureOptions: [0.1, 0.7, 1],
          contextWindow: 1_000_000,
          maxTokens: 1_000_000
        }
      ]
    });
    expect(settings.models).toHaveLength(1);
    expect(settings.models[0]).toMatchObject({
      contextWindow: 1_000_000,
      maxTokens: 1_000_000
    });
  });
});
