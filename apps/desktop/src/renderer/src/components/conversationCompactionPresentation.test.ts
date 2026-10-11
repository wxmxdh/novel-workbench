import { describe, expect, it } from "vitest";
import type { ChatContextCompaction } from "../types/conversation";
import {
  visibleCompaction,
  compactionReasonKeys,
  compactionTokenSourceKeys
} from "./conversationCompactionPresentation";
import zh from "../i18n/messages/components/conversationContextCompactionNotice/zh-CN";
import en from "../i18n/messages/components/conversationContextCompactionNotice/en-US";

const base: ChatContextCompaction = {
  id: "compact",
  status: "completed",
  reason: "threshold",
  tokensBefore: 100,
  tokensAfter: 80,
  createdAt: "2026-10-04T00:00:00.000Z"
};

describe("context compaction notice visibility", () => {
  it("maps every protocol reason and estimate source to real translated labels", () => {
    for (const key of [
      ...Object.values(compactionReasonKeys),
      ...Object.values(compactionTokenSourceKeys)
    ]) {
      expect(zh[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
  it("shows completed work that reduced context and hides unchanged prune passes", () => {
    expect(visibleCompaction(base)).toBe(true);
    expect(
      visibleCompaction({ ...base, tokensAfter: 100, level: "prune" })
    ).toBe(false);
  });

  it("keeps failures and explicit no-change outcomes visible", () => {
    expect(visibleCompaction({ ...base, status: "failed" })).toBe(true);
    expect(visibleCompaction({ ...base, status: "unchanged" })).toBe(true);
  });
});
