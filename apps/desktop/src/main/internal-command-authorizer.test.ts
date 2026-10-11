import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type UtilityInternalCommandRequestMessage
} from "@deepwrite/contracts";
import {
  AGENT_CORE_LONG_QUERY_COMMANDS,
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "./supervisor";

const RUN_ID = "run-long-authorized";
const SESSION_ID = "session-long-authorized";
const BOOK_ID = "longbook_authorized";
const PROMPT_REQUEST_ID = "command-session-prompt";

function queryCommand(
  type: (typeof AGENT_CORE_LONG_QUERY_COMMANDS)[number],
  overrides: {
    runId?: string;
    sessionId?: string;
    resourceId?: string;
    bookId?: string;
  } = {}
): CommandEnvelope {
  const bookId = overrides.bookId ?? BOOK_ID;
  const payload =
    type === "long.getWorkspaceIndex"
      ? { bookId }
      : type === "long.querySourceFolder"
        ? { bookId, sourceId: "folder_allowed", query: "人物" }
        : type === "long.readDocument"
          ? {
              bookId,
              fileId: "file_world_rules:content",
              offset: 0,
              maxCharacters: 100
            }
          : {
              bookId,
              query: "规则",
              scope: "worldbuilding" as const,
              limit: 20,
              maxSnippetCharacters: 320
            };
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, {
      id: `query-${type}`,
      context: {
        sessionId: overrides.sessionId ?? SESSION_ID,
        runId: overrides.runId ?? RUN_ID,
        resourceId: overrides.resourceId ?? BOOK_ID
      }
    })
  );
}

function authorizationContext(
  command: CommandEnvelope,
  overrides: Partial<
    Pick<UtilityInternalCommandAuthorizationContext, "source" | "target">
  > & {
    parentRequestId?: string;
  } = {}
): UtilityInternalCommandAuthorizationContext {
  const message: UtilityInternalCommandRequestMessage = {
    kind: "utility.internal.command.request",
    worker: "agent",
    target: overrides.target ?? "core",
    requestId: `bridge-${command.id}`,
    parentRequestId: overrides.parentRequestId ?? PROMPT_REQUEST_ID,
    timeoutMs: 60_000,
    command
  };
  return {
    source: overrides.source ?? "agent",
    target: overrides.target ?? "core",
    message
  };
}

function codexReviewCommand(bookId = "longbook_9a146bbe"): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(
      "long.prepareCodexReview",
      { bookId, scope: "当前会话" },
      {
        id: "codex-review-request",
        context: {
          sessionId: SESSION_ID,
          runId: RUN_ID,
          resourceId: bookId
        }
      }
    )
  );
}

function annotationWorkflowCommand(
  authorText: string,
  annotationItemIds: string[] = []
): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(
      "long.loveChapterWorkflow",
      {
        bookId: "longbook_9a146bbe",
        action: "attach_notes",
        chapter: 1,
        volume: "第一卷",
        notePaths: ["006_批注/第一章/批注汇总.md"],
        annotationItemIds,
        authorActionEvidence: {
          requestId: RUN_ID,
          quote: authorText.slice(0, 2_000)
        }
      },
      {
        id: "annotation-workflow-command",
        context: {
          sessionId: SESSION_ID,
          runId: RUN_ID,
          resourceId: "longbook_9a146bbe"
        }
      }
    )
  );
}

function acceptedRun(
  overrides: Partial<MainInternalCommandActiveRun> = {}
): Map<string, MainInternalCommandActiveRun> {
  return new Map([
    [
      RUN_ID,
      {
        sessionId: SESSION_ID,
        resourceId: BOOK_ID,
        promptRequestId: PROMPT_REQUEST_ID,
        accepted: true,
        ...overrides
      }
    ]
  ]);
}

describe("Main internal command authorizer", () => {
  it("allows background annotation context but requires adoption for selected item IDs", () => {
    const backgroundText = "请读取第一章批注，作为背景供我们讨论。";
    const run = acceptedRun({
      resourceId: "longbook_9a146bbe",
      reviewAuthorText: backgroundText
    });
    expect(
      authorizeMainInternalCommand(
        authorizationContext(annotationWorkflowCommand(backgroundText)),
        run
      )
    ).toBe(true);
    expect(
      authorizeMainInternalCommand(
        authorizationContext(
          annotationWorkflowCommand(backgroundText, ["item-1", "item-2"])
        ),
        run
      )
    ).toMatchObject({
      authorized: false,
      code: "main.workflow_action_not_authorized"
    });
  });

  it("allows selected IDs only when the current author explicitly adopts or executes annotation advice", () => {
    for (const authorText of [
      "按这两条批注修改第一章正文。",
      "采用这两条批注作为修订依据。"
    ]) {
      expect(
        authorizeMainInternalCommand(
          authorizationContext(
            annotationWorkflowCommand(authorText, ["item-1", "item-2"])
          ),
          acceptedRun({
            resourceId: "longbook_9a146bbe",
            reviewAuthorText: authorText
          })
        )
      ).toBe(true);
    }
    const ordinalText = "采用第1、第2条";
    expect(
      authorizeMainInternalCommand(
        authorizationContext(
          annotationWorkflowCommand(ordinalText, ["item-1", "item-2"])
        ),
        acceptedRun({
          resourceId: "longbook_9a146bbe",
          reviewAuthorText: ordinalText
        })
      )
    ).toBe(true);
    for (const otherTarget of ["采用第一条大纲", "采用第1条规则"]) {
      expect(
        authorizeMainInternalCommand(
          authorizationContext(
            annotationWorkflowCommand(otherTarget, ["item-1"])
          ),
          acceptedRun({
            resourceId: "longbook_9a146bbe",
            reviewAuthorText: otherTarget
          })
        )
      ).toMatchObject({
        authorized: false,
        code: "main.workflow_action_not_authorized"
      });
    }
  });

  it("binds review preparation to the accepted verbatim author message", () => {
    const make = (authorText: string) =>
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "long.prepareLoveReview",
          {
            bookId: "longbook_9a146bbe",
            reviewerIds: ["love-outline"],
            authorText,
            targetKind: "drafts"
          },
          {
            id: "review-command",
            context: {
              sessionId: SESSION_ID,
              runId: RUN_ID,
              resourceId: "longbook_9a146bbe"
            }
          }
        )
      );
    const runs = acceptedRun({
      resourceId: "longbook_9a146bbe",
      reviewAuthorText: "请审第一章"
    });
    expect(
      authorizeMainInternalCommand(
        authorizationContext(make("请审第一章")),
        runs
      )
    ).toBe(true);
    expect(
      authorizeMainInternalCommand(
        authorizationContext(make("主模型改写后的授权")),
        runs
      )
    ).toMatchObject({
      authorized: false,
      code: "main.review_author_text_mismatch"
    });
    expect(
      authorizeMainInternalCommand(
        authorizationContext(make("请审第一章"), {
          parentRequestId: "foreign"
        }),
        runs
      )
    ).toMatchObject({
      authorized: false,
      code: "main.parent_request_mismatch"
    });
  });
  it("authorizes the Codex review bridge only for an accepted LOVE run", () => {
    expect(
      authorizeMainInternalCommand(
        authorizationContext(codexReviewCommand()),
        acceptedRun({ resourceId: "longbook_9a146bbe" })
      )
    ).toBe(true);
    expect(
      authorizeMainInternalCommand(
        authorizationContext(codexReviewCommand("longbook_other")),
        acceptedRun({ resourceId: "longbook_other" })
      )
    ).toMatchObject({
      authorized: false,
      code: "main.codex_review_book_unavailable"
    });
  });

  it("allows only read-only long queries for the exact accepted run binding", () => {
    expect(AGENT_CORE_LONG_QUERY_COMMANDS).toEqual([
      "long.getWorkspaceIndex",
      "long.readDocument",
      "long.querySourceFolder",
      "long.search"
    ]);
    for (const type of AGENT_CORE_LONG_QUERY_COMMANDS) {
      expect(
        authorizeMainInternalCommand(
          authorizationContext(queryCommand(type)),
          acceptedRun()
        )
      ).toBe(true);
    }
  });

  it.each([
    {
      name: "unknown run",
      command: queryCommand("long.getWorkspaceIndex", {
        runId: "run-other"
      }),
      runs: acceptedRun(),
      code: "main.run_not_accepted"
    },
    {
      name: "unaccepted run",
      command: queryCommand("long.getWorkspaceIndex"),
      runs: acceptedRun({ accepted: false }),
      code: "main.run_not_accepted"
    },
    {
      name: "non-long run",
      command: queryCommand("long.getWorkspaceIndex"),
      runs: new Map([
        [
          RUN_ID,
          {
            sessionId: SESSION_ID,
            promptRequestId: PROMPT_REQUEST_ID,
            accepted: true
          }
        ]
      ]),
      code: "main.run_not_long_form"
    },
    {
      name: "session mismatch",
      command: queryCommand("long.getWorkspaceIndex", {
        sessionId: "session-other"
      }),
      runs: acceptedRun(),
      code: "main.session_mismatch"
    },
    {
      name: "resource mismatch",
      command: queryCommand("long.getWorkspaceIndex", {
        resourceId: "longbook_other"
      }),
      runs: acceptedRun(),
      code: "main.resource_mismatch"
    },
    {
      name: "payload book mismatch",
      command: queryCommand("long.getWorkspaceIndex", {
        bookId: "longbook_other"
      }),
      runs: acceptedRun(),
      code: "main.book_mismatch"
    }
  ])("rejects $name", ({ command, runs, code }) => {
    expect(
      authorizeMainInternalCommand(authorizationContext(command), runs)
    ).toMatchObject({
      authorized: false,
      code
    });
  });

  it("rejects commands detached from the accepted prompt request", () => {
    expect(
      authorizeMainInternalCommand(
        authorizationContext(queryCommand("long.search"), {
          parentRequestId: "command-other-prompt"
        }),
        acceptedRun()
      )
    ).toMatchObject({
      authorized: false,
      code: "main.parent_request_mismatch"
    });
  });

  it("rejects non-Agent routes and long mutation commands defensively", () => {
    expect(
      authorizeMainInternalCommand(
        authorizationContext(queryCommand("long.search"), {
          source: "tool"
        }),
        acceptedRun()
      )
    ).toMatchObject({
      authorized: false,
      code: "main.invalid_bridge_route"
    });

    const write = CommandEnvelopeSchema.parse(
      createEnvelope(
        "long.writeDocument",
        {
          bookId: BOOK_ID,
          fileId: "file_world_rules:content",
          content: "不得直写"
        },
        {
          id: "long-write-forbidden",
          context: {
            sessionId: SESSION_ID,
            runId: RUN_ID,
            resourceId: BOOK_ID
          }
        }
      )
    );
    expect(
      authorizeMainInternalCommand(authorizationContext(write), acceptedRun())
    ).toMatchObject({
      authorized: false,
      code: "main.command_not_long_query"
    });
  });
});
