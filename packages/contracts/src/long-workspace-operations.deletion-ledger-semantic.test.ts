import {
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationBatchSchema,
  applyLongWorkspaceOperations,
  committedForeshadowingWorkspace,
  describe,
  expect,
  it,
  later,
  previewLongWorkspaceOperations
} from "./long-workspace-operations.test-support";

describe("long workspace operation engine: deletion ledger semantics", () => {
  it("describes exact semantic record cleanup when deleting a referenced character", () => {
    const source = committedForeshadowingWorkspace();
    source.ledger.projection = {
      throughCommitId: "commit_first",
      facts: [
        {
          factId: "fact_character_state",
          domain: "character",
          subjectId: "character_alice",
          field: "location",
          value: "林岚仍在家中",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章正文"
        },
        {
          factId: "fact_event_state",
          domain: "plot",
          subjectId: "event_letter",
          field: "state",
          value: "来信已经收到",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章正文"
        }
      ],
      knowledge: [
        {
          factId: "fact_character_state",
          audienceType: "reader",
          audienceId: null,
          level: "knows",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "正文直接说明"
        },
        {
          factId: "fact_event_state",
          audienceType: "character",
          audienceId: "character_alice",
          level: "knows",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "林岚亲自收信"
        },
        {
          factId: "fact_event_state",
          audienceType: "reader",
          audienceId: null,
          level: "knows",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "正文直接说明"
        }
      ],
      openLoops: [
        {
          loopId: "loop_character_future",
          kind: "character",
          status: "open",
          detail: "林岚之后会去哪里",
          subjectId: "character_alice",
          factId: null,
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章结尾"
        },
        {
          loopId: "loop_character_fact",
          kind: "knowledge",
          status: "open",
          detail: "谁知道林岚的位置",
          subjectId: null,
          factId: "fact_character_state",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章结尾"
        },
        {
          loopId: "loop_event_future",
          kind: "plot",
          status: "open",
          detail: "来信从何而来",
          subjectId: "event_letter",
          factId: "fact_event_state",
          sourceCommitId: "commit_first",
          sourceChapterCardId: "chapter_one",
          evidence: "第一章结尾"
        }
      ],
      latestHandoff: {
        summary: "继续调查来信",
        mustCarry: [],
        nextChapterConstraints: [],
        openLoops: [
          "loop_character_future",
          "loop_character_fact",
          "loop_event_future"
        ],
        chapterCardId: "chapter_one",
        commitId: "commit_first"
      }
    };
    const parsed = LongWorkspaceIndexSnapshotSchema.parse(source);
    const batch = LongWorkspaceOperationBatchSchema.parse({
      updatedAt: later,
      operations: [{ type: "character.delete", id: "character_alice" }]
    });
    const preview = previewLongWorkspaceOperations(parsed, batch);

    expect(preview.ledgerRecordEdits).toEqual([
      expect.objectContaining({
        commitId: "commit_first",
        removeFactIds: ["fact_character_state"],
        removeFactKeys: [
          {
            domain: "character",
            subjectId: "character_alice",
            field: "location"
          }
        ],
        removeKnowledgeKeys: [
          {
            factId: "fact_character_state",
            audienceType: "reader",
            audienceId: null
          },
          {
            factId: "fact_event_state",
            audienceType: "character",
            audienceId: "character_alice"
          }
        ],
        removeOpenLoopIds: ["loop_character_fact", "loop_character_future"]
      })
    ]);

    const result = applyLongWorkspaceOperations(parsed, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(result.snapshot.ledger.projection).toMatchObject({
      facts: [expect.objectContaining({ factId: "fact_event_state" })],
      knowledge: [
        expect.objectContaining({
          factId: "fact_event_state",
          audienceType: "reader"
        })
      ],
      openLoops: [expect.objectContaining({ loopId: "loop_event_future" })],
      latestHandoff: expect.objectContaining({
        openLoops: ["loop_event_future"]
      })
    });
  });
});
