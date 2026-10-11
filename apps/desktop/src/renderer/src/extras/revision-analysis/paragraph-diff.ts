import { createId } from "@deepwrite/shared";
import type { RevisionChange } from "@deepwrite/contracts/renderer";
import {
  buildMyersOperations,
  type DiffOperation
} from "../../utils/boundedMyersDiff";
function paragraphs(text: string) {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .flatMap((text, index) => (text.trim() ? [{ text, line: index + 1 }] : []));
}
function key(change: Pick<RevisionChange, "before" | "after">) {
  return JSON.stringify([change.before, change.after]);
}
export function compareRevisionParagraphs(
  beforeText: string,
  afterText: string,
  previous: readonly RevisionChange[] = []
): RevisionChange[] {
  const before = paragraphs(beforeText),
    after = paragraphs(afterText);
  let prefix = 0,
    suffix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix]!.text === after[prefix]!.text
  )
    prefix++;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix]!.text ===
      after[after.length - 1 - suffix]!.text
  )
    suffix++;
  const left = before.slice(prefix, before.length - suffix).map((p) => p.text);
  const right = after.slice(prefix, after.length - suffix).map((p) => p.text);
  const exact = buildMyersOperations(left, right);
  const operations: DiffOperation[] = exact ?? [
    ...left.map((text) => ({ type: "deletion" as const, text })),
    ...right.map((text) => ({ type: "addition" as const, text }))
  ];
  const changes: RevisionChange[] = [];
  let oldIndex = prefix,
    newIndex = prefix;
  let group: {
    before: string[];
    after: string[];
    beforeStart: number;
    afterStart: number;
  } | null = null;
  const flush = () => {
    if (!group) return;
    changes.push({
      id: createId("revision_change"),
      before: group.before.join("\n"),
      after: group.after.join("\n"),
      beforeStart: group.before.length ? group.beforeStart : 0,
      afterStart: group.after.length ? group.afterStart : 0,
      reason: "",
      coarse: exact === undefined
    });
    group = null;
  };
  for (const operation of operations) {
    if (operation.type === "context") {
      flush();
      oldIndex++;
      newIndex++;
      continue;
    }
    group ??= {
      before: [],
      after: [],
      beforeStart: before[oldIndex]?.line ?? 0,
      afterStart: after[newIndex]?.line ?? 0
    };
    if (operation.type === "deletion") {
      group.before.push(operation.text);
      oldIndex++;
    } else {
      group.after.push(operation.text);
      newIndex++;
    }
  }
  flush();
  const oldByKey = new Map<string, RevisionChange[]>();
  const newCounts = new Map<string, number>();
  for (const c of previous) {
    const k = key(c);
    oldByKey.set(k, [...(oldByKey.get(k) ?? []), c]);
  }
  for (const c of changes) {
    const k = key(c);
    newCounts.set(k, (newCounts.get(k) ?? 0) + 1);
  }
  return changes.map((c) => {
    const k = key(c),
      matches = oldByKey.get(k);
    return matches?.length === 1 && newCounts.get(k) === 1
      ? { ...c, id: matches[0]!.id, reason: matches[0]!.reason }
      : c;
  });
}
