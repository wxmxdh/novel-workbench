import {
  LongCommitChapterInputSchema,
  longCommitInputChapterIds,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";

export type LongContinuityFinalizationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.ledger_commit_proposal" }
>;

function ipcSafeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function continuityFinalizationKey(
  event: LongContinuityFinalizationEvent
): string {
  const chapterIds = longCommitInputChapterIds(event.payload.input);
  return `${event.payload.bookId}\u0000${chapterIds.join("\u0000")}`;
}

export async function commitLongContinuityFinalization(
  api: LongWorkspaceRendererApi,
  event: LongContinuityFinalizationEvent
): Promise<void> {
  const parsedInput = LongCommitChapterInputSchema.parse(event.payload.input);
  await api.commitChapter(ipcSafeJson(parsedInput));
}
