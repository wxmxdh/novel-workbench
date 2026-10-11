import { CATALOG_PROJECT_MAX_CONTENT_ITEMS } from "@deepwrite/contracts";
import type { Ref } from "vue";
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type {
  ExternalLibraryImportContext,
  ExternalLibraryImportDialogState,
  ExternalLibraryImportSubmitPayload
} from "./useExternalLibraryImportCoordinator";
const t = createScopedTranslator("workspace.externalLibraryImportCoordinator");
export async function submitExternalLibraryImport(
  context: ExternalLibraryImportContext,
  dialog: Ref<ExternalLibraryImportDialogState | null>,
  payload: ExternalLibraryImportSubmitPayload
): Promise<void> {
  const api = context.api();
  const current = dialog.value;
  if (
    !api ||
    !current?.selection ||
    context.mutationPending.value ||
    payload.candidateIds.length === 0
  ) {
    return;
  }
  const library = context.findLibrary(current.domain, payload.libraryId);
  if (!library || ("isBuiltin" in library && library.isBuiltin)) {
    context.notifications.warning(
      t("theDestinationLibraryIsUnavailableOrReadOnly")
    );
    return;
  }
  const selectedIds = new Set(payload.candidateIds);
  const entries = current.selection.candidates
    .filter((candidate) => selectedIds.has(candidate.id))
    .map(({ title, content }) => ({ title, content }));
  if (entries.length === 0) return;
  if (
    library.entries.length + entries.length >
    CATALOG_PROJECT_MAX_CONTENT_ITEMS
  ) {
    context.notifications.warning(
      t("theSelectedEntriesExceedTheRemainingLibraryCapacity")
    );
    return;
  }

  context.mutationPending.value = true;
  try {
    const result = await api.importLibraryEntries({
      domain: current.domain,
      libraryId: library.id,
      entries,
      baseProjectRevision: library.projectRevision ?? 0
    });
    await context.refreshWorkspaceDirectory();
    await context.refreshCatalog();
    context.advanceDraftProjectRevision(
      current.domain,
      library.id,
      library.projectRevision === undefined
        ? undefined
        : library.projectRevision + 1
    );
    dialog.value = null;
    const firstEntry = result.entries[0];
    const target = context.documents.value.find(
      (document) =>
        document.libraryId === library.id &&
        document.catalogEntryId === firstEntry?.id
    );
    if (target) context.selectDocument(target.id, true);
    const renamedCount = result.entries.filter(
      (entry, index) => entry.title !== entries[index]?.title
    ).length;
    context.notifications.success(
      renamedCount > 0
        ? t("importedEntriesWereRenamedToAvoidDuplicates", {
            length: result.entries.length,
            renamedCount: renamedCount
          })
        : t("importedEntriesInto", {
            length: result.entries.length,
            title: library.title
          })
    );
  } catch (error: unknown) {
    if (context.isConflict(error)) {
      await context.refreshWorkspaceDirectory();
      await context.refreshCatalog();
      context.notifications.warning(
        t("theDestinationLibraryWasUpdatedExternallyDuplicateNamesHave")
      );
    } else {
      context.notifications.error(
        formatError(error, t("failedToImportMaterialsInBulk"))
      );
    }
  } finally {
    context.mutationPending.value = false;
  }
}
