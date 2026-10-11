import {
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  committedForeshadowingWorkspace,
  describe,
  expect,
  expectOperationError,
  file,
  it,
  later,
  longLedgerCommitFileId,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: deletion integrity", () => {
  it("rejects an approved impact when relationship details changed with the same ids", () => {
    const source = workspace();
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "arc.delete", id: "arc_letter" }]
    });
    const preview = previewLongWorkspaceOperations(source, batch);
    const changedSource = structuredClone(source);
    changedSource.plot.chapterCards[0]!.title = "已在确认后改名";
    const changedPreview = previewLongWorkspaceOperations(changedSource, batch);

    expect(changedPreview.impact).toEqual(preview.impact);
    expect(changedPreview.confirmation).not.toEqual(preview.confirmation);
    expectOperationError(
      () =>
        applyLongWorkspaceOperations(changedSource, {
          ...batch,
          expectedImpact: preview.confirmation
        }),
      "impact_mismatch"
    );
  });

  it("keeps a committed beat when deleting its placement and edits the record", () => {
    const source = committedForeshadowingWorkspace();
    source.ledger.projection = {
      throughCommitId: "commit_first",
      facts: [
        {
          factId: "fact_placement",
          domain: "plot",
          subjectId: "placement_letter",
          field: "disclosure",
          value: "hint",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章正文"
        }
      ],
      knowledge: [],
      openLoops: [],
      latestHandoff: null
    };
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "placement.delete", id: "placement_letter" }]
    });
    const preview = previewLongWorkspaceOperations(source, batch);

    expect(preview.ledgerRecordEdits).toEqual([
      expect.objectContaining({
        commitId: "commit_first",
        removePlacementIds: ["placement_letter"],
        removeForeshadowingBeatIds: []
      })
    ]);
    expect(
      preview.relationshipChanges.find(
        ({ kind, id }) => kind === "ledger-commit" && id === "commit_first"
      )
    ).toMatchObject({
      action: "update",
      before: expect.objectContaining({ placementIds: ["placement_letter"] }),
      after: expect.objectContaining({ placementIds: [] })
    });

    const result = applyLongWorkspaceOperations(source, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(result.snapshot.plot.narrativePlacements).toEqual([]);
    expect(result.snapshot.plot.foreshadowing[0]!.beats).toEqual([
      expect.objectContaining({
        id: "beat_letter",
        placementId: null,
        chapterCardId: "chapter_one",
        status: "committed",
        commitId: "commit_first"
      })
    ]);
    expect(result.snapshot.ledger.commits[0]).toMatchObject({
      placementIds: [],
      foreshadowingBeatIds: ["beat_letter"]
    });
    expect(result.snapshot.ledger.projection).toMatchObject({
      throughCommitId: "commit_first",
      facts: []
    });
  });

  it("keeps committed beats when deleting their event and owned placements", () => {
    const source = committedForeshadowingWorkspace();
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "event.delete", id: "event_letter" }]
    });
    const preview = previewLongWorkspaceOperations(source, batch);
    const result = applyLongWorkspaceOperations(source, {
      ...batch,
      expectedImpact: preview.confirmation
    });

    expect(result.snapshot.plot.storyEvents).toEqual([]);
    expect(result.snapshot.plot.narrativePlacements).toEqual([]);
    expect(result.snapshot.plot.foreshadowing[0]).toMatchObject({
      truthEventId: null,
      beats: [
        expect.objectContaining({
          id: "beat_letter",
          eventId: null,
          placementId: null,
          chapterCardId: "chapter_one",
          status: "committed",
          commitId: "commit_first"
        })
      ]
    });
    expect(result.snapshot.ledger.commits[0]).toMatchObject({
      placementIds: [],
      foreshadowingBeatIds: ["beat_letter"]
    });
  });

  it("removes a committed beat from its index and record without deleting its thread", () => {
    const source = committedForeshadowingWorkspace();
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "foreshadowingBeat.delete", id: "beat_letter" }]
    });
    const preview = previewLongWorkspaceOperations(source, batch);
    const result = applyLongWorkspaceOperations(source, {
      ...batch,
      expectedImpact: preview.confirmation
    });

    expect(result.snapshot.plot.foreshadowing).toEqual([
      expect.objectContaining({
        id: "foreshadow_letter",
        status: "planned",
        beats: []
      })
    ]);
    expect(result.snapshot.ledger.commits[0]!.foreshadowingBeatIds).toEqual([]);
    expect(result.ledgerRecordEdits).toEqual([
      expect.objectContaining({
        commitId: "commit_first",
        removePlacementIds: [],
        removeForeshadowingBeatIds: ["beat_letter"],
        reconcileForeshadowingThreadIds: ["foreshadow_letter"]
      })
    ]);
  });

  it("deletes one recorded chapter without clearing later projection state", () => {
    const source = committedForeshadowingWorkspace();
    source.chapters[1]!.commitId = "commit_second";
    source.ledger.committedThroughChapterId = "chapter_two";
    source.ledger.commits.push({
      id: "commit_second",
      mode: "structured",
      sequence: 2,
      chapterCardId: "chapter_two",
      committedAt: later,
      placementIds: [],
      foreshadowingBeatIds: [],
      recordFile: file(
        longLedgerCommitFileId("commit_second"),
        "long/ledger/commit-second.json",
        later
      )
    });
    source.ledger.projection = {
      throughCommitId: "commit_second",
      facts: [
        {
          factId: "fact_first",
          domain: "plot",
          subjectId: "chapter_one",
          field: "state",
          value: "第一章状态",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章正文"
        },
        {
          factId: "fact_second",
          domain: "plot",
          subjectId: "chapter_two",
          field: "state",
          value: "第二章状态",
          sourceCommitId: "commit_second",
          sourceChapterCardId: "chapter_two",
          evidence: "第二章正文"
        }
      ],
      knowledge: [],
      openLoops: [
        {
          loopId: "loop_second",
          kind: "plot",
          status: "open",
          detail: "第二章尚未解决的问题",
          subjectId: "chapter_two",
          factId: "fact_second",
          sourceCommitId: "commit_second",
          sourceChapterCardId: "chapter_two",
          evidence: "第二章正文"
        }
      ],
      latestHandoff: {
        chapterCardId: "chapter_two",
        commitId: "commit_second",
        summary: "继续第二章之后的情节",
        mustCarry: [],
        nextChapterConstraints: [],
        openLoops: ["loop_second"]
      }
    };
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "chapter.delete", id: "chapter_one" }]
    });
    const preview = previewLongWorkspaceOperations(parsed, batch);
    expect(
      preview.relationshipChanges.find(
        ({ kind }) => kind === "continuity-projection"
      )
    ).toMatchObject({
      action: "update",
      before: expect.objectContaining({
        facts: expect.arrayContaining([
          expect.objectContaining({ factId: "fact_first" }),
          expect.objectContaining({ factId: "fact_second" })
        ])
      }),
      after: expect.objectContaining({
        facts: [expect.objectContaining({ factId: "fact_second" })]
      })
    });

    const result = applyLongWorkspaceOperations(parsed, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(result.snapshot.ledger.commits.map(({ id }) => id)).toEqual([
      "commit_second"
    ]);
    expect(result.snapshot.ledger.projection).toMatchObject({
      throughCommitId: "commit_second",
      facts: [expect.objectContaining({ factId: "fact_second" })],
      openLoops: [expect.objectContaining({ loopId: "loop_second" })],
      latestHandoff: expect.objectContaining({ commitId: "commit_second" })
    });
    expect(
      result.snapshot.plot.foreshadowing[0]!.beats.find(
        ({ id }) => id === "beat_letter"
      )
    ).toMatchObject({
      status: "planned",
      commitId: null,
      chapterCardId: null
    });
    expect(result.ledgerRecordEdits).toEqual([
      expect.objectContaining({
        commitId: "commit_second",
        removeFactIds: ["fact_first"],
        removeFactKeys: [
          {
            domain: "plot",
            subjectId: "chapter_one",
            field: "state"
          }
        ]
      })
    ]);
  });

  it("replaces the latest handoff deterministically when deleting its commit", () => {
    const source = committedForeshadowingWorkspace();
    source.chapters[1]!.commitId = "commit_second";
    source.ledger.committedThroughChapterId = "chapter_two";
    source.ledger.commits.push({
      id: "commit_second",
      mode: "structured",
      sequence: 2,
      chapterCardId: "chapter_two",
      committedAt: later,
      placementIds: [],
      foreshadowingBeatIds: [],
      recordFile: file(
        longLedgerCommitFileId("commit_second"),
        "long/ledger/commit-second.json",
        later
      )
    });
    source.ledger.projection = {
      throughCommitId: "commit_second",
      facts: [
        {
          factId: "fact_first",
          domain: "plot",
          subjectId: "event_letter",
          field: "origin",
          value: "来信来源未知",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章正文"
        },
        {
          factId: "fact_second",
          domain: "plot",
          subjectId: "chapter_two",
          field: "state",
          value: "第二章状态",
          sourceCommitId: "commit_second",
          sourceChapterCardId: "chapter_two",
          evidence: "第二章正文"
        }
      ],
      knowledge: [],
      openLoops: [
        {
          loopId: "loop_first",
          kind: "plot",
          status: "open",
          detail: "追查来信来源",
          subjectId: "event_letter",
          factId: "fact_first",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章结尾"
        },
        {
          loopId: "loop_second",
          kind: "plot",
          status: "open",
          detail: "第二章遗留问题",
          subjectId: "chapter_two",
          factId: "fact_second",
          sourceCommitId: "commit_second",
          sourceChapterCardId: "chapter_two",
          evidence: "第二章结尾"
        }
      ],
      latestHandoff: {
        summary: "继续第二章之后的情节",
        mustCarry: ["保留来信"],
        nextChapterConstraints: [],
        openLoops: ["loop_first", "loop_second"],
        chapterCardId: "chapter_two",
        commitId: "commit_second"
      }
    };
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "chapter.delete", id: "chapter_two" }]
    });
    const preview = previewLongWorkspaceOperations(parsed, batch);

    expect(preview.ledgerRecordEdits).toEqual([
      expect.objectContaining({
        commitId: "commit_first",
        removeFactIds: ["fact_second"],
        removeFactKeys: [
          {
            domain: "plot",
            subjectId: "chapter_two",
            field: "state"
          }
        ],
        removeOpenLoopIds: ["loop_second"],
        replaceHandoff: {
          summary: "最近一次连续性归档已删除，请依据当前剩余记录继续创作。",
          mustCarry: [],
          nextChapterConstraints: [],
          openLoops: ["loop_first"]
        }
      })
    ]);
    expect(preview.confirmation.ledgerRecordEdits).toEqual(
      preview.ledgerRecordEdits
    );

    const result = applyLongWorkspaceOperations(parsed, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(result.snapshot.ledger.projection).toEqual({
      throughCommitId: "commit_first",
      facts: [expect.objectContaining({ factId: "fact_first" })],
      knowledge: [],
      openLoops: [expect.objectContaining({ loopId: "loop_first" })],
      latestHandoff: {
        summary: "最近一次连续性归档已删除，请依据当前剩余记录继续创作。",
        mustCarry: [],
        nextChapterConstraints: [],
        openLoops: ["loop_first"],
        chapterCardId: "chapter_one",
        commitId: "commit_first"
      }
    });
  });

  it("retains beats while deleting their planning volume and arc", () => {
    const source = workspace();
    source.plot.volumes.push({
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: ""
    });
    source.plot.foreshadowing.push({
      id: "foreshadow_volume_anchor",
      title: "卷锚点",
      coreQuestion: "锚点删除后是否保留？",
      truthEventId: null,
      expectedReaderEffect: "",
      status: "planned",
      beats: [
        {
          id: "beat_volume_anchor",
          type: "source",
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
        }
      ]
    });
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "volume.delete", id: "volume_one" }]
    });
    const preview = previewLongWorkspaceOperations(parsed, batch);
    const result = applyLongWorkspaceOperations(parsed, {
      ...batch,
      expectedImpact: preview.confirmation
    });

    expect(result.snapshot.plot.volumes.map(({ id }) => id)).toEqual([
      "volume_two"
    ]);
    expect(result.snapshot.plot.foreshadowing[0]!.beats).toEqual([
      expect.objectContaining({
        id: "beat_volume_anchor",
        volumeId: null,
        arcId: null,
        eventId: "event_letter"
      })
    ]);
  });
});
