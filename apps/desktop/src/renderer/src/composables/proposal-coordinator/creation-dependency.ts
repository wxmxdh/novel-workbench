import type { AgentConversationController } from "../useAgentConversation";

interface CreationDependencyOptions {
  conversation: AgentConversationController;
  runId: string;
  proposalId: string;
  creationProposalId: string;
  waitingMessage: string;
  blockedMessage: string;
}

export function reconcileCreationDependencyAfterAttempt(
  options: CreationDependencyOptions
): boolean {
  const creation = options.conversation.getEditProposal(
    options.runId,
    options.creationProposalId
  );
  if (creation?.status === "accepted") return false;

  const dependent = options.conversation.getEditProposal(
    options.runId,
    options.proposalId
  );
  if (
    !dependent ||
    (dependent.status !== "pending" &&
      dependent.status !== "accepting" &&
      dependent.status !== "error")
  ) {
    return true;
  }

  const waiting =
    !creation ||
    creation.status === "pending" ||
    creation.status === "accepting" ||
    creation.status === "error";
  options.conversation.updateEditProposal(
    options.runId,
    options.proposalId,
    waiting
      ? { status: "pending", statusMessage: options.waitingMessage }
      : {
          status: "conflict",
          proposedText: undefined,
          statusMessage: options.blockedMessage
        }
  );
  return true;
}
