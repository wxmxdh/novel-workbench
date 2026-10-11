import { applyChapterContinuityOperation } from "./apply-chapter-continuity";
import { applyChapterOperation } from "./apply-chapter";
import { applyVolumeArcOperation } from "./apply-volume-arc";
import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";

export function applyVolumeChapterOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  applyVolumeArcOperation(state, operation);
  applyChapterOperation(state, operation);
  applyChapterContinuityOperation(state, operation);
}
