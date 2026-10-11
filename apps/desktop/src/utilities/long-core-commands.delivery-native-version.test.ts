import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@deepwrite/contracts";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
  readEvidence: vi.fn(),
  cardId: vi.fn()
}));

vi.mock("./novel-writing-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./novel-writing-store")>();
  return {
    ...actual,
    comparisonDraftCardId: mocks.cardId,
    deliverNovelComparisonDraft: mocks.deliver
  };
});
vi.mock("./native-comparison-evidence", () => ({
  readNativeComparisonEvidence: mocks.readEvidence
}));

import { handleLongCoreCommand } from "./long-core-commands";
import type { LongWorkspaceService } from "./long-workspace-service";

const bookId = "longbook_9a146bbe" as const;
const chapterCardId = "chapter_d9489ee2";
const content = "由本次模型交付的隔离测试稿。";
const delivered = {
  bookId,
  preparationId: "preparation-delivery-native-01",
  path: "004_写作中/第001章_正文.md",
  sha256: "a".repeat(64),
  model: "fixture-model-exact",
  status: "待审阅" as const,
  deliveryRecord: ".novel/receipts/delivery-01.json"
};

function fixture() {
  const saveNativeWriting = vi.fn(async () => ({
    path: ".novel/notes/writing/candidate.md",
    hash: "b".repeat(64),
    role: "candidate" as const,
    deduplicated: false
  }));
  const service = {
    getWorkspaceIndex: vi.fn(async () => ({
      workspaceIndex: {
        plot: {
          chapterCards: [{ id: chapterCardId, volumeId: "volume_fixture", title: "第一章" }],
          volumes: [{ id: "volume_fixture", title: "第一卷", summary: "卷梗概" }]
        },
        chapters: [{ chapterCardId, card: { id: "file_chapter-card" } }]
      }
    })),
    readDocument: vi.fn(async () => ({ content: "隔离章卡", totalCharacters: 4, nextOffset: null })),
    saveNativeWriting
  } as unknown as LongWorkspaceService;
  const command = createEnvelope("long.deliverComparisonDraft", {
    bookId,
    authorizationId: "authorization-delivery-01",
    preparationId: delivered.preparationId,
    definitionId: "love-writer-fixture",
    runtime: { provider: "fixture-provider", model: "fixture-model-exact", mode: "provider" as const, configId: "fixture-config" },
    content,
    title: "作者交付标题"
  }, { id: "command-delivery-native-01", context: { sessionId: "session-delivery-native-01" } });
  return { service, saveNativeWriting, command };
}

describe("comparison draft delivery native version bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cardId.mockReturnValue(chapterCardId);
    mocks.readEvidence.mockResolvedValue(undefined);
    mocks.deliver.mockResolvedValue(delivered);
  });

  it("registers only the successful delivered text as a candidate with actual model and provenance", async () => {
    const f = fixture();
    const result = await handleLongCoreCommand(f.service, f.command, "fixture-user-data");
    expect(f.saveNativeWriting).toHaveBeenCalledWith({
      bookId,
      chapterCardId,
      role: "candidate",
      source: "pasted",
      origin: "cli-delivery",
      content,
      title: "作者交付标题",
      model: delivered.model,
      version: `交付-${delivered.sha256.slice(0, 12)}`,
      changeSummary: `正式 CLI 交付来源：${delivered.path}；Receipt：${delivered.deliveryRecord}`
    });
    expect(result).toMatchObject({ status: "accepted", payload: {
      ...delivered,
      nativeVersion: { path: ".novel/notes/writing/candidate.md", hash: "b".repeat(64), deduplicated: false }
    } });
    expect(JSON.stringify(f.saveNativeWriting.mock.calls)).not.toContain("important");
    expect(JSON.stringify(f.saveNativeWriting.mock.calls)).not.toContain("reference");
  });

  it("keeps the successful CLI delivery accepted and reports a failed side-registration", async () => {
    const f = fixture();
    f.saveNativeWriting.mockRejectedValue(new Error("native catalog unavailable"));
    const result = await handleLongCoreCommand(f.service, f.command, "fixture-user-data");
    expect(result).toMatchObject({ status: "accepted", payload: {
      ...delivered,
      nativeVersionWarning: expect.stringContaining("native catalog unavailable")
    } });
  });

  it("does not truncate or register content beyond native single-draft limit", async () => {
    const f = fixture();
    const longContent = "x".repeat(100_001);
    const command = { ...f.command, payload: { ...f.command.payload, content: longContent } } as typeof f.command;
    const result = await handleLongCoreCommand(f.service, command, "fixture-user-data");
    expect(f.saveNativeWriting).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "accepted", payload: {
      ...delivered,
      nativeVersionWarning: expect.stringContaining("超过原生版本面板的单稿上限")
    } });
  });
});
