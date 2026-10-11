import type { LongWorkspaceImpactConfirmation } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { longImpactConfirmationLines } from "./longImpactConfirmation";

const EMPTY_IMPACT: LongWorkspaceImpactConfirmation["impact"] = {
  createdEntityIds: [],
  updatedEntityIds: [],
  deletedEntityIds: [],
  createdFileIds: [],
  deletedFileIds: [],
  documentWriteProposalIds: []
};

function confirmation(
  changes: Pick<
    LongWorkspaceImpactConfirmation,
    "entityChanges" | "relationshipChanges"
  >
): LongWorkspaceImpactConfirmation {
  return {
    impact: EMPTY_IMPACT,
    ...changes,
    fileIntents: [],
    ledgerRecordEdits: []
  };
}

describe("longImpactConfirmationLines", () => {
  it("describes a pure entity field edit as an update", () => {
    const lines = longImpactConfirmationLines(
      confirmation({
        entityChanges: [
          {
            kind: "volume",
            id: "volume_one",
            action: "update",
            before: { id: "volume_one", title: "第一卷", summary: "旧梗概" },
            after: { id: "volume_one", title: "第一卷", summary: "新梗概" }
          }
        ],
        relationshipChanges: []
      })
    );

    expect(lines).toEqual(["更新分卷“第一卷”（volume_one）"]);
    expect(lines[0]).not.toContain("解除关联");
  });

  it("uses the localized relationship label for an explicit unlink", () => {
    const lines = longImpactConfirmationLines(
      confirmation({
        entityChanges: [],
        relationshipChanges: [
          {
            kind: "chapter-primary-arc",
            id: "relation_chapter-primary-arc:11:chapter_one:10:arc_letter",
            action: "delete",
            before: { sourceId: "chapter_one", targetId: "arc_letter" },
            after: null
          }
        ]
      })
    );

    expect(lines[0]).toContain("解除章卡与主剧情点");
    expect(lines[0]).toContain("chapter_one");
    expect(lines[0]).toContain("arc_letter");
  });
});
