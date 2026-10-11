import {
  CHAT_PROJECT_DEFAULT_PROFILE_ID,
  ExtrasAgentResolvedTaskSchema,
  type ExtrasAgentResolvedTask,
  type ExtrasAgentTask
} from "@deepwrite/contracts";
import type {
  OtterContextRef,
  OtterRuntimeContext
} from "@deepwrite/contracts";
import {
  buildChatProjectRuntimeSnapshot,
  buildChatRuntimeSnapshot,
  type ChatRuntimeSources
} from "./chat/runtime-snapshot";
import type { ExtrasAgentConfigStore } from "./config-store";

export interface ExtrasTaskResolution {
  task: ExtrasAgentResolvedTask;
  /** Long-form book the run may read through Main's Core query bridge. */
  resourceId?: string;
}

/**
 * Turns a Renderer task into what the Agent Utility runs: the saved profile
 * and, for chat, the snapshot Main alone is allowed to read.
 */
export async function resolveExtrasTask(
  configStore: ExtrasAgentConfigStore,
  chatSources: ChatRuntimeSources,
  task: ExtrasAgentTask,
  resolveOtterContext?: (
    reference: OtterContextRef
  ) => Promise<OtterRuntimeContext>
): Promise<ExtrasTaskResolution> {
  switch (task.agentId) {
    case "chat-normal": {
      if (task.input.otter && !resolveOtterContext)
        throw new Error("Otter workspace is not configured.");
      if (task.input.otter && task.input.webSearchEnabled)
        throw new Error("Otter context does not grant external search access.");
      const otterContext = task.input.otter
        ? await resolveOtterContext!(task.input.otter)
        : undefined;
      return {
        task: ExtrasAgentResolvedTaskSchema.parse({
          agentId: task.agentId,
          profile: await configStore.resolve(task.agentId, task.profileId),
          input: {
            ...task.input,
            runtime: otterContext
              ? {}
              : await buildChatRuntimeSnapshot(chatSources),
            ...(otterContext ? { otterContext } : {})
          }
        })
      };
    }
    case "chat-project": {
      // A project without its own prompt chats with the default prompt.
      const profile =
        (await configStore.find(task.agentId, task.profileId)) ??
        (await configStore.resolve(
          task.agentId,
          CHAT_PROJECT_DEFAULT_PROFILE_ID
        ));
      const { project } = task.input;
      return {
        task: ExtrasAgentResolvedTaskSchema.parse({
          agentId: task.agentId,
          profile,
          input: {
            ...task.input,
            runtime: await buildChatProjectRuntimeSnapshot(chatSources, project)
          }
        }),
        ...(project.projectType === "long"
          ? { resourceId: project.projectId }
          : {})
      };
    }
    default:
      return {
        task: ExtrasAgentResolvedTaskSchema.parse({
          agentId: task.agentId,
          profile: await configStore.resolve(task.agentId, task.profileId),
          input: task.input
        })
      };
  }
}
