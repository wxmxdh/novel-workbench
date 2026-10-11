import { describe, expect, it, vi } from "vitest";
import type {
  CommandResult,
  LongLoveChapterWorkflowCommandEnvelope
} from "@deepwrite/contracts";
import { buildLoveChapterWorkflowTool } from "./long-agent-tools/tool-love-chapter-workflow";

describe("LOVE chapter workflow tool", () => {
  it("reads current annotations and one requested draft without adoption evidence", async () => {
    const endMarker = "FULL_PI_RESULT_END";
    const fullText = `${"批注原话、被批注原稿和完整参考摘录。".repeat(4_000)}${endMarker}`;
    expect(Buffer.byteLength(fullText, "utf8")).toBeGreaterThan(35 * 1024);
    const executor = vi.fn(
      async (
        _command: LongLoveChapterWorkflowCommandEnvelope
      ): Promise<CommandResult> => ({
        status: "accepted",
        requestId: "core-read-notes-01",
        payload: {
          ok: true,
          action: "read_notes",
          annotationFile: { itemCount: 1 },
          targetGroups: [
            {
              target: { path: "004_写作中/ch1.md", status: "current" },
              annotations: [{ authorText: fullText }],
              annotatedDraft: { content: fullText },
              references: [{ excerpt: fullText, freshness: "valid" }]
            }
          ]
        }
      })
    );
    const tool = buildLoveChapterWorkflowTool({
      bookId: "longbook_9a146bbe",
      sessionId: "session-read-notes",
      runId: "run-read-notes",
      executor
    });
    const result = await tool.execute("tool-read-notes", {
      action: "read_notes",
      chapter: 1,
      volume: "第一卷",
      target_model: "gpt-6.1-sol"
    } as never);

    const command = executor.mock.calls[0]![0];
    expect(command.payload).toMatchObject({
      action: "read_notes",
      chapter: 1,
      volume: "第一卷",
      targetModel: "gpt-6.1-sol"
    });
    expect(command.payload).not.toHaveProperty("authorActionEvidence");
    expect(command.payload).not.toHaveProperty("draftPath");
    expect(result.content[0]).toMatchObject({ type: "text" });
    const finalText = JSON.stringify(result.content);
    expect(finalText).toContain(fullText);
    expect(finalText).toContain(endMarker);
    expect(finalText.endsWith("}]")).toBe(true);
  });

  it("does not report a successful read when Core rejects the current version", async () => {
    const executor = vi.fn(async () => {
      throw new Error("参考摘录 1 版本已失效（source_changed），未完成回读。");
    });
    const tool = buildLoveChapterWorkflowTool({
      bookId: "longbook_9a146bbe",
      sessionId: "session-read-failure",
      runId: "run-read-failure",
      executor: executor as never
    });
    await expect(
      tool.execute("tool-read-notes-failure", {
        action: "read_notes",
        chapter: 1,
        volume: "第一卷"
      } as never)
    ).rejects.toThrow("参考摘录 1 版本已失效");
  });

  it("passes explicit annotation IDs separately from Main author evidence", async () => {
    const evidence = {
      requestId: "author-request-01",
      quote: "我明确采用第一条意见。"
    };
    const executor = vi.fn(
      async (
        _command: LongLoveChapterWorkflowCommandEnvelope
      ): Promise<CommandResult> => ({
        status: "accepted",
        requestId: "core-request-01",
        payload: { ok: true, action: "attach_notes" }
      })
    );
    const tool = buildLoveChapterWorkflowTool({
      bookId: "longbook_9a146bbe",
      sessionId: "session-01",
      runId: "run-01",
      executor,
      authorActionEvidence: evidence
    });
    await tool.execute("tool-call-01", {
      action: "attach_notes",
      chapter: 1,
      volume: "第一卷",
      note_paths: ["006_批注/批注.json"],
      annotation_item_ids: ["web-comment-01"]
    } as never);

    expect(executor).toHaveBeenCalledTimes(1);
    const command = executor.mock.calls[0]![0];
    expect(command.payload).toMatchObject({
      action: "attach_notes",
      notePaths: ["006_批注/批注.json"],
      annotationItemIds: ["web-comment-01"],
      authorActionEvidence: evidence
    });
    expect(command.payload.authorActionEvidence).not.toHaveProperty(
      "annotationItemIds"
    );
  });

  it("allows an empty adoption list to bind notes as background", async () => {
    const executor = vi.fn(
      async (
        _command: LongLoveChapterWorkflowCommandEnvelope
      ): Promise<CommandResult> => ({
        status: "accepted",
        requestId: "core-request-02",
        payload: { ok: true, action: "attach_notes" }
      })
    );
    const tool = buildLoveChapterWorkflowTool({
      bookId: "longbook_9a146bbe",
      sessionId: "session-02",
      runId: "run-02",
      executor,
      authorActionEvidence: {
        requestId: "author-request-02",
        quote: "请把意见绑定为背景，暂不采用。"
      }
    });
    await tool.execute("tool-call-02", {
      action: "attach_notes",
      chapter: 1,
      volume: "第一卷",
      note_paths: ["006_批注/批注.json"],
      annotation_item_ids: []
    } as never);
    expect(executor.mock.calls[0]![0].payload).toMatchObject({
      annotationItemIds: []
    });
  });
});
