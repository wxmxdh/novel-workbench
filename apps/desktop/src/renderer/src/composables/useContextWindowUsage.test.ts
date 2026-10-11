import { effectScope, isProxy, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ModelConfig, ModelConfigInput } from "@deepwrite/contracts";
import { useContextWindowUsage } from "./useContextWindowUsage";

function model(id: string, contextWindow?: number): ModelConfig {
  return {
    id,
    label: id,
    provider: "example",
    modelId: `${id}-runtime`,
    api: "openai-responses",
    baseUrl: "https://api.example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.1, 0.7, 1],
    ...(contextWindow === undefined
      ? {}
      : { contextWindow, maxTokens: Math.min(128_000, contextWindow) }),
    hasApiKey: true
  };
}

function deferredCapacity() {
  let resolve!: (value: {
    modelId: string;
    contextWindow: number;
    maxTokens: number;
  }) => void;
  const promise = new Promise<{
    modelId: string;
    contextWindow: number;
    maxTokens: number;
  }>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("useContextWindowUsage", () => {
  it("prefers the saved context window without resolving runtime capacity", () => {
    const selected = ref<ModelConfig | undefined>(model("saved", 500_000));
    const resolver = vi.fn();
    const scope = effectScope();
    const state = scope.run(() =>
      useContextWindowUsage({
        messages: () => [],
        selectedModel: () => selected.value,
        resolveCapacity: resolver
      })
    )!;

    expect(state.capacityStatus.value).toBe("resolved");
    expect(state.contextWindow.value).toBe(500_000);
    expect(resolver).not.toHaveBeenCalled();
    scope.stop();
  });

  it("uses the runtime capacity and ignores a stale model response", async () => {
    const first = deferredCapacity();
    const second = deferredCapacity();
    const selected = ref<ModelConfig | undefined>(model("first"));
    const resolver = vi.fn((input: ModelConfigInput) =>
      input.id === "first" ? first.promise : second.promise
    );
    const scope = effectScope();
    const state = scope.run(() =>
      useContextWindowUsage({
        messages: () => [],
        selectedModel: () => selected.value,
        resolveCapacity: resolver
      })
    )!;

    selected.value = model("second");
    await nextTick();
    first.resolve({
      modelId: "first",
      contextWindow: 100_000,
      maxTokens: 20_000
    });
    await Promise.resolve();
    expect(state.contextWindow.value).toBeUndefined();
    expect(state.capacityStatus.value).toBe("resolving");

    second.resolve({
      modelId: "second",
      contextWindow: 800_000,
      maxTokens: 100_000
    });
    await Promise.resolve();
    expect(state.contextWindow.value).toBe(800_000);
    expect(state.capacityStatus.value).toBe("resolved");
    scope.stop();
  });

  it("passes a plain model snapshot across the preload boundary", async () => {
    const selected = ref<ModelConfig | undefined>(model("reactive"));
    const resolver = vi.fn(async (input: ModelConfigInput) => {
      expect(isProxy(selected.value)).toBe(true);
      expect(isProxy(input)).toBe(false);
      expect(isProxy(input.thinkingLevelOptions)).toBe(false);
      expect(isProxy(input.temperatureOptions)).toBe(false);
      expect(input).not.toHaveProperty("hasApiKey");
      return {
        modelId: input.id,
        contextWindow: 272_000,
        maxTokens: 128_000
      };
    });
    const scope = effectScope();
    const state = scope.run(() =>
      useContextWindowUsage({
        messages: () => [],
        selectedModel: () => selected.value,
        resolveCapacity: resolver
      })
    )!;

    await Promise.resolve();
    expect(resolver).toHaveBeenCalledOnce();
    expect(state.capacityStatus.value).toBe("resolved");
    expect(state.contextWindow.value).toBe(272_000);
    scope.stop();
  });

  it("exposes an unavailable state when real capacity cannot be resolved", async () => {
    const selected = ref<ModelConfig | undefined>(model("unavailable"));
    const scope = effectScope();
    const state = scope.run(() =>
      useContextWindowUsage({
        messages: () => [],
        selectedModel: () => selected.value,
        resolveCapacity: () => Promise.reject(new Error("unavailable"))
      })
    )!;

    await Promise.resolve();
    expect(state.capacityStatus.value).toBe("unavailable");
    expect(state.contextWindow.value).toBeUndefined();
    scope.stop();
  });
});
