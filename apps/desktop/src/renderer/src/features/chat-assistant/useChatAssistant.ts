import { computed, ref, type Ref } from "vue";
import type { ConversationPersistenceAdapter } from "../../stores/conversationStore";
import { migrateConversationHistoryKey } from "../../utils/conversationPersistence";

export interface ChatAssistantFeatureOptions {
  ensureModelSettingsLoaded(): Promise<unknown>;
  persistenceAdapter?: ConversationPersistenceAdapter | null;
}

export function useChatAssistant(options: ChatAssistantFeatureOptions) {
  const opened = ref(false);
  const minimized = ref(false);
  const ready = ref(false);
  let migrationPromise: Promise<void> | undefined;
  const visible = computed(
    () => opened.value && !minimized.value && ready.value
  );
  const active = computed(() => opened.value && !minimized.value);

  function prepare(): Promise<void> {
    migrationPromise ??= migrateConversationHistoryKey(
      options.persistenceAdapter ?? null,
      "chat-assistant",
      "chat-assistant:normal"
    ).catch(() => undefined);
    return migrationPromise;
  }

  function open(): void {
    opened.value = true;
    minimized.value = false;
    void prepare().finally(() => {
      ready.value = true;
    });
    void options.ensureModelSettingsLoaded().catch(() => undefined);
  }

  function minimize(): void {
    if (opened.value) minimized.value = true;
  }

  return {
    opened: opened as Readonly<Ref<boolean>>,
    minimized: minimized as Readonly<Ref<boolean>>,
    visible,
    active,
    open,
    minimize
  };
}
