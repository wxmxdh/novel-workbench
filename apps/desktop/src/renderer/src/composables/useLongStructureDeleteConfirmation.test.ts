import {
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceIndexSnapshotSchema,
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { computed } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useLongStructureDeleteConfirmation } from "./useLongStructureDeleteConfirmation";

const NOW = "2026-08-30T04:00:00.000Z";
const CATEGORY_ID = "world_delete_without_waiting";

function snapshot(): LongWorkspaceIndexSnapshot {
  return LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId: "longbook_delete_without_waiting",
    updatedAt: NOW,
    bookLine: {
      id: LONG_BOOK_LINE_FILE_ID,
      path: "long/plot/book-line.md",
      updatedAt: NOW
    },
    worldbuilding: [
      {
        id: CATEGORY_ID,
        title: "境界说明",
        order: 1,
        format: "text",
        contentAuthority: "markdown",
        file: {
          id: longWorldbuildingFileId(CATEGORY_ID),
          path: longWorldbuildingContentPath(CATEGORY_ID),
          updatedAt: NOW
        }
      }
    ],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [],
      arcs: [],
      chapterCards: [],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [],
    ledger: { committedThroughChapterId: null, commits: [] }
  });
}

describe("useLongStructureDeleteConfirmation", () => {
  it("submits a cloneable worldbuilding delete after the local preview", () => {
    const index = snapshot();
    const mutate = vi.fn();
    const confirmation = useLongStructureDeleteConfirmation({
      snapshot: computed(() => index),
      locked: () => false,
      mutate,
      notify: { info: vi.fn(), warning: vi.fn() }
    });

    confirmation.openDelete({
      kind: "worldbuilding",
      id: CATEGORY_ID,
      title: "境界说明",
      detail: "连续文本"
    });

    expect(confirmation.pendingDelete.value).toMatchObject({
      id: CATEGORY_ID,
      previewPending: false,
      batch: {
        operations: [{ type: "worldbuilding.delete", id: CATEGORY_ID }]
      },
      expectedImpact: {
        impact: {
          deletedEntityIds: expect.arrayContaining([CATEGORY_ID]),
          deletedFileIds: expect.arrayContaining([
            longWorldbuildingFileId(CATEGORY_ID)
          ])
        }
      }
    });

    confirmation.confirmDelete();
    const submittedBatch = mutate.mock.calls[0]?.[0];
    expect(submittedBatch).toBeDefined();
    expect(() => structuredClone(submittedBatch)).not.toThrow();
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [{ type: "worldbuilding.delete", id: CATEGORY_ID }],
        expectedImpact: expect.any(Object)
      }),
      expect.any(Object)
    );
  });
});
