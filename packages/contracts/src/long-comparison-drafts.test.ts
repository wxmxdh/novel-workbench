import { describe, expect, it } from "vitest";
import { ComparisonDraftWriterContextSchema } from "./long-comparison-drafts";

const base = {
  authorizationId: "authorization-current-0001",
  bookId: "longbook_9a146bbe",
  chapter: 1,
  chapterCardId: "chapter_one",
  writers: [
    {
      definitionId: "love-writer-deepseek",
      runtime: {
        provider: "deepseek",
        model: "deepseek-r1",
        mode: "provider",
        configId: "deepseek-config"
      }
    }
  ],
  authorRequest: {
    requestId: "current-author-request",
    exactText: "继续失败的一份",
    authorizationQuote: "继续失败的一份",
    receivedAt: "2026-10-06T00:00:00.000Z"
  }
};

describe("ComparisonDraftWriterContext recovery lineage", () => {
  it("accepts a trusted pair of prior authorization fields", () => {
    expect(
      ComparisonDraftWriterContextSchema.parse({
        ...base,
        priorAuthorizationId: "authorization-original-0001",
        priorAuthorTextSha256: "a".repeat(64)
      })
    ).toMatchObject({
      priorAuthorizationId: "authorization-original-0001",
      priorAuthorTextSha256: "a".repeat(64)
    });
  });

  it.each([
    { priorAuthorizationId: "authorization-original-0001" },
    { priorAuthorTextSha256: "a".repeat(64) },
    {
      priorAuthorizationId: "authorization-original-0001",
      priorAuthorTextSha256: "not-a-sha256"
    }
  ])("rejects incomplete or malformed lineage: $priorAuthorizationId", (lineage) => {
    expect(
      ComparisonDraftWriterContextSchema.safeParse({ ...base, ...lineage })
        .success
    ).toBe(false);
  });

  it("keeps lineage optional for first-attempt writer contexts", () => {
    expect(ComparisonDraftWriterContextSchema.parse(base)).not.toHaveProperty(
      "priorAuthorizationId"
    );
  });
});
