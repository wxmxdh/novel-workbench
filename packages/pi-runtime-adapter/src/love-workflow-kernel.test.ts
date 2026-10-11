import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_PROFILES,
  type LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { PiAgentRuntimeAdapter } from "./adapter";
import type { AgentRunInput, AgentRuntimeEvent } from "./runtime-types";

describe("chapter context through the actual Agent kernel", () => {
  it("puts freshly acquired previous text in the current model messages after a cold conversation restore", async () => {
    const profile = DEFAULT_LONG_AGENT_PROFILES.find(
      ({ id }) => id === "long"
    )!;
    const workspace: LongWorkspaceRuntimeContext = {
      bookId: "longbook_9a146bbe",
      title: "LOVE",
      activeRoot: "plot_design",
      activeAgentId: profile.id,
      navigation: {
        schemaVersion: 1,
        bookId: "longbook_9a146bbe",
        updatedAt: "2026-10-05T00:00:00Z",
        counts: {
          worldbuildingCategories: 0,
          characters: 0,
          volumes: 1,
          arcs: 0,
          chapterCards: 0,
          storyEvents: 0,
          storyPlots: 0,
          foreshadowingThreads: 0,
          committedChapters: 0
        },
        worldbuilding: [],
        characterTypes: [],
        characters: [],
        volumes: [{ id: "vol-1", title: "第一卷", order: 1 }],
        arcs: [],
        chapterCards: [],
        committedThroughChapterId: null
      }
    };
    const input: AgentRunInput = {
      runId: "run-next",
      sessionId: "session-next",
      prompt: "先讨论第二章大纲",
      longAgentProfile: profile,
      workspaceContext: { longWorkspace: workspace },
      conversationHistory: [
        {
          role: "user",
          content: "旧的讨论摘要不含前章全文",
          createdAt: "2026-10-04T00:00:00Z",
          runId: "old"
        }
      ],
      longCommandExecutor: async (command) => {
        if (command.type !== "long.loveChapterWorkflow")
          throw new Error("Unexpected command");
        return {
          status: "accepted",
          requestId: command.id,
          payload:
            command.payload.action === "status"
              ? { ok: true, chapterCatalog: [{ chapter: 2, volume: "第一卷" }] }
              : {
                  ok: true,
                  packet: {
                    previousDraft: {
                      content: "实际上一章正文终点：我把车锁放回包里。"
                    },
                    selectedOutline: null,
                    missing: ["当前大纲未选"]
                  }
                }
        };
      }
    };
    const runtime = new PiAgentRuntimeAdapter({
      tokensPerSecond: 0,
      evaluationMode: true
    });
    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.start(input)) events.push(event);
    expect(
      events.some((event) => event.type === "agent.error"),
      JSON.stringify(events)
    ).toBe(false);
    expect(events.some((event) => event.type === "agent.completed")).toBe(true);
    const snapshot = events.find(
      (event) => event.type === "agent.evaluation_snapshot"
    );
    expect(JSON.stringify(snapshot)).toContain("实际上一章正文终点");
    expect(JSON.stringify(snapshot)).toContain("当前大纲未选");
  });
});
