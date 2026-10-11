import { describe, expect, it } from "vitest";
import type { AgentSubagentRun, ChatMessage } from "../types/conversation";
import {
  subagentProcessingDisplayItems,
  subagentRetryStatus,
  subagentReviewHint,
  subagentStatusLabel,
  subagentDuration,
  subagentTaskText,
  loveReviewCoverageLabel,
  uniqueLoveReviewCoverage
} from "./subagentRunPresentation";

const startedAt = "2026-01-01T00:00:00.000Z";

function run(overrides: Partial<AgentSubagentRun> = {}): AgentSubagentRun {
  return {
    parentToolCallId: "tool_1",
    subagentRunId: "sub_1",
    subagentId: "writer",
    name: "写手小弟",
    task: "请编写第2小节正文",
    status: "running",
    runtime: { provider: "openai", model: "demo", mode: "local-faux" },
    toolCalls: [],
    processingSteps: [],
    startedAt,
    ...overrides
  };
}

describe("subagentRunPresentation", () => {
  it("shows the assigned review rather than the batch transport prefix", () => {
    const task =
      "【批次 batch_test】独立报告\n【父对话可见快照 SHA-256】abc\n【分配给本子任务】核对人物行为，保留成立的场景。";
    expect(subagentTaskText(task)).toBe("核对人物行为，保留成立的场景。");
    expect(subagentTaskText("核对时间线")).toBe("核对时间线");
    expect(task).toContain("SHA-256");
  });
  it("distinguishes queued and never-started children without counting wait as execution", () => {
    const queued = run({ subagentRunId: "pending:batch:task-1" });
    const now = Date.parse(startedAt) + 120_000;
    expect(subagentStatusLabel(queued, now)).toBe("等待启动");
    expect(subagentDuration(queued, now)).toBe("");
    expect(subagentStatusLabel({ ...queued, status: "stopped" }, now)).toBe(
      "未启动"
    );
  });
  it("formats retry labels from the live clock", () => {
    const retrying = run({
      retry: {
        turnId: "turn_1",
        attempt: 2,
        maxAttempts: 4,
        state: "scheduled",
        retryAt: "2026-01-01T00:00:08.000Z"
      }
    });
    expect(
      subagentStatusLabel(retrying, Date.parse("2026-01-01T00:00:05.000Z"))
    ).toBe("3s 后重试");
    expect(
      subagentRetryStatus(retrying, Date.parse("2026-01-01T00:00:05.000Z"))
    ).toBe("网络波动，3s 后重试（第 1/3 次）");
    expect(
      subagentRetryStatus(
        run({
          retry: {
            turnId: "turn_1",
            attempt: 2,
            maxAttempts: 4,
            state: "trying"
          }
        }),
        Date.parse(startedAt)
      )
    ).toBe("正在重试（第 1/3 次）");
    expect(subagentStatusLabel(run(), Date.parse(startedAt))).toBe(
      "安排任务中"
    );
    expect(
      subagentStatusLabel(
        run({
          processingSteps: [
            {
              id: "think",
              type: "thinking",
              content: "先看开场",
              createdAt: startedAt
            }
          ]
        }),
        Date.parse(startedAt)
      )
    ).toBe("子智能体执行中");
  });

  it("prefers pending review over write-call counts", () => {
    const writing = run({
      toolCalls: [
        {
          id: "write_1",
          name: "write_draft_section",
          args: { section_id: "section-2" },
          status: "completed",
          requestedAt: startedAt
        }
      ]
    });
    const message = {
      editProposals: [
        {
          id: "proposal_1",
          status: "pending",
          toolCallIds: ["write_1"],
          createdAt: startedAt
        }
      ]
    } as ChatMessage;
    expect(subagentReviewHint({} as ChatMessage, writing)).toBe("1 次写入调用");
    expect(subagentReviewHint(message, writing)).toBe("1 项待审阅");
  });

  it("keeps task completion separate from review coverage and reports each phase", () => {
    const specialistCoverage = {
      reviewId: "review_1",
      targetSetSha256: "a".repeat(64),
      state: "needs_independent_review" as const,
      expectedCount: 5,
      completedCount: 5,
      missingReviewerIds: [],
      phase: "specialist" as const
    };
    const completedRun = run({
      status: "completed",
      reviewCoverage: specialistCoverage
    });
    expect(subagentStatusLabel(completedRun, Date.parse(startedAt))).toBe(
      "已完成"
    );
    expect(loveReviewCoverageLabel(specialistCoverage)).toBe(
      "专业报告齐，待汇总及复核。"
    );
    expect(
      loveReviewCoverageLabel({
        ...specialistCoverage,
        phase: "summary"
      })
    ).toBe("已汇总，待独立复核。");
    expect(
      loveReviewCoverageLabel({
        ...specialistCoverage,
        state: "incomplete",
        completedCount: 3,
        missingReviewerIds: ["love-life", "love-expression"]
      })
    ).toBe("审阅未完成：有效报告 3/5，缺 2 位。");
    expect(
      loveReviewCoverageLabel({ ...specialistCoverage, state: "stale" })
    ).toBe("版本已变，需复审。");
    expect(
      loveReviewCoverageLabel({
        ...specialistCoverage,
        state: "ready",
        phase: "independent"
      })
    ).toBe("复核结束，仍待作者判断。");
  });

  it("shows the latest coverage once when every reviewer carries the same batch state", () => {
    const early = {
      reviewId: "review_1",
      targetSetSha256: "a".repeat(64),
      state: "needs_independent_review" as const,
      expectedCount: 5,
      completedCount: 5,
      missingReviewerIds: [],
      phase: "specialist" as const
    };
    const later = { ...early, phase: "summary" as const };
    expect(
      uniqueLoveReviewCoverage([
        run({ reviewCoverage: early }),
        run({ subagentRunId: "sub_2", reviewCoverage: later })
      ])
    ).toEqual([later]);
  });

  it("folds thinking and tools until a visible inner response", () => {
    const current = run({
      toolCalls: [
        {
          id: "read_1",
          name: "read_workspace_content",
          args: {},
          status: "completed",
          requestedAt: startedAt,
          resultSummary: "已读取"
        }
      ],
      processingSteps: [
        {
          id: "think-a",
          type: "thinking",
          content: "先读文件",
          createdAt: startedAt
        },
        {
          id: "tool-a",
          type: "tool",
          toolCallId: "read_1",
          createdAt: startedAt
        },
        {
          id: "reply-a",
          type: "response",
          content: "阶段结论",
          createdAt: startedAt
        },
        {
          id: "think-b",
          type: "thinking",
          content: "继续",
          createdAt: startedAt
        }
      ]
    });
    const items = subagentProcessingDisplayItems(current);
    expect(items.map((item) => item.type)).toEqual([
      "work-group",
      "response",
      "work-group"
    ]);
    expect(items[0]).toMatchObject({ running: false });
    expect(items[2]).toMatchObject({ type: "work-group", running: true });
  });
});
