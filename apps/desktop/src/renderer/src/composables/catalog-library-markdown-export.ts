import type { DeepWriteApi } from "@deepwrite/contracts";
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type { CatalogResourceNodeActionPayload } from "../types/workspace";

const t = createScopedTranslator("workspace");

export async function handleCatalogLibraryMarkdownZipExport(
  payload: CatalogResourceNodeActionPayload,
  api: DeepWriteApi["catalog"] | undefined,
  notifications: { success(message: string): void; error(message: string): void }
): Promise<void> {
  const isGroup = payload.node.catalogNodeType === "group";
  const targetId = isGroup ? payload.node.groupId : payload.node.libraryId;
  if (!api || !targetId) {
    notifications.error(
      t("catalogLibraryTransactionsCoordinator.exportTargetNotFound")
    );
    return;
  }
  try {
    const result = await api.exportLibraryMarkdownZip({
      domain: payload.domain,
      targetType: isGroup ? "group" : "library",
      targetId
    });
    if (!result.canceled) {
      notifications.success(
        t(
          "catalogLibraryTransactionsCoordinator.exportedMarkdownEntryCount",
          { count: result.exportedCount }
        )
      );
    }
  } catch (error: unknown) {
    notifications.error(
      formatError(
        error,
        t("catalogLibraryTransactionsCoordinator.exportMarkdownZipFailed")
      )
    );
  }
}
