import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  LongBookIdSchema,
  LongChapterCardIdSchema,
  LongFileIdSchema
} from "./long-workspace";

const identity = z.string().trim().min(1).max(200);
export const WorkbenchSourceSchema = z
  .object({
    fileId: LongFileIdSchema,
    title: z.string(),
    path: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    content: z.string().max(100_000)
  })
  .strict();
export const WorkbenchPreparedSchema = z
  .object({
    id: identity,
    bookId: LongBookIdSchema,
    title: z.string(),
    indexUpdatedAt: z.string(),
    chapterCardId: LongChapterCardIdSchema.optional(),
    sources: z.array(WorkbenchSourceSchema).max(32),
    agentsMd: z.string(),
    createdAt: z.string()
  })
  .strict();
export const WorkbenchTaskSchema = z
  .object({
    id: identity,
    bookId: LongBookIdSchema,
    preparedId: identity,
    requestKey: identity,
    modelId: identity,
    actualModel: z.string(),
    purpose: z.enum(["brainstorm", "review", "organize"]),
    status: z.enum([
      "running",
      "completed",
      "failed",
      "cancelled",
      "interrupted"
    ]),
    prompt: z.string().max(20_000),
    content: z.string().max(200_000),
    error: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    sessionId: identity,
    runId: identity.optional(),
    sources: z.array(WorkbenchSourceSchema.omit({ content: true })).max(32),
    savedSource: z
      .object({ fileId: LongFileIdSchema, path: z.string() })
      .strict()
      .optional()
  })
  .strict();
export const WorkbenchRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("capabilities") }).strict(),
  z
    .object({
      operation: z.literal("prepare"),
      bookId: LongBookIdSchema,
      chapterCardId: LongChapterCardIdSchema.optional(),
      fileIds: z.array(LongFileIdSchema).max(24).optional()
    })
    .strict(),
  z
    .object({
      operation: z.literal("start"),
      preparedId: identity,
      requestKey: identity,
      modelId: identity,
      prompt: z.string().trim().min(1).max(20_000),
      purpose: z.enum(["brainstorm", "review", "organize"])
    })
    .strict(),
  z
    .object({
      operation: z.enum(["get", "cancel", "saveCandidate"]),
      taskId: identity,
      bookId: LongBookIdSchema
    })
    .strict()
]);
export const WorkbenchResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("capabilities"),
      books: z.array(z.object({ id: LongBookIdSchema, title: z.string() })),
      models: z.array(
        z.object({ id: identity, title: z.string(), model: z.string() })
      ),
      endpointFile: z.string(),
      maxConcurrent: z.literal(3)
    })
    .strict(),
  z
    .object({ kind: z.literal("prepared"), prepared: WorkbenchPreparedSchema })
    .strict(),
  z.object({ kind: z.literal("task"), task: WorkbenchTaskSchema }).strict()
]);
export const WorkbenchRequestCommandSchema = EnvelopeBaseSchema.extend({
  type: z.literal("workbenchCollaboration.request"),
  payload: WorkbenchRequestSchema
});
export type WorkbenchRequest = z.infer<typeof WorkbenchRequestSchema>;
export type WorkbenchResponse = z.infer<typeof WorkbenchResponseSchema>;
export type WorkbenchPrepared = z.infer<typeof WorkbenchPreparedSchema>;
export type WorkbenchTask = z.infer<typeof WorkbenchTaskSchema>;
export interface WorkbenchCollaborationApi {
  request(input: WorkbenchRequest): Promise<WorkbenchResponse>;
}
