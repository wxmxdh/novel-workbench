import {
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  committedWorkspace,
  createBatch,
  describe,
  expect,
  expectOperationError,
  file,
  it,
  later,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterContinuityFilePath,
  longChapterWorldRevealsFileId,
  longLedgerCommitFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: crud-and-deletion", () => {
  it("defaults old projects to top tabs and updates per-book feature settings", () => {
    const source = workspace();
    expect(source.featureSettings.worldbuildingItemLayout).toBe("top-tabs");
    expect(source.featureSettings.characterAndContinuityItemLayout).toBe(
      "top-tabs"
    );
    expect(source.featureSettings.plotItemLayout).toBe("top-tabs");

    const result = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          {
            type: "featureSettings.update",
            patch: {
              worldbuildingItemLayout: "left-tree",
              characterAndContinuityItemLayout: "left-tree",
              plotItemLayout: "left-tree"
            }
          }
        ]
      })
    );

    expect(result.snapshot.featureSettings.worldbuildingItemLayout).toBe(
      "left-tree"
    );
    expect(
      result.snapshot.featureSettings.characterAndContinuityItemLayout
    ).toBe("left-tree");
    expect(result.snapshot.featureSettings.plotItemLayout).toBe("left-tree");
    expect(result.fileIntents).toEqual([]);
    expect(result.documentWrites).toEqual([]);
  });

  it("applies typed cross-entity CRUD and returns only file/document intentions", () => {
    const source = workspace();
    const result = applyLongWorkspaceOperations(source, createBatch());

    expect(source.plot.volumes).toHaveLength(1);
    expect(result.snapshot.plot.volumes.map(({ order }) => order)).toEqual([
      1, 2
    ]);
    expect(result.snapshot.plot.volumes[1]?.title).toBe("钟楼卷");
    expect(
      result.snapshot.plot.arcs.find(({ id }) => id === "arc_tower")?.order
    ).toBe(1);
    expect(
      result.snapshot.plot.chapterCards.find(({ id }) => id === "chapter_three")
        ?.narrativeOrder
    ).toBe(1);
    expect(
      result.snapshot.plot.narrativePlacements.find(
        ({ id }) => id === "placement_bell"
      )?.orderInChapter
    ).toBe(1);
    expect(
      result.fileIntents.filter(({ action }) => action === "create")
    ).toHaveLength(8);
    expect(result.documentWrites[0]?.content).toContain("魔法规则");
    expect(result.entityChanges).toHaveLength(
      result.impact.createdEntityIds.length +
        result.impact.updatedEntityIds.length +
        result.impact.deletedEntityIds.length
    );
    expect(
      result.entityChanges.find(({ id }) => id === "volume_two")
    ).toMatchObject({
      kind: "volume",
      action: "create",
      before: null,
      after: expect.objectContaining({ title: "钟楼卷", order: 2 })
    });
    expect(result.provisionalIdMap).toMatchObject({
      provisional_world: "world_magic",
      provisional_character: "character_bob",
      provisional_volume: "volume_two",
      provisional_chapter: "chapter_three",
      provisional_beat: "beat_bell_plant"
    });
    expect(
      LongWorkspaceIndexSnapshotSchema.safeParse(result.snapshot).success
    ).toBe(true);

    const deleteConnectionBatch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [
        {
          type: "connection.delete",
          id: "connection_letter_enables_bell"
        }
      ]
    });
    const deleteConnectionPreview = previewLongWorkspaceOperations(
      result.snapshot,
      deleteConnectionBatch
    );
    const deletedConnection = applyLongWorkspaceOperations(result.snapshot, {
      ...deleteConnectionBatch,
      expectedImpact: deleteConnectionPreview.confirmation
    });
    expect(deletedConnection.snapshot.plot.eventConnections).toHaveLength(0);
    expect(deletedConnection.impact.deletedEntityIds).toContain(
      "connection_letter_enables_bell"
    );
  });

  it("adds an overview file to every newly-created list worldbuilding category", () => {
    const source = workspace();
    const result = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          {
            type: "worldbuilding.create",
            category: {
              id: "world_geography",
              title: "地理",
              order: source.worldbuilding.length + 1,
              format: "list",
              contentAuthority: "files",
              items: []
            }
          }
        ]
      })
    );
    const category = result.snapshot.worldbuilding.find(
      ({ id }) => id === "world_geography"
    );
    expect(category).toMatchObject({
      format: "list",
      overview: {
        id: longWorldbuildingOverviewFileId("world_geography"),
        path: longWorldbuildingOverviewContentPath("world_geography")
      }
    });
    expect(result.fileIntents).toContainEqual(
      expect.objectContaining({
        action: "create",
        file: expect.objectContaining({
          id: longWorldbuildingOverviewFileId("world_geography")
        })
      })
    );
  });

  it("creates optional chapter continuity files and deletes them with the chapter", () => {
    const source = workspace();
    const currentState = file(
      longChapterCharacterCurrentStateFileId("chapter_one", "character_alice"),
      longChapterCharacterContinuityFilePath(
        "chapter_one",
        "character_alice",
        "current-state.md"
      ),
      later
    );
    const history = file(
      longChapterCharacterHistoryFileId("chapter_one", "character_alice"),
      longChapterCharacterContinuityFilePath(
        "chapter_one",
        "character_alice",
        "history.md"
      ),
      later
    );
    const worldReveals = file(
      longChapterWorldRevealsFileId("chapter_one"),
      longChapterContinuityFilePath("chapter_one", "world-reveals.md"),
      later
    );
    const created = applyLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "chapterContinuity.worldReveals.create",
          chapterCardId: "chapter_one",
          file: worldReveals
        },
        {
          type: "chapterContinuity.character.create",
          chapterCardId: "chapter_one",
          characterId: "character_alice",
          currentState,
          history
        }
      ]
    });
    expect(created.fileIntents).toHaveLength(3);
    expect(created.snapshot.chapters[0]).toMatchObject({
      worldReveals: { id: worldReveals.id },
      characterContinuity: [
        {
          characterId: "character_alice",
          currentState: { id: currentState.id },
          history: { id: history.id }
        }
      ]
    });

    const characterDeleteBatch = {
      updatedAt: later,
      operations: [{ type: "character.delete", id: "character_alice" }]
    } satisfies Parameters<typeof previewLongWorkspaceOperations>[1];
    const characterDeletePreview = previewLongWorkspaceOperations(
      created.snapshot,
      characterDeleteBatch
    );
    const deletedCharacter = applyLongWorkspaceOperations(created.snapshot, {
      ...characterDeleteBatch,
      expectedImpact: characterDeletePreview.confirmation
    });
    expect(deletedCharacter.snapshot.chapters[0]!.characterContinuity).toEqual(
      []
    );
    expect(
      deletedCharacter.fileIntents.filter(
        ({ action, file }) =>
          action === "delete" &&
          (file.id === currentState.id || file.id === history.id)
      )
    ).toHaveLength(2);

    const chapterDeleteBatch = {
      updatedAt: later,
      operations: [{ type: "chapter.delete", id: "chapter_one" }]
    } satisfies Parameters<typeof previewLongWorkspaceOperations>[1];
    const chapterDeletePreview = previewLongWorkspaceOperations(
      created.snapshot,
      chapterDeleteBatch
    );
    const deleted = applyLongWorkspaceOperations(created.snapshot, {
      ...chapterDeleteBatch,
      expectedImpact: chapterDeletePreview.confirmation
    });
    expect(
      deleted.fileIntents.filter(({ action }) => action === "delete")
    ).toHaveLength(8);
  });

  it("edits optional continuity files directly regardless of commit history", () => {
    const source = workspace();
    const currentState = file(
      longChapterCharacterCurrentStateFileId("chapter_one", "character_alice"),
      longChapterCharacterContinuityFilePath(
        "chapter_one",
        "character_alice",
        "current-state.md"
      ),
      later
    );
    const history = file(
      longChapterCharacterHistoryFileId("chapter_one", "character_alice"),
      longChapterCharacterContinuityFilePath(
        "chapter_one",
        "character_alice",
        "history.md"
      ),
      later
    );
    const worldReveals = file(
      longChapterWorldRevealsFileId("chapter_one"),
      longChapterContinuityFilePath("chapter_one", "world-reveals.md"),
      later
    );
    const created = applyLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "chapterContinuity.worldReveals.create",
          chapterCardId: "chapter_one",
          file: worldReveals
        },
        {
          type: "chapterContinuity.character.create",
          chapterCardId: "chapter_one",
          characterId: "character_alice",
          currentState,
          history
        }
      ]
    });

    const deleteContinuityBatch = {
      updatedAt: later,
      operations: [
        {
          type: "chapterContinuity.worldReveals.delete",
          chapterCardId: "chapter_one"
        },
        {
          type: "chapterContinuity.character.delete",
          chapterCardId: "chapter_one",
          characterId: "character_alice"
        }
      ]
    } satisfies Parameters<typeof previewLongWorkspaceOperations>[1];
    const deleteContinuityPreview = previewLongWorkspaceOperations(
      created.snapshot,
      deleteContinuityBatch
    );
    const deleted = applyLongWorkspaceOperations(created.snapshot, {
      ...deleteContinuityBatch,
      expectedImpact: deleteContinuityPreview.confirmation
    });
    expect(deleted.snapshot.chapters[0]).toMatchObject({
      worldReveals: null,
      characterContinuity: []
    });
    const deleteIntents = deleted.fileIntents.map(
      ({ action, file: target }) => [action, target.id]
    );
    expect(deleteIntents).toHaveLength(3);
    expect(deleteIntents).toEqual(
      expect.arrayContaining([
        ["delete", worldReveals.id],
        ["delete", currentState.id],
        ["delete", history.id]
      ])
    );

    const committed = structuredClone(created.snapshot);
    committed.chapters[0]!.commitId = "commit_existing";
    committed.ledger.committedThroughChapterId = "chapter_one";
    committed.ledger.commits.push({
      id: "commit_existing",
      mode: "text_files",
      sequence: 1,
      chapterCardId: "chapter_one",
      committedAt: later,
      placementIds: [],
      foreshadowingBeatIds: [],
      recordFile: file(
        longLedgerCommitFileId("commit_existing"),
        "long/ledger/commit-existing.json"
      )
    });
    for (const operation of [
      {
        type: "chapterContinuity.worldReveals.delete" as const,
        chapterCardId: "chapter_one"
      },
      {
        type: "chapterContinuity.character.delete" as const,
        chapterCardId: "chapter_one",
        characterId: "character_alice"
      }
    ]) {
      const target = structuredClone(committed);
      const batch = { updatedAt: later, operations: [operation] };
      const preview = previewLongWorkspaceOperations(target, batch);
      expect(
        applyLongWorkspaceOperations(target, {
          ...batch,
          expectedImpact: preview.confirmation
        }).fileIntents.some(({ action }) => action === "delete")
      ).toBe(true);
    }

    const committedWithoutOptionalFiles = committedWorkspace();
    for (const operation of [
      {
        type: "chapterContinuity.worldReveals.create" as const,
        chapterCardId: "chapter_one",
        file: worldReveals
      },
      {
        type: "chapterContinuity.character.create" as const,
        chapterCardId: "chapter_one",
        characterId: "character_alice",
        currentState,
        history
      }
    ]) {
      expect(
        applyLongWorkspaceOperations(
          structuredClone(committedWithoutOptionalFiles),
          {
            updatedAt: later,
            operations: [operation]
          }
        ).fileIntents.some(({ action }) => action === "create")
      ).toBe(true);
    }

    for (const forbiddenType of [
      "chapterContinuity.body.delete",
      "chapterContinuity.chapterEndState.delete",
      "chapterContinuity.handoff.delete",
      "chapterContinuity.foreshadowingChanges.delete"
    ]) {
      expect(
        LongWorkspaceOperationBatchSchema.safeParse({
          updatedAt: later,
          operations: [{ type: forbiddenType, chapterCardId: "chapter_one" }]
        }).success
      ).toBe(false);
    }
  });

  it("previews and removes references before deleting related entities", () => {
    const source = workspace();
    const arcBatch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "arc.delete", id: "arc_letter" }]
    });
    const arcPreview = previewLongWorkspaceOperations(source, arcBatch);
    const deletedArc = applyLongWorkspaceOperations(source, {
      ...arcBatch,
      expectedImpact: arcPreview.confirmation
    });
    expect(deletedArc.snapshot.plot.arcs).toEqual([]);
    expect(deletedArc.snapshot.plot.storyEvents[0]?.arcIds).toEqual([]);

    const characterBatch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "character.delete", id: "character_alice" }]
    });
    const characterPreview = previewLongWorkspaceOperations(
      source,
      characterBatch
    );
    const deletedCharacter = applyLongWorkspaceOperations(source, {
      ...characterBatch,
      expectedImpact: characterPreview.confirmation
    });
    expect(deletedCharacter.snapshot.characters).toEqual([]);
    expect(deletedCharacter.snapshot.plot.storyEvents[0]?.characterIds).toEqual(
      []
    );

    expectOperationError(
      () =>
        applyLongWorkspaceOperations(source, {
          updatedAt: later,
          operations: [
            {
              type: "connection.create",
              connection: {
                id: "connection_missing_target",
                sourceEventId: "event_letter",
                targetEventId: "event_missing",
                type: "causes",
                note: ""
              }
            }
          ]
        }),
      "invalid_result"
    );
  });

  it("deletes a plot point without cascading through weakly linked chapters", () => {
    const source = workspace();
    source.plot.storyEvents = [];
    source.plot.storyPlots = [];
    source.plot.eventConnections = [];
    source.plot.narrativePlacements = [];
    source.plot.foreshadowing = [];

    const arcDeleteBatch = {
      updatedAt: later,
      operations: [{ type: "arc.delete", id: "arc_letter" }]
    } satisfies Parameters<typeof previewLongWorkspaceOperations>[1];
    const arcDeletePreview = previewLongWorkspaceOperations(
      source,
      arcDeleteBatch
    );
    const result = applyLongWorkspaceOperations(source, {
      ...arcDeleteBatch,
      expectedImpact: arcDeletePreview.confirmation
    });

    expect(result.snapshot.plot.arcs).toEqual([]);
    expect(result.snapshot.plot.chapterCards).toHaveLength(2);
    expect(
      result.snapshot.plot.chapterCards.every(
        ({ volumeId, primaryArcId }) =>
          volumeId === "volume_one" && primaryArcId === null
      )
    ).toBe(true);
    expect(result.snapshot.chapters).toHaveLength(2);
    expect(result.fileIntents).toEqual([]);

    const committed = committedWorkspace();
    committed.plot.storyEvents = [];
    const committedArcDeletePreview = previewLongWorkspaceOperations(
      committed,
      arcDeleteBatch
    );
    const committedResult = applyLongWorkspaceOperations(committed, {
      ...arcDeleteBatch,
      expectedImpact: committedArcDeletePreview.confirmation
    });
    expect(
      committedResult.snapshot.plot.chapterCards.find(
        ({ id }) => id === "chapter_one"
      )?.primaryArcId
    ).toBeNull();
    expect(committedResult.snapshot.chapters[0]!.commitId).toBe("commit_first");
  });
});
