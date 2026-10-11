import {
  LongLedgerCommitRecordSchema,
  type LongLedgerCommitRecord
} from "@deepwrite/contracts";

const LONG_LEDGER_ROLLBACK_KEYS = new Set([
  "previousCommittedThroughChapterId",
  "previousChapterCommitId",
  "fileChanges",
  "before",
  "longUndoBatch",
  "rollbackSnapshot",
  "rollbackSnapshots",
  "rollbackState",
  "undoBatch"
]);

export interface StrippedLongVersionMetadata {
  value: unknown;
  changed: boolean;
}

export interface StripLongVersionMetadataOptions {
  stripRollbackState?: boolean;
}

export interface NormalizedLongLedgerCommitRecord {
  record: LongLedgerCommitRecord;
  changed: boolean;
}

/**
 * Removes retired long-form revision and rollback metadata before strict
 * parsing. `schemaVersion` is deliberately retained because it identifies the
 * structural file format rather than a user-editable content version.
 */
export function stripLegacyLongVersionMetadata(
  value: unknown,
  options: StripLongVersionMetadataOptions = {}
): StrippedLongVersionMetadata {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const stripped = stripLegacyLongVersionMetadata(item, options);
      changed ||= stripped.changed;
      return stripped.value;
    });
    return { value: changed ? next : value, changed };
  }

  if (value === null || typeof value !== "object") {
    return { value, changed: false };
  }

  let changed = false;
  const entries: Array<[string, unknown]> = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "reversible" ||
      (key !== "schemaVersion" &&
        (key === "revision" ||
          key.endsWith("Revision") ||
          key.endsWith("Revisions"))) ||
      (options.stripRollbackState === true &&
        LONG_LEDGER_ROLLBACK_KEYS.has(key))
    ) {
      changed = true;
      continue;
    }
    const stripped = stripLegacyLongVersionMetadata(item, options);
    changed ||= stripped.changed;
    entries.push([key, stripped.value]);
  }
  return { value: changed ? Object.fromEntries(entries) : value, changed };
}

/**
 * Parses ledger JSON from disk or an external bundle after removing the
 * retired version and rollback shape. Keeping this compatibility boundary in
 * one place prevents lazy ledger reads from reintroducing strict-parse
 * failures after a project's manifest and index have already been cleaned.
 */
export function parseLongLedgerCommitRecord(
  value: unknown
): LongLedgerCommitRecord {
  return normalizeLongLedgerCommitRecord(value).record;
}

export function normalizeLongLedgerCommitRecord(
  value: unknown
): NormalizedLongLedgerCommitRecord {
  const stripped = stripLegacyLongVersionMetadata(value, {
    stripRollbackState: true
  });
  return {
    record: LongLedgerCommitRecordSchema.parse(stripped.value),
    changed: stripped.changed
  };
}
