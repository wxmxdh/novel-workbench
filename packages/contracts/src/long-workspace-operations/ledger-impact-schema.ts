import { z } from "zod";
import {
  LongContinuityAudienceTypeSchema,
  LongContinuityDomainSchema,
  LongContinuityFactFieldSchema,
  LongContinuityFactIdSchema,
  LongContinuityHandoffSchema,
  LongContinuityOpenLoopIdSchema,
  LongForeshadowingBeatIdSchema,
  LongForeshadowingIdSchema,
  LongLedgerCommitIdSchema,
  LongNarrativePlacementIdSchema,
  LongStableIdSchema,
  LongWorkspaceFileReferenceSchema,
  longLedgerCommitFileId
} from "../long-workspace";
import { sortedUniqueIdArray } from "./schema-helpers";

/**
 * Reserved handoff summary written only when deletion moves the continuity
 * projection watermark onto a legacy v2 record. Portable replay recognizes
 * this exact value instead of treating arbitrary v2 handoff text as typed
 * continuity state.
 */
export const LONG_WORKSPACE_DELETED_LATEST_HANDOFF_SUMMARY =
  "最近一次连续性归档已删除，请依据当前剩余记录继续创作。";

export const LongWorkspaceLedgerFactKeySchema = z
  .object({
    domain: LongContinuityDomainSchema,
    subjectId: LongStableIdSchema,
    field: LongContinuityFactFieldSchema
  })
  .strict();
export type LongWorkspaceLedgerFactKey = z.infer<
  typeof LongWorkspaceLedgerFactKeySchema
>;

export const LongWorkspaceLedgerKnowledgeKeySchema = z
  .object({
    factId: LongContinuityFactIdSchema,
    audienceType: LongContinuityAudienceTypeSchema,
    audienceId: LongStableIdSchema.nullable()
  })
  .strict();
export type LongWorkspaceLedgerKnowledgeKey = z.infer<
  typeof LongWorkspaceLedgerKnowledgeKeySchema
>;

function sortedUniqueSemanticKeyArray<T>(
  schema: z.ZodType<T>,
  keyOf: (value: T) => string
) {
  return z.array(schema).superRefine((values, context) => {
    let previous: string | undefined;
    values.forEach((value, index) => {
      const key = keyOf(value);
      if (previous !== undefined && previous >= key) {
        context.addIssue({
          code: "custom",
          path: [index],
          message:
            previous === key
              ? `Duplicate semantic cleanup key: ${key}`
              : "Semantic cleanup keys must be sorted."
        });
      }
      previous = key;
    });
  });
}

const LongWorkspaceLedgerFactKeyListSchema = sortedUniqueSemanticKeyArray(
  LongWorkspaceLedgerFactKeySchema,
  ({ domain, subjectId, field }) => `${domain}\0${subjectId}\0${field}`
);
const LongWorkspaceLedgerKnowledgeKeyListSchema = sortedUniqueSemanticKeyArray(
  LongWorkspaceLedgerKnowledgeKeySchema,
  ({ factId, audienceType, audienceId }) =>
    `${factId}\0${audienceType}\0${audienceId ?? ""}`
);

export const LongWorkspaceLedgerRecordEditSchema = z
  .object({
    commitId: LongLedgerCommitIdSchema,
    recordFile: LongWorkspaceFileReferenceSchema,
    removePlacementIds: sortedUniqueIdArray(LongNarrativePlacementIdSchema),
    removeForeshadowingBeatIds: sortedUniqueIdArray(
      LongForeshadowingBeatIdSchema
    ),
    reconcileForeshadowingThreadIds: sortedUniqueIdArray(
      LongForeshadowingIdSchema
    ),
    removeSubjectIds: sortedUniqueIdArray(LongStableIdSchema),
    removeKnowledgeAudienceIds: sortedUniqueIdArray(LongStableIdSchema),
    removeFactIds: sortedUniqueIdArray(LongContinuityFactIdSchema),
    removeFactKeys: LongWorkspaceLedgerFactKeyListSchema,
    removeKnowledgeKeys: LongWorkspaceLedgerKnowledgeKeyListSchema,
    removeOpenLoopIds: sortedUniqueIdArray(LongContinuityOpenLoopIdSchema),
    replaceHandoff: LongContinuityHandoffSchema.optional()
  })
  .strict()
  .superRefine((edit, context) => {
    if (
      edit.removePlacementIds.length === 0 &&
      edit.removeForeshadowingBeatIds.length === 0 &&
      edit.removeSubjectIds.length === 0 &&
      edit.removeKnowledgeAudienceIds.length === 0 &&
      edit.removeFactIds.length === 0 &&
      edit.removeFactKeys.length === 0 &&
      edit.removeKnowledgeKeys.length === 0 &&
      edit.removeOpenLoopIds.length === 0 &&
      edit.replaceHandoff === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "A ledger record edit must remove at least one decision."
      });
    }
    if (edit.recordFile.id !== longLedgerCommitFileId(edit.commitId)) {
      context.addIssue({
        code: "custom",
        path: ["recordFile", "id"],
        message: "A ledger record edit file must match its stable commit id."
      });
    }
  });
export type LongWorkspaceLedgerRecordEdit = z.infer<
  typeof LongWorkspaceLedgerRecordEditSchema
>;
