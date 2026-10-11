import { onBeforeUnmount } from "vue";
import type { EditorTextReference } from "../types/conversation";
import {
  registerTextMenuExtension,
  type TextMenuHistory
} from "./nativeTextContextMenu";

export function useSelectionInsertionMenu(options: {
  insert(reference: EditorTextReference): void;
}) {
  let release: (() => void) | undefined;

  function closeSelectionAction(): void {
    release?.();
    release = undefined;
  }

  function openSelectionAction(
    reference: EditorTextReference | undefined,
    event: MouseEvent,
    history?: TextMenuHistory,
    valid: () => boolean = () => true
  ): void {
    closeSelectionAction();
    release = registerTextMenuExtension(event, {
      valid,
      history,
      ...(reference ? { insert: () => options.insert(reference) } : {})
    });
  }

  onBeforeUnmount(closeSelectionAction);
  return { closeSelectionAction, openSelectionAction };
}
