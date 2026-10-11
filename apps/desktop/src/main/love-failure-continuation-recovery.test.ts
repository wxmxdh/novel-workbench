import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  recoverLoveFailureContinuation,
  type LoveFailureContinuationMessage
} from "./love-failure-continuation-recovery";
import { comparisonWritingIntent } from "./comparison-writing-intent";
import { loveFailureContinuationIntent } from "./love-workflow-intent";

const runtime = {
  mode: "provider" as const,
  provider: "openai",
  model: "gpt-6.1-sol",
  configId: "model-config-1"
};
const originalText = "请写第1章正文。";
const originalQuote = originalText;
const retryText = "重试第1章失败的两份独立稿，保留成功稿，不要重写其他稿。";
const retryQuote = "重试第1章失败的两份独立稿";
const originalAuthorizationId = "authorization-original-001";
const originalHash = hash(originalText);

function hash(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

function prepEvidence(
  definitionId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    version: 1,
    bookId: "longbook_9a146bbe",
    authorizationId: originalAuthorizationId,
    chapter: 1,
    chapterCardId: "chapter-card-1",
    chapterCardSha256: "a".repeat(64),
    volumeId: "volume-1",
    volumeSha256: "b".repeat(64),
    sourceMode: "independent",
    definitionId,
    runtime,
    authorRequestId: "author-request-original",
    authorTextSha256: originalHash,
    authorRequestQuote: originalQuote,
    ...overrides
  };
}

function deliveryEvidence(
  definitionId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    version: 1,
    bookId: "longbook_9a146bbe",
    authorizationId: originalAuthorizationId,
    definitionId,
    runtime,
    path: `004_写作中/${definitionId}.md`,
    sha256: "c".repeat(64),
    model: runtime.model,
    status: "待审阅",
    deliveryRecord: `004_写作中/records/${definitionId}.json`,
    ...overrides
  };
}

function tool(
  name: string,
  summary?: unknown,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `${name}-call`,
    name,
    status: "completed",
    isError: false,
    requestedAt: "2026-10-06T00:00:00.000Z",
    resultSummary:
      summary === undefined
        ? "tool completed"
        : typeof summary === "string"
          ? summary
          : `${name === "prepare_comparison_draft" ? "【LOVE对照稿恢复证据 v1】" : "【LOVE对照稿交付证据 v1】"}${JSON.stringify(summary)}`,
    ...overrides
  };
}

function writer(
  definitionId: string,
  status: string,
  toolCalls: unknown[],
  runtimeValue: unknown = runtime
) {
  return {
    subagentId: definitionId,
    subagentRunId: `run-${definitionId}`,
    name: definitionId,
    status,
    runtime: runtimeValue,
    toolCalls,
    startedAt: "2026-10-06T00:00:00.000Z"
  };
}

function assistant(
  subagentRuns: unknown[],
  overrides: Record<string, unknown> = {}
) {
  return {
    role: "assistant",
    content: "两份稿件处理结束。",
    status: "completed",
    runId: "main-run",
    toolCalls: [],
    subagentRuns,
    ...overrides
  };
}

function message(position: number, value: Record<string, unknown>) {
  return { position, value };
}

function initialMessages(runs: unknown[]): LoveFailureContinuationMessage[] {
  return [
    message(0, { role: "user", content: originalText }),
    message(1, assistant(runs))
  ];
}

function failedWriter(definitionId = "love-writer-openai") {
  return writer(definitionId, "error", [
    tool("prepare_comparison_draft", prepEvidence(definitionId))
  ]);
}

describe("recoverLoveFailureContinuation", () => {
  it("recovers a completed writer that prepared but never delivered", () => {
    const result = recoverLoveFailureContinuation(
      initialMessages([
        writer("love-writer-openai", "completed", [
          tool("prepare_comparison_draft", prepEvidence("love-writer-openai"))
        ])
      ]),
      { chapter: 1, quote: "继续失败的一份稿" }
    );

    expect(result).toMatchObject({
      chapter: 1,
      authorizationId: originalAuthorizationId,
      priorAuthorTextSha256: originalHash,
      writers: [{ definitionId: "love-writer-openai", runtime }]
    });
  });

  it("does not recover a completed writer with no prepare evidence", () => {
    expect(
      recoverLoveFailureContinuation(
        initialMessages([writer("love-writer-openai", "completed", [])]),
        { chapter: 1, quote: "继续失败的一份稿" }
      )
    ).toBeUndefined();
  });

  it("protects a valid saved artifact even when its writer later errors", () => {
    const id = "love-writer-openai";
    const runs = [
      writer(id, "error", [
        tool("prepare_comparison_draft", prepEvidence(id)),
        tool("deliver_comparison_draft", deliveryEvidence(id))
      ])
    ];
    expect(
      recoverLoveFailureContinuation(initialMessages(runs), {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();
  });

  it("returns only the undelivered child, not a delivered sibling", () => {
    const deliveredId = "love-writer-openai";
    const failedId = "love-writer-anthropic";
    const result = recoverLoveFailureContinuation(
      initialMessages([
        writer(deliveredId, "error", [
          tool("prepare_comparison_draft", prepEvidence(deliveredId)),
          tool("deliver_comparison_draft", deliveryEvidence(deliveredId))
        ]),
        failedWriter(failedId)
      ]),
      { chapter: 1, writerCount: 1, quote: "继续失败的一份稿" }
    );
    expect(result?.writers.map(({ definitionId }) => definitionId)).toEqual([
      failedId
    ]);
  });

  it("requires chapter and explicit writer count to match the verified failures", () => {
    const messages = initialMessages([failedWriter()]);
    expect(
      recoverLoveFailureContinuation(messages, {
        chapter: 2,
        quote: "继续第一章失败的一份稿"
      })
    ).toBeUndefined();
    expect(
      recoverLoveFailureContinuation(messages, {
        chapter: 1,
        writerCount: 2,
        quote: "继续第一章失败的两份稿"
      })
    ).toBeUndefined();
  });

  it("rejects evidence whose runtime or author quote does not bind to the task", () => {
    const id = "love-writer-openai";
    const wrongRuntime = { ...runtime, configId: "another-config" };
    const badRuns = [
      writer(
        id,
        "error",
        [tool("prepare_comparison_draft", prepEvidence(id))],
        wrongRuntime
      )
    ];
    expect(
      recoverLoveFailureContinuation(initialMessages(badRuns), {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();

    const badQuote = [
      writer(id, "error", [
        tool(
          "prepare_comparison_draft",
          prepEvidence(id, { authorRequestQuote: "请写第2章正文。" })
        )
      ])
    ];
    expect(
      recoverLoveFailureContinuation(initialMessages(badQuote), {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();
  });

  it("rejects a prepare marker attached to an errored or unfinished tool call", () => {
    const id = "love-writer-openai";
    const runs = [
      writer(id, "error", [
        tool("prepare_comparison_draft", prepEvidence(id), {
          status: "error",
          isError: true
        })
      ])
    ];
    expect(
      recoverLoveFailureContinuation(initialMessages(runs), {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();
  });

  it("does not trust a parent summary or bridge across nonadjacent messages", () => {
    const parentOnly = [
      message(0, { role: "user", content: originalText }),
      message(1, {
        ...assistant([]),
        content: "所有写手都失败了，请重试。"
      })
    ];
    expect(
      recoverLoveFailureContinuation(parentOnly, {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();

    const nonadjacent = [
      message(0, { role: "user", content: originalText }),
      message(1, { role: "system", content: "intervening" }),
      message(2, assistant([failedWriter()]))
    ];
    expect(
      recoverLoveFailureContinuation(nonadjacent, {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();
  });

  it("a newer writing authorization or revocation prevents fallback to an old failure", () => {
    const old = initialMessages([failedWriter()]);
    const newerAuth = [
      ...old,
      message(2, { role: "user", content: "请写第2章正文。" }),
      message(3, assistant([]))
    ];
    expect(
      recoverLoveFailureContinuation(newerAuth, {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();

    const revoked = [
      ...old,
      message(2, { role: "user", content: "撤销第1章写作任务授权。" }),
      message(3, assistant([]))
    ];
    expect(
      recoverLoveFailureContinuation(revoked, {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();
  });

  it("follows only the newest same-source retry, including a second retry", () => {
    expect(comparisonWritingIntent(retryText)).toBeDefined();
    expect(loveFailureContinuationIntent(retryText)).toBeDefined();

    const firstId = "love-writer-openai";
    const secondId = "love-writer-anthropic";
    const firstRuns = [failedWriter(firstId), failedWriter(secondId)];
    const firstRetryAuthId = "authorization-retry-0001";
    const firstRetryEvidence = (definitionId: string) =>
      prepEvidence(definitionId, {
        authorizationId: firstRetryAuthId,
        authorRequestId: "author-request-retry-1",
        authorTextSha256: hash(retryText),
        authorRequestQuote: retryQuote,
        priorAuthorizationId: originalAuthorizationId,
        priorAuthorTextSha256: originalHash
      });
    const retryRuns = [
      writer(firstId, "error", [
        tool("prepare_comparison_draft", firstRetryEvidence(firstId)),
        tool(
          "deliver_comparison_draft",
          deliveryEvidence(firstId, {
            authorizationId: firstRetryAuthId
          })
        )
      ]),
      writer(secondId, "error", [
        tool("prepare_comparison_draft", firstRetryEvidence(secondId))
      ])
    ];
    const retryMessages = [
      ...initialMessages(firstRuns),
      message(2, { role: "user", content: retryText }),
      message(3, assistant(retryRuns))
    ];
    const next = recoverLoveFailureContinuation(retryMessages, {
      chapter: 1,
      writerCount: 1,
      quote: "继续失败的一份稿"
    });
    expect(next).toMatchObject({
      authorizationId: originalAuthorizationId,
      priorAuthorTextSha256: originalHash,
      writers: [{ definitionId: secondId, runtime }]
    });

    const secondRetryText =
      "重试第1章失败的一份独立稿，保留成功稿，不要重写其他稿。";
    const secondRetryQuote = "重试第1章失败的一份独立稿";
    const secondRetryAuthId = "authorization-retry-0002";
    const secondRetryEvidence = prepEvidence(secondId, {
      authorizationId: secondRetryAuthId,
      authorRequestId: "author-request-retry-2",
      authorTextSha256: hash(secondRetryText),
      authorRequestQuote: secondRetryQuote,
      priorAuthorizationId: originalAuthorizationId,
      priorAuthorTextSha256: originalHash
    });
    const chained = [
      ...retryMessages,
      message(4, { role: "user", content: secondRetryText }),
      message(
        5,
        assistant([
          writer(secondId, "error", [
            tool("prepare_comparison_draft", secondRetryEvidence)
          ])
        ])
      )
    ];
    expect(
      recoverLoveFailureContinuation(chained, {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toMatchObject({
      authorizationId: originalAuthorizationId,
      priorAuthorTextSha256: originalHash,
      writers: [{ definitionId: secondId, runtime }]
    });

    const secondRetryWithSavedArtifact = [
      ...retryMessages,
      message(4, { role: "user", content: secondRetryText }),
      message(
        5,
        assistant([
          writer(secondId, "error", [
            tool("prepare_comparison_draft", secondRetryEvidence),
            tool(
              "deliver_comparison_draft",
              deliveryEvidence(secondId, {
                authorizationId: secondRetryAuthId
              })
            )
          ])
        ])
      )
    ];
    expect(
      recoverLoveFailureContinuation(secondRetryWithSavedArtifact, {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();
  });

  it("rejects a retry without Main-verified lineage to the original authorization", () => {
    const retryId = "authorization-retry-0001";
    const retryEvidence = prepEvidence("love-writer-openai", {
      authorizationId: retryId,
      authorRequestId: "author-request-retry",
      authorTextSha256: hash(retryText),
      authorRequestQuote: retryQuote
    });
    expect(
      recoverLoveFailureContinuation(
        [
          ...initialMessages([failedWriter()]),
          message(2, { role: "user", content: retryText }),
          message(
            3,
            assistant([
              writer("love-writer-openai", "error", [
                tool("prepare_comparison_draft", retryEvidence)
              ])
            ])
          )
        ],
        { chapter: 1, quote: "继续失败的一份稿" }
      )
    ).toBeUndefined();

    const partialLineage = prepEvidence("love-writer-openai", {
      authorizationId: retryId,
      authorRequestId: "author-request-retry",
      authorTextSha256: hash(retryText),
      authorRequestQuote: retryQuote,
      priorAuthorizationId: originalAuthorizationId
    });
    expect(
      recoverLoveFailureContinuation(
        [
          ...initialMessages([failedWriter()]),
          message(2, { role: "user", content: retryText }),
          message(
            3,
            assistant([
              writer("love-writer-openai", "error", [
                tool("prepare_comparison_draft", partialLineage)
              ])
            ])
          )
        ],
        { chapter: 1, quote: "继续失败的一份稿" }
      )
    ).toBeUndefined();
  });

  it("treats an explicit retry without failure wording as a new authorization", () => {
    const newAuthorizationText = "重试第1章的两份独立稿";
    const newAuthorizationQuote = "重试第1章的两份独立稿";
    expect(loveFailureContinuationIntent(newAuthorizationText)).toBeUndefined();
    expect(comparisonWritingIntent(newAuthorizationText)).toBeDefined();

    const newAuthorizationId = "authorization-new-retry-0001";
    const newAuthorizationHash = hash(newAuthorizationText);
    const newAttemptEvidence = prepEvidence("love-writer-openai", {
      authorizationId: newAuthorizationId,
      authorRequestId: "author-request-new-retry",
      authorTextSha256: newAuthorizationHash,
      authorRequestQuote: newAuthorizationQuote
    });
    const continuationText = "继续第1章失败的一份稿";
    const continuationEvidence = prepEvidence("love-writer-openai", {
      authorizationId: "authorization-new-retry-child-0001",
      authorRequestId: "author-request-new-retry-child",
      authorTextSha256: hash(continuationText),
      authorRequestQuote: continuationText,
      priorAuthorizationId: newAuthorizationId,
      priorAuthorTextSha256: newAuthorizationHash
    });
    const messages = [
      ...initialMessages([failedWriter()]),
      message(2, { role: "user", content: newAuthorizationText }),
      message(
        3,
        assistant([
          writer("love-writer-openai", "error", [
            tool("prepare_comparison_draft", newAttemptEvidence)
          ])
        ])
      ),
      message(4, { role: "user", content: continuationText }),
      message(
        5,
        assistant([
          writer("love-writer-openai", "error", [
            tool("prepare_comparison_draft", continuationEvidence)
          ])
        ])
      )
    ];

    expect(
      recoverLoveFailureContinuation(messages, {
        chapter: 1,
        quote: continuationText
      })
    ).toMatchObject({
      authorizationId: newAuthorizationId,
      priorAuthorTextSha256: newAuthorizationHash,
      writers: [{ definitionId: "love-writer-openai", runtime }]
    });
  });

  it("rejects delivery markers with unsafe paths or contradictory tool state", () => {
    const id = "love-writer-openai";
    const invalid = [
      writer(id, "error", [
        tool("prepare_comparison_draft", prepEvidence(id)),
        tool(
          "deliver_comparison_draft",
          deliveryEvidence(id, { path: "../outside.md" })
        )
      ])
    ];
    expect(
      recoverLoveFailureContinuation(initialMessages(invalid), {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();

    const contradictory = [
      writer(id, "error", [
        tool("prepare_comparison_draft", prepEvidence(id)),
        tool("deliver_comparison_draft", undefined, {
          status: "completed",
          isError: true
        })
      ])
    ];
    expect(
      recoverLoveFailureContinuation(initialMessages(contradictory), {
        chapter: 1,
        quote: "继续失败的一份稿"
      })
    ).toBeUndefined();
  });
});
