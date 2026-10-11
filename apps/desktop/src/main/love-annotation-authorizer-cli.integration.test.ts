import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type LongLoveChapterWorkflowCommandInput,
  type UtilityInternalCommandRequestMessage
} from "@deepwrite/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../utilities/novel-writing-store", () => ({
  requireProject: vi.fn()
}));

import { requireProject } from "../utilities/novel-writing-store";
import { runLoveChapterWorkflowCore } from "../utilities/love-chapter-workflow-core";
import { authorizeMainInternalCommand } from "./internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "./supervisor";

const BOOK_ID = "longbook_9a146bbe";
const SESSION_ID = "love-annotation-session";
const RUN_ID = "love-annotation-run";
const PROMPT_REQUEST_ID = "love-annotation-prompt";
const roots: string[] = [];

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "love-annotation-cli-test-"));
  roots.push(root);
  const draftPath = "drafts/ch1.md";
  const draftText = "第一处原句。第二处原句。";
  const firstQuote = "第一处原句。";
  const secondQuote = "第二处原句。";
  const firstStart = draftText.indexOf(firstQuote);
  const secondStart = draftText.indexOf(secondQuote);
  const draftHash = sha(draftText);
  const notePath = "006_批注/批注.json";
  const note = {
    schema: 1,
    items: [
      {
        id: "annotation-1",
        fileRelative: draftPath,
        sourceHash: draftHash,
        start: firstStart,
        end: firstStart + firstQuote.length,
        quote: firstQuote,
        authorText: "补足此处的动作细节。",
        comment: "补足此处的动作细节。",
        updated: "2026-10-06T00:00:00.000Z",
        status: "待讨论"
      },
      {
        id: "annotation-2",
        fileRelative: draftPath,
        sourceHash: draftHash,
        start: secondStart,
        end: secondStart + secondQuote.length,
        quote: secondQuote,
        authorText: "压缩此处的重复表达。",
        comment: "压缩此处的重复表达。",
        updated: "2026-10-06T00:00:00.000Z",
        status: "待讨论"
      }
    ]
  };
  mkdirSync(join(root, "drafts"), { recursive: true });
  mkdirSync(join(root, "006_批注"), { recursive: true });
  mkdirSync(join(root, ".novel/workflow"), { recursive: true });
  writeFileSync(join(root, draftPath), draftText, "utf8");
  writeFileSync(join(root, notePath), JSON.stringify(note), "utf8");
  writeFileSync(
    join(root, ".novel/workflow/chapter-workflow.json"),
    JSON.stringify({
      schema: "love-chapter-workflow/v1",
      project: "LOVE",
      updatedAt: "2026-10-06T00:00:00.000Z",
      chapters: {
        "第一卷::1": {
          chapter: 1,
          volume: "第一卷",
          selection: {
            path: draftPath,
            hash: draftHash,
            status: "selected"
          }
        }
      }
    }),
    "utf8"
  );
  vi.mocked(requireProject).mockResolvedValue({
    project: { projectRoot: root }
  } as never);
  return root;
}

function command(authorText: string, annotationItemIds: string[]) {
  return CommandEnvelopeSchema.parse(
    createEnvelope(
      "long.loveChapterWorkflow",
      {
        bookId: BOOK_ID,
        action: "attach_notes",
        chapter: 1,
        volume: "第一卷",
        notePaths: ["006_批注/批注.json"],
        annotationItemIds,
        authorActionEvidence: { requestId: RUN_ID, quote: authorText }
      },
      {
        id: "love-annotation-workflow",
        context: {
          sessionId: SESSION_ID,
          runId: RUN_ID,
          resourceId: BOOK_ID
        }
      }
    )
  );
}

function authorize(envelope: CommandEnvelope, authorText: string) {
  const message: UtilityInternalCommandRequestMessage = {
    kind: "utility.internal.command.request",
    worker: "agent",
    target: "core",
    requestId: "love-annotation-bridge",
    parentRequestId: PROMPT_REQUEST_ID,
    timeoutMs: 60_000,
    command: envelope
  };
  const context: UtilityInternalCommandAuthorizationContext = {
    source: "agent",
    target: "core",
    message
  };
  return authorizeMainInternalCommand(
    context,
    new Map([
      [
        RUN_ID,
        {
          sessionId: SESSION_ID,
          resourceId: BOOK_ID,
          promptRequestId: PROMPT_REQUEST_ID,
          accepted: true,
          reviewAuthorText: authorText
        }
      ]
    ])
  );
}

async function runCli(envelope: CommandEnvelope) {
  return (await runLoveChapterWorkflowCore(
    "isolated-user-data",
    envelope.payload as LongLoveChapterWorkflowCommandInput
  )) as {
    ok: boolean;
    noteAdoption: {
      state: string;
      annotationItemIds: string[];
      ordinalMapping?: { ordinals: number[] };
    };
  };
}

afterEach(async () => {
  const tempRoot = await realpath(tmpdir());
  for (const created of roots.splice(0)) {
    const target = await realpath(created);
    const parent = await realpath(dirname(target));
    const rel = relative(tempRoot, target);
    if (
      parent.toLocaleLowerCase("en-US") !==
        tempRoot.toLocaleLowerCase("en-US") ||
      !rel ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel) ||
      rel.includes(sep)
    )
      throw new Error("Test fixture cleanup escaped the OS temp directory.");
    rmSync(target, { recursive: true, force: true });
  }
  vi.mocked(requireProject).mockReset();
});

describe("LOVE annotation authorizer to CLI path", () => {
  it("accepts ordinal adoption without requiring the word annotation and maps only those IDs", async () => {
    fixture();
    const authorText = "采用第1、第2条";
    const envelope = command(authorText, ["annotation-1", "annotation-2"]);
    expect(authorize(envelope, authorText)).toBe(true);

    const result = await runCli(envelope);
    expect(result.ok).toBe(true);
    expect(result.noteAdoption).toMatchObject({
      state: "adopted",
      annotationItemIds: ["annotation-1", "annotation-2"],
      ordinalMapping: { ordinals: [1, 2] }
    });
  });

  it("does not let model-located IDs broaden a one-item author selection", async () => {
    fixture();
    const authorText = "采用第1条";
    const envelope = command(authorText, ["annotation-1", "annotation-2"]);
    expect(authorize(envelope, authorText)).toBe(true);
    await expect(runCli(envelope)).rejects.toThrow(
      "模型定位的批注 ID 与作者原话中的条目序号不一致"
    );
  });
});
