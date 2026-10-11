import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope
} from "@deepwrite/contracts";
import {
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "./supervisor";

const bookId = "longbook_9a146bbe",
  runId = "run-workflow",
  sessionId = "session-workflow",
  parent = "prompt-workflow";
function command(type: string, payload: unknown): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, {
      id: "workflow-command",
      context: { runId, sessionId, resourceId: bookId }
    })
  );
}
function authorize(command: CommandEnvelope, authorText: string) {
  const active: MainInternalCommandActiveRun = {
    sessionId,
    resourceId: bookId,
    promptRequestId: parent,
    accepted: true,
    reviewAuthorText: authorText,
    comparisonDraftWriterContext: {
      authorizationId: "authorization-1234567890",
      bookId,
      chapter: 2,
      chapterCardId: "chapter-2",
      writers: [
        {
          definitionId: "love-writer-main-revision",
          runtime: {
            mode: "provider",
            provider: "openai",
            model: "gpt-6.1-sol",
            configId: "model-current"
          }
        }
      ],
      authorRequest: {
        requestId: parent,
        exactText: authorText,
        authorizationQuote: authorText,
        receivedAt: "2026-10-05T00:00:00Z"
      }
    }
  };
  const context: UtilityInternalCommandAuthorizationContext = {
    source: "agent",
    target: "core",
    message: {
      kind: "utility.internal.command.request",
      worker: "agent",
      target: "core",
      requestId: "request",
      parentRequestId: parent,
      timeoutMs: 60_000,
      command
    }
  };
  return authorizeMainInternalCommand(context, new Map([[runId, active]]));
}

describe("LOVE workflow Main admission", () => {
  it("permits read preparation without prose authorization", () => {
    expect(
      authorize(
        command("long.loveChapterWorkflow", {
          bookId,
          action: "prepare",
          chapter: 2,
          volume: "第一卷"
        }),
        "讨论第二章大纲"
      )
    ).toBe(true);
  });
  it("binds selection to actual current author evidence", () => {
    const text = "就用这份稿作为第二章底稿";
    const payload = {
      bookId,
      action: "select_draft",
      chapter: 2,
      volume: "第一卷",
      draftPath: "004_写作中/test.md",
      authorActionEvidence: { requestId: runId, quote: text }
    };
    expect(authorize(command("long.loveChapterWorkflow", payload), text)).toBe(
      true
    );
    expect(
      authorize(
        command("long.loveChapterWorkflow", payload),
        "讨论一下如何选择底稿"
      )
    ).not.toBe(true);
    expect(
      authorize(
        command("long.loveChapterWorkflow", {
          ...payload,
          authorActionEvidence: { requestId: "old-run", quote: text }
        }),
        text
      )
    ).not.toBe(true);
  });
  it("does not accept a model-created author quote or wrong model identity for patch delivery", () => {
    const text = "按批注修改第二章正文";
    const payload = {
      bookId,
      authorizationId: "authorization-1234567890",
      revisionPreparationId: "revision-1234567890",
      action: "deliver",
      patches: [{ oldText: "旧句", newText: "新句", reason: "作者批注" }],
      authorRevisionEvidence: {
        path: ".novel/author-requests/current.md",
        sha256: "a".repeat(64),
        quote: text
      },
      runtime: {
        mode: "provider",
        provider: "openai",
        model: "gpt-6.1-sol",
        configId: "model-current"
      }
    };
    expect(
      authorize(command("long.applyLoveLocalRevision", payload), text)
    ).toBe(true);
    expect(
      authorize(
        command("long.applyLoveLocalRevision", payload),
        "审阅第二章并给修改建议"
      )
    ).not.toBe(true);
    expect(
      authorize(
        command("long.applyLoveLocalRevision", {
          ...payload,
          runtime: { ...payload.runtime, model: "invented-model" }
        }),
        text
      )
    ).not.toBe(true);
  });
});
