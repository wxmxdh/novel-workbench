import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import { workspaceDocumentProvesDraftPersisted } from "./catalogSaveReconciliation";
import { normalizeFixedWorkspaceDocumentDraft } from "./fixedWorkspaceDocumentTitle";

/**
 * Reconciles recovered editor state only after the catalog projection is known.
 * Fixed structural titles come from disk, while unsaved body text and recovery
 * metadata remain untouched.
 */
export function reconcileCatalogRecoveryDrafts(
  drafts: Readonly<Record<string, EditorDraftState>>,
  documents: ReadonlyMap<string, WorkspaceDocument>
): Record<string, EditorDraftState> {
  return Object.fromEntries(
    Object.entries(drafts).flatMap(([documentId, draft]) => {
      if (!draft.dirty) return [];
      const persisted = documents.get(documentId);
      const normalized = persisted
        ? normalizeFixedWorkspaceDocumentDraft(persisted, draft)
        : draft;
      return persisted &&
        workspaceDocumentProvesDraftPersisted(persisted, normalized)
        ? []
        : [[documentId, normalized] as const];
    })
  );
}
