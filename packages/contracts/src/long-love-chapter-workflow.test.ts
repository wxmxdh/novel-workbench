import { describe, expect, it } from "vitest";
import { createEnvelope } from "./envelope";
import { LongLoveChapterWorkflowCommandEnvelopeSchema } from "./long-love-chapter-workflow";

describe("LOVE chapter annotation adoption contract", () => {
  it("allows read-only notes retrieval without selecting a draft or write evidence", () => {
    const envelope = createEnvelope(
      "long.loveChapterWorkflow",
      {
        bookId: "longbook_9a146bbe",
        action: "read_notes",
        chapter: 1,
        volume: "第一卷",
        targetModel: "gpt-6.1-sol"
      },
      { id: "workflow-read-notes-01" }
    );
    expect(
      LongLoveChapterWorkflowCommandEnvelopeSchema.parse(envelope).payload
    ).toMatchObject({
      action: "read_notes",
      targetModel: "gpt-6.1-sol"
    });
  });

  it("restricts optional read targets to one normalized project-relative selector", () => {
    const base = {
      bookId: "longbook_9a146bbe",
      action: "read_notes",
      chapter: 1,
      volume: "第一卷"
    } as const;
    expect(
      LongLoveChapterWorkflowCommandEnvelopeSchema.safeParse(
        createEnvelope(
          "long.loveChapterWorkflow",
          {
            ...base,
            targetDraftPath: "004_写作中/第001章_正文草稿_gpt-6.1-sol.md",
            targetModel: "gpt-6.1-sol"
          },
          { id: "workflow-read-notes-ambiguous-target" }
        )
      ).success
    ).toBe(false);
    for (const targetDraftPath of [
      "../other-book/chapter.md",
      "D:/outside/chapter.md",
      "004_写作中/../../outside.md"
    ]) {
      expect(
        LongLoveChapterWorkflowCommandEnvelopeSchema.safeParse(
          createEnvelope(
            "long.loveChapterWorkflow",
            { ...base, targetDraftPath },
            { id: `workflow-read-notes-${targetDraftPath.length}` }
          )
        ).success
      ).toBe(false);
    }
  });

  it("does not allow read-only retrieval to carry author adoption evidence", () => {
    const result = LongLoveChapterWorkflowCommandEnvelopeSchema.safeParse(
      createEnvelope(
        "long.loveChapterWorkflow",
        {
          bookId: "longbook_9a146bbe",
          action: "read_notes",
          chapter: 1,
          volume: "第一卷",
          authorActionEvidence: {
            requestId: "author-request-01",
            quote: "请读取批注。"
          }
        },
        { id: "workflow-read-notes-evidence" }
      )
    );
    expect(result.success).toBe(false);
  });

  it("allows an empty annotation ID list to bind notes as background only", () => {
    const payload = {
      bookId: "longbook_9a146bbe",
      action: "attach_notes",
      chapter: 1,
      volume: "第一卷",
      notePaths: ["006_批注/批注.json"],
      annotationItemIds: [],
      authorActionEvidence: {
        requestId: "author-request-01",
        quote: "请先读取这些批注作为背景，不采用其中意见。"
      }
    } as const;
    const envelope = createEnvelope("long.loveChapterWorkflow", payload, {
      id: "workflow-test-01"
    });
    expect(
      LongLoveChapterWorkflowCommandEnvelopeSchema.parse(envelope).payload
    ).toMatchObject({ annotationItemIds: [] });
  });

  it("carries naturally selected item IDs only on attach_notes", () => {
    const payload = {
      bookId: "longbook_9a146bbe",
      action: "attach_notes",
      chapter: 1,
      volume: "第一卷",
      notePaths: ["006_批注/批注.json"],
      annotationItemIds: ["web-comment-01", "web-comment-02"],
      authorActionEvidence: {
        requestId: "author-request-02",
        quote: "我明确采用第一和第二条意见。"
      }
    } as const;
    const envelope = createEnvelope("long.loveChapterWorkflow", payload, {
      id: "workflow-test-02"
    });
    expect(
      LongLoveChapterWorkflowCommandEnvelopeSchema.parse(envelope).payload
        .annotationItemIds
    ).toEqual(["web-comment-01", "web-comment-02"]);
    const otherAction = LongLoveChapterWorkflowCommandEnvelopeSchema.safeParse(
      createEnvelope(
        "long.loveChapterWorkflow",
        {
          bookId: "longbook_9a146bbe",
          action: "prepare",
          chapter: 1,
          volume: "第一卷",
          annotationItemIds: ["web-comment-01"]
        },
        { id: "workflow-test-invalid" }
      )
    );
    expect(otherAction.success).toBe(false);
  });
});
