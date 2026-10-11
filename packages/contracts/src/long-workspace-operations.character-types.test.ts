import {
  applyLongWorkspaceOperations,
  describe,
  expect,
  it,
  later,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: character types", () => {
  it("creates custom character types and migrates characters atomically on delete", () => {
    const source = workspace();
    const created = applyLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "characterType.create",
          characterType: {
            id: "chartype_antagonist",
            title: "反派",
            order: source.characterTypes.length + 1
          }
        }
      ]
    });
    expect(created.snapshot.characterTypes.at(-1)).toEqual({
      id: "chartype_antagonist",
      title: "反派",
      order: 5
    });
    expect(created.entityChanges).toContainEqual({
      kind: "character-type",
      id: "chartype_antagonist",
      action: "create",
      before: null,
      after: {
        id: "chartype_antagonist",
        title: "反派",
        order: 5
      }
    });

    const deleteEmptyTypeBatch = {
      updatedAt: later,
      operations: [{ type: "characterType.delete", id: "passerby" as const }]
    } satisfies Parameters<typeof previewLongWorkspaceOperations>[1];
    const deleteEmptyTypePreview = previewLongWorkspaceOperations(
      created.snapshot,
      deleteEmptyTypeBatch
    );
    expect(deleteEmptyTypePreview.impact.deletedEntityIds).toEqual([
      "passerby"
    ]);
    expect(deleteEmptyTypePreview.entityChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "character-type",
          id: "passerby",
          action: "delete"
        })
      ])
    );

    const originalFiles = structuredClone(created.snapshot.characterFiles);
    const deleteTypeBatch = {
      updatedAt: later,
      operations: [
        {
          type: "characterType.delete",
          id: "protagonist",
          moveCharactersToTypeId: "chartype_antagonist"
        }
      ]
    } satisfies Parameters<typeof previewLongWorkspaceOperations>[1];
    const deleteTypePreview = previewLongWorkspaceOperations(
      created.snapshot,
      deleteTypeBatch
    );
    expect(deleteTypePreview.impact.deletedEntityIds).toEqual(["protagonist"]);
    expect(deleteTypePreview.impact.updatedEntityIds).toContain(
      "character_alice"
    );
    expect(deleteTypePreview.entityChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "character-type",
          id: "protagonist",
          action: "delete"
        }),
        expect.objectContaining({
          kind: "character",
          id: "character_alice",
          action: "update"
        })
      ])
    );
    const migrated = applyLongWorkspaceOperations(created.snapshot, {
      ...deleteTypeBatch,
      expectedImpact: deleteTypePreview.confirmation
    });
    expect(
      migrated.snapshot.characterTypes.some(({ id }) => id === "protagonist")
    ).toBe(false);
    expect(migrated.snapshot.characters[0]).toMatchObject({
      id: "character_alice",
      group: "chartype_antagonist",
      order: 1
    });
    expect(migrated.snapshot.characterFiles).toEqual(originalFiles);

    const cascadeDeleteBatch = {
      updatedAt: later,
      operations: [{ type: "characterType.delete", id: "protagonist" as const }]
    } satisfies Parameters<typeof previewLongWorkspaceOperations>[1];
    const cascadeDeletePreview = previewLongWorkspaceOperations(
      created.snapshot,
      cascadeDeleteBatch
    );
    expect(cascadeDeletePreview.impact.deletedEntityIds).toEqual(
      expect.arrayContaining(["protagonist", "character_alice"])
    );
    expect(cascadeDeletePreview.entityChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "character-type",
          id: "protagonist",
          action: "delete"
        }),
        expect.objectContaining({
          kind: "character",
          id: "character_alice",
          action: "delete"
        })
      ])
    );
    const cascadeDeleted = applyLongWorkspaceOperations(created.snapshot, {
      ...cascadeDeleteBatch,
      expectedImpact: cascadeDeletePreview.confirmation
    });
    expect(cascadeDeleted.snapshot.characters).toEqual([]);
    expect(cascadeDeleted.snapshot.characterFiles).toEqual([]);
  });
});
