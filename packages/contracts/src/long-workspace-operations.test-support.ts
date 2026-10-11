import { describe, expect, it } from "vitest";
import {
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationBatchSchema,
  LongWorkspaceOperationError,
  applyLongWorkspaceOperations,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterWorldRevealsFileId,
  longChapterHandoffFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
  longWorldbuildingFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  previewLongWorkspaceOperations
} from "./index";
import type {
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperation,
  LongWorkspaceOperationErrorCode
} from "./index";

const now = "2026-07-26T12:00:00.000Z";
const later = "2026-07-26T12:05:00.000Z";

function file(id: string, path: string, updatedAt = now) {
  return { id, path, updatedAt };
}

function characterFiles(characterId: string, slug: string) {
  return {
    characterId,
    coreProfile: file(
      longCharacterCoreProfileFileId(characterId),
      `long/characters/${slug}/core-profile.md`
    ),
    relationships: file(
      longCharacterRelationshipsFileId(characterId),
      `long/characters/${slug}/relationships.md`
    ),
    currentState: file(
      longCharacterCurrentStateFileId(characterId),
      `long/characters/${slug}/current-state.md`
    ),
    history: file(
      longCharacterHistoryFileId(characterId),
      `long/characters/${slug}/history.md`
    )
  };
}

function chapterFiles(chapterCardId: string, slug: string) {
  return {
    chapterCardId,
    body: file(
      longChapterBodyFileId(chapterCardId),
      `long/chapters/${slug}/body.md`
    ),
    card: file(
      longChapterCardFileId(chapterCardId),
      `long/chapters/${slug}/card.md`
    ),
    characterState: file(
      longChapterCharacterStateFileId(chapterCardId),
      `long/chapters/${slug}/character-state.md`
    ),
    handoff: file(
      longChapterHandoffFileId(chapterCardId),
      `long/chapters/${slug}/handoff.md`
    ),
    commitId: null
  };
}

function workspace(): LongWorkspaceIndexSnapshot {
  return LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId: "longbook_operations",
    updatedAt: now,
    bookLine: file(LONG_BOOK_LINE_FILE_ID, "long/plot/book-line.md"),
    worldbuilding: [],
    characters: [
      {
        id: "character_alice",
        name: "林岚",
        group: "protagonist",
        order: 1,
        aliases: []
      }
    ],
    characterFiles: [characterFiles("character_alice", "alice")],
    plot: {
      volumes: [
        {
          id: "volume_one",
          title: "第一卷",
          order: 1,
          summary: ""
        }
      ],
      arcs: [
        {
          id: "arc_letter",
          volumeId: "volume_one",
          title: "来信之谜",
          order: 1,
          outline: ""
        }
      ],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          primaryArcId: "arc_letter",
          title: "雨夜来信",
          narrativeOrder: 1
        },
        {
          id: "chapter_two",
          volumeId: "volume_one",
          primaryArcId: "arc_letter",
          title: "旧钟楼",
          narrativeOrder: 2
        }
      ],
      storyEvents: [
        {
          id: "event_letter",
          title: "收到来信",
          summary: "",
          timeMode: "sequence",
          timeLabel: "第一天",
          storyOrder: 1,
          location: "林岚家",
          arcIds: ["arc_letter"],
          characterIds: ["character_alice"]
        }
      ],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [
      chapterFiles("chapter_one", "one"),
      chapterFiles("chapter_two", "two")
    ],
    ledger: {
      committedThroughChapterId: null,
      commits: []
    }
  });
}

function committedWorkspace(): LongWorkspaceIndexSnapshot {
  const value = workspace();
  value.chapters[0]!.commitId = "commit_first";
  value.ledger.committedThroughChapterId = "chapter_one";
  value.ledger.commits.push({
    id: "commit_first",
    mode: "structured",
    sequence: 1,
    chapterCardId: "chapter_one",
    committedAt: now,
    placementIds: [],
    foreshadowingBeatIds: [],
    recordFile: file(
      longLedgerCommitFileId("commit_first"),
      "long/ledger/commit-first.json"
    )
  });
  return LongWorkspaceIndexSnapshotSchema.parse(value);
}

function committedForeshadowingWorkspace(): LongWorkspaceIndexSnapshot {
  const value = committedWorkspace();
  value.plot.narrativePlacements.push({
    id: "placement_letter",
    eventId: "event_letter",
    chapterCardId: "chapter_one",
    orderInChapter: 1,
    mode: "scene",
    disclosure: "hint",
    writingPrompt: "",
    status: "committed",
    commitId: "commit_first"
  });
  value.plot.foreshadowing.push({
    id: "foreshadow_letter",
    title: "寄信人身份",
    coreQuestion: "谁寄出了来信？",
    truthEventId: "event_letter",
    expectedReaderEffect: "持续怀疑寄信人。",
    status: "open",
    beats: [
      {
        id: "beat_letter",
        type: "plant",
        order: 1,
        eventId: "event_letter",
        placementId: "placement_letter",
        chapterCardId: "chapter_one",
        plannedScope: "",
        note: "信封留下第一条线索。",
        status: "committed",
        commitId: "commit_first"
      }
    ]
  });
  value.ledger.commits[0]!.placementIds = ["placement_letter"];
  value.ledger.commits[0]!.foreshadowingBeatIds = ["beat_letter"];
  return LongWorkspaceIndexSnapshotSchema.parse(value);
}

function committedAnchorWorkspace(): LongWorkspaceIndexSnapshot {
  const value = committedForeshadowingWorkspace();
  value.plot.volumes[0]!.order = 2;
  value.plot.volumes.unshift({
    id: "volume_setup",
    title: "序卷",
    order: 1,
    summary: ""
  });
  value.plot.volumes.push(
    { id: "volume_tail_a", title: "尾卷甲", order: 3, summary: "" },
    { id: "volume_tail_b", title: "尾卷乙", order: 4, summary: "" }
  );

  value.plot.arcs[0]!.order = 2;
  value.plot.arcs.unshift(
    {
      id: "arc_movable",
      volumeId: "volume_setup",
      title: "可移动弧",
      order: 1,
      outline: ""
    },
    {
      id: "arc_setup",
      volumeId: "volume_one",
      title: "前置弧",
      order: 1,
      outline: ""
    }
  );
  value.plot.arcs.push(
    {
      id: "arc_tail_a",
      volumeId: "volume_one",
      title: "尾弧甲",
      order: 3,
      outline: ""
    },
    {
      id: "arc_tail_b",
      volumeId: "volume_one",
      title: "尾弧乙",
      order: 4,
      outline: ""
    }
  );

  value.plot.storyEvents[0]!.storyOrder = 2;
  value.plot.storyEvents.unshift({
    id: "event_setup",
    title: "前置事件",
    summary: "",
    timeMode: "sequence",
    timeLabel: "",
    storyOrder: 1,
    location: "",
    arcIds: ["arc_setup"],
    characterIds: []
  });
  value.plot.storyEvents.push(
    {
      id: "event_committed_second",
      title: "已提交的第二事件",
      summary: "",
      timeMode: "sequence",
      timeLabel: "",
      storyOrder: 3,
      location: "",
      arcIds: ["arc_letter"],
      characterIds: ["character_alice"]
    },
    {
      id: "event_tail_a",
      title: "尾部事件甲",
      summary: "",
      timeMode: "sequence",
      timeLabel: "",
      storyOrder: 4,
      location: "",
      arcIds: ["arc_tail_a"],
      characterIds: []
    },
    {
      id: "event_tail_b",
      title: "尾部事件乙",
      summary: "",
      timeMode: "sequence",
      timeLabel: "",
      storyOrder: 5,
      location: "",
      arcIds: ["arc_tail_b"],
      characterIds: []
    }
  );

  const committedThread = value.plot.foreshadowing[0]!;
  committedThread.status = "progressing";
  committedThread.beats[0]!.order = 2;
  committedThread.beats.unshift({
    id: "beat_setup",
    type: "source",
    order: 1,
    eventId: "event_setup",
    placementId: null,
    chapterCardId: "chapter_two",
    plannedScope: "",
    note: "尚未提交的前置规划。",
    status: "planned",
    commitId: null
  });
  committedThread.beats.push(
    {
      id: "beat_committed_second",
      type: "reinforce",
      order: 3,
      eventId: "event_committed_second",
      placementId: null,
      chapterCardId: "chapter_one",
      plannedScope: "",
      note: "已提交的强化节拍。",
      status: "committed",
      commitId: "commit_first"
    },
    {
      id: "beat_tail_a",
      type: "reveal",
      order: 4,
      eventId: "event_tail_a",
      placementId: null,
      chapterCardId: "chapter_two",
      plannedScope: "",
      note: "尾部规划甲。",
      status: "planned",
      commitId: null
    },
    {
      id: "beat_tail_b",
      type: "payoff",
      order: 5,
      eventId: "event_tail_b",
      placementId: null,
      chapterCardId: "chapter_two",
      plannedScope: "",
      note: "尾部规划乙。",
      status: "planned",
      commitId: null
    }
  );
  value.plot.foreshadowing.unshift({
    id: "foreshadow_setup",
    title: "前置伏笔线",
    coreQuestion: "",
    truthEventId: null,
    expectedReaderEffect: "",
    status: "planned",
    beats: [
      {
        id: "beat_movable",
        type: "source",
        order: 1,
        eventId: "event_setup",
        placementId: null,
        chapterCardId: "chapter_two",
        plannedScope: "",
        note: "可移动节拍。",
        status: "planned",
        commitId: null
      }
    ]
  });
  value.plot.foreshadowing.push(
    {
      id: "foreshadow_tail_a",
      title: "尾部伏笔线甲",
      coreQuestion: "",
      truthEventId: null,
      expectedReaderEffect: "",
      status: "planned",
      beats: []
    },
    {
      id: "foreshadow_tail_b",
      title: "尾部伏笔线乙",
      coreQuestion: "",
      truthEventId: null,
      expectedReaderEffect: "",
      status: "planned",
      beats: []
    }
  );
  value.ledger.commits[0]!.foreshadowingBeatIds.push("beat_committed_second");
  return LongWorkspaceIndexSnapshotSchema.parse(value);
}

function expectOperationError(
  run: () => unknown,
  code: LongWorkspaceOperationErrorCode
): void {
  try {
    run();
    throw new Error("Expected a long workspace operation error.");
  } catch (error) {
    expect(error).toBeInstanceOf(LongWorkspaceOperationError);
    expect((error as LongWorkspaceOperationError).code).toBe(code);
  }
}

function applyPreviewedLongWorkspaceOperations(
  snapshot: LongWorkspaceIndexSnapshot,
  batchInput: Parameters<typeof previewLongWorkspaceOperations>[1]
): ReturnType<typeof applyLongWorkspaceOperations> {
  const batch = LongWorkspaceOperationBatchSchema.parse(batchInput);
  const preview = previewLongWorkspaceOperations(snapshot, batch);
  return applyLongWorkspaceOperations(snapshot, {
    ...batch,
    expectedImpact: preview.confirmation
  });
}

function createBatch() {
  const newWorldFile = file(
    longWorldbuildingFileId("world_magic"),
    "long/worldbuilding/magic.md",
    later
  );
  const newCharacterFiles = characterFiles("character_bob", "bob");
  Object.values(newCharacterFiles)
    .filter(
      (value): value is ReturnType<typeof file> => typeof value === "object"
    )
    .forEach((value) => {
      value.updatedAt = later;
    });
  const newChapterFiles = chapterFiles("chapter_three", "three");
  [
    newChapterFiles.body,
    newChapterFiles.card,
    newChapterFiles.characterState,
    newChapterFiles.handoff
  ].forEach((value) => {
    value.updatedAt = later;
  });

  return LongWorkspaceOperationBatchSchema.parse({
    updatedAt: later,
    operations: [
      {
        type: "worldbuilding.create",
        provisionalId: "provisional_world",
        category: {
          id: "world_magic",
          title: "魔法规则",
          order: 99,
          format: "text",
          contentAuthority: "markdown",
          file: newWorldFile
        }
      },
      {
        type: "character.create",
        provisionalId: "provisional_character",
        character: {
          id: "character_bob",
          name: "周野",
          group: "major_supporting",
          order: 99,
          aliases: []
        },
        files: newCharacterFiles
      },
      {
        type: "volume.create",
        provisionalId: "provisional_volume",
        volume: {
          id: "volume_two",
          title: "第二卷",
          order: 99,
          summary: ""
        }
      },
      {
        type: "arc.create",
        arc: {
          id: "arc_tower",
          volumeId: "volume_two",
          title: "钟楼之谜",
          order: 99,
          outline: ""
        }
      },
      {
        type: "chapter.create",
        provisionalId: "provisional_chapter",
        chapterCard: {
          id: "chapter_three",
          volumeId: "volume_two",
          primaryArcId: "arc_tower",
          title: "钟声",
          narrativeOrder: 99
        },
        files: newChapterFiles
      },
      {
        type: "event.create",
        event: {
          id: "event_bell",
          title: "钟声响起",
          summary: "",
          timeMode: "sequence",
          timeLabel: "第二天",
          storyOrder: 99,
          location: "旧钟楼",
          arcIds: ["arc_tower"],
          characterIds: ["character_bob"]
        }
      },
      {
        type: "connection.create",
        connection: {
          id: "connection_letter_enables_bell",
          sourceEventId: "event_letter",
          targetEventId: "event_bell",
          type: "enables",
          note: ""
        }
      },
      {
        type: "placement.create",
        placement: {
          id: "placement_bell",
          eventId: "event_bell",
          chapterCardId: "chapter_three",
          orderInChapter: 99,
          mode: "scene",
          disclosure: "full",
          writingPrompt: "",
          status: "planned",
          commitId: null
        }
      },
      {
        type: "foreshadowing.create",
        thread: {
          id: "foreshadow_bell",
          title: "钟声来源",
          coreQuestion: "是谁敲响钟声？",
          truthEventId: "event_bell",
          expectedReaderEffect: "",
          status: "planned",
          beats: []
        }
      },
      {
        type: "foreshadowingBeat.create",
        provisionalId: "provisional_beat",
        threadId: "foreshadow_bell",
        beat: {
          id: "beat_bell_plant",
          type: "plant",
          order: 99,
          eventId: "event_bell",
          placementId: "placement_bell",
          chapterCardId: "chapter_three",
          plannedScope: "",
          note: "",
          status: "planned",
          commitId: null
        }
      },
      {
        type: "volume.update",
        id: "volume_two",
        patch: { title: "钟楼卷" }
      }
    ],
    documentWrites: [
      {
        proposalId: "proposal_world_magic",
        fileId: newWorldFile.id,
        mode: "create",
        updatedAt: later,
        content: "# 魔法规则\n",
        reason: "初始化世界规则分类"
      }
    ]
  });
}

export {
  LONG_BOOK_LINE_FILE_ID,
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationBatchSchema,
  LongWorkspaceOperationError,
  applyLongWorkspaceOperations,
  applyPreviewedLongWorkspaceOperations,
  chapterFiles,
  characterFiles,
  committedAnchorWorkspace,
  committedForeshadowingWorkspace,
  committedWorkspace,
  createBatch,
  describe,
  expect,
  expectOperationError,
  file,
  it,
  later,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterHandoffFileId,
  longChapterWorldRevealsFileId,
  longCharacterCoreProfileFileId,
  longCharacterCurrentStateFileId,
  longCharacterHistoryFileId,
  longCharacterRelationshipsFileId,
  longLedgerCommitFileId,
  longWorldbuildingFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  now,
  previewLongWorkspaceOperations,
  workspace
};
export type {
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperation,
  LongWorkspaceOperationErrorCode
};
