import { z } from "zod";

export const SHORT_MATERIAL_KINDS = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other"
] as const;
export const ShortMaterialKindSchema = z.enum(SHORT_MATERIAL_KINDS);
export type ShortMaterialKind = z.infer<typeof ShortMaterialKindSchema>;

export const SHORT_SKILL_KINDS = ["general", "plot", "style", "other"] as const;
export const ShortSkillKindSchema = z.enum(SHORT_SKILL_KINDS);
export type ShortSkillKind = z.infer<typeof ShortSkillKindSchema>;

const UniqueShortMaterialKindsSchema = z
  .array(ShortMaterialKindSchema)
  .max(SHORT_MATERIAL_KINDS.length)
  .superRefine((values, context) => {
    values.forEach((value, index) => {
      if (values.indexOf(value) !== index) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate material kind: ${value}`
        });
      }
    });
  });

const UniqueShortSkillKindsSchema = z
  .array(ShortSkillKindSchema)
  .max(SHORT_SKILL_KINDS.length)
  .superRefine((values, context) => {
    values.forEach((value, index) => {
      if (values.indexOf(value) !== index) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate skill kind: ${value}`
        });
      }
    });
  });

export const ShortAgentReadAccessSchema = z
  .object({
    material: UniqueShortMaterialKindsSchema,
    skill: UniqueShortSkillKindsSchema
  })
  .strict();
export type ShortAgentReadAccess = z.infer<typeof ShortAgentReadAccessSchema>;

export const DEFAULT_SHORT_AGENT_READ_ACCESS: Record<
  "short",
  ShortAgentReadAccess
> = {
  short: {
    material: ["character", "gimmick", "plot", "draft", "other"],
    skill: ["general", "plot", "style", "other"]
  }
};

export const DEFAULT_SHORT_WORKSPACE_AGENT_READ_ACCESS =
  DEFAULT_SHORT_AGENT_READ_ACCESS;
