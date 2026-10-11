import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type ComparisonDraftWriterContext,
  type UtilityInternalCommandRequestMessage
} from "@deepwrite/contracts";
import {
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "./supervisor";
import { isForbiddenRendererCommand } from "./ipc/forbidden-commands";

const RUN_ID = "run-love-chapter-7";
const SESSION_ID = "session-love";
const PROMPT_ID = "prompt-love-chapter-7";
const BOOK_ID = "longbook_9a146bbe";
const AUTH_ID = "authorization-love-0001";
const CHAPTER_ID = "chapter_00000000000000000000000001";
const WRITER_ID = "love-writer-sonnet";
const RUNTIME = {
  provider: "anthropic",
  model: "claude-sonnet-4",
  mode: "provider" as const,
  configId: "runtime-sonnet"
};
const AUTHOR_REQUEST = {
  requestId: "author-request-7",
  exactText: "请写第七章，按已选大纲完成独立稿。",
  authorizationQuote: "请写第七章",
  receivedAt: "2026-10-04T10:00:00.000Z"
};

const capability: ComparisonDraftWriterContext = {
  authorizationId: AUTH_ID,
  bookId: BOOK_ID,
  chapter: 7,
  chapterCardId: CHAPTER_ID,
  writers: [{ definitionId: WRITER_ID, runtime: RUNTIME }],
  authorRequest: AUTHOR_REQUEST
};

function runs(
  overrides: Partial<MainInternalCommandActiveRun> = {},
  withCapability = true
) {
  return new Map<string, MainInternalCommandActiveRun>([
    [
      RUN_ID,
      {
        sessionId: SESSION_ID,
        resourceId: BOOK_ID,
        promptRequestId: PROMPT_ID,
        accepted: true,
        ...(withCapability ? { comparisonDraftWriterContext: capability } : {}),
        ...overrides
      }
    ]
  ]);
}

function envelope(
  type: "long.prepareComparisonDraft" | "long.deliverComparisonDraft",
  payload: unknown,
  overrides: {
    runId?: string;
    sessionId?: string;
    chapter?: number;
    chapterCardId?: string;
  } = {}
): CommandEnvelope {
  const commandPayload =
    type === "long.prepareComparisonDraft"
      ? {
          bookId: BOOK_ID,
          authorizationId: AUTH_ID,
          chapter: overrides.chapter ?? 7,
          chapterCardId: overrides.chapterCardId ?? CHAPTER_ID,
          authorRequestId: AUTHOR_REQUEST.requestId,
          authorRequest: AUTHOR_REQUEST,
          chapterCardSha256: "a".repeat(64),
          volumeId: "volume_00000000000000000000000001",
          volumeSha256: "b".repeat(64),
          ...(payload as object)
        }
      : {
          bookId: BOOK_ID,
          authorizationId: AUTH_ID,
          preparationId: "preparation-love-0001",
          definitionId: WRITER_ID,
          runtime: RUNTIME,
          content: "独立正文稿",
          ...(payload as object)
        };
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, commandPayload, {
      id: `cmd-${type}`,
      context: {
        sessionId: overrides.sessionId ?? SESSION_ID,
        runId: overrides.runId ?? RUN_ID,
        resourceId: BOOK_ID
      }
    })
  );
}

function bridge(
  command: CommandEnvelope,
  parentRequestId = PROMPT_ID
): UtilityInternalCommandAuthorizationContext {
  const message: UtilityInternalCommandRequestMessage = {
    kind: "utility.internal.command.request",
    worker: "agent",
    target: "core",
    requestId: `bridge-${command.id}`,
    parentRequestId,
    timeoutMs: 60_000,
    command
  };
  return { source: "agent", target: "core", message };
}

describe("Main authorization for comparison draft commands", () => {
  it("keeps prepare and delivery inaccessible to direct renderer dispatch", () => {
    expect(isForbiddenRendererCommand("long.prepareComparisonDraft")).toBe(
      true
    );
    expect(isForbiddenRendererCommand("long.deliverComparisonDraft")).toBe(
      true
    );
  });

  it("allows prepare only with the exact author request capability", () => {
    const cmd = envelope("long.prepareComparisonDraft", {});
    expect(authorizeMainInternalCommand(bridge(cmd), runs())).toBe(true);
    const altered = envelope("long.prepareComparisonDraft", {
      authorRequest: { ...AUTHOR_REQUEST, exactText: "请写第八章" }
    });
    expect(authorizeMainInternalCommand(bridge(altered), runs())).toMatchObject(
      {
        authorized: false,
        code: "main.comparison_draft_not_authorized"
      }
    );
    expect(
      authorizeMainInternalCommand(bridge(cmd), runs({}, false))
    ).toMatchObject({
      authorized: false,
      code: "main.comparison_draft_not_authorized"
    });
  });

  it("locks recovered prepare to the chapter and volume fingerprint accepted by Main", () => {
    const recoveredCapability: ComparisonDraftWriterContext = {
      ...capability,
      priorAuthorizationId: "authorization-prior-0001",
      priorAuthorTextSha256: "c".repeat(64)
    };
    const fingerprint = {
      chapterCardSha256: "a".repeat(64),
      volumeId: "volume_00000000000000000000000001",
      volumeSha256: "b".repeat(64)
    };
    const recoveredRun = runs({
      comparisonDraftWriterContext: recoveredCapability,
      comparisonDraftSourceFingerprint: fingerprint
    });
    const prepare = envelope("long.prepareComparisonDraft", {});
    expect(authorizeMainInternalCommand(bridge(prepare), recoveredRun)).toBe(
      true
    );

    for (const changed of [
      { chapterCardSha256: "d".repeat(64) },
      { volumeId: "volume_00000000000000000000000002" },
      { volumeSha256: "e".repeat(64) }
    ]) {
      expect(
        authorizeMainInternalCommand(
          bridge(envelope("long.prepareComparisonDraft", changed)),
          recoveredRun
        )
      ).toMatchObject({
        authorized: false,
        code: "main.comparison_draft_source_changed",
        message:
          "本轮章节或卷次资料已变化，请先重新核对当前材料；未重写已保存稿。"
      });
    }

    expect(
      authorizeMainInternalCommand(
        bridge(prepare),
        runs({ comparisonDraftWriterContext: recoveredCapability })
      )
    ).toMatchObject({
      authorized: false,
      code: "main.comparison_draft_source_changed"
    });
  });

  it("gives ordinary missing-capability failures an actionable Chinese response", () => {
    expect(
      authorizeMainInternalCommand(
        bridge(envelope("long.prepareComparisonDraft", {})),
        runs({}, false)
      )
    ).toMatchObject({
      authorized: false,
      code: "main.comparison_draft_not_authorized",
      message: "本轮没有可执行的指定稿件任务，请说明缺失目标；讨论仍可继续。"
    });
  });

  it("rejects a different chapter, chapter card, run, session, or prompt", () => {
    const otherChapter = envelope(
      "long.prepareComparisonDraft",
      {},
      { chapter: 8 }
    );
    expect(
      authorizeMainInternalCommand(bridge(otherChapter), runs())
    ).toMatchObject({ authorized: false });
    const otherCard = envelope(
      "long.prepareComparisonDraft",
      {},
      { chapterCardId: "chapter_00000000000000000000000002" }
    );
    expect(
      authorizeMainInternalCommand(bridge(otherCard), runs())
    ).toMatchObject({ authorized: false });
    const otherRun = envelope(
      "long.prepareComparisonDraft",
      {},
      { runId: "run-other" }
    );
    expect(
      authorizeMainInternalCommand(bridge(otherRun), runs())
    ).toMatchObject({ authorized: false });
    const otherSession = envelope(
      "long.prepareComparisonDraft",
      {},
      { sessionId: "session-other" }
    );
    expect(
      authorizeMainInternalCommand(bridge(otherSession), runs())
    ).toMatchObject({ authorized: false });
    expect(
      authorizeMainInternalCommand(
        bridge(envelope("long.prepareComparisonDraft", {}), "prompt-other"),
        runs()
      )
    ).toMatchObject({ authorized: false });
  });

  it("allows delivery only for the capability's exact writer and resolved runtime", () => {
    const cmd = envelope("long.deliverComparisonDraft", {});
    expect(authorizeMainInternalCommand(bridge(cmd), runs())).toBe(true);
    for (const changed of [
      { definitionId: "love-writer-other" },
      { runtime: { ...RUNTIME, provider: "openai" } },
      { runtime: { ...RUNTIME, model: "gpt-6.1-sol" } },
      { runtime: { ...RUNTIME, configId: "runtime-other" } },
      { runtime: { ...RUNTIME, mode: "local-faux" } }
    ]) {
      const forged = envelope("long.deliverComparisonDraft", changed);
      expect(
        authorizeMainInternalCommand(bridge(forged), runs())
      ).toMatchObject({
        authorized: false,
        code: "main.comparison_draft_not_authorized"
      });
    }
  });
});
