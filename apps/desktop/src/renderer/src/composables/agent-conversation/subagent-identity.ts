import { createScopedTranslator } from "../../i18n";
import type { AgentConversationContext } from "./context";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import type { AgentSubagentRun, ChatMessage } from "../../types/conversation";
import type { SubagentEventPayload } from "./types";
import { isRecord } from "./shared";

const t = createScopedTranslator("workspace.subagentIdentity");

type SubagentIdentityContext = Pick<
  AgentConversationContext,
  "earlierTimestamp"
>;
export function subagentTurnKey(
  ctx: SubagentIdentityContext,
  runId: string,
  subagentRunId: string
): string {
  return `${runId}\u0000${subagentRunId}`;
}
export function earlierTimestamp(
  ctx: SubagentIdentityContext,
  current: string,
  candidate: string
): string {
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (!Number.isFinite(currentTime)) return candidate;
  if (!Number.isFinite(candidateTime)) return current;
  return candidateTime < currentTime ? candidate : current;
}
export function ensurePendingSubagentRunForTool(
  ctx: SubagentIdentityContext,
  message: ChatMessage,
  toolCallId: string,
  args: unknown,
  eventRuntime: AgentRuntimeRef,
  eventTimestamp: string
): void {
  const record = isRecord(args) ? args : {};
  const rawTasks = Array.isArray(record.tasks) ? record.tasks : undefined;
  const tasks = rawTasks?.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const subagentId =
      typeof entry.subagent_id === "string" && entry.subagent_id.trim()
        ? entry.subagent_id.trim()
        : undefined;
    const task =
      typeof entry.task === "string" && entry.task.trim()
        ? entry.task.trim()
        : undefined;
    const taskId =
      typeof entry.task_id === "string" && entry.task_id.trim()
        ? entry.task_id.trim()
        : undefined;
    return subagentId && task && taskId ? [{ subagentId, task, taskId }] : [];
  });
  if (tasks?.length) {
    message.subagentRuns ??= [];
    for (const item of tasks) {
      if (
        message.subagentRuns.some(
          (run) =>
            run.parentToolCallId === toolCallId &&
            run.subagentId === item.subagentId &&
            run.subagentRunId.startsWith("pending:")
        )
      )
        continue;
      message.subagentRuns.push({
        parentToolCallId: toolCallId,
        subagentRunId: `pending:${toolCallId}:${item.taskId}`,
        subagentId: item.subagentId,
        name: item.subagentId,
        task: item.task,
        status: "running",
        runtime: { ...eventRuntime },
        toolCalls: [],
        processingSteps: [],
        startedAt: eventTimestamp
      });
    }
    return;
  }
  if (
    message.subagentRuns?.some((run) => run.parentToolCallId === toolCallId)
  ) {
    return;
  }
  const subagentId =
    typeof record.subagent_id === "string" && record.subagent_id.trim()
      ? record.subagent_id.trim()
      : "subagent";
  const task =
    typeof record.task === "string" && record.task.trim()
      ? record.task.trim()
      : t("receivingSubtask");
  (message.subagentRuns ??= []).push({
    parentToolCallId: toolCallId,
    subagentRunId: `pending:${toolCallId}`,
    subagentId,
    name: subagentId,
    task,
    status: "running",
    runtime: { ...eventRuntime },
    toolCalls: [],
    processingSteps: [],
    startedAt: eventTimestamp
  });
}
export function ensureSubagentRun(
  ctx: SubagentIdentityContext,
  message: ChatMessage,
  payload: SubagentEventPayload,
  eventTimestamp: string,
  task?: string
): AgentSubagentRun {
  let run = message.subagentRuns?.find(
    (candidate) => candidate.subagentRunId === payload.subagentRunId
  );
  run ??= message.subagentRuns?.find(
    (candidate) =>
      candidate.parentToolCallId === payload.parentToolCallId &&
      candidate.subagentId === payload.subagentId &&
      candidate.subagentRunId.startsWith("pending:")
  );
  if (!run) {
    run = {
      parentToolCallId: payload.parentToolCallId,
      subagentRunId: payload.subagentRunId,
      subagentId: payload.subagentId,
      name: payload.name,
      task: task ?? t("receivingSubtask"),
      status: "running",
      runtime: { ...payload.runtime },
      toolCalls: [],
      processingSteps: [],
      startedAt: eventTimestamp
    };
    (message.subagentRuns ??= []).push(run);
    return run;
  }
  const wasPending = run.subagentRunId.startsWith("pending:");
  run.subagentRunId = payload.subagentRunId;
  run.parentToolCallId = payload.parentToolCallId;
  run.subagentId = payload.subagentId;
  run.name = payload.name;
  run.runtime = { ...payload.runtime };
  run.startedAt = wasPending
    ? eventTimestamp
    : ctx.earlierTimestamp(run.startedAt, eventTimestamp);
  if (task !== undefined) {
    run.task = task;
  }
  return run;
}
