import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ModelConfig } from "@deepwrite/contracts/renderer";
import {
  CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY,
  useChatAssistantWebSearch
} from "./useChatAssistantWebSearch";

function model(provider: string, api: ModelConfig["api"]): ModelConfig {
  return {
    id: `${provider}-${api}`,
    label: "Test model",
    provider,
    modelId: "test-model",
    api,
    baseUrl: "https://provider.example.test",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low"],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: true
  };
}

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY, initial);
  }
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    value: () => values.get(CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY)
  };
}

describe("chat assistant web search preference", () => {
  it("restores an enabled preference for a compatible model", () => {
    const selectedModel = ref<ModelConfig | undefined>(
      model("deepseek", "openai-responses")
    );
    const persisted = storage("true");
    const feature = useChatAssistantWebSearch({
      selectedModel,
      storage: persisted
    });

    expect(feature.available.value).toBe(true);
    expect(feature.enabled.value).toBe(true);
  });

  it("auto-disables and persists when the selected model becomes incompatible", async () => {
    const selectedModel = ref<ModelConfig | undefined>(
      model("deepseek", "anthropic-messages")
    );
    const persisted = storage("true");
    const onAutomaticallyDisabled = vi.fn();
    const feature = useChatAssistantWebSearch({
      selectedModel,
      storage: persisted,
      onAutomaticallyDisabled
    });

    selectedModel.value = model("deepseek", "openai-completions");
    await Promise.resolve();

    expect(feature.available.value).toBe(false);
    expect(feature.enabled.value).toBe(false);
    expect(persisted.value()).toBe("false");
    expect(onAutomaticallyDisabled).toHaveBeenCalledOnce();
  });

  it("does not enable an unavailable model", () => {
    const selectedModel = ref<ModelConfig | undefined>(
      model("custom", "openai-responses")
    );
    const persisted = storage();
    const feature = useChatAssistantWebSearch({
      selectedModel,
      storage: persisted
    });

    expect(feature.setEnabled(true)).toBe(false);
    expect(feature.enabled.value).toBe(false);
    expect(persisted.setItem).not.toHaveBeenCalled();
  });
});
