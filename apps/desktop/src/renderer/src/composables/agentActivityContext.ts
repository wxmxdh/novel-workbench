import type { InjectionKey, Ref } from "vue";
import type { AgentActivityItem } from "../types/agentActivity";

export interface AgentActivityContext {
  items: Readonly<Ref<readonly AgentActivityItem[]>>;
  collapsed: Readonly<Ref<boolean>>;
  toggleCollapsed(): void;
  selectActivity(conversationKey: string): Promise<void>;
}

export const AGENT_ACTIVITY_CONTEXT_KEY: InjectionKey<AgentActivityContext> =
  Symbol("deepwrite-agent-activity");
