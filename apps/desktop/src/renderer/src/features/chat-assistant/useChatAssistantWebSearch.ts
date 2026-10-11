import { computed, ref, watch, type Ref } from "vue";
import {
  isDeepSeekWebSearchCompatible,
  type ModelConfig
} from "@deepwrite/contracts/renderer";

export const CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY =
  "deepwrite:chat-assistant-web-search:v1";

interface WebSearchPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ChatAssistantWebSearchOptions {
  selectedModel: Readonly<Ref<ModelConfig | undefined>>;
  storage?: WebSearchPreferenceStorage | null;
  onAutomaticallyDisabled?: () => void;
}

function defaultStorage(): WebSearchPreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readPreference(storage: WebSearchPreferenceStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useChatAssistantWebSearch(
  options: ChatAssistantWebSearchOptions
) {
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const enabled = ref(readPreference(storage));
  const available = computed(() =>
    isDeepSeekWebSearchCompatible(options.selectedModel.value)
  );

  function persist(value: boolean): void {
    if (!storage) return;
    try {
      storage.setItem(CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY, String(value));
    } catch {
      // Persistence is optional; the in-memory preference remains usable.
    }
  }

  function setEnabled(value: boolean): boolean {
    if (value && !available.value) return false;
    enabled.value = value;
    persist(value);
    return true;
  }

  watch(
    options.selectedModel,
    (model) => {
      if (!model || !enabled.value || isDeepSeekWebSearchCompatible(model)) {
        return;
      }
      enabled.value = false;
      persist(false);
      options.onAutomaticallyDisabled?.();
    },
    { immediate: true }
  );

  return {
    available,
    enabled: enabled as Readonly<Ref<boolean>>,
    setEnabled
  };
}

export type ChatAssistantWebSearchFeature = ReturnType<
  typeof useChatAssistantWebSearch
>;
