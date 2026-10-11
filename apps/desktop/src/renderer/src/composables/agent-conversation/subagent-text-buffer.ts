import type { SubagentEventEnvelope } from "./types";

type TextEvent = Extract<SubagentEventEnvelope, { type: "subagent.activity" }>;
type Buffer = {
  timer: ReturnType<typeof setTimeout>;
  events: Map<string, { event: TextEvent; chunks: string[] }>;
  chars: number;
  flush: () => void;
};
const buffers = new WeakMap<object, Buffer>();

export function isSubagentTextEvent(
  event: SubagentEventEnvelope
): event is TextEvent {
  return (
    event.type === "subagent.activity" &&
    (event.payload.activity.type === "thinking_delta" ||
      event.payload.activity.type === "message_delta")
  );
}

export function flushSubagentTextBuffer(owner: object): void {
  const buffer = buffers.get(owner);
  if (!buffer) return;
  buffers.delete(owner);
  clearTimeout(buffer.timer);
  buffer.flush();
}

/** Each child's text stays ordered; tool/retry/terminal boundaries flush it. */
export function queueSubagentTextEvent(
  owner: object,
  event: TextEvent,
  apply: (events: TextEvent[]) => void,
  stillCurrent: () => boolean
): void {
  const activity = event.payload.activity;
  if (activity.type !== "thinking_delta" && activity.type !== "message_delta")
    return;
  let buffer = buffers.get(owner);
  const child = `${event.payload.runId}:${event.payload.subagentRunId}`;
  if (
    buffer &&
    [...buffer.events.values()].some(
      (item) =>
        `${item.event.payload.runId}:${item.event.payload.subagentRunId}` ===
          child && item.event.payload.activity.type !== activity.type
    )
  ) {
    flushSubagentTextBuffer(owner);
    buffer = undefined;
  }
  if (!buffer) {
    const events: Buffer["events"] = new Map();
    buffer = {
      events,
      chars: 0,
      timer: setTimeout(() => flushSubagentTextBuffer(owner), 32),
      flush: () => {
        if (!stillCurrent()) return;
        apply(
          [...events.values()].map(({ event: first, chunks }) => ({
            ...first,
            payload: {
              ...first.payload,
              activity: { ...first.payload.activity, delta: chunks.join("") }
            }
          })) as TextEvent[]
        );
      }
    };
    buffers.set(owner, buffer);
  }
  const key = `${child}:${activity.type}`;
  const pending = buffer.events.get(key);
  if (pending) pending.chunks.push(activity.delta);
  else buffer.events.set(key, { event, chunks: [activity.delta] });
  buffer.chars += activity.delta.length;
  if (buffer.chars >= 64 * 1024) flushSubagentTextBuffer(owner);
}
