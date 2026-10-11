import { describe, expect, it, vi } from "vitest";
import type {
  ConversationHistoryApi,
  ConversationHistorySession
} from "@deepwrite/contracts";
import { readApi } from "../composables/conversation-history-reader/reader.test-support";
import { loadConversationHistoryRecord } from "./conversationHistoryRecordLoader";

const runSettings = {
  selectedModelId: "fixture-sol-config",
  thinkingLevel: "max",
  agentTeamMode: "team",
  webSearchEnabled: true
} as const;

function fixture(mode: "inline" | "root" | "field") {
  const path: [] | ["runSettings"] | undefined =
    mode === "inline" ? undefined : mode === "root" ? [] : ["runSettings"];
  const metadata = {
    sessionId: "fixture-session",
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
    draft: "作者尚未发送的内容",
    approvalMode: "request-approval",
    temperature: 0.7,
    ...(path === undefined ? { runSettings } : {})
  };
  const content = path?.length ? runSettings : { ...metadata, runSettings };
  const chunk = JSON.stringify(content);
  const totalBytes = new TextEncoder().encode(chunk).length;
  const session: ConversationHistorySession = {
    sessionId: metadata.sessionId,
    metadata,
    ...(path
      ? {
          metadataDetails: [
            { path, encoding: "json" as const, byteLength: totalBytes }
          ]
        }
      : {}),
    revision: 1,
    generation: 0,
    sequence: 1,
    deleted: false,
    messageCount: 0,
    byteLength: 0
  };
  const api: ConversationHistoryApi = {
    ...readApi(),
    mergeScopes: vi.fn<ConversationHistoryApi["mergeScopes"]>(),
    stage: vi.fn<ConversationHistoryApi["stage"]>(),
    commit: vi.fn<ConversationHistoryApi["commit"]>(),
    list: vi.fn<ConversationHistoryApi["list"]>(),
    listArchived: vi.fn<ConversationHistoryApi["listArchived"]>(),
    purge: vi.fn<ConversationHistoryApi["purge"]>(),
    session: vi
      .fn<ConversationHistoryApi["session"]>()
      .mockResolvedValue(session)
  };
  vi.mocked(api.messages).mockResolvedValue({
    revision: 1,
    generation: 0,
    messages: [],
    nextPosition: null
  });
  vi.mocked(api.metadataDetail).mockResolvedValue({
    revision: 1,
    encoding: "json",
    chunk,
    totalBytes,
    nextOffset: null
  });
  return api;
}

describe("conversation history run settings materialization", () => {
  it.each(["inline", "root", "field"] as const)(
    "retains saved model and team settings for %s metadata projection",
    async (mode) => {
      const api = fixture(mode);
      const record = await loadConversationHistoryRecord(
        api,
        "conversation-history:fixture",
        "fixture-session"
      );
      expect(record.runSettings).toEqual(runSettings);
      expect(record.draft).toBe("作者尚未发送的内容");
      expect(record.messages).toEqual([]);
    }
  );
});
