import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking
} from "@earendil-works/pi-ai";
import type { AgentTurnRetryPolicyOptions } from "./agent-turn-retry";
import { conversationAgentKey } from "./conversation-agent-rebuild";
import { buildLocalThinking, buildLocalWritingResponse } from "./faux-local";
import type { AgentRunPlan } from "./kernel/run-plan";
import { libraryManagementParentPrompt } from "./library-management-runtime";
import { resolvePortableToolSchemaProfile } from "./portable-tool-schema";
import {
  buildEffectiveSystemPrompt,
  buildLongFollowUpTurnUserMessageContent,
  buildRawUserMessage,
  buildRuntimeUserMessageContent,
  longAgentRefreshesDesignContextOnLaterTurns
} from "./prompts";
import { buildRunTools } from "./run-tools";
import type { AgentRunInput } from "./runtime-types";
import type { AgentToolExecutionHooks } from "./subagent-runtime";
import { workspaceContextPolicy } from "./workspace-context-policy";
import { createLoveReviewRunState } from "./love-review-runtime";
import {
  blockedLoveReviewOutput,
  requestsLoveReviewExecution
} from "./love-review-output-guard";
import { loveReviewParentRequirements } from "./love-review-prepare-tool";
import { toSubagentRuntimeEvents } from "./subagent-events";
import { loveWorkflowParentRequirements } from "./love-workflow-parent";
import { createLoveWorkflowStart } from "./love-workflow-start";
import { approvedVoiceContextText, nativeWritingReferenceContextText } from "./approved-voice-context";

export interface WorkspaceRunPlanOptions {
  basePrompt: string;
  toolExecutionHooks: AgentToolExecutionHooks;
  retryPolicy?: AgentTurnRetryPolicyOptions;
  subagentTimeoutMs?: number;
}

/**
 * Assembles creation-space and library runs that arrive through
 * `session.prompt`. "更多功能" agents, chat included, use `planExtrasRun`.
 */
export function planWorkspaceRun(
  input: AgentRunInput,
  options: WorkspaceRunPlanOptions
): AgentRunPlan {
  const shortWorkspace = input.workspaceContext?.shortWorkspace;
  const scriptWorkspace = input.workspaceContext?.scriptWorkspace;
  const contextPolicy = workspaceContextPolicy(input);
  const loveWorkflowStart = createLoveWorkflowStart(input);
  const loveReviewRunState = createLoveReviewRunState();
  loveReviewRunState.requested =
    input.workspaceContext?.longWorkspace?.bookId === "longbook_9a146bbe" &&
    requestsLoveReviewExecution(input.prompt);
  const portableToolSchemaProfile = resolvePortableToolSchemaProfile(
    input.workspaceContext
  );
  return {
    target: input,
    eventSource: input,
    agentKey: conversationAgentKey(input),
    portableToolSchemaProfile,
    fauxResponses: (thinkingLevel) => [
      fauxAssistantMessage(
        thinkingLevel === "off"
          ? [fauxText(buildLocalWritingResponse(input))]
          : [
              fauxThinking(buildLocalThinking(input)),
              fauxText(buildLocalWritingResponse(input))
            ]
      )
    ],
    build: (context) => ({
      systemPrompt: [
        buildEffectiveSystemPrompt(options.basePrompt, input),
        libraryManagementParentPrompt(input),
        loveReviewParentRequirements(
          input.workspaceContext?.longWorkspace?.bookId
        ),
        loveWorkflowParentRequirements(
          input.workspaceContext?.longWorkspace?.bookId
        )
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools: buildRunTools(input, {
        model: context.model,
        thinkingLevel: context.thinkingLevel,
        streamFn: context.spawnStreamFn,
        parentRuntime: context.runtime,
        parentSignal: context.parentSignal,
        requestUserInput: context.requestUserInput,
        portableToolSchemaProfile,
        toolExecutionHooks: options.toolExecutionHooks,
        ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
        ...(options.subagentTimeoutMs === undefined
          ? {}
          : { subagentTimeoutMs: options.subagentTimeoutMs }),
        getParentMessages: context.getParentMessages,
        onContextCompacted: context.onContextCompacted,
        loveReviewRunState
      })
    }),
    ...(contextPolicy ? { contextPolicy } : {}),
    ...(loveWorkflowStart
      ? { beforeStart: (signal: AbortSignal) => loveWorkflowStart.load(signal) }
      : {}),
    beforeComplete: async (completed, emitEvent, reviseSummary) => {
      const result = loveReviewRunState.finalizeActualOutput
        ? await loveReviewRunState.finalizeActualOutput(
            completed.payload.content,
            completed.payload.runtime,
            (progress) => {
              for (const event of toSubagentRuntimeEvents(
                progress,
                input,
                completed.payload.runtime,
                completed.payload.messageId
              ))
                emitEvent(event);
            },
            reviseSummary
          )
        : loveReviewRunState.requested
          ? { reviewNotice: "not_started" as const }
          : undefined;
      if (!result) return undefined;
      const content = blockedLoveReviewOutput(loveReviewRunState, result);
      return { ...result, ...(content ? { content } : {}) };
    },
    rawUserMessageContent: () => buildRawUserMessage(input).content,
    // Plot-design and draft turns also receive their latest structure
    // snapshots; tools and the system prompt are still refreshed before every run.
    userMessageContent: (firstTurn) => {
      const original = firstTurn
        ? buildRuntimeUserMessageContent(input)
        : (input.agentProfile && shortWorkspace) ||
            (input.scriptAgentProfile && scriptWorkspace)
          ? buildRuntimeUserMessageContent(input)
          : longAgentRefreshesDesignContextOnLaterTurns(
                input.longAgentProfile?.id
              ) && input.workspaceContext?.longWorkspace
            ? buildLongFollowUpTurnUserMessageContent(input)
            : buildRawUserMessage(input).content;
      const sources = [
        loveWorkflowStart?.context(),
        approvedVoiceContextText(
          input.workspaceContext?.longWorkspace?.approvedVoicePackage
        ),
        nativeWritingReferenceContextText(
          input.workspaceContext?.longWorkspace?.selectedDraftReferences,
          input.workspaceContext?.longWorkspace?.selectedChapterOutline
        )
      ]
        .filter(Boolean)
        .join("\n\n");
      return sources
        ? typeof original === "string"
          ? `${original}\n\n${sources}`
          : [...original, { type: "text" as const, text: sources }]
        : original;
    }
  };
}
