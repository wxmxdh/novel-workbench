import {
  createDeferredApi,
  describe,
  document,
  expect,
  it,
  useAgentConversation,
  vi
} from "./useAgentConversation.test-support";

function deepseekResponsesModel() {
  return {
    id: "deepseek-writer",
    label: "DeepSeek Writer",
    provider: "deepseek",
    modelId: "deepseek-reasoner",
    api: "openai-responses" as const,
    baseUrl: "https://api.example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "high" as const,
    thinkingLevelOptions: ["low", "high"] as ["low", "high"],
    temperatureOptions: [0.1, 0.7, 1] as [number, number, number],
    hasApiKey: true
  };
}

function openaiModel() {
  return {
    id: "openai-writer",
    label: "OpenAI Writer",
    provider: "openai",
    modelId: "writer-model",
    api: "openai-responses" as const,
    baseUrl: "https://api.example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "high" as const,
    thinkingLevelOptions: ["low", "high"] as ["low", "high"],
    temperatureOptions: [0.1, 0.7, 1] as [number, number, number],
    hasApiKey: true
  };
}

describe("agent conversation controller: workspace web search", () => {
  it("sends the workspace web search flag for a compatible model", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.applyModelSettings({
      defaultModelId: "deepseek-writer",
      models: [deepseekResponsesModel()]
    });
    expect(controller.selectWebSearchEnabled(true)).toBeUndefined();
    expect(controller.webSearchEnabled.value).toBe(true);

    controller.draft.value = "查一下近期同类题材";
    const sending = controller.sendMessage(document);
    const sessionId = controller.sessionId.value;
    deferred.resolveAccepted(0, {
      sessionId,
      runId: "run_workspace_web_search",
      acceptedAt: new Date().toISOString(),
      runtime: {
        provider: "deepseek",
        model: "deepseek-reasoner",
        mode: "provider"
      }
    });
    await sending;

    expect(deferred.prompts[0]).toMatchObject({
      modelId: "deepseek-writer",
      webSearchEnabled: true
    });
    controller.dispose();
  });

  it("does not enable or send web search for an incompatible model", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      idleTimeoutMs: 10_000
    });
    controller.applyModelSettings({
      defaultModelId: "openai-writer",
      models: [openaiModel()]
    });
    controller.selectWebSearchEnabled(true);
    expect(controller.webSearchEnabled.value).toBe(false);

    controller.draft.value = "不要联网";
    const sending = controller.sendMessage(document);
    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_workspace_web_search_off",
      acceptedAt: new Date().toISOString(),
      runtime: {
        provider: "openai",
        model: "writer-model",
        mode: "provider"
      }
    });
    await sending;

    expect(deferred.prompts[0]).not.toHaveProperty("webSearchEnabled");
    controller.dispose();
  });

  it("auto-disables web search when switching to an incompatible model", () => {
    const warning = vi.fn();
    const controller = useAgentConversation({
      api: () => undefined,
      onContextWarning: warning
    });
    controller.applyModelSettings({
      defaultModelId: "deepseek-writer",
      models: [deepseekResponsesModel(), openaiModel()]
    });
    controller.selectWebSearchEnabled(true);
    expect(controller.webSearchEnabled.value).toBe(true);

    controller.selectModel("openai-writer");
    expect(controller.webSearchEnabled.value).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      "联网已关闭：仅 DeepSeek 的 Responses 或 Anthropic API 模型支持此功能"
    );
    controller.dispose();
  });
});
