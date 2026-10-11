import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { PiAgentRuntimeAdapter } from "./adapter";
import * as provider from "./provider-runtime";
import { workspace, profile } from "./long-agent-tools.test-support";
import {
  model,
  response,
  assistant
} from "./kernel/context/context.test-support";
import type { AgentRuntimeEvent, AgentRunInput } from "./runtime-types";

const config: AgentProviderRuntimeConfig = {
  id: "local-transport-test",
  label: "Test",
  provider: model.provider,
  modelId: model.id,
  api: model.api,
  baseUrl: model.baseUrl,
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["off"],
  temperatureOptions: [0, 0.5, 1],
  apiKey: "not-a-real-key"
};
function context(root: Parameters<typeof workspace>[1], text: string) {
  return {
    longWorkspace: {
      ...workspace("long", root),
      agentsMd: "按本书规则处理。",
      requiredRules: [
        {
          itemId: "worlditem_rule",
          fileId: "file_worlditem_rule:content",
          title: "必读规则",
          updatedAt: "2026-10-04T00:00:00.000Z",
          sha256: createHash("sha256").update(text).digest("hex"),
          content: text
        }
      ]
    }
  };
}
async function collect(runtime: PiAgentRuntimeAdapter, input: AgentRunInput) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.start(input)) events.push(event);
  expect(
    events.some((event) => event.type === "agent.error"),
    JSON.stringify(events)
  ).toBe(false);
  return events;
}
function transport() {
  const received: Array<{ systemPrompt: string; messages: string }> = [];
  const streamFn: StreamFn = (_model, ctx) => {
    received.push({
      systemPrompt: ctx.systemPrompt ?? "",
      messages: JSON.stringify(ctx.messages)
    });
    return response(
      assistant(
        ctx.systemPrompt?.includes("上下文整理员")
          ? "保留此前讨论，不补造人物事实。"
          : "测试答复"
      )
    );
  };
  vi.spyOn(provider, "buildWorkspaceProviderRuntimes").mockReturnValue({
    model,
    streamFn,
    spawnStreamFn: streamFn
  });
  return received;
}
afterEach(() => vi.restoreAllMocks());

describe("required rule bodies at the actual model transport boundary", () => {
  it.each([
    "worldbuilding",
    "character_design",
    "plot_design",
    "draft"
  ] as const)(
    "sends full rules for %s, and refreshes a cached later turn",
    async (root) => {
      const received = transport();
      const runtime = new PiAgentRuntimeAdapter({
        retryPolicy: { delaysMs: [] }
      });
      for (const [i, text] of [
        "初版：这里不合适只改这里。",
        "新版：保留笑、欲望、幽默与长段落。"
      ].entries()) {
        await collect(runtime, {
          runId: `run_${i}`,
          sessionId: `session_${root}`,
          prompt: "继续讨论",
          runtimeConfig: config,
          longAgentProfile: profile("long"),
          workspaceContext: context(root, text)
        });
        expect(received.at(-1)!.systemPrompt).toContain(text);
      }
      expect(received.at(-1)!.systemPrompt).not.toContain(
        "初版：这里不合适只改这里。"
      );
    }
  );

  it("retains full rules through compaction and checkpoint restoration even when the summary omits them", async () => {
    const received = transport();
    const text = "本轮完整规则：不将局部意见扩成全书禁止，不封死未确认心理。";
    const base = {
      sessionId: "session_compaction",
      prompt: "讨论下一场",
      runtimeConfig: config,
      longAgentProfile: profile("long"),
      workspaceContext: context("draft", text),
      contextCompactionSettings: { enabled: true, budgetTokens: 16_000 }
    };
    const events = await collect(new PiAgentRuntimeAdapter(), {
      ...base,
      runId: "run_compact",
      contextCompaction: {},
      conversationHistory: [
        {
          role: "user",
          content: "旧讨论。".repeat(500),
          createdAt: "2026-10-03T00:00:00.000Z",
          runId: "earlier"
        },
        {
          role: "assistant",
          content: "旧答复",
          createdAt: "2026-10-03T00:00:00.000Z",
          runId: "earlier"
        }
      ]
    });
    const checkpoint = events.find(
      (e) => e.type === "agent.context_compaction" && e.payload.checkpoint
    );
    expect(checkpoint).toBeDefined();
    if (checkpoint?.type !== "agent.context_compaction")
      throw new Error("Missing checkpoint");
    expect(checkpoint.payload.checkpoint!.summary).not.toContain(text);
    expect(received.at(-1)!.systemPrompt).toContain(text);
    await collect(new PiAgentRuntimeAdapter(), {
      ...base,
      runId: "run_restore",
      conversationCheckpoint: checkpoint.payload.checkpoint!,
      conversationHistory: []
    });
    expect(received.at(-1)!.systemPrompt).toContain(text);
  });
});
