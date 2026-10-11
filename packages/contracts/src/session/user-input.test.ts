import { describe, expect, it } from "vitest";
import {
  AgentUserInputQuestionsSchema,
  SessionUserInputResponsePayloadSchema
} from "./user-input";

describe("agent user input contracts", () => {
  it("accepts stable question and option ids", () => {
    expect(
      AgentUserInputQuestionsSchema.parse([
        {
          id: "tone",
          question: "选择叙事语气",
          options: [
            { id: "restrained", label: "克制" },
            { id: "intense", label: "强烈" }
          ]
        }
      ])
    ).toMatchObject([{ id: "tone" }]);
  });

  it("rejects duplicate ids and invalid option-only settings", () => {
    expect(() =>
      AgentUserInputQuestionsSchema.parse([
        { id: "duplicate", question: "第一个问题" },
        { id: "duplicate", question: "第二个问题" }
      ])
    ).toThrow(/Duplicate question id/u);
    expect(() =>
      AgentUserInputQuestionsSchema.parse([
        {
          id: "free_text",
          question: "填写说明",
          multi_select: true
        }
      ])
    ).toThrow(/require options/u);
  });

  it("requires every submitted answer to carry a selection or text", () => {
    expect(() =>
      SessionUserInputResponsePayloadSchema.parse({
        sessionId: "session_1",
        runId: "run_1",
        requestId: "request_1",
        answers: [{ id: "tone", selectedOptionIds: [] }]
      })
    ).toThrow(/selected option or text/u);
  });
});
