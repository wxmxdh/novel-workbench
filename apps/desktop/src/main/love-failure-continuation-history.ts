import { randomUUID } from "node:crypto";
import {
  CommandEnvelopeSchema,
  CONVERSATION_HISTORY_PAGE_BYTES,
  ConversationHistoryDetailResultSchema,
  ConversationHistoryMessagesResultSchema,
  ConversationHistorySessionSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type ConversationHistoryJson,
  type ConversationHistoryMessage,
  type ConversationHistoryRecord
} from "@deepwrite/contracts";
import {
  comparisonWritingIntent,
  parallelWritingRequest
} from "./comparison-writing-intent";
import {
  loveFailureContinuationIntent,
  loveRedraftIntent
} from "./love-workflow-intent";

export interface LoveContinuationHistoryMessage {
  position: number;
  value: Record<string, unknown>;
}

type SendCoreCommand = (
  command: CommandEnvelope,
  timeoutMs: number
) => Promise<CommandResult>;

const MAX_HISTORY_TAIL_MESSAGES = 400;
const MAX_HYDRATED_DETAIL_BYTES = 32 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function historyKey(bookId: string): string {
  return `conversation-history:${encodeURIComponent(
    `long:${encodeURIComponent(bookId)}:chat`
  )}`;
}

function command(
  type:
    | "rendererState.history.session"
    | "rendererState.history.messages"
    | "rendererState.history.detail",
  payload: Record<string, unknown>
): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, { id: randomUUID() })
  );
}

async function acceptedPayload<T>(
  send: SendCoreCommand,
  envelope: CommandEnvelope
): Promise<T> {
  const result = await send(envelope, 10_000);
  if (result.status !== "accepted") throw new Error("history query failed");
  return result.payload as T;
}

async function readDetail(
  send: SendCoreCommand,
  identity: { key: string; sessionId: string },
  message: ConversationHistoryMessage,
  reference: ConversationHistoryMessage["details"][number],
  expectedRevision: number
): Promise<ConversationHistoryJson> {
  const chunks: string[] = [];
  let offset = 0;
  let totalBytes: number | undefined;
  let receivedBytes = 0;
  for (;;) {
    const result = ConversationHistoryDetailResultSchema.parse(
      await acceptedPayload(
        send,
        command("rendererState.history.detail", {
          ...identity,
          messageId: message.messageId,
          path: reference.path,
          offset,
          maxBytes: CONVERSATION_HISTORY_PAGE_BYTES,
          expectedRevision
        })
      )
    );
    const chunkBytes = Buffer.byteLength(result.chunk, "utf8");
    receivedBytes += chunkBytes;
    if (
      result.revision !== expectedRevision ||
      result.encoding !== reference.encoding ||
      (totalBytes !== undefined && result.totalBytes !== totalBytes) ||
      result.totalBytes > reference.byteLength ||
      (reference.encoding === "json" &&
        result.totalBytes !== reference.byteLength) ||
      result.totalBytes > MAX_HYDRATED_DETAIL_BYTES ||
      receivedBytes > result.totalBytes ||
      (result.nextOffset === null && receivedBytes !== result.totalBytes) ||
      (result.nextOffset !== null &&
        (result.chunk.length === 0 ||
          result.nextOffset !== offset + result.chunk.length))
    )
      throw new Error("history detail changed or was incomplete");
    totalBytes = result.totalBytes;
    chunks.push(result.chunk);
    if (result.nextOffset === null) break;
    offset = result.nextOffset;
  }

  const text = chunks.join("");
  return reference.encoding === "text"
    ? text
    : (JSON.parse(text) as ConversationHistoryJson);
}

function assignPath(
  root: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown
): void {
  let parent: unknown = root;
  for (const part of path.slice(0, -1)) {
    if (typeof part === "string" && isRecord(parent)) parent = parent[part];
    else if (typeof part === "number" && Array.isArray(parent))
      parent = parent[part];
    else throw new Error("invalid history detail path");
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error("empty history detail path");
  if (typeof last === "string" && isRecord(parent)) parent[last] = value;
  else if (typeof last === "number" && Array.isArray(parent))
    parent[last] = value;
  else throw new Error("invalid history detail path");
}

function shouldHydrateDetail(
  role: unknown,
  path: readonly (string | number)[],
  includeAssistantTrace: boolean
): boolean {
  if (path.length === 0) return true;
  const field = path[0];
  return (
    (role === "user" && field === "content") ||
    (includeAssistantTrace &&
      role === "assistant" &&
      (field === "toolCalls" || field === "subagentRuns"))
  );
}

interface LoadedHistoryMessage {
  message: ConversationHistoryMessage;
  value: Record<string, unknown>;
  loadedPaths: Set<string>;
}

async function hydrateMessageDetails(
  send: SendCoreCommand,
  identity: { key: string; sessionId: string },
  message: ConversationHistoryMessage,
  revision: number,
  loadedPaths: Set<string>,
  budget: { used: number },
  includeAssistantTrace: boolean
): Promise<LoadedHistoryMessage> {
  let value = structuredClone(message.value) as ConversationHistoryRecord;
  for (const reference of message.details) {
    const pathKey = JSON.stringify(reference.path);
    if (
      loadedPaths.has(pathKey) ||
      !shouldHydrateDetail(value.role, reference.path, includeAssistantTrace)
    )
      continue;
    budget.used += reference.byteLength;
    if (budget.used > MAX_HYDRATED_DETAIL_BYTES)
      throw new Error("history detail budget exceeded");
    const detail = await readDetail(
      send,
      identity,
      message,
      reference,
      revision
    );
    loadedPaths.add(pathKey);
    if (reference.path.length === 0) {
      if (!isRecord(detail)) throw new Error("history root detail is invalid");
      value = detail as ConversationHistoryRecord;
    } else {
      assignPath(value, reference.path, detail);
    }
  }
  return { message, value, loadedPaths };
}

function removeCurrentPendingPair(
  messages: LoveContinuationHistoryMessage[],
  currentText: string
): LoveContinuationHistoryMessage[] | undefined {
  const latest = messages.at(-1)?.value;
  if (latest?.role === "user" && latest.content === currentText)
    return messages.slice(0, -1);

  const assistant = latest;
  const user = messages.at(-2)?.value;
  const emptyTrace = (value: unknown) =>
    value === undefined || (Array.isArray(value) && value.length === 0);
  if (
    !assistant ||
    !user ||
    user.role !== "user" ||
    user.content !== currentText ||
    assistant.role !== "assistant" ||
    assistant.status !== "streaming" ||
    assistant.activityOnly !== true ||
    assistant.runId !== undefined ||
    !emptyTrace(assistant.toolCalls) ||
    !emptyTrace(assistant.subagentRuns)
  )
    return undefined;
  return messages.slice(0, -2);
}

/** Reads one stable Core session and removes only the exact persisted tail for this prompt. */
export async function readLoveFailureContinuationHistory(input: {
  bookId: string;
  sessionId: string;
  currentText: string;
  sendCoreCommand: SendCoreCommand;
}): Promise<LoveContinuationHistoryMessage[] | undefined> {
  try {
    const key = historyKey(input.bookId);
    const identity = { key, sessionId: input.sessionId };
    const session = ConversationHistorySessionSchema.nullable().parse(
      await acceptedPayload(
        input.sendCoreCommand,
        command("rendererState.history.session", {
          ...identity,
          maxBytes: 64 * 1024
        })
      )
    );
    if (
      !session ||
      session.sessionId !== input.sessionId ||
      session.deleted ||
      session.messageCount < 2
    )
      return undefined;

    const pages: ConversationHistoryMessage[][] = [];
    let afterPosition: number | undefined;
    let tailCount = 0;
    let readEntireSession = false;
    while (tailCount < MAX_HISTORY_TAIL_MESSAGES) {
      const page = ConversationHistoryMessagesResultSchema.parse(
        await acceptedPayload(
          input.sendCoreCommand,
          command("rendererState.history.messages", {
            ...identity,
            ...(afterPosition !== undefined ? { afterPosition } : {}),
            direction: "backward",
            limit: 200,
            maxBytes: CONVERSATION_HISTORY_PAGE_BYTES
          })
        )
      );
      if (
        page.revision !== session.revision ||
        page.generation !== session.generation
      )
        return undefined;
      if (page.messages.length === 0) {
        if (page.nextPosition !== null) return undefined;
        readEntireSession = true;
        break;
      }
      for (let index = 1; index < page.messages.length; index += 1) {
        if (
          page.messages[index]!.position <= page.messages[index - 1]!.position
        )
          return undefined;
      }
      pages.push(page.messages);
      tailCount += page.messages.length;
      if (page.nextPosition === null) {
        readEntireSession = true;
        break;
      }
      if (
        page.nextPosition !== page.messages[0]?.position ||
        page.nextPosition >= (afterPosition ?? Number.MAX_SAFE_INTEGER)
      )
        return undefined;
      afterPosition = page.nextPosition;
    }
    const rawMessages = pages
      .reverse()
      .flat()
      .slice(-MAX_HISTORY_TAIL_MESSAGES);
    if (
      rawMessages.length < 2 ||
      (readEntireSession && rawMessages.length !== session.messageCount)
    )
      return undefined;
    const messageIds = new Set<string>();
    for (let index = 1; index < rawMessages.length; index += 1) {
      if (
        rawMessages[index]!.position <= rawMessages[index - 1]!.position ||
        messageIds.has(rawMessages[index]!.messageId)
      )
        return undefined;
      messageIds.add(rawMessages[index]!.messageId);
    }
    if (messageIds.has(rawMessages[0]!.messageId)) return undefined;
    messageIds.add(rawMessages[0]!.messageId);

    const budget = { used: 0 };
    const loadedMessages: LoadedHistoryMessage[] = [];
    for (const message of rawMessages) {
      loadedMessages.push(
        await hydrateMessageDetails(
          input.sendCoreCommand,
          identity,
          message,
          session.revision,
          new Set(),
          budget,
          false
        )
      );
    }
    const traceIndexes = new Set<number>();
    for (let index = 0; index + 1 < loadedMessages.length; index += 1) {
      const current = loadedMessages[index]!.value;
      const next = loadedMessages[index + 1]!.value;
      if (
        current.role === "user" &&
        typeof current.content === "string" &&
        (comparisonWritingIntent(current.content) ||
          parallelWritingRequest(current.content) ||
          loveRedraftIntent(current.content) ||
          loveFailureContinuationIntent(current.content)) &&
        next.role === "assistant"
      )
        traceIndexes.add(index + 1);
    }
    for (const index of traceIndexes) {
      const loaded = loadedMessages[index]!;
      loadedMessages[index] = await hydrateMessageDetails(
        input.sendCoreCommand,
        identity,
        loaded.message,
        session.revision,
        loaded.loadedPaths,
        budget,
        true
      );
    }

    const confirmed = ConversationHistorySessionSchema.nullable().parse(
      await acceptedPayload(
        input.sendCoreCommand,
        command("rendererState.history.session", {
          ...identity,
          maxBytes: 4096
        })
      )
    );
    if (
      !confirmed ||
      confirmed.deleted ||
      confirmed.revision !== session.revision ||
      confirmed.generation !== session.generation ||
      confirmed.messageCount !== session.messageCount
    )
      return undefined;
    return removeCurrentPendingPair(
      loadedMessages.map(({ message, value }) => ({
        position: message.position,
        value
      })),
      input.currentText
    );
  } catch {
    return undefined;
  }
}
