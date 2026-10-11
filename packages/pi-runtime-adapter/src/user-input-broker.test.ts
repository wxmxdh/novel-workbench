import { describe, expect, it } from "vitest";
import { AgentUserInputBroker } from "./user-input-broker";

const request = {
  sessionId: "session_1",
  runId: "run_1",
  requestId: "request_1",
  questions: [
    {
      id: "tone",
      question: "选择叙事语气",
      options: [
        { id: "restrained", label: "克制" },
        { id: "intense", label: "强烈" }
      ]
    }
  ]
};

describe("AgentUserInputBroker", () => {
  it("resolves the waiting tool call once and rejects stale answers", async () => {
    const broker = new AgentUserInputBroker();
    const waiting = broker.wait(request);
    const response = {
      sessionId: request.sessionId,
      runId: request.runId,
      requestId: request.requestId,
      answers: [{ id: "tone", selectedOptionIds: ["restrained"] }]
    };

    expect(broker.resolve(response)).toMatchObject({
      sessionId: request.sessionId,
      runId: request.runId,
      requestId: request.requestId
    });
    await expect(waiting).resolves.toEqual(response);
    expect(() => broker.resolve(response)).toThrow(/已处理|不再有效/u);
  });

  it("keeps waiting after an invalid answer and accepts a corrected answer", async () => {
    const broker = new AgentUserInputBroker();
    const waiting = broker.wait(request);

    expect(() =>
      broker.resolve({
        sessionId: request.sessionId,
        runId: request.runId,
        requestId: request.requestId,
        answers: [{ id: "tone", selectedOptionIds: ["unknown"] }]
      })
    ).toThrow(/未知选项/u);

    const corrected = {
      sessionId: request.sessionId,
      runId: request.runId,
      requestId: request.requestId,
      answers: [{ id: "tone", selectedOptionIds: ["intense"] }]
    };
    broker.resolve(corrected);
    await expect(waiting).resolves.toEqual(corrected);
  });

  it("accepts a custom text answer for every choice question", async () => {
    const broker = new AgentUserInputBroker();
    const waiting = broker.wait(request);
    const response = {
      sessionId: request.sessionId,
      runId: request.runId,
      requestId: request.requestId,
      answers: [{ id: "tone", text: "使用冷幽默的叙事语气" }]
    };

    broker.resolve(response);
    await expect(waiting).resolves.toEqual(response);
  });

  it("allows only one pending request per run and cancels it on abort", async () => {
    const broker = new AgentUserInputBroker();
    const controller = new AbortController();
    const waiting = broker.wait(request, controller.signal);

    expect(() => broker.wait({ ...request, requestId: "request_2" })).toThrow(
      /已有一个问题/u
    );
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });
});
