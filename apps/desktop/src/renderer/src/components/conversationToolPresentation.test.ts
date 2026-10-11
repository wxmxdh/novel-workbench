import { describe, expect, it } from "vitest";
import type {
  AgentEditProposal,
  AgentToolTrace,
  ChatMessage
} from "../types/conversation";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import {
  acceptedFileProposalsForMessage,
  approvalItemsForMessage,
  processingDisplayItems,
  processingItems,
  processingLabel,
  visibleResponse,
  workspaceToolLabel
} from "./conversationToolPresentation";

const startedAt = "2026-01-01T00:00:00.000Z";

function longProposal(
  eventId: string,
  type: string,
  status: string,
  runId: string,
  timestamp: string
): LongWorkspaceProposalItem {
  return {
    status,
    event: {
      id: eventId,
      type,
      timestamp,
      payload: { runId }
    }
  } as unknown as LongWorkspaceProposalItem;
}

function tool(
  id: string,
  status: AgentToolTrace["status"] = "completed"
): AgentToolTrace {
  return {
    id,
    name: id === "search" ? "web_search" : "read_workspace_content",
    args: { query: id },
    status,
    requestedAt: startedAt,
    ...(status === "completed" ? { resultSummary: `${id} 完成` } : {})
  };
}

function orderedMessage(
  status: NonNullable<ChatMessage["status"]>
): ChatMessage {
  return {
    id: "message_ordered",
    role: "assistant",
    content: status === "completed" ? "最终回复" : "阶段回答 A阶段回答 B",
    createdAt: startedAt,
    processingStartedAt: startedAt,
    ...(status === "completed"
      ? { processingCompletedAt: "2026-01-01T00:00:06.000Z" }
      : {}),
    status,
    toolCalls: [tool("read"), tool("search")],
    processingSteps: [
      {
        id: "thinking-a",
        type: "thinking",
        content: "思考 A",
        createdAt: "2026-01-01T00:00:01.000Z"
      },
      {
        id: "response-a",
        type: "response",
        content: "阶段回答 A",
        createdAt: "2026-01-01T00:00:02.000Z"
      },
      {
        id: "tool-a",
        type: "tool",
        toolCallId: "read",
        createdAt: "2026-01-01T00:00:03.000Z"
      },
      {
        id: "thinking-b",
        type: "thinking",
        content: "思考 B",
        createdAt: "2026-01-01T00:00:04.000Z"
      },
      {
        id: "response-b",
        type: "response",
        content: "阶段回答 B",
        createdAt: "2026-01-01T00:00:05.000Z"
      },
      {
        id: "tool-b",
        type: "tool",
        toolCallId: "search",
        createdAt: "2026-01-01T00:00:05.500Z"
      },
      ...(status === "completed"
        ? [
            {
              id: "response-final",
              type: "response" as const,
              content: "最终回复",
              createdAt: "2026-01-01T00:00:06.000Z"
            }
          ]
        : [])
    ]
  };
}

describe("conversation tool presentation", () => {
  it("groups only accepted Markdown file changes from this assistant run", () => {
    const message: ChatMessage = {
      id: "assistant-run",
      role: "assistant",
      runId: "run-current",
      content: "完成",
      createdAt: startedAt,
      status: "completed"
    };
    const proposals = [
      longProposal(
        "later-file",
        "long.character_file_proposal",
        "accepted",
        "run-current",
        "2026-01-01T00:00:03.000Z"
      ),
      longProposal(
        "pending-file",
        "long.worldbuilding_file_proposal",
        "ready",
        "run-current",
        "2026-01-01T00:00:02.000Z"
      ),
      longProposal(
        "other-run-file",
        "long.worldbuilding_file_proposal",
        "accepted",
        "run-other",
        "2026-01-01T00:00:01.000Z"
      ),
      longProposal(
        "structure",
        "long.mutation_proposal",
        "accepted",
        "run-current",
        "2026-01-01T00:00:04.000Z"
      ),
      longProposal(
        "earlier-file",
        "long.continuity_file_proposal",
        "accepted",
        "run-current",
        "2026-01-01T00:00:01.000Z"
      )
    ];

    expect(
      acceptedFileProposalsForMessage(message, proposals).map(
        ({ event }) => event.id
      )
    ).toEqual(["earlier-file", "later-file"]);
  });

  it("offers undo for a saved short-story edit even when its tool trace is absent", () => {
    const proposal: AgentEditProposal = {
      id: "plot-edit",
      runId: "run-1",
      workspaceId: "short-book-1",
      stageId: "plot_design",
      documentId: "plot_design",
      title: "剧情设计",
      summary: "调整剧情设计",
      status: "accepted",
      baseRevision: "before",
      proposedRevision: "after",
      toolCallIds: ["edit-tool-1"],
      additions: 2,
      deletions: 1,
      hunks: [],
      createdAt: startedAt,
      updatedAt: startedAt,
      discardSnapshot: { beforeText: "修改前", beforeTitle: "剧情设计" }
    };
    const message: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "已调整",
      createdAt: startedAt,
      status: "completed",
      editProposals: [proposal]
    };

    expect(approvalItemsForMessage(message, [])).toMatchObject([
      { type: "edit-proposal", canDiscard: true }
    ]);
  });

  it("preserves interleaved thinking, responses and tools while streaming", () => {
    const message = orderedMessage("streaming");

    expect(processingItems(message).map((item) => item.type)).toEqual([
      "thinking",
      "response",
      "tool",
      "thinking",
      "response",
      "tool"
    ]);
    expect(processingDisplayItems(message).map((item) => item.type)).toEqual([
      "work-group",
      "response",
      "work-group",
      "response",
      "work-group"
    ]);
    const groups = processingDisplayItems(message).filter(
      (item) => item.type === "work-group"
    );
    expect(groups.map((item) => item.running)).toEqual([false, false, true]);
    expect(visibleResponse(message)).toBe("");
  });

  it("moves only the final completed response outside the processing history", () => {
    const message = orderedMessage("completed");

    expect(
      processingItems(message)
        .filter((item) => item.type === "response")
        .map((item) => item.content)
    ).toEqual(["阶段回答 A", "阶段回答 B"]);
    expect(visibleResponse(message)).toBe("最终回复");
    expect(processingLabel(message, Date.parse(startedAt))).toBe("已处理 6秒");
    expect(
      processingLabel(
        orderedMessage("streaming"),
        Date.parse(startedAt) + 3_000
      )
    ).toBe("已处理 3秒");
    expect(
      processingDisplayItems(message)
        .filter((item) => item.type === "work-group")
        .every((item) => item.type === "work-group" && !item.running)
    ).toBe(true);
  });

  it("keeps every batch child visible and restorable under one real tool call", () => {
    const message: ChatMessage = {
      id: "message_batch",
      role: "assistant",
      content: "三位审阅员正在并发工作",
      createdAt: startedAt,
      status: "completed",
      toolCalls: [
        {
          ...tool("batch-call", "completed"),
          name: "spawn_subagents",
          args: {
            tasks: ["review-a", "review-b", "review-c"]
          }
        }
      ],
      processingSteps: [
        {
          id: "batch-step",
          type: "tool",
          toolCallId: "batch-call",
          createdAt: startedAt
        }
      ],
      subagentRuns: ["review-a", "review-b", "review-c"].map(
        (subagentRunId, index) => ({
          parentToolCallId: "batch-call",
          subagentRunId,
          subagentId: `reviewer-${index + 1}`,
          name: `审阅员 ${index + 1}`,
          task: `独立视角 ${index + 1}`,
          status: "completed",
          runtime: { provider: "test", model: "test", mode: "provider" },
          toolCalls: [],
          processingSteps: [],
          startedAt
        })
      )
    };

    const restored = structuredClone(message);
    const visibleRuns = processingItems(restored).filter(
      (item) => item.type === "subagent"
    );
    expect(visibleRuns).toHaveLength(3);
    expect(visibleRuns.map((item) => item.id)).toEqual([
      "subagent:review-a",
      "subagent:review-b",
      "subagent:review-c"
    ]);
    expect(
      visibleRuns.map(
        (item) => item.type === "subagent" && item.run.parentToolCallId
      )
    ).toEqual(["batch-call", "batch-call", "batch-call"]);
    const timeline = processingDisplayItems(restored);
    expect(timeline.filter((item) => item.type === "subagent")).toHaveLength(3);
    expect(timeline.map((item) => item.id)).toEqual([
      "subagent:review-a",
      "subagent:review-b",
      "subagent:review-c"
    ]);
  });

  it("advances processed time from seconds to minutes and seconds", () => {
    const message = orderedMessage("completed");
    for (const [durationSeconds, label] of [
      [59, "已处理 59秒"],
      [60, "已处理 1分0秒"],
      [61, "已处理 1分1秒"],
      [125, "已处理 2分5秒"]
    ] as const) {
      message.processingCompletedAt = new Date(
        Date.parse(startedAt) + durationSeconds * 1_000
      ).toISOString();
      expect(processingLabel(message, Date.parse(startedAt))).toBe(label);
    }
  });

  it("supports legacy thinking and tool fields", () => {
    const message: ChatMessage = {
      id: "message_legacy",
      role: "assistant",
      content: "旧回复",
      createdAt: startedAt,
      thinking: "旧思考",
      toolCalls: [tool("read")],
      status: "completed"
    };

    expect(processingItems(message).map((item) => item.type)).toEqual([
      "thinking",
      "tool"
    ]);
    expect(processingDisplayItems(message).map((item) => item.type)).toEqual([
      "work-group"
    ]);
    expect(visibleResponse(message)).toBe("旧回复");
  });

  it("provides Chinese labels for chat-assistant tools", () => {
    expect(workspaceToolLabel("list_creation_projects")).toBe("列出创作项目");
    expect(workspaceToolLabel("query_model_usage")).toBe("查询模型用量");
    expect(workspaceToolLabel("list")).toBe("列出范围细节");
    expect(workspaceToolLabel("search_continuity_files")).toBe(
      "搜索连续性文件"
    );
    expect(workspaceToolLabel("web_search")).toBe("智能搜索");
  });
});
