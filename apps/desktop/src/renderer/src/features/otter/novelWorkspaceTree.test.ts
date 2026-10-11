import { describe, expect, it } from "vitest";
import {
  novelCategories,
  novelCategoryGroups,
  parseNovelResource,
  novelResourceId
} from "./novelWorkspaceContext";
import { buildNovelProjectTree, isHistoricalPath } from "./novelWorkspaceTree";
import {
  novelChapterSelectionId,
  parseNovelChapterSelectionPath
} from "./novelWorkspaceTree";

type TreeShape = { id: string; label: string; children?: TreeShape[] };

describe("historical novel document paths", () => {
  it("recognizes explicit history folders without guessing from version labels", () => {
    expect(isHistoricalPath("004_写作中/005_版本历史/稿件.md")).toBe(true);
    expect(isHistoricalPath("004_写作中/版本历史/稿件.md")).toBe(true);
    expect(isHistoricalPath("drafts/history/chapter.md")).toBe(true);
    expect(isHistoricalPath("004_写作中/第001章_正文稿_GPT_修订05.md")).toBe(
      false
    );
  });
});

function findNode(node: TreeShape, label: string): TreeShape | undefined {
  if (node.label === label) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, label);
    if (found) return found;
  }
  return undefined;
}

describe("novel project navigation tree", () => {
  it("keeps project/group rows separate from selectable recent resources", () => {
    const project = { id: "ui-smoke-project", title: "UI Smoke Project" };
    const tree = buildNovelProjectTree(project);
    const discussion = tree.children?.[0];

    expect(tree.id).toBe("novel-project:ui-smoke-project");
    expect(tree.selectableBranch).toBeUndefined();
    expect(discussion?.id).toBe(novelResourceId(project.id, "discussion"));
    expect(discussion?.id).not.toBe(tree.id);
    expect(discussion?.label).toBe("自由讨论");
    expect(tree.children?.slice(1).map((node) => node.label)).toEqual([
      "资料",
      "写作",
      "项目说明"
    ]);
    expect(
      tree.children?.slice(1).every((node) => !node.selectableBranch)
    ).toBe(true);
  });

  it("covers every category once and preserves document resource IDs and paths", () => {
    const projectId = "novel:one";
    const documents = [
      {
        category: "character",
        path: "characters/UI_SMOKE_CHARACTER.md",
        title: "UI_SMOKE_CHARACTER"
      },
      { category: "draft", path: "004_写作中/第001章.md", title: "第001章" }
    ];
    const tree = buildNovelProjectTree(
      { id: projectId, title: "作品" },
      documents
    );
    const categoryLabels = new Set<string>(Object.values(novelCategories));
    const all: Array<{ id: string; label: string }> = [];
    const visit = (node: typeof tree) => {
      all.push(node);
      for (const child of node.children ?? []) visit(child as typeof tree);
    };
    visit(tree);
    const categoryNodes = all.filter((node) => categoryLabels.has(node.label));

    expect(categoryNodes).toHaveLength(Object.keys(novelCategories).length);
    expect(novelCategories.workflow).toBe("任务与计划记录");
    expect(new Set(all.map((node) => node.id)).size).toBe(all.length);
    for (const category of Object.keys(novelCategories) as Array<
      keyof typeof novelCategories
    >) {
      expect(parseNovelResource(novelResourceId(projectId, category))).toEqual({
        projectId,
        category,
        path: ""
      });
    }
    expect(parseNovelResource(tree.id)).toBeNull();
    expect(parseNovelResource(tree.children![1]!.id)).toBeNull();
    expect(all).toContainEqual(
      expect.objectContaining({
        id: novelResourceId(projectId, "character", documents[0]!.path),
        label: "UI_SMOKE_CHARACTER"
      })
    );
    expect(all).toContainEqual(
      expect.objectContaining({
        id: novelResourceId(projectId, "draft", documents[1]!.path)
      })
    );
    const groupedCategories = novelCategoryGroups.flatMap(
      (group) => group.categories
    );
    expect(new Set(groupedCategories).size).toBe(groupedCategories.length);
    expect(groupedCategories).toHaveLength(14);
  });

  it("shows drafts directly under normalized volume chapters and retains original document IDs", () => {
    const projectId = "novel:versions";
    const docs = [
      {
        category: "draft",
        path: "004_写作中/a.md",
        title: "a.md",
        volume: "第一卷",
        chapter: "第001章",
        model: "Gemini 3.8 Flash",
        version: "初稿"
      },
      {
        category: "draft",
        path: "004_写作中/b.md",
        title: "b.md",
        volume: "第一卷",
        chapter: "第001章",
        model: "gemini-3.8-flash",
        revision: "修订01"
      },
      {
        category: "draft",
        path: "004_写作中/c.md",
        title: "c.md",
        volume: "第一卷",
        chapter: "第001章",
        model: "unknown"
      },
      {
        category: "draft",
        path: "004_写作中/旧稿/d.md",
        title: "d.md",
        volume: "第一卷",
        chapter: "第001章",
        model: "Gemini 3.8 Flash"
      }
    ];
    const tree = buildNovelProjectTree({ id: projectId, title: "作品" }, docs);
    const all: Array<{ id: string; label: string; children?: unknown[] }> = [];
    const visit = (node: typeof tree) => {
      all.push(node);
      for (const child of node.children ?? []) visit(child as typeof tree);
    };
    visit(tree);
    expect(all.map(({ label }) => label)).toContain("第一卷 · 第001章");
    expect(
      all
        .map(({ label }) => label)
        .filter((label) => label === "Gemini 3.8 Flash")
    ).toHaveLength(0);
    expect(all.map(({ label }) => label)).toContain(
      "a.md · Gemini 3.8 Flash · 初稿"
    );
    expect(all.map(({ label }) => label)).toContain(
      "b.md · Gemini 3.8 Flash · 修订01"
    );
    expect(all.map(({ label }) => label)).toContain("c.md · 模型未标注");
    expect(all.map(({ label }) => label)).toContain("历史稿");
    expect(all.map(({ label }) => label)).not.toContain("版本");
    expect(all.map(({ label }) => label)).not.toContain("修订");
    expect(all).toContainEqual(
      expect.objectContaining({
        id: novelResourceId(projectId, "draft", docs[0]!.path)
      })
    );
  });

  it("merges equivalent volume/chapter notation only for display and does not mutate source metadata", () => {
    const documents = [
      {
        category: "plan",
        path: "plans/first.md",
        title: "first.md",
        volume: "第一卷·1",
        chapter: "",
        model: "Gemini 3.8 Flash"
      },
      {
        category: "plan",
        path: "plans/second.md",
        title: "second.md",
        volume: "第1卷",
        chapter: "第001章",
        model: "gemini-3.8-flash"
      }
    ];
    const snapshot = structuredClone(documents);
    const tree = buildNovelProjectTree(
      { id: "normalization", title: "作品" },
      documents
    );
    const plan = findNode(tree, "大纲");
    const chapterNodes = plan?.children ?? [];

    expect(chapterNodes).toHaveLength(1);
    expect(chapterNodes[0]?.label).toBe("第一卷 · 第001章");
    expect(chapterNodes[0]?.children?.map((node) => node.label)).toEqual([
      "first.md · Gemini 3.8 Flash",
      "second.md · Gemini 3.8 Flash"
    ]);
    expect(chapterNodes[0]?.children?.map((node) => node.id)).toEqual([
      "novel:normalization:plan:plans%2Ffirst.md",
      "novel:normalization:plan:plans%2Fsecond.md"
    ]);
    expect(documents).toEqual(snapshot);
  });

  it("does not merge unrecognized model identities and keeps history visibly separated", () => {
    const tree = buildNovelProjectTree({ id: "distinct", title: "作品" }, [
      {
        category: "draft",
        path: "004_写作中/a.md",
        title: "a.md",
        volume: "卷一",
        chapter: "第一章",
        model: "provider-A/model-x"
      },
      {
        category: "draft",
        path: "004_写作中/b.md",
        title: "b.md",
        volume: "卷一",
        chapter: "第一章",
        model: "provider-A/model-y"
      },
      {
        category: "draft",
        path: "004_写作中/历史/c.md",
        title: "c.md",
        volume: "卷一",
        chapter: "第一章",
        model: "provider-A/model-x"
      }
    ]);
    const draft = findNode(tree, "正文");
    const chapter = draft?.children?.[0];

    expect(chapter?.children?.map((node) => node.label)).toEqual([
      "a.md · provider-A/model-x",
      "b.md · provider-A/model-y",
      "历史稿"
    ]);
    expect(chapter?.children?.[2]?.children?.[0]?.id).toBe(
      "novel:distinct:draft:004_%E5%86%99%E4%BD%9C%E4%B8%AD%2F%E5%8E%86%E5%8F%B2%2Fc.md"
    );
  });

  it("offers a compact chapter view without changing full-tree document ids", () => {
    const project = { id: "compact-view", title: "新书" };
    const documents = [
      {
        category: "plan",
        path: "plans/outline.md",
        title: "outline.md",
        volume: "第一卷",
        chapter: "第001章",
        model: "unknown"
      },
      {
        category: "draft",
        path: "drafts/a.md",
        title: "a.md",
        volume: "第一卷",
        chapter: "第001章",
        model: "Gemini 3.8 Flash",
        revision: "修订01"
      },
      {
        category: "draft",
        path: "drafts/missing.md",
        title: "missing.md"
      }
    ];
    const compact = buildNovelProjectTree(project, documents, "compact");
    const complete = buildNovelProjectTree(project, documents, "complete");
    const compactChapter = findNode(compact, "第一卷 · 第001章");
    const unmarkedChapter = findNode(compact, "卷次未标注 · 章节未标注");
    const completeAll: TreeShape[] = [];
    const visit = (node: TreeShape) => {
      completeAll.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(complete);

    expect(compact.children?.map(({ label }) => label)).toEqual([
      "自由讨论",
      "资料",
      "章节"
    ]);
    expect(compactChapter).toMatchObject({
      id: novelChapterSelectionId(project.id, "第一卷 · 第001章"),
      selectableBranch: true
    });
    expect(compactChapter).not.toHaveProperty("children");
    expect(
      parseNovelChapterSelectionPath(
        parseNovelResource(compactChapter!.id)!.path
      )
    ).toBe("第一卷 · 第001章");
    expect(unmarkedChapter?.label).toBe("卷次未标注 · 章节未标注");
    expect(completeAll.map(({ id }) => id)).toContain(
      novelResourceId(project.id, "draft", documents[1]!.path)
    );
    expect(completeAll.map(({ label }) => label)).toContain(
      "a.md · Gemini 3.8 Flash · 修订01"
    );
    expect(compactAllLabels(compact)).not.toContain("outline.md");
  });
});

function compactAllLabels(node: TreeShape): string[] {
  return [
    node.label,
    ...(node.children ?? []).flatMap((child) => compactAllLabels(child))
  ];
}
