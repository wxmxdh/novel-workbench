<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  inject,
  onBeforeUnmount,
  ref,
  watch
} from "vue";
import { storeToRefs } from "pinia";
import type { UserPromptAttachment } from "@deepwrite/contracts";
import { AgentConversation } from "../../components/lazyAppComponents";
import RightEditorPane from "../../components/RightEditorPane.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { useLayoutStore } from "../../stores/layoutStore";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { novelCategories, novelResourceId } from "./novelWorkspaceContext";
import { NOVEL_WORKSPACE_PORT } from "./novelWorkspaceContext";
import OtterReviewPanel from "./OtterReviewPanel.vue";
import OtterManualReview from "./OtterManualReview.vue";
import OtterManualSourcePicker from "./OtterManualSourcePicker.vue";
import OtterWorkflowPanel from "./OtterWorkflowPanel.vue";
import { createScopedTranslator } from "../../i18n";
import { requestsTeam, type TeamRunSelection } from "./teamRunSelection";
const OtterTeamRunDialog = defineAsyncComponent(
  () => import("./OtterTeamRunDialog.vue")
);
const teamRunOpen = ref(false);
const teamAttachments = ref<UserPromptAttachment[]>([]);
const OtterWritingDialog = defineAsyncComponent(
  () => import("./OtterWritingDialog.vue")
);
const OtterMethodPicker = defineAsyncComponent(
  () => import("./OtterMethodPicker.vue")
);
const NovelChapterBrowser = defineAsyncComponent(
  () => import("./NovelChapterBrowser.vue")
);

const emit = defineEmits<{ openModels: [] }>();
const injected = inject(NOVEL_WORKSPACE_PORT);
if (!injected?.value) throw new Error("Novel workspace port unavailable");
const port = injected.value;
const model = port.model;
const layout = useLayoutStore();
const { leftCollapsed, rightCollapsed, writingRightPaneViewModel } =
  storeToRefs(layout);
const preparing = ref(false);
const sourcesOpen = ref(false);
const chapterToolsOpen = ref(false);
const t = createScopedTranslator("components.otterWorkbench");
const writingOpen = ref(false);
const writingOriginal = ref<{
  path: string;
  content: string;
  hash: string;
  writingRole?: "candidate" | "work" | undefined;
}>();
const writingKind = ref<"outline" | "draft">("draft");
const writingReply = ref<{
  content: string;
  model: string;
  evidence?: "request-config" | "runtime-report";
}>();
const latestReply = computed(() =>
  [...controller.value.messages.value]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        !message.id.startsWith("team-status:") &&
        message.status === "completed" &&
        message.content.trim()
    )
);
watch(model.projectId, () => {
  teamRunOpen.value = false;
  writingOpen.value = false;
  writingOriginal.value = undefined;
  writingReply.value = undefined;
});
function openWriting(revision = false) {
  writingReply.value = undefined;
  writingKind.value = port.category.value === "plan" ? "outline" : "draft";
  writingOriginal.value =
    revision && model.document.value
      ? {
          path: model.document.value.path,
          content: model.document.value.content,
          hash: model.document.value.hash,
          writingRole: model.projectView.value?.documents.find(
            (item) => item.path === model.document.value?.path
          )?.writingRole
        }
      : undefined;
  writingOpen.value = true;
}
function openReplyWriting() {
  const reply = latestReply.value;
  if (!reply) return;
  openWriting();
  writingReply.value = {
    content: reply.content,
    model: reply.sourceModel ?? "unknown",
    ...(reply.sourceModelEvidence
      ? { evidence: reply.sourceModelEvidence }
      : {})
  };
}
async function writingSaved(
  path: string,
  category: "plan" | "draft",
  status: "author-candidate" | "author-work-draft",
  deduplicated: boolean
) {
  writingOpen.value = false;
  uiMessage.success(
    status === "author-work-draft"
      ? t("workDraftSaved")
      : deduplicated
        ? t("writingDuplicateReused")
        : t("writingSaved")
  );
  try {
    await model.openProject();
    await port.select(novelResourceId(model.projectId.value, category, path));
    rightCollapsed.value = false;
  } catch (reason) {
    uiMessage.error(formatError(reason, t("apiUnavailable")));
  }
}
const materialEntries = computed(() =>
  sourceOptions.value.filter((item) =>
    /(?:素材参考入口|创作积累入口|作品积累|认可文风|参考关联|参考资料包|source-map|memory\/README)/i.test(
      item.path
    )
  )
);
const summary = computed({
  get: () => {
    const conversation = port.controller.value;
    const id = port.summaryMessageIds.value[conversation.sessionId.value];
    return (
      conversation.messages.value.find(
        (message) => message.id === id && message.role === "assistant"
      )?.content ?? ""
    );
  },
  set: (content: string) => {
    const conversation = port.controller.value;
    if (!content)
      delete port.summaryMessageIds.value[conversation.sessionId.value];
    else {
      const last = conversation.messages.value.at(-1);
      if (last?.role === "assistant" && last.content === content)
        port.summaryMessageIds.value[conversation.sessionId.value] = last.id;
    }
  }
});
const teamSessions = computed(
  () => port.teamGroups.value[port.teamGroupKey.value] ?? []
);
const batchRunning = computed(
  () => port.teamBatches.value[port.teamGroupKey.value]?.running ?? false
);
const runningTeamPeers = new Map<string, Set<typeof port.controller.value>>();
async function cancelGroup(key: string) {
  const batch = port.teamBatches.value[key];
  if (batch) batch.cancelled = true;
  await Promise.allSettled(
    [...(runningTeamPeers.get(key) ?? [])]
      .filter((peer) => peer.canStop.value)
      .map((peer) => peer.stopGeneration())
  );
}
function cancelQueuedMembers() {
  const batch = port.teamBatches.value[port.teamGroupKey.value];
  if (batch) batch.cancelled = true;
}
onBeforeUnmount(() => {
  void cancelGroup(port.teamGroupKey.value);
});
watch(port.teamGroupKey, (_key, previous) => {
  if (previous && port.teamBatches.value[previous]) void cancelGroup(previous);
});
async function stop() {
  const projectId = model.projectId.value;
  const selectedController = controller.value;
  cancelQueuedMembers();
  const peers = teamSessions.value.map((item) =>
    port.conversationForKey(item.value, `novel:${projectId}`)
  );
  await Promise.all(
    [...new Set([selectedController, ...peers])]
      .filter((peer) => peer.canStop.value)
      .map((peer) => peer.stopGeneration())
  );
}
const teamSession = port.teamSelection;
const controller = port.activeController;
const sourceOptions = computed(() =>
  model.projectDocumentOptions.value.map((item) => ({
    path: item.value,
    title: item.label
  }))
);
const projectTitle = computed(
  () => model.selectedProject.value?.title ?? "小说资料"
);
const scopeLabel = computed(() => novelCategories[port.category.value]);
const runtimeAvailable = Boolean(window.deepwrite);
const document = computed(() => ({
  id: novelResourceId(
    model.projectId.value,
    port.category.value,
    model.document.value?.path ?? ""
  ),
  domain: "creation" as const,
  title:
    model.projectView.value?.documents.find(
      (item) => item.path === model.document.value?.path
    )?.title ?? scopeLabel.value,
  eyebrow: projectTitle.value,
  path: [projectTitle.value, model.document.value?.path ?? scopeLabel.value],
  content:
    model.document.value?.content ??
    "从左侧目录选择资料，在这里阅读。讨论内容先保留在对话中；明确保存的构想仍为候选。",
  readOnly: true
}));
const snapshot = computed(() =>
  port.controller.value.messages.value
    .filter((message) => message.content.trim())
    .map((message) => ({
      role:
        message.role === "user" ? ("author" as const) : ("assistant" as const),
      label: message.role === "user" ? "作者" : "模型",
      content: message.content
    }))
    .concat(
      teamSessions.value.flatMap((item) =>
        port
          .conversationForKey(item.value, `novel:${model.projectId.value}`)
          .messages.value.filter(
            (message) => message.role === "assistant" && message.content.trim()
          )
          .map((message) => ({
            role: "assistant" as const,
            label: item.label,
            content: message.content
          }))
      )
    )
);
watch(
  () =>
    `${model.projectId.value}:${port.category.value}:${port.controller.value.sessionId.value}`,
  () => {
    teamSession.value = "";
  }
);
watch(
  () => ({
    session: port.controller.value.sessionId.value,
    content: snapshot.value.map((message) => message.content).join("\n")
  }),
  (next, previous) => {
    if (
      previous &&
      next.session === previous.session &&
      next.content !== previous.content
    )
      summary.value = "";
  }
);
const sourcesSignature = () =>
  JSON.stringify([
    [...port.selectedSources.value].sort(),
    [...port.selectedSkills.value].sort()
  ]);
async function prepareContext(topic: string) {
  const projectId = model.projectId.value;
  const category = port.category.value;
  const sources = [...port.selectedSources.value];
  const skills = [...port.selectedSkills.value];
  const conversation = port.controller.value;
  const sessionId = conversation.sessionId.value;
  const signature = sourcesSignature();
  const known = port.contexts.value[sessionId];
  const targetPath =
    model.document.value && ["plan", "draft"].includes(port.category.value)
      ? model.document.value.path
      : undefined;
  if (
    known &&
    known.context.projectId === projectId &&
    known.peopleIncluded === true &&
    known.category === category &&
    known.targetPath === targetPath &&
    sessionId.startsWith(`otter:${projectId}:${known.context.contextId}:`) &&
    JSON.stringify([
      known.sources.slice().sort(),
      (known.skills ?? ["otter-novel"]).slice().sort()
    ]) === signature
  )
    return known.context;
  const context = await window.deepwrite!.otter!.prepareDiscussion({
    projectId,
    topic,
    sources,
    skills,
    includeProjectPeople: true,
    ...(targetPath ? { targetPath } : {})
  });
  if (
    projectId !== model.projectId.value ||
    category !== port.category.value ||
    conversation !== port.controller.value ||
    sessionId !== conversation.sessionId.value ||
    topic !== conversation.draft.value ||
    signature !== sourcesSignature() ||
    (targetPath && targetPath !== model.document.value?.path)
  )
    return null;
  const hadHistory = conversation.messages.value.length > 0;
  const preferences = {
    model: conversation.selectedModelId.value,
    thinking: conversation.thinkingLevel.value,
    temperature: conversation.temperature.value,
    approval: conversation.approvalMode.value,
    team: conversation.agentTeamMode.value
  };
  conversation.newConversation(
    `otter:${projectId}:${context.contextId}:${crypto.randomUUID()}`
  );
  if (preferences.model) conversation.selectModel(preferences.model);
  conversation.selectThinkingLevel(preferences.thinking);
  conversation.selectTemperature(preferences.temperature);
  conversation.selectApprovalMode(preferences.approval);
  conversation.selectAgentTeamMode(preferences.team);
  conversation.draft.value = topic;
  port.contexts.value[conversation.sessionId.value] = {
    context,
    sources,
    skills,
    peopleIncluded: true,
    category,
    ...(targetPath ? { targetPath } : {})
  };
  if (hadHistory)
    uiMessage.info("资料范围已变化，已另开讨论；原对话保留在历史中。");
  return context;
}
function waitIdle(conversation: typeof port.controller.value): Promise<void> {
  if (!conversation.isBusy.value) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(conversation.isBusy, (busy) => {
      if (!busy) {
        stop();
        resolve();
      }
    });
  });
}
async function send(
  attachments: UserPromptAttachment[] = [],
  forceSingle = false,
  selection?: TeamRunSelection
) {
  const conversation = controller.value;
  if (!conversation.canSend.value || preparing.value || !model.projectId.value)
    return;
  if (
    !selection &&
    !forceSingle &&
    !teamSession.value &&
    (conversation.agentTeamMode.value === "team" ||
      requestsTeam(conversation.draft.value))
  ) {
    teamRunOpen.value = true;
    teamAttachments.value = attachments;
    return;
  }
  const topic = selection?.topic ?? conversation.draft.value;
  const materialSnapshot = snapshot.value
    .map((message) => `${message.label}：\n${message.content}`)
    .join("\n\n");
  const referenceSnapshot = [...port.references.value];
  const referenceText = referenceSnapshot
    .map(
      (item) =>
        `${item.documentTitle} (${item.documentPath.join("/")}:${item.startLine}-${item.endLine})\n${item.text}`
    )
    .join("\n\n");
  if (referenceText)
    attachments = [
      ...attachments,
      {
        id: crypto.randomUUID(),
        name: "作者选择的原文片段",
        kind: "text",
        mediaType: "text/plain",
        size: new TextEncoder().encode(referenceText).length,
        content: referenceText
      }
    ];
  const projectId = model.projectId.value;
  let groupKey = port.teamGroupKey.value;
  conversation.conversationError.value = "";
  preparing.value = true;
  try {
    const context = teamSession.value
      ? port.contexts.value[conversation.sessionId.value]?.context
      : (selection?.context ?? (await prepareContext(topic)));
    if (!context) return;
    if (selection) {
      if (selection.context.projectId !== projectId)
        throw new Error("团队资料不属于当前项目，请重新核对。");
      const preferences = {
        model: conversation.selectedModelId.value,
        thinking: conversation.thinkingLevel.value,
        temperature: conversation.temperature.value,
        approval: conversation.approvalMode.value
      };
      conversation.newConversation(
        `otter:${projectId}:${context.contextId}:${crypto.randomUUID()}`
      );
      if (preferences.model) conversation.selectModel(preferences.model);
      conversation.selectThinkingLevel(preferences.thinking);
      conversation.selectTemperature(preferences.temperature);
      conversation.selectApprovalMode(preferences.approval);
      conversation.draft.value = topic;
      port.contexts.value[conversation.sessionId.value] = {
        context,
        peopleIncluded: selection.includeProjectPeople,
        category: port.category.value,
        ...(selection.targetPath ? { targetPath: selection.targetPath } : {}),
        sources: [...port.selectedSources.value],
        skills: [...port.selectedSkills.value]
      };
    }
    groupKey = port.teamGroupKey.value;
    const contextSources = [
      ...(port.contexts.value[conversation.sessionId.value]?.sources ?? [])
    ];
    if (
      projectId !== model.projectId.value ||
      controller.value !== conversation ||
      topic !== conversation.draft.value
    )
      return;
    if (!forceSingle && selection && !teamSession.value) {
      if (topic.length > 2000)
        throw new Error("团队讨论主题最多 2,000 字符，请缩短主题。");
      const material = summary.value
        ? `本次讨论摘要（候选与未决意见）：\n${summary.value}`
        : materialSnapshot;
      if (material.length > 12000)
        throw new Error(
          "当前讨论超过团队资料上限，请先整理摘要后再讨论；原文不会截断。"
        );
      const plan = await window.deepwrite!.otter!.prepareTeam({
        context: {
          projectId: context.projectId,
          contextPath: context.contextPath,
          ...(context.receiptPath ? { receiptPath: context.receiptPath } : {})
        },
        parentAgentId: "long",
        nativeTeamIds: selection.nativeTeamIds,
        memberKeys: selection.memberKeys,
        topic,
        material,
        parentModelId: conversation.selectedModelId.value || undefined,
        parentThinkingLevel: conversation.thinkingLevel.value,
        parentTemperature: conversation.temperature.value,
        mode: selection.mode
      });
      if (
        projectId !== model.projectId.value ||
        controller.value !== conversation ||
        groupKey !== port.teamGroupKey.value ||
        topic !== conversation.draft.value
      )
        return;
      if (!plan.members.length)
        throw new Error("原版长篇团队没有启用的成员，请在团队配置中启用成员。");
      conversation.messages.value.push({
        id: crypto.randomUUID(),
        role: "user",
        content: topic,
        createdAt: new Date().toISOString(),
        status: "completed"
      });
      conversation.draft.value = "";
      const batch = { cancelled: false, running: true };
      const peers = new Set<typeof conversation>();
      runningTeamPeers.set(groupKey, peers);
      port.teamBatches.value[groupKey] = batch;
      port.teamGroups.value[groupKey] = plan.members.map((member) => ({
        value: `novel-team:${groupKey}:${member.memberId ?? member.memberName}`,
        label: `${member.teamName} · ${member.memberName}`
      }));
      conversation.messages.value.push({
        id: `team-status:${crypto.randomUUID()}`,
        role: "assistant",
        content: `团队已启动：${plan.members.map((member) => `${member.teamName} / ${member.memberName}`).join("、")}。请用上方“团队成员对话”分别查看回答；成员实际报错或缺少依据时，不能视为审核通过。`,
        createdAt: new Date().toISOString(),
        status: "completed"
      });
      let next = 0;
      let completed = 0;
      const outcomes = await Promise.allSettled(
        Array.from({ length: Math.min(3, plan.members.length) }, async () => {
          while (!batch.cancelled && next < plan.members.length) {
            const member = plan.members[next++]!;
            const peer = port.conversationForKey(
              `novel-team:${groupKey}:${member.memberId ?? member.memberName}`,
              `novel:${projectId}`
            );
            if (peer.isBusy.value) {
              batch.cancelled = true;
              throw new Error(
                "该团队成员仍在执行上轮任务，请先停止或等待结束。"
              );
            }
            peer.newConversation(member.request.sessionId);
            const otter =
              member.request.task.agentId === "chat-normal"
                ? member.request.task.input.otter
                : undefined;
            if (otter)
              port.contexts.value[peer.sessionId.value] = {
                context: member.context ?? {
                  ...otter,
                  contextId: member.request.sessionId
                    .slice(`otter:${projectId}:`.length)
                    .split(":")[0]!
                },
                sources: member.sourcePaths ?? contextSources,
                skills: port.contexts.value[conversation.sessionId.value]
                  ?.skills ?? ["otter-novel"]
              };
            peer.draft.value = member.request.conversation?.message ?? topic;
            if (member.request.modelId)
              peer.selectModel(member.request.modelId);
            else if (conversation.selectedModelId.value)
              peer.selectModel(conversation.selectedModelId.value);
            peer.selectThinkingLevel(
              member.request.thinkingLevel ?? conversation.thinkingLevel.value
            );
            peer.selectTemperature(
              member.request.temperature ?? conversation.temperature.value
            );
            if (member.request.task.agentId !== "chat-normal")
              throw new Error("团队任务类型无效。");
            peers.add(peer);
            await peer.sendAssistantMessage(member.request.task, attachments);
            if (batch.cancelled && peer.canStop.value)
              await peer.stopGeneration();
            await waitIdle(peer);
            peers.delete(peer);
            if (peer.conversationError.value)
              throw new Error(
                `${member.memberName}：${peer.conversationError.value}`
              );
            if (!batch.cancelled) {
              const reply = peer.messages.value.at(-1);
              if (
                !reply ||
                reply.role !== "assistant" ||
                reply.status !== "completed" ||
                !reply.content.trim()
              )
                throw new Error(
                  `${member.memberName}没有完成有效回答，请查看该成员状态。`
                );
              completed++;
            }
          }
        })
      );
      const failed = outcomes.find((result) => result.status === "rejected");
      conversation.messages.value.push({
        id: `team-status:${crypto.randomUUID()}`,
        role: "assistant",
        content: `${batch.cancelled ? "本轮团队已取消" : failed ? "本轮团队有成员失败" : "本轮团队回答已结束"}：${completed}/${plan.members.length} 位完成回答。${completed === plan.members.length ? "回答不是审核通过证明，请逐项核对依据。" : "未执行、已停止或失败的成员不能算审核完成。"}`,
        createdAt: new Date().toISOString(),
        status: "completed"
      });
      runningTeamPeers.delete(groupKey);
      if (failed?.status === "rejected") throw failed.reason;
    } else {
      await conversation.sendAssistantMessage(
        {
          agentId: "chat-normal",
          profileId: "default",
          input: {
            otter: {
              projectId,
              contextPath: context.contextPath,
              ...(context.receiptPath
                ? { receiptPath: context.receiptPath }
                : {})
            }
          }
        },
        attachments
      );
    }
  } catch (error) {
    const message = formatError(error, t("discussionPrepareFailed"));
    conversation.conversationError.value = message;
    uiMessage.error(message);
  } finally {
    if (port.teamBatches.value[groupKey])
      port.teamBatches.value[groupKey]!.running = false;
    preparing.value = false;
  }
}
async function summarize() {
  if (
    !snapshot.value.length ||
    preparing.value ||
    port.controller.value.isBusy.value ||
    batchRunning.value
  )
    return;
  const conversation = port.controller.value;
  if (!conversation.configuredModels.value.length) {
    emit("openModels");
    return;
  }
  if (conversation.draft.value.trim()) {
    uiMessage.warning("请先发送或保存输入框里的文字，再整理讨论。");
    return;
  }
  const previousMessageId = conversation.messages.value.at(-1)?.id;
  conversation.draft.value =
    "请整理我们这次讨论，供外部复核使用。区分作者明确意见、模型建议、未决问题及引用资料；不要补造事实或直接修改小说。保留有争议的不同意见，不把候选写成正典。";
  teamSession.value = "";
  const discussionContent = snapshot.value
    .map((message) => `${message.label}：\n${message.content}`)
    .join("\n\n");
  await send(
    discussionContent
      ? [
          {
            id: crypto.randomUUID(),
            name: "本轮讨论（候选与未决意见）",
            kind: "text",
            mediaType: "text/plain",
            size: new TextEncoder().encode(discussionContent).length,
            content: discussionContent
          }
        ]
      : [],
    true
  );
  const summarySession = conversation.sessionId.value;
  await waitIdle(conversation);
  if (
    conversation !== port.controller.value ||
    summarySession !== conversation.sessionId.value
  )
    return;
  const last = conversation.messages.value.at(-1);
  if (
    last?.role === "assistant" &&
    last.status === "completed" &&
    last.id !== previousMessageId
  )
    summary.value = last.content;
  model.tab.value = "external";
}
function newConversation() {
  if (batchRunning.value) {
    uiMessage.info("请先停止本轮团队讨论，再新建会话。");
    return;
  }
  controller.value.newConversation();
}
function selectConversation(id: string) {
  if (batchRunning.value) {
    uiMessage.info("请先停止本轮团队讨论，再切换会话。");
    return;
  }
  void controller.value
    .openConversation(id)
    .catch((error) => uiMessage.error(formatError(error, "无法读取会话")));
}
function showDiscussion() {
  port.clearChapterSelection();
  model.tab.value = "workflow";
}
async function selectChapterDocument(path: string): Promise<void> {
  try {
    const opened = await port.selectChapterDocument(path);
    if (!opened) return;
    rightCollapsed.value = false;
  } catch (error) {
    uiMessage.error(formatError(error, t("chapterBrowserOpenFailed")));
  }
}
async function selectReferenceCandidate(
  path: string,
  action: "reference" | "important" = "reference"
): Promise<void> {
  try {
    await selectChapterDocument(path);
    const document = model.document.value;
    if (!document || document.path !== path) return;
    await window.deepwrite!.otter!.selectWriting({
      projectId: model.projectId.value,
      path,
      hash: document.hash,
      action
    });
    await model.openProject();
    uiMessage.success(
      action === "important"
        ? t("importantCheckpointSaved")
        : t("candidateSelectedAsReference")
    );
  } catch (error) {
    uiMessage.error(formatError(error, t("chapterBrowserOpenFailed")));
  }
}
async function startTeamRun(selection: TeamRunSelection) {
  teamRunOpen.value = false;
  controller.value.draft.value = selection.topic;
  const attachments = teamAttachments.value;
  teamAttachments.value = [];
  await send(attachments, false, selection);
}
</script>

<template>
  <section class="novel-workspace-adapter" data-testid="otter-workbench">
    <OtterTeamRunDialog
      v-if="teamRunOpen"
      :project-id="model.projectId.value"
      :topic="controller.draft.value"
      :sources="port.selectedSources.value"
      :skills="port.selectedSkills.value"
      v-bind="
        model.document.value && ['plan', 'draft'].includes(port.category.value)
          ? { targetPath: model.document.value.path }
          : {}
      "
      :documents="model.projectView.value?.documents ?? []"
      :models="controller.configuredModels.value"
      :parent-model-id="controller.selectedModelId.value"
      @close="teamRunOpen = false"
      @run="startTeamRun"
    />
    <OtterWritingDialog
      v-if="writingOpen && model.projectView.value"
      :project="model.projectView.value"
      :initial-kind="writingKind"
      v-bind="{
        ...(writingOriginal ? { original: writingOriginal } : {}),
        ...(writingReply ? { reply: writingReply } : {})
      }"
      @close="writingOpen = false"
      @saved="writingSaved"
    />
    <template v-if="model.tab.value === 'workflow' && model.projectId.value">
      <AgentConversation
        v-if="!port.selectedChapter.value"
        :messages="controller.messages.value"
        :conversation-history="controller.history.value"
        :current-session-id="controller.sessionId.value"
        :conversation-error="controller.conversationError.value"
        :draft="controller.draft.value"
        :responding="controller.isBusy.value || preparing || batchRunning"
        :can-send="controller.canSend.value && !preparing && !batchRunning"
        :can-send-attachments="controller.canSendAttachments.value"
        :can-stop="controller.canStop.value || batchRunning"
        :runtime-available="runtimeAvailable"
        :models="controller.configuredModels.value"
        :selected-model-id="controller.selectedModelId.value"
        :thinking-level="controller.thinkingLevel.value"
        :web-search-enabled="false"
        :temperature="controller.temperature.value"
        :approval-mode="controller.approvalMode.value"
        :agent-team-mode="controller.agentTeamMode.value"
        :context-title="scopeLabel"
        :book-title="projectTitle"
        :stage-label="scopeLabel"
        :agent-label="projectTitle + ' · ' + scopeLabel"
        :agent-id="undefined"
        :library-domain="undefined"
        :library-skills="undefined"
        :available-skills="[]"
        :available-materials="[]"
        :editor-references="port.references.value"
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightCollapsed"
        :user-input-request="controller.pendingUserInput.value"
        :user-input-submitting="controller.submittingUserInput.value"
        @update:draft="controller.draft.value = $event"
        @send="send($event)"
        @stop="stop"
        @suggestion="controller.useSuggestion($event)"
        @new-conversation="newConversation"
        @select-conversation="selectConversation"
        @toggle-left="layout.togglePane('left')"
        @toggle-right="layout.togglePane('right')"
        @select-model="controller.selectModel($event)"
        @select-thinking="controller.selectThinkingLevel($event)"
        @select-temperature="controller.selectTemperature($event)"
        @select-approval="controller.selectApprovalMode($event)"
        @select-agent-team-mode="controller.selectAgentTeamMode($event)"
        @submit-user-input="controller.submitUserInput($event)"
        @clear-editor-references="port.references.value = []"
        @remove-editor-reference="
          port.references.value = port.references.value.filter(
            (item) => item.id !== $event
          )
        "
      >
        <template #context-actions>
          <button
            class="header-text-button"
            type="button"
            data-testid="novel-navigation-mode-toggle"
            @click="
              port.setNavigationMode(
                port.navigationMode.value === 'compact' ? 'complete' : 'compact'
              )
            "
          >
            {{
              port.navigationMode.value === "compact"
                ? t("showCompleteFileTree")
                : t("showCompactChapterTree")
            }}
          </button>
          <button
            v-if="!teamSession"
            class="header-text-button"
            type="button"
            data-testid="team-run-entry"
            :disabled="preparing || batchRunning || controller.isBusy.value"
            @click="teamRunOpen = true"
          >
            {{ t("teamReviewEntry") }}
          </button>
          <PopupSelect
            variant="compact"
            size="small"
            model-value=""
            :placeholder="t('writingActions')"
            :accessible-label="t('writingActions')"
            :disabled="preparing || controller.isBusy.value"
            :options="[
              { value: 'new', label: t('writingNew') },
              ...(latestReply
                ? [{ value: 'reply', label: t('saveCurrentReplyCandidate') }]
                : []),
              ...(model.document.value &&
              ['plan', 'draft'].includes(port.category.value)
                ? [{ value: 'revision', label: t('writingRevision') }]
                : [])
            ]"
            @update:model-value="
              $event === 'reply'
                ? openReplyWriting()
                : openWriting($event === 'revision')
            "
          />
          <template v-if="teamSessions.length">
            <PopupSelect
              class="novel-team-switcher"
              variant="compact"
              size="small"
              :model-value="teamSession"
              :options="[
                { value: '', label: t('mainConversation') },
                ...teamSessions
              ]"
              :accessible-label="t('teamConversation')"
              @update:model-value="teamSession = String($event)"
            />
          </template>
          <button
            class="header-text-button"
            type="button"
            :aria-expanded="sourcesOpen"
            @click="sourcesOpen = !sourcesOpen"
          >
            {{ t("resourcesSkills")
            }}{{
              port.selectedSources.value.length
                ? ` (${port.selectedSources.value.length})`
                : ""
            }}
          </button>
          <button
            class="header-text-button"
            type="button"
            @click="model.tab.value = 'external'"
          >
            {{ t("discussionHandoffButton") }}
          </button>
        </template>
      </AgentConversation>
      <NovelChapterBrowser
        v-else
        :chapter-position="port.selectedChapter.value.position"
        :documents="model.projectView.value?.documents ?? []"
        v-bind="
          model.document.value
            ? { selectedPath: model.document.value.path }
            : {}
        "
        :navigation-mode="port.navigationMode.value"
        @select-document="selectChapterDocument"
        @select-reference="selectReferenceCandidate"
        @mark-important="(path) => selectReferenceCandidate(path, 'important')"
        @return-to-discussion="showDiscussion"
        @set-navigation-mode="port.setNavigationMode"
      />
      <RightEditorPane
        v-if="!rightCollapsed"
        :document="document"
        :resource-id="document.id"
        :draft-state="undefined"
        :locked="false"
        default-view-mode="preview"
        :entry-search-items="[]"
        right-pane
        @collapse="rightCollapsed = true"
        @toggle-right="layout.togglePane('right')"
        @insert-selection="port.references.value.push($event)"
      />
      <div
        v-if="!rightCollapsed"
        class="pane-resizer pane-resizer-right"
        role="separator"
        tabindex="0"
        :aria-label="t('resizeContentPane')"
        aria-orientation="vertical"
        :aria-valuemin="writingRightPaneViewModel.minWidth"
        :aria-valuemax="writingRightPaneViewModel.maxWidth"
        :aria-valuenow="writingRightPaneViewModel.width"
        @pointerdown="layout.startPaneResize('right', $event)"
        @keydown="layout.handleResizeKeydown('right', $event)"
      />
      <section
        v-if="sourcesOpen"
        class="novel-source-popover"
        role="dialog"
        :aria-label="t('discussionSourcesDialog')"
      >
        <header>
          <strong>{{ t("discussionSourcesDialog") }}</strong
          ><button class="header-text-button" @click="sourcesOpen = false">
            {{ t("close") }}
          </button>
        </header>
        <p>
          {{ t("discussionSourcesHint") }}
        </p>
        <OtterMethodPicker
          :selected="port.selectedSkills.value"
          :sources="port.selectedSources.value"
          :entries="materialEntries"
          :disabled="preparing || controller.isBusy.value"
          @update:selected="port.selectedSkills.value = $event"
          @update:sources="port.selectedSources.value = $event"
        />
        <OtterManualSourcePicker
          :selected="port.selectedSources.value"
          :source-options="sourceOptions"
          :context-source-paths="[]"
          :disabled="preparing || controller.isBusy.value"
          @update:selected="port.selectedSources.value = $event"
        />
      </section>
    </template>
    <main
      v-else
      class="novel-feature-view"
      :class="{ 'is-review': model.tab.value === 'review' }"
    >
      <header v-if="model.tab.value !== 'review'" class="novel-feature-header">
        <button
          v-if="leftCollapsed"
          class="header-text-button"
          @click="leftCollapsed = false"
        >
          {{ t("expandDirectory") }}
        </button>
        <strong
          >{{
            model.tab.value === "external"
              ? t("discussionHandoff")
              : t("novelResources")
          }}{{ model.projectId.value ? " · " + projectTitle : "" }}</strong
        >
        <button
          v-if="model.projectId.value"
          class="header-text-button"
          @click="showDiscussion"
        >
          {{ t("returnToDiscussion") }}
        </button>
      </header>
      <OtterReviewPanel v-if="model.tab.value === 'review'" />
      <template
        v-else-if="model.tab.value === 'external' && model.projectId.value"
      >
        <div class="novel-handoff-actions">
          <button
            class="secondary-button"
            :disabled="
              !snapshot.length ||
              preparing ||
              port.controller.value.isBusy.value
            "
            @click="summarize"
          >
            {{ t("summarizeDiscussion") }}
          </button>
          <button class="header-text-button" @click="emit('openModels')">
            {{ t("modelSettings") }}
          </button>
        </div>
        <OtterManualReview
          :project-id="model.projectId.value"
          :context-ref="port.currentContext.value"
          :context-source-paths="port.contextSourcePaths.value"
          :discussion-snapshot="snapshot"
          :discussion-summary="summary || null"
          :source-options="sourceOptions"
          :active="model.tab.value === 'external'"
        />
      </template>
      <template v-else>
        <section v-if="!model.projectId.value" class="novel-onboarding">
          <strong>{{ t("chooseWorkspaceFirst") }}</strong>
          <span>{{ t("chooseWorkspaceReturnHint") }}</span>
          <button
            class="secondary-button"
            :disabled="model.loading.value"
            data-testid="otter-choose-workspace"
            @click="model.chooseWorkspace"
          >
            {{ t("chooseWorkspace") }}
          </button>
        </section>
      </template>
      <p v-if="model.error.value" role="alert">{{ model.error.value }}</p>
      <details
        v-if="model.projectId.value && model.tab.value !== 'review'"
        class="novel-chapter-tools"
        :open="chapterToolsOpen"
        @toggle="chapterToolsOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary>{{ t("chapterTaskHeading") }}</summary>
        <OtterWorkflowPanel v-if="chapterToolsOpen" :model="model" />
      </details>
    </main>
  </section>
</template>

<style>
.novel-workspace-adapter {
  display: contents;
}
.novel-feature-view {
  grid-column: 2 / 4;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 20px;
  background: var(--surface-main);
}
.novel-feature-view.is-review {
  padding: 0;
  overflow: hidden;
}
.novel-feature-header,
.novel-handoff-actions,
.novel-source-popover header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.novel-feature-header {
  margin-bottom: 16px;
}
.novel-feature-header strong {
  flex: 1;
}
.novel-source-popover {
  position: absolute;
  z-index: 40;
  top: 52px;
  left: var(--left-pane-width);
  width: min(550px, calc(100vw - 40px));
  max-height: 75vh;
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-raised);
  box-shadow: 0 12px 35px #0002;
}
.is-left-collapsed .novel-source-popover {
  left: 12px;
}
.novel-source-popover header {
  justify-content: space-between;
}
.novel-source-popover p {
  font-size: 12px;
  color: var(--text-secondary);
}
.novel-team-switcher {
  width: 120px;
  min-width: 0;
}
.novel-chapter-tools {
  margin-top: 24px;
}
.novel-onboarding {
  display: grid;
  justify-items: start;
  gap: 12px;
  max-width: 480px;
  padding: 20px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}
.novel-onboarding span {
  color: var(--text-secondary);
}
</style>
