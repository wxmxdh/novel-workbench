import { z } from "zod";
import type { LongWorkspaceIndexSnapshot } from "../long-workspace";
import { LongWorkspaceIndexSnapshotSchema } from "../long-workspace";

import { applyLongWorkspaceOperation } from "./dispatch";
import {
  LongWorkspaceImpactPreviewSchema,
  LongWorkspaceImpactSummarySchema,
  LongWorkspaceOperationBatchSchema,
  LongWorkspaceOperationResultSchema,
  type LongDocumentWriteProposal,
  type LongWorkspaceImpactConfirmation,
  type LongWorkspaceImpactPreview,
  type LongWorkspaceImpactSummary,
  type LongWorkspaceLedgerRecordEdit,
  type LongWorkspaceOperationBatchInput,
  type LongWorkspaceOperationResult
} from "./impact-schema";
import {
  reconcileEntityImpact,
  workspaceEntityChanges,
  workspaceRelationshipChanges
} from "./impact-diff";
import { longWorkspaceOperationsRequireImpactConfirmation } from "./impact-policy";
import type { MutationState } from "./state";
import {
  allWorkspaceFiles,
  normalizeLongWorkspaceOrders,
  operationError,
  orderedChapterIds
} from "./state";

export function applyDocumentWriteProposals(
  state: MutationState,
  proposals: readonly LongDocumentWriteProposal[]
): LongDocumentWriteProposal[] {
  const proposalIds = new Set<string>();
  const targetFileIds = new Set<string>();
  for (const proposal of proposals) {
    if (proposalIds.has(proposal.proposalId)) {
      operationError(
        "invalid_document_write",
        `Duplicate document proposal id ${proposal.proposalId}.`
      );
    }
    proposalIds.add(proposal.proposalId);
    if (targetFileIds.has(proposal.fileId)) {
      operationError(
        "invalid_document_write",
        `A batch may propose only one write for file ${proposal.fileId}.`
      );
    }
    targetFileIds.add(proposal.fileId);
    const intent = state.fileIntents.get(proposal.fileId);
    if (intent?.action === "delete") {
      operationError(
        "invalid_document_write",
        `Cannot write file ${proposal.fileId} while deleting it.`
      );
    }
    const file = allWorkspaceFiles(state.draft).find(
      (candidate) => candidate.id === proposal.fileId
    );
    if (!file) {
      operationError(
        "invalid_document_write",
        `Document proposal target ${proposal.fileId} does not exist.`
      );
    }

    if (proposal.mode === "create") {
      if (intent?.action !== "create") {
        operationError(
          "invalid_document_write",
          `Create proposal ${proposal.proposalId} must target a newly created file.`
        );
      }
      file.updatedAt = proposal.updatedAt;
      intent.file.updatedAt = proposal.updatedAt;
      continue;
    }

    if (intent?.action === "create") {
      operationError(
        "invalid_document_write",
        `New file ${proposal.fileId} requires create write mode.`
      );
    }
    file.updatedAt = proposal.updatedAt;
  }

  return proposals.map((proposal) => structuredClone(proposal));
}

export function impactSummary(
  state: MutationState,
  documentWrites: readonly LongDocumentWriteProposal[]
): LongWorkspaceImpactSummary {
  const fileIntents = [...state.fileIntents.values()];
  return LongWorkspaceImpactSummarySchema.parse({
    createdEntityIds: [...state.createdEntityIds].sort(),
    updatedEntityIds: [...state.updatedEntityIds].sort(),
    deletedEntityIds: [...state.deletedEntityIds].sort(),
    createdFileIds: fileIntents
      .filter(({ action }) => action === "create")
      .map(({ file }) => file.id)
      .sort(),
    deletedFileIds: fileIntents
      .filter(({ action }) => action === "delete")
      .map(({ file }) => file.id)
      .sort(),
    documentWriteProposalIds: documentWrites
      .map(({ proposalId }) => proposalId)
      .sort()
  });
}

export function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`
    )
    .join("; ");
}

export function simulateLongWorkspaceOperations(
  snapshotInput: LongWorkspaceIndexSnapshot,
  batchInput: LongWorkspaceOperationBatchInput
): LongWorkspaceOperationResult {
  const original = LongWorkspaceIndexSnapshotSchema.parse(snapshotInput);
  const batch = LongWorkspaceOperationBatchSchema.parse(batchInput);

  const state: MutationState = {
    original: structuredClone(original),
    draft: structuredClone(original),
    createdEntityIds: new Set(),
    updatedEntityIds: new Set(),
    deletedEntityIds: new Set(),
    fileIntents: new Map(),
    ledgerRecordEdits: new Map(),
    provisionalIdMap: {},
    updatedAt: batch.updatedAt
  };
  normalizeLongWorkspaceOrders(state.draft);

  for (const operation of batch.operations) {
    applyLongWorkspaceOperation(state, operation);
    normalizeLongWorkspaceOrders(state.draft);
  }

  const documentWrites = applyDocumentWriteProposals(
    state,
    batch.documentWrites
  );
  normalizeLongWorkspaceOrders(state.draft);
  const recordedChapterIds = new Set(
    state.draft.chapters
      .filter(({ commitId }) => commitId !== null)
      .map(({ chapterCardId }) => chapterCardId)
  );
  state.draft.ledger.committedThroughChapterId = null;
  for (const chapterCardId of orderedChapterIds(state.draft)) {
    if (!recordedChapterIds.has(chapterCardId)) break;
    state.draft.ledger.committedThroughChapterId = chapterCardId;
  }
  state.draft.updatedAt = batch.updatedAt;

  const parsedSnapshot = LongWorkspaceIndexSnapshotSchema.safeParse(
    state.draft
  );
  if (!parsedSnapshot.success) {
    operationError(
      "invalid_result",
      `Long workspace operations produced an invalid index: ${formatSchemaIssues(parsedSnapshot.error)}`
    );
  }
  state.draft = parsedSnapshot.data;
  reconcileEntityImpact(state);
  const entityChanges = workspaceEntityChanges(
    state.original,
    parsedSnapshot.data
  );
  const relationshipChanges = workspaceRelationshipChanges(
    state.original,
    parsedSnapshot.data
  );

  const fileIntents = [...state.fileIntents.values()].sort((left, right) =>
    left.file.id.localeCompare(right.file.id)
  );
  const ledgerRecordEdits = [...state.ledgerRecordEdits.values()]
    .map((edit): LongWorkspaceLedgerRecordEdit => ({
      ...structuredClone(edit),
      removePlacementIds: [...edit.removePlacementIds].sort(),
      removeForeshadowingBeatIds: [...edit.removeForeshadowingBeatIds].sort(),
      reconcileForeshadowingThreadIds: [
        ...edit.reconcileForeshadowingThreadIds
      ].sort(),
      removeSubjectIds: [...edit.removeSubjectIds].sort(),
      removeKnowledgeAudienceIds: [...edit.removeKnowledgeAudienceIds].sort(),
      removeFactIds: [...edit.removeFactIds].sort(),
      removeFactKeys: [...edit.removeFactKeys].sort((left, right) =>
        `${left.domain}\0${left.subjectId}\0${left.field}`.localeCompare(
          `${right.domain}\0${right.subjectId}\0${right.field}`
        )
      ),
      removeKnowledgeKeys: [...edit.removeKnowledgeKeys].sort((left, right) =>
        `${left.factId}\0${left.audienceType}\0${left.audienceId ?? ""}`.localeCompare(
          `${right.factId}\0${right.audienceType}\0${right.audienceId ?? ""}`
        )
      ),
      removeOpenLoopIds: [...edit.removeOpenLoopIds].sort()
    }))
    .sort((left, right) => left.commitId.localeCompare(right.commitId));
  const impact = impactSummary(state, documentWrites);
  const confirmation: LongWorkspaceImpactConfirmation = {
    impact,
    entityChanges,
    relationshipChanges,
    fileIntents,
    ledgerRecordEdits
  };
  return LongWorkspaceOperationResultSchema.parse({
    impact,
    entityChanges,
    relationshipChanges,
    fileIntents,
    ledgerRecordEdits,
    confirmation,
    documentWrites,
    provisionalIdMap: state.provisionalIdMap,
    snapshot: parsedSnapshot.data
  });
}

export function impactConfirmationsMatch(
  expected: LongWorkspaceImpactConfirmation,
  actual: LongWorkspaceImpactConfirmation
): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/**
 * Computes a deterministic structure/file-impact preview without mutating the
 * caller's snapshot or writing any files.
 */
export function previewLongWorkspaceOperations(
  snapshot: LongWorkspaceIndexSnapshot,
  batch: LongWorkspaceOperationBatchInput
): LongWorkspaceImpactPreview {
  const result = simulateLongWorkspaceOperations(snapshot, batch);
  return LongWorkspaceImpactPreviewSchema.parse({
    impact: result.impact,
    entityChanges: result.entityChanges,
    relationshipChanges: result.relationshipChanges,
    fileIntents: result.fileIntents,
    ledgerRecordEdits: result.ledgerRecordEdits,
    confirmation: result.confirmation,
    documentWrites: result.documentWrites,
    provisionalIdMap: result.provisionalIdMap
  });
}

/**
 * Applies a long-form structure batch to an in-memory clone. Any simulated
 * destructive effect requires the caller-approved exact confirmation produced
 * by the preview function. This function never writes disk.
 */
export function applyLongWorkspaceOperations(
  snapshot: LongWorkspaceIndexSnapshot,
  batchInput: LongWorkspaceOperationBatchInput
): LongWorkspaceOperationResult {
  const batch = LongWorkspaceOperationBatchSchema.parse(batchInput);
  const result = simulateLongWorkspaceOperations(snapshot, batch);
  if (
    longWorkspaceOperationsRequireImpactConfirmation(
      batch.operations,
      result
    ) &&
    batch.expectedImpact === undefined
  ) {
    operationError(
      "impact_mismatch",
      "Destructive workspace changes require an exact expectedImpact from preview."
    );
  }
  if (
    batch.expectedImpact !== undefined &&
    !impactConfirmationsMatch(batch.expectedImpact, result.confirmation)
  ) {
    operationError(
      "impact_mismatch",
      "Operation impact no longer matches the caller-approved preview."
    );
  }
  return result;
}
