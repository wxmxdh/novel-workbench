<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  LongSourceFolderPreview,
  LongSourcePurpose,
  LongSourceAuthority,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import { uiMessage } from "../ui-feedback";
import { formatError } from "../i18n/errors";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";
const t = createScopedTranslator("components.longBookSources");
const props = defineProps<{
  open: boolean;
  chooseFolder?: boolean;
  initialMode?: "connect" | "copy";
  suggestedPath?: string | undefined;
  bookId: string;
  index: LongWorkspaceIndexSnapshot | null;
}>();
const emit = defineEmits<{
  close: [];
  file: [];
  changed: [];
  select: [fileId: string];
}>();
const preview = ref<LongSourceFolderPreview | null>(null);
const selected = ref<string[]>([]),
  busy = ref(false);
const purpose = ref<LongSourcePurpose>("reference"),
  authority = ref<LongSourceAuthority>("reference");
const mode = ref(props.initialMode ?? "connect");
const filter = ref("");
onMounted(() => {
  if (props.chooseFolder) void pickFolder();
});
const visibleFiles = computed(
  () =>
    preview.value?.files.filter((file) =>
      file.relativePath
        .toLocaleLowerCase()
        .includes(filter.value.toLocaleLowerCase())
    ) ?? []
);
const purposeOptions = computed(() =>
  [
    "foundation",
    "character",
    "outline",
    "discussion",
    "reference",
    "other"
  ].map((value) => ({
    value,
    label: t(`purpose_${value}` as "purpose_foundation")
  }))
);
const authorityOptions = computed(() =>
  ["candidate", "undecided", "reference"].map((value) => ({
    value,
    label: t(`authority_${value}` as "authority_candidate")
  }))
);
watch(
  () => [props.open, props.bookId],
  () => {
    preview.value = null;
    selected.value = [];
    filter.value = "";
  }
);
function close() {
  if (!busy.value) emit("close");
}
async function pickFolder() {
  if (busy.value) return;
  const api = window.deepwrite?.long;
  if (!api) return;
  const bookId = props.bookId;
  busy.value = true;
  try {
    const value = await api.chooseSourceFolder({
      bookId,
      ...(props.suggestedPath ? { suggestedPath: props.suggestedPath } : {})
    });
    if (props.bookId !== bookId || !props.open) return;
    preview.value = value;
    selected.value = value?.files.map((file) => file.id) ?? [];
    if (
      value &&
      props.suggestedPath &&
      /\.(?:md|markdown|txt)$/iu.test(props.suggestedPath)
    ) {
      const normalize = (path: string) =>
        path.replaceAll("/", "\\").toLowerCase();
      const requested = normalize(props.suggestedPath);
      const root = normalize(value.rootPath).replace(/\\+$/u, "");
      const selectedFile = value.files.find(
        (file) => `${root}\\${normalize(file.relativePath)}` === requested
      );
      if (selectedFile) selected.value = [selectedFile.id];
    }
  } catch (error) {
    uiMessage.error(formatError(error, t("failed")));
  } finally {
    busy.value = false;
  }
}
function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id];
}
async function confirm() {
  const current = preview.value,
    api = window.deepwrite?.long;
  if (!current || !api || busy.value) return;
  busy.value = true;
  try {
    const result = await api.confirmSourceFolder({
      bookId: current.bookId,
      previewId: current.previewId,
      mode: mode.value === "copy" ? "copy" : "connect",
      fileIds: [...selected.value],
      purpose: purpose.value,
      authority: authority.value
    });
    if (props.bookId !== current.bookId || !props.open) return;
    emit("changed");
    if (result.failures.length)
      uiMessage.warning(
        t("partial", { arg0: result.imported, arg1: result.failures.length }) +
          " " +
          result.failures
            .slice(0, 3)
            .map((item) => `${item.relativePath}: ${item.reason}`)
            .join("；")
      );
    else {
      uiMessage.success(
        result.mode === "connect"
          ? t("connected")
          : t("copied", { arg0: result.imported, arg1: result.duplicates })
      );
      preview.value = null;
    }
  } catch (error) {
    uiMessage.error(formatError(error, t("failed")));
  } finally {
    busy.value = false;
  }
}
async function disconnect(sourceId: string) {
  const api = window.deepwrite?.long;
  if (!api || busy.value) return;
  busy.value = true;
  try {
    await api.disconnectSourceFolder({ bookId: props.bookId, sourceId });
    emit("changed");
    uiMessage.success(t("disconnected"));
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
      v-if="open"
      class="dialog-backdrop book-sources-backdrop"
      @mousedown.self="close"
      @keydown.esc="close"
    >
      <section
        class="workspace-dialog book-sources-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-sources-heading"
        data-testid="long-book-sources-dialog"
      >
        <header>
          <div>
            <h2 id="book-sources-heading">{{ t("title") }}</h2>
            <p>{{ t("hint") }}</p>
          </div>
          <button
            class="dialog-close"
            type="button"
            :disabled="busy"
            :aria-label="t('close')"
            @click="close"
          >
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <div class="book-sources-body">
          <template v-if="!preview">
            <div class="source-actions">
              <button
                class="dialog-secondary-button"
                type="button"
                :disabled="busy"
                data-testid="source-file-pick"
                @click="
                  emit('file');
                  close();
                "
              >
                <AppIcon name="file" :size="18" />{{ t("file") }}</button
              ><button
                class="dialog-primary-button"
                type="button"
                :disabled="busy"
                data-testid="source-folder-pick"
                @click="pickFolder"
              >
                <AppIcon name="folder" :size="18" />{{ t("folder") }}
              </button>
            </div>
            <h3>{{ t("connections") }}</h3>
            <p v-if="!index?.sourceFolders?.length" class="muted">
              {{ t("none") }}
            </p>
            <div
              v-for="folder in index?.sourceFolders"
              :key="folder.id"
              class="source-row"
            >
              <div>
                <strong>{{ folder.title }}</strong
                ><span>{{ folder.rootPath }}</span
                ><small
                  >{{ t("readonly") }} ·
                  {{ t(`authority_${folder.authority}`) }}</small
                >
              </div>
              <button
                class="dialog-secondary-button"
                type="button"
                :disabled="busy"
                @click="disconnect(folder.id)"
              >
                {{ t("disconnect") }}
              </button>
            </div>
            <h3>{{ t("copies") }}</h3>
            <p v-if="!index?.importedSources?.length" class="muted">
              {{ t("none") }}
            </p>
            <button
              v-for="source in index?.importedSources"
              :key="source.id"
              class="source-copy"
              type="button"
              @click="
                emit('select', source.file.id);
                close();
              "
            >
              <AppIcon name="file" :size="18" /><span
                >{{ source.title
                }}<small
                  >{{ source.sourceName }} ·
                  {{ t(`authority_${source.authority}`) }}</small
                ></span
              >
            </button>
          </template>
          <template v-else>
            <strong>{{ preview.title }}</strong>
            <p class="muted source-path">{{ preview.rootPath }}</p>
            <div class="source-meta">
              <label
                ><span>{{ t("mode") }}</span
                ><PopupSelect
                  v-model="mode"
                  :options="[
                    { value: 'connect', label: t('connectMode') },
                    { value: 'copy', label: t('copyMode') }
                  ]"
                  :accessible-label="t('mode')"
                  :menu-z-index="1250"
                  :disabled="busy" /></label
              ><label
                ><span>{{ t("purpose") }}</span
                ><PopupSelect
                  :model-value="purpose"
                  :options="purposeOptions"
                  :accessible-label="t('purpose')"
                  :menu-z-index="1250"
                  :disabled="busy"
                  @update:model-value="
                    purpose = $event as LongSourcePurpose
                  " /></label
              ><label
                ><span>{{ t("authority") }}</span
                ><PopupSelect
                  :model-value="authority"
                  :options="authorityOptions"
                  :accessible-label="t('authority')"
                  :menu-z-index="1250"
                  :disabled="busy"
                  @update:model-value="
                    authority = $event as LongSourceAuthority
                  "
              /></label>
            </div>
            <p class="muted">
              {{ mode === "connect" ? t("connectHint") : t("copyHint") }}
            </p>
            <input
              v-model="filter"
              class="source-filter"
              :placeholder="t('filter')"
              :aria-label="t('filter')"
              :disabled="busy"
            />
            <div class="source-actions">
              <button
                type="button"
                class="dialog-secondary-button"
                :disabled="busy"
                @click="selected = preview.files.map((file) => file.id)"
              >
                {{ t("all") }}</button
              ><button
                type="button"
                class="dialog-secondary-button"
                :disabled="busy"
                @click="selected = []"
              >
                {{ t("clear") }}</button
              ><span>{{
                t("selected", {
                  arg0: selected.length,
                  arg1: preview.files.length
                })
              }}</span>
            </div>
            <label v-for="file in visibleFiles" :key="file.id" class="file-row"
              ><input
                type="checkbox"
                :checked="selected.includes(file.id)"
                :disabled="busy"
                @change="toggle(file.id)"
              /><span>{{ file.relativePath }}</span
              ><small>{{ Math.ceil(file.bytes / 1024) }} KiB</small></label
            >
            <details
              v-if="preview.skipped.length || preview.limited"
              class="muted"
            >
              <summary>
                {{ t("skipped", { arg0: preview.skipped.length }) }}
              </summary>
              <p v-if="preview.limited">{{ t("limited") }}</p>
              <p v-for="item in preview.skipped" :key="item.relativePath">
                {{ item.relativePath }} · {{ item.reason }}
              </p>
            </details>
          </template>
        </div>
        <footer>
          <button
            v-if="preview"
            class="dialog-secondary-button"
            type="button"
            :disabled="busy"
            @click="preview = null"
          >
            {{ t("back") }}</button
          ><button
            class="dialog-secondary-button"
            type="button"
            :disabled="busy"
            @click="close"
          >
            {{ t("close") }}</button
          ><button
            v-if="preview"
            class="dialog-primary-button"
            type="button"
            :disabled="busy || !selected.length"
            data-testid="source-folder-confirm"
            @click="confirm"
          >
            {{ busy ? t("saving") : t("confirm") }}
          </button>
        </footer>
      </section>
    </div></Teleport
  >
</template>
<style scoped>
.book-sources-backdrop {
  z-index: 1200;
}
.book-sources-dialog {
  width: min(820px, calc(100vw - 32px));
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.book-sources-dialog header,
.book-sources-dialog footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--theme-line-soft);
}
.book-sources-dialog header h2 {
  margin: 0;
}
.book-sources-dialog header p {
  color: var(--text-secondary);
  margin-bottom: 0;
  line-height: 1.5;
}
.book-sources-dialog footer {
  border-top: 1px solid var(--theme-line-soft);
  border-bottom: 0;
  justify-content: flex-end;
}
.book-sources-body {
  padding: 20px 24px;
  overflow: auto;
  min-height: 0;
}
.source-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.source-actions button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.muted,
.source-row small {
  color: var(--text-secondary);
  font-size: 0.9em;
}
.source-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--theme-line-soft);
}
.source-row div {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.source-row span,
.source-path {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}
.source-copy {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.source-copy:hover {
  background: var(--surface-hover);
}
.source-copy small {
  display: block;
  color: var(--text-secondary);
  margin-top: 4px;
}
.source-meta {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 12px;
}
.source-meta label {
  display: grid;
  gap: 8px;
}
.source-filter {
  box-sizing: border-box;
  width: 100%;
  font: inherit;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--surface-raised);
}
.file-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px solid var(--theme-line-soft);
}
.file-row span {
  flex: 1;
  overflow-wrap: anywhere;
}
.file-row small {
  color: var(--text-tertiary);
}
@media (max-width: 650px) {
  .source-meta {
    grid-template-columns: 1fr;
  }
}
</style>
