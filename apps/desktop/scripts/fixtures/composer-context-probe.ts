import { createApp, h, ref, nextTick } from "vue";
import ComposerContextBar from "../../src/renderer/src/components/ComposerContextBar.vue";
import { createComposerContextNavigation } from "../../src/renderer/src/composables/composerContextNavigation";
import { COMPOSER_CONTEXT_NAVIGATION } from "../../src/renderer/src/composables/composerContextNavigationContext";
import type { ResourceTreeSection } from "../../src/renderer/src/types/workspace";
import {
  applyAppearanceThemeToDocument,
  defaultAppearanceTheme
} from "../../src/renderer/src/composables/appearanceThemeRuntime";
import "../../src/renderer/src/styles.css";
const sections = ref<ResourceTreeSection[]>([
  {
    id: "creation",
    label: "创作",
    icon: "book",
    nodes: Array.from({ length: 18 }, (_, i) => ({
      id: `book-${i}`,
      label:
        i === 0
          ? "长夜行舟：一封意外来信引出的漫长归途与未完故事"
          : `测试作品 ${i}`,
      badge: i % 2 ? "长篇" : "短篇",
      catalogNodeType: "book",
      icon: "book",
      children: [
        { id: `gimmick-${i}`, label: "故事构思", icon: "sparkles" },
        { id: `character-${i}`, label: "人物设计", icon: "user" },
        {
          id: `plot-${i}`,
          label: "剧情",
          children: [
            { id: `opening-${i}`, label: "开篇：意外来信", icon: "wand" },
            { id: `ending-${i}`, label: "结局：归途", icon: "wand" }
          ]
        },
        { id: `draft-${i}`, label: "正文", icon: "edit" }
      ]
    }))
  }
]);
const selectedResourceId = ref("opening-0");
const responding = ref(false);
const nav = createComposerContextNavigation({
  sections,
  selectedResourceId,
  canSelect: (node) => !node.children?.length,
  selectResource: async (node) => {
    selectedResourceId.value = node.id;
  },
  error: (message) => {
    throw new Error(message);
  }
});
const app = createApp({
  render: () =>
    h(
      "main",
      {
        style:
          "position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); width: min(720px, calc(100% - 32px))"
      },
      [
        h(ComposerContextBar, {
          bookTitle: nav.currentBook.value?.label ?? "未选择",
          stageLabel:
            nav.stages.value.find((item) => item.current)?.label ?? "阶段",
          responding: responding.value
        }),
        h(
          "div",
          {
            class: "composer-input-surface",
            style:
              "position: relative; padding: 24px; min-height: 140px; color: var(--text-tertiary)"
          },
          "输入创作需求…"
        )
      ]
    )
});
app.provide(COMPOSER_CONTEXT_NAVIGATION, {
  available: ref(true),
  load: async () => nav
});
app.mount("#app");
const frame = async () => {
  await nextTick();
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
};
const el = (selector: string) => {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};
const check = (value: boolean, label: string) => {
  if (!value) throw new Error(label);
};
async function open(kind: "book" | "stage") {
  const button = el(`.composer-${kind}-context`);
  button.focus();
  button.click();
  for (
    let i = 0;
    i < 100 && !document.querySelector(".composer-context-menu");
    i++
  )
    await frame();
  await frame();
}
function theme(scheme: "light" | "dark", size = 14) {
  applyAppearanceThemeToDocument({
    scheme,
    theme: {
      ...defaultAppearanceTheme(scheme),
      uiFontSize: size,
      accent: "#8a4bc2"
    },
    uiFontFamily: "system",
    editorFontFamily: "song"
  });
}
async function run() {
  theme("light");
  await open("book");
  check(
    document.activeElement === el(".context-search input"),
    "Search should receive focus"
  );
  check(
    document.querySelectorAll(".context-option").length === 18,
    "Books should be available"
  );
  const search = el(".context-search input") as HTMLInputElement;
  search.value = "不存在";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await frame();
  check(
    Boolean(document.querySelector(".context-picker-empty")),
    "Search empty state"
  );
  search.value = "测试作品 2";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await frame();
  search.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  );
  await frame();
  check(selectedResourceId.value === "gimmick-2", "Search Enter switches book");
  check(
    !document.querySelector(".composer-context-menu"),
    "Successful switch closes dialog"
  );
  check(
    document.activeElement === el(".composer-book-context"),
    "Focus returns to opener"
  );
  await open("stage");
  check(
    document.querySelectorAll(".context-option").length === 5,
    "Only the selected book stages are shown"
  );
  el(".context-search input").dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
  );
  await frame();
  check(document.activeElement === el(".context-option"), "Arrow navigation");
  el(".context-option").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
  );
  await frame();
  check(
    document.activeElement === el(".composer-stage-context"),
    "Escape restores stage focus"
  );
  await open("stage");
  const last = [
    ...document.querySelectorAll<HTMLButtonElement>(".context-option")
  ].at(-1)!;
  last.focus();
  last.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
  );
  await frame();
  check(
    !document.querySelector(".composer-context-menu"),
    "Tab exits the nonmodal picker"
  );
  await open("book");
  el(".composer-book-context").click();
  await frame();
  check(
    !document.querySelector(".composer-context-menu"),
    "Clicking the trigger again closes it"
  );
  await open("stage");
  el(".composer-input-surface").dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true })
  );
  await frame();
  check(
    !document.querySelector(".composer-context-menu"),
    "Outside click closes without a backdrop"
  );
  check(
    !document.querySelector(".composer-context-backdrop"),
    "No centered modal overlay"
  );
  await open("stage");
  const main = el("main");
  main.style.bottom = "auto";
  main.style.top = "16px";
  window.dispatchEvent(new Event("resize"));
  await frame();
  const menuRect = el(".composer-context-menu").getBoundingClientRect();
  const triggerRect = el(".composer-stage-context").getBoundingClientRect();
  check(
    Math.abs(menuRect.top - triggerRect.bottom - 7) <= 1,
    "Falls below the trigger when there is no space above"
  );
  el(".context-picker-close").click();
  main.style.top = "";
  main.style.bottom = "24px";
  await frame();
  responding.value = true;
  await frame();
  check(
    (el(".composer-book-context") as HTMLButtonElement).disabled,
    "Busy composer disables switching"
  );
  responding.value = false;
  await frame();
  return { passed: true, checks: 15 };
}
async function show(
  scheme: "light" | "dark",
  size: number,
  kind: "book" | "stage"
) {
  document.querySelector<HTMLButtonElement>(".context-picker-close")?.click();
  await frame();
  theme(scheme, size);
  await open(kind);
  const dialog = el(".composer-context-menu");
  const rect = dialog.getBoundingClientRect();
  check(
    rect.left >= 0 &&
      rect.right <= innerWidth &&
      rect.top >= 0 &&
      rect.bottom <= innerHeight,
    "Popover fits viewport"
  );
  check(dialog.scrollWidth <= dialog.clientWidth + 1, "No horizontal overflow");
  check(el(".context-picker-list").clientHeight > 40, "List remains usable");
  const anchor = el(`.composer-${kind}-context`).getBoundingClientRect();
  check(
    Math.abs(rect.bottom + 7 - anchor.top) <= 1 ||
      Math.abs(rect.top - 7 - anchor.bottom) <= 1,
    "Popover is attached to its trigger"
  );
  check(
    dialog.getAttribute("aria-modal") !== "true",
    "Workspace remains interactive"
  );
  return { scheme, size, kind, width: innerWidth, height: innerHeight };
}
Object.assign(window, {
  runComposerContextProbe: run,
  showComposerContextProbe: show
});
