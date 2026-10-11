<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createScopedTranslator } from "../../i18n";
import { uiMessage } from "../../ui-feedback";
import { attachWarmGlass } from "../../utils/warm-glass";

type Doc = {
  id: string;
  path: string;
  title: string;
  category: string;
  status: string;
  readOnly: true;
};
type MapItem = { document: Doc; previewDataUrl: string | null };
type StorySpace = {
  people: Doc[];
  relationships: Doc[];
  concepts: Doc[];
  world: Doc[];
  maps: MapItem[];
  documents: Doc[];
};
type StudioApi = {
  storySpace(input: { projectId: string }): Promise<StorySpace>;
  read(input: {
    projectId: string;
    path: string;
  }): Promise<{ path: string; content: string }>;
  saveConcept(input: {
    projectId: string;
    title: string;
    content: string;
  }): Promise<{ path: string }>;
  saveWorldNote(input: {
    projectId: string;
    title: string;
    content: string;
  }): Promise<{ path: string }>;
  saveMapNote(input: {
    projectId: string;
    title: string;
    content: string;
  }): Promise<{ path: string }>;
  importMap(input: { projectId: string }): Promise<{ path: string } | null>;
};

const props = defineProps<{ projectId: string }>();
const storyAreas = ref<HTMLElement | null>(null);
let stopStoryAreasGlass: (() => void) | undefined;
const t = createScopedTranslator("components.otterWorkbench");
const area = ref<"people" | "relationships" | "concepts" | "world" | "maps">(
  "concepts"
);
const data = ref<StorySpace>({
  people: [],
  relationships: [],
  concepts: [],
  world: [],
  maps: [],
  documents: []
});
const selectedPath = ref("");
const opened = ref<{ path: string; content: string } | null>(null);
const busy = ref(false);
const addKind = ref<"concept" | "world" | "map" | null>(null);
const newTitle = ref("");
const newContent = ref("");

function api(): StudioApi | undefined {
  return window.deepwrite?.otter as unknown as StudioApi | undefined;
}
const mapNotes = computed(() =>
  data.value.documents.filter(
    (item) =>
      item.category === "map" && !/\.(?:png|jpe?g|webp)$/i.test(item.path)
  )
);
const list = computed<Doc[]>(() =>
  area.value === "maps" ? mapNotes.value : data.value[area.value]
);
const selectedMap = computed(
  () =>
    data.value.maps.find((item) => item.document.path === selectedPath.value) ??
    null
);
function statusLabel(status: string): string {
  return t(status === "candidate" ? "candidateStatus" : "readOnlyStoryFact");
}

async function refresh(): Promise<void> {
  const port = api();
  if (!port || !props.projectId) return;
  try {
    data.value = await port.storySpace({ projectId: props.projectId });
    if (!list.value.some((item) => item.path === selectedPath.value)) {
      selectedPath.value =
        list.value[0]?.path ?? data.value.maps[0]?.document.path ?? "";
    }
    if (
      selectedPath.value &&
      !data.value.maps.some((item) => item.document.path === selectedPath.value)
    )
      await openDocument(selectedPath.value);
  } catch (reason) {
    uiMessage.error(reason instanceof Error ? reason.message : String(reason));
  }
}

async function openDocument(path: string): Promise<void> {
  selectedPath.value = path;
  opened.value = null;
  const port = api();
  if (!port || !props.projectId || !path) return;
  try {
    opened.value = await port.read({ projectId: props.projectId, path });
  } catch (reason) {
    uiMessage.error(reason instanceof Error ? reason.message : String(reason));
  }
}

function openMap(item: MapItem): void {
  selectedPath.value = item.document.path;
  opened.value = null;
}

async function saveIdea(): Promise<void> {
  const port = api();
  if (
    !port ||
    !props.projectId ||
    !newTitle.value.trim() ||
    !newContent.value.trim() ||
    !addKind.value
  )
    return;
  busy.value = true;
  try {
    const input = {
      projectId: props.projectId,
      title: newTitle.value.trim(),
      content: newContent.value.trim()
    };
    const saved =
      addKind.value === "concept"
        ? await port.saveConcept(input)
        : addKind.value === "map"
          ? await port.saveMapNote(input)
          : await port.saveWorldNote(input);
    selectedPath.value = saved.path;
    addKind.value = null;
    newTitle.value = "";
    newContent.value = "";
    await refresh();
  } catch (reason) {
    uiMessage.error(reason instanceof Error ? reason.message : String(reason));
  } finally {
    busy.value = false;
  }
}

async function importMap(): Promise<void> {
  const port = api();
  if (!port || !props.projectId) return;
  try {
    const imported = await port.importMap({ projectId: props.projectId });
    area.value = "maps";
    await refresh();
    if (imported) selectedPath.value = imported.path;
  } catch (reason) {
    uiMessage.error(reason instanceof Error ? reason.message : String(reason));
  }
}

watch(
  () => props.projectId,
  () => {
    selectedPath.value = "";
    opened.value = null;
    void refresh();
  },
  { immediate: true }
);
onMounted(() => {
  if (storyAreas.value) stopStoryAreasGlass = attachWarmGlass(storyAreas.value);
});
onBeforeUnmount(() => stopStoryAreasGlass?.());
</script>

<template>
  <section class="otter-story-space" aria-label="Story space">
    <nav
      ref="storyAreas"
      class="otter-story-areas"
      aria-label="Story materials"
    >
      <button
        v-for="item in [
          ['people', 'storyPeople'],
          ['relationships', 'storyRelationships'],
          ['concepts', 'storyConcepts'],
          ['world', 'storyWorld'],
          ['maps', 'storyMaps']
        ] as const"
        :key="item[0]"
        type="button"
        :class="{ active: area === item[0] }"
        @click="
          area = item[0];
          selectedPath = '';
          opened = null;
        "
      >
        {{ t(item[1]) }}
      </button>
    </nav>
    <aside class="otter-story-list panel">
      <header>
        <h2>
          {{
            t(
              area === "people"
                ? "storyPeople"
                : area === "relationships"
                  ? "storyRelationships"
                  : area === "concepts"
                    ? "storyConcepts"
                    : area === "world"
                      ? "storyWorld"
                      : "storyMaps"
            )
          }}
        </h2>
        <div class="otter-story-actions">
          <button
            v-if="area === 'concepts'"
            class="secondary-button"
            type="button"
            @click="addKind = 'concept'"
          >
            {{ t("addConcept") }}
          </button>
          <button
            v-if="area === 'world'"
            class="secondary-button"
            type="button"
            @click="addKind = 'world'"
          >
            {{ t("addWorldNote") }}
          </button>
          <button
            v-if="area === 'maps'"
            class="secondary-button"
            type="button"
            @click="addKind = 'map'"
          >
            {{ t("addMapNote") }}
          </button>
          <button
            v-if="area === 'maps'"
            class="secondary-button"
            type="button"
            @click="importMap"
          >
            {{ t("importMap") }}
          </button>
        </div>
      </header>
      <button
        v-for="item in list"
        :key="item.path"
        class="otter-story-item"
        :class="{ active: selectedPath === item.path }"
        type="button"
        @click="openDocument(item.path)"
      >
        <span>{{ item.title }}</span
        ><small>{{ statusLabel(item.status) }}</small>
      </button>
      <button
        v-for="item in area === 'maps' ? data.maps : []"
        :key="item.document.path"
        class="otter-story-item"
        :class="{ active: selectedPath === item.document.path }"
        type="button"
        @click="openMap(item)"
      >
        <span>{{ item.document.title }}</span
        ><small>{{ statusLabel(item.document.status) }}</small>
      </button>
      <p
        v-if="!list.length && !(area === 'maps' && data.maps.length)"
        class="muted"
      >
        {{ t("noStoryItems") }}
      </p>
    </aside>
    <main class="otter-story-detail panel">
      <template v-if="addKind">
        <div class="otter-panel-heading">
          <h2>
            {{
              t(
                addKind === "concept"
                  ? "addConcept"
                  : addKind === "map"
                    ? "addMapNote"
                    : "addWorldNote"
              )
            }}
          </h2>
          <span>{{ t("candidateStatus") }}</span>
        </div>
        <label
          ><span>{{ t("conceptTitle") }}</span
          ><input v-model="newTitle" maxlength="120"
        /></label>
        <label
          ><span>{{ t("conceptContent") }}</span
          ><textarea v-model="newContent" rows="12" maxlength="100000" />
        </label>
        <p class="otter-boundary-note">
          {{ t("ideaCandidateBoundary") }}
        </p>
        <div class="otter-story-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="busy || !newTitle.trim() || !newContent.trim()"
            @click="saveIdea"
          >
            {{ busy ? t("saving") : t("saveCandidate") }}</button
          ><button
            class="secondary-button"
            type="button"
            @click="addKind = null"
          >
            {{ t("cancel") }}
          </button>
        </div>
      </template>
      <template v-else-if="area === 'maps' && selectedMap">
        <div class="otter-panel-heading">
          <h2>{{ selectedMap.document.title }}</h2>
          <span>{{ statusLabel(selectedMap.document.status) }}</span>
        </div>
        <img
          v-if="selectedMap.previewDataUrl"
          class="otter-map-preview"
          :src="selectedMap.previewDataUrl"
          :alt="selectedMap.document.title"
        />
        <p v-else class="muted">{{ t("mapPreviewUnavailable") }}</p>
        <button
          v-if="
            data.documents.some(
              (item) =>
                item.path === selectedMap!.document.path + '.reference.md'
            )
          "
          class="text-button"
          type="button"
          @click="openDocument(selectedMap.document.path + '.reference.md')"
        >
          {{ t("openMapNotes") }}
        </button>
      </template>
      <template v-else-if="opened">
        <div class="otter-panel-heading">
          <h2>
            {{
              list.find((item) => item.path === selectedPath)?.title ||
              selectedPath.split("/").pop()
            }}
          </h2>
          <span>{{
            statusLabel(
              data.documents.find((item) => item.path === selectedPath)
                ?.status || "current"
            )
          }}</span>
        </div>
        <pre class="otter-story-content">{{ opened.content }}</pre>
        <details class="otter-document-location">
          <summary>{{ t("documentLocation") }}</summary>
          <code>{{ opened.path }}</code>
        </details>
      </template>
      <div v-else class="otter-empty-state">{{ t("noStoryItems") }}</div>
    </main>
  </section>
</template>
