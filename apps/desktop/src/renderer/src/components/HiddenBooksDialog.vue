<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { HiddenBook } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import { formatError } from "../i18n/errors";
import { uiMessage } from "../ui-feedback";
const t = createScopedTranslator("components.bookManagement");
const props = defineProps<{
  target?: HiddenBook | null;
  action?: "hide" | "delete";
  pending?: boolean;
}>();
const emit = defineEmits<{
  close: [];
  restore: [];
  remove: [target: HiddenBook, action: "hide" | "delete"];
}>();
function api() {
  const port = window.deepwrite?.books;
  if (!port) throw new Error(t("failed"));
  return port;
}
const hidden = ref<HiddenBook[]>([]),
  busy = ref(false);
onMounted(async () => {
  if (!props.target)
    try {
      hidden.value = await api().hidden();
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
    }
});
async function restore(item: HiddenBook) {
  if (busy.value) return;
  busy.value = true;
  try {
    if (item.deletePending)
      await api().removeExternal({
        projectId: item.id,
        action: "delete",
        expectedProjectDirectory: item.projectDirectory,
        expectedIdentitySha256: item.identitySha256,
        workspaceRoot: item.workspaceRoot
      });
    else
      await api().restore({
        id: item.id,
        kind: item.kind,
        expectedProjectDirectory: item.projectDirectory,
        ...(item.identitySha256
          ? { expectedIdentitySha256: item.identitySha256 }
          : {}),
        ...(item.workspaceRoot ? { workspaceRoot: item.workspaceRoot } : {})
      });
    hidden.value = await api().hidden();
    emit("restore");
    uiMessage.success(item.deletePending ? t("cleanupDone") : t("restored"));
  } catch (error) {
    uiMessage.error(formatError(error, t("failed")));
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Teleport to="body"
    ><div
      class="dialog-backdrop hidden-books-backdrop"
      @mousedown.self="!busy && !pending && emit('close')"
      @keydown.esc="!busy && !pending && emit('close')"
    >
      <section
        class="workspace-dialog hidden-books-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-management-heading"
        data-testid="book-management-dialog"
      >
        <header>
          <h2 id="book-management-heading">
            {{
              target
                ? action === "delete"
                  ? t("deleteTitle")
                  : t("hideTitle")
                : t("hiddenTitle")
            }}
          </h2>
          <button
            class="dialog-close"
            type="button"
            :disabled="busy || pending"
            :aria-label="t('close')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <div class="hidden-books-body">
          <template v-if="target"
            ><strong>{{ target.title }}</strong>
            <p>{{ target.projectDirectory }}</p>
            <p>
              {{ action === "delete" ? t("deleteHint") : t("hideHint") }}
            </p></template
          ><template v-else
            ><p v-if="!hidden.length">{{ t("none") }}</p>
            <div
              v-for="item in hidden"
              :key="`${item.kind}:${item.id}:${item.projectDirectory}`"
              class="hidden-book-row"
            >
              <div>
                <strong>{{ item.title }}</strong
                ><small>{{ item.projectDirectory }}</small>
              </div>
              <button
                class="dialog-secondary-button"
                type="button"
                :disabled="busy || pending"
                @click="restore(item)"
              >
                {{ item.deletePending ? t("retryCleanup") : t("restore") }}
              </button>
            </div></template
          >
        </div>
        <footer>
          <button
            class="dialog-secondary-button"
            type="button"
            :disabled="busy || pending"
            @click="emit('close')"
          >
            {{ t("close") }}</button
          ><button
            v-if="target"
            :disabled="busy || pending"
            class="dialog-primary-button"
            :class="{ 'is-danger': action === 'delete' }"
            type="button"
            @click="emit('remove', target, action ?? 'hide')"
          >
            {{ action === "delete" ? t("deleteConfirm") : t("hideConfirm") }}
          </button>
        </footer>
      </section>
    </div></Teleport
  >
</template>
<style scoped>
.hidden-books-backdrop {
  z-index: 1200;
}
.hidden-books-dialog {
  width: min(700px, calc(100vw - 32px));
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}
.hidden-books-dialog header,
.hidden-books-dialog footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px;
}
.hidden-books-dialog header {
  border-bottom: 1px solid var(--theme-line-soft);
}
.hidden-books-dialog header h2 {
  margin: 0;
}
.hidden-books-body {
  padding: 20px 24px;
  overflow: auto;
  line-height: 1.6;
}
.hidden-books-body p,
.hidden-book-row small {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.hidden-book-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  border-bottom: 1px solid var(--theme-line-soft);
  padding: 12px 0;
}
.hidden-book-row div {
  min-width: 0;
  display: grid;
  gap: 5px;
}
.hidden-books-dialog footer {
  justify-content: flex-end;
  border-top: 1px solid var(--theme-line-soft);
}
.dialog-primary-button.is-danger {
  background: var(--danger, #b42318);
  color: var(--on-danger, #fff);
}
</style>
