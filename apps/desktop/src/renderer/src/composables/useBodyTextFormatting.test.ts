import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, ref } from "vue";
import type { BodyTextKind } from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { createBoundedTextHistory } from "../utils/boundedTextHistory";
import { useBodyTextFormatting } from "./useBodyTextFormatting";
import { uiMessage } from "../ui-feedback";
vi.mock("../ui-feedback", () => ({
  uiMessage: { info: vi.fn(), success: vi.fn(), error: vi.fn() }
}));

function harness() {
  const content = ref("  未保存正文。\n第二段。");
  const kind = ref<BodyTextKind | undefined>("short");
  const blocked = ref(false);
  const key = ref("first-body");
  const history = createBoundedTextHistory();
  const input = {
    selectionStart: 3,
    selectionEnd: 6,
    scrollTop: 75,
    setSelectionRange: vi.fn()
  };
  const recordChange = vi.fn(
    (afterContent, selectionAfter) =>
      history.recordChange({
        beforeContent: content.value,
        afterContent,
        selectionBefore: { start: 3, end: 6 },
        selectionAfter
      })?.nonWhitespaceDelta
  );
  const updateContent = vi.fn((next: string) => {
    content.value = next;
  });
  const api = useBodyTextFormatting({
    kind: () => kind.value,
    content: () => content.value,
    disabled: () => blocked.value,
    documentKey: () => key.value,
    editorInput: () => input as unknown as HTMLTextAreaElement,
    recordChange,
    updateContent
  });
  return {
    api,
    content,
    kind,
    blocked,
    key,
    history,
    input,
    recordChange,
    updateContent
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
describe("body text formatting operation", () => {
  it("formats the current draft in one undo step and supports redo", async () => {
    const h = harness();
    const original = h.content.value;
    await h.api.format();
    expect(h.content.value).toBe("未保存正文。\n\n第二段。");
    expect(h.recordChange).toHaveBeenCalledOnce();
    expect(h.updateContent).toHaveBeenCalledWith(h.content.value, 0);
    const formatted = h.content.value;
    const restored = h.history.undo(formatted)!;
    expect(restored.content).toBe(original);
    expect(h.history.canUndo).toBe(false);
    expect(h.history.redo(restored.content)?.content).toBe(formatted);
    await nextTick();
    expect(h.input.scrollTop).toBe(75);
    expect(h.input.setSelectionRange).toHaveBeenCalledWith(3, 6);
  });
  it("reads the latest independent preference only on click", async () => {
    const h = harness();
    const store = useSettingsStore();
    const original = h.content.value;
    store.generalSettings = {
      ...store.generalSettings,
      bodyTextFormats: {
        short: "indent-compact",
        script: "flush-compact",
        long: "indent-spaced"
      }
    };
    expect(h.content.value).toBe(original);
    await h.api.format();
    expect(h.content.value).toBe("　　未保存正文。\n　　第二段。");
    h.kind.value = "script";
    await h.api.format();
    expect(h.content.value).toBe("未保存正文。\n第二段。");
    h.kind.value = "long";
    await h.api.format();
    expect(h.content.value).toBe("　　未保存正文。\n\n　　第二段。");
  });
  it("does not create history or trigger saving for unchanged text", async () => {
    const h = harness();
    h.content.value = "甲\n\n乙";
    await h.api.format();
    expect(h.recordChange).not.toHaveBeenCalled();
    expect(h.updateContent).not.toHaveBeenCalled();
    expect(uiMessage.info).toHaveBeenCalledWith("正文已符合格式规范");
  });
  it("blocks unavailable documents and non-body text, including direct calls", async () => {
    const h = harness();
    h.blocked.value = true;
    expect(h.api.disabled.value).toBe(true);
    await h.api.format();
    h.blocked.value = false;
    h.kind.value = undefined;
    expect(h.api.visible.value).toBe(false);
    await h.api.format();
    expect(h.recordChange).not.toHaveBeenCalled();
    expect(h.updateContent).not.toHaveBeenCalled();
  });
  it("rechecks write barriers after loading and suppresses duplicate clicks", async () => {
    const h = harness();
    const first = h.api.format();
    expect(h.api.disabled.value).toBe(true);
    const second = h.api.format();
    h.blocked.value = true;
    await Promise.all([first, second]);
    expect(h.recordChange).not.toHaveBeenCalled();
    expect(h.updateContent).not.toHaveBeenCalled();
  });

  it("does not mutate a document after the editor scope is disposed", async () => {
    const scope = effectScope();
    const h = scope.run(harness)!;
    const pending = h.api.format();
    scope.stop();
    await pending;
    expect(h.updateContent).not.toHaveBeenCalled();
  });

  it("does not restore a previous selection after navigating to a new document", async () => {
    const h = harness();
    const pending = h.api.format();
    h.key.value = "second-body";
    await pending;
    await nextTick();
    expect(h.input.setSelectionRange).not.toHaveBeenCalled();
  });
});
