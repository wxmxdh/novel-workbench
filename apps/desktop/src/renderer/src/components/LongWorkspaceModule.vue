<script setup lang="ts">
import { builtinAgentLabel } from "../i18n/builtinLabels";
import { createScopedTranslator } from "../i18n";
import { computed, watch, ref, defineAsyncComponent } from "vue";
import {
  PROMPT_ATTACHMENT_MAX_ITEMS,
  PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH
} from "@deepwrite/contracts";
import type {
  AgentTeamRunMode,
  LongArcId,
  LongAgentProfile,
  LongBookSummary,
  LongChapterCardId,
  LongCharacterId,
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch,
  LongWriteDocumentResult,
  TextViewMode,
  ThinkingLevel,
  WorkspacePaneLayout
} from "@deepwrite/contracts";
import type {
  LongSourceAuthority,
  LongSourcePurpose,
  UserPromptAttachment
} from "@deepwrite/contracts";
import type { AgentConversationController } from "../composables/useAgentConversation";
import { useLongWorkspaceModuleEditorBridge } from "../composables/useLongWorkspaceModuleEditorBridge";
import { usePendingEditorReferences } from "../composables/usePendingEditorReferences";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { LongWorkspaceEditorPort } from "../composables/useLongWorkspaceSessionCoordinator";
import type {
  LongWorkspaceFileContext,
  LongWorkspaceRefreshStatus
} from "../stores/longWorkspaceStore";
import type {
  AgentApprovalMode,
  ComposerReferenceOption,
  ConversationMessageRewriteRequest
} from "../types/conversation";
import type {
  LongStructureMutationCompletion,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import { LONG_WORKSPACE_ROOT_LABELS } from "../utils/longWorkspaceResourceTree";
import { uiMessage } from "../ui-feedback";
import AgentConversation from "./AgentConversation.vue";
import AppIcon from "./AppIcon.vue";
import LongWorkspaceEditor from "./LongWorkspaceEditor.vue";
import LongWorkspaceLoading from "./LongWorkspaceLoading.vue";
import LongWorkspacePanePlaceholder from "./LongWorkspacePanePlaceholder.vue";
import LongLegacyConversationDialog from "./LongLegacyConversationDialog.vue";
import LongSourceImportDialog from "./LongSourceImportDialog.vue";
import LongSourceAttachmentMenu from "./LongSourceAttachmentMenu.vue";
import { localSourceRequestForConversation } from "../utils/localSourceRequest";
const LongBookSourcesDialog = defineAsyncComponent(
  () => import("./LongBookSourcesDialog.vue")
);
const sourceLibraryOpen = ref(false);
const collaborationOpen = ref(false);
const legacyHistoryOpen = ref(false);
const CollaborationWorkspace = defineAsyncComponent(
  () => import("../features/novel-collaboration/CollaborationWorkspace.vue")
);
const sourceLibraryChooseFolder = ref(false);
const sourceLibraryMode = ref<"connect" | "copy">("connect");
const sourceLibrarySuggestedPath = ref<string>();
import {
  useLongSourceImport,
  parseLongSourceImportProposal
} from "../features/long-source-import/useLongSourceImport";
import { detectLongSourceImportIntent } from "../features/long-source-import/intent";
import {
  readUtf8SourceFile,
  SourceFileReadError
} from "../features/long-source-import/source-file";
import type { ChatMessage } from "../types/conversation";
import type { LongProposalLocateTarget } from "../utils/approvalNavigation";

const t = createScopedTranslator("components.longWorkspaceModule");

const props = defineProps<{
  conversationController: AgentConversationController | null;
  legacyConversationController: AgentConversationController | null;
  book: LongBookSummary | null;
  selection: LongWorkspaceSelection | null;
  workspaceIndex: LongWorkspaceIndexSnapshot | null;
  agentProfile: LongAgentProfile | null;
  availableSkillReferences: ComposerReferenceOption[];
  availableMaterialReferences: ComposerReferenceOption[];
  proposalItems: LongWorkspaceProposalItem[];
  refreshStatus: LongWorkspaceRefreshStatus | null;
  runtimeAvailable: boolean;
  sendContextReady: boolean;
  sendPreflightPending: boolean;
  editorLocked: boolean;
  editorLockedReason: string | undefined;
  loading: boolean;
  leftCollapsed: boolean;
  paneLayout: WorkspacePaneLayout;
  defaultTextViewMode: TextViewMode;
  autoSaveEnabled: boolean;
  rightPane: Readonly<{
    collapsed: boolean;
    minWidth: number;
    maxWidth: number;
    width: number;
  }>;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  editorPortChange: [port: LongWorkspaceEditorPort | null];
  expandLeft: [];
  toggleLeft: [];
  toggleRight: [];
  collapseRight: [];
  resizeStart: [event: PointerEvent];
  resizeKeydown: [event: KeyboardEvent];
  newConversation: [];
  selectConversation: [sessionId: string];
  send: [
    request: UserPromptAttachment[] | ConversationMessageRewriteRequest,
    completion?: (started: boolean) => void
  ];
  stop: [];
  suggestion: [value: string];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
  selectTemperature: [temperature: number];
  selectApproval: [mode: AgentApprovalMode];
  selectAgentTeamMode: [mode: AgentTeamRunMode];
  reviewEdit: [
    payload: {
      runId: string;
      proposalId: string;
      decision: "accept" | "reject";
    }
  ];
  locateEditProposal: [payload: { runId: string; proposalId: string }];
  approveLongProposal: [eventId: string];
  rejectLongProposal: [eventId: string];
  retryLongProposalPreview: [eventId: string];
  locateLongProposal: [target: LongProposalLocateTarget];
  retryWorkspaceRefresh: [];
  saved: [result: LongWriteDocumentResult];
  contextChange: [context: LongWorkspaceFileContext | null];
  selectCharacter: [
    characterId: LongCharacterId,
    done?: (accepted: boolean) => void
  ];
  selectPlotPoint: [plotPointId: LongArcId];
  selectChapterCard: [chapterCardId: LongChapterCardId];
  selectEntrySearchResult: [fileId: string];
  renameCharacter: [
    input: { characterId: LongCharacterId; name: string },
    completion: (succeeded: boolean) => void
  ];
  renameStructureTitle: [
    input: {
      kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (succeeded: boolean) => void
  ];
  createCharacter: [];
  createWorldbuildingItem: [];
  createPlotPoint: [];
  createChapterCard: [];
  createVolume: [];
  previewDeleteStructure: [
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
    },
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ];
  deleteStructure: [
    input: {
      kind: "character" | "volume" | "plotPoint" | "chapterCard";
      id: string;
      title: string;
      expectedImpact: LongWorkspaceImpactConfirmation;
    },
    completion: (
      succeeded: boolean,
      changedImpact?: LongWorkspaceImpactConfirmation
    ) => void
  ];
  saveVolumeOutline: [
    input: { volumeId: string; outline: string },
    completion: (succeeded: boolean) => void
  ];
  savePlotPointContent: [
    input: {
      plotPointId: LongArcId;
      field: "summary";
      content: string;
    },
    completion: (succeeded: boolean) => void
  ];
  mutation: [
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ];
  previewMutation: [
    batch: LongWorkspaceOperationBatch,
    completion: (impact?: LongWorkspaceImpactConfirmation) => void
  ];
  sourceImported: [bookId: string, done: (error?: unknown) => void];
}>();

const sourceAttachmentInput = ref<HTMLInputElement | null>(null);
const sourcePickerMode = ref<"manual" | "attach-to-turn">("manual");
const pendingSourceTurnAttachments = ref<UserPromptAttachment[]>([]);
const pendingSourcePrompt = ref("");
const handledSourceProposals = new Set<string>();
const pendingImportRequest = ref<{
  bookId: string;
  sessionId: string;
  prompt: string;
  messageIdsBefore: Set<string>;
  attachments: UserPromptAttachment[];
} | null>(null);
const importDialog = useLongSourceImport({
  api: () => window.deepwrite?.long,
  notifications: {
    error: (message) => uiMessage.error(message),
    success: (message) => uiMessage.success(message),
    warning: (message) => uiMessage.warning(message)
  },
  refreshIndex: (bookId) =>
    new Promise<void>((resolve, reject) =>
      emit("sourceImported", bookId, (error) =>
        error ? reject(error) : resolve()
      )
    )
});

watch(
  [() => props.book?.id, () => props.conversationController?.sessionId.value],
  () => {
    if (collaborationOpen.value) collaborationOpen.value = false;
  },
  { flush: "sync" }
);

function forwardConversationSend(attachments: UserPromptAttachment[]): void {
  const prompt = props.conversationController?.draft.value ?? "";
  const intent = detectLongSourceImportIntent(prompt);
  const localRequest = localSourceRequestForConversation(
    prompt,
    props.book?.id,
    attachments.length > 0,
    props.workspaceIndex?.sourceFolders
  );
  if (localRequest) {
    openSourceFolder("connect", localRequest.suggestedPath);
    return;
  }
  if (
    intent?.kind === "attach-source" &&
    /文件夹|资料库/u.test(prompt) &&
    !attachments.length
  ) {
    openSourceFolder("connect");
    return;
  }
  if (
    intent?.kind === "attach-source" &&
    !attachments.some((item) => item.kind === "text")
  ) {
    sourcePickerMode.value = "attach-to-turn";
    pendingSourceTurnAttachments.value = attachments;
    pendingSourcePrompt.value = prompt;
    sourceAttachmentInput.value?.click();
    return;
  }
  armSourceImportRequest(prompt, attachments, Boolean(intent));
  emit("send", attachments);
}

function receiveDiscussionCandidate(candidateText: string): void {
  if (
    !collaborationOpen.value ||
    !props.book ||
    !props.conversationController
  ) {
    return;
  }
  const currentDraft = props.conversationController?.draft.value ?? "";
  const separator = currentDraft ? "\n\n" : "";
  const nextDraft = `${currentDraft}${separator}${candidateText}`;
  if (nextDraft.length > PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH) {
    uiMessage.warning(t("discussionCandidateTooLarge"));
    return;
  }
  emit("update:draft", nextDraft);
  collaborationOpen.value = false;
}

function openSourceFolder(mode: "connect" | "copy", suggestedPath?: string) {
  sourceLibraryMode.value = mode;
  sourceLibrarySuggestedPath.value = suggestedPath;
  sourceLibraryChooseFolder.value = true;
  sourceLibraryOpen.value = true;
}
function sourceAttachmentAction(action: string, pickFiles: () => void) {
  if (action === "attachment") pickFiles();
  else if (action === "file") {
    sourcePickerMode.value = "manual";
    sourceAttachmentInput.value?.click();
  } else if (action === "copy-folder") openSourceFolder("copy");
  else if (action === "connect-folder") openSourceFolder("connect");
  else {
    sourceLibraryChooseFolder.value = false;
    sourceLibrarySuggestedPath.value = undefined;
    sourceLibraryOpen.value = true;
  }
}

function armSourceImportRequest(
  prompt: string,
  attachments: UserPromptAttachment[],
  requested: boolean
): void {
  if (!requested || !props.book || !props.conversationController) {
    pendingImportRequest.value = null;
    return;
  }
  pendingImportRequest.value = {
    bookId: props.book.id,
    sessionId: props.conversationController.sessionId.value,
    prompt,
    messageIdsBefore: new Set(
      props.conversationController.messages.value.map((message) => message.id)
    ),
    attachments: [...attachments]
  };
}

function sourceImportToolCall(message: ChatMessage) {
  return message.toolCalls?.find(
    (call) =>
      call.name === "propose_long_source_import" &&
      call.status === "completed" &&
      call.argumentsComplete !== false &&
      call.isError !== true
  );
}

function parseProposalToolOutput(value: string | undefined): {
  book_id: string;
  source_name: string;
  title: string;
  purpose: LongSourcePurpose;
  authority: LongSourceAuthority;
} | null {
  if (!value) return null;
  try {
    const result = JSON.parse(value) as Record<string, unknown>;
    if (
      result.type !== "long_source_import_proposal" ||
      typeof result.book_id !== "string" ||
      typeof result.source_name !== "string" ||
      typeof result.title !== "string" ||
      typeof result.purpose !== "string" ||
      typeof result.authority !== "string" ||
      result.saved !== false ||
      result.author_confirmation_required !== true ||
      result.canon_status !== "not_confirmed"
    )
      return null;
    return {
      book_id: result.book_id,
      source_name: result.source_name,
      title: result.title,
      purpose: result.purpose as LongSourcePurpose,
      authority: result.authority as LongSourceAuthority
    };
  } catch {
    return null;
  }
}

watch(
  () => props.conversationController?.messages.value ?? [],
  (messages) => {
    const latest = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" && sourceImportToolCall(message)
      );
    const call = latest && sourceImportToolCall(latest);
    if (
      !latest ||
      !call ||
      handledSourceProposals.has(call.id) ||
      !props.book ||
      !props.workspaceIndex ||
      importDialog.isOpen.value ||
      !pendingImportRequest.value ||
      pendingImportRequest.value.bookId !== props.book.id ||
      pendingImportRequest.value.sessionId !==
        props.conversationController?.sessionId.value ||
      pendingImportRequest.value.messageIdsBefore.has(latest.id)
    )
      return;
    const request = pendingImportRequest.value;
    const assistantIndex = messages.findIndex(
      (message) => message.id === latest.id
    );
    const userMessage = messages
      .slice(0, assistantIndex)
      .reverse()
      .find(
        (message) =>
          message.role === "user" &&
          !request.messageIdsBefore.has(message.id) &&
          (!latest.runId || !message.runId || message.runId === latest.runId)
      );
    if (!userMessage) return;
    handledSourceProposals.add(call.id);
    pendingImportRequest.value = null;
    const output = parseProposalToolOutput(call.resultSummary);
    if (!output || output.book_id !== request.bookId) return;
    const proposal = parseLongSourceImportProposal(call.args);
    if (
      !proposal ||
      output.source_name !== proposal.source_name ||
      output.title !== proposal.title ||
      output.purpose !== proposal.purpose ||
      output.authority !== proposal.authority
    )
      return;
    const attachmentNames = new Set(
      userMessage.attachments?.map((item) => item.name) ?? []
    );
    const turnAttachments = request.attachments.filter(
      (item) => item.kind === "text" && attachmentNames.has(item.name)
    );
    importDialog.open({
      proposal,
      bookId: props.book.id,
      expectedIndexUpdatedAt: props.workspaceIndex.updatedAt,
      attachments: proposal.source_name === "本次讨论" ? [] : turnAttachments
    });
  },
  { deep: true }
);

function onSourceTitle(value: string): void {
  if (importDialog.candidate.value) importDialog.candidate.value.title = value;
}
function onSourcePurpose(value: LongSourcePurpose): void {
  if (importDialog.candidate.value)
    importDialog.candidate.value.purpose = value;
}
function onSourceAuthority(value: LongSourceAuthority): void {
  if (importDialog.candidate.value)
    importDialog.candidate.value.authority = value;
}

function openSourceFilePicker(): void {
  if (!props.book || !props.workspaceIndex) return;
  sourceAttachmentInput.value?.click();
}
async function readSourceFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !props.book || !props.workspaceIndex) return;
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    uiMessage.warning(t("sourceUnsupportedFile"));
    return;
  }
  let content: string;
  try {
    content = await readUtf8SourceFile(file);
  } catch (error: unknown) {
    sourcePickerMode.value = "manual";
    pendingSourceTurnAttachments.value = [];
    pendingSourcePrompt.value = "";
    uiMessage.warning(
      error instanceof SourceFileReadError && error.reason === "too-large"
        ? t("sourceTooLarge")
        : t("sourceInvalidUtf8")
    );
    return;
  }
  if (sourcePickerMode.value === "attach-to-turn") {
    sourcePickerMode.value = "manual";
    if (content.length > 100_000) {
      pendingSourceTurnAttachments.value = [];
      uiMessage.warning(t("sourceTurnTooLong"));
    } else {
      const sourceAttachment: UserPromptAttachment = {
        kind: "text",
        id: `source-turn-${crypto.randomUUID()}`,
        name: file.name,
        mediaType: file.type || "text/plain",
        size: file.size,
        content
      };
      const allAttachments = [
        ...pendingSourceTurnAttachments.value,
        sourceAttachment
      ];
      const textLength = allAttachments.reduce(
        (total, item) =>
          total + (item.kind === "text" ? item.content.length : 0),
        0
      );
      if (
        allAttachments.length > PROMPT_ATTACHMENT_MAX_ITEMS ||
        textLength > PROMPT_TEXT_ATTACHMENTS_MAX_CONTENT_LENGTH
      ) {
        pendingSourceTurnAttachments.value = [];
        uiMessage.warning(t("sourceAttachmentLimit"));
      } else {
        pendingSourceTurnAttachments.value = [];
        armSourceImportRequest(pendingSourcePrompt.value, allAttachments, true);
        pendingSourcePrompt.value = "";
        emit("send", allAttachments);
        return;
      }
    }
  }
  const sourceName = file.name;
  importDialog.open({
    proposal: {
      source_name: sourceName,
      title: sourceName.replace(/\.(md|markdown|txt)$/i, ""),
      purpose: "foundation",
      authority: "undecided",
      summary: "",
      conflicts: [],
      unresolved_questions: []
    },
    bookId: props.book.id,
    expectedIndexUpdatedAt: props.workspaceIndex.updatedAt,
    attachments: [
      {
        kind: "text",
        id: `source-import-${crypto.randomUUID()}`,
        name: sourceName,
        mediaType: file.type || "text/plain",
        size: file.size,
        content
      }
    ]
  });
}
function cancelSourceFilePicker(): void {
  sourcePickerMode.value = "manual";
  pendingSourceTurnAttachments.value = [];
  pendingSourcePrompt.value = "";
}

const conversationDraft = computed({
  get: () => props.conversationController?.draft.value ?? "",
  set: (value: string) => emit("update:draft", value)
});
const activeStageLabel = computed(() =>
  props.selection?.key === "root:discussion"
    ? props.selection.title
    : LONG_WORKSPACE_ROOT_LABELS[props.selection?.root ?? "worldbuilding"]
);
const canRewriteHistory = computed(
  () =>
    Boolean(
      props.conversationController?.canRewriteHistory.value &&
      !props.sendPreflightPending &&
      !props.editorLocked &&
      props.sendContextReady
    ) && props.proposalItems.every((item) => item.status === "accepted")
);
const {
  editorReferences,
  insertEditorReference,
  removeEditorReference,
  clearEditorReferences
} = usePendingEditorReferences(uiMessage);

watch(
  () => [props.book?.id, props.selection?.key] as const,
  clearEditorReferences
);
watch(
  () => props.book?.id,
  () => {
    sourceLibraryOpen.value = false;
    sourceLibraryChooseFolder.value = false;
    sourceLibrarySuggestedPath.value = undefined;
  }
);

function submitEditedMessage(
  request: ConversationMessageRewriteRequest
): Promise<boolean> {
  if (!canRewriteHistory.value) return Promise.resolve(false);
  return new Promise((resolve) => emit("send", request, resolve));
}

const { captureEditorPort, locateEditorReference } =
  useLongWorkspaceModuleEditorBridge({
    publish: (port) => emit("editorPortChange", port),
    warn: (message) => uiMessage.warning(message)
  });

function forwardSelectCharacter(
  characterId: LongCharacterId,
  done?: (accepted: boolean) => void
): void {
  emit("selectCharacter", characterId, done);
}

function forwardRenameCharacter(
  input: { characterId: LongCharacterId; name: string },
  completion: (succeeded: boolean) => void
): void {
  emit("renameCharacter", input, completion);
}

function forwardRenameStructureTitle(
  input: {
    kind: "worldbuilding" | "volume" | "plotPoint" | "chapterCard";
    id: string;
    title: string;
  },
  completion: (succeeded: boolean) => void
): void {
  emit("renameStructureTitle", input, completion);
}

function forwardDeleteStructure(
  input: {
    kind: "character" | "volume" | "plotPoint" | "chapterCard";
    id: string;
    title: string;
    expectedImpact: LongWorkspaceImpactConfirmation;
  },
  completion: (
    succeeded: boolean,
    changedImpact?: LongWorkspaceImpactConfirmation
  ) => void
): void {
  emit("deleteStructure", input, completion);
}

function forwardPreviewDeleteStructure(
  input: {
    kind: "character" | "volume" | "plotPoint" | "chapterCard";
    id: string;
    title: string;
  },
  completion: (impact?: LongWorkspaceImpactConfirmation) => void
): void {
  emit("previewDeleteStructure", input, completion);
}

function forwardSaveVolumeOutline(
  input: { volumeId: string; outline: string },
  completion: (succeeded: boolean) => void
): void {
  emit("saveVolumeOutline", input, completion);
}

function forwardSavePlotPointContent(
  input: {
    plotPointId: LongArcId;
    field: "summary";
    content: string;
  },
  completion: (succeeded: boolean) => void
): void {
  emit("savePlotPointContent", input, completion);
}

function forwardMutation(
  batch: LongWorkspaceOperationBatch,
  completion: LongStructureMutationCompletion
): void {
  emit("mutation", batch, completion);
}

function forwardPreviewMutation(
  batch: LongWorkspaceOperationBatch,
  completion: (impact?: LongWorkspaceImpactConfirmation) => void
): void {
  emit("previewMutation", batch, completion);
}
</script>

<template>
  <CollaborationWorkspace
    v-if="collaborationOpen && book && workspaceIndex"
    :book-id="book.id"
    :book-label="book.title"
    :snapshot="workspaceIndex"
    :chapter-card-id="selection?.chapterCardId"
    @close="collaborationOpen = false"
    @discussion-candidate="receiveDiscussionCandidate"
    @open-file="emit('selectEntrySearchResult', $event)"
  />
  <LongLegacyConversationDialog
    v-if="legacyHistoryOpen && book"
    :controller="legacyConversationController"
    :book-title="book.title"
    @close="legacyHistoryOpen = false"
  />
  <template v-if="book">
    <div
      v-show="paneLayout === 'agent-editor' || !rightPane.collapsed"
      class="long-agent-column"
      :aria-label="t('novelWorkspace')"
    >
      <button
        v-if="leftCollapsed && !(conversationController && agentProfile)"
        class="icon-button long-workspace-expand-sidebar"
        type="button"
        :aria-label="t('expandSidebar')"
        @click="emit('expandLeft')"
      >
        <AppIcon name="panel-left" :size="18" />
      </button>
      <AgentConversation
        v-if="conversationController && agentProfile"
        class="long-agent-conversation"
        v-model:draft="conversationDraft"
        :messages="conversationController.messages.value"
        :conversation-history="conversationController.history.value"
        :current-session-id="conversationController.sessionId.value"
        :responding="conversationController.isBusy.value"
        :can-send="
          !sendPreflightPending &&
          sendContextReady &&
          conversationController.canSend.value
        "
        :can-send-attachments="conversationController.canSendAttachments.value"
        :can-rewrite-history="canRewriteHistory"
        :submit-edited-message="submitEditedMessage"
        :can-stop="conversationController.canStop.value"
        :runtime-available="runtimeAvailable"
        :models="conversationController.configuredModels.value"
        :selected-model-id="conversationController.selectedModelId.value"
        :thinking-level="conversationController.thinkingLevel.value"
        :web-search-enabled="conversationController.webSearchEnabled.value"
        :temperature="conversationController.temperature.value"
        :approval-mode="conversationController.approvalMode.value"
        :agent-team-mode="conversationController.agentTeamMode.value"
        allow-live-edit-review
        :context-title="selection?.title ?? book.title"
        :book-title="book.title"
        :stage-label="activeStageLabel"
        :agent-label="builtinAgentLabel('long', agentProfile.label)"
        :agent-id="agentProfile.id"
        agent-workspace-type="long"
        :library-domain="undefined"
        :library-skills="undefined"
        :available-skills="availableSkillReferences"
        :available-materials="availableMaterialReferences"
        :editor-references="editorReferences"
        :long-proposal-items="proposalItems"
        :long-workspace-index="workspaceIndex"
        :user-input-request="conversationController.pendingUserInput.value"
        :user-input-submitting="
          conversationController.submittingUserInput.value
        "
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightPane.collapsed"
        :right-pane="paneLayout === 'editor-agent'"
        @new-conversation="emit('newConversation')"
        @select-conversation="emit('selectConversation', $event)"
        @send="forwardConversationSend($event)"
        @stop="emit('stop')"
        @suggestion="emit('suggestion', $event)"
        @toggle-left="emit('toggleLeft')"
        @toggle-right="emit('toggleRight')"
        @select-model="emit('selectModel', $event)"
        @select-thinking="emit('selectThinking', $event)"
        @toggle-web-search="
          conversationController.selectWebSearchEnabled($event)
        "
        @select-temperature="emit('selectTemperature', $event)"
        @select-approval="emit('selectApproval', $event)"
        @select-agent-team-mode="emit('selectAgentTeamMode', $event)"
        @review-edit="emit('reviewEdit', $event)"
        @locate-edit-proposal="emit('locateEditProposal', $event)"
        @approve-long-proposal="emit('approveLongProposal', $event)"
        @reject-long-proposal="emit('rejectLongProposal', $event)"
        @retry-long-proposal-preview="emit('retryLongProposalPreview', $event)"
        @locate-long-proposal="emit('locateLongProposal', $event)"
        @clear-editor-references="clearEditorReferences"
        @remove-editor-reference="removeEditorReference"
        @locate-editor-reference="locateEditorReference"
        @submit-user-input="conversationController.submitUserInput($event)"
      >
        <template #attachment-picker="controls">
          <LongSourceAttachmentMenu
            :disabled="controls.disabled"
            @choose="sourceAttachmentAction($event, controls.pickFiles)"
          />
        </template>
        <template #context-actions
          ><button
            class="header-text-button"
            type="button"
            data-testid="long-book-sources-open"
            @click="
              sourceLibraryChooseFolder = false;
              sourceLibrarySuggestedPath = undefined;
              sourceLibraryOpen = true;
            "
          >
            <AppIcon name="archive" :size="16" />{{ t("bookSources") }}</button
          ><button
            class="header-text-button"
            type="button"
            data-testid="long-collaboration-open"
            @click="collaborationOpen = true"
          >
            {{ t("creativeCollaboration") }}</button
          ><button
            class="header-text-button"
            type="button"
            data-testid="long-legacy-history-open"
            :disabled="!legacyConversationController"
            @click="legacyHistoryOpen = true"
          >
            <AppIcon name="history" :size="16" />{{
              t("legacySharedConversation")
            }}
          </button></template
        >
      </AgentConversation>
      <input
        ref="sourceAttachmentInput"
        type="file"
        data-testid="long-source-import-file"
        accept=".md,.markdown,.txt"
        hidden
        @change="readSourceFile"
        @cancel="cancelSourceFilePicker"
      />
      <LongWorkspacePanePlaceholder
        v-if="!(conversationController && agentProfile)"
        kind="agent"
      />
      <section
        v-if="refreshStatus?.error"
        class="long-workspace-refresh-status is-error"
        aria-live="polite"
      >
        <span>{{ t("theLatestWorkspaceIndexHasNotSyncedSendingTo") }}</span>
        <button type="button" @click="emit('retryWorkspaceRefresh')">
          {{ t("syncAgain") }}
        </button>
      </section>
    </div>
    <template v-if="workspaceIndex">
      <LongWorkspaceEditor
        v-show="paneLayout === 'editor-agent' || !rightPane.collapsed"
        :ref="captureEditorPort"
        :book-id="book.id"
        :selection="selection"
        :workspace-index="workspaceIndex"
        :locked="editorLocked"
        :locked-reason="editorLockedReason"
        :right-pane="paneLayout === 'agent-editor'"
        :right-pane-collapsed="rightPane.collapsed"
        :default-view-mode="defaultTextViewMode"
        :auto-save-enabled="autoSaveEnabled"
        @insert-selection="insertEditorReference"
        @saved="emit('saved', $event)"
        @context-change="emit('contextChange', $event)"
        @collapse="emit('collapseRight')"
        @toggle-right="emit('toggleRight')"
        @select-character="forwardSelectCharacter"
        @select-plot-point="emit('selectPlotPoint', $event)"
        @select-chapter-card="emit('selectChapterCard', $event)"
        @select-entry-search-result="emit('selectEntrySearchResult', $event)"
        @rename-character="forwardRenameCharacter"
        @rename-structure-title="forwardRenameStructureTitle"
        @create-character="emit('createCharacter')"
        @create-worldbuilding-item="emit('createWorldbuildingItem')"
        @create-plot-point="emit('createPlotPoint')"
        @create-chapter-card="emit('createChapterCard')"
        @create-volume="emit('createVolume')"
        @preview-delete-structure="forwardPreviewDeleteStructure"
        @delete-structure="forwardDeleteStructure"
        @save-volume-outline="forwardSaveVolumeOutline"
        @save-plot-point-content="forwardSavePlotPointContent"
        @preview-mutation="forwardPreviewMutation"
        @mutation="forwardMutation"
      />
    </template>
    <LongWorkspacePanePlaceholder
      v-else-if="paneLayout === 'editor-agent' || !rightPane.collapsed"
      kind="editor"
      :right-pane="paneLayout === 'agent-editor'"
      :loading="loading"
    />
    <div
      v-if="!rightPane.collapsed"
      class="pane-resizer pane-resizer-right"
      role="separator"
      :aria-label="t('resizeRightPane')"
      aria-orientation="vertical"
      :aria-valuemin="rightPane.minWidth"
      :aria-valuemax="rightPane.maxWidth"
      :aria-valuenow="rightPane.width"
      tabindex="0"
      @pointerdown="emit('resizeStart', $event)"
      @keydown="emit('resizeKeydown', $event)"
    />
    <LongBookSourcesDialog
      v-if="sourceLibraryOpen"
      :open="sourceLibraryOpen"
      :choose-folder="sourceLibraryChooseFolder"
      :initial-mode="sourceLibraryMode"
      :suggested-path="sourceLibrarySuggestedPath"
      :book-id="book.id"
      :index="workspaceIndex"
      @close="sourceLibraryOpen = false"
      @file="openSourceFilePicker"
      @changed="emit('sourceImported', book.id, () => {})"
      @select="emit('selectEntrySearchResult', $event)"
    />
    <LongSourceImportDialog
      :candidate="importDialog.candidate.value"
      :staged="importDialog.staged.value"
      :saving="importDialog.saving.value"
      :error="importDialog.error.value"
      @close="importDialog.close"
      @stage="importDialog.stage"
      @confirm="importDialog.confirm"
      @edit="importDialog.edit"
      @update-purpose-note="
        (value) => {
          if (importDialog.candidate.value)
            importDialog.candidate.value.purposeNote = value;
        }
      "
      @update-title="onSourceTitle"
      @update-purpose="onSourcePurpose"
      @update-authority="onSourceAuthority"
    />
  </template>
  <LongWorkspaceLoading
    v-else
    :left-collapsed="leftCollapsed"
    :right-pane="rightPane"
    :pane-layout="paneLayout"
    :pending="loading"
    @expand-left="emit('expandLeft')"
  />
</template>

<style scoped>
.long-imported-sources,
.long-source-import-shortcut {
  min-width: 0;
  padding: 8px 16px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-main);
  color: var(--text-secondary);
  font-size: 0.85em;
}
.long-imported-sources {
  max-height: 22vh;
  overflow: auto;
}
.long-imported-sources summary {
  cursor: pointer;
  padding: 4px 0;
}
.long-imported-sources button {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.long-imported-sources button:hover {
  background: var(--surface-hover);
}
.long-source-import-shortcut {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.long-source-import-shortcut > span {
  flex: 1 1 200px;
  line-height: 1.5;
}
</style>
