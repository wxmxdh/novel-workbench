import { describe, expect, it, vi } from "vitest";
import type { CommandEnvelope, CommandResult } from "@deepwrite/contracts";
import {
  readLoveFailureContinuationHistory,
  type LoveContinuationHistoryMessage
} from "./love-failure-continuation-history";

const currentText = "继续失败的两份，保留成功稿，不要重写其他稿。";
const runEvidence = [
  {
    parentToolCallId: "parent_call",
    subagentRunId: "child_run",
    subagentId: "love-writer-deepseek",
    name: "DeepSeek R1",
    task: "撰写第一章独立稿",
    status: "error",
    runtime: {
      mode: "provider",
      provider: "deepseek",
      model: "deepseek-r1",
      configId: "deepseek-config"
    },
    toolCalls: [
      {
        id: "prepare_call",
        name: "prepare_comparison_draft",
        args: { confirm_chapter: 1 },
        status: "completed",
        requestedAt: "2026-10-06T00:00:00.000Z",
        resultSummary: "【LOVE对照稿恢复证据 v1】{}"
      }
    ],
    processingSteps: [],
    startedAt: "2026-10-06T00:00:00.000Z"
  }
];

function fixtureMessages(
  previousText = "写第一章正文"
): LoveContinuationHistoryMessage[] {
  const runsBytes = Buffer.byteLength(JSON.stringify(runEvidence));
  return [
    {
      position: 0,
      value: {
        id: "author_old",
        role: "user",
        content: previousText,
        status: "completed"
      }
    },
    {
      position: 1,
      value: {
        id: "assistant_old",
        role: "assistant",
        content: "两份任务已启动。",
        status: "completed",
        runId: "parent_run"
      }
    },
    {
      position: 2,
      value: {
        id: "author_current",
        role: "user",
        content: currentText,
        status: "completed"
      }
    },
    {
      position: 3,
      value: {
        id: "assistant_pending",
        role: "assistant",
        content: "",
        status: "streaming",
        activityOnly: true,
        toolCalls: []
      }
    }
  ].map((entry, index) => ({
    ...entry,
    value:
      index === 1
        ? {
            ...entry.value,
            subagentRuns: undefined,
            __details: [
              {
                path: ["subagentRuns"],
                byteLength: runsBytes,
                encoding: "json" as const
              }
            ]
          }
        : entry.value
  }));
}

function makeCoreHistory(
  options: {
    stale?: boolean;
    changeTail?: boolean;
    previousText?: string;
    pendingStatus?: "streaming" | "stopped";
  } = {}
) {
  const messages = fixtureMessages(options.previousText);
  if (options.pendingStatus)
    messages.at(-1)!.value.status = options.pendingStatus;
  const detailBytes = Buffer.byteLength(JSON.stringify(runEvidence));
  const recordValues = messages.map((message, index) => {
    const value = { ...message.value };
    delete value.__details;
    if (index === 1) delete value.subagentRuns;
    if (options.changeTail && index === 2) value.content = "不是本轮消息";
    return {
      messageId: String(value.id),
      position: message.position,
      value,
      details:
        index === 1
          ? [
              {
                path: ["subagentRuns"],
                byteLength: detailBytes,
                encoding: "json"
              }
            ]
          : [],
      byteLength: Buffer.byteLength(JSON.stringify(value)) + detailBytes
    };
  });
  const calls: CommandEnvelope[] = [];
  const sendCoreCommand = vi.fn(
    async (command: CommandEnvelope): Promise<CommandResult> => {
      calls.push(command);
      if (command.type === "rendererState.history.session")
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            sessionId: "love-session",
            metadata: {},
            revision: options.stale ? 4 : 3,
            generation: 2,
            sequence: 4,
            deleted: false,
            messageCount: 4,
            byteLength: 1000
          }
        };
      if (command.type === "rendererState.history.messages")
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            revision: 3,
            generation: 2,
            messages: recordValues,
            nextPosition: null
          }
        };
      if (command.type === "rendererState.history.detail")
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            revision: 3,
            encoding: "json",
            chunk: JSON.stringify(runEvidence),
            nextOffset: null,
            totalBytes: detailBytes
          }
        };
      throw new Error(`unexpected command ${command.type}`);
    }
  );
  return { sendCoreCommand, calls };
}

describe("readLoveFailureContinuationHistory", () => {
  it("hydrates structured subagent details and trims only this exact pending prompt pair", async () => {
    const { sendCoreCommand, calls } = makeCoreHistory();
    const messages = await readLoveFailureContinuationHistory({
      bookId: "longbook_9a146bbe",
      sessionId: "love-session",
      currentText,
      sendCoreCommand
    });

    expect(messages).toHaveLength(2);
    expect(messages?.[1]?.value.subagentRuns).toEqual(runEvidence);
    expect(messages?.some(({ value }) => value.content === currentText)).toBe(
      false
    );
    expect(calls[0]).toMatchObject({
      type: "rendererState.history.session",
      payload: {
        key: "conversation-history:long%3Alongbook_9a146bbe%3Achat",
        sessionId: "love-session"
      }
    });
    expect(
      calls.some(({ type }) => type === "rendererState.history.detail")
    ).toBe(true);
  });

  it("hydrates a retry assistant trace when its preceding user turn is a continuation request", async () => {
    const { sendCoreCommand, calls } = makeCoreHistory({
      previousText: "继续失败的两份，保留成功稿，不要重写其他稿。"
    });
    const messages = await readLoveFailureContinuationHistory({
      bookId: "longbook_9a146bbe",
      sessionId: "love-session",
      currentText,
      sendCoreCommand
    });

    expect(messages?.[1]?.value.subagentRuns).toEqual(runEvidence);
    expect(
      calls.filter(({ type }) => type === "rendererState.history.detail")
    ).toHaveLength(1);
  });

  it("hydrates a redraft assistant trace even when the author omits a chapter number", async () => {
    const { sendCoreCommand, calls } = makeCoreHistory({
      previousText: "请基于当前底稿和批注进行二次创作。"
    });
    const messages = await readLoveFailureContinuationHistory({
      bookId: "longbook_9a146bbe",
      sessionId: "love-session",
      currentText,
      sendCoreCommand
    });

    expect(messages?.[1]?.value.subagentRuns).toEqual(runEvidence);
    expect(
      calls.filter(({ type }) => type === "rendererState.history.detail")
    ).toHaveLength(1);
  });

  it("fails closed when the session changes during hydration", async () => {
    const { sendCoreCommand } = makeCoreHistory({ stale: true });
    await expect(
      readLoveFailureContinuationHistory({
        bookId: "longbook_9a146bbe",
        sessionId: "love-session",
        currentText,
        sendCoreCommand
      })
    ).resolves.toBeUndefined();
  });

  it("does not trim if the final stored user message is not the exact current text", async () => {
    const { sendCoreCommand } = makeCoreHistory({ changeTail: true });
    await expect(
      readLoveFailureContinuationHistory({
        bookId: "longbook_9a146bbe",
        sessionId: "love-session",
        currentText,
        sendCoreCommand
      })
    ).resolves.toBeUndefined();
  });

  it("does not trim a stopped assistant placeholder as an unclaimed pending pair", async () => {
    const { sendCoreCommand } = makeCoreHistory({ pendingStatus: "stopped" });
    await expect(
      readLoveFailureContinuationHistory({
        bookId: "longbook_9a146bbe",
        sessionId: "love-session",
        currentText,
        sendCoreCommand
      })
    ).resolves.toBeUndefined();
  });
});
