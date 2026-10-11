<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import AppIcon from "./AppIcon.vue";
import { AuthorSupportDialog } from "./lazyAppComponents";

const t = createScopedTranslator("components.sidebarProfileMenu");
const props = defineProps<{ marketplaceDisplayName?: string | undefined }>();
const emit = defineEmits<{ openSettings: [] }>();

const accountMenuRoot = ref<HTMLElement | null>(null);
const accountMenuOpen = ref(false);
const profileDialog = ref<"contact" | "support" | null>(null);
const displayedUserName = computed(
  () => props.marketplaceDisplayName?.trim() || t("author")
);
const avatarInitial = computed(
  () => Array.from(displayedUserName.value.trim())[0] ?? t("a")
);
function toggleAccountMenu(): void {
  accountMenuOpen.value = !accountMenuOpen.value;
}

function openContactDialog(): void {
  accountMenuOpen.value = false;
  profileDialog.value = "contact";
}

function openSupportDialog(): void {
  accountMenuOpen.value = false;
  profileDialog.value = "support";
}

function closeProfileDialog(): void {
  const restoreFocus = profileDialog.value === "support";
  profileDialog.value = null;
  if (restoreFocus) {
    void nextTick(() => {
      accountMenuRoot.value
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    });
  }
}

function openSettings(): void {
  accountMenuOpen.value = false;
  emit("openSettings");
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (
    accountMenuOpen.value &&
    event.target instanceof Node &&
    !accountMenuRoot.value?.contains(event.target)
  ) {
    accountMenuOpen.value = false;
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (profileDialog.value) {
    closeProfileDialog();
    return;
  }
  accountMenuOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
});
</script>

<template>
  <footer class="sidebar-footer">
    <div class="account-controls">
      <div ref="accountMenuRoot" class="account-profile">
        <button
          class="account-row account-identity-button"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="accountMenuOpen"
          aria-controls="account-menu"
          @click="toggleAccountMenu"
        >
          <span class="avatar account-avatar">{{ avatarInitial }}</span>
          <span class="account-copy">
            <strong :title="displayedUserName">{{ displayedUserName }}</strong>
          </span>
        </button>

        <div
          v-if="accountMenuOpen"
          id="account-menu"
          class="account-menu"
          role="menu"
        >
          <button type="button" role="menuitem" @click="openSettings">
            <AppIcon name="settings" :size="16" />
            <span>{{ t("settings") }}</span>
          </button>
          <button type="button" role="menuitem" @click="openContactDialog">
            <AppIcon name="message" :size="16" />
            <span>{{ t("contactAuthor") }}</span>
          </button>
          <button type="button" role="menuitem" @click="openSupportDialog">
            <AppIcon name="sparkles" :size="16" />
            <span>{{ t("supportTheAuthor") }}</span>
          </button>
        </div>
      </div>

      <button
        class="icon-button account-settings-button"
        type="button"
        :aria-label="t('openSettings')"
        :title="t('settings')"
        @click="openSettings"
      >
        <AppIcon name="settings" :size="16" />
      </button>
    </div>
  </footer>
  <AuthorSupportDialog
    v-if="profileDialog === 'support'"
    @close="closeProfileDialog"
  />
  <Teleport to="body">
    <div
      v-if="profileDialog === 'contact'"
      class="dialog-backdrop"
      @mousedown.self="closeProfileDialog"
    >
      <section
        class="workspace-dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-author-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2 id="contact-author-dialog-title">
              {{ t("contactAuthor") }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            @click="closeProfileDialog"
          >
            ×
          </button>
        </header>

        <div class="dialog-content">
          <p class="dialog-description contact-author-description">
            {{ t("forFeedbackOrEarlyAccessToNewVersionsAdd") }}
          </p>
          <div class="author-contact-card">
            <span>{{ t("weChatID") }}</span>
            <strong>deepseekwrite</strong>
          </div>
          <div class="dialog-actions">
            <button
              class="dialog-primary-button"
              type="button"
              @click="closeProfileDialog"
            >
              {{ t("gotIt") }}
            </button>
          </div>
        </div>
      </section>
    </div>

  </Teleport>
</template>

<style scoped>
.account-avatar {
  position: relative;
}
</style>
