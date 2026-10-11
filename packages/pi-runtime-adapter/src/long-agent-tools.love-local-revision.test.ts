import { createHash } from "node:crypto";
import type { ComparisonDraftWriterContext } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildLoveLocalRevisionTools } from "./long-agent-tools/tool-love-local-revision";

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const runtime = {
  provider: "test",
  model: "gpt-6.1-sol",
  mode: "provider" as const,
  configId: "model-test"
};
const source = "第一句。旧句。最后一句。";
const context: ComparisonDraftWriterContext = {
  bookId: "longbook_9a146bbe",
  chapter: 1,
  chapterCardId: "chapter_test",
  authorizationId: "authorization-test-0001",
  writers: [{ definitionId: "love-writer-main-revision", runtime }],
  authorRequest: {
    requestId: "author-request-test",
    exactText: "按批注只修改这一句。",
    authorizationQuote: "只修改这一句",
    receivedAt: "2026-10-05T00:00:00.000Z"
  }
};
const evidence = {
  path: ".novel/author-requests/authorization-test-0001.md",
  sha256: sha(context.authorRequest.exactText),
  quote: context.authorRequest.exactText
};

function text(result: { content: readonly unknown[] }): string {
  const block = result.content[0] as { text?: string } | undefined;
  if (!block?.text) throw new Error("Expected a text tool result.");
  return block.text;
}

function setup() {
  const executor = vi.fn(
    async (command: { type: string; payload: unknown }) => {
      if (command.type === "long.prepareLoveLocalRevision")
        return {
          status: "accepted" as const,
          requestId: "prepare-test",
          payload: {
            bookId: context.bookId,
            revisionPreparationId: "revision-preparation-0001",
            comparisonPreparationId: "comparison-preparation-0001",
            sourcePath: "004_写作中/第001章_正文草稿_gpt-6.1-sol.md",
            sourceSha256: sha(source),
            sourceContent: source,
            readContent: `V1 source\n${source}`,
            chapter: 1,
            volume: "第一卷",
            sourceModel: "gpt-6.1-sol",
            sourceTitle: "第一章",
            authorRevisionEvidence: evidence
          }
        };
      const payload = command.payload as { action: string };
      return {
        status: "accepted" as const,
        requestId: "apply-test",
        payload: {
          bookId: context.bookId,
          revisionPreparationId: "revision-preparation-0001",
          action: payload.action,
          sourcePath: "004_写作中/第001章_正文草稿_gpt-6.1-sol.md",
          sourceSha256: sha(source),
          previewContent: "第一句。新句。最后一句。",
          previewSha256: sha("第一句。新句。最后一句。"),
          patches: [
            { oldText: "旧句。", newText: "新句。", reason: "按批注补足动作" }
          ],
          writes: payload.action === "deliver" ? 1 : 0,
          ...(payload.action === "deliver"
            ? {
                path: "004_写作中/第001章_正文草稿_gpt-6.1-sol-修订01.md",
                deliveryRecord: ".novel/deliveries/test-delivery.json",
                outputSha256: sha("交付稿件"),
                model: runtime.model
              }
            : {})
        }
      };
    }
  );
  let compact = () => {};
  const tools = buildLoveLocalRevisionTools({
    context,
    runtime,
    sessionId: "session-test",
    runId: "run-test",
    executor,
    onContextCompacted: (listener) => {
      compact = listener;
    }
  });
  return {
    executor,
    prepare: tools.find(({ name }) => name === "prepare_love_local_revision")!,
    apply: tools.find(({ name }) => name === "apply_love_local_revision")!,
    compact: () => compact()
  };
}

describe("LOVE local revision tools", () => {
  it("reads the exact source and returns a no-write preview through Core", async () => {
    const test = setup();
    expect(
      text(
        await test.prepare.execute("prepare", {
          comparison_preparation_id: "comparison-preparation-0001",
          source_path: "004_写作中/第001章_正文草稿_gpt-6.1-sol.md",
          source_sha256: sha(source)
        } as never)
      )
    ).toContain(`V1 source\n${source}`);
    expect(
      text(
        await test.apply.execute("preview", {
          action: "preview",
          patches: [
            { oldText: "旧句。", newText: "新句。", reason: "按批注补足动作" }
          ]
        } as never)
      )
    ).toContain("没有写入文件");
    const applyCommand = test.executor.mock.calls[1]![0];
    expect(applyCommand.type).toBe("long.applyLoveLocalRevision");
    expect(applyCommand.payload).not.toHaveProperty("authorRevisionEvidence");
  });

  it("requires the same Core-returned author evidence for delivery", async () => {
    const test = setup();
    await test.prepare.execute("prepare", {
      comparison_preparation_id: "comparison-preparation-0001",
      source_path: "004_写作中/第001章_正文草稿_gpt-6.1-sol.md",
      source_sha256: sha(source)
    } as never);
    const result = await test.apply.execute("deliver", {
      action: "deliver",
      patches: [
        { oldText: "旧句。", newText: "新句。", reason: "按批注补足动作" }
      ]
    } as never);
    expect(text(result)).toContain("待审阅新稿");
    expect(test.executor.mock.calls[1]![0].payload).toMatchObject({
      action: "deliver",
      authorRevisionEvidence: evidence,
      runtime
    });
  });

  it("invalidates the bound source after context compaction", async () => {
    const test = setup();
    await test.prepare.execute("prepare", {
      comparison_preparation_id: "comparison-preparation-0001",
      source_path: "004_写作中/第001章_正文草稿_gpt-6.1-sol.md",
      source_sha256: sha(source)
    } as never);
    test.compact();
    await expect(
      test.apply.execute("preview", {
        action: "preview",
        patches: [
          { oldText: "旧句。", newText: "新句。", reason: "按批注补足动作" }
        ]
      } as never)
    ).rejects.toThrow("先调用");
  });
});
