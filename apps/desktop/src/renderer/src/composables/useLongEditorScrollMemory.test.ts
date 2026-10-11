import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import { clearEditorScrollMemory } from "../utils/editorScrollMemory";
import {
  longEditorScrollMemoryKey,
  useLongEditorScrollMemory,
  type LongEditorScrollIdentity
} from "./useLongEditorScrollMemory";

function identity(
  overrides: Partial<LongEditorScrollIdentity> = {}
): LongEditorScrollIdentity {
  return {
    bookId: "book-1",
    selectionKey: "worldbuilding:rules",
    fileId: "file-1",
    worldbuildingItemId: "rule-1",
    bookLineVolumeId: "",
    bookLineContentTab: "outline",
    plotPointId: "",
    plotPointTab: "summary",
    storyPlotId: "",
    chapterCardId: "",
    ...overrides
  };
}

function scrollElement(scrollTop = 0): HTMLElement {
  return { scrollTop } as HTMLElement;
}

async function flushScrollRestore(): Promise<void> {
  await nextTick();
  await nextTick();
}

beforeEach(() => {
  clearEditorScrollMemory();
});

describe("long editor scroll memory", () => {
  it("starts an unseen item at the top and restores each previous position", async () => {
    const scope = effectScope();
    const firstKey = longEditorScrollMemoryKey(identity());
    const activeKey = ref(firstKey);
    const editor = scrollElement(640) as HTMLTextAreaElement;
    const memory = scope.run(() =>
      useLongEditorScrollMemory({
        documentKey: () => activeKey.value,
        viewMode: ref("edit"),
        editorInput: ref(editor),
        documentPreview: ref(null)
      })
    );
    expect(memory).toBeDefined();
    memory!.handleScroll({ currentTarget: editor } as unknown as Event);

    const secondKey = longEditorScrollMemoryKey(
      identity({ fileId: "file-2", worldbuildingItemId: "rule-2" })
    );
    activeKey.value = secondKey;
    await nextTick();
    editor.scrollTop = 640;
    memory!.handleScroll({ currentTarget: editor } as unknown as Event);
    await nextTick();
    expect(editor.scrollTop).toBe(0);

    editor.scrollTop = 180;
    memory!.handleScroll({ currentTarget: editor } as unknown as Event);
    activeKey.value = firstKey;
    await flushScrollRestore();
    expect(editor.scrollTop).toBe(640);

    activeKey.value = secondKey;
    await flushScrollRestore();
    expect(editor.scrollTop).toBe(180);
    scope.stop();
  });

  it("isolates editing and preview positions for the same item", async () => {
    const scope = effectScope();
    const viewMode = ref<"edit" | "preview">("edit");
    const editor = scrollElement(320) as HTMLTextAreaElement;
    const preview = scrollElement(0);
    const memory = scope.run(() =>
      useLongEditorScrollMemory({
        documentKey: () => longEditorScrollMemoryKey(identity()),
        viewMode,
        editorInput: ref(editor),
        documentPreview: ref(preview)
      })
    );
    memory!.handleScroll({ currentTarget: editor } as unknown as Event);

    viewMode.value = "preview";
    await flushScrollRestore();
    expect(preview.scrollTop).toBe(0);
    preview.scrollTop = 95;
    memory!.handleScroll({ currentTarget: preview } as unknown as Event);

    viewMode.value = "edit";
    await flushScrollRestore();
    expect(editor.scrollTop).toBe(320);

    viewMode.value = "preview";
    await flushScrollRestore();
    expect(preview.scrollTop).toBe(95);
    scope.stop();
  });

  it("uses the item, chapter, plot, and book identities in the key", () => {
    const base = longEditorScrollMemoryKey(identity());
    expect(
      longEditorScrollMemoryKey(identity({ worldbuildingItemId: "rule-2" }))
    ).not.toBe(base);
    expect(
      longEditorScrollMemoryKey(identity({ chapterCardId: "chapter-2" }))
    ).not.toBe(base);
    expect(
      longEditorScrollMemoryKey(identity({ storyPlotId: "story-2" }))
    ).not.toBe(base);
    expect(longEditorScrollMemoryKey(identity({ bookId: "book-2" }))).not.toBe(
      base
    );
  });
});
