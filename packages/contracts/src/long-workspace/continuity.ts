import { z } from "zod";

import {
  LongChapterBodyStatusSchema,
  LongChapterCardIdSchema,
  LongCharacterIdSchema,
  LongContinuityFactIdSchema,
  LongContinuityOpenLoopIdSchema,
  LongLedgerCommitIdSchema,
  LongMarkdownFileReferenceSchema,
  LongStableIdSchema,
  createEmptyLongMarkdownFileReference,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterContinuityFilePath,
  longChapterCharacterCurrentStateFileId,
  longChapterCharacterHistoryFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longChapterWorldRevealsFileId
} from "./ids";
import { LongLedgerCommitIndexEntrySchema } from "./ledger-index-entry";
export {
  LongLedgerCommitIndexEntrySchema,
  longLedgerCommitChapterIds,
  longLedgerCommitCheckpointChapterId,
  longLedgerCommitContainsChapter,
  type LongLedgerCommitIndexEntry
} from "./ledger-index-entry";

export const LongChapterCharacterContinuityFileIndexEntrySchema = z
  .object({
    characterId: LongCharacterIdSchema,
    currentState: LongMarkdownFileReferenceSchema,
    history: LongMarkdownFileReferenceSchema
  })
  .strict();
export type LongChapterCharacterContinuityFileIndexEntry = z.infer<
  typeof LongChapterCharacterContinuityFileIndexEntrySchema
>;

const LongChapterFileIndexEntryObjectSchema = z
  .object({
    chapterCardId: LongChapterCardIdSchema,
    body: LongMarkdownFileReferenceSchema,
    card: LongMarkdownFileReferenceSchema,
    characterState: LongMarkdownFileReferenceSchema,
    handoff: LongMarkdownFileReferenceSchema,
    foreshadowingChanges: LongMarkdownFileReferenceSchema.optional(),
    worldReveals: LongMarkdownFileReferenceSchema.nullable().default(null),
    characterContinuity: z
      .array(LongChapterCharacterContinuityFileIndexEntrySchema)
      .max(100_000)
      .default([]),
    bodyStatus: LongChapterBodyStatusSchema.optional(),
    bodyEvidenceStatus: z
      .enum(["current", "needs-review", "unknown"])
      .optional(),
    commitId: LongLedgerCommitIdSchema.nullable()
  })
  .strict();

export const LongChapterFileIndexEntrySchema =
  LongChapterFileIndexEntryObjectSchema.transform((entry) => ({
    ...entry,
    bodyStatus: entry.bodyStatus ?? "empty",
    foreshadowingChanges:
      entry.foreshadowingChanges ??
      createEmptyLongMarkdownFileReference(
        longChapterForeshadowingChangesFileId(entry.chapterCardId),
        longChapterContinuityFilePath(
          entry.chapterCardId,
          "foreshadowing-changes.md"
        ),
        entry.body.updatedAt
      )
  })).superRefine((entry, context) => {
    const files = [entry.body, entry.card, entry.characterState, entry.handoff];
    const expectedIds = [
      longChapterBodyFileId(entry.chapterCardId),
      longChapterCardFileId(entry.chapterCardId),
      longChapterCharacterStateFileId(entry.chapterCardId),
      longChapterHandoffFileId(entry.chapterCardId)
    ];
    const fields = ["body", "card", "characterState", "handoff"] as const;
    files.forEach((file, index) => {
      if (file.id !== expectedIds[index]) {
        context.addIssue({
          code: "custom",
          path: [fields[index]!, "id"],
          message:
            "Chapter file id must match its stable chapter-card id and role."
        });
      }
    });

    if (
      entry.foreshadowingChanges.id !==
      longChapterForeshadowingChangesFileId(entry.chapterCardId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingChanges", "id"],
        message:
          "Foreshadowing changes file id must match its stable chapter-card id."
      });
    }
    if (
      entry.foreshadowingChanges.path !==
      longChapterContinuityFilePath(
        entry.chapterCardId,
        "foreshadowing-changes.md"
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["foreshadowingChanges", "path"],
        message: "Foreshadowing changes must use the chapter continuity path."
      });
    }
    if (entry.worldReveals) {
      if (
        entry.worldReveals.id !==
        longChapterWorldRevealsFileId(entry.chapterCardId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["worldReveals", "id"],
          message:
            "World reveals file id must match its stable chapter-card id."
        });
      }
      if (
        entry.worldReveals.path !==
        longChapterContinuityFilePath(entry.chapterCardId, "world-reveals.md")
      ) {
        context.addIssue({
          code: "custom",
          path: ["worldReveals", "path"],
          message: "World reveals must use the chapter continuity path."
        });
      }
    }

    const characterIds = new Set<string>();
    entry.characterContinuity.forEach((character, index) => {
      if (characterIds.has(character.characterId)) {
        context.addIssue({
          code: "custom",
          path: ["characterContinuity", index, "characterId"],
          message:
            "Chapter character continuity entries must have unique character ids."
        });
      }
      characterIds.add(character.characterId);
      const expectedCurrentStateId = longChapterCharacterCurrentStateFileId(
        entry.chapterCardId,
        character.characterId
      );
      const expectedHistoryId = longChapterCharacterHistoryFileId(
        entry.chapterCardId,
        character.characterId
      );
      const expectedCurrentStatePath = longChapterCharacterContinuityFilePath(
        entry.chapterCardId,
        character.characterId,
        "current-state.md"
      );
      const expectedHistoryPath = longChapterCharacterContinuityFilePath(
        entry.chapterCardId,
        character.characterId,
        "history.md"
      );
      if (character.currentState.id !== expectedCurrentStateId) {
        context.addIssue({
          code: "custom",
          path: ["characterContinuity", index, "currentState", "id"],
          message:
            "Character current-state file id must match its chapter and character ids."
        });
      }
      if (character.currentState.path !== expectedCurrentStatePath) {
        context.addIssue({
          code: "custom",
          path: ["characterContinuity", index, "currentState", "path"],
          message:
            "Character current-state must use the chapter continuity path."
        });
      }
      if (character.history.id !== expectedHistoryId) {
        context.addIssue({
          code: "custom",
          path: ["characterContinuity", index, "history", "id"],
          message:
            "Character history file id must match its chapter and character ids."
        });
      }
      if (character.history.path !== expectedHistoryPath) {
        context.addIssue({
          code: "custom",
          path: ["characterContinuity", index, "history", "path"],
          message: "Character history must use the chapter continuity path."
        });
      }
    });
  });
export type LongChapterFileIndexEntry = z.infer<
  typeof LongChapterFileIndexEntrySchema
>;

export const LONG_CONTINUITY_DOMAINS = [
  "character",
  "relationship",
  "world",
  "plot",
  "foreshadowing"
] as const;
export const LongContinuityDomainSchema = z.enum(LONG_CONTINUITY_DOMAINS);
export type LongContinuityDomain = z.infer<typeof LongContinuityDomainSchema>;

export const LongContinuityFactFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\r\n\0]/u.test(value), {
    message: "Continuity fact fields must use one safe line."
  });
export type LongContinuityFactField = z.infer<
  typeof LongContinuityFactFieldSchema
>;

const LongContinuityEvidenceSchema = z.string().trim().min(1).max(4_000);
const LongContinuityFactValueSchema = z.string().trim().min(1).max(200_000);

export const LongContinuityFactSchema = z
  .object({
    factId: LongContinuityFactIdSchema,
    domain: LongContinuityDomainSchema,
    subjectId: LongStableIdSchema,
    field: LongContinuityFactFieldSchema,
    value: LongContinuityFactValueSchema,
    sourceCommitId: LongLedgerCommitIdSchema,
    sourceChapterCardId: LongChapterCardIdSchema,
    evidence: LongContinuityEvidenceSchema
  })
  .strict();
export type LongContinuityFact = z.infer<typeof LongContinuityFactSchema>;

function continuityFactKey(
  value: Pick<LongContinuityFact, "domain" | "subjectId" | "field">
): string {
  return `${value.domain}\0${value.subjectId}\0${value.field.normalize("NFC")}`;
}

export const LongContinuityFactListSchema = z
  .array(LongContinuityFactSchema)
  .max(200_000)
  .superRefine((facts, context) => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    facts.forEach((fact, index) => {
      if (ids.has(fact.factId)) {
        context.addIssue({
          code: "custom",
          path: [index, "factId"],
          message: `Duplicate continuity fact id: ${fact.factId}`
        });
      }
      ids.add(fact.factId);
      const key = continuityFactKey(fact);
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index, "field"],
          message:
            "Continuity facts must be unique by domain, subject id and field."
        });
      }
      keys.add(key);
    });
  });

export const LONG_CONTINUITY_AUDIENCE_TYPES = [
  "reader",
  "character",
  "faction"
] as const;
export const LongContinuityAudienceTypeSchema = z.enum(
  LONG_CONTINUITY_AUDIENCE_TYPES
);
export type LongContinuityAudienceType = z.infer<
  typeof LongContinuityAudienceTypeSchema
>;

export const LONG_CONTINUITY_KNOWLEDGE_LEVELS = [
  "unknown",
  "suspects",
  "believes",
  "knows",
  "misled"
] as const;
export const LongContinuityKnowledgeLevelSchema = z.enum(
  LONG_CONTINUITY_KNOWLEDGE_LEVELS
);
export type LongContinuityKnowledgeLevel = z.infer<
  typeof LongContinuityKnowledgeLevelSchema
>;

export const LongContinuityKnowledgeSchema = z
  .object({
    factId: LongContinuityFactIdSchema,
    audienceType: LongContinuityAudienceTypeSchema,
    audienceId: LongStableIdSchema.nullable(),
    level: LongContinuityKnowledgeLevelSchema,
    sourceCommitId: LongLedgerCommitIdSchema,
    sourceChapterCardId: LongChapterCardIdSchema,
    evidence: LongContinuityEvidenceSchema
  })
  .strict()
  .superRefine((knowledge, context) => {
    if (
      (knowledge.audienceType === "reader") !==
      (knowledge.audienceId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["audienceId"],
        message:
          "Reader knowledge must use a null audience id; character and faction knowledge require one."
      });
    }
    if (
      knowledge.audienceType === "character" &&
      !knowledge.audienceId?.startsWith("character_")
    ) {
      context.addIssue({
        code: "custom",
        path: ["audienceId"],
        message: "Character knowledge requires a stable character id."
      });
    }
  });
export type LongContinuityKnowledge = z.infer<
  typeof LongContinuityKnowledgeSchema
>;

function continuityKnowledgeKey(
  value: Pick<LongContinuityKnowledge, "factId" | "audienceType" | "audienceId">
): string {
  return `${value.factId}\0${value.audienceType}\0${value.audienceId ?? ""}`;
}

export const LongContinuityKnowledgeListSchema = z
  .array(LongContinuityKnowledgeSchema)
  .max(400_000)
  .superRefine((entries, context) => {
    const keys = new Set<string>();
    entries.forEach((entry, index) => {
      const key = continuityKnowledgeKey(entry);
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Continuity knowledge must be unique by fact and audience."
        });
      }
      keys.add(key);
    });
  });

export const LONG_CONTINUITY_OPEN_LOOP_KINDS = [
  "character",
  "relationship",
  "world",
  "plot",
  "foreshadowing",
  "knowledge",
  "continuity"
] as const;
export const LongContinuityOpenLoopKindSchema = z.enum(
  LONG_CONTINUITY_OPEN_LOOP_KINDS
);
export type LongContinuityOpenLoopKind = z.infer<
  typeof LongContinuityOpenLoopKindSchema
>;

export const LONG_CONTINUITY_OPEN_LOOP_STATUSES = [
  "open",
  "progressing",
  "resolved",
  "abandoned"
] as const;
export const LongContinuityOpenLoopStatusSchema = z.enum(
  LONG_CONTINUITY_OPEN_LOOP_STATUSES
);
export type LongContinuityOpenLoopStatus = z.infer<
  typeof LongContinuityOpenLoopStatusSchema
>;

export const LongContinuityOpenLoopSchema = z
  .object({
    loopId: LongContinuityOpenLoopIdSchema,
    kind: LongContinuityOpenLoopKindSchema,
    status: LongContinuityOpenLoopStatusSchema,
    detail: z.string().trim().min(1).max(200_000),
    subjectId: LongStableIdSchema.nullable(),
    factId: LongContinuityFactIdSchema.nullable(),
    sourceCommitId: LongLedgerCommitIdSchema,
    sourceChapterCardId: LongChapterCardIdSchema,
    evidence: LongContinuityEvidenceSchema
  })
  .strict();
export type LongContinuityOpenLoop = z.infer<
  typeof LongContinuityOpenLoopSchema
>;

export const LongContinuityOpenLoopListSchema = z
  .array(LongContinuityOpenLoopSchema)
  .max(200_000)
  .superRefine((loops, context) => {
    const ids = new Set<string>();
    loops.forEach((loop, index) => {
      if (ids.has(loop.loopId)) {
        context.addIssue({
          code: "custom",
          path: [index, "loopId"],
          message: `Duplicate continuity open-loop id: ${loop.loopId}`
        });
      }
      ids.add(loop.loopId);
    });
  });

const UniqueContinuityTextListSchema = z
  .array(z.string().trim().min(1).max(4_000))
  .max(1_024)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const key = value.normalize("NFC");
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Continuity handoff lists cannot contain duplicates."
        });
      }
      seen.add(key);
    });
  });

const UniqueContinuityOpenLoopIdListSchema = z
  .array(LongContinuityOpenLoopIdSchema)
  .max(100_000)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate continuity open-loop reference: ${value}`
        });
      }
      seen.add(value);
    });
  });

export const LongContinuityHandoffSchema = z
  .object({
    summary: z.string().trim().min(1).max(200_000),
    mustCarry: UniqueContinuityTextListSchema,
    nextChapterConstraints: UniqueContinuityTextListSchema,
    openLoops: UniqueContinuityOpenLoopIdListSchema
  })
  .strict();
export type LongContinuityHandoff = z.infer<typeof LongContinuityHandoffSchema>;

export const LongContinuityLatestHandoffSchema =
  LongContinuityHandoffSchema.extend({
    chapterCardId: LongChapterCardIdSchema,
    commitId: LongLedgerCommitIdSchema
  });
export type LongContinuityLatestHandoff = z.infer<
  typeof LongContinuityLatestHandoffSchema
>;

export const LongContinuityProjectionSchema = z
  .object({
    throughCommitId: LongLedgerCommitIdSchema.nullable(),
    facts: LongContinuityFactListSchema,
    knowledge: LongContinuityKnowledgeListSchema,
    openLoops: LongContinuityOpenLoopListSchema,
    latestHandoff: LongContinuityLatestHandoffSchema.nullable()
  })
  .strict()
  .superRefine((projection, context) => {
    const factIds = new Set(projection.facts.map(({ factId }) => factId));
    projection.knowledge.forEach((knowledge, index) => {
      if (!factIds.has(knowledge.factId)) {
        context.addIssue({
          code: "custom",
          path: ["knowledge", index, "factId"],
          message: "Continuity knowledge must reference a projected fact."
        });
      }
    });
    const loopIds = new Set(projection.openLoops.map(({ loopId }) => loopId));
    projection.latestHandoff?.openLoops.forEach((loopId, index) => {
      if (!loopIds.has(loopId)) {
        context.addIssue({
          code: "custom",
          path: ["latestHandoff", "openLoops", index],
          message:
            "The latest continuity handoff must reference a projected open loop."
        });
      }
    });
    if (
      projection.latestHandoff &&
      projection.latestHandoff.commitId !== projection.throughCommitId
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestHandoff", "commitId"],
        message:
          "The latest handoff commit must match the projection watermark."
      });
    }
  });
export type LongContinuityProjection = z.infer<
  typeof LongContinuityProjectionSchema
>;

export const EMPTY_LONG_CONTINUITY_PROJECTION: LongContinuityProjection = {
  throughCommitId: null,
  facts: [],
  knowledge: [],
  openLoops: [],
  latestHandoff: null
};

export const LongLedgerCommitIndexSchema = z
  .object({
    committedThroughChapterId: LongChapterCardIdSchema.nullable(),
    commits: z.array(LongLedgerCommitIndexEntrySchema).max(100_000),
    projection: LongContinuityProjectionSchema.default(
      EMPTY_LONG_CONTINUITY_PROJECTION
    )
  })
  .strict();
export type LongLedgerCommitIndex = z.infer<typeof LongLedgerCommitIndexSchema>;
