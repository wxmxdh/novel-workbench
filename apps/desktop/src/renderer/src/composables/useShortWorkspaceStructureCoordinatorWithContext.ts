import {
  useShortWorkspaceStructureCoordinator,
  type ShortWorkspaceStructureCoordinatorOptions
} from "./useShortWorkspaceStructureCoordinator";
import { useWritingContextCoordinator } from "./useWritingContextCoordinator";

/**
 * Composes the short/script structure transactions with the per-book context
 * shown by the same dialog, keeping the workspace shell focused on wiring.
 */
export function useShortWorkspaceStructureCoordinatorWithContext(
  options: ShortWorkspaceStructureCoordinatorOptions
) {
  const structure = useShortWorkspaceStructureCoordinator(options);
  const writingContext = useWritingContextCoordinator({
    bookId: structure.plotStructureBookId,
    api: options.api,
    notifications: options.notifications
  });

  return {
    ...structure,
    writingContext: writingContext.content,
    writingContextLoading: writingContext.loading,
    writingContextPending: writingContext.pending,
    saveWritingContext: writingContext.save
  };
}
