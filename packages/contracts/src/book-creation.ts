import { EnvelopeBaseSchema } from "./envelope";
import { z } from "zod";
/** Build creation inputs with the catalog's existing schema instances. */
export function createBookCreationSchema<
  CharacterFormat extends z.ZodType,
  StageId extends z.ZodType,
  MaterialLinks extends z.ZodType,
  SkillLinks extends z.ZodType,
  Genre extends z.ZodType
>(
  schemas: {
    title: z.ZodString;
    characterFormat: CharacterFormat;
    stageId: StageId;
    stageLimit: number;
    materialLinks: MaterialLinks;
    skillLinks: SkillLinks;
  },
  genre: Genre
) {
  const defaultPlotStageIds = z
    .array(schemas.stageId)
    .min(1)
    .max(schemas.stageLimit)
    .refine((ids) => new Set(ids).size === ids.length, "剧情阶段不能重复");
  const shape = {
    title: schemas.title,
    characterFormat: schemas.characterFormat.optional(),
    defaultPlotStageIds: defaultPlotStageIds.optional(),
    linkedMaterialIdsByKind: schemas.materialLinks.optional(),
    linkedSkillIdsByKind: schemas.skillLinks.optional()
  };
  return z.object({ ...shape, genre });
}

/** Keep nested command schema construction out of the Renderer startup graph. */
export function createBookCreationEnvelope<
  Type extends string,
  Payload extends z.ZodType
>(type: Type, payload: Payload) {
  return EnvelopeBaseSchema.extend({ type: z.literal(type), payload });
}
export function createBookAtPathSchema<Input extends z.ZodType>(input: Input) {
  return z.object({ parentDirectory: z.string().trim().min(1), input });
}
