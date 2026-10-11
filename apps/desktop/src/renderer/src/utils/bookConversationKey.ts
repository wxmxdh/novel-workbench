import type { AgentConversationController } from "../composables/useAgentConversation";
import type { LongWorkspaceRuntimeContext } from "@deepwrite/contracts";

export function shortBookConversationKey(bookId: string): string {
  return `${bookId}:chat`;
}

export function longBookConversationKey(bookId: string): string {
  return `long:${encodeURIComponent(bookId)}:chat`;
}

export function longStageConversationKey(
  bookId: string,
  root: LongWorkspaceRuntimeContext["activeRoot"]
): string {
  return `long:${encodeURIComponent(bookId)}:stage:${encodeURIComponent(root)}`;
}

export function longChapterConversationKey(
  bookId: string,
  chapterCardId: string
): string {
  return `long:${encodeURIComponent(bookId)}:chapter:${encodeURIComponent(chapterCardId)}`;
}

/** Preserve short-workspace sharing while long workspaces use explicit keys. */
export function canonicalBookConversationKey(
  key: string,
  scope: string
): string {
  if (scope.startsWith("book:") && key.startsWith(`${scope.slice(5)}:`)) {
    return shortBookConversationKey(scope.slice(5));
  }
  return key;
}

export function hasBusyBookConversation(
  entries: Iterable<
    readonly [string, Pick<AgentConversationController, "isBusy">]
  >,
  bookId: string
): boolean {
  for (const [key, conversation] of entries) {
    if (
      (key === shortBookConversationKey(bookId) ||
        key.startsWith(`${bookId}:expert_`)) &&
      conversation.isBusy.value
    )
      return true;
  }
  return false;
}
