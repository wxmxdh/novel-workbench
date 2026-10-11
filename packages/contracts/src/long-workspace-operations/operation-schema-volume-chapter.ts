import { z } from "zod";
import {
  LongArcIdSchema,
  LongArcSchema,
  LongChapterCardIdSchema,
  LongChapterCardSchema,
  LongChapterCharacterContinuityFileIndexEntrySchema,
  LongChapterFileIndexEntrySchema,
  LongCharacterIdSchema,
  LongMarkdownFileReferenceSchema,
  LongVolumeIdSchema,
  LongVolumeSchema
} from "../long-workspace";
import {
  ArcUpdatePatchSchema,
  ChapterCardUpdatePatchSchema,
  OptionalProvisionalIdShape,
  VolumeUpdatePatchSchema,
  uniqueIdArray
} from "./schema-helpers";

export const LongWorkspaceVolumeChapterOperationSchemas = [
  z
    .object({
      type: z.literal("volume.create"),
      volume: LongVolumeSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("volume.update"),
      id: LongVolumeIdSchema,
      patch: VolumeUpdatePatchSchema
    })
    .strict(),
  z
    .object({ type: z.literal("volume.delete"), id: LongVolumeIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("volume.reorder"),
      orderedIds: uniqueIdArray(LongVolumeIdSchema, "volume reorder id")
    })
    .strict(),
  z
    .object({
      type: z.literal("arc.create"),
      arc: LongArcSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("arc.update"),
      id: LongArcIdSchema,
      patch: ArcUpdatePatchSchema
    })
    .strict(),
  z.object({ type: z.literal("arc.delete"), id: LongArcIdSchema }).strict(),
  z
    .object({
      type: z.literal("arc.move"),
      id: LongArcIdSchema,
      toVolumeId: LongVolumeIdSchema,
      beforeArcId: LongArcIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("arc.reorder"),
      volumeId: LongVolumeIdSchema,
      orderedIds: uniqueIdArray(LongArcIdSchema, "arc reorder id")
    })
    .strict(),
  z
    .object({
      type: z.literal("chapter.create"),
      chapterCard: LongChapterCardSchema,
      files: LongChapterFileIndexEntrySchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("chapter.update"),
      id: LongChapterCardIdSchema,
      patch: ChapterCardUpdatePatchSchema
    })
    .strict(),
  z
    .object({ type: z.literal("chapter.delete"), id: LongChapterCardIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("chapter.move"),
      id: LongChapterCardIdSchema,
      toVolumeId: LongVolumeIdSchema,
      toPrimaryArcId: LongArcIdSchema.nullable(),
      beforeChapterCardId: LongChapterCardIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("chapter.reorder"),
      volumeId: LongVolumeIdSchema,
      orderedIds: uniqueIdArray(LongChapterCardIdSchema, "chapter reorder id")
    })
    .strict(),
  z
    .object({
      type: z.literal("chapterContinuity.worldReveals.create"),
      chapterCardId: LongChapterCardIdSchema,
      file: LongMarkdownFileReferenceSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("chapterContinuity.worldReveals.delete"),
      chapterCardId: LongChapterCardIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("chapterContinuity.character.create"),
      chapterCardId: LongChapterCardIdSchema,
      characterId: LongCharacterIdSchema,
      currentState:
        LongChapterCharacterContinuityFileIndexEntrySchema.shape.currentState,
      history: LongChapterCharacterContinuityFileIndexEntrySchema.shape.history
    })
    .strict(),
  z
    .object({
      type: z.literal("chapterContinuity.character.delete"),
      chapterCardId: LongChapterCardIdSchema,
      characterId: LongCharacterIdSchema
    })
    .strict()
] as const;
