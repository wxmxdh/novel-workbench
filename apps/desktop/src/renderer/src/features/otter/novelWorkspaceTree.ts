import type { ResourceTreeNode } from "../../types/workspace";
import {
  novelCategories,
  novelCategoryGroups,
  novelResourceId,
  type NovelCategory
} from "./novelWorkspaceContext";

export interface NovelTreeProject {
  id: string;
  title: string;
}

export interface NovelTreeDocument {
  category: string;
  path: string;
  title: string;
  volume?: string | undefined;
  chapter?: string | undefined;
  model?: string | undefined;
  revision?: string | undefined;
  version?: string | undefined;
  kind?: string | undefined;
  revisionOf?: string | undefined;
  writingRole?: "candidate" | "work" | undefined;
  selectedReference?: boolean | undefined;
  importantCheckpoint?: boolean | undefined;
  sourceCount?: number | undefined;
  writingSources?:
    | Array<{
        title: string;
        model: string;
        version: string;
        outline?: string | undefined;
        revisionOf?: string | undefined;
        savedAt: string;
      }>
    | undefined;
}

export type NovelNavigationMode = "compact" | "complete";

const CHAPTER_SELECTION_PREFIX = "@chapter:";

export function novelChapterSelectionPath(position: string): string {
  return `${CHAPTER_SELECTION_PREFIX}${encodeURIComponent(position)}`;
}

export function parseNovelChapterSelectionPath(
  path: string
): string | undefined {
  if (!path.startsWith(CHAPTER_SELECTION_PREFIX)) return undefined;
  try {
    return decodeURIComponent(path.slice(CHAPTER_SELECTION_PREFIX.length));
  } catch {
    return undefined;
  }
}

export function novelChapterSelectionId(
  projectId: string,
  position: string
): string {
  return novelResourceId(
    projectId,
    "plan",
    novelChapterSelectionPath(position)
  );
}

const groupId = (projectId: string, groupId: string) =>
  `novel-group:${encodeURIComponent(projectId)}:${groupId}`;

function categoryNode(
  projectId: string,
  category: NovelCategory,
  documents: readonly NovelTreeDocument[]
): ResourceTreeNode {
  return {
    id: novelResourceId(projectId, category),
    label: novelCategories[category],
    icon: category === "discussion" ? "message" : "directory",
    readOnly: true,
    selectableBranch: true,
    children:
      category === "draft" || category === "plan"
        ? versionNodes(
            projectId,
            category,
            documents.filter((doc) => doc.category === category)
          )
        : documents
            .filter((document) => document.category === category)
            .map((document) => ({
              id: novelResourceId(projectId, category, document.path),
              label: document.title,
              icon: "file" as const,
              readOnly: true as const
            }))
  };
}

function chineseNumber(value: number): string {
  const digits = "零一二三四五六七八九";
  if (value < 10) return digits[value]!;
  if (value < 20)
    return `${value === 10 ? "" : digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`;
  if (value < 100)
    return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`;
  return String(value);
}

function parseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if ([...value].every((character) => character in digits))
    return [...value].reduce(
      (total, character) => total * 10 + digits[character]!,
      0
    );
  const tens = value.match(
    /^([一二三四五六七八九]?)(十)([一二三四五六七八九]?)$/
  );
  return tens
    ? (tens[1] ? digits[tens[1]]! * 10 : 10) + (tens[3] ? digits[tens[3]]! : 0)
    : null;
}

function normalizeVolume(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return "卷次未标注";
  const numberText = text.match(
    /^(?:第\s*)?([\d零一二三四五六七八九十百千两]+)\s*卷$/
  )?.[1];
  const number = numberText ? parseNumber(numberText) : null;
  return number === null ? text : `第${chineseNumber(number)}卷`;
}

function normalizeChapter(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return "章节未标注";
  const numberText = text.match(
    /^(?:第\s*)?([\d零一二三四五六七八九十百千两]+)\s*章?$/
  )?.[1];
  const number = numberText ? parseNumber(numberText) : null;
  return number === null ? text : `第${String(number).padStart(3, "0")}章`;
}

export function normalizedPosition(document: NovelTreeDocument): string {
  const combined = document.volume?.match(/^(.+?)\s*[·・/]\s*(.+)$/);
  return `${normalizeVolume(combined?.[1] ?? document.volume)} · ${normalizeChapter(combined?.[2] ?? document.chapter)}`;
}

const MODEL_ALIASES = new Map<string, string>([
  ["gemini31pro", "Gemini 3.1 Pro"],
  ["gemini25flash", "Gemini 2.5 Flash"],
  ["gemini37flash", "Gemini 3.7 Flash"],
  ["gemini38flash", "Gemini 3.8 Flash"],
  ["gpt61sol", "GPT 6.1 Sol"],
  ["gpt56luna", "GPT 5.6 Luna"],
  ["gpt6astra", "GPT 6 Astra"],
  ["claudeopus5", "Claude Opus 5"]
]);

export function displayModel(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const text = value.trim();
  if (/^unknown$/i.test(text)) return "模型未标注";
  const key = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._-]/g, "");
  return MODEL_ALIASES.get(key) ?? text;
}

export function documentLabel(document: NovelTreeDocument): string {
  const details = [
    displayModel(document.model),
    document.revision ?? document.version
  ].filter((value): value is string => Boolean(value?.trim()));
  return details.length
    ? `${document.title} · ${details.join(" · ")}`
    : document.title;
}

function versionNodes(
  projectId: string,
  category: "draft" | "plan",
  documents: readonly NovelTreeDocument[]
) {
  const chapters = new Map<
    string,
    {
      current: NovelTreeDocument[];
      work: NovelTreeDocument[];
      candidates: NovelTreeDocument[];
      history: NovelTreeDocument[];
    }
  >();
  for (const document of documents) {
    const chapter = normalizedPosition(document);
    const historical = isHistoricalDocument(document);
    const group = chapters.get(chapter) ?? {
      current: [],
      work: [],
      candidates: [],
      history: []
    };
    if (historical) group.history.push(document);
    else if (document.writingRole === "work") group.work.push(document);
    else if (document.writingRole === "candidate")
      group.candidates.push(document);
    else group.current.push(document);
    chapters.set(chapter, group);
  }
  return [...chapters]
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([chapter, group]) => {
      const candidatesByModel = new Map<string, NovelTreeDocument[]>();
      for (const document of group.candidates) {
        const model = displayModel(document.model) ?? "模型未标注";
        const entries = candidatesByModel.get(model) ?? [];
        entries.push(document);
        candidatesByModel.set(model, entries);
      }
      return {
        id: `novel-group:${encodeURIComponent(projectId)}:${category}:${encodeURIComponent(chapter)}`,
        label: chapter,
        icon: "directory" as const,
        readOnly: true as const,
        children: [
          ...uniqueDocumentLabels(group.current).map(({ document, label }) => ({
            id: novelResourceId(projectId, category, document.path),
            label,
            icon: "file" as const,
            readOnly: true as const
          })),
          ...uniqueDocumentLabels(group.work).map(({ document, label }) => ({
            id: novelResourceId(projectId, category, document.path),
            label: `工作稿 · ${label}`,
            icon: "file" as const,
            readOnly: true as const
          })),
          ...[...candidatesByModel].map(([model, candidates]) => ({
            id: `novel-group:${encodeURIComponent(projectId)}:${category}:${encodeURIComponent(chapter)}:candidate:${encodeURIComponent(model)}`,
            label: `候选 · ${model}（${candidates.length}）`,
            icon: "directory" as const,
            readOnly: true as const,
            children: uniqueDocumentLabels(candidates).map(
              ({ document, label }) => ({
                id: novelResourceId(projectId, category, document.path),
                label: `${document.importantCheckpoint ? "重要节点 · " : ""}${document.selectedReference ? "当前参考 · " : ""}${label}`,
                icon: "file" as const,
                readOnly: true as const
              })
            )
          })),
          ...(group.history.length
            ? [
                {
                  id: `novel-group:${encodeURIComponent(projectId)}:${category}:${encodeURIComponent(chapter)}:history`,
                  label: "历史稿",
                  icon: "directory" as const,
                  readOnly: true as const,
                  children: uniqueDocumentLabels(group.history).map(
                    ({ document, label }) => ({
                      id: novelResourceId(projectId, category, document.path),
                      label,
                      icon: "file" as const,
                      readOnly: true as const
                    })
                  )
                }
              ]
            : [])
        ]
      };
    });
}

function uniqueDocumentLabels(
  documents: readonly NovelTreeDocument[]
): Array<{ document: NovelTreeDocument; label: string }> {
  const sorted = [...documents].sort((left, right) =>
    documentLabel(left).localeCompare(documentLabel(right), "zh-CN")
  );
  const counts = new Map<string, number>();
  for (const document of sorted) {
    const label = documentLabel(document);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return sorted.map((document) => {
    const label = documentLabel(document);
    return {
      document,
      label: counts.get(label)! > 1 ? `${label} · ${document.path}` : label
    };
  });
}

export function isHistoricalPath(path: string): boolean {
  return /(?:^|\\|\/)(?:(?:\d+_)?版本历史|历史|旧稿|history|archive)(?:\\|\/|$)/i.test(
    path
  );
}

function isHistoricalDocument(document: NovelTreeDocument): boolean {
  return isHistoricalPath(document.path);
}

function compactChapterNodes(
  projectId: string,
  documents: readonly NovelTreeDocument[]
): ResourceTreeNode[] {
  const positions = new Set(
    documents
      .filter(
        (document) =>
          document.category === "plan" || document.category === "draft"
      )
      .map(normalizedPosition)
  );
  return [...positions]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((position) => ({
      id: novelChapterSelectionId(projectId, position),
      label: position,
      icon: "directory" as const,
      readOnly: true as const,
      selectableBranch: true
    }));
}

function compactProjectTree(
  project: NovelTreeProject,
  documents: readonly NovelTreeDocument[]
): ResourceTreeNode {
  const referenceCategories = novelCategoryGroups[0]!.categories;
  const referenceNodes = referenceCategories.map((category) => {
    const node = categoryNode(
      project.id,
      category,
      documents.filter((document) => document.category === category)
    );
    delete node.children;
    node.selectableBranch = true;
    return node;
  });
  return {
    id: `novel-project:${encodeURIComponent(project.id)}`,
    label: project.title,
    icon: "book",
    readOnly: true,
    children: [
      categoryNode(project.id, "discussion", documents),
      {
        id: groupId(project.id, "reference"),
        label: "资料",
        icon: "directory",
        readOnly: true,
        children: referenceNodes
      },
      {
        id: groupId(project.id, "chapters"),
        label: "章节",
        icon: "directory",
        readOnly: true,
        children: compactChapterNodes(project.id, documents)
      }
    ]
  };
}

/** Preserve every document resource ID while organizing project navigation. */
export function buildNovelProjectTree(
  project: NovelTreeProject,
  documents: readonly NovelTreeDocument[] = [],
  mode: NovelNavigationMode = "complete"
): ResourceTreeNode {
  if (mode === "compact") return compactProjectTree(project, documents);
  const groupedCategories = new Set<NovelCategory>(
    novelCategoryGroups.flatMap((group) => [...group.categories])
  );
  const children: ResourceTreeNode[] = [
    categoryNode(project.id, "discussion", documents),
    ...novelCategoryGroups.map((group) => ({
      id: groupId(project.id, group.id),
      label: group.label,
      icon: "directory" as const,
      readOnly: true,
      children: group.categories.map((category) =>
        categoryNode(project.id, category, documents)
      )
    })),
    ...Object.keys(novelCategories)
      .filter(
        (category): category is NovelCategory =>
          category !== "discussion" &&
          !groupedCategories.has(category as NovelCategory)
      )
      .map((category) => categoryNode(project.id, category, documents))
  ];

  return {
    id: `novel-project:${encodeURIComponent(project.id)}`,
    label: project.title,
    icon: "book",
    readOnly: true,
    children
  };
}
