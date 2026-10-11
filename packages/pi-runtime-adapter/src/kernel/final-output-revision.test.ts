import { describe, expect, it } from "vitest";
import { reviseFinalOutput } from "./final-output-revision";
import {
  assistant,
  model,
  response,
  runtime
} from "./context/context.test-support";
import type { AgentRuntimeEvent } from "../runtime-types";

describe("isolated actual parent summary correction", () => {
  it("supplies frozen review text without tools, preserving actual identity and recording usage", async () => {
    const events: AgentRuntimeEvent[] = [];
    const message = assistant("修正汇总：保留普通点头，纸杯品牌待核实。");
    message.usage.input = 120;
    message.usage.output = 30;
    message.usage.totalTokens = 150;
    const content = await reviseFinalOutput({
      prompt: "原稿全文及独立复核：点头不能视为违规。",
      systemPrompt: "LOVE有效规则",
      model,
      runtime,
      thinkingLevel: "off",
      source: { runId: "parent", sessionId: "session" },
      messageId: "parent-final",
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      streamFn: (actualModel, context) => {
        expect(actualModel.id).toBe(model.id);
        expect(context.tools).toEqual([]);
        expect(JSON.stringify(context.messages)).toContain("点头不能视为违规");
        return response(message);
      }
    });
    expect(content).toContain("保留普通点头");
    const usage = events.find((event) => event.type === "agent.usage_observed");
    expect(usage).toBeDefined();
    expect(JSON.stringify(usage)).toContain(model.id);
    expect(JSON.stringify(usage)).toContain("summary-correction");
  });
  it("refuses incomplete model output rather than replacing the original summary", async () => {
    await expect(
      reviseFinalOutput({
        prompt: "复核资料",
        systemPrompt: "规则",
        model,
        runtime,
        thinkingLevel: "off",
        source: { runId: "parent", sessionId: "session" },
        messageId: "message",
        signal: new AbortController().signal,
        emit: () => {},
        streamFn: () => response(assistant("截断总结", "length"))
      })
    ).rejects.toThrow("未完整结束");
  });
  it("does not start a correction after author cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await expect(
      reviseFinalOutput({
        prompt: "资料",
        systemPrompt: "规则",
        model,
        runtime,
        thinkingLevel: "off",
        source: { runId: "parent", sessionId: "session" },
        messageId: "message",
        signal: controller.signal,
        emit: () => {},
        streamFn: () => {
          called = true;
          return response();
        }
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });
});
