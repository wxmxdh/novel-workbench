import { describe, expect, it } from "vitest";
import type { AgentRunInput } from "./runtime-types";
import { planWorkspaceRun } from "./workspace-run-plan";

describe("native writing reference prompt", () => {
  it("includes Main-verified outline and selected draft in the parent model request", () => {
    const input = {
      runId: "run", sessionId: "session", prompt: "写本章",
      workspaceContext: { longWorkspace: {
        bookId: "longbook_9a146bbe", title: "LOVE", activeRoot: "plot_design", activeAgentId: "plot", navigation: { bookId: "longbook_9a146bbe", counts: { worldbuildingCategories: 0, characters: 0, volumes: 0, arcs: 0, chapterCards: 0, committedChapters: 0 }, worldbuildingCategories: [], characterTypes: [], characterGroups: [], characters: [], volumes: [], arcs: [], chapterCards: [], committedThroughChapterId: null },
        selectedDraftReferences: [{ bookId: "longbook_9a146bbe", chapterCardId: "chapter_one", relation: "current", title: "选用稿", path: "candidate.md", hash: "a".repeat(64), content: "PARENT_NATIVE_REFERENCE_SENTINEL", model: "model-a", version: "v1" }],
        selectedChapterOutline: { bookId: "longbook_9a146bbe", chapterCardId: "chapter_one", version: "v2", path: "card.md", hash: "b".repeat(64), content: "PARENT_NATIVE_OUTLINE_SENTINEL" }
      } }
    } as unknown as AgentRunInput;
    const plan = planWorkspaceRun(input, { basePrompt: "", toolExecutionHooks: {} as never });
    const content = plan.userMessageContent(true);
    expect(JSON.stringify(content)).toContain("PARENT_NATIVE_REFERENCE_SENTINEL");
    expect(JSON.stringify(content)).toContain("PARENT_NATIVE_OUTLINE_SENTINEL");
    expect(JSON.stringify(content)).toContain("不是新的故事事实、正典或作者接受稿");
  });
});
