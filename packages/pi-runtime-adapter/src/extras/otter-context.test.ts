import { describe, expect, it } from "vitest";
import { createDefaultContextCompactionSettings } from "@deepwrite/contracts";
import { planExtrasRun, resolveExtrasAgent } from "./run-plan";
import { chatRuntime } from "./agents/chat.test-support";
import { rehydrateOtterContext } from "./otter-context";
import { emptyContextRefs } from "../kernel/context";
import { runFauxExtras } from "./extras.test-support";
import { cachedAgents } from "./agents/chat.test-support";
import { PiAgentRuntimeAdapter } from "../adapter";

const context = {
  projectId: "otter_0123456789abcdef",
  contextId: "CTX-TEST-001",
  baselineHash: "a".repeat(64),
  comparisonBaselineHash: "b".repeat(64),
  apiText: "当前已确认事实：测试角色十八岁。动机故意未知。方法只作参考。"
};
const task = {
  agentId: "chat-normal" as const,
  profile: {
    id: "default",
    name: "测试",
    description: "隔离资料测试",
    systemPrompt: "提供有证据的建议。"
  },
  input: {
    runtime: chatRuntime(),
    otter: {
      projectId: context.projectId,
      contextPath: ".novel/context/CTX-TEST-001.json"
    },
    otterContext: context
  }
};

describe("Otter context in the existing extras runtime", () => {
  it("executes three independent local model fixtures under one comparison baseline", async () => {
    const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
    for (let index = 1; index <= 3; index++) {
      const current = {
        ...context,
        contextId: `CTX-MODEL-${index}`,
        baselineHash: String(index).repeat(64)
      };
      const sessionId = `otter:${context.projectId}:${current.contextId}:fixture`;
      const events = await runFauxExtras(
        { ...task, input: { ...task.input, otterContext: current } },
        runtime,
        {
          sessionId,
          runId: `run-${index}`,
          conversation: { message: "讨论该来源。" }
        }
      );
      const completed = events.find(
        (event) => event.type === "agent.completed"
      );
      expect(completed?.payload.runtime.mode).toBe("local-faux");
      const key = `${sessionId}:extras:chat-normal:otter:${context.projectId}:${current.contextId}:${current.baselineHash}`;
      const agent = cachedAgents(runtime).get(key);
      expect(agent).toBeDefined();
      const transcript = JSON.stringify(agent!.state.messages);
      expect(transcript).toContain(context.apiText);
      expect(transcript).toContain(context.comparisonBaselineHash);
      expect(transcript).toContain(current.baselineHash);
    }
  });
  it("injects the complete authoritative pack on every conversation turn", () => {
    const plan = planExtrasRun({
      runId: "run-1",
      spec: {
        sessionId: "session-1",
        task,
        conversation: { message: "审阅观点。" }
      }
    });
    for (const firstTurn of [true, false]) {
      const text = plan.userMessageContent(firstTurn);
      expect(text).toContain(context.apiText);
      expect(text).toContain(context.contextId);
      expect(text).toContain(context.baselineHash);
    }
  });
  it("restores the same pack after compaction and refuses silent truncation", async () => {
    const defaults = createDefaultContextCompactionSettings();
    const plan = planExtrasRun({
      runId: "run-1",
      spec: {
        sessionId: "session-1",
        task,
        conversation: { message: "继续。" },
        contextCompactionSettings: { ...defaults, enabled: true }
      }
    });
    const restored = await plan.contextPolicy?.rehydrate?.(
      emptyContextRefs(),
      10000
    );
    expect(restored).toContain(context.apiText);
    expect(restored).toContain(context.baselineHash);
    await expect(rehydrateOtterContext(context, 1)).rejects.toThrow("恢复预算");
  });
  it("has no project mutations, catalog reads or external reference tools", () => {
    const agent = resolveExtrasAgent(task);
    if (agent.interaction !== "conversation")
      throw new Error("Expected conversation agent.");
    expect(agent.tools({ runId: "run", sessionId: "session" })).toEqual([]);
    expect(agent.systemPrompt).toContain("本轮猜想");
    expect(agent.conversationKey).toContain(context.contextId);
    const other = resolveExtrasAgent({
      ...task,
      input: {
        ...task.input,
        otterContext: { ...context, contextId: "CTX-OTHER" }
      }
    });
    if (other.interaction !== "conversation")
      throw new Error("Expected conversation agent.");
    expect(other.conversationKey).not.toBe(agent.conversationKey);
  });
  it("keeps the full current pack when a large snapshot exceeds the recovery budget", async () => {
    const large = { ...context, apiText: "源文件真实内容。".repeat(10_000) };
    const plan = planExtrasRun({
      runId: "run-2",
      spec: {
        sessionId: "session-2",
        task: { ...task, input: { ...task.input, otterContext: large } },
        conversation: { message: "本轮原话。" },
        contextCompactionSettings: { enabled: true, budgetTokens: 160000 }
      }
    });
    expect(plan.userMessageContent(false)).toContain(large.apiText);
    expect(plan.rawUserMessageContent?.()).toBe("本轮原话。");
    expect(
      await plan.contextPolicy?.rehydrate?.(emptyContextRefs(), 500)
    ).toContain(context.baselineHash);
  });
});
