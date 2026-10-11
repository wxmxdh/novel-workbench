import { describe, expect, it } from "vitest";
import type {
  AgentProviderRuntimeConfig,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import { selectLoveWriters } from "./love-writer-selection";

const config: AgentProviderRuntimeConfig = {
  id: "audit-gemini-config",
  label: "Gemini 3.1 Pro",
  provider: "google",
  modelId: "gemini-3.1-pro",
  apiKey: "test-invalid-api-key",
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  reasoning: true,
  defaultThinkingLevel: "medium",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.2, 0.7, 1]
};
const definition: ShortAgentSubagentDefinition = {
  id: "love-writer-gemini",
  name: "Gemini 3.1 Pro",
  description: "audit writer",
  systemPrompt: "audit writer",
  enabled: true,
  modelMode: "custom",
  modelId: "audit-gemini-config"
};

describe("Main audit: requested model version cannot silently change", () => {
  it("rejects Gemini 2.5 when only Gemini 3.1 is configured", () => {
    expect(
      selectLoveWriters({
        authorText: "重试 Gemini 2.5 的第一章独立稿",
        definitions: [definition],
        runtimeConfigs: { [config.id]: config }
      })
    ).toBeUndefined();
  });

  it("does not trust a stale agent display name over its actual runtime model", () => {
    expect(
      selectLoveWriters({
        authorText: "重试 Gemini 2.5 的第一章独立稿",
        definitions: [{ ...definition, name: "Gemini 2.5 Pro" }],
        runtimeConfigs: { [config.id]: config }
      })
    ).toBeUndefined();
  });

  it("can still use a unique configured family if the author did not specify a version", () => {
    expect(
      selectLoveWriters({
        authorText: "重试 Gemini 的第一章独立稿",
        definitions: [definition],
        runtimeConfigs: { [config.id]: config }
      })?.writers[0]?.runtime.model
    ).toBe(config.modelId);
  });

  it("rejects a missing Flash variant rather than running the available Pro variant", () => {
    expect(
      selectLoveWriters({
        authorText: "重试 Gemini 2.5 Flash 的第一章独立稿",
        definitions: [definition],
        runtimeConfigs: {
          [config.id]: { ...config, modelId: "gemini-2.5-pro" }
        }
      })
    ).toBeUndefined();
  });

  it("rejects a missing R1 variant rather than running the available V3 variant", () => {
    expect(
      selectLoveWriters({
        authorText: "重试 DeepSeek R1 的第一章独立稿",
        definitions: [{ ...definition, id: "love-writer-deepseek" }],
        runtimeConfigs: {
          [config.id]: {
            ...config,
            provider: "deepseek",
            modelId: "deepseek-v3"
          }
        }
      })
    ).toBeUndefined();
  });
});
