import { describe, expect, it } from "vitest";
import { fixture } from "../types/longWorkspace.test-support";
import {
  projectLongPlotContinuity,
  projectLongPlotPlanningBoard
} from "./longPlotPlanningBoard";

describe("plot board isolated smoke", () => {
  it("keeps explicit outline choice separate from committed continuity and exposes only sourced state", () => {
    const { workspaceIndex } = fixture(null);
    const card = workspaceIndex.plot.chapterCards[0]!;
    const files = workspaceIndex.chapters[0]!;
    files.bodyStatus = "empty";
    card.outlineSelection = {
      sourceFileId: files.card.id,
      version: "author-picked-v2",
      sha256: "b".repeat(64),
      selectedAt: "2026-10-11T00:00:00.000Z",
      evidence: "author-explicit-selection"
    };
    const board = projectLongPlotPlanningBoard(workspaceIndex)[0]!.chapters[0]!;
    const continuity = projectLongPlotContinuity(workspaceIndex);
    expect(board.outlineSelectionStatus).toBe("unverified");
    expect(board.outlineSelection?.version).toBe("author-picked-v2");
    expect(board.status).toBe("planned");
    expect(continuity.hasCommittedRecords).toBe(false);
    expect(continuity.handoff).toBeNull();
    expect(workspaceIndex.ledger.commits).toHaveLength(0);
  });
});
