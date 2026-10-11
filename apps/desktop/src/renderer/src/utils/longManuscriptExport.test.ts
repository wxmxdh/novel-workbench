import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import { file } from "../types/longWorkspace.test-support";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import { createLongManuscriptExportInput } from "./longManuscriptExport";
import {
  groupLongManuscriptExportChapters,
  listLongManuscriptExportChapters
} from "./longManuscriptExportChapters";

function chapterCard(input: {
  id: string;
  volumeId: string;
  title: string;
  narrativeOrder: number;
}): LongWorkspaceIndexSnapshot["plot"]["chapterCards"][number] {
  return {
    id: input.id,
    volumeId: input.volumeId,
    primaryArcId: null,
    title: input.title,
    narrativeOrder: input.narrativeOrder
  } as LongWorkspaceIndexSnapshot["plot"]["chapterCards"][number];
}

function workspaceFixture(): LongWorkspaceIndexSnapshot {
  return {
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [
        { id: "volume_two", title: "下卷", order: 2, summary: "" },
        { id: "volume_one", title: "上卷", order: 1, summary: "" }
      ],
      arcs: [],
      chapterCards: [
        chapterCard({
          id: "chapter_later",
          volumeId: "volume_one",
          title: "第二章",
          narrativeOrder: 2
        }),
        chapterCard({
          id: "chapter_volume_two",
          volumeId: "volume_two",
          title: "卷三章",
          narrativeOrder: 1
        }),
        chapterCard({
          id: "chapter_first",
          volumeId: "volume_one",
          title: "第一章",
          narrativeOrder: 1
        })
      ],
      storyEvents: []
    },
    chapters: [
      {
        chapterCardId: "chapter_first",
        body: file("file_body_first", "long/chapters/chapter_first/body.md")
      },
      {
        chapterCardId: "chapter_later",
        body: file("file_body_later", "long/chapters/chapter_later/body.md")
      },
      {
        chapterCardId: "chapter_volume_two",
        body: file("file_body_two", "long/chapters/chapter_volume_two/body.md")
      }
    ]
  } as unknown as LongWorkspaceIndexSnapshot;
}

function createApi(): LongWorkspaceRendererApi {
  return {
    readDocument: vi.fn(async ({ bookId, fileId, offset }) => ({
      bookId,
      file: { id: fileId },
      offset,
      content: `正文:${fileId}`,
      nextOffset: null
    }))
  } as unknown as LongWorkspaceRendererApi;
}

describe("long manuscript export chapters", () => {
  it("lists chapter cards by volume order then narrative order", () => {
    const chapters = listLongManuscriptExportChapters(workspaceFixture());
    expect(
      chapters.map(({ id, title, volumeTitle }) => ({ id, title, volumeTitle }))
    ).toEqual([
      { id: "chapter_first", title: "第一章", volumeTitle: "上卷" },
      { id: "chapter_later", title: "第二章", volumeTitle: "上卷" },
      { id: "chapter_volume_two", title: "卷三章", volumeTitle: "下卷" }
    ]);
  });

  it("groups listed chapters without splitting volume order", () => {
    const groups = groupLongManuscriptExportChapters(
      listLongManuscriptExportChapters(workspaceFixture())
    );
    expect(
      groups.map(({ volumeTitle, chapters }) => ({
        volumeTitle,
        ids: chapters.map(({ id }) => id)
      }))
    ).toEqual([
      { volumeTitle: "上卷", ids: ["chapter_first", "chapter_later"] },
      { volumeTitle: "下卷", ids: ["chapter_volume_two"] }
    ]);
  });

  it("exports every manuscript body when chapter ids are omitted", async () => {
    const result = await createLongManuscriptExportInput({
      api: createApi(),
      bookId: "longbook_export",
      title: "可选集",
      workspace: workspaceFixture(),
      sections: ["manuscript"]
    });
    expect(
      result.files.map(({ path, content }) => ({ path, content }))
    ).toEqual([
      { path: ["正文", "第一章"], content: "正文:file_body_first" },
      { path: ["正文", "第二章"], content: "正文:file_body_later" },
      { path: ["正文", "卷三章"], content: "正文:file_body_two" }
    ]);
  });

  it("keeps selected chapter order and skips unselected cards", async () => {
    const result = await createLongManuscriptExportInput({
      api: createApi(),
      bookId: "longbook_export",
      title: "可选集",
      workspace: workspaceFixture(),
      sections: ["manuscript"],
      manuscriptChapterCardIds: ["chapter_volume_two", "chapter_first"]
    });
    expect(result.files.map(({ path }) => path)).toEqual([
      ["正文", "第一章"],
      ["正文", "卷三章"]
    ]);
  });

  it("writes no manuscript files when the selected chapter list is empty", async () => {
    const result = await createLongManuscriptExportInput({
      api: createApi(),
      bookId: "longbook_export",
      title: "可选集",
      workspace: workspaceFixture(),
      sections: ["manuscript"],
      manuscriptChapterCardIds: []
    });
    expect(result.files).toEqual([]);
    expect(result.sections).toEqual(["manuscript"]);
  });
});
