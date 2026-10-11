import { inject, onBeforeUnmount } from "vue";
import {
  windowFrameMenusKey,
  type WorkspaceWindowActions
} from "./windowFrameMenus";

export function useWorkspaceWindowMenus(actions: WorkspaceWindowActions) {
  const menus = inject(windowFrameMenusKey, null);
  if (menus) menus.value = actions;
  onBeforeUnmount(() => {
    if (menus) menus.value = null;
  });
  return (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      actions.create();
    }
    if (event.key === "Escape") actions.escape();
  };
}
