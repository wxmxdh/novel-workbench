import { describe, expect, it, vi } from "vitest";
import type {
  DeepWriteApi,
  WorkbenchPrepared
} from "@deepwrite/contracts/renderer";
import { saveCodexCandidate, type CodexCandidate } from "./codex-candidate";

const prepared: WorkbenchPrepared = {
  id: "prepared",
  bookId: "book",
  title: "测试作品",
  indexUpdatedAt: "2026-10-11T00:00:00.000Z",
  agentsMd: "测试规则",
  createdAt: "2026-10-11T00:00:00.000Z",
  sources: [
    {
      fileId: "source",
      path: "测试资料.md",
      title: "资料",
      content: "原文",
      sha256: "a".repeat(64)
    }
  ]
};
const candidate: CodexCandidate = {
  content: "测试候选",
  model: "test-model",
  threadId: "test-thread",
  scopeKey: "book:prepared"
};
function harness() {
  const index = {
    updatedAt: prepared.indexUpdatedAt,
    importedSources: [] as unknown[]
  };
  const long = {
    getWorkspaceIndex: vi.fn(async () => ({ workspaceIndex: index })),
    stageSourceImport: vi.fn(
      async (input: { bookId: string; content: string }) => ({
        ...input,
        previewId: "preview",
        sourceSha256: [
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(input.content)
            )
          )
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("")
      })
    ),
    confirmSourceImport: vi.fn(async () => ({
      source: { file: { id: "saved", path: "候选.md" } }
    }))
  };
  const request = vi.fn(async () => ({ kind: "prepared", prepared }));
  return {
    index,
    long,
    request,
    api: {
      long,
      workbenchCollaboration: { request }
    } as unknown as DeepWriteApi
  };
}
describe("Codex candidate author save", () => {
  it("rejects a result from another source scope before project access", async () => {
    const h = harness();
    await expect(
      saveCodexCandidate(h.api, prepared, {
        ...candidate,
        scopeKey: "other:prepared"
      })
    ).rejects.toThrow("不属于");
    expect(h.long.getWorkspaceIndex).not.toHaveBeenCalled();
  });
  it("rejects stale sources without staging a project write", async () => {
    const h = harness();
    h.index.updatedAt = "2026-10-11T01:00:00.000Z";
    await expect(
      saveCodexCandidate(h.api, prepared, candidate)
    ).rejects.toThrow("变化");
    expect(h.long.stageSourceImport).not.toHaveBeenCalled();
  });
  it("rechecks hashes and uses candidate stage/confirm rather than writing draft or canon", async () => {
    const h = harness();
    await expect(
      saveCodexCandidate(h.api, prepared, candidate)
    ).resolves.toEqual({ fileId: "saved", path: "候选.md" });
    expect(h.request).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "prepare",
        bookId: "book",
        fileIds: ["source"]
      })
    );
    expect(h.long.stageSourceImport).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: "candidate",
        purpose: "discussion",
        expectedIndexUpdatedAt: prepared.indexUpdatedAt
      })
    );
    expect(h.long.confirmSourceImport).toHaveBeenCalledWith({
      bookId: "book",
      previewId: "preview"
    });
  });
});
