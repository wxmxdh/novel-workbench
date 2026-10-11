import {
  createEnvelope,
  CommandEnvelopeSchema,
  OtterSettingsSchema,
  OtterProjectListSchema,
  OtterProjectInputSchema,
  OtterProjectViewSchema,
  OtterReadInputSchema,
  OtterReadResultSchema,
  OtterRouteInputSchema,
  OtterProtocolResultSchema,
  OtterWorkflowInputSchema,
  OtterContextRefSchema,
  OtterContextResultSchema,
  OtterHandoffInputSchema,
  OtterHandoffResultSchema,
  OtterReviewPageSchema,
  OtterStageDraftInputSchema,
  OtterSaveWritingInputSchema,
  OtterSaveWritingResultSchema,
  OtterSelectWritingInputSchema,
  OtterSelectWritingResultSchema,
  OtterSetReviewBoundsSchema,
  OtterSetReviewOverlaySchema,
  OtterReviewOverlaySchema,
  OtterReviewThemeSchema,
  type OtterApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";
import {
  OtterManualHandoffInputSchema,
  OtterManualHandoffResultSchema,
  OtterManualReportInputSchema,
  OtterManualReportSchema,
  OtterStorySpaceInputSchema,
  OtterStorySpaceSchema,
  OtterCreateProjectInputSchema,
  OtterCreateProjectResultSchema,
  OtterSaveIdeaInputSchema,
  OtterSaveIdeaResultSchema,
  OtterMapImportInputSchema,
  OtterMapImportResultSchema,
  OtterReadingContextInputSchema,
  OtterReadingContextSchema,
  OtterDiscussionInputSchema,
  OtterDiscussionResultSchema,
  OtterTeamsSchema,
  OtterTeamPlanInputSchema,
  OtterTeamPlanSchema
} from "@deepwrite/contracts";

function invoke<T>(
  type: Parameters<typeof createEnvelope>[0],
  payload: unknown
): Promise<T> {
  const id = browserId("cmd_otter");
  return invokeCommand<T>(
    CommandEnvelopeSchema.parse(createEnvelope(type, payload, { id }))
  );
}
export const otter: OtterApi = {
  prepareDiscussion: async (input) =>
    OtterDiscussionResultSchema.parse(
      await invoke(
        "otter.prepareDiscussion",
        OtterDiscussionInputSchema.parse(input)
      )
    ),
  teams: async () => OtterTeamsSchema.parse(await invoke("otter.teams", {})),
  saveTeams: async (input) =>
    OtterTeamsSchema.parse(
      await invoke("otter.saveTeams", OtterTeamsSchema.parse(input))
    ),
  prepareTeam: async (input) =>
    OtterTeamPlanSchema.parse(
      await invoke("otter.prepareTeam", OtterTeamPlanInputSchema.parse(input))
    ),
  manualHandoff: async (input) =>
    OtterManualHandoffResultSchema.parse(
      await invoke(
        "otter.manualHandoff",
        OtterManualHandoffInputSchema.parse(input)
      )
    ),
  manualReport: async (input) =>
    OtterManualReportSchema.parse(
      await invoke(
        "otter.manualReport",
        OtterManualReportInputSchema.parse(input)
      )
    ),
  storySpace: async (input) =>
    OtterStorySpaceSchema.parse(
      await invoke("otter.storySpace", OtterStorySpaceInputSchema.parse(input))
    ),
  createProject: async (input) =>
    OtterCreateProjectResultSchema.parse(
      await invoke(
        "otter.createProject",
        OtterCreateProjectInputSchema.parse(input)
      )
    ),
  saveConcept: async (input) =>
    OtterSaveIdeaResultSchema.parse(
      await invoke("otter.saveConcept", OtterSaveIdeaInputSchema.parse(input))
    ),
  saveWorldNote: async (input) =>
    OtterSaveIdeaResultSchema.parse(
      await invoke("otter.saveWorldNote", OtterSaveIdeaInputSchema.parse(input))
    ),
  saveMapNote: async (input) =>
    OtterSaveIdeaResultSchema.parse(
      await invoke("otter.saveMapNote", OtterSaveIdeaInputSchema.parse(input))
    ),
  importMap: async (input) =>
    OtterMapImportResultSchema.nullable().parse(
      await invoke("otter.importMap", OtterMapImportInputSchema.parse(input))
    ),
  readingContext: async (input) =>
    OtterReadingContextSchema.parse(
      await invoke(
        "otter.readingContext",
        OtterReadingContextInputSchema.parse(input ?? {})
      )
    ),
  settings: async () =>
    OtterSettingsSchema.parse(await invoke("otter.settings", {})),
  chooseWorkspace: async () =>
    OtterSettingsSchema.nullable().parse(
      await invoke("otter.chooseWorkspace", {})
    ),
  projects: async () =>
    OtterProjectListSchema.parse(await invoke("otter.projects", {})),
  open: async (input) =>
    OtterProjectViewSchema.parse(
      await invoke("otter.open", OtterProjectInputSchema.parse(input))
    ),
  read: async (input) =>
    OtterReadResultSchema.parse(
      await invoke("otter.read", OtterReadInputSchema.parse(input))
    ),
  route: async (input) =>
    OtterProtocolResultSchema.parse(
      await invoke("otter.route", OtterRouteInputSchema.parse(input))
    ),
  workflow: async (input) =>
    OtterProtocolResultSchema.parse(
      await invoke("otter.workflow", OtterWorkflowInputSchema.parse(input))
    ),
  context: async (input) =>
    OtterContextResultSchema.parse(
      await invoke("otter.context", OtterContextRefSchema.parse(input))
    ),
  handoff: async (input) =>
    OtterHandoffResultSchema.parse(
      await invoke("otter.handoff", OtterHandoffInputSchema.parse(input))
    ),
  reviewPage: async () =>
    OtterReviewPageSchema.parse(await invoke("otter.reviewPage", {})),
  setReviewOverlay: async (visible) =>
    OtterReviewOverlaySchema.parse(
      await invoke(
        "otter.setReviewOverlay",
        OtterSetReviewOverlaySchema.parse({ visible })
      )
    ),
  setReviewTheme: async (theme) => {
    await invoke("otter.setReviewTheme", OtterReviewThemeSchema.parse(theme));
  },
  setReviewBounds: async (bounds) => {
    await invoke(
      "otter.setReviewBounds",
      OtterSetReviewBoundsSchema.parse({ bounds })
    );
  },
  stageDraft: async (input) =>
    OtterProtocolResultSchema.parse(
      await invoke("otter.stageDraft", OtterStageDraftInputSchema.parse(input))
    ),
  saveWriting: async (input) =>
    OtterSaveWritingResultSchema.parse(
      await invoke(
        "otter.saveWriting",
        OtterSaveWritingInputSchema.parse(input)
      )
    ),
  selectWriting: async (input) =>
    OtterSelectWritingResultSchema.parse(
      await invoke(
        "otter.selectWriting",
        OtterSelectWritingInputSchema.parse(input)
      )
    )
};
