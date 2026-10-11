import { reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultCreativePlotStages,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  type CatalogIndexSnapshot,
  type WorkspaceAgentSettings
} from "@deepwrite/contracts";
import { useCreativeBookCreation } from "./useCreativeBookCreation";
import type { CreateCreativeBookPayload } from "../components/WorkspaceDialogLayer.types";
describe("creative book creation routing", () => {
  it.each(["short", "script", "long"] as const)(
    "submits cloneable %s book bindings from the reactive dialog draft",
    async (workspaceType) => {
      const bindings = ref({
        linkedMaterialIdsByKind: {
          character: ["material_character"],
          gimmick: [],
          plot: ["material_plot"],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: {
          general: ["skill_general"],
          plot: [],
          style: ["skill_style"],
          other: []
        }
      });
      const input: CreateCreativeBookPayload = {
        workspaceType,
        title: "新书",
        genre: "其他",
        ...bindings.value,
        ...(workspaceType === "long"
          ? {}
          : { defaultPlotStageIds: reactive(["plot_design", "outline"]) })
      };
      // Reproduce contextBridge's failure before Preload can validate input.
      expect(() => structuredClone(input)).toThrow();
      const submit = vi.fn(async (payload: unknown) => {
        structuredClone(payload);
      });
      const flow = useCreativeBookCreation({
        open: ref(true),
        pending: () => false,
        settings: ref([]),
        catalog: ref(null),
        createShort: submit,
        createLong: submit,
        openSettings: vi.fn(async () => {})
      });

      await flow.createCreativeBook(input);

      expect(submit).toHaveBeenCalledTimes(1);
      const payload = submit.mock.calls[0]![0];
      expect(payload).toMatchObject({
        title: "新书",
        genre: "其他",
        ...bindings.value
      });
      if (workspaceType !== "long") {
        expect(payload).toMatchObject({
          defaultPlotStageIds: ["plot_design", "outline"]
        });
      }
      bindings.value.linkedSkillIdsByKind.general.push("skill_later");
      expect(payload).toMatchObject({
        linkedSkillIdsByKind: { general: ["skill_general"] }
      });
    }
  );

  it("preserves normal long payloads and applies global defaults only to ordinary short creation", async () => {
    const createLong = vi.fn(async () => {});
    const createShort = vi.fn(async () => {});
    const flow = useCreativeBookCreation({
      open: ref(false),
      pending: () => false,
      settings: ref<WorkspaceAgentSettings[]>([
        {
          ...DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
          defaultPlotStageIds: ["plot_design"]
        }
      ]),
      catalog: ref({
        creativePlotStages: createDefaultCreativePlotStages()
      } as CatalogIndexSnapshot),
      createLong,
      createShort,
      openSettings: vi.fn(async () => {})
    });
    await flow.createCreativeBook({
      workspaceType: "long",
      title: "长篇",
      genre: "其他"
    });
    expect(createLong).toHaveBeenCalledExactlyOnceWith({
      title: "长篇",
      genre: "其他"
    });
    await flow.createCreativeBook({
      workspaceType: "short",
      title: "普通短篇",
      genre: "其他"
    });
    expect(createShort).toHaveBeenLastCalledWith({
      workspaceType: "short",
      title: "普通短篇",
      genre: "其他",
      defaultPlotStageIds: ["plot_design"]
    });
    const template = {
      workspaceType: "short" as const,
      title: "模板短篇",
      genre: "其他" as const,
      templateId: "template_1"
    };
    await flow.createCreativeBook(template);
    expect(createShort).toHaveBeenLastCalledWith(template);
  });
});
