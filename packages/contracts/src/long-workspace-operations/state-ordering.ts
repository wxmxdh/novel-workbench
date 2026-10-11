import type { LongWorkspaceIndexSnapshot } from "../long-workspace";
import { normalizeStoryPlotOrders } from "./order-utils";
import {
  markUpdated,
  operationError,
  type MutationState
} from "./mutation-state";

export function volumeOrderMap(
  workspace: LongWorkspaceIndexSnapshot
): Map<string, number> {
  return new Map(workspace.plot.volumes.map(({ id, order }) => [id, order]));
}

export function chapterOrderMap(
  workspace: LongWorkspaceIndexSnapshot
): Map<string, number> {
  const volumes = volumeOrderMap(workspace);
  const ordered = [...workspace.plot.chapterCards].sort(
    (left, right) =>
      (volumes.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumes.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder
  );
  return new Map(ordered.map(({ id }, index) => [id, index]));
}

export function normalizeLongWorkspaceOrders(
  workspace: LongWorkspaceIndexSnapshot
): void {
  workspace.worldbuilding.sort((left, right) => left.order - right.order);
  workspace.worldbuilding.forEach((category, index) => {
    category.order = index + 1;
    if (category.format === "list") {
      category.items.sort((left, right) => left.order - right.order);
      category.items.forEach((item, itemIndex) => {
        item.order = itemIndex + 1;
      });
    }
  });

  workspace.characterTypes.sort((left, right) => left.order - right.order);
  workspace.characterTypes.forEach((characterType, index) => {
    characterType.order = index + 1;
  });

  workspace.characters.sort(
    (left, right) =>
      (workspace.characterTypes.find(({ id }) => id === left.group)?.order ??
        Number.MAX_SAFE_INTEGER) -
        (workspace.characterTypes.find(({ id }) => id === right.group)?.order ??
          Number.MAX_SAFE_INTEGER) || left.order - right.order
  );
  const characterOrder = new Map<string, number>();
  workspace.characters.forEach((character) => {
    const next = (characterOrder.get(character.group) ?? 0) + 1;
    characterOrder.set(character.group, next);
    character.order = next;
  });

  workspace.plot.volumes.sort((left, right) => left.order - right.order);
  workspace.plot.volumes.forEach((volume, index) => {
    volume.order = index + 1;
  });
  const volumes = volumeOrderMap(workspace);

  workspace.plot.arcs.sort(
    (left, right) =>
      (volumes.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumes.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.order - right.order
  );
  const arcOrder = new Map<string, number>();
  workspace.plot.arcs.forEach((arc) => {
    const next = (arcOrder.get(arc.volumeId) ?? 0) + 1;
    arcOrder.set(arc.volumeId, next);
    arc.order = next;
  });

  workspace.plot.chapterCards.sort(
    (left, right) =>
      (volumes.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumes.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder
  );
  const narrativeOrder = new Map<string, number>();
  workspace.plot.chapterCards.forEach((chapter) => {
    const next = (narrativeOrder.get(chapter.volumeId) ?? 0) + 1;
    narrativeOrder.set(chapter.volumeId, next);
    chapter.narrativeOrder = next;
  });

  normalizeStoryPlotOrders(workspace);

  workspace.plot.storyEvents.sort(
    (left, right) => left.storyOrder - right.storyOrder
  );
  workspace.plot.storyEvents.forEach((event, index) => {
    event.storyOrder = index + 1;
  });

  const chapters = chapterOrderMap(workspace);
  workspace.plot.narrativePlacements.sort(
    (left, right) =>
      (chapters.get(left.chapterCardId) ?? Number.MAX_SAFE_INTEGER) -
        (chapters.get(right.chapterCardId) ?? Number.MAX_SAFE_INTEGER) ||
      left.orderInChapter - right.orderInChapter
  );
  const placementOrder = new Map<string, number>();
  workspace.plot.narrativePlacements.forEach((placement) => {
    const next = (placementOrder.get(placement.chapterCardId) ?? 0) + 1;
    placementOrder.set(placement.chapterCardId, next);
    placement.orderInChapter = next;
  });

  workspace.plot.foreshadowing.forEach((thread) => {
    thread.beats.sort((left, right) => left.order - right.order);
    thread.beats.forEach((beat, index) => {
      beat.order = index + 1;
    });
  });
}

export function assertExactOrder(
  actualIds: readonly string[],
  orderedIds: readonly string[],
  label: string
): void {
  const orderedIdSet = new Set(orderedIds);
  if (
    actualIds.length !== orderedIds.length ||
    actualIds.some((id) => !orderedIdSet.has(id))
  ) {
    operationError(
      "invalid_order",
      `${label} reorder must include every current id exactly once.`
    );
  }
}

export function insertBeforeId(
  ids: string[],
  id: string,
  beforeId: string | undefined,
  label: string
): string[] {
  const without = ids.filter((candidate) => candidate !== id);
  if (beforeId === undefined) return [...without, id];
  const beforeIndex = without.indexOf(beforeId);
  if (beforeIndex < 0) {
    operationError(
      "invalid_reference",
      `${label} before id ${beforeId} is outside the target scope.`
    );
  }
  without.splice(beforeIndex, 0, id);
  return without;
}

export function updateOrdersById<T extends { id: string }>(
  values: T[],
  orderedIds: readonly string[],
  setOrder: (value: T, order: number) => void,
  state: MutationState
): void {
  const byId = new Map(values.map((value) => [value.id, value]));
  orderedIds.forEach((id, index) => {
    const value = byId.get(id);
    if (!value) {
      operationError("not_found", `Ordered entity ${id} does not exist.`);
    }
    setOrder(value, index + 1);
    markUpdated(state, id);
  });
}

export function orderedChapterIds(
  workspace: LongWorkspaceIndexSnapshot
): string[] {
  const volumes = volumeOrderMap(workspace);
  return [...workspace.plot.chapterCards]
    .sort(
      (left, right) =>
        (volumes.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
          (volumes.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
        left.narrativeOrder - right.narrativeOrder
    )
    .map(({ id }) => id);
}

export function orderedIdsByOrder<T extends { id: string }>(
  values: readonly T[],
  order: (value: T) => number
): string[] {
  return [...values]
    .sort((left, right) => order(left) - order(right))
    .map(({ id }) => id);
}

export function idsByGroupAndOrder<T extends { id: string }>(
  values: readonly T[],
  group: (value: T) => string,
  order: (value: T) => number
): Map<string, string[]> {
  const grouped = new Map<string, T[]>();
  values.forEach((value) => {
    const key = group(value);
    const entries = grouped.get(key) ?? [];
    entries.push(value);
    grouped.set(key, entries);
  });
  return new Map(
    [...grouped.entries()].map(([key, entries]) => [
      key,
      orderedIdsByOrder(entries, order)
    ])
  );
}

export function assertNewEntityId(
  values: readonly { id: string }[],
  id: string,
  label: string
): void {
  if (values.some((value) => value.id === id)) {
    operationError("already_exists", `${label} ${id} already exists.`);
  }
}
