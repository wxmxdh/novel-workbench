import { createLongWorkspaceNavigationSnapshot } from "./index";
import {
  LongWorkspaceIndexSnapshotSchema,
  applyLongWorkspaceOperations,
  describe,
  expect,
  it,
  later,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: empty container deletion", () => {
  it("deletes the final volume and all owned chapter files", () => {
    const source = workspace();
    const deletedChapterFileIds = source.chapters.flatMap((chapter) => [
      chapter.body.id,
      chapter.card.id,
      chapter.characterState.id,
      chapter.handoff.id,
      chapter.foreshadowingChanges.id,
      ...(chapter.worldReveals ? [chapter.worldReveals.id] : []),
      ...chapter.characterContinuity.flatMap((entry) => [
        entry.currentState.id,
        entry.history.id
      ])
    ]);
    const batch = {
      updatedAt: later,
      operations: [{ type: "volume.delete" as const, id: "volume_one" }]
    };
    const preview = previewLongWorkspaceOperations(source, batch);

    expect(preview.impact.deletedEntityIds).toEqual(
      expect.arrayContaining(["volume_one", "arc_letter", "chapter_one"])
    );
    expect(preview.impact.deletedFileIds).toEqual(
      expect.arrayContaining(deletedChapterFileIds)
    );
    expect(preview.entityChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "volume",
          id: "volume_one",
          action: "delete"
        }),
        expect.objectContaining({
          kind: "arc",
          id: "arc_letter",
          action: "delete"
        }),
        expect.objectContaining({
          kind: "chapter-card",
          id: "chapter_one",
          action: "delete"
        })
      ])
    );

    const result = applyLongWorkspaceOperations(source, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(result.snapshot.plot.volumes).toEqual([]);
    expect(result.snapshot.plot.arcs).toEqual([]);
    expect(result.snapshot.plot.chapterCards).toEqual([]);
    expect(result.snapshot.chapters).toEqual([]);
    expect(
      createLongWorkspaceNavigationSnapshot(result.snapshot)
    ).toMatchObject({
      counts: { volumes: 0, arcs: 0, chapterCards: 0 },
      volumes: [],
      arcs: [],
      chapterCards: []
    });
  });

  it("cascades the characters when deleting the final populated type", () => {
    const source = workspace();
    source.characterTypes = source.characterTypes.filter(
      ({ id }) => id === "protagonist"
    );
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const batch = {
      updatedAt: later,
      operations: [{ type: "characterType.delete" as const, id: "protagonist" }]
    };
    const preview = previewLongWorkspaceOperations(parsed, batch);

    expect(preview.impact.deletedEntityIds).toEqual(
      expect.arrayContaining(["protagonist", "character_alice"])
    );
    expect(preview.impact.deletedFileIds).toEqual(
      expect.arrayContaining(
        parsed.characterFiles.flatMap(({ coreProfile, relationships }) => [
          coreProfile.id,
          relationships.id
        ])
      )
    );
    const result = applyLongWorkspaceOperations(parsed, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(result.snapshot.characterTypes).toEqual([]);
    expect(result.snapshot.characters).toEqual([]);
    expect(result.snapshot.characterFiles).toEqual([]);
    expect(
      createLongWorkspaceNavigationSnapshot(result.snapshot)
    ).toMatchObject({
      counts: { characters: 0 },
      characterTypes: [],
      characters: []
    });
  });

  it("deletes an empty final character type without creating a replacement", () => {
    const source = workspace();
    source.characterTypes = [{ id: "passerby", title: "路人", order: 1 }];
    source.characters = [];
    source.characterFiles = [];
    source.plot.storyEvents.forEach((event) => {
      event.characterIds = [];
    });
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const batch = {
      updatedAt: later,
      operations: [{ type: "characterType.delete" as const, id: "passerby" }]
    };
    const preview = previewLongWorkspaceOperations(parsed, batch);

    expect(preview.impact.deletedEntityIds).toEqual(["passerby"]);
    expect(preview.entityChanges).toContainEqual(
      expect.objectContaining({
        kind: "character-type",
        id: "passerby",
        action: "delete"
      })
    );
    const result = applyLongWorkspaceOperations(parsed, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(result.snapshot.characterTypes).toEqual([]);
    expect(
      createLongWorkspaceNavigationSnapshot(result.snapshot).characterTypes
    ).toEqual([]);
  });
});
