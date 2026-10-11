import { ref, toRaw } from "vue";
import { describe, expect, it } from "vitest";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import {
  LONG_NAVIGATION_PRESENTATION_STORAGE_KEY,
  projectLongNavigationPresentation,
  useLongNavigationPresentation
} from "./useLongNavigationPresentation";

function selection(key: string, root: LongWorkspaceSelection["root"]) {
  return {
    key,
    root,
    title: key,
    breadcrumbs: [key],
    files: [],
    preferredRole: "content"
  } satisfies LongWorkspaceSelection;
}

function node(
  id: string,
  label: string,
  key: string,
  root: LongWorkspaceSelection["root"],
  children?: ResourceTreeNode[]
): ResourceTreeNode {
  return {
    id,
    label,
    workspaceType: "long",
    longBookId: "book-a",
    catalogNodeType: "category",
    longWorkspaceSelection: selection(key, root),
    ...(children ? { children } : {})
  };
}

function fullTree(hasChapter: boolean, sourceFile = false) {
  const source = node("source-root", "本书资料", "root:sources", "sources");
  if (sourceFile) {
    source.longWorkspaceSelection!.files.push({
      role: "content",
      label: "导入资料",
      file: {
        id: "source-file",
        path: "long/sources/source.md",
        updatedAt: "2026-10-03T00:00:00.000Z"
      }
    });
  }
  const chapter = node("chapter-id", "第一章", "chapter:chapter-id", "draft");
  const volume = node("volume-id", "第一卷", "volume:volume-id", "draft", [
    ...(hasChapter ? [chapter] : [])
  ]);
  volume.longDraftVolumeId = "volume-id";
  const roots = [
    node("discussion", "自由讨论", "root:discussion", "sources"),
    node("world", "世界观", "root:worldbuilding", "worldbuilding", [
      node("world-empty", "空模板", "worldbuilding:empty", "worldbuilding")
    ]),
    node("people", "人物设计", "root:character_design", "character_design"),
    source,
    node("plot", "情节", "root:plot_design", "plot_design"),
    node("draft", "正文", "root:draft", "draft", [volume]),
    node("ledger", "连续性账本", "root:continuity_ledger", "continuity_ledger")
  ];
  const book: ResourceTreeNode = {
    id: "long-book:book-a",
    label: "新书",
    icon: "book",
    workspaceType: "long",
    longBookId: "book-a",
    catalogNodeType: "long-book",
    selectableBranch: true,
    children: roots
  };
  return [
    {
      id: "creation",
      label: "创作空间",
      icon: "book",
      nodes: [book]
    }
  ] satisfies ResourceTreeSection[];
}

describe("useLongNavigationPresentation", () => {
  it("keeps discussion, shallow settings and plot planning available for new books", () => {
    const complete = fullTree(false);
    const compact = projectLongNavigationPresentation(complete, "compact");
    const book = compact[0]!.nodes[0]!;
    const discussion = book.children?.[0];
    const settings = book.children?.[1];

    expect(book.selectableBranch).toBe(true);
    expect(book.children?.map(({ label }) => label)).toEqual([
      "自由讨论",
      "设定",
      "情节"
    ]);
    expect(book.children?.[2]?.longWorkspaceSelection?.key).toBe("root:plot_design");
    expect(book.children?.[2]?.children).toBeUndefined();
    expect(discussion?.longWorkspaceSelection?.key).toBe("root:discussion");
    expect(discussion?.longWorkspaceSelection?.root).toBe("sources");
    expect(settings?.children?.map(({ label }) => label)).toEqual([
      "世界观",
      "人物设计"
    ]);
    expect(settings?.children?.[0]?.children).toBeUndefined();
    expect(settings?.children?.some(({ label }) => label === "本书资料")).toBe(
      false
    );
    expect(book.children?.some(({ label }) => label === "章节")).toBe(false);
    expect(book.children?.some(({ label }) => label === "连续性账本")).toBe(
      false
    );
  });

  it("shows sources only when the canonical source root has real file refs", () => {
    const empty = projectLongNavigationPresentation(fullTree(false), "compact");
    const populated = projectLongNavigationPresentation(
      fullTree(false, true),
      "compact"
    );
    expect(
      empty[0]!.nodes[0]!.children?.find(({ id }) => id.endsWith(":settings"))
        ?.children
    ).toHaveLength(2);
    expect(
      populated[0]!.nodes[0]!.children?.find(({ id }) =>
        id.endsWith(":settings")
      )?.children
    ).toHaveLength(3);
    expect(
      populated[0]!.nodes[0]!.children?.find(({ id }) =>
        id.endsWith(":settings")
      )?.children?.[2]?.id
    ).toBe("source-root");
  });

  it("shows chapter navigation only when a real chapter card exists", () => {
    const compact = projectLongNavigationPresentation(
      fullTree(true),
      "compact"
    );
    const book = compact[0]!.nodes[0]!;
    const chapterGroup = book.children?.find(({ id }) =>
      id.endsWith(":presentation:chapters")
    );
    const chapter = chapterGroup?.children?.[0]?.children?.[0]?.children?.[0];

    expect(chapterGroup?.label).toBe("章节");
    expect(chapter?.id).toBe("chapter-id");
    expect(chapter?.longWorkspaceSelection?.key).toBe("chapter:chapter-id");
    expect(chapterGroup?.children?.[0]?.children?.[0]?.longDraftVolumeId).toBe(
      "volume-id"
    );
  });

  it("leaves the canonical tree intact and persists complete/compact mode", () => {
    const source = fullTree(true);
    const storage = new Map<string, string>();
    const presentation = useLongNavigationPresentation({
      sections: ref(source),
      storage: () => ({
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
      })
    });

    expect(presentation.mode.value).toBe("compact");
    expect(toRaw(presentation.sections.value[0]!.nodes[0]!.children)).not.toBe(
      source[0]!.nodes[0]!.children
    );
    presentation.toggleMode();
    expect(presentation.mode.value).toBe("complete");
    expect(toRaw(presentation.sections.value[0]!.nodes[0]!.children)).toBe(
      source[0]!.nodes[0]!.children
    );
    expect(storage.get(LONG_NAVIGATION_PRESENTATION_STORAGE_KEY)).toBe(
      "complete"
    );
  });
});
