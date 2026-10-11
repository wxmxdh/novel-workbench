import { z } from "zod";

import {
  LongArcIdSchema,
  LongChapterCardIdSchema,
  LongCharacterIdSchema,
  LongEventConnectionIdSchema,
  LongFileIdSchema,
  LongForeshadowingBeatIdSchema,
  LongForeshadowingIdSchema,
  LongLedgerCommitIdSchema,
  LongMarkdownFileReferenceSchema,
  LongNarrativePlacementIdSchema,
  LongStoryEventIdSchema,
  LongStoryPlotIdSchema,
  LongVolumeIdSchema,
  longChapterCardFileId,
  longStoryPlotBodyFileId
} from "./ids";
import {
  LongShortTextSchema,
  LongTextSchema,
  LongTitleSchema
} from "./primitives";

export const LongVolumeSchema = z
  .object({
    id: LongVolumeIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    summary: LongTextSchema
  })
  .strict();
export type LongVolume = z.infer<typeof LongVolumeSchema>;

export const LongArcSchema = z
  .object({
    id: LongArcIdSchema,
    volumeId: LongVolumeIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    summary: LongTextSchema.optional(),
    outline: LongTextSchema
  })
  .strict();
export type LongArc = z.infer<typeof LongArcSchema>;

const UniqueCharacterReferenceListSchema = z
  .array(LongCharacterIdSchema)
  .max(1_024)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate character reference: ${value}`
        });
      }
      seen.add(value);
    });
  });

const UniqueArcReferenceListSchema = z
  .array(LongArcIdSchema)
  .max(1_024)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate arc reference: ${value}`
        });
      }
      seen.add(value);
    });
  });

/**
 * A chapter card under a volume. The card owns one Markdown body file
 * (`card.md` in the chapter directory) that holds the chapter plan text;
 * content is written through the plot-design write/edit tools, mirroring the
 * story-plot pattern. Legacy structured fields (outline / worldConstraints /
 * characterIds) were removed and are migrated into the card file at load time.
 */
export const LongChapterCardSchema = z
  .object({
    id: LongChapterCardIdSchema,
    volumeId: LongVolumeIdSchema,
    primaryArcId: LongArcIdSchema.nullable(),
    title: LongTitleSchema,
    narrativeOrder: z.number().int().positive(),
    /** Explicit author choice of this chapter's plan; never inferred from recency. */
    outlineSelection: z
      .object({
        sourceFileId: LongFileIdSchema,
        version: z.string().trim().min(1).max(256),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        status: z.enum(["current", "needs-recheck"]).optional(),
        selectedAt: z.string().datetime(),
        evidence: z.literal("author-explicit-selection")
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((chapter, context) => {
    if (
      chapter.outlineSelection &&
      chapter.outlineSelection.sourceFileId !==
        longChapterCardFileId(chapter.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outlineSelection", "sourceFileId"],
        message:
          "A chapter outline selection must reference that chapter's card.md file."
      });
    }
  });
export type LongChapterCard = z.infer<typeof LongChapterCardSchema>;

export const LongStoryTimeModeSchema = z.enum([
  "exact",
  "relative",
  "sequence",
  "unknown"
]);
export type LongStoryTimeMode = z.infer<typeof LongStoryTimeModeSchema>;

export const LongStoryEventSchema = z
  .object({
    id: LongStoryEventIdSchema,
    title: LongTitleSchema,
    summary: LongTextSchema,
    timeMode: LongStoryTimeModeSchema,
    timeLabel: z.string().max(1_000),
    /** Machine-sortable or source-specific time value kept separate from its display label. */
    timeValue: z.string().max(1_000).optional(),
    storyOrder: z.number().int().positive(),
    location: z.string().max(1_000),
    arcIds: UniqueArcReferenceListSchema,
    characterIds: UniqueCharacterReferenceListSchema
  })
  .strict();
export type LongStoryEvent = z.infer<typeof LongStoryEventSchema>;

/**
 * A story-plot beat under a plot point (arc). Each entry owns one Markdown body
 * file; the arc.outline field is retained only for legacy compatibility and is
 * no longer the UI editing surface for「故事情节」.
 */
export const LongStoryPlotSchema = z
  .object({
    id: LongStoryPlotIdSchema,
    arcId: LongArcIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    file: LongMarkdownFileReferenceSchema
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.file.id !== longStoryPlotBodyFileId(entry.id)) {
      context.addIssue({
        code: "custom",
        path: ["file", "id"],
        message:
          "Story-plot file id must match its stable story-plot id and body role."
      });
    }
  });
export type LongStoryPlot = z.infer<typeof LongStoryPlotSchema>;

export const LONG_EVENT_CONNECTION_TYPES = [
  "before",
  "same_time",
  "overlaps",
  "causes",
  "enables",
  "conceals"
] as const;
export const LongEventConnectionTypeSchema = z.enum(
  LONG_EVENT_CONNECTION_TYPES
);
export type LongEventConnectionType = z.infer<
  typeof LongEventConnectionTypeSchema
>;

export const LongEventConnectionSchema = z
  .object({
    id: LongEventConnectionIdSchema,
    sourceEventId: LongStoryEventIdSchema,
    targetEventId: LongStoryEventIdSchema,
    type: LongEventConnectionTypeSchema,
    note: LongShortTextSchema
  })
  .strict()
  .superRefine((connection, context) => {
    if (connection.sourceEventId === connection.targetEventId) {
      context.addIssue({
        code: "custom",
        path: ["targetEventId"],
        message: "Event connections cannot reference the same event twice."
      });
    }
  });
export type LongEventConnection = z.infer<typeof LongEventConnectionSchema>;

export const LONG_NARRATIVE_MODES = [
  "scene",
  "flashback",
  "retelling",
  "clue",
  "misdirection",
  "reveal",
  "dream",
  "prophecy"
] as const;
export const LongNarrativeModeSchema = z.enum(LONG_NARRATIVE_MODES);
export type LongNarrativeMode = z.infer<typeof LongNarrativeModeSchema>;

export const LongDisclosureLevelSchema = z.enum([
  "hint",
  "partial",
  "full",
  "false"
]);
export type LongDisclosureLevel = z.infer<typeof LongDisclosureLevelSchema>;

export const LongExecutionStatusSchema = z.enum([
  "planned",
  "written",
  "committed",
  "missed"
]);
export type LongExecutionStatus = z.infer<typeof LongExecutionStatusSchema>;

function validateExecutionCommit(
  value: { status: LongExecutionStatus; commitId: string | null },
  context: z.core.$RefinementCtx<unknown>
): void {
  const finalized = value.status === "committed" || value.status === "missed";
  if (finalized !== (value.commitId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["commitId"],
      message:
        "Only committed or missed execution records may reference a ledger commit."
    });
  }
}

export const LongNarrativePlacementSchema = z
  .object({
    id: LongNarrativePlacementIdSchema,
    eventId: LongStoryEventIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    orderInChapter: z.number().int().positive(),
    mode: LongNarrativeModeSchema,
    disclosure: LongDisclosureLevelSchema,
    writingPrompt: LongShortTextSchema,
    status: LongExecutionStatusSchema,
    commitId: LongLedgerCommitIdSchema.nullable()
  })
  .strict()
  .superRefine(validateExecutionCommit);
export type LongNarrativePlacement = z.infer<
  typeof LongNarrativePlacementSchema
>;

export const LONG_FORESHADOWING_BEAT_TYPES = [
  "source",
  "plant",
  "reinforce",
  "misdirect",
  "partial_reveal",
  "reveal",
  "payoff",
  "aftermath"
] as const;
export const LongForeshadowingBeatTypeSchema = z.enum(
  LONG_FORESHADOWING_BEAT_TYPES
);
export type LongForeshadowingBeatType = z.infer<
  typeof LongForeshadowingBeatTypeSchema
>;

export const LONG_FORESHADOWING_SPANS = [
  "local",
  "within_volume",
  "cross_volume"
] as const;
export const LongForeshadowingSpanSchema = z.enum(LONG_FORESHADOWING_SPANS);
export type LongForeshadowingSpan = z.infer<typeof LongForeshadowingSpanSchema>;

export const LongForeshadowingBeatSchema = z
  .object({
    id: LongForeshadowingBeatIdSchema,
    type: LongForeshadowingBeatTypeSchema,
    order: z.number().int().positive(),
    /**
     * Planning anchors are intentionally independent from chapter execution
     * anchors. A beat may first be assigned only to a volume, then refined to
     * a plot point before its concrete event/chapter placement is known.
     */
    volumeId: LongVolumeIdSchema.nullable().optional(),
    arcId: LongArcIdSchema.nullable().optional(),
    eventId: LongStoryEventIdSchema.nullable(),
    placementId: LongNarrativePlacementIdSchema.nullable(),
    chapterCardId: LongChapterCardIdSchema.nullable(),
    plannedScope: z.string().max(1_000),
    note: LongShortTextSchema,
    status: LongExecutionStatusSchema,
    commitId: LongLedgerCommitIdSchema.nullable()
  })
  .strict()
  .superRefine((beat, context) => {
    validateExecutionCommit(beat, context);
    if (
      beat.commitId !== null &&
      beat.chapterCardId === null &&
      beat.placementId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["chapterCardId"],
        message:
          "A finalized foreshadowing beat must resolve to a concrete chapter."
      });
    }
    if (
      beat.eventId === null &&
      beat.placementId === null &&
      beat.chapterCardId === null &&
      (beat.volumeId ?? null) === null &&
      (beat.arcId ?? null) === null &&
      beat.plannedScope.trim().length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["plannedScope"],
        message:
          "A foreshadowing beat must reference a planning/execution anchor or a planned scope."
      });
    }
  });
export type LongForeshadowingBeat = z.infer<typeof LongForeshadowingBeatSchema>;

export const LongForeshadowingStatusSchema = z.enum([
  "planned",
  "open",
  "progressing",
  "resolved",
  "abandoned"
]);
export type LongForeshadowingStatus = z.infer<
  typeof LongForeshadowingStatusSchema
>;

export function deriveLongForeshadowingStatusFromCommittedBeats(
  beats: ReadonlyArray<Pick<LongForeshadowingBeat, "status" | "type">>
): Exclude<LongForeshadowingStatus, "abandoned"> {
  const committedTypes = new Set(
    beats.filter(({ status }) => status === "committed").map(({ type }) => type)
  );
  if (committedTypes.has("reveal") || committedTypes.has("payoff")) {
    return "resolved";
  }
  if (
    committedTypes.has("reinforce") ||
    committedTypes.has("misdirect") ||
    committedTypes.has("partial_reveal")
  ) {
    return "progressing";
  }
  if (committedTypes.has("plant")) return "open";
  return "planned";
}

export const LongForeshadowingSchema = z
  .object({
    id: LongForeshadowingIdSchema,
    title: LongTitleSchema,
    coreQuestion: LongTextSchema,
    hiddenTruth: LongTextSchema.optional(),
    plannedSpan: LongForeshadowingSpanSchema.optional(),
    truthEventId: LongStoryEventIdSchema.nullable(),
    expectedReaderEffect: LongTextSchema,
    status: LongForeshadowingStatusSchema,
    beats: z.array(LongForeshadowingBeatSchema).max(10_000)
  })
  .strict();
export type LongForeshadowing = z.infer<typeof LongForeshadowingSchema>;

export const LongPlotIndexSchema = z
  .object({
    volumes: z.array(LongVolumeSchema).max(10_000),
    arcs: z.array(LongArcSchema).max(100_000),
    chapterCards: z.array(LongChapterCardSchema).max(100_000),
    storyEvents: z.array(LongStoryEventSchema).max(200_000),
    storyPlots: z.array(LongStoryPlotSchema).max(200_000).default([]),
    eventConnections: z.array(LongEventConnectionSchema).max(400_000),
    narrativePlacements: z.array(LongNarrativePlacementSchema).max(400_000),
    foreshadowing: z.array(LongForeshadowingSchema).max(100_000)
  })
  .strict();
export type LongPlotIndex = z.infer<typeof LongPlotIndexSchema>;
