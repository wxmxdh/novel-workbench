import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { LongChapterCardIdSchema, LongVolumeIdSchema } from "./long-workspace";
import { AgentRuntimeRefSchema } from "./session/runtime";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-z]:/i.test(value) &&
      !value.split(/[\\/]/u).includes(".."),
    "A project-relative path is required."
  );

const ComparisonDraftAuthorRequestSchema = z
  .object({
    requestId: z.string().trim().min(1).max(200),
    exactText: z.string().trim().min(1).max(20_000),
    authorizationQuote: z.string().trim().min(1).max(200),
    receivedAt: z.string().datetime()
  })
  .strict();

export const ComparisonDraftWriterContextSchema = z
  .object({
    authorizationId: z.string().trim().min(16).max(128),
    priorAuthorizationId: z.string().trim().min(16).max(128).optional(),
    priorAuthorTextSha256: Sha256Schema.optional(),
    bookId: z.literal("longbook_9a146bbe"),
    chapter: z.number().int().min(1).max(100_000),
    chapterCardId: LongChapterCardIdSchema,
    sourceMode: z.enum(["independent", "redraft"]).optional(),
    writers: z
      .array(
        z
          .object({
            definitionId: z.string().regex(/^love-writer-[a-z0-9-]+$/u),
            runtime: AgentRuntimeRefSchema
          })
          .strict()
      )
      .min(1)
      .max(5),
    authorRequest: ComparisonDraftAuthorRequestSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.priorAuthorizationId === undefined) !==
      (value.priorAuthorTextSha256 === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: [
          value.priorAuthorizationId === undefined
            ? "priorAuthorizationId"
            : "priorAuthorTextSha256"
        ],
        message: "Prior authorization lineage fields must be provided together."
      });
    }
  });
export type ComparisonDraftWriterContext = z.infer<
  typeof ComparisonDraftWriterContextSchema
>;

export const LongPrepareComparisonDraftInputSchema = z
  .object({
    bookId: z.literal("longbook_9a146bbe"),
    authorizationId: z.string().trim().min(16).max(128),
    chapter: z.number().int().min(1).max(100_000),
    chapterCardId: LongChapterCardIdSchema,
    authorRequestId: z.string().trim().min(1).max(200),
    authorRequest: ComparisonDraftAuthorRequestSchema,
    sourceMode: z.enum(["independent", "redraft"]).optional(),
    chapterCardSha256: Sha256Schema,
    volumeId: LongVolumeIdSchema,
    volumeSha256: Sha256Schema
  })
  .strict();
export type LongPrepareComparisonDraftInput = z.infer<
  typeof LongPrepareComparisonDraftInputSchema
>;

export const LongPrepareComparisonDraftResultSchema = z
  .object({
    preparationId: z.string().trim().min(16).max(128),
    bookId: z.literal("longbook_9a146bbe"),
    chapter: z.number().int().positive(),
    chapterCardId: LongChapterCardIdSchema,
    chapterCardSha256: Sha256Schema,
    chapterCardContent: z.string().max(500_000),
    volumeId: LongVolumeIdSchema,
    selectedOutline: z
      .object({
        path: RelativePathSchema,
        sha256: Sha256Schema,
        version: z.string().trim().min(1).max(120),
        content: z.string().min(1).max(500_000),
        selectionEvidence: z
          .object({
            path: RelativePathSchema,
            sha256: Sha256Schema,
            quote: z.string().trim().min(1).max(2_000)
          })
          .strict()
      })
      .strict(),
    volume: z
      .object({
        label: z.string().trim().min(1).max(200),
        content: z.string().max(50_000),
        evidence: z
          .object({
            path: RelativePathSchema,
            sha256: Sha256Schema,
            quote: z.string().trim().min(1).max(2_000)
          })
          .strict()
      })
      .strict(),
    readEvidence: z
      .array(
        z
          .object({
            path: RelativePathSchema,
            sha256: Sha256Schema,
            role: z.enum(["outline", "chapter-card", "volume-evidence"])
          })
          .strict()
      )
      .min(3)
      .max(8),
    preparedAt: z.string().datetime(),
    contextReadContent: z.string().min(1).max(2_000_000)
  })
  .strict();
export type LongPrepareComparisonDraftResult = z.infer<
  typeof LongPrepareComparisonDraftResultSchema
>;

export const LongDeliverComparisonDraftInputSchema = z
  .object({
    bookId: z.literal("longbook_9a146bbe"),
    authorizationId: z.string().trim().min(16).max(128),
    preparationId: z.string().trim().min(16).max(128),
    definitionId: z.string().regex(/^love-writer-[a-z0-9-]+$/u),
    runtime: AgentRuntimeRefSchema,
    content: z.string().trim().min(1).max(200_000),
    title: z.string().trim().min(1).max(200).optional()
  })
  .strict();
export type LongDeliverComparisonDraftInput = z.infer<
  typeof LongDeliverComparisonDraftInputSchema
>;

export const LongDeliverComparisonDraftResultSchema = z
  .object({
    bookId: z.literal("longbook_9a146bbe"),
    preparationId: z.string().trim().min(16).max(128),
    path: RelativePathSchema,
    sha256: Sha256Schema,
    model: z.string().trim().min(1).max(200),
    status: z.literal("待审阅"),
    deliveryRecord: RelativePathSchema,
    nativeVersion: z.object({ path: RelativePathSchema, hash: Sha256Schema, deduplicated: z.boolean() }).strict().optional(),
    nativeVersionWarning: z.string().trim().min(1).max(1000).optional()
  })
  .strict();
export type LongDeliverComparisonDraftResult = z.infer<
  typeof LongDeliverComparisonDraftResultSchema
>;

export const LongPrepareComparisonDraftCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.prepareComparisonDraft"),
    payload: LongPrepareComparisonDraftInputSchema
  });
export type LongPrepareComparisonDraftCommandEnvelope = z.infer<
  typeof LongPrepareComparisonDraftCommandEnvelopeSchema
>;

export const LongDeliverComparisonDraftCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.deliverComparisonDraft"),
    payload: LongDeliverComparisonDraftInputSchema
  });
export type LongDeliverComparisonDraftCommandEnvelope = z.infer<
  typeof LongDeliverComparisonDraftCommandEnvelopeSchema
>;
