import { z } from "zod";
import {
  LongArcIdSchema,
  LongChapterCardIdSchema,
  LongEventConnectionIdSchema,
  LongEventConnectionSchema,
  LongForeshadowingBeatIdSchema,
  LongForeshadowingBeatSchema,
  LongForeshadowingIdSchema,
  LongForeshadowingSchema,
  LongNarrativePlacementIdSchema,
  LongNarrativePlacementSchema,
  LongStoryEventIdSchema,
  LongStoryEventSchema,
  LongStoryPlotIdSchema,
  LongStoryPlotSchema
} from "../long-workspace";
import {
  EventConnectionUpdatePatchSchema,
  ForeshadowingBeatUpdatePatchSchema,
  ForeshadowingUpdatePatchSchema,
  NarrativePlacementUpdatePatchSchema,
  OperationTitleSchema,
  OptionalProvisionalIdShape,
  StoryEventUpdatePatchSchema,
  nonEmptyPatch,
  uniqueIdArray
} from "./schema-helpers";

export const LongWorkspaceStoryOperationSchemas = [
  z
    .object({
      type: z.literal("event.create"),
      event: LongStoryEventSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("event.update"),
      id: LongStoryEventIdSchema,
      patch: StoryEventUpdatePatchSchema
    })
    .strict(),
  z
    .object({ type: z.literal("event.delete"), id: LongStoryEventIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("event.reorder"),
      orderedIds: uniqueIdArray(LongStoryEventIdSchema, "event reorder id")
    })
    .strict(),
  z
    .object({
      type: z.literal("storyPlot.create"),
      storyPlot: LongStoryPlotSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("storyPlot.update"),
      id: LongStoryPlotIdSchema,
      patch: nonEmptyPatch({ title: OperationTitleSchema.optional() })
    })
    .strict(),
  z
    .object({ type: z.literal("storyPlot.delete"), id: LongStoryPlotIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("storyPlot.reorder"),
      arcId: LongArcIdSchema,
      orderedIds: uniqueIdArray(LongStoryPlotIdSchema, "story-plot reorder id")
    })
    .strict(),
  z
    .object({
      type: z.literal("connection.create"),
      connection: LongEventConnectionSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("connection.update"),
      id: LongEventConnectionIdSchema,
      patch: EventConnectionUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("connection.delete"),
      id: LongEventConnectionIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.create"),
      placement: LongNarrativePlacementSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.update"),
      id: LongNarrativePlacementIdSchema,
      patch: NarrativePlacementUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.delete"),
      id: LongNarrativePlacementIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.move"),
      id: LongNarrativePlacementIdSchema,
      toChapterCardId: LongChapterCardIdSchema,
      beforePlacementId: LongNarrativePlacementIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("placement.reorder"),
      chapterCardId: LongChapterCardIdSchema,
      orderedIds: uniqueIdArray(
        LongNarrativePlacementIdSchema,
        "placement reorder id"
      )
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowing.create"),
      thread: LongForeshadowingSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowing.update"),
      id: LongForeshadowingIdSchema,
      patch: ForeshadowingUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowing.delete"),
      id: LongForeshadowingIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowing.reorder"),
      orderedIds: uniqueIdArray(
        LongForeshadowingIdSchema,
        "foreshadowing reorder id"
      )
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.create"),
      threadId: LongForeshadowingIdSchema,
      beat: LongForeshadowingBeatSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.update"),
      id: LongForeshadowingBeatIdSchema,
      patch: ForeshadowingBeatUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.delete"),
      id: LongForeshadowingBeatIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.move"),
      id: LongForeshadowingBeatIdSchema,
      toThreadId: LongForeshadowingIdSchema,
      beforeBeatId: LongForeshadowingBeatIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("foreshadowingBeat.reorder"),
      threadId: LongForeshadowingIdSchema,
      orderedIds: uniqueIdArray(
        LongForeshadowingBeatIdSchema,
        "foreshadowing-beat reorder id"
      )
    })
    .strict()
] as const;
