import { afterEach, describe, expect, it, vi } from "vitest";
import {
  queueSubagentTextEvent,
  flushSubagentTextBuffer
} from "./subagent-text-buffer";
import type { SubagentEventEnvelope } from "./types";

function event(child: string, delta: string, type = "message_delta") {
  return {
    type: "subagent.activity",
    id: `${child}-${delta}`,
    timestamp: "2026-10-04T10:00:00.000Z",
    payload: {
      sessionId: "fixture",
      runId: "parent",
      parentToolCallId: "batch",
      subagentRunId: child,
      subagentId: child,
      name: child,
      runtime: { provider: "test", model: "fixture", mode: "local-faux" },
      activity: { type, delta }
    }
  } as Extract<SubagentEventEnvelope, { type: "subagent.activity" }>;
}
afterEach(() => vi.useRealTimers());
describe("parallel child text presentation", () => {
  it("coalesces 2000 interleaved fragments into five updates and retains every byte", () => {
    vi.useFakeTimers();
    const owner = {};
    const apply = vi.fn();
    for (let fragment = 0; fragment < 400; fragment++) {
      for (let child = 0; child < 5; child++) {
        queueSubagentTextEvent(
          owner,
          event(`child-${child}`, "字"),
          apply,
          () => true
        );
      }
    }
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(32);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toHaveLength(5);
    for (const result of apply.mock.calls[0]![0]) {
      expect(result.payload.activity.delta).toBe("字".repeat(400));
    }
  });
  it("settles text before a child changes from thinking to its response", () => {
    vi.useFakeTimers();
    const owner = {};
    const apply = vi.fn();
    queueSubagentTextEvent(
      owner,
      event("a", "思考", "thinking_delta"),
      apply,
      () => true
    );
    queueSubagentTextEvent(owner, event("a", "报告"), apply, () => true);
    expect(apply.mock.calls[0]![0][0].payload.activity.delta).toBe("思考");
    flushSubagentTextBuffer(owner);
    expect(apply.mock.calls[1]![0][0].payload.activity.delta).toBe("报告");
    vi.runAllTimers();
    expect(apply).toHaveBeenCalledTimes(2);
  });
  it("does not write an old run's pending text into a replaced session", () => {
    vi.useFakeTimers();
    const owner = {};
    const apply = vi.fn();
    let current = true;
    queueSubagentTextEvent(owner, event("a", "旧文本"), apply, () => current);
    current = false;
    vi.advanceTimersByTime(32);
    expect(apply).not.toHaveBeenCalled();
  });
});
