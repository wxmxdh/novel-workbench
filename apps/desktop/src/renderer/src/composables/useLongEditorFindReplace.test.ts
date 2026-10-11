import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useLongEditorFindReplace } from "./useLongEditorFindReplace";

describe("long editor find/replace shortcuts", () => {
  it("does not intercept keyboard shortcuts while Chinese IME composition is active", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const editor = useLongEditorFindReplace({
      currentVisibleContent: computed(() => "正文"),
      currentReadOnly: computed(() => false),
      canUseTextTools: computed(() => true),
      viewMode: ref<"edit" | "preview">("edit"),
      editorInput: ref(null),
      editorToolsElement: ref(undefined),
      updateVisibleContent: vi.fn(),
      updateVisibleCharacterCount: vi.fn(),
      recordProgrammaticChange: vi.fn(),
      undo,
      redo,
      closeStoryPlotActionMenu: vi.fn(),
      storyPlotActionMenuId: ref(null)
    });
    const preventDefault = vi.fn();

    editor.handleEditorKeydown({
      key: "z",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      isComposing: true,
      preventDefault
    } as unknown as KeyboardEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });
});
