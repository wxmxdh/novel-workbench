import { afterEach, describe, expect, it } from "vitest";
import {
  createDeferredApi,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";
import type { AgentConversationController } from "./useAgentConversation";
import { formatError } from "../i18n/errors";
const controllers: AgentConversationController[] = [];
afterEach(() =>
  controllers.splice(0).forEach((controller) => controller.dispose())
);
describe("original conversation with validated novel Context", () => {
  it("creates a Context-bound session while retaining the original conversation in history", () => {
    const controller = useAgentConversation({ api: () => undefined });
    controllers.push(controller);
    const original = controller.sessionId.value;
    controller.messages.value.push({
      id: "prior",
      role: "user",
      content: "先前讨论",
      createdAt: new Date().toISOString(),
      status: "completed"
    });
    controller.newConversation("otter:fixture:context_fixture:author-choice");
    expect(controller.sessionId.value).toBe(
      "otter:fixture:context_fixture:author-choice"
    );
    expect(controller.messages.value).toEqual([]);
    expect(controller.selectConversation(original)).toBe(true);
    expect(controller.messages.value[0]?.content).toBe("先前讨论");
  });
  it("sends the original composer attachments with the same Context-bound session and no writing tools", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    controllers.push(controller);
    controller.newConversation("otter:fixture:context_fixture:turn");
    controller.draft.value = "比较这段作者意见";
    const attachment = {
      id: "author-note",
      name: "作者选段",
      kind: "text" as const,
      mediaType: "text/plain",
      size: 6,
      content: "原文"
    };
    const sending = controller.sendAssistantMessage(
      {
        agentId: "chat-normal",
        profileId: "default",
        input: {
          otter: {
            projectId: "fixture",
            contextPath: ".novel/tasks/context_fixture.json"
          }
        }
      },
      [attachment]
    );
    expect(deferred.chatRuns[0]?.sessionId).toBe(controller.sessionId.value);
    expect(deferred.chatRuns[0]?.conversation?.attachments).toEqual([
      attachment
    ]);
    expect(deferred.chatRuns[0]).not.toHaveProperty("workspaceContext");
    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run_fixture",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await sending;
  });
  it("presents the actual chooser failure message from an Otter IPC envelope", () => {
    expect(
      formatError(
        { code: "otter.operation_failed", message: "选择目录失败：目录不存在" },
        "无法操作"
      )
    ).toBe("选择目录失败：目录不存在");
    expect(formatError({ value: "unknown" }, "无法操作")).toBe("无法操作");
  });
});
