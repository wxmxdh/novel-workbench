import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import type { OtterWorkbenchModel } from "./useOtterWorkbench";
import { createNovelWorkspacePort } from "./novelWorkspacePort";
import { novelChapterSelectionId } from "./novelWorkspaceTree";

describe("novel workspace activity navigation", () => {
  it("reopens the exact session recorded by the activity item", async () => {
    const sessionId = ref("current-session");
    const openConversation = vi.fn(async (id: string) => {
      sessionId.value = id;
    });
    const controller = {
      sessionId,
      openConversation
    } as unknown as AgentConversationController;
    const model = {
      projectId: ref("project-one"),
      selectedProject: computed(() => ({ title: "Novel" })),
      projects: ref([]),
      projectView: ref(null),
      document: ref(null),
      tab: ref("workflow"),
      selectProject: vi.fn(),
      openDocument: vi.fn()
    } as unknown as OtterWorkbenchModel;
    const port = createNovelWorkspacePort(model, () => controller);

    const resource = await port.focusConversation(
      "novel:project-one:discussion",
      "novel:project-one",
      "failed-session"
    );

    expect(resource).toBe("novel:project-one:discussion:");
    expect(openConversation).toHaveBeenCalledWith("failed-session");
    expect(sessionId.value).toBe("failed-session");
  });

  it("opens a chapter browser selection and previews only a listed outline or draft", async () => {
    const document = ref<{
      path: string;
      content: string;
      hash: string;
    } | null>(null);
    const projectView = ref({
      project: { id: "project-one", title: "Novel" },
      activeSource: null,
      protocolSummary: {},
      documents: [
        {
          id: "outline-file",
          path: "plans/chapter-1.md",
          title: "第001章大纲",
          category: "plan" as const,
          status: "candidate",
          volume: "第一卷",
          chapter: "第001章",
          model: "unknown",
          readOnly: true as const
        },
        {
          id: "draft-file",
          path: "drafts/chapter-1.md",
          title: "第001章正文",
          category: "draft" as const,
          status: "candidate",
          volume: "第一卷",
          chapter: "第001章",
          model: "GPT 6.1 Sol",
          revision: "修订01",
          readOnly: true as const
        }
      ]
    });
    const model = {
      projectId: ref("project-one"),
      selectedProject: computed(() => ({ title: "Novel" })),
      projects: ref([{ id: "project-one", title: "Novel" }]),
      projectView,
      document,
      tab: ref("external"),
      selectProject: vi.fn(),
      openDocument: vi.fn(async (path: string) => {
        document.value = { path, content: "read only", hash: "hash" };
      })
    } as unknown as OtterWorkbenchModel;
    const port = createNovelWorkspacePort(
      model,
      () => ({}) as AgentConversationController
    );

    await port.select(
      novelChapterSelectionId("project-one", "第一卷 · 第001章")
    );

    expect(port.selectedChapter.value).toEqual({
      position: "第一卷 · 第001章"
    });
    expect(model.document.value).toBeNull();
    expect(await port.selectChapterDocument("drafts/chapter-1.md")).toBe(true);
    expect(model.openDocument).toHaveBeenCalledWith("drafts/chapter-1.md");
    expect(port.category.value).toBe("draft");
    expect(port.selectedChapter.value).toEqual({
      position: "第一卷 · 第001章"
    });
    expect(await port.selectChapterDocument("outside/chapter.md")).toBe(false);
  });
});
