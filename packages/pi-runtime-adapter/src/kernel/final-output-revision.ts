import {
  Agent,
  type StreamFn,
  type ThinkingLevel
} from "@earendil-works/pi-agent-core";
import type { Api, Model, AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentRuntimeRef } from "@deepwrite/contracts";
import {
  runAgentWithTurnRetries,
  type AgentTurnRetryPolicyOptions
} from "../agent-turn-retry";
import { toUsageObservedRuntimeEvent } from "../event-mapping";
import type { AgentRuntimeEvent, AgentRunEventSource } from "../runtime-types";

/** One isolated, tool-free correction using the parent's actual model.
 * It cannot write a novel, spawn another team or approve an author decision. */
export async function reviseFinalOutput(input: {
  prompt: string;
  systemPrompt: string;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  streamFn: StreamFn;
  runtime: AgentRuntimeRef;
  source: AgentRunEventSource;
  messageId: string;
  signal: AbortSignal;
  retryPolicy?: AgentTurnRetryPolicyOptions;
  emit: (event: AgentRuntimeEvent) => void;
  onActivity?: () => void;
}): Promise<string> {
  input.signal.throwIfAborted();
  const agent = new Agent({
    initialState: {
      systemPrompt:
        input.systemPrompt +
        "\n【本次只修正审阅总结】不得写正文、调用工具或代替作者裁决。",
      model: input.model,
      thinkingLevel: input.thinkingLevel,
      tools: [],
      messages: []
    },
    streamFn: input.streamFn,
    sessionId: `${input.source.sessionId}:summary-correction:${input.source.runId}`
  });
  let final: AssistantMessage | undefined;
  await runAgentWithTurnRetries({
    agent,
    initialPrompt: {
      role: "user",
      content: input.prompt,
      timestamp: Date.now()
    },
    runId: `${input.source.runId}:summary-correction`,
    signal: input.signal,
    ...(input.retryPolicy ? { retryPolicy: input.retryPolicy } : {}),
    onEvent: () => input.onActivity?.(),
    onAssistantMessageEnded: (message, attempt) => {
      final = message;
      const event = toUsageObservedRuntimeEvent(
        message,
        input.source,
        input.runtime,
        input.messageId,
        attempt
      );
      if (event) input.emit(event);
    }
  });
  input.signal.throwIfAborted();
  if (
    !final ||
    final.stopReason !== "stop" ||
    final.content.some((item) => item.type === "toolCall")
  )
    throw new Error("汇总修正未完整结束，保留原汇总和复核意见。");
  const text = final.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("")
    .trim();
  if (!text || text.length > 80_000)
    throw new Error("汇总修正为空或超出完整交付范围，未替换原汇总。");
  return text;
}
