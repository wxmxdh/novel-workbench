import { computed, onMounted, reactive, ref } from "vue";
import type {
  OtterProject,
  OtterProjectView,
  OtterRouteInput,
  OtterWorkflowInput
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { otterSection } from "../../utils/otter-navigation";

type RouteTask = OtterRouteInput["task"];
type WorkflowAction = OtterWorkflowInput["action"];
type JsonRecord = Record<string, unknown>;
type TranslationKey =
  | "commandPrepare"
  | "commandPreflight"
  | "commandDeliverPlan"
  | "commandSelectOutline"
  | "commandDeliverDraft"
  | "commandAccept"
  | "commandCandidates"
  | "commandDecision"
  | "commandCommit"
  | "commandDerived"
  | "draft"
  | "continue"
  | "revise"
  | "review"
  | "plan"
  | "discuss";
type ReadingPosition = {
  projectId: string | null;
  projectRelativePath: string | null;
  projectTitle: string;
  volume: string | null;
  chapter: string | null;
  activeDocumentPath: string | null;
  annotationEntryPath: string | null;
};
type ReadingContext = {
  current: {
    projectId: string | null;
    projectRelativePath: string | null;
    volume: string | null;
    chapter: string | null;
    activeDocumentPath: string | null;
    annotationEntryPath: string | null;
    conflict: boolean;
  };
  candidates: ReadingPosition[];
};
type StudioApi = {
  createProject(input: { title: string }): Promise<{ projectId: string }>;
  readingContext(input?: { savedProjectId?: string }): Promise<ReadingContext>;
};

export function useOtterWorkbench(options: { autoRefresh?: boolean } = {}) {
  const t = createScopedTranslator("components.otterWorkbench");

  function reportError(message: string): void {
    error.value = message;
    uiMessage.error(message);
  }
  const tab = otterSection;
  const workspaceRoot = ref("");
  const projects = ref<OtterProject[]>([]);
  const projectId = ref("");
  const projectView = ref<OtterProjectView | null>(null);
  const loading = ref(false);
  const busy = ref("");
  const error = ref("");
  const filter = ref("");
  const selectedPath = ref("");
  const document = ref<{ path: string; content: string; hash: string } | null>(
    null
  );
  const task = ref<RouteTask>("draft");
  const chapter = ref(1);
  const volume = ref("");
  const contextPath = ref("");
  const receiptPath = ref("");
  const planPath = ref("");
  const workflowAction = ref<WorkflowAction>("prepare");
  const workflowInput = ref("{}");
  const taskPov = ref("");
  const taskTarget = ref("");
  const taskAuthorInstructions = ref("");
  const taskCharacters = ref("");
  const taskRelationships = ref("");
  const taskKnowledgeBoundary = ref("");
  const taskUnknowns = ref("");
  const taskScope = ref<"chapter" | "fragment">("chapter");
  const volumeEvidencePath = ref("");
  const volumeEvidenceQuote = ref("");
  const authorizationPath = ref("");
  const authorizationQuote = ref("");
  const sourceRefsJson = ref("[]");
  const sourceSelections = reactive({
    character: { path: "", section: "" },
    relationship: { path: "", section: "" },
    timeline: { path: "", section: "" },
    knowledge: { path: "", section: "" },
    scene: { path: "", section: "" },
    unknown: { path: "", section: "" }
  });
  const authorIntent = ref("");
  const routeResult = ref<JsonRecord | null>(null);
  const workflowResult = ref<JsonRecord | null>(null);
  const contextResult = ref<{
    contextId: string;
    baselineHash: string;
    comparisonBaselineHash: string | null;
    apiText: string;
    agentText: string;
  } | null>(null);
  const contextView = ref<"api" | "agent">("api");
  const candidateTitle = ref("");
  const candidateBody = ref("");
  const candidateAuthorIntent = ref("");
  const candidateSource = ref<{ body: string; runId?: string } | null>(null);
  const readingContext = ref<ReadingContext | null>(null);
  const createProjectOpen = ref(false);
  const newProjectTitle = ref("");

  const documents = computed(() => {
    const all = projectView.value?.documents ?? [];
    const query = filter.value.trim().toLowerCase();
    if (!query) return all;
    return all.filter((item) =>
      `${item.title} ${item.path} ${item.category}`
        .toLowerCase()
        .includes(query)
    );
  });
  const selectedProject = computed(
    () => projects.value.find((item) => item.id === projectId.value) ?? null
  );
  const projectOptions = computed(() =>
    projects.value.map((item) => ({ value: item.id, label: item.title }))
  );
  const projectDocumentOptions = computed(() =>
    (projectView.value?.documents ?? [])
      .filter((item) =>
        /\.(?:md|markdown|txt|json|jsonl|ya?ml|csv)$/i.test(item.path)
      )
      .map((item) => ({
        value: item.path,
        label: `${item.title} · ${item.path}`
      }))
  );
  const planDocumentOptions = computed(() =>
    projectDocumentOptions.value.filter((item) =>
      projectView.value?.documents.some(
        (document) =>
          document.path === item.value && document.category === "plan"
      )
    )
  );
  const currentContext = computed(() =>
    projectId.value && contextResult.value
      ? {
          projectId: projectId.value,
          contextPath: contextPath.value,
          ...(receiptPath.value ? { receiptPath: receiptPath.value } : {})
        }
      : null
  );
  const chatContext = computed(() =>
    currentContext.value && contextResult.value
      ? { ...currentContext.value, contextId: contextResult.value.contextId }
      : null
  );
  const originalDraft = computed(() => document.value?.content ?? "");
  const workflowActions: WorkflowAction[] = [
    "prepare",
    "preflight",
    "deliver-plan",
    "select-outline",
    "deliver-draft",
    "accept",
    "candidates",
    "decision",
    "commit",
    "derived"
  ];
  const workflowActionLabels: Record<WorkflowAction, TranslationKey> = {
    prepare: "commandPrepare",
    preflight: "commandPreflight",
    "deliver-plan": "commandDeliverPlan",
    "select-outline": "commandSelectOutline",
    "deliver-draft": "commandDeliverDraft",
    accept: "commandAccept",
    candidates: "commandCandidates",
    decision: "commandDecision",
    commit: "commandCommit",
    derived: "commandDerived"
  };
  const taskLabels: Record<RouteTask, TranslationKey> = {
    draft: "draft",
    continue: "continue",
    revise: "revise",
    review: "review",
    plan: "plan",
    discuss: "discuss"
  };
  const taskOptions = computed(() =>
    (Object.keys(taskLabels) as RouteTask[]).map((value) => ({
      value,
      label: t(taskLabels[value])
    }))
  );
  const workflowActionOptions = computed(() =>
    workflowActions.map((value) => ({
      value,
      label: t(workflowActionLabels[value])
    }))
  );
  const requiresIntent = computed(() =>
    ["accept", "decision", "commit"].includes(workflowAction.value)
  );

  function api() {
    const value = window.deepwrite?.otter;
    if (!value) throw new Error(t("apiUnavailable"));
    return value;
  }

  function format(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  async function refreshProjects(preserve = true): Promise<void> {
    const service = api();
    const settings = await service.settings();
    workspaceRoot.value = settings.workspaceRoot ?? "";
    projects.value = await service.projects();
    if (
      !preserve ||
      !projects.value.some((item) => item.id === projectId.value)
    )
      projectId.value = "";
    if (projectId.value) await openProject();
    await loadReadingContext();
  }

  async function loadReadingContext(): Promise<void> {
    const port = window.deepwrite?.otter as unknown as StudioApi | undefined;
    if (!port) return;
    try {
      readingContext.value = await port.readingContext(
        projectId.value
          ? { savedProjectId: projectId.value }
          : localStorage.getItem("otter.savedProjectId")
            ? { savedProjectId: localStorage.getItem("otter.savedProjectId")! }
            : undefined
      );
    } catch (reason) {
      error.value = formatError(reason, t("apiUnavailable"));
    }
  }

  async function createProject(): Promise<void> {
    const title = newProjectTitle.value.trim();
    const port = window.deepwrite?.otter as unknown as StudioApi | undefined;
    if (!port || !title) return;
    busy.value = "create-project";
    try {
      const created = await port.createProject({ title });
      newProjectTitle.value = "";
      createProjectOpen.value = false;
      await refreshProjects(false);
      projectId.value = created.projectId;
      localStorage.setItem("otter.savedProjectId", created.projectId);
      await openProject();
      tab.value = "story";
    } catch (reason) {
      reportError(formatError(reason, t("apiUnavailable")));
    } finally {
      busy.value = "";
    }
  }

  async function restoreReadingPosition(position: {
    projectId: string | null;
    activeDocumentPath: string | null;
    annotationEntryPath: string | null;
  }): Promise<void> {
    if (!position.projectId) return;
    projectId.value = position.projectId;
    localStorage.setItem("otter.savedProjectId", position.projectId);
    await openProject();
    const target = position.activeDocumentPath ?? position.annotationEntryPath;
    if (target) await openDocument(target);
    tab.value = "workflow";
  }

  async function chooseWorkspace(): Promise<void> {
    error.value = "";
    try {
      const chosen = await api().chooseWorkspace();
      if (chosen) await refreshProjects(false);
    } catch (reason) {
      reportError(formatError(reason, t("apiUnavailable")));
    }
  }

  let projectOpenEpoch = 0;
  let documentReadEpoch = 0;
  async function openProject(): Promise<void> {
    const epoch = ++projectOpenEpoch;
    const id = projectId.value;
    ++documentReadEpoch;
    if (!projectId.value) return;
    loading.value = true;
    error.value = "";
    projectView.value = null;
    document.value = null;
    contextResult.value = null;
    candidateSource.value = null;
    try {
      const view = await api().open({ projectId: id });
      if (epoch !== projectOpenEpoch || id !== projectId.value) return;
      projectView.value = view;
      const preferred =
        view.documents.find((item) => item.path === view.activeSource) ??
        view.documents[0];
      if (preferred) await openDocument(preferred.path);
    } catch (reason) {
      if (epoch === projectOpenEpoch && id === projectId.value)
        error.value = formatError(reason, t("apiUnavailable"));
    } finally {
      if (epoch === projectOpenEpoch) loading.value = false;
    }
  }

  async function selectProject(value: string): Promise<void> {
    projectId.value = value;
    if (value) localStorage.setItem("otter.savedProjectId", value);
    await openProject();
    await loadReadingContext();
  }

  function selectTask(value: string): void {
    if (value in taskLabels) task.value = value as RouteTask;
  }

  function selectWorkflowAction(value: string): void {
    if (workflowActions.includes(value as WorkflowAction))
      workflowAction.value = value as WorkflowAction;
  }

  function selectScope(value: string): void {
    if (value === "chapter" || value === "fragment") taskScope.value = value;
  }

  function selectTarget(value: string): void {
    taskTarget.value = value;
  }

  function selectVolumeEvidence(value: string): void {
    volumeEvidencePath.value = value;
  }

  function selectAuthorizationEvidence(value: string): void {
    authorizationPath.value = value;
  }

  function selectPlan(value: string): void {
    planPath.value = value;
  }

  async function openDocument(path: string): Promise<void> {
    if (!projectId.value || !path) return;
    const epoch = ++documentReadEpoch;
    const id = projectId.value;
    busy.value = "read";
    error.value = "";
    try {
      const result = await api().read({ projectId: id, path });
      if (epoch !== documentReadEpoch || id !== projectId.value) return;
      document.value = result;
      selectedPath.value = path;
    } catch (reason) {
      if (epoch === documentReadEpoch && id === projectId.value)
        error.value = formatError(reason, t("apiUnavailable"));
    } finally {
      if (epoch === documentReadEpoch) busy.value = "";
    }
  }

  async function runRoute(): Promise<void> {
    if (
      !projectId.value ||
      !Number.isInteger(chapter.value) ||
      chapter.value < 1
    )
      return;
    busy.value = "route";
    error.value = "";
    try {
      const result = await api().route({
        projectId: projectId.value,
        task: task.value,
        chapter: chapter.value,
        ...(volume.value.trim() ? { volume: volume.value.trim() } : {})
      });
      routeResult.value = result.result;
    } catch (reason) {
      error.value = formatError(reason, t("apiUnavailable"));
    } finally {
      busy.value = "";
    }
  }

  function parseInput(): JsonRecord {
    const value: unknown = JSON.parse(workflowInput.value);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Input must be a JSON object.");
    return value as JsonRecord;
  }

  function splitLines(value: string): string[] {
    return value
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function artifactPath(
    value: unknown,
    directory: string,
    prefix: string
  ): string | null {
    if (typeof value !== "string") return null;
    const name = value.split(/[\\/]/).pop() ?? "";
    return new RegExp(`^${prefix}[\\w-]+\\.json$`).test(name)
      ? `${directory}/${name}`
      : null;
  }

  async function readEvidenceHash(path: string): Promise<string> {
    if (!projectId.value || !path.trim())
      throw new Error(t("requiredEvidence"));
    return (await api().read({ projectId: projectId.value, path: path.trim() }))
      .hash;
  }

  async function buildPrepareInput(): Promise<JsonRecord> {
    if (
      !selectedProject.value ||
      !taskPov.value.trim() ||
      !taskTarget.value.trim()
    )
      throw new Error(t("requiredTaskFields"));
    const characters = splitLines(taskCharacters.value);
    const instructions = splitLines(taskAuthorInstructions.value);
    if (!characters.length || !instructions.length)
      throw new Error(t("requiredTaskFields"));
    const selectedOutline = planPath.value.trim();
    const references: unknown = JSON.parse(sourceRefsJson.value);
    if (!Array.isArray(references)) throw new Error(t("sourceRefsMustBeArray"));
    const volumeName = volume.value.trim();
    const volumeProofPath = volumeEvidencePath.value.trim();
    if (!volumeName || !volumeProofPath || !volumeEvidenceQuote.value.trim())
      throw new Error(t("requiredVolumeEvidence"));
    const volumeProof = volumeName
      ? {
          actor: "user",
          scope: {
            project: selectedProject.value.title,
            chapter: chapter.value,
            volume: volumeName
          },
          path: volumeProofPath,
          hash: await readEvidenceHash(volumeProofPath),
          quote: volumeEvidenceQuote.value.trim()
        }
      : undefined;
    const taskName = task.value === "discuss" ? "discussion" : task.value;
    const relationships = splitLines(taskRelationships.value);
    const sources: Array<Record<string, unknown>> = Object.entries(
      sourceSelections
    ).flatMap(([role, selection]) =>
      selection.path.trim() && selection.section.trim()
        ? [
            {
              path: selection.path.trim(),
              role,
              section: selection.section.trim(),
              ...(role === "character" ? { entities: characters } : {}),
              ...(role === "relationship" ? { entities: relationships } : {})
            }
          ]
        : []
    );
    if (
      Object.values(sourceSelections).some(
        (selection) => !selection.path.trim() || !selection.section.trim()
      )
    )
      throw new Error(t("requiredV1Sources"));
    if (["review", "revise"].includes(taskName))
      sources.push({
        path: taskTarget.value.trim(),
        role: "text",
        section: t("selectedTargetSource")
      });
    sources.push(...(references as Array<Record<string, unknown>>));
    const authorizationEvidence = authorizationPath.value.trim();
    if (
      ["draft", "continue", "revise"].includes(taskName) &&
      (!authorizationEvidence || !authorizationQuote.value.trim())
    )
      throw new Error(t("requiredAuthorizationEvidence"));
    const authorization = ["draft", "continue", "revise"].includes(taskName)
      ? {
          action: taskName,
          scope: taskTarget.value.trim(),
          evidence: {
            path: authorizationEvidence,
            hash: await readEvidenceHash(authorizationEvidence),
            quote: authorizationQuote.value.trim()
          }
        }
      : undefined;
    return {
      schema_version: 1,
      task_id: `TASK-${crypto.randomUUID()}`,
      context_id: `CTX-${crypto.randomUUID()}`,
      project: selectedProject.value.title,
      task: taskName,
      chapter: chapter.value,
      ...(volumeName
        ? { volume: volumeName, volume_confirmation: volumeProof }
        : {}),
      scope: taskScope.value,
      pov: taskPov.value.trim(),
      target: taskTarget.value.trim(),
      relevant_characters: characters,
      relevant_relationships: relationships,
      knowledge_boundary: splitLines(taskKnowledgeBoundary.value),
      intentional_unknowns: splitLines(taskUnknowns.value),
      recent_context: [],
      author_instructions: instructions,
      ...(authorization ? { authorization } : {}),
      skills_allowed: ["otter-novel"],
      reference_scope: [],
      forbidden_future_info: [],
      sources,
      ...(selectedOutline ? { plan: selectedOutline } : {})
    };
  }

  async function runWorkflow(action = workflowAction.value): Promise<void> {
    if (!projectId.value) return;
    if (requiresIntent.value && !authorIntent.value.trim()) {
      reportError(t("requiredIntent"));
      return;
    }
    if (
      ["accept", "decision", "commit"].includes(action) &&
      !window.confirm(
        `${action}: ${authorIntent.value.trim()}\n\n${t("confirmAuthorAction")}`
      )
    )
      return;
    busy.value = action;
    error.value = "";
    try {
      const input =
        action === "prepare" ? await buildPrepareInput() : parseInput();
      const result = await api().workflow({
        projectId: projectId.value,
        action,
        input,
        ...(contextPath.value.trim()
          ? { contextPath: contextPath.value.trim() }
          : {}),
        ...(receiptPath.value.trim()
          ? { receiptPath: receiptPath.value.trim() }
          : {}),
        ...(planPath.value.trim() ? { planPath: planPath.value.trim() } : {}),
        ...(authorIntent.value.trim()
          ? { authorIntent: authorIntent.value.trim() }
          : {})
      });
      workflowResult.value = result.result;
      if (action === "prepare") {
        contextPath.value =
          artifactPath(result.result.pack, ".novel/context", "CTX-") ??
          contextPath.value;
        receiptPath.value =
          artifactPath(result.result.receipt, ".novel/receipts", "RCPT-") ??
          receiptPath.value;
      }
    } catch (reason) {
      error.value = formatError(reason, t("apiUnavailable"));
    } finally {
      busy.value = "";
    }
  }

  async function loadContext(): Promise<void> {
    if (!projectId.value || !contextPath.value.trim()) {
      reportError(t("requiredPaths"));
      return;
    }
    busy.value = "context";
    error.value = "";
    try {
      contextResult.value = await api().context({
        projectId: projectId.value,
        contextPath: contextPath.value.trim(),
        ...(receiptPath.value.trim()
          ? { receiptPath: receiptPath.value.trim() }
          : {})
      });
    } catch (reason) {
      error.value = formatError(reason, t("apiUnavailable"));
    } finally {
      busy.value = "";
    }
  }

  function useAssistantReply(content: string, runId?: string): void {
    candidateBody.value = content;
    candidateSource.value = runId
      ? { body: content, runId }
      : { body: content };
    if (!candidateTitle.value)
      candidateTitle.value = `第${String(chapter.value).padStart(3, "0")}章候选稿`;
    tab.value = "workflow";
  }

  async function stageDraft(): Promise<void> {
    if (
      !currentContext.value ||
      !receiptPath.value.trim() ||
      !candidateTitle.value.trim() ||
      !candidateBody.value.trim() ||
      !candidateAuthorIntent.value.trim()
    ) {
      reportError(t("requiredStageFields"));
      return;
    }
    if (!window.confirm(t("confirmStageDraft"))) return;
    busy.value = "stage";
    error.value = "";
    try {
      const originRunId =
        candidateSource.value?.runId &&
        candidateSource.value.body === candidateBody.value
          ? candidateSource.value.runId
          : undefined;
      const result = await api().stageDraft({
        ...currentContext.value,
        receiptPath: receiptPath.value.trim(),
        body: candidateBody.value,
        title: candidateTitle.value.trim(),
        authorIntent: candidateAuthorIntent.value.trim(),
        ...(originRunId ? { originRunId } : {})
      });
      workflowResult.value = result.result;
    } catch (reason) {
      error.value = formatError(reason, t("apiUnavailable"));
    } finally {
      busy.value = "";
    }
  }

  if (options.autoRefresh !== false) {
    onMounted(() => {
      void refreshProjects(false).catch((reason: unknown) => {
        error.value = formatError(reason, t("apiUnavailable"));
      });
    });
  }
  return {
    t,
    tab,
    workspaceRoot,
    projects,
    projectId,
    projectView,
    loading,
    busy,
    error,
    filter,
    selectedPath,
    document,
    task,
    chapter,
    volume,
    contextPath,
    receiptPath,
    planPath,
    workflowAction,
    workflowInput,
    taskPov,
    taskTarget,
    taskAuthorInstructions,
    taskCharacters,
    taskRelationships,
    taskKnowledgeBoundary,
    taskUnknowns,
    taskScope,
    volumeEvidencePath,
    volumeEvidenceQuote,
    authorizationPath,
    authorizationQuote,
    sourceRefsJson,
    sourceSelections,
    authorIntent,
    routeResult,
    workflowResult,
    contextResult,
    contextView,
    candidateTitle,
    candidateBody,
    candidateAuthorIntent,
    candidateSource,
    readingContext,
    createProjectOpen,
    newProjectTitle,
    documents,
    selectedProject,
    projectOptions,
    projectDocumentOptions,
    planDocumentOptions,
    currentContext,
    chatContext,
    originalDraft,
    workflowActions,
    workflowActionLabels,
    workflowActionOptions,
    taskLabels,
    taskOptions,
    requiresIntent,
    format,
    refreshProjects,
    loadReadingContext,
    createProject,
    restoreReadingPosition,
    chooseWorkspace,
    openProject,
    selectProject,
    selectTask,
    selectWorkflowAction,
    selectScope,
    selectTarget,
    selectVolumeEvidence,
    selectAuthorizationEvidence,
    selectPlan,
    openDocument,
    runRoute,
    parseInput,
    splitLines,
    artifactPath,
    readEvidenceHash,
    buildPrepareInput,
    runWorkflow,
    loadContext,
    useAssistantReply,
    stageDraft
  };
}

export type OtterWorkbenchModel = ReturnType<typeof useOtterWorkbench>;
