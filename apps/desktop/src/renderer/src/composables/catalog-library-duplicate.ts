import type { CatalogIndexSnapshot, DeepWriteApi } from "@deepwrite/contracts";
import type { Ref, ShallowRef } from "vue";
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type { CatalogResourceNodeActionPayload, WorkspaceDocument } from "../types/workspace";

const t = createScopedTranslator("workspace");

interface CatalogLibraryDuplicateInput {
  payload: CatalogResourceNodeActionPayload;
  api: DeepWriteApi["catalog"] | undefined;
  snapshot: CatalogIndexSnapshot | null;
  documents: ShallowRef<WorkspaceDocument[]>;
  mutationPending: Ref<boolean>;
  prepareProjectsForDuplicate(libraryIds: ReadonlySet<string>): Promise<boolean>;
  refreshWorkspaceDirectory(): Promise<void>;
  refreshCatalog(): Promise<boolean>;
  navigateToDocumentResource(documentId: string): Promise<void>;
  notifications: {
    error(message: string): void;
    success(message: string): void;
  };
}

export async function duplicateCatalogLibraryProject({
  payload,
  api,
  snapshot,
  documents,
  mutationPending,
  prepareProjectsForDuplicate,
  refreshWorkspaceDirectory,
  refreshCatalog,
  navigateToDocumentResource,
  notifications
}: CatalogLibraryDuplicateInput): Promise<void> {
  if (!api || mutationPending.value || payload.node.unavailable) return;
  const isGroup = payload.action === "duplicate-group";
  const projectId = isGroup ? payload.node.groupId : payload.node.libraryId;
  if (!projectId) {
    notifications.error(
      isGroup
        ? t("catalogLibraryTransactionsCoordinator.theGroupWasNotFound")
        : t("catalogLibraryTransactionsCoordinator.theLibraryWasNotFound")
    );
    return;
  }
  const sourceLibraryIds = new Set<string>();
  if (isGroup) {
    const group =
      payload.domain === "material"
        ? snapshot?.materialGroups.find(({ id }) => id === projectId)
        : snapshot?.skillGroups.find(({ id }) => id === projectId);
    for (const libraryId of Object.values(group?.members ?? {})) {
      if (libraryId) sourceLibraryIds.add(libraryId);
    }
  } else {
    sourceLibraryIds.add(projectId);
  }
  if (!(await prepareProjectsForDuplicate(sourceLibraryIds))) return;

  mutationPending.value = true;
  try {
    const duplicated = await api.duplicateProject({
      domain: isGroup
        ? payload.domain === "material"
          ? "material-group"
          : "skill-group"
        : payload.domain,
      projectId
    });
    await refreshWorkspaceDirectory();
    await refreshCatalog();
    if (!isGroup) {
      const target = documents.value.find(
        (document) => document.libraryId === duplicated.projectId
      );
      if (target) await navigateToDocumentResource(target.id);
    }
    notifications.success(
      isGroup
        ? t("catalogLibraryTransactionsCoordinator.copiedGroupAsIncludingMemberLibraries", {
            label: payload.node.label,
            title: duplicated.title,
            length: duplicated.copiedMemberLibraryIds.length
          })
        : t("catalogLibraryTransactionsCoordinator.copiedAs", {
            label: payload.node.label,
            title: duplicated.title
          })
    );
  } catch (error: unknown) {
    notifications.error(
      formatError(
        error,
        t("catalogLibraryTransactionsCoordinator.failedToDuplicateLibraryProject")
      )
    );
  } finally {
    mutationPending.value = false;
  }
}
