import {
  describe,
  documentExecutor,
  expect,
  file,
  it,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerCommitFileId,
  longTools,
  toolByName,
  twoWrittenChaptersIndex
} from "./long-agent-tools.test-support";

function writtenChapterDocuments(
  index: ReturnType<typeof twoWrittenChaptersIndex>
) {
  const chapter = index.chapters[0]!;
  return {
    chapter,
    contents: {
      [chapter.body.id]: "正文已写完。",
      [chapter.characterState.id]: "章末状态。",
      [chapter.handoff.id]: "接续下一章。"
    }
  };
}

describe("unified long-form tools: ledger", () => {
  it("commits continuity for a written chapter when no foreshadowing candidates exist", async () => {
    const index = twoWrittenChaptersIndex();
    const { contents } = writtenChapterDocuments(index);
    const tools = longTools({
      executor: documentExecutor(index, contents),
      activeRoot: "continuity_ledger",
      activeChapterCardId: "chapter_one",
      index
    });
    const result = await toolByName(tools, "propose_continuity_commit").execute(
      "commit",
      {
        summary: "登记第一章连续性",
        foreshadowing_touchpoint_decisions: []
      }
    );
    expect(result.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      agentId: "long",
      input: expect.objectContaining({
        chapterCardIds: ["chapter_one"],
        checkpointChapterCardId: "chapter_one",
        mode: "text_files_batch"
      })
    });
  });

  it("commits from the draft root after workspace metadata changes", async () => {
    const frozen = twoWrittenChaptersIndex();
    const live = LongWorkspaceIndexSnapshotSchema.parse({
      ...frozen,
      updatedAt: "2026-07-26T13:00:00.000Z"
    });
    const { contents } = writtenChapterDocuments(live);
    const tools = longTools({
      executor: documentExecutor(live, contents),
      activeRoot: "draft",
      activeChapterCardId: "chapter_one",
      index: frozen
    });
    const result = await toolByName(tools, "propose_continuity_commit").execute(
      "commit",
      {
        chapter_card_id: "chapter_one",
        summary: "在正文处登记第一章连续性",
        foreshadowing_touchpoint_decisions: []
      }
    );
    expect(result.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      input: expect.objectContaining({
        chapterCardIds: ["chapter_one"],
        checkpointChapterCardId: "chapter_one"
      })
    });
  });

  it("submits contiguous written chapters as one batch using only the final checkpoint files", async () => {
    const index = twoWrittenChaptersIndex();
    const first = index.chapters[0]!;
    const second = index.chapters[1]!;
    const tools = longTools({
      executor: documentExecutor(index, {
        [first.body.id]: "第一章正文。",
        [second.body.id]: "第二章正文。",
        [second.characterState.id]: "两章结束后的汇总状态。",
        [second.handoff.id]: "从第二章末继续。"
      }),
      activeRoot: "continuity_ledger",
      activeChapterCardId: "chapter_two",
      index
    });
    const result = await toolByName(tools, "propose_continuity_commit").execute(
      "batch-commit",
      {
        chapter_card_ids: ["chapter_one", "chapter_two"],
        summary: "一起登记前两章连续性",
        foreshadowing_touchpoint_decisions: []
      }
    );
    expect(result.details).toMatchObject({
      kind: "long-ledger-commit-proposal",
      input: expect.objectContaining({
        mode: "text_files_batch",
        chapterCardIds: ["chapter_one", "chapter_two"],
        checkpointChapterCardId: "chapter_two"
      })
    });
  });

  it("still rejects a commit when the live ledger prefix has changed", async () => {
    const frozen = twoWrittenChaptersIndex();
    const live = LongWorkspaceIndexSnapshotSchema.parse({
      ...frozen,
      updatedAt: "2026-07-26T13:00:00.000Z",
      chapters: frozen.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, commitId: "commit_one" } : chapter
      ),
      ledger: {
        committedThroughChapterId: "chapter_one",
        commits: [
          {
            id: "commit_one",
            mode: "text_files",
            sequence: 1,
            chapterCardId: "chapter_one",
            committedAt: "2026-07-26T13:00:00.000Z",
            placementIds: [],
            foreshadowingBeatIds: [],
            recordFile: file(
              longLedgerCommitFileId("commit_one"),
              "long/ledger/commit-one.json"
            )
          }
        ]
      }
    });
    const { contents } = writtenChapterDocuments(live);
    const tools = longTools({
      executor: documentExecutor(live, contents),
      activeRoot: "draft",
      activeChapterCardId: "chapter_two",
      index: frozen
    });
    await expect(
      toolByName(tools, "propose_continuity_commit").execute("commit", {
        chapter_card_id: "chapter_two",
        summary: "登记第二章连续性",
        foreshadowing_touchpoint_decisions: []
      })
    ).rejects.toThrow(
      "Long workspace context no longer matches the loaded workspace index."
    );
  });
});
