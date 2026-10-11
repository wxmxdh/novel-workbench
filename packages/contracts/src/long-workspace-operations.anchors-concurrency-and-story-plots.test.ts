import type { LongWorkspaceIndexSnapshot } from "./long-workspace-operations.test-support";
import {
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  applyPreviewedLongWorkspaceOperations,
  committedForeshadowingWorkspace,
  committedWorkspace,
  describe,
  expect,
  file,
  it,
  later,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: anchors-concurrency-and-story-plots", () => {
  it("keeps typed foreshadowing anchors aligned when their plot context moves", () => {
    const secondVolume = {
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    } as const;
    const secondArc = {
      id: "arc_two",
      volumeId: "volume_two",
      title: "第二卷主线",
      order: 1,
      outline: ""
    } as const;
    const planningThread = (
      beat: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"][number]["beats"][number]
    ): LongWorkspaceIndexSnapshot["plot"]["foreshadowing"][number] => ({
      id: "foreshadow_moving",
      title: "移动中的线索",
      coreQuestion: "线索最终落在哪里？",
      truthEventId: null,
      expectedReaderEffect: "位置变化后仍保持同一条伏笔线。",
      status: "planned",
      beats: [beat]
    });

    const arcSource = workspace();
    arcSource.plot.volumes.push(secondVolume);
    arcSource.plot.arcs.push({
      id: "arc_stays_in_volume_one",
      volumeId: "volume_one",
      title: "仍在第一卷的支线",
      order: 2,
      outline: ""
    });
    arcSource.plot.storyEvents[0]!.arcIds.push("arc_stays_in_volume_one");
    arcSource.plot.chapterCards[0]!.primaryArcId = "arc_stays_in_volume_one";
    arcSource.plot.storyEvents.push({
      id: "event_follows_moved_arc",
      title: "跟随主线移动的事件",
      summary: "",
      timeMode: "sequence",
      timeLabel: "",
      storyOrder: 2,
      location: "",
      arcIds: ["arc_letter"],
      characterIds: []
    });
    const arcThread = planningThread({
      id: "beat_follows_arc",
      type: "plant",
      order: 1,
      volumeId: "volume_one",
      arcId: null,
      eventId: null,
      placementId: null,
      chapterCardId: "chapter_two",
      plannedScope: "",
      note: "",
      status: "planned",
      commitId: null
    });
    arcThread.beats.push(
      {
        id: "beat_follows_event",
        type: "reinforce",
        order: 2,
        volumeId: "volume_one",
        arcId: null,
        eventId: "event_follows_moved_arc",
        placementId: null,
        chapterCardId: null,
        plannedScope: "",
        note: "",
        status: "planned",
        commitId: null
      },
      {
        id: "beat_stays_with_multiarc_event",
        type: "misdirect",
        order: 3,
        volumeId: "volume_one",
        arcId: null,
        eventId: "event_letter",
        placementId: null,
        chapterCardId: null,
        plannedScope: "",
        note: "",
        status: "planned",
        commitId: null
      },
      {
        id: "beat_clears_conflicting_event_volume",
        type: "partial_reveal",
        order: 4,
        volumeId: "volume_one",
        arcId: null,
        eventId: "event_follows_moved_arc",
        placementId: null,
        chapterCardId: "chapter_one",
        plannedScope: "",
        note: "",
        status: "planned",
        commitId: null
      }
    );
    arcSource.plot.foreshadowing.push(arcThread);
    const movedArc = applyPreviewedLongWorkspaceOperations(arcSource, {
      updatedAt: later,
      operations: [
        {
          type: "arc.move",
          id: "arc_letter",
          toVolumeId: "volume_two"
        }
      ]
    });
    expect(movedArc.snapshot.plot.chapterCards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "chapter_one",
          volumeId: "volume_one",
          primaryArcId: "arc_stays_in_volume_one"
        }),
        expect.objectContaining({
          id: "chapter_two",
          volumeId: "volume_one",
          primaryArcId: null
        })
      ])
    );
    expect(movedArc.snapshot.chapters).toHaveLength(2);
    expect(movedArc.snapshot.plot.foreshadowing[0]!.beats[0]).toMatchObject({
      volumeId: "volume_one",
      arcId: null
    });
    expect(movedArc.snapshot.plot.foreshadowing[0]!.beats[1]).toMatchObject({
      volumeId: "volume_two",
      eventId: "event_follows_moved_arc"
    });
    expect(movedArc.snapshot.plot.foreshadowing[0]!.beats[2]).toMatchObject({
      volumeId: "volume_one",
      eventId: "event_letter"
    });
    expect(movedArc.snapshot.plot.foreshadowing[0]!.beats[3]).toMatchObject({
      volumeId: null,
      eventId: "event_follows_moved_arc",
      chapterCardId: "chapter_one"
    });

    const chapterSource = workspace();
    chapterSource.plot.volumes.push(secondVolume);
    chapterSource.plot.arcs.push(secondArc);
    const chapterThread = planningThread({
      id: "beat_follows_chapter",
      type: "reinforce",
      order: 1,
      volumeId: "volume_one",
      arcId: "arc_letter",
      eventId: null,
      placementId: null,
      chapterCardId: "chapter_two",
      plannedScope: "",
      note: "",
      status: "planned",
      commitId: null
    });
    chapterThread.beats.push({
      id: "beat_clears_incompatible_event_anchors",
      type: "misdirect",
      order: 2,
      volumeId: "volume_one",
      arcId: "arc_letter",
      eventId: "event_letter",
      placementId: null,
      chapterCardId: "chapter_two",
      plannedScope: "",
      note: "",
      status: "planned",
      commitId: null
    });
    chapterSource.plot.foreshadowing.push(chapterThread);
    const movedChapter = applyPreviewedLongWorkspaceOperations(chapterSource, {
      updatedAt: later,
      operations: [
        {
          type: "chapter.move",
          id: "chapter_two",
          toVolumeId: "volume_two",
          toPrimaryArcId: "arc_two"
        }
      ]
    });
    expect(movedChapter.snapshot.plot.foreshadowing[0]!.beats[0]).toMatchObject(
      {
        volumeId: "volume_two",
        arcId: "arc_two",
        chapterCardId: "chapter_two"
      }
    );
    expect(movedChapter.snapshot.plot.foreshadowing[0]!.beats[1]).toMatchObject(
      {
        volumeId: null,
        arcId: null,
        eventId: "event_letter",
        chapterCardId: "chapter_two"
      }
    );

    const placementSource = workspace();
    placementSource.plot.volumes.push(secondVolume);
    placementSource.plot.arcs.push(secondArc);
    const targetChapter = placementSource.plot.chapterCards.find(
      ({ id }) => id === "chapter_two"
    )!;
    targetChapter.volumeId = "volume_two";
    targetChapter.primaryArcId = "arc_two";
    targetChapter.narrativeOrder = 1;
    placementSource.plot.narrativePlacements.push({
      id: "placement_moving",
      eventId: "event_letter",
      chapterCardId: "chapter_one",
      orderInChapter: 1,
      mode: "clue",
      disclosure: "hint",
      writingPrompt: "",
      status: "planned",
      commitId: null
    });
    placementSource.plot.foreshadowing.push(
      planningThread({
        id: "beat_follows_placement",
        type: "misdirect",
        order: 1,
        volumeId: "volume_one",
        arcId: "arc_letter",
        eventId: null,
        placementId: "placement_moving",
        chapterCardId: "chapter_one",
        plannedScope: "",
        note: "",
        status: "planned",
        commitId: null
      })
    );
    const movedPlacement = applyPreviewedLongWorkspaceOperations(
      placementSource,
      {
        updatedAt: later,
        operations: [
          {
            type: "placement.move",
            id: "placement_moving",
            toChapterCardId: "chapter_two"
          }
        ]
      }
    );
    expect(
      movedPlacement.snapshot.plot.foreshadowing[0]!.beats[0]
    ).toMatchObject({
      volumeId: "volume_two",
      arcId: "arc_two",
      chapterCardId: "chapter_two",
      placementId: "placement_moving"
    });
  });

  it("reconciles event-only volume anchors when an event arc is deleted", () => {
    const source = workspace();
    source.plot.arcs.push({
      id: "arc_same_volume",
      volumeId: "volume_one",
      title: "同卷保留线",
      order: 2,
      outline: ""
    });
    source.plot.storyEvents[0]!.arcIds.push("arc_same_volume");
    source.plot.storyEvents.push({
      id: "event_loses_only_arc",
      title: "失去唯一剧情点的事件",
      summary: "",
      timeMode: "sequence",
      timeLabel: "",
      storyOrder: 2,
      location: "",
      arcIds: ["arc_letter"],
      characterIds: []
    });
    source.plot.foreshadowing.push({
      id: "foreshadow_arc_delete",
      title: "删除剧情点后的触点",
      coreQuestion: "事件触点如何保留？",
      truthEventId: null,
      expectedReaderEffect: "",
      status: "planned",
      beats: [
        {
          id: "beat_clears_orphaned_volume",
          type: "plant",
          order: 1,
          volumeId: "volume_one",
          arcId: null,
          eventId: "event_loses_only_arc",
          placementId: null,
          chapterCardId: null,
          plannedScope: "",
          note: "",
          status: "planned",
          commitId: null
        },
        {
          id: "beat_keeps_same_volume",
          type: "reinforce",
          order: 2,
          volumeId: "volume_one",
          arcId: null,
          eventId: "event_letter",
          placementId: null,
          chapterCardId: null,
          plannedScope: "",
          note: "",
          status: "planned",
          commitId: null
        }
      ]
    });
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [
        {
          type: "arc.delete",
          id: "arc_letter"
        }
      ]
    });
    const preview = previewLongWorkspaceOperations(source, batch);
    const result = applyPreviewedLongWorkspaceOperations(source, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    const beats = result.snapshot.plot.foreshadowing[0]!.beats;
    expect(
      beats.find(({ id }) => id === "beat_clears_orphaned_volume")
    ).toMatchObject({
      volumeId: null,
      eventId: "event_loses_only_arc"
    });
    expect(
      beats.find(({ id }) => id === "beat_keeps_same_volume")
    ).toMatchObject({
      volumeId: "volume_one",
      eventId: "event_letter"
    });
  });

  it("retargets typed foreshadowing anchors when an event changes plot points", () => {
    const source = workspace();
    source.plot.volumes.push({
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    });
    source.plot.arcs.push({
      id: "arc_two",
      volumeId: "volume_two",
      title: "第二卷主线",
      order: 1,
      outline: ""
    });
    source.plot.foreshadowing.push({
      id: "foreshadow_event_move",
      title: "事件改绑后的触点",
      coreQuestion: "事件改变剧情点后如何投影？",
      truthEventId: null,
      expectedReaderEffect: "",
      status: "planned",
      beats: [
        {
          id: "beat_follows_event_rebind",
          type: "plant",
          order: 1,
          volumeId: "volume_one",
          arcId: "arc_letter",
          eventId: "event_letter",
          placementId: null,
          chapterCardId: null,
          plannedScope: "",
          note: "",
          status: "planned",
          commitId: null
        },
        {
          id: "beat_keeps_concrete_chapter",
          type: "reinforce",
          order: 2,
          volumeId: "volume_one",
          arcId: "arc_letter",
          eventId: "event_letter",
          placementId: null,
          chapterCardId: "chapter_one",
          plannedScope: "",
          note: "",
          status: "planned",
          commitId: null
        }
      ]
    });
    const result = applyPreviewedLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "event.update",
          id: "event_letter",
          patch: { arcIds: ["arc_two"] }
        }
      ]
    });
    expect(result.snapshot.plot.foreshadowing[0]!.beats[0]).toMatchObject({
      volumeId: "volume_two",
      arcId: "arc_two",
      eventId: "event_letter"
    });
    expect(result.snapshot.plot.foreshadowing[0]!.beats[1]).toMatchObject({
      volumeId: null,
      arcId: null,
      eventId: "event_letter",
      chapterCardId: "chapter_one"
    });
  });

  it("allows recorded foreshadowing facts to be edited", () => {
    const source = committedForeshadowingWorkspace();
    const result = applyLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "foreshadowing.update",
          id: "foreshadow_letter",
          patch: {
            hiddenTruth: "寄信人身份仍可重新设计。",
            plannedSpan: "cross_volume"
          }
        },
        {
          type: "foreshadowingBeat.update",
          id: "beat_letter",
          patch: { note: "记录后仍可调整触点说明。" }
        }
      ]
    });
    expect(result.snapshot.plot.foreshadowing[0]).toMatchObject({
      hiddenTruth: "寄信人身份仍可重新设计。",
      plannedSpan: "cross_volume"
    });
    expect(result.snapshot.plot.foreshadowing[0]!.beats[0]!.note).toBe(
      "记录后仍可调整触点说明。"
    );
  });

  it("normalizes every order-changing operation to a contiguous sequence", () => {
    const source = workspace();
    const result = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          {
            type: "chapter.reorder",
            volumeId: "volume_one",
            orderedIds: ["chapter_two", "chapter_one"]
          },
          {
            type: "event.create",
            event: {
              id: "event_second",
              title: "第二事件",
              summary: "",
              timeMode: "sequence",
              timeLabel: "",
              storyOrder: 99,
              location: "",
              arcIds: ["arc_letter"],
              characterIds: []
            }
          },
          {
            type: "event.reorder",
            orderedIds: ["event_second", "event_letter"]
          }
        ]
      })
    );

    expect(
      result.snapshot.plot.chapterCards.map(({ id, narrativeOrder }) => [
        id,
        narrativeOrder
      ])
    ).toEqual([
      ["chapter_two", 1],
      ["chapter_one", 2]
    ]);
    expect(
      result.snapshot.plot.storyEvents.map(({ id, storyOrder }) => [
        id,
        storyOrder
      ])
    ).toEqual([
      ["event_second", 1],
      ["event_letter", 2]
    ]);
  });

  it("applies document writes directly without version guards", () => {
    const source = workspace();
    const result = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          {
            type: "volume.update",
            id: "volume_one",
            patch: { title: "新标题" }
          }
        ],
        documentWrites: [
          {
            proposalId: "proposal_book_line",
            fileId: LONG_BOOK_LINE_FILE_ID,
            mode: "replace",
            updatedAt: later,
            content: "新全书线",
            reason: "更新全书线"
          }
        ]
      })
    );
    expect(result.snapshot.plot.volumes[0]?.title).toBe("新标题");
    expect(result.snapshot.bookLine.updatedAt).toBe(later);
  });

  it("keeps maintained character design files editable after continuity records", () => {
    const source = committedWorkspace();
    const files = source.characterFiles[0]!;
    const batchFor = (fileId: string) => ({
      updatedAt: later,
      operations: [
        {
          type: "character.update" as const,
          id: "character_alice",
          patch: { aliases: ["阿岚"] }
        }
      ],
      documentWrites: [
        {
          proposalId: `proposal_${fileId.replace(/[^A-Za-z0-9._:-]/gu, "_")}`,
          fileId,
          mode: "replace" as const,
          updatedAt: later,
          content: "账本启动后的直接修改",
          reason: "验证连续性资料写锁"
        }
      ]
    });

    for (const fileId of [files.relationships.id]) {
      expect(
        applyLongWorkspaceOperations(source, batchFor(fileId)).documentWrites[0]
          ?.fileId
      ).toBe(fileId);
    }

    expect(
      applyLongWorkspaceOperations(source, batchFor(files.coreProfile.id))
        .documentWrites[0]?.fileId
    ).toBe(files.coreProfile.id);
  });

  it("does not let a continuation-import checkpoint take ownership of character design files", () => {
    const source = committedWorkspace();
    source.ledger.commits[0]!.mode = "import_checkpoint";
    const relationships = source.characterFiles[0]!.relationships;
    const result = applyLongWorkspaceOperations(source, {
      updatedAt: later,
      operations: [
        {
          type: "character.update",
          id: "character_alice",
          patch: { aliases: ["阿岚"] }
        }
      ],
      documentWrites: [
        {
          proposalId: "proposal_import_checkpoint_relationships",
          fileId: relationships.id,
          mode: "replace",
          updatedAt: later,
          content: "导入后补录的人物关系",
          reason: "导入检查点不接管人物设计"
        }
      ]
    });
    expect(result.documentWrites[0]?.fileId).toBe(relationships.id);
  });

  it("creates, updates, reorders, and deletes story plots bound to an arc", () => {
    const source = workspace();
    const created = applyLongWorkspaceOperations(
      source,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          {
            type: "storyPlot.create",
            storyPlot: {
              id: "storyplot_daily",
              arcId: "arc_letter",
              title: "日常崩塌",
              order: 1,
              file: file(
                "file_storyplot_daily:body",
                "long/story-plots/storyplot_daily/body.md",
                later
              )
            }
          },
          {
            type: "storyPlot.create",
            storyPlot: {
              id: "storyplot_ripple",
              arcId: "arc_letter",
              title: "不可逆的涟漪",
              order: 2,
              file: file(
                "file_storyplot_ripple:body",
                "long/story-plots/storyplot_ripple/body.md",
                later
              )
            }
          }
        ]
      })
    );
    expect(created.snapshot.plot.storyPlots.map(({ id }) => id)).toEqual([
      "storyplot_daily",
      "storyplot_ripple"
    ]);
    expect(created.fileIntents.map(({ file: entry }) => entry.id)).toEqual([
      "file_storyplot_daily:body",
      "file_storyplot_ripple:body"
    ]);

    const reordered = applyLongWorkspaceOperations(
      created.snapshot,
      LongWorkspaceOperationBatchSchema.parse({
        updatedAt: later,
        operations: [
          {
            type: "storyPlot.reorder",
            arcId: "arc_letter",
            orderedIds: ["storyplot_ripple", "storyplot_daily"]
          },
          {
            type: "storyPlot.update",
            id: "storyplot_ripple",
            patch: { title: "涟漪扩散" }
          }
        ]
      })
    );
    expect(
      [...reordered.snapshot.plot.storyPlots]
        .sort((left, right) => left.order - right.order)
        .map(({ id, title, order }) => ({
          id,
          title,
          order
        }))
    ).toEqual([
      { id: "storyplot_ripple", title: "涟漪扩散", order: 1 },
      { id: "storyplot_daily", title: "日常崩塌", order: 2 }
    ]);

    const deleteBatch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [
        {
          type: "storyPlot.delete",
          id: "storyplot_daily"
        }
      ]
    });
    const deletePreview = previewLongWorkspaceOperations(
      reordered.snapshot,
      deleteBatch
    );
    const deleted = applyLongWorkspaceOperations(reordered.snapshot, {
      ...deleteBatch,
      expectedImpact: deletePreview.confirmation
    });
    expect(deleted.snapshot.plot.storyPlots.map(({ id }) => id)).toEqual([
      "storyplot_ripple"
    ]);
    expect(
      deleted.fileIntents.map(({ action, file: entry }) => [action, entry.id])
    ).toEqual([["delete", "file_storyplot_daily:body"]]);
  });
});
