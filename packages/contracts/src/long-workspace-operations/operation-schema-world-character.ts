import { z } from "zod";
import {
  LongCharacterFileIndexEntrySchema,
  LongCharacterGroupSchema,
  LongCharacterIdSchema,
  LongCharacterSchema,
  LongCharacterTypeIdSchema,
  LongCharacterTypeSchema,
  LongWorldbuildingCategoryIdSchema,
  LongWorldbuildingCategorySchema,
  LongWorldbuildingItemIdSchema,
  LongWorldbuildingItemSchema
} from "../long-workspace";
import {
  CharacterTypeUpdatePatchSchema,
  CharacterUpdatePatchSchema,
  FeatureSettingsUpdatePatchSchema,
  OperationTitleSchema,
  OptionalProvisionalIdShape,
  WorldbuildingUpdatePatchSchema,
  nonEmptyPatch,
  uniqueIdArray
} from "./schema-helpers";

export const LongWorkspaceWorldCharacterOperationSchemas = [
  z
    .object({
      type: z.literal("featureSettings.update"),
      patch: FeatureSettingsUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuilding.create"),
      category: LongWorldbuildingCategorySchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuilding.update"),
      id: LongWorldbuildingCategoryIdSchema,
      patch: WorldbuildingUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuilding.delete"),
      id: LongWorldbuildingCategoryIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuilding.reorder"),
      orderedIds: uniqueIdArray(
        LongWorldbuildingCategoryIdSchema,
        "worldbuilding reorder id"
      )
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuildingItem.create"),
      categoryId: LongWorldbuildingCategoryIdSchema,
      item: LongWorldbuildingItemSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuildingItem.update"),
      categoryId: LongWorldbuildingCategoryIdSchema,
      id: LongWorldbuildingItemIdSchema,
      patch: nonEmptyPatch({ title: OperationTitleSchema.optional() })
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuildingItem.delete"),
      categoryId: LongWorldbuildingCategoryIdSchema,
      id: LongWorldbuildingItemIdSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("worldbuildingItem.reorder"),
      categoryId: LongWorldbuildingCategoryIdSchema,
      orderedIds: uniqueIdArray(
        LongWorldbuildingItemIdSchema,
        "worldbuilding item reorder id"
      )
    })
    .strict(),
  z
    .object({
      type: z.literal("characterType.create"),
      characterType: LongCharacterTypeSchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("characterType.update"),
      id: LongCharacterTypeIdSchema,
      patch: CharacterTypeUpdatePatchSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("characterType.delete"),
      id: LongCharacterTypeIdSchema,
      moveCharactersToTypeId: LongCharacterTypeIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("characterType.reorder"),
      orderedIds: uniqueIdArray(
        LongCharacterTypeIdSchema,
        "character type reorder id"
      )
    })
    .strict(),
  z
    .object({
      type: z.literal("character.create"),
      character: LongCharacterSchema,
      files: LongCharacterFileIndexEntrySchema,
      ...OptionalProvisionalIdShape
    })
    .strict(),
  z
    .object({
      type: z.literal("character.update"),
      id: LongCharacterIdSchema,
      patch: CharacterUpdatePatchSchema
    })
    .strict(),
  z
    .object({ type: z.literal("character.delete"), id: LongCharacterIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("character.move"),
      id: LongCharacterIdSchema,
      toGroup: LongCharacterGroupSchema,
      beforeCharacterId: LongCharacterIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("character.reorder"),
      group: LongCharacterGroupSchema,
      orderedIds: uniqueIdArray(LongCharacterIdSchema, "character reorder id")
    })
    .strict()
] as const;
