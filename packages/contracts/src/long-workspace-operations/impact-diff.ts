import type { LongWorkspaceIndexSnapshot } from "../long-workspace";
import type {
  LongWorkspaceEntityChange,
  LongWorkspaceEntityKind,
  LongWorkspaceEntitySnapshot,
  LongWorkspaceRelationshipChange,
  LongWorkspaceRelationshipKind
} from "./impact-schema";
import type { MutationState } from "./state";
import { operationError } from "./state";

interface WorkspaceEntityRecord {
  kind: LongWorkspaceEntityKind;
  id: string;
  value: LongWorkspaceEntitySnapshot;
  serialized: string;
}

function workspaceEntityRecords(
  snapshot: LongWorkspaceIndexSnapshot
): Map<string, WorkspaceEntityRecord> {
  const records = new Map<string, WorkspaceEntityRecord>();
  const add = (
    kind: LongWorkspaceEntityKind,
    entity: { id: string },
    value: unknown = entity
  ): void => {
    const serialized = JSON.stringify(value);
    records.set(entity.id, {
      kind,
      id: entity.id,
      value: JSON.parse(serialized) as LongWorkspaceEntitySnapshot,
      serialized
    });
  };
  snapshot.worldbuilding.forEach((entity) =>
    add("worldbuilding-category", entity)
  );
  snapshot.worldbuilding.forEach((category) => {
    if (category.format === "list") {
      category.items.forEach((item) => add("worldbuilding-item", item));
    }
  });
  snapshot.characterTypes.forEach((entity) => add("character-type", entity));
  snapshot.characters.forEach((entity) => add("character", entity));
  snapshot.plot.volumes.forEach((entity) => add("volume", entity));
  snapshot.plot.arcs.forEach((entity) => add("arc", entity));
  snapshot.plot.chapterCards.forEach((entity) => add("chapter-card", entity));
  snapshot.plot.storyEvents.forEach((entity) => add("story-event", entity));
  snapshot.plot.storyPlots.forEach((entity) => add("story-plot", entity));
  snapshot.plot.eventConnections.forEach((entity) =>
    add("event-connection", entity)
  );
  snapshot.plot.narrativePlacements.forEach((entity) =>
    add("narrative-placement", entity)
  );
  snapshot.plot.foreshadowing.forEach((thread) => {
    add("foreshadowing-thread", thread, {
      ...thread,
      beats: thread.beats.map(({ id }) => id)
    });
    thread.beats.forEach((beat) => add("foreshadowing-beat", beat));
  });
  return records;
}

export function workspaceEntityChanges(
  before: LongWorkspaceIndexSnapshot,
  after: LongWorkspaceIndexSnapshot
): LongWorkspaceEntityChange[] {
  const beforeRecords = workspaceEntityRecords(before);
  const afterRecords = workspaceEntityRecords(after);
  const ids = new Set([...beforeRecords.keys(), ...afterRecords.keys()]);
  const changes: LongWorkspaceEntityChange[] = [];
  for (const id of ids) {
    const previous = beforeRecords.get(id);
    const next = afterRecords.get(id);
    if (!previous && next) {
      changes.push({
        kind: next.kind,
        id: next.id,
        action: "create",
        before: null,
        after: next.value
      });
    } else if (previous && !next) {
      changes.push({
        kind: previous.kind,
        id: previous.id,
        action: "delete",
        before: previous.value,
        after: null
      });
    } else if (previous && next && previous.serialized !== next.serialized) {
      if (previous.kind !== next.kind) {
        operationError(
          "invalid_result",
          `Entity ${id} changed kind from ${previous.kind} to ${next.kind}.`
        );
      }
      changes.push({
        kind: previous.kind,
        id: previous.id,
        action: "update",
        before: previous.value,
        after: next.value
      });
    }
  }
  return changes.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
  );
}

interface WorkspaceRelationshipRecord {
  kind: LongWorkspaceRelationshipKind;
  id: string;
  value: LongWorkspaceEntitySnapshot;
  serialized: string;
}

function workspaceRelationshipRecords(
  snapshot: LongWorkspaceIndexSnapshot
): Map<string, WorkspaceRelationshipRecord> {
  const records = new Map<string, WorkspaceRelationshipRecord>();
  const add = (
    kind: LongWorkspaceRelationshipKind,
    id: string,
    value: unknown
  ): void => {
    const serialized = JSON.stringify(value);
    records.set(`${kind}:${id}`, {
      kind,
      id,
      value: JSON.parse(serialized) as LongWorkspaceEntitySnapshot,
      serialized
    });
  };
  const addDomainEdge = (
    kind: LongWorkspaceRelationshipKind,
    sourceId: string,
    targetId: string
  ): void => {
    const id = domainRelationshipId(kind, sourceId, targetId);
    add(kind, id, { sourceId, targetId });
  };

  snapshot.worldbuilding.forEach((category) => {
    if (category.format !== "list") return;
    category.items.forEach((item) =>
      addDomainEdge("worldbuilding-category-item", category.id, item.id)
    );
  });
  snapshot.characters.forEach((character) =>
    addDomainEdge("character-type-member", character.group, character.id)
  );
  snapshot.plot.arcs.forEach((arc) =>
    addDomainEdge("arc-volume", arc.id, arc.volumeId)
  );
  snapshot.plot.chapterCards.forEach((chapter) => {
    addDomainEdge("chapter-volume", chapter.id, chapter.volumeId);
    if (chapter.primaryArcId !== null) {
      addDomainEdge("chapter-primary-arc", chapter.id, chapter.primaryArcId);
    }
  });
  snapshot.plot.storyPlots.forEach((storyPlot) =>
    addDomainEdge("story-plot-arc", storyPlot.id, storyPlot.arcId)
  );
  snapshot.plot.storyEvents.forEach((event) => {
    event.arcIds.forEach((arcId) =>
      addDomainEdge("story-event-arc", event.id, arcId)
    );
    event.characterIds.forEach((characterId) =>
      addDomainEdge("story-event-character", event.id, characterId)
    );
  });
  snapshot.plot.eventConnections.forEach((connection) => {
    addDomainEdge(
      "event-connection-source",
      connection.id,
      connection.sourceEventId
    );
    addDomainEdge(
      "event-connection-target",
      connection.id,
      connection.targetEventId
    );
  });
  snapshot.plot.narrativePlacements.forEach((placement) => {
    addDomainEdge("narrative-placement-event", placement.id, placement.eventId);
    addDomainEdge(
      "narrative-placement-chapter",
      placement.id,
      placement.chapterCardId
    );
    if (placement.commitId !== null) {
      addDomainEdge(
        "narrative-placement-commit",
        placement.id,
        placement.commitId
      );
    }
  });
  snapshot.plot.foreshadowing.forEach((thread) => {
    if (thread.truthEventId !== null) {
      addDomainEdge(
        "foreshadowing-truth-event",
        thread.id,
        thread.truthEventId
      );
    }
    thread.beats.forEach((beat) => {
      addDomainEdge("foreshadowing-thread-beat", thread.id, beat.id);
      const anchors: ReadonlyArray<
        readonly [LongWorkspaceRelationshipKind, string | null | undefined]
      > = [
        ["foreshadowing-beat-volume", beat.volumeId],
        ["foreshadowing-beat-arc", beat.arcId],
        ["foreshadowing-beat-event", beat.eventId],
        ["foreshadowing-beat-placement", beat.placementId],
        ["foreshadowing-beat-chapter", beat.chapterCardId],
        ["foreshadowing-beat-commit", beat.commitId]
      ];
      anchors.forEach(([kind, targetId]) => {
        if (targetId !== null && targetId !== undefined) {
          addDomainEdge(kind, beat.id, targetId);
        }
      });
    });
  });
  snapshot.characterFiles.forEach((entry) =>
    add("character-files", entry.characterId, entry)
  );
  snapshot.chapters.forEach((entry) =>
    add("chapter-files", entry.chapterCardId, entry)
  );
  snapshot.ledger.commits.forEach((entry) =>
    add("ledger-commit", entry.id, entry)
  );
  add("ledger-state", "ledger_state", {
    committedThroughChapterId: snapshot.ledger.committedThroughChapterId
  });
  add(
    "continuity-projection",
    "continuity_projection",
    snapshot.ledger.projection
  );
  return records;
}

function domainRelationshipId(
  kind: LongWorkspaceRelationshipKind,
  sourceId: string,
  targetId: string
): string {
  return `relation_${kind}:${sourceId.length}:${sourceId}:${targetId.length}:${targetId}`;
}

export function workspaceRelationshipChanges(
  before: LongWorkspaceIndexSnapshot,
  after: LongWorkspaceIndexSnapshot
): LongWorkspaceRelationshipChange[] {
  const beforeRecords = workspaceRelationshipRecords(before);
  const afterRecords = workspaceRelationshipRecords(after);
  const keys = new Set([...beforeRecords.keys(), ...afterRecords.keys()]);
  const changes: LongWorkspaceRelationshipChange[] = [];
  for (const key of keys) {
    const previous = beforeRecords.get(key);
    const next = afterRecords.get(key);
    if (!previous && next) {
      changes.push({
        kind: next.kind,
        id: next.id,
        action: "create",
        before: null,
        after: next.value
      });
    } else if (previous && !next) {
      changes.push({
        kind: previous.kind,
        id: previous.id,
        action: "delete",
        before: previous.value,
        after: null
      });
    } else if (previous && next && previous.serialized !== next.serialized) {
      changes.push({
        kind: previous.kind,
        id: previous.id,
        action: "update",
        before: previous.value,
        after: next.value
      });
    }
  }
  return changes.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
  );
}

/** Reconciles handler marks with the authoritative before/after snapshots. */
export function reconcileEntityImpact(state: MutationState): void {
  const before = workspaceEntityRecords(state.original);
  const after = workspaceEntityRecords(state.draft);
  state.createdEntityIds = new Set(
    [...after.keys()].filter((id) => !before.has(id))
  );
  state.deletedEntityIds = new Set(
    [...before.keys()].filter((id) => !after.has(id))
  );
  state.updatedEntityIds = new Set(
    [...after.entries()]
      .filter(
        ([id, value]) =>
          before.has(id) && before.get(id)?.serialized !== value.serialized
      )
      .map(([id]) => id)
  );
}
