import { computed, ref, type Ref } from "vue";
import { createScopedTranslator } from "../i18n";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";

const t = createScopedTranslator("workspace");

export type LongNavigationPresentationMode = "compact" | "complete";

export const LONG_NAVIGATION_PRESENTATION_STORAGE_KEY =
  "long-navigation-presentation-mode";

export interface LongNavigationPresentationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LongNavigationPresentationOptions {
  sections: Readonly<Ref<readonly ResourceTreeSection[]>>;
  storage?: () => LongNavigationPresentationStorage | undefined;
}

function storedMode(
  storage: LongNavigationPresentationOptions["storage"]
): LongNavigationPresentationMode {
  try {
    return storage?.()?.getItem(LONG_NAVIGATION_PRESENTATION_STORAGE_KEY) ===
      "complete"
      ? "complete"
      : "compact";
  } catch {
    return "compact";
  }
}

function rootOf(
  children: readonly ResourceTreeNode[] | undefined,
  root: string
): ResourceTreeNode | undefined {
  return children?.find(
    (node) => node.longWorkspaceSelection?.key === `root:${root}`
  );
}

function chapterNodes(volume: ResourceTreeNode): ResourceTreeNode[] {
  return (volume.children ?? []).filter((node) =>
    node.longWorkspaceSelection?.key.startsWith("chapter:")
  );
}

function hasRealChapter(draftRoot: ResourceTreeNode): boolean {
  return (draftRoot.children ?? []).some(
    (volume) => chapterNodes(volume).length > 0
  );
}

function shallowOverview(node: ResourceTreeNode): ResourceTreeNode {
  const overview = { ...node, selectableBranch: false };
  delete overview.children;
  return overview;
}

function compactLongBook(book: ResourceTreeNode): ResourceTreeNode {
  const roots = book.children ?? [];
  const discussion = rootOf(roots, "discussion");
  const world = rootOf(roots, "worldbuilding");
  const characters = rootOf(roots, "character_design");
  const sources = rootOf(roots, "sources");
  const plot = rootOf(roots, "plot_design");
  const draft = rootOf(roots, "draft");

  const settingNodes = [
    ...(world ? [shallowOverview(world)] : []),
    ...(characters ? [shallowOverview(characters)] : []),
    ...(sources && (sources.longWorkspaceSelection?.files.length ?? 0) > 0
      ? [shallowOverview(sources)]
      : [])
  ];
  const children: ResourceTreeNode[] = discussion
    ? [shallowOverview(discussion)]
    : [];

  if (settingNodes.length) {
    children.push({
      id: `${book.id}:presentation:settings`,
      label: t("longNavigationPresentation.settings"),
      icon: "folder",
      workspaceType: "long",
      ...(book.longBookId ? { longBookId: book.longBookId } : {}),
      catalogNodeType: "category",
      children: settingNodes
    });
  }

  if (plot) children.push(shallowOverview(plot));

  if (draft && hasRealChapter(draft)) {
    const volumes = (draft.children ?? [])
      .map((volume) => ({
        ...volume,
        children: chapterNodes(volume)
      }))
      .filter((volume) => volume.children?.length);
    children.push({
      id: `${book.id}:presentation:chapters`,
      label: t("longNavigationPresentation.chapters"),
      icon: "folder",
      workspaceType: "long",
      ...(book.longBookId ? { longBookId: book.longBookId } : {}),
      catalogNodeType: "category",
      children: [compactDraftRoot(draft, volumes)]
    });
  }

  return { ...book, children };
}

function compactDraftRoot(
  draft: ResourceTreeNode,
  volumes: ResourceTreeNode[]
): ResourceTreeNode {
  const result = { ...draft, children: volumes, selectableBranch: false };
  delete result.longTreeCollection;
  return result;
}

/**
 * Produces a display-only projection. The caller must keep its canonical
 * resource lookup built from the complete tree so search, editor routing and
 * existing IDs are unaffected by this compact sidebar view.
 */
export function projectLongNavigationPresentation(
  sections: readonly ResourceTreeSection[],
  mode: LongNavigationPresentationMode
): ResourceTreeSection[] {
  if (mode === "complete") return [...sections];

  return sections.map((section) => ({
    ...section,
    nodes: section.nodes.map((node) =>
      node.catalogNodeType === "long-book" ? compactLongBook(node) : node
    )
  }));
}

export function useLongNavigationPresentation(
  options: LongNavigationPresentationOptions
) {
  const mode = ref<LongNavigationPresentationMode>(storedMode(options.storage));
  const sections = computed(() =>
    projectLongNavigationPresentation(options.sections.value, mode.value)
  );
  const toggleLabel = computed(() =>
    t(
      mode.value === "compact"
        ? "longNavigationPresentation.showComplete"
        : "longNavigationPresentation.showCompact"
    )
  );

  function setMode(next: LongNavigationPresentationMode): void {
    mode.value = next;
    try {
      options
        .storage?.()
        ?.setItem(LONG_NAVIGATION_PRESENTATION_STORAGE_KEY, next);
    } catch {
      // Keep the view usable for this session when persistence is unavailable.
    }
  }

  function toggleMode(): void {
    setMode(mode.value === "compact" ? "complete" : "compact");
  }

  return { mode, sections, toggleLabel, setMode, toggleMode };
}
