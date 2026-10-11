import {
  computed,
  getCurrentScope,
  nextTick,
  onScopeDispose,
  ref,
  shallowRef,
  watch
} from "vue";
import type {
  OtterProjectView,
  OtterDiscussionInput
} from "@deepwrite/contracts";
import { OtterContextRefSchema } from "@deepwrite/contracts/renderer";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import type {
  ResourceTreeNode,
  ResourceTreeSection
} from "../../types/workspace";
import { uiMessage } from "../../ui-feedback";
import type { OtterWorkbenchModel } from "./useOtterWorkbench";
import {
  novelCategories,
  novelResourceId,
  parseNovelResource,
  type NovelCategory,
  type NovelContext
} from "./novelWorkspaceContext";
import type { NovelNavigationMode } from "./novelWorkspaceTree";

const CHAPTER_SELECTION_PREFIX = "@chapter:";

function parseChapterSelectionPath(path: string): string | undefined {
  if (!path.startsWith(CHAPTER_SELECTION_PREFIX)) return undefined;
  try {
    return decodeURIComponent(path.slice(CHAPTER_SELECTION_PREFIX.length));
  } catch {
    return undefined;
  }
}

function initialNavigationMode(): NovelNavigationMode {
  try {
    return localStorage.getItem("novel.navigationMode") === "complete"
      ? "complete"
      : "compact";
  } catch {
    return "compact";
  }
}

type NovelProjectTreeBuilder =
  (typeof import("./novelWorkspaceTree"))["buildNovelProjectTree"];

export function createNovelWorkspacePort(
  model: OtterWorkbenchModel,
  conversationForKey: (
    key: string,
    scope?: string
  ) => AgentConversationController
) {
  const category = ref<NovelCategory>("discussion");
  const selectedChapter = ref<{ position: string } | null>(null);
  const navigationMode = ref<NovelNavigationMode>(initialNavigationMode());
  const treeBuilder = shallowRef<NovelProjectTreeBuilder | null>(null);
  let treeBuilderLoad: Promise<NovelProjectTreeBuilder | null> | null = null;
  let disposed = false;
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
    });
  function loadTreeBuilder(): Promise<NovelProjectTreeBuilder | null> {
    if (disposed) return Promise.resolve(null);
    if (treeBuilder.value) return Promise.resolve(treeBuilder.value);
    if (!treeBuilderLoad) {
      treeBuilderLoad = import("./novelWorkspaceTree")
        .then(({ buildNovelProjectTree }) => {
          if (disposed) return null;
          treeBuilder.value = buildNovelProjectTree;
          return buildNovelProjectTree;
        })
        .finally(() => {
          treeBuilderLoad = null;
        });
    }
    return treeBuilderLoad;
  }
  const teamSelection = ref("");
  const views = ref<Record<string, OtterProjectView>>({});
  const contexts = ref<
    Record<
      string,
      {
        context: NovelContext;
        sources: string[];
        skills?: NonNullable<OtterDiscussionInput["skills"]>;
        peopleIncluded?: boolean;
        category?: string;
        targetPath?: string;
      }
    >
  >({});
  try {
    const saved = JSON.parse(
      localStorage.getItem("novel.contextNavigation") ?? "{}"
    );
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const [session, entry] of Object.entries(saved)) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry as {
          context?: unknown;
          contextId?: unknown;
          sources?: unknown;
          skills?: unknown;
          peopleIncluded?: unknown;
          category?: unknown;
          targetPath?: unknown;
        };
        const parsed = OtterContextRefSchema.safeParse(item.context);
        if (
          parsed.success &&
          typeof item.contextId === "string" &&
          Array.isArray(item.sources) &&
          item.sources.every((source) => typeof source === "string")
        )
          contexts.value[session] = {
            context: { ...parsed.data, contextId: item.contextId },
            sources: item.sources,
            peopleIncluded: item.peopleIncluded === true,
            ...(typeof item.category === "string"
              ? { category: item.category }
              : {}),
            ...(typeof item.targetPath === "string"
              ? { targetPath: item.targetPath }
              : {}),
            skills: Array.isArray(item.skills)
              ? item.skills.filter(
                  (
                    skill
                  ): skill is NonNullable<
                    OtterDiscussionInput["skills"]
                  >[number] =>
                    typeof skill === "string" &&
                    [
                      "otter-novel",
                      "line-editing",
                      "revision-continuity",
                      "scene-craft",
                      "story-maintenance",
                      "voice-style"
                    ].includes(skill)
                )
              : ["otter-novel"]
          };
      }
    }
  } catch {
    /* Only navigation metadata is cached, never source authority. */
  }
  watch(
    contexts,
    (value) => {
      try {
        localStorage.setItem(
          "novel.contextNavigation",
          JSON.stringify(
            Object.fromEntries(
              Object.entries(value).map(([session, entry]) => [
                session,
                {
                  context: {
                    projectId: entry.context.projectId,
                    contextPath: entry.context.contextPath,
                    receiptPath: entry.context.receiptPath
                  },
                  contextId: entry.context.contextId,
                  sources: entry.sources,
                  peopleIncluded: entry.peopleIncluded,
                  category: entry.category,
                  targetPath: entry.targetPath,
                  skills: entry.skills ?? ["otter-novel"]
                }
              ])
            )
          )
        );
      } catch {
        /* The backend retains Context/Receipt as authority. */
      }
    },
    { deep: true }
  );
  const selectedSources = ref<string[]>([]);
  const selectedSkills = ref<NonNullable<OtterDiscussionInput["skills"]>>([
    "otter-novel"
  ]);
  const references = ref<
    import("../../types/conversation").EditorTextReference[]
  >([]);
  type TeamView = { value: string; label: string };
  const teamGroups = ref<Record<string, TeamView[]>>({});
  const summaryMessageIds = ref<Record<string, string>>({});
  try {
    const saved = JSON.parse(
      localStorage.getItem("novel.summaryMessages") ?? "{}"
    );
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      for (const [session, id] of Object.entries(saved))
        if (typeof id === "string") summaryMessageIds.value[session] = id;
  } catch {
    /* Message contents remain in the original conversation store. */
  }
  watch(
    summaryMessageIds,
    (ids) => {
      try {
        localStorage.setItem("novel.summaryMessages", JSON.stringify(ids));
      } catch {
        /* Metadata only. */
      }
    },
    { deep: true }
  );
  const teamBatches = ref<
    Record<string, { cancelled: boolean; running: boolean }>
  >({});
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem("novel.teamGroups") ?? "{}"
    );
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const [key, value] of Object.entries(saved)) {
        if (
          Array.isArray(value) &&
          value.every(
            (item) =>
              item &&
              typeof item.value === "string" &&
              item.value.startsWith("novel-team:") &&
              typeof item.label === "string"
          )
        )
          teamGroups.value[key] = value;
      }
    }
  } catch {
    /* A malformed navigation cache is not an authoritative source. */
  }
  watch(
    teamGroups,
    (groups) => {
      try {
        localStorage.setItem("novel.teamGroups", JSON.stringify(groups));
      } catch {
        /* Conversation history is persisted separately. */
      }
    },
    { deep: true }
  );
  const selectionEpoch = ref(0);
  watch(
    model.projects,
    (projects) => {
      if (!projects.length) return;
      void loadTreeBuilder().catch((error: unknown) => {
        if (!disposed)
          uiMessage.error(
            `小说目录加载失败；重新打开小说工作区可重试。 ${error instanceof Error ? error.message : String(error)}`
          );
      });
    },
    { immediate: true }
  );
  watch(
    model.projectView,
    (view) => {
      if (view) views.value[view.project.id] = view;
    },
    { immediate: true }
  );
  const controller = computed(() =>
    conversationForKey(
      `novel:${model.projectId.value}:${category.value}`,
      `novel:${model.projectId.value}`
    )
  );
  const teamGroupKey = computed(
    () =>
      `${model.projectId.value}:${category.value}:${controller.value.sessionId.value}`
  );
  const activeController = computed(() =>
    teamSelection.value
      ? conversationForKey(
          teamSelection.value,
          `novel:${model.projectId.value}`
        )
      : controller.value
  );
  function activityTarget(key: string, scope: string | undefined) {
    const primary = /^novel:([^:]+):([a-z]+)$/.exec(key);
    let projectId = primary?.[1];
    let categoryKey = primary?.[2];
    let baseSession: string | undefined;
    let memberName: string | undefined;
    if (!primary) {
      for (const [groupKey, members] of Object.entries(teamGroups.value)) {
        const member = members.find((item) => item.value === key);
        if (!member) continue;
        const parts = groupKey.split(":");
        projectId = parts[0];
        categoryKey = parts[1];
        baseSession = parts.slice(2).join(":");
        memberName = member.label;
        break;
      }
    }
    if (
      !projectId ||
      !categoryKey ||
      !(categoryKey in novelCategories) ||
      scope !== `novel:${projectId}`
    )
      return null;
    const category = categoryKey as NovelCategory;
    return {
      projectId,
      category,
      baseSession,
      memberName,
      resourceId: novelResourceId(projectId, category)
    };
  }
  function activityDescriptor(key: string, scope: string | undefined) {
    const target = activityTarget(key, scope);
    if (!target) return undefined;
    const title =
      model.projects.value.find((project) => project.id === target.projectId)
        ?.title ?? "小说项目";
    return {
      conversationKey: key,
      agentLabel: target.memberName ?? "小说讨论",
      contextLabel: `${title} · ${novelCategories[target.category]}`,
      targetResourceId: target.resourceId
    };
  }
  async function focusConversation(
    key: string,
    scope: string | undefined,
    sessionId?: string
  ) {
    const target = activityTarget(key, scope);
    if (!target) return null;
    await select(target.resourceId);
    teamSelection.value = target.memberName ? key : "";
    const destination = target.memberName
      ? conversationForKey(key, scope)
      : controller.value;
    const exactSessionId = sessionId ?? target.baseSession;
    if (exactSessionId && destination.sessionId.value !== exactSessionId)
      await destination.openConversation(exactSessionId);
    await nextTick();
    return target.resourceId;
  }
  const currentContext = computed(
    () => contexts.value[controller.value.sessionId.value]?.context ?? null
  );
  const contextSourcePaths = computed(
    () => contexts.value[controller.value.sessionId.value]?.sources ?? []
  );
  const nodes = computed<ResourceTreeNode[]>(() =>
    treeBuilder.value
      ? model.projects.value.map((project) =>
          treeBuilder.value!(
            project,
            views.value[project.id]?.documents ?? [],
            navigationMode.value
          )
        )
      : []
  );
  function setNavigationMode(mode: NovelNavigationMode): void {
    navigationMode.value = mode;
    try {
      localStorage.setItem("novel.navigationMode", mode);
    } catch {
      /* The current session still follows the chosen view. */
    }
  }
  function mergeSections(
    sections: ResourceTreeSection[]
  ): ResourceTreeSection[] {
    return sections.map((section) =>
      section.id === "creation"
        ? { ...section, nodes: [...section.nodes, ...nodes.value] }
        : section
    );
  }
  async function select(id: string): Promise<boolean> {
    const target = parseNovelResource(id);
    if (!target) return false;
    const epoch = ++selectionEpoch.value;
    if (
      model.projectId.value !== target.projectId ||
      (!model.projectView.value && !views.value[target.projectId])
    )
      await model.selectProject(target.projectId);
    if (model.projectView.value || views.value[target.projectId])
      await loadTreeBuilder();
    if (epoch !== selectionEpoch.value) return true;
    category.value = target.category;
    teamSelection.value = "";
    references.value = [];
    const chapterPosition = parseChapterSelectionPath(target.path);
    selectedChapter.value = chapterPosition
      ? { position: chapterPosition }
      : null;
    selectedSources.value = target.path ? [target.path] : [];
    if (chapterPosition) {
      selectedSources.value = [];
      model.document.value = null;
    } else if (target.path) await model.openDocument(target.path);
    else model.document.value = null;
    model.tab.value = "workflow";
    return true;
  }
  async function selectChapterDocument(path: string): Promise<boolean> {
    const chapter = selectedChapter.value;
    const document = model.projectView.value?.documents.find(
      (item) =>
        item.path === path &&
        (item.category === "plan" || item.category === "draft")
    );
    if (!chapter || !document) return false;
    category.value = document.category;
    selectedSources.value = [document.path];
    await model.openDocument(document.path);
    return true;
  }
  function clearChapterSelection(): void {
    selectedChapter.value = null;
  }
  return {
    model,
    category,
    selectedChapter,
    navigationMode,
    teamSelection,
    activeController,
    controller,
    currentContext,
    contextSourcePaths,
    contexts,
    selectedSources,
    selectedSkills,
    references,
    teamGroups,
    summaryMessageIds,
    teamGroupKey,
    teamBatches,
    conversationForKey,
    activityDescriptor,
    focusConversation,
    mergeSections,
    setNavigationMode,
    selectChapterDocument,
    clearChapterSelection,
    select
  };
}
export type NovelWorkspacePort = ReturnType<typeof createNovelWorkspacePort>;
