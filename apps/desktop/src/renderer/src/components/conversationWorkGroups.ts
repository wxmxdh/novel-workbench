import type { AgentToolTrace } from "../types/conversation";

export type WorkGroupMemberItem =
  | { id: string; type: "thinking"; content: string; createdAt: string }
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt?: string }
  | { id: string; type: "tool-group"; tools: AgentToolTrace[] };

export type WorkGroupDisplayItem = {
  id: string;
  type: "work-group";
  running: boolean;
  items: WorkGroupMemberItem[];
};

const WORK_MEMBER_TYPES = new Set(["thinking", "tool", "tool-group"]);

function isEmptyResponse(item: { type: string; content?: string }): boolean {
  return item.type === "response" && !item.content;
}

function isWorkMember(item: { type: string }): item is WorkGroupMemberItem {
  return WORK_MEMBER_TYPES.has(item.type);
}

export function foldWorkGroups<T extends { id: string; type: string }>(
  items: readonly T[],
  running: boolean
): Array<T | WorkGroupDisplayItem> {
  const result: Array<T | WorkGroupDisplayItem> = [];
  let current: WorkGroupDisplayItem | undefined;

  function flush(): void {
    if (!current) return;
    result.push(current);
    current = undefined;
  }

  for (const item of items) {
    if (isEmptyResponse(item)) continue;
    if (isWorkMember(item)) {
      current ??= {
        id: `work:${item.id}`,
        type: "work-group",
        running: false,
        items: []
      };
      current.items.push(item as WorkGroupMemberItem);
      continue;
    }
    flush();
    result.push(item);
  }
  flush();

  if (running) {
    const last = result.at(-1);
    if (last && last.type === "work-group" && "running" in last) {
      last.running = true;
    }
  }
  return result;
}
