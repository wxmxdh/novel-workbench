import { describe, expect, it } from "vitest";
import {
  LongChapterWriteProposalEventEnvelopeSchema,
  LongCharacterFileProposalEventEnvelopeSchema,
  LongContinuityFileProposalEventEnvelopeSchema,
  LongLedgerCommitProposalEventEnvelopeSchema,
  LongMutationProposalEventEnvelopeSchema,
  LongWorldbuildingFileProposalEventEnvelopeSchema,
  SystemEventEnvelopeSchema,
  createEnvelope,
  longCharacterCoreProfileFileId,
  longCharacterFilePath,
  longChapterBodyFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId
} from "./index";

const runtime = {
  provider: "deepwrite",
  model: "proposal-test",
  mode: "local-faux" as const
};
const context = {
  sessionId: "session-long-proposal",
  runId: "run-long-proposal",
  resourceId: "longbook_proposal"
};
const common = {
  sessionId: context.sessionId,
  runId: context.runId,
  toolCallId: "tool-long-proposal",
  bookId: "longbook_proposal",
  agentId: "long" as const,
  summary: "形成待审阅提案。",
  runtime
};
const ledgerAudit = {
  commitMessage: "核验并提交第一章",
  chapterSummary: {
    timeline: "第一天。",
    characterStates: "人物状态。",
    factionStates: "势力状态。",
    realmStates: "境界状态。",
    foreshadowingStates: "伏笔状态。",
    continuityNotes: "连续性说明。"
  }
};

describe("long proposal event contracts", () => {
  it("preserves typed continuity text-file changes in the system event union", () => {
    const fileId = longChapterForeshadowingChangesFileId("chapter_one");
    const proposal = createEnvelope(
      "long.continuity_file_proposal",
      {
        ...common,
        agentId: "long" as const,
        batch: {
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_continuity_foreshadowing",
              fileId,
              content: "蜡封伏笔已种下。",
              mode: "replace" as const,
              updatedAt: "2026-07-26T12:00:00.000Z",
              reason: "记录本章伏笔变化"
            }
          ]
        },
        files: [
          {
            chapterCardId: "chapter_one",
            role: "foreshadowing_changes" as const,
            characterId: null,
            fileId,
            filePath: longChapterContinuityFilePath(
              "chapter_one",
              "foreshadowing-changes.md"
            ),
            title: "第一章 / 伏笔变化",
            operation: "edit" as const,
            beforeText: "",
            afterText: "蜡封伏笔已种下。"
          }
        ]
      },
      { id: "event-long-continuity-file", context }
    );

    expect(
      LongContinuityFileProposalEventEnvelopeSchema.parse(proposal).payload
    ).toMatchObject({
      agentId: "long",
      files: [
        {
          role: "foreshadowing_changes",
          beforeText: "",
          afterText: "蜡封伏笔已种下。"
        }
      ]
    });
    expect(SystemEventEnvelopeSchema.parse(proposal).type).toBe(
      "long.continuity_file_proposal"
    );
  });

  it("rejects unrelated structure operations hidden in continuity file proposals", () => {
    const fileId = longChapterForeshadowingChangesFileId("chapter_one");
    const proposal = createEnvelope(
      "long.continuity_file_proposal",
      {
        ...common,
        agentId: "long" as const,
        batch: {
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [
            {
              type: "worldbuilding.update" as const,
              id: "world_rules",
              patch: { title: "审批卡未展示的结构变更" }
            }
          ],
          documentWrites: [
            {
              proposalId: "proposal_continuity_hidden_operation",
              fileId,
              content: "蜡封伏笔已种下。",
              mode: "replace" as const,
              updatedAt: "2026-07-26T12:00:00.000Z",
              reason: "记录本章伏笔变化"
            }
          ]
        },
        files: [
          {
            chapterCardId: "chapter_one",
            role: "foreshadowing_changes" as const,
            characterId: null,
            fileId,
            filePath: longChapterContinuityFilePath(
              "chapter_one",
              "foreshadowing-changes.md"
            ),
            title: "第一章 / 伏笔变化",
            operation: "edit" as const,
            beforeText: "",
            afterText: "蜡封伏笔已种下。"
          }
        ]
      },
      { id: "event-long-continuity-hidden-operation", context }
    );

    expect(() =>
      LongContinuityFileProposalEventEnvelopeSchema.parse(proposal)
    ).toThrow(/only create chapter continuity files/u);
  });

  it("accepts independent mutation, chapter-write and ledger-commit events", () => {
    const mutation = createEnvelope(
      "long.mutation_proposal",
      {
        ...common,
        batch: {
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [
            {
              type: "worldbuilding.update" as const,
              id: "world_rules",
              patch: { title: "世界硬规则" }
            }
          ],
          documentWrites: []
        }
      },
      { id: "event-long-mutation", context }
    );
    const chapter = createEnvelope(
      "long.chapter_write_proposal",
      {
        ...common,
        agentId: "long" as const,
        batch: {
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_chapter_one",
              fileId: longChapterBodyFileId("chapter_one"),
              content: "正文",
              mode: "replace" as const,
              updatedAt: "2026-07-26T12:00:00.000Z",
              reason: "完成第一章"
            }
          ]
        },
        file: {
          chapterCardId: "chapter_one",
          chapterTitle: "第一章",
          fileId: longChapterBodyFileId("chapter_one"),
          filePath: longChapterFilePath("chapter_one", "body.md"),
          operation: "create" as const,
          beforeText: "",
          afterText: "正文"
        }
      },
      { id: "event-long-chapter", context }
    );
    const worldbuildingFile = createEnvelope(
      "long.worldbuilding_file_proposal",
      {
        ...common,
        batch: {
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [
            {
              type: "worldbuildingItem.create" as const,
              categoryId: "world_rules",
              item: {
                id: "worlditem_memory",
                title: "记忆代价",
                order: 1,
                file: {
                  id: longWorldbuildingItemFileId("worlditem_memory"),
                  path: longWorldbuildingItemContentPath(
                    "world_rules",
                    "worlditem_memory"
                  ),
                  updatedAt: "2026-07-26T12:00:00.000Z"
                }
              }
            }
          ],
          documentWrites: []
        },
        files: [
          {
            categoryId: "world_rules",
            itemId: "worlditem_memory",
            fileId: longWorldbuildingItemFileId("worlditem_memory"),
            filePath: longWorldbuildingItemContentPath(
              "world_rules",
              "worlditem_memory"
            ),
            title: "记忆代价",
            operation: "create" as const,
            beforeText: "",
            afterText: ""
          }
        ]
      },
      { id: "event-long-worldbuilding-file", context }
    );
    const characterFile = createEnvelope(
      "long.character_file_proposal",
      {
        ...common,
        agentId: "long" as const,
        batch: {
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_character_core",
              fileId: longCharacterCoreProfileFileId("character_lan"),
              content: "雾港巡夜人。",
              mode: "replace" as const,
              updatedAt: "2026-07-26T12:00:00.000Z",
              reason: "写入核心档案"
            }
          ]
        },
        files: [
          {
            characterId: "character_lan",
            characterName: "林岚",
            document: "core_profile" as const,
            fileId: longCharacterCoreProfileFileId("character_lan"),
            filePath: longCharacterFilePath("character_lan", "core-profile.md"),
            title: "林岚 / 核心档案",
            operation: "write" as const,
            beforeText: "",
            afterText: "雾港巡夜人。"
          }
        ]
      },
      { id: "event-long-character-file", context }
    );
    const ledger = createEnvelope(
      "long.ledger_commit_proposal",
      {
        ...common,
        agentId: "long" as const,
        input: {
          bookId: common.bookId,
          chapterCardId: "chapter_one",
          placementDecisions: {},
          foreshadowingBeatDecisions: {},
          fileUpdates: [],
          ...ledgerAudit
        },
        file: {
          chapterCardId: "chapter_one",
          chapterTitle: "第一章",
          fileId: longChapterBodyFileId("chapter_one"),
          filePath: longChapterFilePath("chapter_one", "body.md"),
          operation: "create" as const,
          beforeText: "",
          afterText: ""
        }
      },
      { id: "event-long-ledger", context }
    );

    expect(
      LongMutationProposalEventEnvelopeSchema.parse(mutation).payload
    ).toMatchObject({
      bookId: "longbook_proposal"
    });
    expect(
      LongWorldbuildingFileProposalEventEnvelopeSchema.parse(worldbuildingFile)
        .payload
    ).toMatchObject({
      bookId: "longbook_proposal",
      files: [
        {
          title: "记忆代价",
          operation: "create"
        }
      ]
    });
    expect(
      LongCharacterFileProposalEventEnvelopeSchema.parse(characterFile).payload
    ).toMatchObject({
      agentId: "long",
      files: [
        {
          characterId: "character_lan",
          document: "core_profile",
          operation: "write"
        }
      ]
    });
    expect(
      LongChapterWriteProposalEventEnvelopeSchema.parse(chapter).payload
    ).toMatchObject({
      file: {
        chapterCardId: "chapter_one",
        afterText: "正文"
      },
      batch: {
        documentWrites: [{ content: "正文" }]
      }
    });
    expect(
      LongLedgerCommitProposalEventEnvelopeSchema.parse(ledger).payload.input
    ).toMatchObject({
      chapterCardId: "chapter_one",
      fileUpdates: []
    });
    expect(
      [mutation, worldbuildingFile, characterFile, chapter, ledger].map(
        (event) => SystemEventEnvelopeSchema.parse(event).type
      )
    ).toEqual([
      "long.mutation_proposal",
      "long.worldbuilding_file_proposal",
      "long.character_file_proposal",
      "long.chapter_write_proposal",
      "long.ledger_commit_proposal"
    ]);
  });

  it("rejects context mismatch and a mismatched chapter document write", () => {
    const chapter = createEnvelope(
      "long.chapter_write_proposal",
      {
        ...common,
        agentId: "long" as const,
        batch: {
          updatedAt: "2026-07-26T12:00:00.000Z",
          operations: [],
          documentWrites: [
            {
              proposalId: "proposal_chapter_mismatch",
              fileId: longChapterBodyFileId("chapter_one"),
              content: "不匹配的正文",
              mode: "replace" as const,
              updatedAt: "2026-07-26T12:00:00.000Z",
              reason: "错误正文"
            }
          ]
        },
        file: {
          chapterCardId: "chapter_one",
          chapterTitle: "第一章",
          fileId: longChapterBodyFileId("chapter_one"),
          filePath: longChapterFilePath("chapter_one", "body.md"),
          operation: "create" as const,
          beforeText: "",
          afterText: ""
        }
      },
      { id: "event-long-chapter-other", context }
    );
    expect(() =>
      LongChapterWriteProposalEventEnvelopeSchema.parse(chapter)
    ).toThrow(/matching body document write/u);

    const ledger = createEnvelope(
      "long.ledger_commit_proposal",
      {
        ...common,
        agentId: "long" as const,
        input: {
          bookId: common.bookId,
          chapterCardId: "chapter_one",
          placementDecisions: {},
          foreshadowingBeatDecisions: {},
          fileUpdates: [],
          ...ledgerAudit
        }
      },
      {
        id: "event-long-ledger-bad-context",
        context: {
          ...context,
          runId: "run-other"
        }
      }
    );
    expect(() =>
      LongLedgerCommitProposalEventEnvelopeSchema.parse(ledger)
    ).toThrow(/runId must match/u);
  });
});
