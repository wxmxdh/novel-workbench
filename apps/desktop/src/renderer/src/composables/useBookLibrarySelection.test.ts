import { effectScope, reactive } from "vue";
import { describe, expect, it } from "vitest";
import type {
  MaterialLibrary,
  MaterialLibraryGroup,
  SkillLibrary,
  SkillLibraryGroup
} from "@deepwrite/contracts";
import {
  useBookLibrarySelection,
  type BookLibrarySelectionProps
} from "./useBookLibrarySelection";
import { bookTemplateReferenceError } from "../utils/bookTemplateReferences";
import {
  loadBookTemplateDraftSchema,
  createDefaultCreativePlotStages
} from "@deepwrite/contracts";
function properties(): BookLibrarySelectionProps {
  return {
    workspaceType: "short",
    materials: [
      {
        id: "material_1",
        title: "人物素材",
        materialKind: "character",
        materialType: "script",
        parentGenre: "",
        subGenre: ""
      } as MaterialLibrary
    ],
    skills: [
      {
        id: "skill_1",
        title: "文风技能",
        skillKind: "style",
        skillType: "long"
      } as SkillLibrary
    ],
    materialGroups: [
      {
        id: "material_group",
        title: "素材分组",
        members: { character: "material_1" }
      } as MaterialLibraryGroup
    ],
    skillGroups: [
      {
        id: "skill_group",
        title: "技能分组",
        members: { style: "skill_1" }
      } as SkillLibraryGroup
    ]
  };
}
describe("shared book library selection", () => {
  it("resolves groups to independent ID snapshots from the shared cross-workspace library pool", () => {
    const scope = effectScope();
    const props = reactive(properties());
    try {
      const selection = scope.run(() => useBookLibrarySelection(props))!;
      selection.materialBindingMode.value = "group";
      selection.selectedMaterialGroupId.value = "material_group";
      selection.skillBindingMode.value = "group";
      selection.selectedSkillGroupId.value = "skill_group";
      const materials = selection.selectedMaterialLinks();
      const skills = selection.selectedSkillLinks();
      expect(materials.character).toEqual(["material_1"]);
      expect(skills.style).toEqual(["skill_1"]);
      props.materialGroups[0]!.members.character = "";
      props.skillGroups[0]!.members.style = "";
      expect(materials.character).toEqual(["material_1"]);
      expect(skills.style).toEqual(["skill_1"]);
    } finally {
      scope.stop();
    }
  });
  it("retains missing template references so validation blocks creation instead of dropping bindings", async () => {
    const scope = effectScope();
    const configuration = (await loadBookTemplateDraftSchema()).parse({
      workspaceType: "short",
      name: "模板",
      genre: "其他",
      characterFormat: "text",
      defaultPlotStageIds: ["plot_design"],
      linkedMaterialIdsByKind: {
        character: ["deleted_material"],
        gimmick: [],
        plot: [],
        draft: [],
        other: []
      },
      linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] }
    });
    const props = reactive({
      ...properties(),
      preserveMissing: true,
      initialMaterials: configuration.linkedMaterialIdsByKind
    });
    try {
      const selection = scope.run(() => useBookLibrarySelection(props))!;
      expect(selection.selectedMaterialLinks().character).toEqual([
        "deleted_material"
      ]);
      expect(selection.materialSelectOptions("character")).toContainEqual({
        value: "deleted_material",
        label: "已失效的素材库（请重新选择）"
      });
      expect(
        bookTemplateReferenceError(configuration, {
          ...props,
          creativePlotStages: createDefaultCreativePlotStages()
        })
      ).toContain("素材库已失效");
      selection.selectedMaterialIds.character = "material_1";
      expect(
        bookTemplateReferenceError(
          {
            ...configuration,
            linkedMaterialIdsByKind: selection.selectedMaterialLinks()
          },
          { ...props, creativePlotStages: createDefaultCreativePlotStages() }
        )
      ).toBeNull();
    } finally {
      scope.stop();
    }
  });
});
