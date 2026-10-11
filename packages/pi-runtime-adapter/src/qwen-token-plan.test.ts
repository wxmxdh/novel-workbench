import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { buildProviderRuntime } from "./provider-runtime";

describe("Qwen Token Plan", () => {
  it.each(["off", "medium"] as const)(
    "serializes %s thinking with the Qwen control on the dedicated route",
    async (thinking) => {
      const config: AgentProviderRuntimeConfig = {
        id: "token-plan-writer",
        label: "Token Plan writer",
        provider: "qwen-token-plan",
        modelId: "qwen-test-writer",
        api: "openai-completions",
        baseUrl: "https://token-plan.example.test/compatible-mode/v1",
        apiKey: "invalid-test-key",
        reasoning: thinking !== "off",
        defaultThinkingLevel: thinking,
        thinkingLevelOptions: ["medium"],
        temperatureOptions: [0.2, 0.6, 1.2]
      };
      const { model, streamFn } = buildProviderRuntime(
        config,
        thinking === "off" ? 0.6 : undefined,
        thinking
      );
      expect(model.provider).toBe(config.provider);
      expect(model.baseUrl).toBe(config.baseUrl);

      let captured: unknown;
      const stream = await streamFn(
        model,
        { messages: [{ role: "user", content: "Hello", timestamp: 0 }] },
        {
          ...(thinking === "medium" ? { reasoning: thinking } : {}),
          onPayload: (payload) => {
            captured = payload;
            throw new Error("Stop before sending a request");
          }
        }
      );
      await stream.result();
      expect(captured).toMatchObject({
        model: config.modelId,
        enable_thinking: thinking !== "off",
        ...(thinking === "off" ? { temperature: 0.6 } : {})
      });
    }
  );
});
