import { z } from "zod";

import type { LongEventConnection } from "./plot";

export type ValidationPath = Array<string | number>;

export function addIssue(
  context: z.core.$RefinementCtx<unknown>,
  path: ValidationPath,
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

export function validateUniqueValues(
  values: readonly string[],
  pathForIndex: (index: number) => ValidationPath,
  label: string,
  context: z.core.$RefinementCtx<unknown>
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      addIssue(context, pathForIndex(index), `Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  });
}

export function validateContiguousOrder(
  entries: ReadonlyArray<{ index: number; order: number }>,
  pathForIndex: (index: number) => ValidationPath,
  label: string,
  context: z.core.$RefinementCtx<unknown>
): void {
  const sorted = [...entries].sort((left, right) => left.order - right.order);
  sorted.forEach((entry, index) => {
    if (entry.order !== index + 1) {
      addIssue(
        context,
        pathForIndex(entry.index),
        `${label} order must be unique and contiguous from 1.`
      );
    }
  });
}

export function groupOrderedEntries<T>(
  values: readonly T[],
  groupFor: (value: T) => string,
  orderFor: (value: T) => number
): Map<string, Array<{ index: number; order: number }>> {
  const groups = new Map<string, Array<{ index: number; order: number }>>();
  values.forEach((value, index) => {
    const group = groupFor(value);
    const entries = groups.get(group) ?? [];
    entries.push({ index, order: orderFor(value) });
    groups.set(group, entries);
  });
  return groups;
}

export function hasBeforeCycle(
  eventIds: readonly string[],
  connections: LongEventConnection[]
): boolean {
  const adjacency = new Map<string, string[]>(
    eventIds.map((eventId) => [eventId, []])
  );
  const indegree = new Map<string, number>(
    eventIds.map((eventId) => [eventId, 0])
  );
  for (const connection of connections) {
    if (connection.type !== "before") continue;
    if (
      !adjacency.has(connection.sourceEventId) ||
      !indegree.has(connection.targetEventId)
    ) {
      continue;
    }
    adjacency.get(connection.sourceEventId)!.push(connection.targetEventId);
    indegree.set(
      connection.targetEventId,
      indegree.get(connection.targetEventId)! + 1
    );
  }
  const ready = eventIds.filter((eventId) => indegree.get(eventId) === 0);
  let head = 0;
  let visited = 0;
  while (head < ready.length) {
    const eventId = ready[head++]!;
    visited += 1;
    for (const target of adjacency.get(eventId) ?? []) {
      const next = indegree.get(target)! - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  return visited !== eventIds.length;
}
