import { describe, it, expect } from "vitest";
import { fixture } from "../types/longWorkspace.test-support";
import { projectLongPlotPlanningBoard } from "./longPlotPlanningBoard";

describe("plot planning and records", () => {
  it("shows an outline as selected only when its explicit author evidence exists", () => {
    const { workspaceIndex } = fixture(null);
    const chapter = workspaceIndex.plot.chapterCards[0]!;
    const projected =
      projectLongPlotPlanningBoard(workspaceIndex)[0]!.chapters[0]!;
    expect(projected.outlineSelectionStatus).toBe("unselected");
    chapter.outlineSelection = {
      sourceFileId: workspaceIndex.chapters[0]!.card.id,
      version: "discussion-B",
      sha256: "a".repeat(64),
      selectedAt: "2026-10-11T00:00:00.000Z",
      evidence: "author-explicit-selection"
    };
    const selected =
      projectLongPlotPlanningBoard(workspaceIndex)[0]!.chapters[0]!;
    expect(selected.outlineSelectionStatus).toBe("unverified");
    expect(selected.outlineSelection?.version).toBe("discussion-B");
  });
  it("distinguishes an unwritten plan, prose awaiting records, and saved records", () => {
    const { workspaceIndex } = fixture(null);
    workspaceIndex.ledger.commits = [];
    const entry = workspaceIndex.chapters[0]!;
    entry.bodyStatus = "empty";
    expect(
      projectLongPlotPlanningBoard(workspaceIndex)[0]!.chapters[0]!.status
    ).toBe("planned");
    entry.bodyStatus = "written";
    const chapter =
      projectLongPlotPlanningBoard(workspaceIndex)[0]!.chapters[0]!;
    expect(chapter.status).toBe("written");
    expect(chapter.recordFileId).toBe(entry.characterState.id);
    expect(chapter.handoffFileId).toBeUndefined();
  });
  it("maps every batch member to the saved checkpoint and its handoff", () => {
    const { workspaceIndex } = fixture(null);
    const original = workspaceIndex.chapters[0]!;
    workspaceIndex.plot.chapterCards.push({
      ...workspaceIndex.plot.chapterCards[0]!,
      id: "chapter_two",
      narrativeOrder: 2
    });
    workspaceIndex.chapters.push({
      ...original,
      chapterCardId: "chapter_two",
      characterState: { ...original.characterState, id: "file_second_state" },
      handoff: { ...original.handoff, id: "file_second_handoff" }
    });
    workspaceIndex.ledger.commits = [
      {
        id: "commit_batch",
        sequence: 1,
        mode: "text_files_batch",
        chapterCardId: "chapter_two",
        chapterCardIds: [original.chapterCardId, "chapter_two"],
        checkpointChapterCardId: "chapter_two",
        committedAt: original.body.updatedAt,
        placementIds: [],
        foreshadowingBeatIds: [],
        recordFile: {
          id: "file_commit",
          path: "record.json",
          updatedAt: original.body.updatedAt
        }
      }
    ];
    const before = JSON.stringify(workspaceIndex);
    const chapters = projectLongPlotPlanningBoard(workspaceIndex)[0]!.chapters;
    expect(chapters.map((chapter) => chapter.status)).toEqual([
      "recorded",
      "recorded"
    ]);
    expect(
      chapters.every(
        (chapter) =>
          chapter.recordFileId === "file_second_state" &&
          chapter.handoffFileId === "file_second_handoff"
      )
    ).toBe(true);
    expect(JSON.stringify(workspaceIndex)).toBe(before);
  });
});
