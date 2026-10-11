import type { AgentConversationController } from "../composables/useAgentConversation";

export type AgentActivityStatus = "running" | "completed" | "error" | "stopped";

export interface AgentActivityDescriptor {
  conversationKey: string;
  agentLabel: string;
  contextLabel: string;
  targetResourceId: string;
  /** Long-form chapter card that was active when the run started. */
  chapterCardId?: string;
}

export interface AgentActivityItem extends AgentActivityDescriptor {
  status: AgentActivityStatus;
  updatedAt: number;
  /** Exact persisted conversation session to reopen when following activity. */
  sessionId?: string;
}

export interface CurrentAgentActivityView {
  controller: AgentConversationController;
  agentLabel: string;
  contextLabel: string;
  targetResourceId: string;
  chapterCardId?: string;
}
