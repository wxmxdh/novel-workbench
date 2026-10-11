import {
  createDeferredApi,
  createEditProposal,
  createEnvelope,
  describe,
  document,
  eventOptions,
  expect,
  it,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";

async function startRun(runId: string) {
  const deferred = createDeferredApi();
  const controller = useAgentConversation({
    api: () => deferred.api,
    idleTimeoutMs: 10_000
  });
  controller.draft.value = "继续写作";
  const sessionId = controller.sessionId.value;
  const sending = controller.sendMessage(document);
  deferred.resolveAccepted(0, {
    sessionId,
    runId,
    acceptedAt: new Date().toISOString(),
    runtime
  });
  await sending;
  return { controller, sessionId };
}

function emitTurn(
  controller: ReturnType<typeof useAgentConversation>,
  sessionId: string,
  runId: string,
  messageId: string,
  turnId: string,
  eventId: string
): void {
  controller.handleEvent(
    createEnvelope(
      "agent.turn_started",
      {
        sessionId,
        runId,
        messageId,
        turnId,
        attempt: 1,
        maxAttempts: 6,
        runtime
      },
      eventOptions(sessionId, runId, eventId)
    )
  );
}

function emitRetry(
  controller: ReturnType<typeof useAgentConversation>,
  sessionId: string,
  runId: string,
  messageId: string,
  turnId: string,
  eventId: string
): void {
  controller.handleEvent(
    createEnvelope(
      "agent.retry_scheduled",
      {
        sessionId,
        runId,
        messageId,
        turnId,
        failedAttempt: 1,
        nextAttempt: 2,
        maxAttempts: 6,
        delayMs: 2_000,
        retryAt: "2026-08-25T13:00:03.000Z",
        reason: "connection reset",
        runtime
      },
      eventOptions(sessionId, runId, eventId)
    )
  );
}

describe("agent conversation retry proposal and tool finalization", () => {
  it("does not roll a completed local proposal transaction back to accepting", async () => {
    const runId = "run_retry_after_local_commit";
    const messageId = "message_retry_after_local_commit";
    const { controller, sessionId } = await startRun(runId);

    emitTurn(
      controller,
      sessionId,
      runId,
      messageId,
      "tool_turn",
      "evt_tool_turn"
    );
    controller.upsertEditProposal(
      runId,
      createEditProposal({
        runId,
        approvalMode: "auto-approve",
        status: "accepting",
        decisionToken: "commit-token",
        statusMessage: "正在保存到本地 Markdown"
      })
    );

    emitTurn(
      controller,
      sessionId,
      runId,
      messageId,
      "model_turn_during_commit",
      "evt_model_turn_during_commit"
    );
    controller.updateEditProposal(runId, "proposal_1", {
      status: "accepted",
      proposedText: undefined,
      statusMessage: "已保存到本地 Markdown",
      updatedAt: "2026-08-25T13:00:01.000Z"
    });

    emitRetry(
      controller,
      sessionId,
      runId,
      messageId,
      "model_turn_during_commit",
      "evt_retry_after_local_commit"
    );

    expect(controller.getEditProposal(runId, "proposal_1")).toMatchObject({
      status: "accepted",
      statusMessage: "已保存到本地 Markdown",
      decisionToken: "commit-token",
      updatedAt: "2026-08-25T13:00:01.000Z"
    });
    expect(controller.hasPendingEditReview.value).toBe(false);
    controller.dispose();
  });

  it("does not revive a version-conflicted proposal after a model retry", async () => {
    const runId = "run_retry_after_version_conflict";
    const messageId = "message_retry_after_version_conflict";
    const { controller, sessionId } = await startRun(runId);

    emitTurn(
      controller,
      sessionId,
      runId,
      messageId,
      "tool_turn",
      "evt_conflict_tool_turn"
    );
    controller.upsertEditProposal(
      runId,
      createEditProposal({
        runId,
        status: "accepting",
        decisionToken: "conflict-token"
      })
    );
    emitTurn(
      controller,
      sessionId,
      runId,
      messageId,
      "model_turn_during_conflict_check",
      "evt_model_turn_during_conflict_check"
    );
    controller.updateEditProposal(runId, "proposal_1", {
      status: "conflict",
      statusMessage: "文稿版本已经变化，未覆盖最新内容。",
      updatedAt: "2026-08-25T13:00:02.000Z"
    });

    emitRetry(
      controller,
      sessionId,
      runId,
      messageId,
      "model_turn_during_conflict_check",
      "evt_retry_after_version_conflict"
    );

    expect(controller.getEditProposal(runId, "proposal_1")).toMatchObject({
      status: "conflict",
      statusMessage: "文稿版本已经变化，未覆盖最新内容。",
      decisionToken: "conflict-token",
      updatedAt: "2026-08-25T13:00:02.000Z"
    });
    expect(controller.hasPendingEditReview.value).toBe(false);
    controller.dispose();
  });

  it("fails only unfinished parent tool activity when a run errors", async () => {
    const runId = "run_partial_tool_error";
    const messageId = "message_partial_tool_error";
    const { controller, sessionId } = await startRun(runId);
    emitTurn(
      controller,
      sessionId,
      runId,
      messageId,
      "partial_tool_turn",
      "evt_partial_tool_turn"
    );

    controller.handleEvent(
      createEnvelope(
        "tool.call_requested",
        {
          sessionId,
          runId,
          toolCallId: "tool_completed",
          toolName: "read_file",
          args: { path: "notes.md" },
          runtime
        },
        eventOptions(sessionId, runId, "evt_completed_tool_requested")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "tool.execution_completed",
        {
          sessionId,
          runId,
          toolCallId: "tool_completed",
          toolName: "read_file",
          resultSummary: "已读取 notes.md",
          isError: false,
          runtime
        },
        eventOptions(sessionId, runId, "evt_completed_tool_finished")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "tool.call_stream",
        {
          sessionId,
          runId,
          streamId: "partial-tool-stream",
          toolCallId: "tool_partial",
          toolName: "write_workspace_editor",
          phase: "delta" as const,
          argumentsDelta: '{"text":"未完成',
          runtime
        },
        eventOptions(sessionId, runId, "evt_partial_tool_delta")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.error",
        {
          sessionId,
          runId,
          code: "agent.stream_failed",
          message: "模型连接中断，工具参数未完成。",
          runtime
        },
        eventOptions(sessionId, runId, "evt_partial_tool_error")
      )
    );

    expect(controller.messages.value.at(-1)?.toolCalls).toMatchObject([
      { id: "tool_completed", status: "completed", isError: false },
      {
        id: "tool_partial",
        status: "error",
        isError: true,
        resultSummary: "模型连接中断，工具参数未完成。"
      }
    ]);
    expect(controller.messages.value.at(-1)?.tools).toMatchObject([
      { id: "tool_completed", status: "completed" },
      {
        id: "tool_partial",
        status: "error",
        summary: "模型连接中断，工具参数未完成。"
      }
    ]);
    expect(controller.isBusy.value).toBe(false);
    controller.dispose();
  });

  it("marks an orphaned preparing tool as incomplete on normal run completion", async () => {
    const runId = "run_orphaned_tool_completion";
    const messageId = "message_orphaned_tool_completion";
    const { controller, sessionId } = await startRun(runId);
    emitTurn(
      controller,
      sessionId,
      runId,
      messageId,
      "orphaned_tool_turn",
      "evt_orphaned_tool_turn"
    );
    controller.handleEvent(
      createEnvelope(
        "tool.call_stream",
        {
          sessionId,
          runId,
          streamId: "orphaned-tool-stream",
          toolCallId: "tool_orphaned",
          toolName: "write_workspace_editor",
          phase: "end" as const,
          argumentsDelta: "",
          args: { text: "半截内容" },
          runtime
        },
        eventOptions(sessionId, runId, "evt_orphaned_tool_end")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId,
          runId,
          messageId,
          role: "assistant" as const,
          content: "本轮已经结束。",
          runtime
        },
        eventOptions(sessionId, runId, "evt_orphaned_run_completed")
      )
    );

    expect(controller.messages.value.at(-1)?.toolCalls?.[0]).toMatchObject({
      id: "tool_orphaned",
      status: "error",
      isError: true,
      resultSummary: "智能体运行已完成，但工具调用未返回完整终态。"
    });
    expect(controller.messages.value.at(-1)?.status).toBe("completed");
    controller.dispose();
  });
});
