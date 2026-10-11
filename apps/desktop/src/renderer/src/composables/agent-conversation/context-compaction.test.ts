import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../types/conversation";
import {
  applyContextCompactionEvent,
  latestConversationCheckpoint,
  parseStoredContextCompactions
} from "./context-compaction";
import { buildConversationRestore } from "./history";

const time = "2026-09-28T00:00:00.000Z";
const runtime = {
  mode: "local-faux" as const,
  provider: "example",
  model: "test"
};
function message(
  role: ChatMessage["role"],
  runId: string,
  content = "正文"
): ChatMessage {
  return {
    role,
    id: `${role}-${runId}`,
    runId,
    content,
    createdAt: time,
    status: "completed"
  };
}
const checkpoint = {
  summary: "约束与剧情结论",
  firstKeptRunId: "two",
  createdAt: time,
  tokensBefore: 99_000
};

describe("persisted context checkpoints", () => {
  it("keeps the latest valid checkpoint after many prune passes and JSON reload", () => {
    const item = message("assistant", "three");
    applyContextCompactionEvent(
      item,
      {
        runId: "three",
        sessionId: "session",
        messageId: item.id,
        runtime,
        phase: "completed",
        reason: "threshold",
        level: "summary",
        checkpoint
      },
      "summary",
      time
    );
    for (let index = 0; index < 12; index++)
      applyContextCompactionEvent(
        item,
        {
          runId: "three",
          sessionId: "session",
          messageId: item.id,
          runtime,
          phase: "completed",
          reason: "run_limit",
          level: "prune",
          tokensAfter: 500
        },
        String(index),
        time
      );
    item.contextCompactions = parseStoredContextCompactions(
      JSON.parse(JSON.stringify(item.contextCompactions))
    );
    const messages = [
      message("user", "one"),
      message("assistant", "one"),
      message("user", "two"),
      message("assistant", "two"),
      message("user", "three"),
      item
    ];
    const restored = buildConversationRestore(messages);
    expect(restored.checkpoint).toEqual(checkpoint);
    expect(restored.history.map((entry) => entry.runId)).toEqual([
      "two",
      "two",
      "three",
      "three"
    ]);
    expect(item.contextCompactions).toHaveLength(8);
  });

  it("keeps complete long messages and more than 80 unsummarized messages", () => {
    const long = "前".repeat(30_000) + "末尾要求";
    const messages = Array.from({ length: 90 }, (_, index) =>
      message(
        index % 2 ? "assistant" : "user",
        String(index),
        index === 0 ? long : "保留"
      )
    );
    const restored = buildConversationRestore(messages);
    expect(restored.history).toHaveLength(90);
    expect(restored.history[0]?.content).toBe(long);
  });

  it("does not invent a restore boundary when an old run cannot be located", () => {
    const item = message("assistant", "three");
    item.contextCompactions = [
      {
        id: "c",
        status: "completed",
        reason: "manual",
        level: "summary",
        createdAt: time,
        checkpoint
      }
    ];
    expect(
      latestConversationCheckpoint([message("user", "one"), item])?.keepFrom
    ).toBe(0);
    expect(
      buildConversationRestore([message("user", "one")]).checkpoint
    ).toBeUndefined();
  });

  it("persists diagnostics and a no-change outcome without calling it completed", () => {
    const item = message("assistant", "manual");
    applyContextCompactionEvent(
      item,
      {
        runId: "manual",
        sessionId: "session",
        messageId: item.id,
        runtime,
        phase: "unchanged",
        reason: "manual",
        tokensBefore: 80,
        tokensAfter: 80,
        diagnostics: {
          modelContextWindowTokens: 32_000,
          configuredBudgetTokens: 16_000,
          workingBudgetTokens: 16_000,
          hardLimitTokens: 22_000,
          pruneAtTokens: 8_000,
          summarizeAtTokens: 12_800,
          fixedContextTokens: 500,
          tokenSource: "local-estimate"
        }
      },
      "manual-no-op",
      time
    );

    const restored = parseStoredContextCompactions(
      JSON.parse(JSON.stringify(item.contextCompactions))
    );
    expect(restored[0]).toMatchObject({
      status: "unchanged",
      tokensBefore: 80,
      tokensAfter: 80,
      diagnostics: {
        modelContextWindowTokens: 32_000,
        workingBudgetTokens: 16_000,
        tokenSource: "local-estimate"
      }
    });
  });

  it("folds repeated running events into one compaction record", () => {
    const item = message("assistant", "repeat");
    const started = {
      runId: "repeat",
      sessionId: "session",
      messageId: item.id,
      runtime,
      phase: "started" as const,
      reason: "threshold" as const,
      level: "summary" as const,
      tokensBefore: 100
    };
    applyContextCompactionEvent(item, started, "same-event", time);
    applyContextCompactionEvent(item, started, "same-event", time);
    applyContextCompactionEvent(
      item,
      { ...started, phase: "completed", tokensAfter: 50 },
      "same-event",
      time
    );

    expect(item.contextCompactions).toHaveLength(1);
    expect(item.contextCompactions?.[0]).toMatchObject({
      id: "same-event",
      status: "completed",
      tokensBefore: 100,
      tokensAfter: 50
    });
    expect(
      item.processingSteps?.filter((step) => step.type === "compaction")
    ).toHaveLength(1);
  });

  it("fails explicitly rather than truncate an oversized restored payload", () => {
    expect(() =>
      buildConversationRestore([message("user", "one", "字".repeat(1_000_001))])
    ).toThrow("未截断或发送");
  });
});
