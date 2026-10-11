import type { TextViewMode } from "@deepwrite/contracts";
import { ref } from "vue";

export interface TextViewModeOptions {
  defaultMode(): TextViewMode;
}

/** Owns the shared default/manual text view-mode behavior for all editors. */
export function useTextViewMode(options: TextViewModeOptions) {
  const viewMode = ref<TextViewMode>(options.defaultMode());

  function setViewMode(mode: TextViewMode): void {
    viewMode.value = mode;
  }

  function resetToDefault(forcePreview = false): TextViewMode {
    const mode = forcePreview ? "preview" : options.defaultMode();
    setViewMode(mode);
    return mode;
  }

  return {
    resetToDefault,
    setViewMode,
    viewMode
  };
}
