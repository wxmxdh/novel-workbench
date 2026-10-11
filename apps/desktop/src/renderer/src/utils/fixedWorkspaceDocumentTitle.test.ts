import { describe, expect, it } from "vitest";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  normalizeFixedWorkspaceDocumentDraft,
  resolveWorkspaceDocumentTitle,
  workspaceDocumentHasFixedTitle
} from "./fixedWorkspaceDocumentTitle";

function document(patch: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    id: "document-1",
    domain: "creation",
    title: "概览",
    eyebrow: "短篇 · 人物设计",
    path: ["测试作品", "人物设计", "概览"],
    content: "磁盘正文",
    workspaceId: "book-1",
    workspaceType: "short",
    stageId: "character_design",
    ...patch
  };
}

describe("fixed workspace document titles", () => {
  it.each([
    { draftFileKind: "character-state" as const },
    { catalogLibraryField: "overview" as const },
    { characterFileKind: "overview" as const },
    { plotStageOrder: 0 }
  ])(
    "recognizes a structural title for $draftFileKind$catalogLibraryField$characterFileKind$plotStageOrder",
    (patch) => {
      expect(workspaceDocumentHasFixedTitle(document(patch))).toBe(true);
    }
  );

  it("uses the projected title for fixed documents but preserves editable titles", () => {
    expect(
      resolveWorkspaceDocumentTitle(
        document({ characterFileKind: "overview" }),
        ""
      )
    ).toBe("概览");
    expect(
      resolveWorkspaceDocumentTitle(document({ title: "正文标题" }), "用户标题")
    ).toBe("用户标题");
  });

  it("normalizes only the title while preserving recovered content and metadata", () => {
    const recovered: EditorDraftState = {
      title: "",
      content: "未保存的人物正文",
      dirty: true,
      recoveryUpdatedAt: "2026-08-18T10:00:00.000Z",
      baseRevision: "base-revision",
      baseProjectRevision: 7
    };

    expect(
      normalizeFixedWorkspaceDocumentDraft(
        document({ characterFileKind: "overview" }),
        recovered
      )
    ).toEqual({ ...recovered, title: "概览" });
  });
});
