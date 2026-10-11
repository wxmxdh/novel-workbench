import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  LongSubmitLoveReviewCommandEnvelopeSchema
} from "@deepwrite/contracts";
import { buildPrepareLoveReviewTool } from "../../../../packages/pi-runtime-adapter/src/love-review-prepare-tool";
import { createLoveReviewRunState } from "../../../../packages/pi-runtime-adapter/src/love-review-runtime";
import type { BuildSpawnSubagentToolInput } from "../../../../packages/pi-runtime-adapter/src/subagent-types";
import type { LongWorkspaceService } from "./long-workspace-service";

const mocks = vi.hoisted(() => ({
  requireProject: vi.fn(),
  readNativeComparisonEvidence: vi.fn()
}));

vi.mock("./novel-writing-store", () => ({
  requireProject: mocks.requireProject
}));
vi.mock("./native-comparison-evidence", () => ({
  readNativeComparisonEvidence: mocks.readNativeComparisonEvidence
}));

import {
  prepareLoveReviewCore,
  submitLoveReviewCore
} from "./love-review-core";
import { handleLongCoreCommand } from "./long-core-commands";
import { reviewHash, writeReviewJson } from "./love-review-files";

const BOOK_ID = "longbook_9a146bbe" as const;
const SESSION_ID = "session-love-review-test";
const REVIEWER_ID = "love-viewpoint";
const runtime = {
  provider: "fixture",
  model: "fixture",
  mode: "local-faux" as const
};
const tempRoots: string[] = [];

async function fixture(
  options: { duplicateChapter?: boolean; cardText?: string } = {}
) {
  const root = await mkdtemp(join(tmpdir(), "love-review-core-"));
  tempRoots.push(root);
  await mkdir(join(root, ".novel"), { recursive: true });
  await mkdir(join(root, "plans"), { recursive: true });
  const cardText = options.cardText ?? "# 第一章\n\n宋子凡走进教室。\n";
  const outline = `---\nversion: fixture-1\n---\n\n${cardText}`;
  await writeFile(join(root, "plans/chapter.md"), outline, "utf8");
  await writeFile(
    join(root, ".novel/chapter-state.json"),
    JSON.stringify({
      chapters: [
        {
          chapter: 1,
          volume: "第一卷",
          selected_outline: {
            path: "plans/chapter.md",
            hash: reviewHash(outline)
          }
        }
      ]
    }),
    "utf8"
  );

  const cardRef = {
    id: "file-chapter-card",
    path: "chapters/chapter-1/card.md",
    updatedAt: "2026-10-05T00:00:00.000Z"
  };
  const bodyRef = {
    id: "file-chapter-body",
    path: "chapters/chapter-1/body.md",
    updatedAt: "2026-10-05T00:00:00.000Z"
  };
  const cards = [
    {
      id: "chapter-card-1",
      title: "第一章",
      narrativeOrder: 1,
      volumeId: "volume-1",
      primaryArcId: null
    },
    ...(options.duplicateChapter
      ? [
          {
            id: "chapter-card-1-other-volume",
            title: "另一卷第一章",
            narrativeOrder: 1,
            volumeId: "volume-2",
            primaryArcId: null
          }
        ]
      : [])
  ];
  const chapters = cards.map((card) => ({
    chapterCardId: card.id,
    card: {
      ...cardRef,
      id: `file-${card.id}-card`,
      path: `chapters/${card.id}/card.md`
    },
    body: {
      ...bodyRef,
      id: `file-${card.id}-body`,
      path: `chapters/${card.id}/body.md`
    }
  }));
  const textByFile = new Map<string, string>();
  for (const chapter of chapters) {
    textByFile.set(chapter.card.id, cardText);
    textByFile.set(chapter.body.id, "");
  }
  const refByFile = new Map<string, typeof cardRef>();
  for (const chapter of chapters) {
    refByFile.set(chapter.card.id, chapter.card);
    refByFile.set(chapter.body.id, chapter.body);
  }
  const workspaceIndex = {
    bookId: BOOK_ID,
    plot: {
      volumes: [
        { id: "volume-1", title: "第一卷", order: 1, summary: "" },
        ...(options.duplicateChapter
          ? [{ id: "volume-2", title: "第二卷", order: 2, summary: "" }]
          : [])
      ],
      chapterCards: cards
    },
    chapters
  };
  const service = {
    getWorkspaceIndex: vi.fn(async () => ({ bookId: BOOK_ID, workspaceIndex })),
    readDocument: vi.fn(
      async (input: {
        bookId: string;
        fileId: string;
        offset: number;
        maxCharacters: number;
      }) => {
        const content = textByFile.get(input.fileId);
        const file = refByFile.get(input.fileId);
        if (content === undefined || !file)
          throw new Error("missing fixture file");
        const characters = Array.from(content);
        const pageContent = characters
          .slice(input.offset, input.offset + input.maxCharacters)
          .join("");
        const nextOffset = input.offset + Array.from(pageContent).length;
        return {
          bookId: input.bookId,
          file,
          content: pageContent,
          offset: input.offset,
          totalCharacters: characters.length,
          nextOffset: nextOffset < characters.length ? nextOffset : null
        };
      }
    )
  } as unknown as LongWorkspaceService;
  mocks.requireProject.mockResolvedValue({ project: { projectRoot: root } });
  mocks.readNativeComparisonEvidence.mockResolvedValue(
    "# LOVE 当前原生资料\n人物与故事线。\n"
  );
  return { root, service, cardText };
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("LOVE review Core bridge", () => {
  it("prepares from the current native chapter card and complete source pages", async () => {
    const cardText = `# 第一章\n\n${"正文。🙂".repeat(12_000)}\n`;
    const { service } = await fixture({ cardText });
    const snapshot = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        targetKind: "chapter_card",
        reviewerIds: [REVIEWER_ID],
        authorText: "请审第一章章卡。"
      }
    );

    expect(snapshot.targets[0]?.path).toBe(
      "native:chapters/chapter-card-1/card.md"
    );
    expect(snapshot.targets[0]?.content).toBe(cardText);
    expect(
      snapshot.sources.some((source) => source.id === "native-current")
    ).toBe(true);
    expect(service.readDocument).toHaveBeenCalledTimes(3);
  });

  it("does not guess when chapter order repeats across volumes", async () => {
    const { service } = await fixture({ duplicateChapter: true });
    await expect(
      prepareLoveReviewCore(service, "fixture-user-data", SESSION_ID, {
        bookId: BOOK_ID,
        chapter: 1,
        targetKind: "chapter_card",
        reviewerIds: [REVIEWER_ID],
        authorText: "请审第一章。"
      })
    ).rejects.toThrow("该章号在多个卷中重复");
  });

  it("resolves only the newest same-session batch with exact chapter, volume and target kind", async () => {
    const { root, service } = await fixture();
    const base = {
      bookId: BOOK_ID,
      chapter: 1,
      volume: "第一卷",
      targetKind: "chapter_card" as const,
      reviewerIds: [REVIEWER_ID],
      authorText: "请审第一章章卡。"
    };
    const older = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      base
    );
    const newer = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      { ...base, authorText: "请再次审第一章章卡。" }
    );
    await writeReviewJson(root, older.reviewId, {
      snapshot: older,
      sessionId: SESSION_ID,
      createdAt: "2026-10-05T10:00:00.000Z"
    });
    await writeReviewJson(root, newer.reviewId, {
      snapshot: newer,
      sessionId: SESSION_ID,
      createdAt: "2026-10-05T10:00:01.000Z"
    });
    const resumed = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      { ...base, resumeLatest: true }
    );
    expect(resumed.reviewId).toBe(newer.reviewId);
  });

  it("refuses to guess when matching latest batches have indistinguishable creation times", async () => {
    const { root, service } = await fixture();
    const base = {
      bookId: BOOK_ID,
      chapter: 1,
      volume: "第一卷",
      targetKind: "chapter_card" as const,
      reviewerIds: [REVIEWER_ID],
      authorText: "请审第一章章卡。"
    };
    const first = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      base
    );
    const second = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      { ...base, authorText: "请再次审第一章章卡。" }
    );
    const createdAt = "2026-10-05T10:00:00.000Z";
    await writeReviewJson(root, first.reviewId, {
      snapshot: first,
      sessionId: SESSION_ID,
      createdAt
    });
    await writeReviewJson(root, second.reviewId, {
      snapshot: second,
      sessionId: SESSION_ID,
      createdAt
    });
    await expect(
      prepareLoveReviewCore(service, "fixture-user-data", SESSION_ID, {
        ...base,
        resumeLatest: true
      })
    ).rejects.toThrow("不会猜测恢复目标");
  });

  it("submits against the same-session review manifest and refuses an outdated outline", async () => {
    const { root, service, cardText } = await fixture();
    const snapshot = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        chapter: 1,
        volume: "第一卷",
        targetKind: "chapter_card",
        reviewerIds: [REVIEWER_ID],
        authorText: "请审第一章章卡。"
      }
    );
    await writeFile(join(root, "plans/chapter.md"), "# 已改变的大纲\n", "utf8");

    await expect(
      submitLoveReviewCore(service, "fixture-user-data", SESSION_ID, {
        bookId: BOOK_ID,
        reviewId: snapshot.reviewId,
        targetSetSha256: snapshot.targetSetSha256,
        reviewerId: REVIEWER_ID,
        phase: "specialist",
        report: {
          status: "reviewed",
          summary: "已审阅章卡。",
          findings: [
            {
              id: "viewpoint-01",
              category: "literary-suggestion",
              scope: "第一章章卡",
              issue: "说明性较强。",
              sourceId: "target-1",
              quote: cardText.trim()
            }
          ],
          missingSources: [],
          reviewedSourceIds: [
            ...snapshot.targets.map(({ id }) => id),
            ...snapshot.sources.map(({ id }) => id)
          ]
        },
        runtime
      })
    ).rejects.toThrow("正文或依据已变化");
  });

  it("keeps a successful specialist submission short of final readiness", async () => {
    const { service } = await fixture();
    const snapshot = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        chapter: 1,
        volume: "第一卷",
        targetKind: "chapter_card",
        reviewerIds: [REVIEWER_ID],
        authorText: "请审第一章章卡。"
      }
    );
    const coverage = await submitLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        reviewId: snapshot.reviewId,
        targetSetSha256: snapshot.targetSetSha256,
        reviewerId: REVIEWER_ID,
        phase: "specialist",
        report: {
          status: "reviewed",
          summary: "已审阅章卡。",
          findings: [],
          missingSources: [],
          reviewedSourceIds: [
            ...snapshot.targets.map(({ id }) => id),
            ...snapshot.sources.map(({ id }) => id)
          ]
        },
        runtime
      }
    );
    expect(coverage.state).toBe("needs_independent_review");
    expect(coverage.phase).toBe("specialist");
    expect(coverage.completedCount).toBe(1);
  });

  it("resumes the latest matching batch through the parent tool and Core, preserving completed reports", async () => {
    const { service } = await fixture();
    const reviewerIds = ["love-outline", "love-life"];
    const state = createLoveReviewRunState();
    let authorText = "请审第一章章卡，核对执行大纲与原文。";
    const executor = async (command: {
      type: string;
      id: string;
      context: { sessionId?: string };
      payload: never;
    }) => {
      const sessionId = command.context.sessionId ?? SESSION_ID;
      if (command.type === "long.prepareLoveReview") {
        return {
          status: "accepted" as const,
          requestId: command.id,
          payload: await prepareLoveReviewCore(
            service,
            "fixture-user-data",
            sessionId,
            command.payload
          )
        };
      }
      return {
        status: "accepted" as const,
        requestId: command.id,
        payload: {
          coverage: await submitLoveReviewCore(
            service,
            "fixture-user-data",
            sessionId,
            command.payload
          )
        }
      };
    };
    const parentInput = {
      loveReviewCoordinates: {
        bookId: BOOK_ID,
        sessionId: SESSION_ID,
        runId: "parent-run"
      },
      loveReviewExecutor: executor,
      loveReviewAuthorText: authorText,
      loveReviewRunState: state,
      definitions: reviewerIds.map((id) => ({
        id,
        enabled: true,
        name: id,
        description: "审阅",
        systemPrompt: "按分工审阅",
        modelMode: "inherit"
      }))
    } as unknown as BuildSpawnSubagentToolInput;
    const tool = buildPrepareLoveReviewTool(parentInput)!;
    const first = await tool.execute("first", {
      reviewer_ids: reviewerIds,
      chapter: 1,
      volume: "第一卷",
      target_kind: "chapter_card"
    } as never);
    const firstText = first.content.find((item) => item.type === "text")!.text;
    const firstMetadata = JSON.parse(firstText.split("\n\n", 1)[0]!);
    expect(firstMetadata.dispatch_reviewer_ids).toEqual(reviewerIds);

    const firstSnapshot = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        reviewId: firstMetadata.review_id,
        chapter: 1,
        volume: "第一卷",
        targetKind: "chapter_card",
        reviewerIds,
        authorText
      }
    );
    await submitLoveReviewCore(service, "fixture-user-data", SESSION_ID, {
      bookId: BOOK_ID,
      reviewId: firstSnapshot.reviewId,
      targetSetSha256: firstSnapshot.targetSetSha256,
      reviewerId: reviewerIds[0]!,
      phase: "specialist",
      report: {
        status: "reviewed",
        summary: "已完成大纲维度审阅。",
        findings: [],
        missingSources: [],
        reviewedSourceIds: [
          ...firstSnapshot.targets.map(({ id }) => id),
          ...firstSnapshot.sources.map(({ id }) => id)
        ]
      },
      runtime
    });

    authorText = "请继续补齐刚才审阅批次里尚未完成的成员。";
    const resumed = await buildPrepareLoveReviewTool({
      ...parentInput,
      loveReviewAuthorText: authorText
    })!.execute("resume", {
      reviewer_ids: reviewerIds,
      resume_latest: true,
      chapter: 1,
      volume: "第一卷",
      target_kind: "chapter_card"
    } as never);
    const resumedText = resumed.content.find(
      (item) => item.type === "text"
    )!.text;
    const resumedMetadata = JSON.parse(resumedText.split("\n\n", 1)[0]!);
    expect(resumedMetadata.review_id).toBe(firstMetadata.review_id);
    expect(resumedMetadata.completed_reviewer_ids).toEqual([reviewerIds[0]]);
    expect(resumedMetadata.missing_reviewer_ids).toEqual([reviewerIds[1]]);
    expect(resumedMetadata.dispatch_reviewer_ids).toEqual([reviewerIds[1]]);
    expect(resumedMetadata.completed_count).toBe(1);
    const resumedSnapshot = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        reviewId: firstMetadata.review_id,
        chapter: 1,
        volume: "第一卷",
        targetKind: "chapter_card",
        reviewerIds,
        authorText
      }
    );
    expect(resumedSnapshot.reports.map(({ reviewerId }) => reviewerId)).toEqual(
      [reviewerIds[0]]
    );
    expect(resumedSnapshot.coverage.missingReviewerIds).toEqual([
      reviewerIds[1]
    ]);
  });

  it("returns coverage in the accepted payload through the actual Main/Core handler", async () => {
    const { service } = await fixture();
    const snapshot = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        chapter: 1,
        volume: "第一卷",
        targetKind: "chapter_card",
        reviewerIds: [REVIEWER_ID],
        authorText: "请审第一章章卡。"
      }
    );
    const result = await handleLongCoreCommand(
      service,
      LongSubmitLoveReviewCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.submitLoveReview",
          {
            bookId: BOOK_ID,
            reviewId: snapshot.reviewId,
            targetSetSha256: snapshot.targetSetSha256,
            reviewerId: REVIEWER_ID,
            phase: "specialist",
            report: {
              status: "reviewed",
              summary: "已审阅章卡。",
              findings: [],
              missingSources: [],
              reviewedSourceIds: [
                ...snapshot.targets.map(({ id }) => id),
                ...snapshot.sources.map(({ id }) => id)
              ]
            },
            runtime
          },
          {
            id: "love-review-submit-handler-test",
            context: { sessionId: SESSION_ID }
          }
        )
      ),
      "fixture-user-data"
    );

    expect(result?.status).toBe("accepted");
    if (result?.status !== "accepted")
      throw new Error("Expected accepted result");
    expect(result.payload).toMatchObject({
      coverage: {
        reviewId: snapshot.reviewId,
        targetSetSha256: snapshot.targetSetSha256,
        phase: "specialist",
        state: "needs_independent_review"
      }
    });
  });

  it("uses a review ID's stored chapter and volume when no new locator is supplied", async () => {
    const { service } = await fixture();
    const snapshot = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        chapter: 1,
        volume: "第一卷",
        targetKind: "chapter_card",
        reviewerIds: [REVIEWER_ID],
        authorText: "请审第一章章卡。"
      }
    );
    const reopened = await prepareLoveReviewCore(
      service,
      "fixture-user-data",
      SESSION_ID,
      {
        bookId: BOOK_ID,
        reviewId: snapshot.reviewId,
        targetKind: "chapter_card",
        reviewerIds: [REVIEWER_ID],
        authorText: "请审第一章章卡。"
      }
    );
    expect(reopened.reviewId).toBe(snapshot.reviewId);
    expect(reopened.volume).toBe("第一卷");
  });
});
