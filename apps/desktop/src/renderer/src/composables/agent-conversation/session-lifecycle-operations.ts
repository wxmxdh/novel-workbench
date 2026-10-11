export interface SessionLifecycleOperations {
  cancelPendingGeneration(): boolean;
  resetTransientConversationState(): void;
  stopStreamingMessages(): void;
  newConversation(sessionId?: string): void;
  selectConversation(nextSessionId: string): boolean;
}
