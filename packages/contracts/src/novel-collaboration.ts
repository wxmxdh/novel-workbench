import { z } from "zod";

const VersionedSourceSchema = z
  .object({
    bookId: z.string().trim().min(1).max(120),
    fileId: z.string().trim().min(1).max(160),
    path: z.string().trim().min(1).max(1_024),
    updatedAt: z.string().datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();
export type VersionedNovelSource = z.infer<typeof VersionedSourceSchema>;

export const NovelRequirementKindSchema = z.enum([
  "must-appear",
  "must-preserve",
  "background",
  "exploration"
]);
export type NovelRequirementKind = z.infer<typeof NovelRequirementKindSchema>;

export const NovelRequirementEvidenceSchema = z
  .object({
    source: VersionedSourceSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(2_000),
    explanation: z.string().trim().min(1).max(2_000)
  })
  .strict()
  .refine((value) => value.end > value.start, {
    path: ["end"],
    message: "Evidence end must be after start."
  });
export type NovelRequirementEvidence = z.infer<
  typeof NovelRequirementEvidenceSchema
>;

export const NovelRequirementCheckSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    requirement: z.string().trim().min(1).max(2_000),
    kind: NovelRequirementKindSchema,
    status: z.enum(["supported", "missing", "uncertain"]),
    evidence: z.array(NovelRequirementEvidenceSchema).max(20),
    note: z.string().trim().max(2_000).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "supported" && value.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "A supported requirement needs quoted source evidence."
      });
    }
  });
export type NovelRequirementCheck = z.infer<typeof NovelRequirementCheckSchema>;

export const NovelRequirementReviewSchema = z
  .object({
    bookId: z.string().trim().min(1).max(120),
    chapterCardId: z.string().trim().min(1).max(160),
    checkedAt: z.string().datetime(),
    sources: z.array(VersionedSourceSchema).min(1).max(20),
    checks: z.array(NovelRequirementCheckSchema).max(200)
  })
  .strict()
  .superRefine((value, context) => {
    const sourceKeys = new Set(
      value.sources.map((source) => `${source.bookId}\u0000${source.fileId}`)
    );
    for (const [index, check] of value.checks.entries()) {
      for (const [evidenceIndex, evidence] of check.evidence.entries()) {
        const key = `${evidence.source.bookId}\u0000${evidence.source.fileId}`;
        if (!sourceKeys.has(key)) {
          context.addIssue({
            code: "custom",
            path: ["checks", index, "evidence", evidenceIndex, "source"],
            message: "Evidence must refer to a source in this review."
          });
        }
      }
    }
  });
export type NovelRequirementReview = z.infer<
  typeof NovelRequirementReviewSchema
>;

export const NovelPlotCandidateSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(100_000),
    sourceRunId: z.string().trim().min(1).max(160).optional(),
    createdAt: z.string().datetime()
  })
  .strict();
export type NovelPlotCandidate = z.infer<typeof NovelPlotCandidateSchema>;

export const NovelPlotCandidateSetSchema = z
  .object({
    bookId: z.string().trim().min(1).max(120),
    chapterCardId: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(8_000),
    sources: z.array(VersionedSourceSchema).max(20),
    outlineSelection: z
      .object({
        version: z.string().trim().min(1).max(256),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        status: z.enum(["current", "needs-recheck"]).optional()
      })
      .strict()
      .optional(),
    candidates: z.array(NovelPlotCandidateSchema).min(1).max(8)
  })
  .strict();
export type NovelPlotCandidateSet = z.infer<typeof NovelPlotCandidateSetSchema>;
