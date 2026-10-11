import {
  createDeferredApi,
  createEnvelope,
  describe,
  document,
  eventOptions,
  expect,
  it,
  reactive,
  runtime,
  useAgentConversation,
  vi
} from "./useAgentConversation.test-support";

function deferredAcknowledgement<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function userInputEvent(
  sessionId: string,
  runId: string,
  requestId: string,
  question: string
) {
  return createEnvelope(
    "agent.user_input_requested",
    {
      sessionId,
      runId,
      requestId,
      toolCallId: `tool_${requestId}`,
      source: "ask_user_question" as const,
      questions: [
        {
          id: "tone",
          question,
          options: [
            { id: "restrained", label: "克制" },
            { id: "intense", label: "强烈" }
          ]
        }
      ],
      runtime
    },
    eventOptions(sessionId, runId, `event_${requestId}`)
  );
}

async function startWaitingRun() {
  const deferred = createDeferredApi();
  const controller = useAgentConversation({
    api: () => deferred.api,
    idleTimeoutMs: 10_000
  });
  controller.draft.value = "开始处理";
  const sessionId = controller.sessionId.value;
  const runId = "run_waiting_for_user";
  const sending = controller.sendMessage(document);
  deferred.resolveAccepted(0, {
    sessionId,
    runId,
    acceptedAt: new Date().toISOString(),
    runtime
  });
  await sending;
  return { controller, deferred, runId, sessionId };
}

describe("agent conversation controller: user input continuity", () => {
  it("dismisses the card before acknowledgement and stays busy while the model resumes", async () => {
    const { controller, deferred, runId, sessionId } = await startWaitingRun();
    const acknowledgement = deferredAcknowledgement<void>();
    const submitUserInput = vi
      .spyOn(deferred.api.session, "submitUserInput")
      .mockImplementation(async (payload) => {
        structuredClone(payload);
        await acknowledgement.promise;
        return {
          sessionId: payload.sessionId,
          runId: payload.runId,
          requestId: payload.requestId,
          resolvedAt: new Date().toISOString()
        };
      });
    controller.handleEvent(
      userInputEvent(sessionId, runId, "request_tone", "选择叙事语气")
    );

    const reactiveSelections = reactive({ tone: ["restrained"] });
    expect(() => structuredClone(reactiveSelections.tone)).toThrow();
    const submitting = controller.submitUserInput([
      { id: "tone", selectedOptionIds: reactiveSelections.tone }
    ]);
    expect(controller.pendingUserInput.value).toBeNull();
    expect(controller.submittingUserInput.value).toBe(true);
    expect(controller.isBusy.value).toBe(true);
    expect(controller.canStop.value).toBe(true);
    expect(controller.canSend.value).toBe(false);
    await expect(
      controller.submitUserInput([{ id: "tone", text: "重复提交" }])
    ).resolves.toBe(false);
    expect(submitUserInput).toHaveBeenCalledTimes(1);
    acknowledgement.resolve();
    await expect(submitting).resolves.toBe(true);

    expect(submitUserInput).toHaveBeenCalledWith({
      sessionId,
      runId,
      requestId: "request_tone",
      answers: [{ id: "tone", selectedOptionIds: ["restrained"] }]
    });
    expect(controller.pendingUserInput.value).toBeNull();
    expect(controller.submittingUserInput.value).toBe(false);

    controller.handleEvent(
      createEnvelope(
        "agent.thinking_delta",
        {
          sessionId,
          runId,
          messageId: "message_after_answer",
          delta: "继续处理用户回答",
          runtime
        },
        eventOptions(sessionId, runId, "evt_after_user_input")
      )
    );

    expect(controller.pendingUserInput.value).toBeNull();
    expect(controller.submittingUserInput.value).toBe(false);
    expect(controller.isBusy.value).toBe(true);
    controller.dispose();
  });

  it("replaces a submitted card directly with the next question", async () => {
    const { controller, deferred, runId, sessionId } = await startWaitingRun();
    vi.spyOn(deferred.api.session, "submitUserInput").mockImplementation(
      async (payload) => ({
        sessionId: payload.sessionId,
        runId: payload.runId,
        requestId: payload.requestId,
        resolvedAt: new Date().toISOString()
      })
    );
    controller.handleEvent(
      userInputEvent(sessionId, runId, "request_tone", "选择叙事语气")
    );
    await controller.submitUserInput([
      { id: "tone", selectedOptionIds: ["restrained"] }
    ]);

    controller.handleEvent(
      userInputEvent(sessionId, runId, "request_pace", "选择叙事节奏")
    );

    expect(controller.pendingUserInput.value).toMatchObject({
      requestId: "request_pace",
      questions: [{ question: "选择叙事节奏" }]
    });
    expect(controller.submittingUserInput.value).toBe(false);
    controller.dispose();
  });

  it("restores the question on submission failure and allows retry", async () => {
    const { controller, deferred, runId, sessionId } = await startWaitingRun();
    const acknowledgement = deferredAcknowledgement<never>();
    const submitUserInput = vi
      .spyOn(deferred.api.session, "submitUserInput")
      .mockImplementationOnce(() => acknowledgement.promise);
    controller.handleEvent(
      userInputEvent(sessionId, runId, "request_tone", "选择叙事语气")
    );

    const submitting = controller.submitUserInput([
      { id: "tone", selectedOptionIds: ["restrained"] }
    ]);
    expect(controller.pendingUserInput.value).toBeNull();
    acknowledgement.reject(new Error("提交失败，请重试。"));
    await expect(submitting).resolves.toBe(false);

    expect(controller.pendingUserInput.value?.requestId).toBe("request_tone");
    expect(controller.submittingUserInput.value).toBe(false);
    expect(controller.conversationError.value).toBe("提交失败，请重试。");
    await expect(
      controller.submitUserInput([{ id: "tone", text: "跳过" }])
    ).resolves.toBe(true);
    expect(submitUserInput).toHaveBeenCalledTimes(2);
    expect(controller.pendingUserInput.value).toBeNull();
    controller.dispose();
  });

  it.each(["accepted", "rejected"])(
    "keeps a new question when the previous acknowledgement is %s",
    async (result) => {
      const { controller, deferred, runId, sessionId } =
        await startWaitingRun();
      const acknowledgement = deferredAcknowledgement<void>();
      vi.spyOn(deferred.api.session, "submitUserInput").mockImplementation(
        async (payload) => {
          await acknowledgement.promise;
          return { ...payload, resolvedAt: new Date().toISOString() };
        }
      );
      controller.handleEvent(
        userInputEvent(sessionId, runId, "request_tone", "选择叙事语气")
      );
      const submitting = controller.submitUserInput([
        { id: "tone", text: "克制" }
      ]);
      controller.handleEvent(
        userInputEvent(sessionId, runId, "request_pace", "选择叙事节奏")
      );

      if (result === "accepted") acknowledgement.resolve();
      else acknowledgement.reject(new Error("旧请求失败"));
      await submitting;

      expect(controller.pendingUserInput.value?.requestId).toBe("request_pace");
      expect(controller.submittingUserInput.value).toBe(false);
      expect(controller.conversationError.value).toBeNull();
      controller.dispose();
    }
  );

  it.each(["output", "stopped", "disposed"])(
    "does not restore an obsolete question after the run is %s",
    async (state) => {
      const { controller, deferred, runId, sessionId } =
        await startWaitingRun();
      const acknowledgement = deferredAcknowledgement<never>();
      vi.spyOn(deferred.api.session, "submitUserInput").mockImplementation(
        () => acknowledgement.promise
      );
      controller.handleEvent(
        userInputEvent(sessionId, runId, "request_tone", "选择叙事语气")
      );
      const submitting = controller.submitUserInput([
        { id: "tone", text: "克制" }
      ]);

      if (state === "disposed") {
        controller.dispose();
      } else if (state === "stopped") {
        controller.handleEvent(
          createEnvelope(
            "agent.error",
            {
              sessionId,
              runId,
              code: "pi_agent.aborted",
              message: "已停止",
              runtime
            },
            eventOptions(sessionId, runId, "event_stopped")
          )
        );
      } else {
        controller.handleEvent(
          createEnvelope(
            "agent.thinking_delta",
            {
              sessionId,
              runId,
              messageId: "resumed",
              delta: "继续处理",
              runtime
            },
            eventOptions(sessionId, runId, "event_resumed")
          )
        );
      }
      acknowledgement.reject(new Error("旧请求失败"));
      await expect(submitting).resolves.toBe(false);

      expect(controller.pendingUserInput.value).toBeNull();
      expect(controller.submittingUserInput.value).toBe(false);
      expect(controller.conversationError.value).toBeNull();
      if (state !== "disposed") controller.dispose();
    }
  );
});
