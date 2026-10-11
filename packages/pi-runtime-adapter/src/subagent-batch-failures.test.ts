import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { buildSpawnSubagentsBatchTool } from "./subagent-runtime";
import { assertProviderToolParameterSchema } from "./provider-tool-schema-compat";
import { captureToolPayload } from "./index.test-support";

const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function createBatchHarness(api: string, itemCount: number) {
  const provider = fauxProvider({
    api,
    provider: api,
    models: [{ id: "test", name: "Test", reasoning: true }],
    tokensPerSecond: 0
  });
  provider.setResponses(
    Array.from({ length: itemCount }, (_, index) =>
      fauxAssistantMessage(`独立结果 ${index + 1}`)
    )
  );
  const models = createModels();
  models.setProvider(provider.provider);
  const model = provider.getModel("test") as Model<Api>;
  const baseStream = models.streamSimple.bind(models) as StreamFn;
  const definitions = Array.from({ length: itemCount }, (_, index) => ({
    id: `reviewer-${index + 1}`,
    name: `审阅员 ${index + 1}`,
    description: "执行独立只读审阅。",
    systemPrompt: "依据实际资料独立判断，不猜其他成员的结论。",
    enabled: true,
    modelMode: "inherit" as const
  }));
  let active = 0;
  let peak = 0;
  let started = 0;
  const streamFn: StreamFn = async (requestModel, context, options) => {
    active++;
    peak = Math.max(peak, active);
    started++;
    await pause(80);
    try {
      if (options?.signal?.aborted) throw new Error("Child request aborted");
      return await baseStream(requestModel, context, options);
    } finally {
      active--;
    }
  };
  const tool = buildSpawnSubagentsBatchTool({
    parentSessionId: `parent-${api}`,
    model,
    thinkingLevel: "medium",
    streamFn,
    definitions,
    buildChildTools: () => []
  });
  if (!tool) throw new Error("spawn_subagents was not built");
  assertProviderToolParameterSchema(tool.name, tool.parameters);
  const tasks = definitions.map((definition, index) => ({
    task_id: `task-${index + 1}`,
    subagent_id: definition.id,
    task: `只读审阅维度 ${index + 1}`
  }));
  return {
    tool,
    tasks,
    get peak() {
      return peak;
    },
    get started() {
      return started;
    }
  };
}

function resultItems(
  result: Awaited<
    ReturnType<
      NonNullable<ReturnType<typeof buildSpawnSubagentsBatchTool>>["execute"]
    >
  >
) {
  const text = result.content.find((item) => item.type === "text");
  const payload = JSON.parse(text?.type === "text" ? text.text : "{}") as {
    batch_id: string;
    requested: { task_id: string; subagent_id: string }[];
    finished: string[];
    failed: string[];
    aborted: string[];
    not_started: string[];
    items: { task_id: string; status: string }[];
  };
  return payload;
}

describe("subagent batch queue failure and abort behavior", () => {
  it.each([
    "openai-completions",
    "anthropic-messages",
    "google-generative-ai"
  ] as const)("publishes the real batch tool through %s", async (api) => {
    const harness = await createBatchHarness(`batch-schema-${api}`, 2);
    const payload = await captureToolPayload(
      {
        id: `batch-schema-${api}`,
        label: "Batch schema regression",
        provider: "custom",
        modelId: "schema-test-model",
        api,
        baseUrl: "https://schema.example.test/v1",
        reasoning: false,
        defaultThinkingLevel: "off",
        thinkingLevelOptions: ["off"],
        temperatureOptions: [0.2, 0.7, 1.2],
        apiKey: "test-only"
      },
      harness.tool
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("spawn_subagents");
    expect(serialized).toContain("max_concurrency");
    expect(serialized).not.toContain('"const":');
    expect(harness.started).toBe(0);
  });

  it.each([0, 4, 6, 3.5])(
    "rejects unsupported concurrency %s before starting any child",
    async (maxConcurrency) => {
      const harness = await createBatchHarness(
        `batch-invalid-${maxConcurrency}`,
        2
      );
      await expect(
        harness.tool.execute("batch-parent-call", {
          tasks: harness.tasks,
          max_concurrency: maxConcurrency
        })
      ).rejects.toThrow("max_concurrency 仅接受3或5。");
      expect(harness.started).toBe(0);
    }
  );

  it("runs five requested items in two waves with default concurrency three", async () => {
    const harness = await createBatchHarness("batch-default-three", 5);
    const result = await harness.tool.execute("batch-parent-call", {
      tasks: harness.tasks
    } as never);
    const payload = resultItems(result);

    expect(harness.started).toBe(5);
    expect(harness.peak).toBeGreaterThan(1);
    expect(harness.peak).toBeLessThanOrEqual(3);
    expect(payload.requested).toHaveLength(5);
    expect(payload.finished).toHaveLength(5);
    expect(payload.failed).toEqual([]);
    expect(payload.items.every((item) => item.status === "completed")).toBe(
      true
    );
  });

  it("runs five items concurrently only when the caller explicitly selects five", async () => {
    const harness = await createBatchHarness("batch-explicit-five", 5);
    const result = await harness.tool.execute("batch-parent-call", {
      tasks: harness.tasks,
      max_concurrency: 5
    } as never);
    const payload = resultItems(result);

    expect(harness.started).toBe(5);
    expect(harness.peak).toBe(5);
    expect(payload.finished).toHaveLength(5);
  });

  it("continues queued work after one child provider request fails", async () => {
    const harness = await createBatchHarness("batch-one-fails", 5);
    let requestNumber = 0;
    const provider = fauxProvider({
      api: "batch-one-fails-override",
      provider: "batch-one-fails-override",
      models: [{ id: "test", name: "Test", reasoning: true }],
      tokensPerSecond: 0
    });
    const models = createModels();
    models.setProvider(provider.provider);
    provider.setResponses(
      Array.from({ length: 5 }, (_, index) =>
        fauxAssistantMessage(`独立结果 ${index + 1}`)
      )
    );
    const failingStream: StreamFn = async (model, context, options) => {
      const current = requestNumber++;
      await pause(15);
      if (current === 1) throw new Error("one child failed");
      return models.streamSimple(model, context, options);
    };
    const tool = buildSpawnSubagentsBatchTool({
      parentSessionId: "parent-failure",
      model: provider.getModel("test") as Model<Api>,
      thinkingLevel: "medium",
      streamFn: failingStream,
      definitions: harness.tasks.map((task) => ({
        id: task.subagent_id,
        name: task.subagent_id,
        description: "审阅",
        systemPrompt: "审阅",
        enabled: true,
        modelMode: "inherit" as const
      })),
      buildChildTools: () => []
    });
    const result = await tool!.execute("batch-parent-call", {
      tasks: harness.tasks
    } as never);
    const payload = resultItems(result);

    expect(requestNumber).toBe(5);
    expect(payload.failed).toHaveLength(1);
    expect(payload.items.find((item) => item.status === "error")).toBeDefined();
    expect(payload.finished).toHaveLength(4);
  });

  it("does not start queued items after the parent aborts the batch", async () => {
    const harness = await createBatchHarness("batch-parent-abort", 6);
    const controller = new AbortController();
    const running = harness.tool.execute(
      "batch-parent-call",
      { tasks: harness.tasks },
      controller.signal
    );
    await pause(20);
    controller.abort();
    const payload = resultItems(await running);

    expect(harness.started).toBeLessThanOrEqual(3);
    expect(payload.not_started.length).toBeGreaterThan(0);
    expect(payload.items.some((item) => item.status === "aborted")).toBe(true);
  });
});
