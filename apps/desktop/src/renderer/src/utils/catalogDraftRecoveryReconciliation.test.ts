import { describe, expect, it } from "vitest";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import { reconcileCatalogRecoveryDrafts } from "./catalogDraftRecoveryReconciliation";

function characterOverview(content: string): WorkspaceDocument {
  return {
    id: "character-overview",
    domain: "creation",
    title: "概览",
    eyebrow: "短篇 · 人物设计",
    path: ["测试作品", "人物设计", "概览"],
    content,
    workspaceId: "book-1",
    workspaceType: "short",
    stageId: "character_design",
    characterFileKind: "overview",
    catalogContentLoaded: true
  };
}

function recovered(content: string): EditorDraftState {
  return {
    title: "",
    content,
    dirty: true,
    recoveryUpdatedAt: "2026-08-18T10:00:00.000Z",
    baseRevision: "base-revision",
    baseProjectRevision: 7
  };
}

describe("catalog draft recovery reconciliation", () => {
  it("retains unsaved body text while repairing a fixed recovered title", () => {
    const result = reconcileCatalogRecoveryDrafts(
      { "character-overview": recovered("未保存的人物正文") },
      new Map([["character-overview", characterOverview("磁盘人物正文")]])
    );

    expect(result["character-overview"]).toEqual({
      ...recovered("未保存的人物正文"),
      title: "概览"
    });
  });

  it("drops a repaired recovery when its body is already persisted", () => {
    const result = reconcileCatalogRecoveryDrafts(
      { "character-overview": recovered("磁盘人物正文") },
      new Map([["character-overview", characterOverview("磁盘人物正文")]])
    );

    expect(result).toEqual({});
  });
});
