import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import {
  type CatalogIndexSnapshot,
  type CatalogLibrary,
  type DeepWriteApi,
  type ExternalLibrarySelectionResult,
  type ExternalLibrarySourceKind
} from "@deepwrite/contracts";
import { ref, type Ref, type ShallowRef } from "vue";
import type { WorkspaceDocument } from "../types/workspace";

const t = createScopedTranslator("workspace.externalLibraryImportCoordinator");

export interface ExternalLibraryImportDialogState {
  domain: "material" | "skill";
  preselectedLibraryId?: string;
  selection?: ExternalLibrarySelectionResult;
}

export interface ExternalLibraryImportSubmitPayload {
  libraryId: string;
  candidateIds: string[];
}

interface ExternalLibraryImportNotifications {
  error(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface ExternalLibraryImportContext {
  api(): DeepWriteApi["catalog"] | undefined;
  snapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
  documents: ShallowRef<WorkspaceDocument[]>;
  mutationPending: Ref<boolean>;
  findLibrary(
    domain: "material" | "skill",
    libraryId: string
  ): CatalogLibrary | undefined;
  refreshCatalog(): Promise<boolean>;
  refreshWorkspaceDirectory(): Promise<void>;
  advanceDraftProjectRevision(
    domain: "material" | "skill",
    libraryId: string,
    expectedProjectRevision: number | undefined
  ): void;
  isConflict(error: unknown): boolean;
  selectDocument(documentId: string, revealEditor: boolean): void;
  notifications: ExternalLibraryImportNotifications;
}

export function useExternalLibraryImportCoordinator(
  context: ExternalLibraryImportContext
) {
  const dialog = ref<ExternalLibraryImportDialogState | null>(null);

  function open(
    domain: "material" | "skill",
    preselectedLibraryId?: string
  ): void {
    if (!context.api()) {
      context.notifications.warning(
        t("theBrowserPreviewCannotReadLocalFilesUseThe")
      );
      return;
    }
    dialog.value = {
      domain,
      ...(preselectedLibraryId ? { preselectedLibraryId } : {})
    };
  }

  function close(): void {
    if (!context.mutationPending.value) dialog.value = null;
  }

  async function chooseSource(
    sourceKind: ExternalLibrarySourceKind
  ): Promise<void> {
    const api = context.api();
    const current = dialog.value;
    if (!api || !current || context.mutationPending.value) return;
    context.mutationPending.value = true;
    try {
      const selection = await api.chooseExternalLibraryEntries(sourceKind);
      if (!selection) return;
      dialog.value = { ...current, selection };
      if (selection.candidates.length === 0) {
        context.notifications.warning(
          t("noImportableTextWasFoundAtTheSelectedLocation")
        );
      }
    } catch (error: unknown) {
      context.notifications.error(
        formatError(error, t("failedToScanExternalFiles"))
      );
    } finally {
      context.mutationPending.value = false;
    }
  }

  async function submit(
    payload: ExternalLibraryImportSubmitPayload
  ): Promise<void> {
    const { submitExternalLibraryImport } =
      await import("./external-library-import-transaction");
    await submitExternalLibraryImport(context, dialog, payload);
  }

  return { dialog, open, close, chooseSource, submit };
}
