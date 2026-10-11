import { z } from "zod";
import { ReviewSkillIdsSchema } from "./review-skills";
import { EnvelopeBaseSchema } from "./envelope";
import { AgentRuntimeRefSchema } from "./session/runtime";

export const LOVE_REVIEW_SPECIALIST_IDS = [
  "love-outline",
  "love-life",
  "love-character",
  "love-viewpoint",
  "love-expression",
  "love-continuity",
  "love-research"
] as const;
export const LOVE_REVIEW_INDEPENDENT_ID = "love-intent";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/u);
const path = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !/^(?:[a-z]:|[\\/])/iu.test(value) &&
      !value.split(/[\\/]/u).some((part) => part === ".." || part === "."),
    "Only project-relative review paths are accepted."
  );
export const LoveReviewPhaseSchema = z.enum([
  "specialist",
  "summary",
  "independent"
]);
export const LoveReviewCoverageSchema = z
  .object({
    reviewId: id,
    targetSetSha256: hash,
    state: z.enum(["incomplete", "needs_independent_review", "ready", "stale"]),
    expectedCount: z.number().int().min(1).max(10),
    completedCount: z.number().int().min(0).max(10),
    missingReviewerIds: z.array(id).max(10),
    phase: LoveReviewPhaseSchema,
    independentFindingCount: z.number().int().min(0).max(100).optional(),
    summaryCorrectionAttempted: z.boolean().optional()
  })
  .strict();
export type LoveReviewCoverage = z.infer<typeof LoveReviewCoverageSchema>;

export const LoveReviewFindingSchema = z
  .object({
    id,
    category: z.enum([
      "conflict",
      "reality-check",
      "literary-suggestion",
      "author-preference",
      "uncertain"
    ]),
    scope: z.string().min(1).max(1_000),
    issue: z.string().min(1).max(4_000),
    sourceId: id,
    quote: z.string().min(1).max(4_000),
    suggestion: z.string().min(1).max(4_000).optional(),
    skillIds: ReviewSkillIdsSchema.optional(),
    reportId: id.optional()
  })
  .strict();
export const LoveReviewReportSchema = z
  .object({
    status: z.enum(["reviewed", "incomplete"]),
    summary: z.string().min(1).max(80_000),
    findings: z.array(LoveReviewFindingSchema).max(100),
    missingSources: z.array(z.string().min(1).max(1_000)).max(100),
    reviewedSourceIds: z.array(id).max(80)
  })
  .strict();
export type LoveReviewReport = z.infer<typeof LoveReviewReportSchema>;
export const LoveReviewSourceSchema = z
  .object({
    id,
    path: z.string().min(1).max(1_000),
    role: z.string().min(1).max(100),
    sha256: hash,
    content: z.string().min(1).max(500_000)
  })
  .strict();
export const LoveReviewTargetSchema = LoveReviewSourceSchema.extend({
  version: z.string().min(1).max(120),
  model: z.string().min(1).max(160).optional()
});
export const LoveReviewSubmissionSchema = z
  .object({
    reviewerId: id,
    phase: LoveReviewPhaseSchema,
    report: LoveReviewReportSchema,
    runtime: AgentRuntimeRefSchema
  })
  .strict();
export const LoveReviewSnapshotSchema = z
  .object({
    reviewId: id,
    bookId: z.literal("longbook_9a146bbe"),
    chapter: z.number().int().positive(),
    volume: z.string().min(1).max(200),
    targetKind: z.enum(["drafts", "chapter_card", "chapter_body"]),
    reviewerIds: z.array(id).min(1).max(10),
    authorText: z.string().min(1).max(20_000),
    targets: z.array(LoveReviewTargetSchema).min(1).max(10),
    sources: z.array(LoveReviewSourceSchema).min(1).max(30),
    targetSetSha256: hash,
    sourceSetSha256: hash,
    reports: z.array(LoveReviewSubmissionSchema).max(30),
    coverage: LoveReviewCoverageSchema
  })
  .strict();
export type LoveReviewSnapshot = z.infer<typeof LoveReviewSnapshotSchema>;

export const LongPrepareLoveReviewInputSchema = z
  .object({
    bookId: z.literal("longbook_9a146bbe"),
    reviewId: id.optional(),
    resumeLatest: z.boolean().optional(),
    chapter: z.number().int().min(1).max(100_000).optional(),
    volume: z.string().min(1).max(200).optional(),
    targetKind: z
      .enum(["drafts", "chapter_card", "chapter_body"])
      .default("drafts"),
    targetPaths: z.array(path).min(1).max(10).optional(),
    reviewerIds: z.array(id).min(1).max(10),
    authorText: z.string().min(1).max(20_000)
  })
  .strict()
  .refine(
    (value) =>
      !(value.reviewId && value.resumeLatest) &&
      (!value.resumeLatest ||
        (value.chapter !== undefined && Boolean(value.volume?.trim()))),
    {
      message:
        "resumeLatest requires chapter and volume and cannot be combined with reviewId."
    }
  );
export type LongPrepareLoveReviewInput = z.infer<
  typeof LongPrepareLoveReviewInputSchema
>;
export const LongSubmitLoveReviewInputSchema =
  LoveReviewSubmissionSchema.extend({
    bookId: z.literal("longbook_9a146bbe"),
    reviewId: id,
    targetSetSha256: hash
  }).strict();
export type LongSubmitLoveReviewInput = z.infer<
  typeof LongSubmitLoveReviewInputSchema
>;
export const LongPrepareLoveReviewCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.prepareLoveReview"),
    payload: LongPrepareLoveReviewInputSchema
  });
export const LongSubmitLoveReviewCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.submitLoveReview"),
    payload: LongSubmitLoveReviewInputSchema
  });
export type LongPrepareLoveReviewCommandEnvelope = z.infer<
  typeof LongPrepareLoveReviewCommandEnvelopeSchema
>;
export type LongSubmitLoveReviewCommandEnvelope = z.infer<
  typeof LongSubmitLoveReviewCommandEnvelopeSchema
>;
