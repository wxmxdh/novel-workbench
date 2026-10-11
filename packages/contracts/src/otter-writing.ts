import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { OtterProjectIdSchema, OtterRelativePathSchema } from "./otter-context";

const OtterProjectDocumentPathSchema = OtterRelativePathSchema.refine(
  (path) => !/^workspace:/i.test(path),
  "A project-local document path is required."
);

/** Author-entered candidates, separate from verified V1 model deliveries. */
export const OtterSaveWritingInputSchema = z
  .object({
    projectId: OtterProjectIdSchema,
    title: z.string().trim().min(1).max(120),
    kind: z.enum(["outline", "draft"]),
    content: z
      .string()
      .min(1)
      .max(100_000)
      .refine(
        (value) => value.trim().length > 0,
        "Writing content cannot be blank."
      ),
    volume: z.string().trim().min(1).max(200),
    chapter: z.number().int().min(1).max(100_000),
    model: z.string().trim().min(1).max(200),
    version: z.string().trim().min(1).max(120),
    mode: z.enum(["candidate", "work"]).default("candidate"),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    outline: OtterProjectDocumentPathSchema.optional(),
    revisionOf: OtterProjectDocumentPathSchema.optional()
  })
  .strict();
export const OtterSaveWritingResultSchema = z
  .object({
    path: OtterRelativePathSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["author-candidate", "author-work-draft"]),
    deduplicated: z.boolean()
  })
  .strict();
export const OtterWritingCommandSchema = EnvelopeBaseSchema.extend({
  type: z.literal("otter.saveWriting"),
  payload: OtterSaveWritingInputSchema
});
export const OtterSelectWritingInputSchema = z
  .object({
    projectId: OtterProjectIdSchema,
    path: OtterProjectDocumentPathSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    action: z.enum(["reference", "important"]).default("reference")
  })
  .strict();
export const OtterSelectWritingResultSchema = z
  .object({
    selected: z.literal(true),
    path: OtterProjectDocumentPathSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["current-reference-candidate", "important-checkpoint"])
  })
  .strict();
export const OtterSelectWritingCommandSchema = EnvelopeBaseSchema.extend({
  type: z.literal("otter.selectWriting"),
  payload: OtterSelectWritingInputSchema
});
export const OtterWritingCommandSchemas = [
  OtterWritingCommandSchema,
  OtterSelectWritingCommandSchema
] as const;
export type OtterSaveWritingInput = z.infer<typeof OtterSaveWritingInputSchema>;
export type OtterSelectWritingInput = z.infer<
  typeof OtterSelectWritingInputSchema
>;
export interface OtterWritingApi {
  saveWriting(
    input: OtterSaveWritingInput
  ): Promise<z.infer<typeof OtterSaveWritingResultSchema>>;
  selectWriting(
    input: OtterSelectWritingInput
  ): Promise<z.infer<typeof OtterSelectWritingResultSchema>>;
}
