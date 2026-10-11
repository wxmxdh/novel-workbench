import { describe, expect, it, vi } from "vitest";
import type { LongStageSourceImportInput } from "@deepwrite/contracts";
import {
  parseLongSourceImportProposal,
  useLongSourceImport,
  type LongSourceImportProposal
} from "./useLongSourceImport";

describe("parseLongSourceImportProposal", () => {
  it("accepts only a well-formed structured suggestion", () => {
    expect(
      parseLongSourceImportProposal({
        source_name: "notes.md",
        title: "Foundation",
        purpose: "foundation",
        authority: "candidate",
        summary: "Keep the original text.",
        conflicts: [],
        unresolved_questions: []
      })
    ).toMatchObject({ source_name: "notes.md", purpose: "foundation" });
  });

  it.each([
    "not json",
    {
      source_name: "",
      title: "Title",
      purpose: "foundation",
      authority: "candidate",
      summary: "",
      conflicts: [],
      unresolved_questions: []
    },
    {
      source_name: "notes.md",
      title: "Title",
      purpose: "canon",
      authority: "candidate",
      summary: "",
      conflicts: [],
      unresolved_questions: []
    },
    {
      source_name: "notes.md",
      title: "Title",
      purpose: "foundation",
      authority: "canon",
      summary: "",
      conflicts: [],
      unresolved_questions: []
    },
    {
      source_name: "notes.md",
      title: "Title",
      purpose: "foundation",
      authority: "candidate",
      summary: "",
      conflicts: [1],
      unresolved_questions: []
    }
  ])("rejects malformed proposal %j", (value) => {
    expect(parseLongSourceImportProposal(value)).toBeNull();
  });

  it("requires discussion sources to be an outline candidate with original text", () => {
    expect(
      parseLongSourceImportProposal({
        source_name: "本次讨论",
        title: "大纲",
        purpose: "reference",
        authority: "reference",
        summary: "notes",
        conflicts: [],
        unresolved_questions: [],
        candidate_content: "候选正文"
      })
    ).toBeNull();
  });
});

const attachmentProposal: LongSourceImportProposal = {
  source_name: "接续总稿.md",
  title: "新书基础资料",
  purpose: "foundation",
  authority: "undecided",
  summary: "",
  conflicts: [],
  unresolved_questions: []
};

function setupImport(
  overrides: {
    stageSourceImport?: (input: LongStageSourceImportInput) => unknown;
    confirmSourceImport?: (...args: never[]) => unknown;
    refreshIndex?: (bookId: string) => Promise<unknown>;
  } = {}
) {
  const notifications = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const stageSourceImport = vi.fn(
    overrides.stageSourceImport ??
      (async () => ({
        previewId: "preview-1",
        expiresAt: "2026-10-03T00:00:00.000Z",
        bookId: "book-1",
        title: "新书基础资料",
        sourceName: "接续总稿.md",
        sourcePath: "作者选定的文本文件：接续总稿.md",
        content: "原文\r\n第二行",
        purpose: "foundation",
        authority: "undecided",
        sourceSha256: "a".repeat(64)
      }))
  );
  const confirmSourceImport = vi.fn(
    overrides.confirmSourceImport ??
      (async () => ({
        bookId: "book-1",
        source: {
          id: "source_abc",
          title: "新书基础资料",
          sourceName: "接续总稿.md",
          sourcePath: "作者选定的文本文件：接续总稿.md",
          purpose: "foundation",
          authority: "undecided",
          sourceSha256: "a".repeat(64),
          importedAt: "2026-10-03T00:00:00.000Z",
          file: { id: "file-source-1", path: "long/sources/source_abc.md" }
        }
      }))
  );
  const state = useLongSourceImport({
    api: () => ({ stageSourceImport, confirmSourceImport }) as never,
    notifications,
    refreshIndex: overrides.refreshIndex ?? vi.fn(async () => undefined)
  });
  return { state, notifications, stageSourceImport, confirmSourceImport };
}

describe("useLongSourceImport", () => {
  const attachment = {
    kind: "text" as const,
    id: "attachment-1",
    name: "接续总稿.md",
    mediaType: "text/markdown",
    size: 16,
    content: "原文\r\n第二行"
  };

  it("binds the exact selected attachment and stages its unmodified text", async () => {
    const { state, stageSourceImport } = setupImport();
    expect(
      state.open({
        proposal: attachmentProposal,
        bookId: "book-1",
        expectedIndexUpdatedAt: "2026-10-02T00:00:00.000Z",
        attachments: [attachment]
      })
    ).toBe(true);
    expect(await state.stage()).toBe(true);
    expect(stageSourceImport).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: "book-1",
        sourceName: "接续总稿.md",
        content: "原文\r\n第二行"
      })
    );
  });

  it("rejects missing, duplicate, or truncated source attachments", () => {
    const { state } = setupImport();
    const input = {
      proposal: attachmentProposal,
      bookId: "book-1",
      expectedIndexUpdatedAt: "2026-10-02T00:00:00.000Z"
    };
    expect(state.open({ ...input, attachments: [] })).toBe(false);
    expect(
      state.open({ ...input, attachments: [attachment, attachment] })
    ).toBe(false);
    expect(
      state.open({
        ...input,
        attachments: [{ ...attachment, truncated: true }]
      })
    ).toBe(false);
  });

  it("does not confirm a preview returned for a different book", async () => {
    const { state, confirmSourceImport } = setupImport({
      stageSourceImport: async () => ({
        previewId: "preview-cross-book",
        expiresAt: "2026-10-03T00:00:00.000Z",
        bookId: "book-2",
        title: "新书基础资料",
        sourceName: "接续总稿.md",
        sourcePath: "作者选定的文本文件：接续总稿.md",
        content: "原文\r\n第二行",
        purpose: "foundation",
        authority: "undecided",
        sourceSha256: "a".repeat(64)
      })
    });
    state.open({
      proposal: attachmentProposal,
      bookId: "book-1",
      expectedIndexUpdatedAt: "2026-10-02T00:00:00.000Z",
      attachments: [attachment]
    });
    expect(await state.stage()).toBe(false);
    expect(await state.confirm()).toBeNull();
    expect(confirmSourceImport).not.toHaveBeenCalled();
  });

  it("keeps a failed confirmation retryable and reports refresh failures separately after save", async () => {
    const confirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({
        bookId: "book-1",
        source: {
          id: "source_abc",
          title: "新书基础资料",
          sourceName: "接续总稿.md",
          sourcePath: "作者选定的文本文件：接续总稿.md",
          purpose: "foundation",
          authority: "undecided",
          sourceSha256: "a".repeat(64),
          importedAt: "2026-10-03T00:00:00.000Z",
          file: { id: "file-source-1", path: "long/sources/source_abc.md" }
        }
      });
    const refreshIndex = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    const { state, notifications } = setupImport({
      confirmSourceImport: confirm,
      refreshIndex
    });
    state.open({
      proposal: attachmentProposal,
      bookId: "book-1",
      expectedIndexUpdatedAt: "2026-10-02T00:00:00.000Z",
      attachments: [attachment]
    });
    expect(await state.stage()).toBe(true);
    expect(await state.confirm()).toBeNull();
    expect(state.staged.value).not.toBeNull();
    expect(await state.confirm()).toMatchObject({ id: "source_abc" });
    expect(state.isOpen.value).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(refreshIndex).toHaveBeenCalledTimes(1);
    expect(notifications.warning).toHaveBeenCalledOnce();
  });

  it("cancels without staging or confirming", () => {
    const { state, stageSourceImport, confirmSourceImport } = setupImport();
    state.open({
      proposal: attachmentProposal,
      bookId: "book-1",
      expectedIndexUpdatedAt: "2026-10-02T00:00:00.000Z",
      attachments: [attachment]
    });
    state.close();
    expect(state.isOpen.value).toBe(false);
    expect(stageSourceImport).not.toHaveBeenCalled();
    expect(confirmSourceImport).not.toHaveBeenCalled();
  });
  it("requires a fresh preview after returning to edit purpose, authority and purpose note", async () => {
    let count = 0;
    const { state, stageSourceImport, confirmSourceImport } = setupImport({
      stageSourceImport: async (input) => ({
        ...input,
        previewId: `preview-${++count}`,
        expiresAt: "2026-10-04T00:00:00.000Z",
        sourceSha256: "a".repeat(64)
      })
    });
    state.open({
      proposal: attachmentProposal,
      bookId: "book-1",
      expectedIndexUpdatedAt: "2026-10-02T00:00:00.000Z",
      attachments: [attachment]
    });
    expect(await state.stage()).toBe(true);
    state.edit();
    state.candidate.value!.authority = "reference";
    state.candidate.value!.purpose = "character";
    state.candidate.value!.purposeNote = "  旧人物卡仅供参考，不继承旧关系。  ";
    expect(await state.confirm()).toBeNull();
    expect(confirmSourceImport).not.toHaveBeenCalled();
    expect(await state.stage()).toBe(true);
    expect(state.staged.value).toMatchObject({
      previewId: "preview-2",
      authority: "reference",
      purpose: "character",
      purposeNote: "旧人物卡仅供参考，不继承旧关系。"
    });
    expect(stageSourceImport).toHaveBeenCalledTimes(2);
  });
});
