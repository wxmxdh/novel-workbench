import { z } from "zod";
import {
  LongArcIdSchema,
  LongChapterCardIdSchema,
  LongCharacterIdSchema,
  LongNarrativePlacementIdSchema,
  LongStoryEventIdSchema,
  LongVolumeIdSchema,
  LongWorldbuildingItemLayoutSchema
} from "../long-workspace";
export const OperationTimestampSchema = z.string().datetime();
export const OperationTextSchema = z.string().max(200_000);
export const OperationShortTextSchema = z.string().max(4_000);
export const OperationTitleSchema = z.string().trim().min(1).max(256);

export const LongProvisionalIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(
    /^provisional_[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/,
    "Provisional ids must use the provisional_ prefix."
  );
export type LongProvisionalId = z.infer<typeof LongProvisionalIdSchema>;

export const OptionalProvisionalIdShape = {
  provisionalId: LongProvisionalIdSchema.optional()
} as const;

export function nonEmptyPatch<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "Update patches must contain at least one field."
    });
}

export function uniqueIdArray<T extends string>(
  schema: z.ZodType<T>,
  label: string
) {
  return z
    .array(schema)
    .max(400_000)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label}: ${value}`
          });
        }
        seen.add(value);
      });
    });
}

export const WorldbuildingUpdatePatchSchema = nonEmptyPatch({
  title: OperationTitleSchema.optional(),
  format: z.enum(["list", "text"]).optional()
});
export const FeatureSettingsUpdatePatchSchema = nonEmptyPatch({
  worldbuildingItemLayout: LongWorldbuildingItemLayoutSchema.optional(),
  characterAndContinuityItemLayout:
    LongWorldbuildingItemLayoutSchema.optional(),
  plotItemLayout: LongWorldbuildingItemLayoutSchema.optional()
});
export const CharacterUpdatePatchSchema = nonEmptyPatch({
  name: OperationTitleSchema.optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(64).optional()
});
export const CharacterTypeUpdatePatchSchema = nonEmptyPatch({
  title: OperationTitleSchema.optional()
});
export const VolumeUpdatePatchSchema = nonEmptyPatch({
  title: OperationTitleSchema.optional(),
  summary: OperationTextSchema.optional()
});
export const ArcUpdatePatchSchema = nonEmptyPatch({
  title: OperationTitleSchema.optional(),
  summary: OperationTextSchema.optional(),
  outline: OperationTextSchema.optional()
});
export const ChapterCardUpdatePatchSchema = nonEmptyPatch({
  title: OperationTitleSchema.optional()
});
export const StoryEventUpdatePatchSchema = nonEmptyPatch({
  title: OperationTitleSchema.optional(),
  summary: OperationTextSchema.optional(),
  timeMode: z.enum(["exact", "relative", "sequence", "unknown"]).optional(),
  timeLabel: z.string().max(1_000).optional(),
  timeValue: z.string().max(1_000).optional(),
  location: z.string().max(1_000).optional(),
  arcIds: uniqueIdArray(LongArcIdSchema, "event arc reference").optional(),
  characterIds: uniqueIdArray(
    LongCharacterIdSchema,
    "event character reference"
  ).optional()
});
export const EventConnectionUpdatePatchSchema = nonEmptyPatch({
  sourceEventId: LongStoryEventIdSchema.optional(),
  targetEventId: LongStoryEventIdSchema.optional(),
  type: z
    .enum(["before", "same_time", "overlaps", "causes", "enables", "conceals"])
    .optional(),
  note: OperationShortTextSchema.optional()
});
export const NarrativePlacementUpdatePatchSchema = nonEmptyPatch({
  eventId: LongStoryEventIdSchema.optional(),
  mode: z
    .enum([
      "scene",
      "flashback",
      "retelling",
      "clue",
      "misdirection",
      "reveal",
      "dream",
      "prophecy"
    ])
    .optional(),
  disclosure: z.enum(["hint", "partial", "full", "false"]).optional(),
  writingPrompt: OperationShortTextSchema.optional()
});
export const ForeshadowingUpdatePatchSchema = nonEmptyPatch({
  title: OperationTitleSchema.optional(),
  coreQuestion: OperationTextSchema.optional(),
  hiddenTruth: OperationTextSchema.optional(),
  plannedSpan: z.enum(["local", "within_volume", "cross_volume"]).optional(),
  truthEventId: LongStoryEventIdSchema.nullable().optional(),
  expectedReaderEffect: OperationTextSchema.optional(),
  status: z.enum(["planned", "abandoned"]).optional()
});
export const ForeshadowingBeatUpdatePatchSchema = nonEmptyPatch({
  type: z
    .enum([
      "source",
      "plant",
      "reinforce",
      "misdirect",
      "partial_reveal",
      "reveal",
      "payoff",
      "aftermath"
    ])
    .optional(),
  volumeId: LongVolumeIdSchema.nullable().optional(),
  arcId: LongArcIdSchema.nullable().optional(),
  eventId: LongStoryEventIdSchema.nullable().optional(),
  placementId: LongNarrativePlacementIdSchema.nullable().optional(),
  chapterCardId: LongChapterCardIdSchema.nullable().optional(),
  plannedScope: z.string().max(1_000).optional(),
  note: OperationShortTextSchema.optional()
});

export function sortedUniqueIdArray<T extends string>(schema: z.ZodType<T>) {
  return z.array(schema).superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate impact id: ${value}`
        });
      }
      seen.add(value);
      if (index > 0 && values[index - 1]! > value) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Impact ids must be sorted."
        });
      }
    });
  });
}
