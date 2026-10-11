import { describe, expect, it, vi } from "vitest";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import { createProposalQueue } from "./queue";

function createProposal(id: string, createdAt: string): AgentEditProposal {
  return {
    id,
    laneId: id,
    generation: 1,
    approvalMode: "auto-approve",
    sourceBaseRevision: `base-${id}`,
    runId: "run-queue",
    workspaceId: "workspace-queue",
    stageId: "draft",
    documentId: `document-${id}`,
    title: id,
    summary: id,
    status: "pending",
    baseRevision: `base-${id}`,
    proposedRevision: `next-${id}`,
    proposedText: `content-${id}`,
    toolCallIds: [`tool-${id}`],
    additions: 1,
    deletions: 0,
    hunks: [],
    createdAt,
    updatedAt: createdAt
  };
}

function createConversation(initial: readonly AgentEditProposal[]) {
  const proposals = new Map(initial.map((proposal) => [proposal.id, proposal]));
  const conversation = {
    getEditProposal: vi.fn((runId: string, proposalId: string) => {
      const proposal = proposals.get(proposalId);
      return proposal?.runId === runId ? proposal : undefined;
    }),
    updateEditProposal: vi.fn(
      (
        runId: string,
        proposalId: string,
        patch: Partial<AgentEditProposal>
      ) => {
        const proposal = proposals.get(proposalId);
        if (!proposal || proposal.runId !== runId) return;
        proposals.set(proposalId, { ...proposal, ...patch });
      }
    )
  } as unknown as AgentConversationController;
  return {
    conversation,
    proposal: (proposalId: string) => proposals.get(proposalId)!
  };
}

describe("proposal approval queue", () => {
  it("keeps dependent edits dormant and resumes them after a failed dependency is retried", async () => {
    const fixture = createConversation([
      createProposal("create-section", "2026-01-01T00:00:00.000Z"),
      createProposal("write-section", "2026-01-01T00:00:01.000Z")
    ]);
    let creationAttempts = 0;
    let bodyAttempts = 0;
    const reportUnexpectedError = vi.fn();
    const queue = createProposalQueue({
      priority: (_conversation, _runId, proposalId) =>
        proposalId === "create-section" ? 0 : 1,
      reportUnexpectedError,
      apply: async (queued) => {
        if (queued.proposalId === "create-section") {
          creationAttempts += 1;
          fixture.conversation.updateEditProposal(
            queued.runId,
            queued.proposalId,
            {
              status: creationAttempts === 1 ? "error" : "accepted"
            }
          );
          return;
        }
        bodyAttempts += 1;
        fixture.conversation.updateEditProposal(
          queued.runId,
          queued.proposalId,
          fixture.proposal("create-section").status === "accepted"
            ? { status: "accepted" }
            : { status: "pending", statusMessage: "正在等待关联章节创建完成…" }
        );
      }
    });

    queue.queueAgentEdit(
      fixture.conversation,
      "session-queue",
      "run-queue",
      "create-section",
      true,
      false
    );
    queue.queueAgentEdit(
      fixture.conversation,
      "session-queue",
      "run-queue",
      "write-section",
      true,
      false
    );
    queue.scheduleQueuedAgentEdits(() => true);
    await queue.drain();

    expect(fixture.proposal("create-section").status).toBe("error");
    expect(fixture.proposal("write-section").status).toBe("pending");
    expect(bodyAttempts).toBeGreaterThan(0);
    expect(queue.hasQueuedAgentEdits()).toBe(false);

    queue.queueAgentEdit(
      fixture.conversation,
      "session-queue",
      "run-queue",
      "create-section",
      true,
      true
    );
    await queue.drain();

    expect(creationAttempts).toBe(2);
    expect(fixture.proposal("create-section").status).toBe("accepted");
    expect(fixture.proposal("write-section").status).toBe("accepted");
    expect(queue.hasQueuedAgentEdits()).toBe(false);
    expect(reportUnexpectedError).not.toHaveBeenCalled();
  });

  it("isolates an unexpected item failure and continues later independent approvals", async () => {
    const fixture = createConversation([
      createProposal("broken", "2026-01-01T00:00:00.000Z"),
      createProposal("independent", "2026-01-01T00:00:01.000Z")
    ]);
    const reportUnexpectedError = vi.fn();
    const queue = createProposalQueue({
      priority: () => 1,
      reportUnexpectedError,
      apply: async (queued) => {
        if (queued.proposalId === "broken") {
          throw new Error("simulated queue failure");
        }
        fixture.conversation.updateEditProposal(
          queued.runId,
          queued.proposalId,
          { status: "accepted" }
        );
      }
    });

    for (const proposalId of ["broken", "independent"]) {
      queue.queueAgentEdit(
        fixture.conversation,
        "session-queue",
        "run-queue",
        proposalId,
        true,
        false
      );
    }
    queue.scheduleQueuedAgentEdits(() => true);
    await queue.drain();

    expect(fixture.proposal("broken").status).toBe("error");
    expect(fixture.proposal("broken").statusMessage).toContain(
      "后续独立任务将继续"
    );
    expect(fixture.proposal("independent").status).toBe("accepted");
    expect(reportUnexpectedError).toHaveBeenCalledTimes(1);
    expect(queue.hasQueuedAgentEdits()).toBe(false);
  });

  it("returns a non-terminal approval to pending instead of leaving it accepting", async () => {
    const fixture = createConversation([
      createProposal("waiting", "2026-01-01T00:00:00.000Z")
    ]);
    const queue = createProposalQueue({
      priority: () => 1,
      reportUnexpectedError: vi.fn(),
      apply: async () => undefined
    });

    queue.queueAgentEdit(
      fixture.conversation,
      "session-queue",
      "run-queue",
      "waiting",
      true,
      true
    );
    await queue.drain();

    expect(fixture.proposal("waiting").status).toBe("pending");
    expect(fixture.proposal("waiting").statusMessage).toContain(
      "依赖完成后将自动继续"
    );
    expect(queue.hasQueuedAgentEdits()).toBe(false);
  });
});
