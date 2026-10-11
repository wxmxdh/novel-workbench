export type DiffOperation = {
  type: "context" | "addition" | "deletion";
  text: string;
};
const MAX_MYERS_EDIT_DISTANCE = 2_000;
const MAX_MYERS_TRACE_CELLS = 1_000_000;
const MAX_MYERS_WORK = 2_000_000;
function mapValue(map: Map<number, number>, key: number): number {
  return map.get(key) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Computes a shortest line edit script while enforcing hard work and memory
 * budgets. Most document edits have a small edit distance, so Myers remains
 * fast even when unchanged text is long. A caller can safely fall back to a
 * coarse replacement when this returns undefined.
 */
export function buildMyersOperations(
  before: string[],
  after: string[]
): DiffOperation[] | undefined {
  if (before.length === 0) {
    return after.map((text) => ({ type: "addition", text }));
  }
  if (after.length === 0) {
    return before.map((text) => ({ type: "deletion", text }));
  }

  const maxDistance = Math.min(
    before.length + after.length,
    MAX_MYERS_EDIT_DISTANCE
  );
  const trace: Array<Map<number, number>> = [];
  const frontier = new Map<number, number>([[1, 0]]);
  let work = 0;

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    if ((distance + 1) * (distance + 1) > MAX_MYERS_TRACE_CELLS) {
      return undefined;
    }
    trace.push(new Map(frontier));

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1;
      if (work > MAX_MYERS_WORK) {
        return undefined;
      }

      let oldIndex: number;
      if (
        diagonal === -distance ||
        (diagonal !== distance &&
          mapValue(frontier, diagonal - 1) < mapValue(frontier, diagonal + 1))
      ) {
        oldIndex = mapValue(frontier, diagonal + 1);
      } else {
        oldIndex = mapValue(frontier, diagonal - 1) + 1;
      }
      if (!Number.isFinite(oldIndex)) {
        oldIndex = 0;
      }

      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < before.length &&
        newIndex < after.length &&
        before[oldIndex] === after[newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
        work += 1;
        if (work > MAX_MYERS_WORK) {
          return undefined;
        }
      }
      frontier.set(diagonal, oldIndex);

      if (oldIndex >= before.length && newIndex >= after.length) {
        return backtrackMyers(trace, before, after);
      }
    }
  }

  return undefined;
}

function backtrackMyers(
  trace: Array<Map<number, number>>,
  before: string[],
  after: string[]
): DiffOperation[] {
  const reversed: DiffOperation[] = [];
  let oldIndex = before.length;
  let newIndex = after.length;

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance]!;
    const diagonal = oldIndex - newIndex;
    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance &&
        mapValue(frontier, diagonal - 1) < mapValue(frontier, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousOldIndex = Math.max(0, mapValue(frontier, previousDiagonal));
    const previousNewIndex = previousOldIndex - previousDiagonal;

    while (oldIndex > previousOldIndex && newIndex > previousNewIndex) {
      reversed.push({ type: "context", text: before[oldIndex - 1] ?? "" });
      oldIndex -= 1;
      newIndex -= 1;
    }

    if (distance === 0) {
      break;
    }
    if (oldIndex === previousOldIndex) {
      reversed.push({ type: "addition", text: after[newIndex - 1] ?? "" });
      newIndex -= 1;
    } else {
      reversed.push({ type: "deletion", text: before[oldIndex - 1] ?? "" });
      oldIndex -= 1;
    }
  }

  return reversed.reverse();
}
