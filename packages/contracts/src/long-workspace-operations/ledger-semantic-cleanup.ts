import type {
  LongContinuityHandoff,
  LongContinuityProjection
} from "../long-workspace";
import type {
  LongWorkspaceLedgerFactKey,
  LongWorkspaceLedgerKnowledgeKey
} from "./ledger-impact-schema";
import { LONG_WORKSPACE_DELETED_LATEST_HANDOFF_SUMMARY } from "./ledger-impact-schema";
import { createEmptyLedgerRecordEdit } from "./ledger-record-edit";
import type { MutationState } from "./state";

function factKey(
  fact: Pick<
    LongContinuityProjection["facts"][number],
    "domain" | "subjectId" | "field"
  >
): LongWorkspaceLedgerFactKey {
  return {
    domain: fact.domain,
    subjectId: fact.subjectId,
    field: fact.field
  };
}

function factKeyText(key: LongWorkspaceLedgerFactKey): string {
  return `${key.domain}\0${key.subjectId}\0${key.field}`;
}

function knowledgeKey(
  value: Pick<
    LongContinuityProjection["knowledge"][number],
    "factId" | "audienceType" | "audienceId"
  >
): LongWorkspaceLedgerKnowledgeKey {
  return {
    factId: value.factId,
    audienceType: value.audienceType,
    audienceId: value.audienceId
  };
}

function knowledgeKeyText(key: LongWorkspaceLedgerKnowledgeKey): string {
  return `${key.factId}\0${key.audienceType}\0${key.audienceId ?? ""}`;
}

function mergeSortedStrings(
  current: readonly string[],
  incoming: readonly string[]
): string[] {
  return [...new Set([...current, ...incoming])].sort();
}

function mergeSortedKeys<T>(
  current: readonly T[],
  incoming: readonly T[],
  keyOf: (value: T) => string
): T[] {
  return [
    ...new Map(
      [...current, ...incoming].map((value) => [keyOf(value), value])
    ).entries()
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

interface LedgerSemanticCleanup {
  removeSubjectIds: readonly string[];
  removeKnowledgeAudienceIds: readonly string[];
  removeFactIds: readonly string[];
  removeFactKeys: readonly LongWorkspaceLedgerFactKey[];
  removeKnowledgeKeys: readonly LongWorkspaceLedgerKnowledgeKey[];
  removeOpenLoopIds: readonly string[];
  replaceHandoffCommitId?: string;
  replaceHandoff?: LongContinuityHandoff;
}

function queueLedgerSemanticCleanup(
  state: MutationState,
  cleanup: LedgerSemanticCleanup
): void {
  const hasSemanticRemoval =
    cleanup.removeSubjectIds.length > 0 ||
    cleanup.removeKnowledgeAudienceIds.length > 0 ||
    cleanup.removeFactIds.length > 0 ||
    cleanup.removeFactKeys.length > 0 ||
    cleanup.removeKnowledgeKeys.length > 0 ||
    cleanup.removeOpenLoopIds.length > 0;
  if (!hasSemanticRemoval && cleanup.replaceHandoff === undefined) return;

  for (const commit of state.draft.ledger.commits) {
    const replacesThisHandoff =
      cleanup.replaceHandoff !== undefined &&
      commit.id === cleanup.replaceHandoffCommitId;
    if (!hasSemanticRemoval && !replacesThisHandoff) continue;
    commit.recordFile.updatedAt = state.updatedAt;
    const current =
      state.ledgerRecordEdits.get(commit.id) ??
      createEmptyLedgerRecordEdit(commit);
    current.recordFile = structuredClone(commit.recordFile);
    current.removeSubjectIds = mergeSortedStrings(
      current.removeSubjectIds,
      cleanup.removeSubjectIds
    );
    current.removeKnowledgeAudienceIds = mergeSortedStrings(
      current.removeKnowledgeAudienceIds,
      cleanup.removeKnowledgeAudienceIds
    );
    current.removeFactIds = mergeSortedStrings(
      current.removeFactIds,
      cleanup.removeFactIds
    );
    current.removeFactKeys = mergeSortedKeys(
      current.removeFactKeys,
      cleanup.removeFactKeys,
      factKeyText
    );
    current.removeKnowledgeKeys = mergeSortedKeys(
      current.removeKnowledgeKeys,
      cleanup.removeKnowledgeKeys,
      knowledgeKeyText
    );
    current.removeOpenLoopIds = mergeSortedStrings(
      current.removeOpenLoopIds,
      cleanup.removeOpenLoopIds
    );
    if (replacesThisHandoff) {
      current.replaceHandoff = structuredClone(cleanup.replaceHandoff);
    }
    state.ledgerRecordEdits.set(commit.id, current);
  }
}

export function cleanupProjectionForDeletedEntity(
  state: MutationState,
  entityId: string,
  options: { characterAudience?: boolean } = {}
): void {
  const projection = state.draft.ledger.projection;
  const removedFacts = projection.facts.filter(
    ({ subjectId }) => subjectId === entityId
  );
  const removedFactIds = new Set(removedFacts.map(({ factId }) => factId));
  const removedKnowledge = projection.knowledge.filter(
    (knowledge) =>
      removedFactIds.has(knowledge.factId) ||
      (options.characterAudience === true && knowledge.audienceId === entityId)
  );
  const removedKnowledgeKeys = new Set(
    removedKnowledge.map((entry) => knowledgeKeyText(knowledgeKey(entry)))
  );
  const removedLoops = projection.openLoops.filter(
    (loop) =>
      (loop.factId !== null && removedFactIds.has(loop.factId)) ||
      loop.subjectId === entityId
  );
  const removedLoopIds = new Set(removedLoops.map(({ loopId }) => loopId));

  projection.facts = projection.facts.filter(
    ({ factId }) => !removedFactIds.has(factId)
  );
  projection.knowledge = projection.knowledge.filter(
    (entry) => !removedKnowledgeKeys.has(knowledgeKeyText(knowledgeKey(entry)))
  );
  projection.openLoops = projection.openLoops.filter(
    ({ loopId }) => !removedLoopIds.has(loopId)
  );
  if (projection.latestHandoff) {
    projection.latestHandoff.openLoops =
      projection.latestHandoff.openLoops.filter(
        (loopId) => !removedLoopIds.has(loopId)
      );
  }

  queueLedgerSemanticCleanup(state, {
    removeSubjectIds: [entityId],
    removeKnowledgeAudienceIds:
      options.characterAudience === true ? [entityId] : [],
    removeFactIds: [...removedFactIds],
    removeFactKeys: removedFacts.map(factKey),
    removeKnowledgeKeys: removedKnowledge.map(knowledgeKey),
    removeOpenLoopIds: [...removedLoopIds]
  });
}

export function cleanupProjectionForDeletedCommit(
  state: MutationState,
  commitId: string
): void {
  const projection = state.draft.ledger.projection;
  const removedFacts = projection.facts.filter(
    ({ sourceCommitId }) => sourceCommitId === commitId
  );
  const removedFactIds = new Set(removedFacts.map(({ factId }) => factId));
  const removedKnowledge = projection.knowledge.filter(
    (knowledge) =>
      knowledge.sourceCommitId === commitId ||
      removedFactIds.has(knowledge.factId)
  );
  const removedKnowledgeKeys = new Set(
    removedKnowledge.map((entry) => knowledgeKeyText(knowledgeKey(entry)))
  );
  const removedLoops = projection.openLoops.filter(
    (loop) =>
      loop.sourceCommitId === commitId ||
      (loop.factId !== null && removedFactIds.has(loop.factId))
  );
  const removedLoopIds = new Set(removedLoops.map(({ loopId }) => loopId));

  projection.facts = projection.facts.filter(
    ({ sourceCommitId }) => sourceCommitId !== commitId
  );
  projection.knowledge = projection.knowledge.filter(
    (entry) => !removedKnowledgeKeys.has(knowledgeKeyText(knowledgeKey(entry)))
  );
  projection.openLoops = projection.openLoops.filter(
    ({ loopId }) => !removedLoopIds.has(loopId)
  );
  if (projection.latestHandoff) {
    projection.latestHandoff.openLoops =
      projection.latestHandoff.openLoops.filter(
        (loopId) => !removedLoopIds.has(loopId)
      );
  }

  let replaceHandoffCommitId: string | undefined;
  let replaceHandoff: LongContinuityHandoff | undefined;
  if (projection.throughCommitId === commitId) {
    const previousStructuredCommit = [...state.draft.ledger.commits]
      .filter(({ mode }) => mode === "structured")
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    if (previousStructuredCommit) {
      replaceHandoffCommitId = previousStructuredCommit.id;
      replaceHandoff = {
        summary: LONG_WORKSPACE_DELETED_LATEST_HANDOFF_SUMMARY,
        mustCarry: [],
        nextChapterConstraints: [],
        openLoops: [...(projection.latestHandoff?.openLoops ?? [])].sort()
      };
      projection.throughCommitId = previousStructuredCommit.id;
      projection.latestHandoff = {
        ...replaceHandoff,
        chapterCardId: previousStructuredCommit.chapterCardId,
        commitId: previousStructuredCommit.id
      };
    } else {
      projection.throughCommitId = null;
      projection.latestHandoff = null;
    }
  }

  queueLedgerSemanticCleanup(state, {
    removeSubjectIds: [],
    removeKnowledgeAudienceIds: [],
    removeFactIds: [...removedFactIds],
    removeFactKeys: removedFacts.map(factKey),
    removeKnowledgeKeys: removedKnowledge.map(knowledgeKey),
    removeOpenLoopIds: [...removedLoopIds],
    ...(replaceHandoffCommitId && replaceHandoff
      ? { replaceHandoffCommitId, replaceHandoff }
      : {})
  });
}
