import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model
} from "@earendil-works/pi-ai";
import * as provider from "./provider-runtime";
import { PiAgentRuntimeAdapter } from "./adapter";
import type { AgentRuntimeEvent } from "./runtime-types";
import { shortProfile, shortWorkspace } from "./short-agent-tools.test-support";

const model: Model<"openai-completions"> = {
  id: "test-model",
  name: "Test",
  provider: "custom",
  api: "openai-completions",
  baseUrl: "https://provider.example.test/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 16000,
  maxTokens: 2000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};
const config: AgentProviderRuntimeConfig = {
  id: "test-config",
  label: "Test",
  provider: "custom",
  modelId: model.id,
  api: model.api,
  baseUrl: model.baseUrl,
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["off"],
  temperatureOptions: [0, 0.5, 1],
  apiKey: "invalid-test-key"
};
function message(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason: content.some((part) => part.type === "toolCall")
      ? "toolUse"
      : "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  };
}
function finish(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  text: string
) {
  stream.push({
    type: "done",
    reason: "stop",
    message: message([{ type: "text", text }])
  });
}
function finishWithLength(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  content: AssistantMessage["content"]
) {
  const response = message(content);
  stream.push({
    type: "done",
    reason: "length",
    message: {
      ...response,
      stopReason: "length",
      usage: {
        ...response.usage,
        output: 16_384,
        totalTokens: 16_384
      }
    }
  });
}
async function harness(hangParent = false) {
  vi.useFakeTimers();
  const childStream = createAssistantMessageEventStream();
  let parentCalls = 0;
  const parentStream: StreamFn = () => {
    parentCalls += 1;
    const stream = createAssistantMessageEventStream();
    if (parentCalls === 1) {
      stream.push({
        type: "done",
        reason: "toolUse",
        message: message([
          {
            type: "toolCall",
            id: "spawn-1",
            name: "spawn_subagent",
            arguments: { subagent_id: "writer", task: "写测试小节" }
          }
        ])
      });
    } else if (!hangParent) finish(stream, "主任务完成");
    return stream;
  };
  vi.spyOn(provider, "buildWorkspaceProviderRuntimes").mockReturnValue({
    model,
    streamFn: parentStream,
    spawnStreamFn: () => childStream
  });
  const controller = new AbortController();
  const runtime = new PiAgentRuntimeAdapter({ retryPolicy: { delaysMs: [] } });
  const events: AgentRuntimeEvent[] = [];
  const done = (async () => {
    for await (const event of runtime.start({
      runId: "run-test",
      sessionId: "session-test",
      prompt: "委派测试",
      runtimeConfig: config,
      signal: controller.signal,
      agentProfile: shortProfile(),
      workspaceContext: { shortWorkspace: shortWorkspace() },
      subagentDefinitions: [
        {
          id: "writer",
          name: "写手",
          description: "写作",
          systemPrompt: "完成写作",
          enabled: true,
          modelMode: "inherit"
        }
      ]
    }))
      events.push(event);
  })();
  await vi.advanceTimersByTimeAsync(0);
  expect(events.some((event) => event.type === "subagent.started")).toBe(true);
  return { childStream, controller, events, done };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("parent waiting for a silent subagent", () => {
  it("waits beyond five minutes and delivers the child result before the parent completes", async () => {
    const run = await harness();
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(run.events.some((event) => event.type === "agent.error")).toBe(
      false
    );
    finish(run.childStream, "子任务完成");
    await run.done;
    const terminals = run.events.filter((event) =>
      ["subagent.completed", "agent.completed", "agent.error"].includes(
        event.type
      )
    );
    expect(terminals.map((event) => event.type)).toEqual([
      "subagent.completed",
      "agent.completed"
    ]);
    expect(terminals[0]).toMatchObject({
      payload: { status: "completed", summary: "子任务完成" }
    });
  });

  it("still enforces the child's sixty-minute hard deadline", async () => {
    const run = await harness();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await run.done;
    expect(
      run.events.filter((event) => event.type === "subagent.completed")
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "error",
          errorMessage: "子智能体超过 3600 秒硬截止时间，运行已终止。"
        })
      })
    ]);
  });

  it("allows manual cancellation while the child is silent", async () => {
    const run = await harness();
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    run.controller.abort();
    await run.done;
    expect(
      run.events.filter((event) => event.type === "subagent.completed")
    ).toHaveLength(1);
    expect(
      run.events.find((event) => event.type === "subagent.completed")
    ).toMatchObject({
      payload: { status: "aborted", errorMessage: "智能体运行已中止。" }
    });
    expect(run.events.at(-1)).toMatchObject({
      type: "agent.error",
      payload: { code: "pi_agent.aborted" }
    });
  });

  it("restores the parent's idle timeout after the child finishes", async () => {
    const run = await harness(true);
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    finish(run.childStream, "子任务完成");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await run.done;
    expect(run.events.at(-1)).toMatchObject({
      type: "agent.error",
      payload: { code: "pi_agent.idle_timeout" }
    });
    expect(
      run.events.filter((event) => event.type === "subagent.completed")
    ).toHaveLength(1);
  });
});

describe("subagent length termination diagnostics", () => {
  it.each([
    {
      name: "thinking without visible text",
      content: [{ type: "thinking" as const, thinking: "private reasoning" }],
      expectedText: "没有可见交接文本"
    },
    {
      name: "partial visible text",
      content: [
        { type: "thinking" as const, thinking: "private reasoning" },
        { type: "text" as const, text: "部分交接内容" }
      ],
      expectedText: "被截断"
    }
  ])("rejects $name and preserves safe terminal diagnostics", async (testCase) => {
    const run = await harness();
    finishWithLength(run.childStream, testCase.content);
    await run.done;

    const completion = run.events.find(
      (event) => event.type === "subagent.completed"
    );
    expect(completion).toMatchObject({
      payload: {
        status: "error",
        errorMessage: expect.stringContaining(testCase.expectedText)
      }
    });
    if (completion?.type !== "subagent.completed") {
      throw new Error("Expected a subagent completion event.");
    }
    expect(completion.payload.errorMessage).toContain("stopReason=length");
    expect(completion.payload.errorMessage).toContain("outputTokens=16384");
    expect(completion.payload.errorMessage).toContain("hasThinking=true");
    expect(completion.payload.errorMessage).not.toContain("private reasoning");
    expect(completion.payload.summary).not.toContain("private reasoning");
  });
});
