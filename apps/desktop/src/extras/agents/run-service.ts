import {
  CommandEnvelopeSchema,
  EXTRAS_AGENT_USAGE_MODULES,
  SessionPromptAcceptedPayloadSchema,
  assertExtrasAgentBudget,
  createEnvelope,
  isDeepSeekWebSearchCompatible,
  type AgentProviderRuntimeConfig,
  type AgentRuntimeRef,
  type CommandEnvelope,
  type CommandResult,
  type ExtrasAgentRunSpec,
  type ExtrasAgentTask
} from "@deepwrite/contracts";
import type {
  OtterContextRef,
  OtterRuntimeContext
} from "@deepwrite/contracts";
import {
  withCompactionUsageConfig,
  type ContextCompactionRun
} from "../../main/context-compaction-run";
import { resolveModelRunSettings } from "../../main/model-run-settings";
import {
  createUsageRunContext,
  type UsageRunContext
} from "../../main/usage-observation";
import type { ChatRuntimeSources } from "./chat/runtime-snapshot";
import type { ExtrasAgentConfigStore } from "./config-store";
import { resolveExtrasTask } from "./task-resolver";
import type { AgentRunDiagnostics } from "./agent-run-diagnostics";

type ExtrasAgentRunCommand = Extract<
  CommandEnvelope,
  { type: "extrasAgent.run" }
>;

/** The subset of Main's run registry an extras run needs. */
export interface ExtrasAgentActiveRun {
  sessionId: string;
  correlationId: string;
  runtime: AgentRuntimeRef;
  accepted: boolean;
  promptRequestId?: string;
  resourceId?: string;
  usageContext?: UsageRunContext;
}

export interface ExtrasAgentRunDependencies {
  configStore(): ExtrasAgentConfigStore;
  chatSources: ChatRuntimeSources;
  resolveModel(
    modelId: string | undefined
  ): Promise<AgentProviderRuntimeConfig | undefined>;
  resolveOtterContext?(
    reference: OtterContextRef
  ): Promise<OtterRuntimeContext>;
  /** Compaction settings for conversation agents; one-shot tasks never compact. */
  resolveContextCompaction(
    runModelId: string | undefined
  ): Promise<ContextCompactionRun>;
  requestAgent(command: CommandEnvelope): Promise<CommandResult>;
  /**
   * Holds the conversation against history management until the run is
   * registered; undefined while that conversation's history is being managed.
   */
  acquireConversation(sessionId: string): (() => void) | undefined;
  activeRuns: Map<string, ExtrasAgentActiveRun>;
  terminalRuns: ReadonlySet<string>;
  pendingUsageContexts: Map<string, UsageRunContext>;
  diagnostics?: AgentRunDiagnostics;
}

function rejected(
  command: CommandEnvelope,
  message: string,
  code = "extras_agent.run_failed"
): CommandResult {
  return {
    status: "rejected",
    requestId: command.id,
    error: { code, message }
  };
}

function assertWebSearchSupported(
  task: ExtrasAgentTask,
  runtimeConfig: AgentProviderRuntimeConfig | undefined
): void {
  const requested =
    "webSearchEnabled" in task.input && task.input.webSearchEnabled === true;
  if (requested && !isDeepSeekWebSearchCompatible(runtimeConfig)) {
    throw new Error(
      "智能搜索仅支持 Provider 为 DeepSeek，且 API 类型为 OpenAI Responses 或 Anthropic Messages 的模型。"
    );
  }
}

/**
 * Resolves the saved profile, model and budget for a "更多功能" run and hands
 * the authoritative spec to the Agent Utility. Mirrors `session.prompt`
 * bookkeeping so usage, aborts and busy checks see extras runs too.
 */
export async function runExtrasAgent(
  deps: ExtrasAgentRunDependencies,
  command: ExtrasAgentRunCommand
): Promise<CommandResult> {
  const { correlationId } = command.context;
  const { task, conversation, sessionId } = command.payload;
  await deps.diagnostics?.record({
    phase: "request_received",
    sessionId,
    correlationId
  });
  const release = conversation
    ? deps.acquireConversation(sessionId)
    : () => undefined;
  if (!release) {
    await deps.diagnostics?.record({
      phase: "request_rejected",
      errorCode: "conversation_history_busy",
      sessionId,
      correlationId
    });
    return rejected(
      command,
      "此对话正在管理历史，请稍后重试。",
      "conversation_history.busy"
    );
  }
  let diagnosticRecorded = false;
  try {
    const runtimeConfig = await deps.resolveModel(command.payload.modelId);
    if (
      task.agentId === "chat-normal" &&
      task.input.otter &&
      !runtimeConfig &&
      process.env.DEEPWRITE_SMOKE !== "1"
    ) {
      throw new Error(
        "尚未配置 API 模型。请先配置模型，或使用手动交接外部工具。"
      );
    }
    assertWebSearchSupported(task, runtimeConfig);
    const resolution = await resolveExtrasTask(
      deps.configStore(),
      deps.chatSources,
      task,
      deps.resolveOtterContext
    );
    if (
      resolution.task.agentId === "chat-normal" &&
      resolution.task.input.otterContext
    ) {
      const otter = resolution.task.input.otterContext;
      if (
        !sessionId.startsWith(`otter:${otter.projectId}:${otter.contextId}:`)
      ) {
        throw new Error(
          "Otter 会话必须隔离当前项目和 Context；请重新开始本轮会话。"
        );
      }
    }
    try {
      assertExtrasAgentBudget(resolution.task, runtimeConfig);
    } catch (error: unknown) {
      await deps.diagnostics?.record({
        phase: "budget_rejected",
        errorCode: "context_budget_exceeded",
        sessionId,
        correlationId
      });
      diagnosticRecorded = true;
      throw error;
    }
    const { thinkingLevel, temperature } = resolveModelRunSettings(
      runtimeConfig,
      {
        thinkingLevel: command.payload.thinkingLevel,
        temperature: command.payload.temperature
      }
    );
    const compaction = conversation
      ? await deps.resolveContextCompaction(runtimeConfig?.id)
      : undefined;
    const spec: ExtrasAgentRunSpec = {
      sessionId,
      ...(runtimeConfig ? { runtimeConfig } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      task: resolution.task,
      ...(conversation ? { conversation } : {}),
      ...compaction
    };
    const usageContext = createUsageRunContext(
      EXTRAS_AGENT_USAGE_MODULES[task.agentId],
      runtimeConfig,
      compaction ? withCompactionUsageConfig({}, compaction) : {}
    );
    deps.pendingUsageContexts.set(correlationId, usageContext);
    const internalCommand = CommandEnvelopeSchema.parse(
      createEnvelope("agent.extras_run", spec, {
        id: command.id,
        context: command.context
      })
    );
    const result = await deps.requestAgent(internalCommand);
    if (result.status !== "accepted") {
      await deps.diagnostics?.record({
        phase: "request_rejected",
        errorCode: "agent_dispatch_rejected",
        sessionId,
        correlationId
      });
      return result;
    }
    const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
    const provisional = [...deps.activeRuns.entries()].find(
      ([, run]) => run.correlationId === correlationId
    );
    if (
      accepted.sessionId !== sessionId ||
      (provisional && provisional[0] !== accepted.runId)
    ) {
      await deps.diagnostics?.record({
        phase: "request_rejected",
        errorCode: "invalid_acceptance",
        sessionId,
        correlationId,
        runId: accepted.runId
      });
      return rejected(
        command,
        "Agent acceptance does not match the extras agent run.",
        "ipc.invalid_agent_acceptance"
      );
    }
    if (!deps.terminalRuns.has(accepted.runId)) {
      deps.activeRuns.set(accepted.runId, {
        sessionId: accepted.sessionId,
        correlationId,
        runtime: accepted.runtime,
        accepted: true,
        promptRequestId: internalCommand.id,
        ...(resolution.resourceId ? { resourceId: resolution.resourceId } : {}),
        usageContext
      });
    }
    await deps.diagnostics?.accepted({
      sessionId,
      correlationId,
      runId: accepted.runId
    });
    return { status: "accepted", requestId: command.id, payload: accepted };
  } catch (error: unknown) {
    if (!diagnosticRecorded)
      await deps.diagnostics?.record({
        phase: "request_rejected",
        errorCode: "run_failed",
        sessionId,
        correlationId
      });
    return rejected(
      command,
      error instanceof Error ? error.message : "启动智能体失败。"
    );
  } finally {
    deps.pendingUsageContexts.delete(correlationId);
    release();
  }
}
