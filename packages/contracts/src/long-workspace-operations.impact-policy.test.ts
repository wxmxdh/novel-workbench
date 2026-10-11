import { describe, expect, it } from "vitest";
import {
  longWorkspaceImpactIsDestructive,
  longWorkspaceOperationsRequireImpactConfirmation,
  type LongWorkspaceDestructiveImpact
} from "./long-workspace-operations";

const emptyImpact: LongWorkspaceDestructiveImpact = {
  entityChanges: [],
  relationshipChanges: [],
  fileIntents: [],
  ledgerRecordEdits: []
};

describe("long workspace destructive impact policy", () => {
  it("keeps explicit deletes gated even if a handler reports empty impact", () => {
    expect(longWorkspaceImpactIsDestructive(emptyImpact)).toBe(false);
    expect(
      longWorkspaceOperationsRequireImpactConfirmation(
        [{ type: "character.delete" }],
        emptyImpact
      )
    ).toBe(true);
  });

  it("gates destructive effects hidden behind a non-delete command name", () => {
    const conversionImpact: LongWorkspaceDestructiveImpact = {
      ...emptyImpact,
      fileIntents: [
        {
          action: "delete",
          file: {
            id: "longfile_world_rules",
            path: "long/worldbuilding/rules.md",
            updatedAt: "2026-07-26T12:00:00.000Z"
          },
          reason: "Convert worldbuilding category"
        }
      ]
    };

    expect(
      longWorkspaceOperationsRequireImpactConfirmation(
        [{ type: "worldbuilding.update" }],
        conversionImpact
      )
    ).toBe(true);
  });
});
