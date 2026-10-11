import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { AgentRuntimeRefSchema } from "./session/runtime";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const ProjectRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-z]:/iu.test(value) &&
      !value.split(/[\\/]/u).includes(".."),
    "A project-relative path is required."
  );

export const LoveLocalRevisionPatchSchema = z
  .object({
    oldText: z
      .string()
      .min(1)
      .max(20_000)
      .refine((value) => value.trim().length > 0),
    newText: z.string().max(20_000),
    reason: z.string().trim().min(1).max(2_000),
    /** One-based occurrence for repeated source text. Omission requires uniqueness. */
    occurrence: z.number().int().positive().max(100_000).optional()
  })
  .strict();
export type LoveLocalRevisionPatch = z.infer<
  typeof LoveLocalRevisionPatchSchema
>;

export const LoveLocalRevisionAuthorEvidenceSchema = z
  .object({
    path: ProjectRelativePathSchema,
    sha256: Sha256Schema,
    quote: z.string().trim().min(1).max(2_000)
  })
  .strict();

export const LongPrepareLoveLocalRevisionInputSchema = z
  .object({
    bookId: z.literal("longbook_9a146bbe"),
    authorizationId: z.string().trim().min(16).max(128),
    comparisonPreparationId: z.string().trim().min(16).max(128),
    sourcePath: ProjectRelativePathSchema,
    sourceSha256: Sha256Schema
  })
  .strict();
export type LongPrepareLoveLocalRevisionInput = z.infer<
  typeof LongPrepareLoveLocalRevisionInputSchema
>;

export const LongPrepareLoveLocalRevisionResultSchema = z
  .object({
    bookId: z.literal("longbook_9a146bbe"),
    revisionPreparationId: z.string().trim().min(16).max(128),
    comparisonPreparationId: z.string().trim().min(16).max(128),
    sourcePath: ProjectRelativePathSchema,
    sourceSha256: Sha256Schema,
    sourceContent: z.string().min(1).max(200_000),
    readContent: z.string().min(1).max(800_000),
    chapter: z.number().int().positive().max(100_000),
    volume: z.string().trim().min(1).max(200),
    sourceModel: z.string().trim().min(1).max(200),
    sourceTitle: z.string().trim().min(1).max(200),
    authorRevisionEvidence: LoveLocalRevisionAuthorEvidenceSchema
  })
  .strict();
export type LongPrepareLoveLocalRevisionResult = z.infer<
  typeof LongPrepareLoveLocalRevisionResultSchema
>;

export const LongApplyLoveLocalRevisionInputSchema = z
  .object({
    bookId: z.literal("longbook_9a146bbe"),
    authorizationId: z.string().trim().min(16).max(128),
    revisionPreparationId: z.string().trim().min(16).max(128),
    patches: z.array(LoveLocalRevisionPatchSchema).min(1).max(100),
    action: z.enum(["preview", "deliver"]),
    authorRevisionEvidence: LoveLocalRevisionAuthorEvidenceSchema.optional(),
    runtime: AgentRuntimeRefSchema.optional()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === "deliver" && !input.authorRevisionEvidence) {
      context.addIssue({
        code: "custom",
        path: ["authorRevisionEvidence"],
        message: "Delivery requires explicit author revision authorization."
      });
    }
    if (input.action === "preview" && input.authorRevisionEvidence) {
      context.addIssue({
        code: "custom",
        path: ["authorRevisionEvidence"],
        message: "Preview cannot carry delivery authorization."
      });
    }
  });
export type LongApplyLoveLocalRevisionInput = z.infer<
  typeof LongApplyLoveLocalRevisionInputSchema
>;

export const LongApplyLoveLocalRevisionResultSchema = z
  .object({
    bookId: z.literal("longbook_9a146bbe"),
    revisionPreparationId: z.string().trim().min(16).max(128),
    action: z.enum(["preview", "deliver"]),
    sourcePath: ProjectRelativePathSchema,
    sourceSha256: Sha256Schema,
    previewContent: z.string().min(1).max(200_000),
    previewSha256: Sha256Schema,
    patches: z.array(LoveLocalRevisionPatchSchema).min(1).max(100),
    writes: z.number().int().min(0).max(1),
    path: ProjectRelativePathSchema.optional(),
    deliveryRecord: ProjectRelativePathSchema.optional(),
    outputSha256: Sha256Schema.optional(),
    model: z.string().trim().min(1).max(200).optional()
  })
  .strict()
  .superRefine((result, context) => {
    if (result.action === "preview" && result.writes !== 0) {
      context.addIssue({
        code: "custom",
        path: ["writes"],
        message: "Preview must not write files."
      });
    }
    if (
      result.action === "deliver" &&
      (result.writes !== 1 ||
        !result.path ||
        !result.deliveryRecord ||
        !result.outputSha256 ||
        !result.model)
    ) {
      context.addIssue({
        code: "custom",
        path: ["writes"],
        message: "Delivery must return its saved artifact and receipt."
      });
    }
  });
export type LongApplyLoveLocalRevisionResult = z.infer<
  typeof LongApplyLoveLocalRevisionResultSchema
>;

export const LongPrepareLoveLocalRevisionCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.prepareLoveLocalRevision"),
    payload: LongPrepareLoveLocalRevisionInputSchema
  });
export type LongPrepareLoveLocalRevisionCommandEnvelope = z.infer<
  typeof LongPrepareLoveLocalRevisionCommandEnvelopeSchema
>;

export const LongApplyLoveLocalRevisionCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.applyLoveLocalRevision"),
    payload: LongApplyLoveLocalRevisionInputSchema
  });
export type LongApplyLoveLocalRevisionCommandEnvelope = z.infer<
  typeof LongApplyLoveLocalRevisionCommandEnvelopeSchema
>;
