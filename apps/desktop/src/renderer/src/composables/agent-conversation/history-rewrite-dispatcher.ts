import type {
  ChatMessage,
  ConversationMessageRewriteRequest
} from "../../types/conversation";

interface RewritableConversation {
  sessionId: { value: string };
  messages: { value: ChatMessage[] };
}

interface ConversationHistoryRewriteDispatcherOptions {
  conversation(): RewritableConversation | null;
  dispatch(request: ConversationMessageRewriteRequest): Promise<void>;
}

/** Keeps rewrite success tied to the originally captured linear conversation. */
export function createConversationHistoryRewriteDispatcher(
  options: ConversationHistoryRewriteDispatcherOptions
): (request: ConversationMessageRewriteRequest) => Promise<boolean> {
  return async (request) => {
    const conversation = options.conversation();
    const sourceSessionId = conversation?.sessionId.value;
    if (
      !conversation ||
      !conversation.messages.value.some(
        (message) => message.id === request.messageId
      )
    ) {
      return false;
    }
    await options.dispatch(request);
    return (
      options.conversation() === conversation &&
      conversation.sessionId.value === sourceSessionId &&
      !conversation.messages.value.some(
        (message) => message.id === request.messageId
      )
    );
  };
}
