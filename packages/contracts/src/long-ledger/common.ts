import { z } from "zod";

import {
  LongContinuityAudienceTypeSchema,
  LongContinuityDomainSchema,
  LongContinuityFactFieldSchema,
  LongContinuityFactIdSchema,
  LongContinuityFactSchema,
  LongContinuityHandoffSchema,
  LongContinuityKnowledgeLevelSchema,
  LongContinuityKnowledgeSchema,
  LongContinuityOpenLoopIdSchema,
  LongContinuityOpenLoopKindSchema,
  LongContinuityOpenLoopSchema,
  LongContinuityOpenLoopStatusSchema,
  LongExecutionStatusSchema,
  LongFileIdSchema,
  LongForeshadowingBeatIdSchema,
  LongForeshadowingIdSchema,
  LongForeshadowingStatusSchema,
  LongLedgerCommitIdSchema,
  LongNarrativePlacementIdSchema,
  LongProjectRelativePathSchema,
  LongStableIdSchema
} from "../long-workspace";

export const LedgerTimestampSchema = z.string().datetime();
export const LedgerContentSchema = z.string().max(16 * 1024 * 1024);
export const LedgerCommitMessageSchema = z.string().trim().max(4_000);
export const LedgerSummaryTextSchema = z.string().trim().max(200_000);
export const LedgerEvidenceNoteSchema = z.string().trim().max(4_000);
export const RequiredLedgerCommitMessageSchema =
  LedgerCommitMessageSchema.min(1);
export const RequiredLedgerSummaryTextSchema = LedgerSummaryTextSchema.min(1);
export const RequiredLedgerEvidenceNoteSchema = LedgerEvidenceNoteSchema.min(1);

export const LongChapterSummarySchema = z
  .object({
    timeline: LedgerSummaryTextSchema,
    characterStates: LedgerSummaryTextSchema,
    factionStates: LedgerSummaryTextSchema,
    realmStates: LedgerSummaryTextSchema,
    foreshadowingStates: LedgerSummaryTextSchema,
    continuityNotes: LedgerSummaryTextSchema
  })
  .strict();
export type LongChapterSummary = z.infer<typeof LongChapterSummarySchema>;

export const EMPTY_LONG_CHAPTER_SUMMARY: LongChapterSummary = {
  timeline: "",
  characterStates: "",
  factionStates: "",
  realmStates: "",
  foreshadowingStates: "",
  continuityNotes: ""
};

export const LongRequiredChapterSummarySchema = z
  .object({
    timeline: RequiredLedgerSummaryTextSchema,
    characterStates: RequiredLedgerSummaryTextSchema,
    factionStates: RequiredLedgerSummaryTextSchema,
    realmStates: RequiredLedgerSummaryTextSchema,
    foreshadowingStates: RequiredLedgerSummaryTextSchema,
    continuityNotes: RequiredLedgerSummaryTextSchema
  })
  .strict();

export const LongLedgerExecutionDecisionSchema = z
  .object({
    status: LongExecutionStatusSchema,
    commitId: LongLedgerCommitIdSchema.nullable()
  })
  .strict();
export type LongLedgerExecutionDecision = z.infer<
  typeof LongLedgerExecutionDecisionSchema
>;

export const LongLedgerPlacementChangeSchema = z
  .object({
    placementId: LongNarrativePlacementIdSchema,
    after: LongLedgerExecutionDecisionSchema,
    note: LedgerEvidenceNoteSchema.default("")
  })
  .strict();
export type LongLedgerPlacementChange = z.infer<
  typeof LongLedgerPlacementChangeSchema
>;

export const LongLedgerForeshadowingBeatChangeSchema = z
  .object({
    foreshadowingId: LongForeshadowingIdSchema.optional(),
    beatId: LongForeshadowingBeatIdSchema,
    after: LongLedgerExecutionDecisionSchema,
    note: LedgerEvidenceNoteSchema.default("")
  })
  .strict();
export type LongLedgerForeshadowingBeatChange = z.infer<
  typeof LongLedgerForeshadowingBeatChangeSchema
>;

export const LongLedgerForeshadowingThreadChangeSchema = z
  .object({
    foreshadowingId: LongForeshadowingIdSchema,
    after: LongForeshadowingStatusSchema
  })
  .strict();
export type LongLedgerForeshadowingThreadChange = z.infer<
  typeof LongLedgerForeshadowingThreadChangeSchema
>;

export const LongLedgerContinuityFileAuditSchema = z
  .object({
    fileId: LongFileIdSchema,
    path: LongProjectRelativePathSchema
  })
  .strict();
export type LongLedgerContinuityFileAudit = z.infer<
  typeof LongLedgerContinuityFileAuditSchema
>;

export const LongLedgerContinuityFilesAuditSchema = z
  .array(LongLedgerContinuityFileAuditSchema)
  .max(100_000)
  .superRefine((files, context) => {
    const fileIds = new Set<string>();
    const paths = new Set<string>();
    files.forEach((file, index) => {
      if (fileIds.has(file.fileId)) {
        context.addIssue({
          code: "custom",
          path: [index, "fileId"],
          message: "A continuity audit cannot contain the same file twice."
        });
      }
      fileIds.add(file.fileId);
      const portablePath = file.path
        .normalize("NFC")
        .toLocaleLowerCase("en-US");
      if (paths.has(portablePath)) {
        context.addIssue({
          code: "custom",
          path: [index, "path"],
          message:
            "A continuity audit cannot contain duplicate portable file paths."
        });
      }
      paths.add(portablePath);
    });
  });
export type LongLedgerContinuityFilesAudit = z.infer<
  typeof LongLedgerContinuityFilesAuditSchema
>;

export const LongLedgerCoverageStatusSchema = z.enum([
  "changed",
  "unchanged",
  "not_applicable"
]);
export type LongLedgerCoverageStatus = z.infer<
  typeof LongLedgerCoverageStatusSchema
>;

export const LongLedgerCoverageItemSchema = z
  .object({
    status: LongLedgerCoverageStatusSchema,
    note: LedgerEvidenceNoteSchema
  })
  .strict();
export type LongLedgerCoverageItem = z.infer<
  typeof LongLedgerCoverageItemSchema
>;

export const LongRequiredLedgerCoverageItemSchema = z
  .object({
    status: LongLedgerCoverageStatusSchema,
    note: RequiredLedgerEvidenceNoteSchema
  })
  .strict();

export const LongLedgerCoverageSchema = z
  .object({
    character: LongLedgerCoverageItemSchema,
    plot: LongLedgerCoverageItemSchema,
    foreshadowing: LongLedgerCoverageItemSchema,
    world: LongLedgerCoverageItemSchema,
    knowledge: LongLedgerCoverageItemSchema,
    openLoops: LongLedgerCoverageItemSchema
  })
  .strict();
export type LongLedgerCoverage = z.infer<typeof LongLedgerCoverageSchema>;

export const LongRequiredLedgerCoverageSchema = z
  .object({
    character: LongRequiredLedgerCoverageItemSchema,
    plot: LongRequiredLedgerCoverageItemSchema,
    foreshadowing: LongRequiredLedgerCoverageItemSchema,
    world: LongRequiredLedgerCoverageItemSchema,
    knowledge: LongRequiredLedgerCoverageItemSchema,
    openLoops: LongRequiredLedgerCoverageItemSchema
  })
  .strict();

export const EMPTY_LONG_LEDGER_COVERAGE: LongLedgerCoverage = {
  character: { status: "not_applicable", note: "" },
  plot: { status: "not_applicable", note: "" },
  foreshadowing: { status: "not_applicable", note: "" },
  world: { status: "not_applicable", note: "" },
  knowledge: { status: "not_applicable", note: "" },
  openLoops: { status: "not_applicable", note: "" }
};

const EmptyLongContinuityHandoffSchema = z
  .object({
    summary: z.literal(""),
    mustCarry: z.array(z.never()).max(0),
    nextChapterConstraints: z.array(z.never()).max(0),
    openLoops: z.array(z.never()).max(0)
  })
  .strict();

export const LongLedgerChapterOutputsSchema = z
  .object({
    characterState: LedgerSummaryTextSchema,
    handoff: z.union([
      LongContinuityHandoffSchema,
      EmptyLongContinuityHandoffSchema
    ])
  })
  .strict();
export type LongLedgerChapterOutputs = z.infer<
  typeof LongLedgerChapterOutputsSchema
>;

export const LongRequiredLedgerChapterOutputsSchema = z
  .object({
    characterState: RequiredLedgerSummaryTextSchema,
    handoff: LongContinuityHandoffSchema
  })
  .strict();
export type LongRequiredLedgerChapterOutputs = z.infer<
  typeof LongRequiredLedgerChapterOutputsSchema
>;

export const EMPTY_LONG_LEDGER_CHAPTER_OUTPUTS: LongLedgerChapterOutputs = {
  characterState: "",
  handoff: {
    summary: "",
    mustCarry: [],
    nextChapterConstraints: [],
    openLoops: []
  }
};

export const LongLedgerFactMutationSchema = z
  .object({
    factId: LongContinuityFactIdSchema,
    domain: LongContinuityDomainSchema,
    subjectId: LongStableIdSchema,
    field: LongContinuityFactFieldSchema,
    value: RequiredLedgerSummaryTextSchema,
    evidence: RequiredLedgerEvidenceNoteSchema
  })
  .strict();
export type LongLedgerFactMutation = z.infer<
  typeof LongLedgerFactMutationSchema
>;

export const LongLedgerKnowledgeMutationSchema = z
  .object({
    factId: LongContinuityFactIdSchema,
    audienceType: LongContinuityAudienceTypeSchema,
    audienceId: LongStableIdSchema.nullable(),
    level: LongContinuityKnowledgeLevelSchema,
    evidence: RequiredLedgerEvidenceNoteSchema
  })
  .strict()
  .superRefine((mutation, context) => {
    if (
      (mutation.audienceType === "reader") !==
      (mutation.audienceId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["audienceId"],
        message:
          "Reader knowledge must use a null audience id; character and faction knowledge require one."
      });
    }
    if (
      mutation.audienceType === "character" &&
      !mutation.audienceId?.startsWith("character_")
    ) {
      context.addIssue({
        code: "custom",
        path: ["audienceId"],
        message: "Character knowledge requires a stable character id."
      });
    }
  });
export type LongLedgerKnowledgeMutation = z.infer<
  typeof LongLedgerKnowledgeMutationSchema
>;

export const LongLedgerOpenLoopMutationSchema = z
  .object({
    loopId: LongContinuityOpenLoopIdSchema,
    kind: LongContinuityOpenLoopKindSchema,
    status: LongContinuityOpenLoopStatusSchema,
    detail: RequiredLedgerSummaryTextSchema,
    subjectId: LongStableIdSchema.nullable().default(null),
    factId: LongContinuityFactIdSchema.nullable().default(null),
    evidence: RequiredLedgerEvidenceNoteSchema
  })
  .strict();
export type LongLedgerOpenLoopMutation = z.infer<
  typeof LongLedgerOpenLoopMutationSchema
>;

export const LongLedgerFactChangeSchema = z
  .object({ after: LongContinuityFactSchema })
  .strict();
export type LongLedgerFactChange = z.infer<typeof LongLedgerFactChangeSchema>;

export const LongLedgerKnowledgeChangeSchema = z
  .object({ after: LongContinuityKnowledgeSchema })
  .strict();
export type LongLedgerKnowledgeChange = z.infer<
  typeof LongLedgerKnowledgeChangeSchema
>;

export const LongLedgerOpenLoopChangeSchema = z
  .object({ after: LongContinuityOpenLoopSchema })
  .strict();
export type LongLedgerOpenLoopChange = z.infer<
  typeof LongLedgerOpenLoopChangeSchema
>;
