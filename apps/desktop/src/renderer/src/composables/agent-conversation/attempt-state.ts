import type { ChatMessage } from "../../types/conversation";
import { cloneEditProposal } from "./clone";

/**
 * Model-turn checkpoints own streamed model activity, but edit proposals are
 * advanced by an independent local persistence queue. Keep the live proposal
 * objects when rolling a failed model attempt back so a completed or failed
 * disk transaction cannot be reverted to an orphaned `accepting` snapshot.
 */
export function preserveLiveEditProposals(
  current: ChatMessage,
  restored: ChatMessage
): void {
  if (current.editProposals === undefined) return;

  const liveById = new Map(
    current.editProposals.map((proposal) => [proposal.id, proposal] as const)
  );
  const restoredIds = new Set<string>();
  const merged = (restored.editProposals ?? []).map((proposal) => {
    restoredIds.add(proposal.id);
    return cloneEditProposal(liveById.get(proposal.id) ?? proposal);
  });
  for (const proposal of current.editProposals) {
    if (!restoredIds.has(proposal.id)) {
      merged.push(cloneEditProposal(proposal));
    }
  }
  restored.editProposals = merged;
}

/** Marks presentation-only tool activity that can no longer receive a result. */
export function finalizeUnfinishedMessageTools(
  message: ChatMessage,
  completedAt: string,
  reason: string
): void {
  for (const toolCall of message.toolCalls ?? []) {
    if (toolCall.status !== "preparing" && toolCall.status !== "running") {
      continue;
    }
    toolCall.status = "error";
    toolCall.completedAt = completedAt;
    toolCall.resultSummary ??= reason;
    toolCall.isError = true;
  }
  for (const tool of message.tools ?? []) {
    if (tool.status !== "running") continue;
    tool.status = "error";
    tool.summary ??= reason;
  }
}
