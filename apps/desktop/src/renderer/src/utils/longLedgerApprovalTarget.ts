import {
  longCommitInputCheckpointChapterId,
  type SystemEventEnvelope
} from "@deepwrite/contracts";

type LongLedgerCommitProposalEvent = Extract<
  SystemEventEnvelope,
  { type: "long.ledger_commit_proposal" }
>;

export function longLedgerApprovalTarget(event: LongLedgerCommitProposalEvent) {
  return {
    kind: "long" as const,
    bookId: event.payload.bookId,
    candidates: [
      {
        kind: "chapter-card" as const,
        chapterCardId: longCommitInputCheckpointChapterId(event.payload.input),
        view: "continuity" as const
      },
      { kind: "root" as const, root: "continuity_ledger" as const }
    ]
  };
}
