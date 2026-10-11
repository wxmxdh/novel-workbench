import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { OtterProjectIdSchema, OtterRelativePathSchema } from "./otter-context";
import { OtterProjectSchema } from "./otter-context";

const TitleSchema = z.string().trim().min(1).max(120);
const ContentSchema = z.string().trim().min(1).max(100_000);
export const OtterStudioDocumentSchema = z
  .object({
    id: z.string().min(1).max(2_000),
    path: OtterRelativePathSchema,
    title: z.string().max(500),
    category: z.enum([
      "entry",
      "canon",
      "character",
      "relationship",
      "timeline",
      "workflow",
      "writing-support",
      "plan",
      "draft",
      "annotation",
      "concept",
      "world",
      "map",
      "protocol"
    ]),
    status: z.string().max(200),
    kind: z.string().max(200).optional(),
    volume: z.string().max(500).optional(),
    chapter: z.string().max(500).optional(),
    model: z.string().max(500).optional(),
    outline: z.string().max(500).optional(),
    revision: z.string().max(500).optional(),
    version: z.string().max(500).optional(),
    workbench: z.string().max(200).optional(),
    revisionOf: OtterRelativePathSchema.optional(),
    readOnly: z.literal(true)
  })
  .strict();
export const OtterStorySpaceInputSchema = z
  .object({ projectId: OtterProjectIdSchema })
  .strict();
export const OtterStorySpaceSchema = z
  .object({
    project: OtterProjectSchema,
    people: z.array(OtterStudioDocumentSchema).max(20_000),
    relationships: z.array(OtterStudioDocumentSchema).max(20_000),
    concepts: z.array(OtterStudioDocumentSchema).max(20_000),
    world: z.array(OtterStudioDocumentSchema).max(20_000),
    maps: z
      .array(
        z
          .object({
            document: OtterStudioDocumentSchema,
            previewDataUrl: z.string().max(750_000).nullable()
          })
          .strict()
      )
      .max(20_000),
    documents: z.array(OtterStudioDocumentSchema).max(20_000)
  })
  .strict();
export const OtterCreateProjectInputSchema = z
  .object({ title: TitleSchema })
  .strict();
export const OtterCreateProjectResultSchema = z
  .object({
    projectId: OtterProjectIdSchema,
    relativePath: OtterRelativePathSchema,
    title: TitleSchema
  })
  .strict();
export const OtterSaveIdeaInputSchema = z
  .object({
    projectId: OtterProjectIdSchema,
    title: TitleSchema,
    content: ContentSchema,
    relatedPaths: z.array(OtterRelativePathSchema).max(100).optional()
  })
  .strict();
export const OtterSaveIdeaResultSchema = z
  .object({
    path: OtterRelativePathSchema,
    title: TitleSchema,
    status: z.literal("candidate"),
    hash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();
export const OtterMapImportInputSchema = z
  .object({ projectId: OtterProjectIdSchema, title: TitleSchema.optional() })
  .strict();
export const OtterMapImportResultSchema = z
  .object({
    path: OtterRelativePathSchema,
    title: TitleSchema,
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    bytes: z.number().int().positive().max(10_000_000),
    dataUrl: z
      .string()
      .max(750_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
  })
  .strict();
export const OtterReadingContextInputSchema = z
  .object({ savedProjectId: OtterProjectIdSchema.optional() })
  .strict();
export const OtterReadingContextCandidateSchema = z
  .object({
    projectId: OtterProjectIdSchema.nullable(),
    projectRelativePath: OtterRelativePathSchema.nullable(),
    projectTitle: z.string().max(500),
    volume: z.string().max(200).nullable(),
    chapter: z.string().max(200).nullable(),
    activeDocumentPath: OtterRelativePathSchema.nullable(),
    annotationEntryPath: OtterRelativePathSchema.nullable()
  })
  .strict();
export const OtterReadingContextSchema = z
  .object({
    current: z
      .object({
        projectId: OtterProjectIdSchema.nullable(),
        projectRelativePath: OtterRelativePathSchema.nullable(),
        volume: z.string().max(200).nullable(),
        chapter: z.string().max(200).nullable(),
        activeDocumentPath: OtterRelativePathSchema.nullable(),
        annotationEntryPath: OtterRelativePathSchema.nullable(),
        conflict: z.boolean()
      })
      .strict(),
    candidates: z.array(OtterReadingContextCandidateSchema).max(100)
  })
  .strict();

export const OtterStudioCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.storySpace"),
    payload: OtterStorySpaceInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.createProject"),
    payload: OtterCreateProjectInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.saveConcept"),
    payload: OtterSaveIdeaInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.saveWorldNote"),
    payload: OtterSaveIdeaInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.saveMapNote"),
    payload: OtterSaveIdeaInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.importMap"),
    payload: OtterMapImportInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.readingContext"),
    payload: OtterReadingContextInputSchema
  })
] as const;

export interface OtterStudioApi {
  storySpace(
    input: z.infer<typeof OtterStorySpaceInputSchema>
  ): Promise<z.infer<typeof OtterStorySpaceSchema>>;
  createProject(
    input: z.infer<typeof OtterCreateProjectInputSchema>
  ): Promise<z.infer<typeof OtterCreateProjectResultSchema>>;
  saveConcept(
    input: z.infer<typeof OtterSaveIdeaInputSchema>
  ): Promise<z.infer<typeof OtterSaveIdeaResultSchema>>;
  saveWorldNote(
    input: z.infer<typeof OtterSaveIdeaInputSchema>
  ): Promise<z.infer<typeof OtterSaveIdeaResultSchema>>;
  saveMapNote(
    input: z.infer<typeof OtterSaveIdeaInputSchema>
  ): Promise<z.infer<typeof OtterSaveIdeaResultSchema>>;
  importMap(
    input: z.infer<typeof OtterMapImportInputSchema>
  ): Promise<z.infer<typeof OtterMapImportResultSchema> | null>;
  readingContext(
    input?: z.infer<typeof OtterReadingContextInputSchema>
  ): Promise<z.infer<typeof OtterReadingContextSchema>>;
}

export type OtterStorySpaceInput = z.infer<typeof OtterStorySpaceInputSchema>;
export type OtterCreateProjectInput = z.infer<
  typeof OtterCreateProjectInputSchema
>;
export type OtterSaveIdeaInput = z.infer<typeof OtterSaveIdeaInputSchema>;
export type OtterMapImportInput = z.infer<typeof OtterMapImportInputSchema>;
export type OtterReadingContextInput = z.infer<
  typeof OtterReadingContextInputSchema
>;
