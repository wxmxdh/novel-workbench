import { createApp, h, nextTick, reactive } from "vue";
import SubagentRunList from "./components/SubagentRunList.vue";
import { i18n } from "./i18n";
import type { AgentSubagentRun, ChatMessage } from "./types/conversation";
import {
  queueSubagentTextEvent,
  flushSubagentTextBuffer
} from "./composables/agent-conversation/subagent-text-buffer";
import type { SubagentEventEnvelope } from "./composables/agent-conversation/types";

/** Isolated DOM replay, loaded only by the dedicated packaged smoke query. */
export async function runParallelUiSmoke() {
  const startedAt = new Date().toISOString();
  const runs = reactive(
    Array.from({ length: 5 }, (_, index): AgentSubagentRun => ({
      parentToolCallId: "fixture-batch",
      subagentRunId: `fixture-${index}`,
      subagentId: `fixture-${index}`,
      name: `审阅员 ${index + 1}`,
      task: "【批次 fixture】内部说明\n【父对话可见快照 SHA-256】fixture\n【分配给本子任务】核对本轮场景的行为与表达。",
      status: "running",
      runtime: { provider: "test", model: "fixture", mode: "local-faux" },
      toolCalls: [],
      processingSteps: [],
      startedAt
    }))
  );
  const message = reactive<ChatMessage>({
    id: "fixture",
    role: "assistant",
    content: "",
    status: "streaming",
    createdAt: startedAt,
    subagentRuns: runs
  });
  const element = document.createElement("div");
  element.dataset.parallelUiSmoke = "true";
  document.body.append(element);
  let clicks = 0;
  const app = createApp({
    render: () =>
      h("section", [
        h(
          "button",
          {
            onClick: () => {
              clicks++;
            }
          },
          "测试停止按钮"
        ),
        h(SubagentRunList, { message })
      ])
  }).use(i18n);
  app.mount(element);
  let heartbeatCount = 0;
  let maxHeartbeatGapMs = 0;
  let lastHeartbeat = performance.now();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastHeartbeat);
    lastHeartbeat = now;
    heartbeatCount++;
  }, 10);
  const owner = {};
  let appliedUpdates = 0;
  const apply = (
    events: Extract<SubagentEventEnvelope, { type: "subagent.activity" }>[]
  ) => {
    appliedUpdates += events.length;
    for (const event of events) {
      const run = runs.find(
        (candidate) => candidate.subagentRunId === event.payload.subagentRunId
      )!;
      const activity = event.payload.activity;
      if (activity.type !== "message_delta")
        throw new Error("Unexpected fixture activity");
      run.output = (run.output ?? "") + activity.delta;
      const step = run.processingSteps.at(-1);
      if (step?.type === "response") step.content += activity.delta;
      else
        run.processingSteps.push({
          id: event.id,
          type: "response",
          content: activity.delta,
          createdAt: startedAt
        });
    }
  };
  try {
    for (let round = 0; round < 10; round++) {
      for (let fragment = 0; fragment < 400; fragment++) {
        for (const run of runs) {
          const event = {
            type: "subagent.activity",
            id: `fixture-${round}-${fragment}-${run.subagentId}`,
            timestamp: startedAt,
            payload: {
              sessionId: "fixture",
              runId: "parent",
              parentToolCallId: run.parentToolCallId,
              subagentRunId: run.subagentRunId,
              subagentId: run.subagentId,
              name: run.name,
              runtime: run.runtime,
              activity: { type: "message_delta", delta: "字" }
            }
          } as Extract<SubagentEventEnvelope, { type: "subagent.activity" }>;
          queueSubagentTextEvent(owner, event, apply, () => true);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 45));
      element.querySelector("button")!.click();
      if (round === 0) {
        const details = element.querySelector("details");
        if (details) {
          details.open = true;
          details.dispatchEvent(new Event("toggle"));
        }
      }
      await nextTick();
    }
    flushSubagentTextBuffer(owner);
    await nextTick();
    const descriptions = [
      ...element.querySelectorAll(".subagent-run-task")
    ].map((node) => node.textContent ?? "");
    if (runs.some((run) => run.output !== "字".repeat(4000)))
      throw new Error("Parallel replay lost text");
    if (
      descriptions.length !== 5 ||
      descriptions.some((text) => /SHA-256|批次/.test(text))
    )
      throw new Error("Technical task prefix leaked into cards");
    if (clicks !== 10 || heartbeatCount < 5 || maxHeartbeatGapMs > 1000)
      throw new Error("Parallel replay blocked UI events");
    return {
      status: "ok",
      fragments: 20000,
      appliedUpdates,
      heartbeatCount,
      maxHeartbeatGapMs: Math.round(maxHeartbeatGapMs),
      clicks,
      descriptionsReadable: true
    };
  } finally {
    flushSubagentTextBuffer(owner);
    clearInterval(heartbeat);
    app.unmount();
    element.remove();
  }
}
