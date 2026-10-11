import type { LongWorkspaceImpactConfirmation } from "./impact-schema";
import type { LongWorkspaceOperation } from "./operation-schema";

export type LongWorkspaceDestructiveImpact = Pick<
  LongWorkspaceImpactConfirmation,
  "entityChanges" | "relationshipChanges" | "fileIntents" | "ledgerRecordEdits"
>;

/**
 * Destructive approval is based on the exact simulated outcome, not command
 * naming. Format conversions and future operations therefore cannot bypass
 * confirmation merely because their type does not end in `.delete`.
 */
export function longWorkspaceImpactIsDestructive(
  value: LongWorkspaceDestructiveImpact
): boolean {
  return (
    value.entityChanges.some(({ action }) => action === "delete") ||
    value.relationshipChanges.some(({ action }) => action === "delete") ||
    value.fileIntents.some(({ action }) => action === "delete") ||
    value.ledgerRecordEdits.length > 0
  );
}

/**
 * Explicit delete commands remain confirmation-gated even if a future handler
 * accidentally reports an empty impact. Outcome inspection additionally
 * catches destructive effects produced by updates and other command names.
 */
export function longWorkspaceOperationsRequireImpactConfirmation(
  operations: readonly Pick<LongWorkspaceOperation, "type">[],
  impact: LongWorkspaceDestructiveImpact
): boolean {
  return (
    operations.some(({ type }) => type.endsWith(".delete")) ||
    longWorkspaceImpactIsDestructive(impact)
  );
}
