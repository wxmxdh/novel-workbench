import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  LongWorkspaceIndexSnapshot,
  NovelPlotCandidateSet,
  NovelRequirementReview
} from "@deepwrite/contracts";
import { uiMessage } from "../../ui-feedback";
import type {
  PopupSelectOption,
  PopupSelectValue
} from "../../components/PopupSelect.vue";
import { candidateSetIsCurrent, validateRequirementReview } from "./review";
import {
  hasCurrentNovelSourceVersion,
  outlineSelectionDescription,
  readNovelChapterSources,
  searchNovelPreviousText,
  type NovelChapterSource,
  type NovelSearchHit
} from "./sources";
import {
  cancelNovelTask,
  makeNovelCandidateSet,
  novelCandidatePrompt,
  novelReviewPrompt,
  parseNovelReview,
  prepareNovelRun,
  saveNovelCandidate,
  startNovelTask,
  waitNovelTask
} from "./agent-runtime";
import { novelCollaborationLabel as t } from "./labels";

export interface NovelCollaborationPanelProps {
  bookId: string;
  chapterCardId: string;
  snapshot: LongWorkspaceIndexSnapshot;
}

type LoadedSource = NovelChapterSource;
type SearchResultRow = NovelSearchHit;

export function useNovelCollaboration(
  props: NovelCollaborationPanelProps,
  emit: (event: "openFile", fileId: string, offset?: number) => void
) {
  const loading = ref(false);
  const running = ref(false);
  const error = ref("");
  const loadedSources = ref<LoadedSource[]>([]);
  const latestSnapshot = ref<LongWorkspaceIndexSnapshot | null>(null);
  const sourceWarning = ref("");
  const requirementInstructions = ref("");
  const reviewResult = ref<NovelRequirementReview | null>(null);
  const checkedRows = computed(() => {
    if (!reviewResult.value || !latestSnapshot.value) return [];
    const currentBody = loadedSources.value.find(
      (source) => source.role === "draft"
    );
    const currentOutline = loadedSources.value.find(
      (source) => source.role === "outline"
    );
    const texts = new Map<string, string>();
    for (const source of [currentBody, currentOutline])
      if (source) texts.set(source.fileId, source.content);
    return validateRequirementReview(reviewResult.value, {
      currentBookId: props.bookId,
      currentChapterCardId: props.chapterCardId,
      currentSources: loadedSources.value,
      currentTextByFileId: texts
    });
  });
  const searchQuestion = ref("");
  const searchQueries = ref<string[]>([]);
  const searchScope = ref<"draft" | "all">("draft");
  const searchLoading = ref(false);
  const searchRows = ref<SearchResultRow[]>([]);
  const candidatePrompt = ref("");
  const candidateSet = ref<NovelPlotCandidateSet | null>(null);
  const selectedCandidateId = ref("");
  const availableModels = ref<
    Array<{ id: string; label: string; hasApiKey: boolean }>
  >([]);
  const reviewModelId = ref("");
  const candidateModelIds = ref<string[]>([]);
  const candidateTaskIds = ref<Record<string, string>>({});
  const candidateSaved = ref(false);
  const activeTaskIds = ref<string[]>([]);
  const activeTaskBooks = new Map<string, string>();
  const contextGeneration = ref(0);
  const savingCandidate = ref(false);
  const candidateNotice = ref("");
  const selectedChapter = computed(() =>
    props.snapshot.plot.chapterCards.find(
      (chapter) => chapter.id === props.chapterCardId
    )
  );
  const outlineNeedsRecheck = computed(() => {
    const card = latestSnapshot.value?.plot.chapterCards.find(
      (item) => item.id === props.chapterCardId
    );
    const outline = loadedSources.value.find(
      (source) => source.role === "outline"
    );
    return (
      card?.outlineSelection?.status === "needs-recheck" ||
      Boolean(
        card?.outlineSelection &&
        outline &&
        card.outlineSelection.sha256 !== outline.sha256
      )
    );
  });
  const searchScopeOptions: PopupSelectOption[] = [
    { value: "draft", label: t("scopeDraft") },
    { value: "all", label: t("scopeAll") }
  ];
  const reviewModelOptions = computed<PopupSelectOption[]>(() =>
    availableModels.value.map(({ id, label }) => ({ value: id, label }))
  );
  const candidateModelOptions = computed<PopupSelectOption[]>(() =>
    availableModels.value.map(({ id, label }) => ({ value: id, label }))
  );
  const currentCandidateSet = computed(() =>
    candidateSet.value && latestSnapshot.value
      ? candidateSetIsCurrent(
          candidateSet.value,
          props.bookId,
          props.chapterCardId,
          loadedSources.value,
          selectedOutlineRecord(latestSnapshot.value, props.chapterCardId)
        )
      : false
  );

  watch(
    () =>
      [props.bookId, props.chapterCardId, props.snapshot.updatedAt] as const,
    () => {
      contextGeneration.value += 1;
      void cancelTask();
      reviewResult.value = null;
      candidateSet.value = null;
      searchRows.value = [];
      void loadSources();
    }
  );
  onBeforeUnmount(() => {
    contextGeneration.value += 1;
    void cancelTask();
  });

  async function loadSources(): Promise<void> {
    const generation = contextGeneration.value;
    loading.value = true;
    error.value = "";
    sourceWarning.value = "";
    try {
      const loaded = await readNovelChapterSources(
        props.bookId,
        props.chapterCardId,
        props.snapshot
      );
      if (generation !== contextGeneration.value) return;
      loadedSources.value = loaded.sources;
      latestSnapshot.value = loaded.snapshot;
      sourceWarning.value = loaded.warning;
      const card = latestSnapshot.value?.plot.chapterCards.find(
        (item) => item.id === props.chapterCardId
      );
      if (
        card?.outlineSelection?.status === "needs-recheck" ||
        loaded.sources.some(
          (source) =>
            source.role === "outline" &&
            source.outlineState === "selected-stale"
        )
      )
        sourceWarning.value =
          "当前选定的大纲需要重新核对，仍可查找原文，但暂不能调用模型。";
    } catch (reason) {
      if (generation !== contextGeneration.value) return;
      error.value = errorMessage(reason, "读取本章资料失败。");
      loadedSources.value = [];
    } finally {
      if (generation === contextGeneration.value) loading.value = false;
    }
  }

  async function runRequirementCheck(): Promise<void> {
    if (
      running.value ||
      !requirementInstructions.value.trim() ||
      !reviewModelId.value
    )
      return;
    running.value = true;
    const generation = contextGeneration.value;
    const runBookId = props.bookId;
    const runChapterId = props.chapterCardId;
    error.value = "";
    try {
      if (outlineNeedsRecheck.value)
        throw new Error("当前选定的大纲需要重新核对后才能检查。");
      const prepared = await prepareNovelRun(
        runBookId,
        runChapterId,
        loadedSources.value
      );
      const task = await startNovelTask(
        runBookId,
        prepared.id,
        reviewModelId.value,
        novelReviewPrompt(
          prepared,
          requirementInstructions.value.trim(),
          outlineSelectionDescription(latestSnapshot.value, runChapterId)
        ),
        "review"
      );
      if (generation !== contextGeneration.value) {
        await cancelNovelTask(runBookId, task.id);
        return;
      }
      const finished = await waitNovelTask(runBookId, task, (id, active) =>
        setTaskActive(runBookId, id, active)
      );
      if (generation !== contextGeneration.value) return;
      const result = parseNovelReview(
        finished,
        runBookId,
        runChapterId,
        loadedSources.value
      );
      reviewResult.value = result;
      if (
        result.checks.some(
          (check) => check.status === "supported" && !check.evidence.length
        )
      )
        throw new Error("有条目没有提供原文证据，已要求重新核对。");
      const latest = await window.deepwrite?.long.getWorkspaceIndex({
        bookId: runBookId
      });
      if (generation !== contextGeneration.value) return;
      if (!latest || latest.bookId !== runBookId)
        throw new Error("当前作品已变化，不能显示这份核对结果。");
      latestSnapshot.value = latest.workspaceIndex;
      const changed = loadedSources.value.some(
        (source) =>
          !hasCurrentNovelSourceVersion(
            latest.workspaceIndex,
            source.fileId,
            source.updatedAt
          )
      );
      if (changed) {
        sourceWarning.value =
          "检查完成后原文又发生变化；相关结论已标为需要重新核对。";
        await loadSources();
      } else uiMessage.success("本章要求核对完成。");
    } catch (reason) {
      if (generation === contextGeneration.value)
        error.value = errorMessage(reason, "本章要求核对失败。");
    } finally {
      if (generation === contextGeneration.value) running.value = false;
    }
  }

  async function runPlotCandidates(): Promise<void> {
    if (
      running.value ||
      !candidatePrompt.value.trim() ||
      !candidateModelIds.value.length ||
      !loadedSources.value.length
    )
      return;
    running.value = true;
    const generation = contextGeneration.value;
    const runBookId = props.bookId;
    const runChapterId = props.chapterCardId;
    const runPrompt = candidatePrompt.value.trim();
    error.value = "";
    try {
      if (outlineNeedsRecheck.value)
        throw new Error("当前选定的大纲需要重新核对后才能调用模型。");
      const prepared = await prepareNovelRun(
        runBookId,
        runChapterId,
        loadedSources.value
      );
      const prompts = candidateModelIds.value
        .slice(0, 3)
        .map(async (modelId) => {
          const task = await startNovelTask(
            runBookId,
            prepared.id,
            modelId,
            novelCandidatePrompt(
              prepared,
              runPrompt,
              outlineSelectionDescription(latestSnapshot.value, runChapterId)
            ),
            "brainstorm"
          );
          if (generation !== contextGeneration.value) {
            await cancelNovelTask(runBookId, task.id);
            throw new Error("章节已切换，已停止旧任务。");
          }
          return waitNovelTask(runBookId, task, (id, active) =>
            setTaskActive(runBookId, id, active)
          );
        });
      const results = await Promise.allSettled(prompts);
      const fulfilled = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      if (!fulfilled.length) {
        const failed = results.find((result) => result.status === "rejected");
        throw failed?.status === "rejected"
          ? failed.reason
          : new Error("所有候选任务都失败了。");
      }
      if (generation !== contextGeneration.value) return;
      const result = makeNovelCandidateSet(
        runBookId,
        runChapterId,
        runPrompt,
        loadedSources.value,
        fulfilled,
        new Map(availableModels.value.map(({ id, label }) => [id, label])),
        selectedOutlineRecord(latestSnapshot.value, runChapterId)
      );
      candidateNotice.value =
        fulfilled.length < prompts.length
          ? `${fulfilled.length} 个模型返回了候选，${prompts.length - fulfilled.length} 个模型运行失败。`
          : "";
      const latest = await window.deepwrite?.long.getWorkspaceIndex({
        bookId: runBookId
      });
      if (generation !== contextGeneration.value) return;
      if (!latest || latest.bookId !== runBookId)
        throw new Error("当前作品已变化，已停止显示候选。");
      latestSnapshot.value = latest.workspaceIndex;
      const changed = loadedSources.value.some(
        (source) =>
          !hasCurrentNovelSourceVersion(
            latest.workspaceIndex,
            source.fileId,
            source.updatedAt
          )
      );
      if (changed) await loadSources();
      candidateSet.value = result;
      candidateTaskIds.value = Object.fromEntries(
        result.candidates.map((candidate, index) => [
          candidate.id,
          fulfilled[index]!.id
        ])
      );
      selectedCandidateId.value = "";
      candidateSaved.value = false;
    } catch (reason) {
      if (generation === contextGeneration.value)
        error.value = errorMessage(reason, "剧情候选生成失败。");
    } finally {
      if (generation === contextGeneration.value) running.value = false;
    }
  }

  async function searchPrevious(): Promise<void> {
    if (!searchQuestion.value.trim()) return;
    const generation = contextGeneration.value;
    searchLoading.value = true;
    error.value = "";
    searchRows.value = [];
    try {
      const result = await searchNovelPreviousText(
        props.bookId,
        props.chapterCardId,
        searchQuestion.value,
        searchScope.value
      );
      if (generation !== contextGeneration.value) return;
      searchQueries.value = result.queries;
      searchRows.value = result.hits;
      latestSnapshot.value = result.snapshot;
      if (!searchRows.value.length)
        uiMessage.info("没有找到可核验的原文片段。");
    } catch (reason) {
      if (generation === contextGeneration.value)
        error.value = errorMessage(reason, "查找前文失败。");
    } finally {
      if (generation === contextGeneration.value) searchLoading.value = false;
    }
  }

  function updateSearchScope(value: PopupSelectValue): void {
    if (value === "draft" || value === "all") searchScope.value = value;
  }
  function chooseCandidate(id: string): void {
    selectedCandidateId.value = selectedCandidateId.value === id ? "" : id;
  }

  function setTaskActive(
    bookId: string,
    taskId: string,
    active: boolean
  ): void {
    if (active) activeTaskBooks.set(taskId, bookId);
    else activeTaskBooks.delete(taskId);
    activeTaskIds.value = active
      ? [...new Set([...activeTaskIds.value, taskId])]
      : activeTaskIds.value.filter((id) => id !== taskId);
  }

  function errorMessage(reason: unknown, fallback: string): string {
    return reason instanceof Error ? reason.message : fallback;
  }

  function selectedOutlineRecord(
    snapshot: LongWorkspaceIndexSnapshot | null,
    chapterCardId: string
  ): NovelPlotCandidateSet["outlineSelection"] {
    const selection = snapshot?.plot.chapterCards.find(
      (chapter) => chapter.id === chapterCardId
    )?.outlineSelection;
    return selection
      ? {
          version: selection.version,
          sha256: selection.sha256,
          ...(selection.status ? { status: selection.status } : {})
        }
      : undefined;
  }

  async function cancelTask(): Promise<void> {
    if (!activeTaskIds.value.length) return;
    const taskIds = [...activeTaskIds.value];
    activeTaskIds.value = [];
    try {
      await Promise.all(
        taskIds.map((taskId) =>
          cancelNovelTask(activeTaskBooks.get(taskId) ?? props.bookId, taskId)
        )
      );
      taskIds.forEach((taskId) => activeTaskBooks.delete(taskId));
    } catch (reason) {
      error.value = errorMessage(reason, "停止任务失败。");
    }
  }
  async function saveSelectedCandidate(): Promise<void> {
    const id = selectedCandidateId.value;
    const taskId = candidateTaskIds.value[id];
    if (
      !id ||
      !taskId ||
      !currentCandidateSet.value ||
      candidateSaved.value ||
      savingCandidate.value
    )
      return;
    savingCandidate.value = true;
    const generation = contextGeneration.value;
    const bookId = props.bookId;
    try {
      const loaded = await readNovelChapterSources(
        bookId,
        props.chapterCardId,
        props.snapshot
      );
      if (generation !== contextGeneration.value) return;
      loadedSources.value = loaded.sources;
      latestSnapshot.value = loaded.snapshot;
      if (
        !candidateSetIsCurrent(
          candidateSet.value!,
          bookId,
          props.chapterCardId,
          loaded.sources,
          selectedOutlineRecord(loaded.snapshot, props.chapterCardId)
        )
      )
        throw new Error("大纲或正文已有更新；请重新生成候选后再保存。");
      await saveNovelCandidate(bookId, taskId);
      if (generation !== contextGeneration.value) return;
      candidateSaved.value = true;
      uiMessage.success("已保存为讨论候选，不会自动登记为正典。");
    } catch (reason) {
      if (generation !== contextGeneration.value) return;
      error.value = errorMessage(reason, "保存候选失败。");
    } finally {
      savingCandidate.value = false;
    }
  }
  async function openSearchHit(row: SearchResultRow): Promise<void> {
    const current = await window.deepwrite?.long.getWorkspaceIndex({
      bookId: props.bookId
    });
    if (!current || current.bookId !== props.bookId) {
      error.value = "当前作品已变化，无法打开这条原文。";
      return;
    }
    const hitIsCurrent = hasCurrentNovelSourceVersion(
      current.workspaceIndex,
      row.fileId,
      row.updatedAt
    );
    if (!hitIsCurrent) {
      error.value = "工作区已经更新，请重新查找后打开这段原文。";
      return;
    }
    emit("openFile", row.fileId, row.start);
  }
  async function openCheckedSource(
    fileId: string,
    updatedAt: string,
    offset?: number
  ): Promise<void> {
    const current = await window.deepwrite?.long.getWorkspaceIndex({
      bookId: props.bookId
    });
    if (
      !current ||
      current.bookId !== props.bookId ||
      !hasCurrentNovelSourceVersion(current.workspaceIndex, fileId, updatedAt)
    ) {
      error.value = "这份原文已更新，相关结论已失效；请刷新后重新核对。";
      await loadSources();
      return;
    }
    emit("openFile", fileId, offset);
  }
  async function loadModels(): Promise<void> {
    try {
      const settings = await window.deepwrite?.models?.list();
      const configured =
        settings?.models.filter((model) => model.hasApiKey) ?? [];
      availableModels.value = configured.map(({ id, label, hasApiKey }) => ({
        id,
        label,
        hasApiKey
      }));
      reviewModelId.value = configured.some(
        (model) => model.id === settings?.defaultModelId
      )
        ? settings!.defaultModelId
        : (configured[0]?.id ?? "");
      candidateModelIds.value = configured.slice(0, 3).map((model) => model.id);
    } catch (reason) {
      error.value = errorMessage(reason, "读取已配置模型失败。");
    }
  }
  function updateCandidateModels(values: readonly PopupSelectValue[]): void {
    candidateModelIds.value = values
      .map(String)
      .filter((id) => availableModels.value.some((model) => model.id === id))
      .slice(0, 3);
  }

  onMounted(() => {
    void loadSources();
    void loadModels();
  });

  return {
    loading,
    running,
    error,
    loadedSources,
    latestSnapshot,
    sourceWarning,
    requirementInstructions,
    checkedRows,
    searchQuestion,
    searchQueries,
    searchScope,
    searchLoading,
    searchRows,
    candidatePrompt,
    candidateSet,
    selectedCandidateId,
    availableModels,
    reviewModelId,
    candidateModelIds,
    candidateSaved,
    activeTaskIds,
    savingCandidate,
    candidateNotice,
    selectedChapter,
    outlineNeedsRecheck,
    searchScopeOptions,
    reviewModelOptions,
    candidateModelOptions,
    currentCandidateSet,
    t,
    loadSources,
    runRequirementCheck,
    updateSearchScope,
    searchPrevious,
    updateCandidateModels,
    runPlotCandidates,
    cancelTask,
    chooseCandidate,
    saveSelectedCandidate,
    openSearchHit,
    openCheckedSource
  };
}
