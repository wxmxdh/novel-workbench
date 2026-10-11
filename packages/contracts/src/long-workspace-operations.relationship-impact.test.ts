import {
  applyLongWorkspaceOperations,
  describe,
  expect,
  expectOperationError,
  it,
  later,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: relationship impact", () => {
  it("gates event updates that remove arc and character relationships", () => {
    const source = workspace();
    const batch = {
      updatedAt: later,
      operations: [
        {
          type: "event.update" as const,
          id: "event_letter",
          patch: { arcIds: [], characterIds: [] }
        }
      ],
      documentWrites: []
    };

    const preview = previewLongWorkspaceOperations(source, batch);
    expect(
      preview.relationshipChanges.map(({ action, kind }) => [action, kind])
    ).toEqual(
      expect.arrayContaining([
        ["delete", "story-event-arc"],
        ["delete", "story-event-character"]
      ])
    );
    expect(
      preview.relationshipChanges.find(
        ({ action, kind }) =>
          action === "delete" && kind === "story-event-character"
      )
    ).toMatchObject({
      before: { sourceId: "event_letter", targetId: "character_alice" },
      after: null
    });
    expectOperationError(
      () => applyLongWorkspaceOperations(source, batch),
      "impact_mismatch"
    );
    expect(
      applyLongWorkspaceOperations(source, {
        ...batch,
        expectedImpact: preview.confirmation
      }).snapshot.plot.storyEvents[0]
    ).toMatchObject({ arcIds: [], characterIds: [] });
  });

  it("gates clearing a truth event and every nullable beat anchor", () => {
    const source = workspace();
    source.plot.narrativePlacements.push({
      id: "placement_letter",
      eventId: "event_letter",
      chapterCardId: "chapter_one",
      orderInChapter: 1,
      mode: "clue",
      disclosure: "hint",
      writingPrompt: "",
      status: "planned",
      commitId: null
    });
    source.plot.foreshadowing.push({
      id: "foreshadow_letter",
      title: "来信真相",
      coreQuestion: "谁寄出了信？",
      truthEventId: "event_letter",
      expectedReaderEffect: "保持疑问",
      status: "planned",
      beats: [
        {
          id: "beat_letter",
          type: "plant",
          order: 1,
          volumeId: "volume_one",
          arcId: "arc_letter",
          eventId: "event_letter",
          placementId: "placement_letter",
          chapterCardId: "chapter_one",
          plannedScope: "",
          note: "",
          status: "planned",
          commitId: null
        }
      ]
    });
    const batch = {
      updatedAt: later,
      operations: [
        {
          type: "foreshadowing.update" as const,
          id: "foreshadow_letter",
          patch: { truthEventId: null }
        },
        {
          type: "foreshadowingBeat.update" as const,
          id: "beat_letter",
          patch: {
            volumeId: null,
            arcId: null,
            eventId: null,
            placementId: null,
            chapterCardId: null,
            plannedScope: "待重新指定锚点"
          }
        }
      ],
      documentWrites: []
    };

    const preview = previewLongWorkspaceOperations(source, batch);
    const deletedKinds = preview.relationshipChanges
      .filter(({ action }) => action === "delete")
      .map(({ kind }) => kind);
    expect(deletedKinds).toEqual(
      expect.arrayContaining([
        "foreshadowing-truth-event",
        "foreshadowing-beat-volume",
        "foreshadowing-beat-arc",
        "foreshadowing-beat-event",
        "foreshadowing-beat-placement",
        "foreshadowing-beat-chapter"
      ])
    );
    expectOperationError(
      () => applyLongWorkspaceOperations(source, batch),
      "impact_mismatch"
    );
  });

  it("gates arc moves that unlink chapters and replace the volume edge", () => {
    const source = workspace();
    source.plot.volumes.push({
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    });
    const batch = {
      updatedAt: later,
      operations: [
        {
          type: "arc.move" as const,
          id: "arc_letter",
          toVolumeId: "volume_two"
        }
      ],
      documentWrites: []
    };

    const preview = previewLongWorkspaceOperations(source, batch);
    expect(
      preview.relationshipChanges.filter(
        ({ action, kind }) =>
          action === "delete" && kind === "chapter-primary-arc"
      )
    ).toHaveLength(2);
    expect(
      preview.relationshipChanges.map(({ action, kind }) => [action, kind])
    ).toEqual(
      expect.arrayContaining([
        ["delete", "arc-volume"],
        ["create", "arc-volume"]
      ])
    );
    expectOperationError(
      () => applyLongWorkspaceOperations(source, batch),
      "impact_mismatch"
    );
  });

  it("allows relation creation and pure field edits without danger approval", () => {
    const source = workspace();
    source.plot.arcs.push({
      id: "arc_second",
      volumeId: "volume_one",
      title: "第二剧情点",
      order: 2,
      outline: ""
    });
    const batch = {
      updatedAt: later,
      operations: [
        {
          type: "event.update" as const,
          id: "event_letter",
          patch: {
            title: "收到匿名来信",
            arcIds: ["arc_letter", "arc_second"]
          }
        }
      ],
      documentWrites: []
    };

    const preview = previewLongWorkspaceOperations(source, batch);
    expect(preview.relationshipChanges).toEqual([
      expect.objectContaining({ action: "create", kind: "story-event-arc" })
    ]);
    expect(
      applyLongWorkspaceOperations(source, batch).snapshot.plot.storyEvents[0]
    ).toMatchObject({
      title: "收到匿名来信",
      arcIds: ["arc_letter", "arc_second"]
    });

    const titleOnly = {
      updatedAt: later,
      operations: [
        {
          type: "event.update" as const,
          id: "event_letter",
          patch: { title: "只改标题" }
        }
      ],
      documentWrites: []
    };
    expect(
      previewLongWorkspaceOperations(source, titleOnly).relationshipChanges
    ).toEqual([]);
    expect(() => applyLongWorkspaceOperations(source, titleOnly)).not.toThrow();
  });
});
