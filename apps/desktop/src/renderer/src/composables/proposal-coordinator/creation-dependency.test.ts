import { describe, expect, it, vi } from "vitest";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import { reconcileCreationDependencyAfterAttempt } from "./creation-dependency";

function proposal(
  id: string,
  status: AgentEditProposal["status"]
): AgentEditProposal {
  return {
    id,
    runId: "run-dependency",
    workspaceId: "workspace-dependency",
    stageId: "draft",
    documentId: id,
    title: id,
    summary: id,
    status,
    baseRevision: `base-${id}`,
    proposedRevision: `next-${id}`,
    proposedText: id,
    toolCallIds: [`tool-${id}`],
    additions: 1,
    deletions: 0,
    hunks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function fixture(creationStatus: AgentEditProposal["status"]) {
  const proposals = new Map([
    ["creation", proposal("creation", creationStatus)],
    ["dependent", proposal("dependent", "accepting")]
  ]);
  const conversation = {
    getEditProposal: vi.fn((runId: string, proposalId: string) => {
      const current = proposals.get(proposalId);
      return current?.runId === runId ? current : undefined;
    }),
    updateEditProposal: vi.fn(
      (
        runId: string,
        proposalId: string,
        patch: Partial<AgentEditProposal>
      ) => {
        const current = proposals.get(proposalId);
        if (!current || current.runId !== runId) return;
        proposals.set(proposalId, { ...current, ...patch });
      }
    )
  } as unknown as AgentConversationController;
  return { conversation, proposals };
}

function reconcile(conversation: AgentConversationController) {
  return reconcileCreationDependencyAfterAttempt({
    conversation,
    runId: "run-dependency",
    proposalId: "dependent",
    creationProposalId: "creation",
    waitingMessage: "等待创建重试",
    blockedMessage: "创建已阻断"
  });
}

describe("creation approval dependency", () => {
  it("continues when creation was accepted", () => {
    const { conversation, proposals } = fixture("accepted");

    expect(reconcile(conversation)).toBe(false);
    expect(proposals.get("dependent")?.status).toBe("accepting");
  });

  it("returns the dependent edit to pending while creation is retryable", () => {
    const { conversation, proposals } = fixture("error");

    expect(reconcile(conversation)).toBe(true);
    expect(proposals.get("dependent")?.status).toBe("pending");
    expect(proposals.get("dependent")?.statusMessage).toBe("等待创建重试");
  });

  it("blocks the dependent edit after a terminal creation conflict", () => {
    const { conversation, proposals } = fixture("conflict");

    expect(reconcile(conversation)).toBe(true);
    expect(proposals.get("dependent")?.status).toBe("conflict");
    expect(proposals.get("dependent")?.proposedText).toBeUndefined();
    expect(proposals.get("dependent")?.statusMessage).toBe("创建已阻断");
  });
});
