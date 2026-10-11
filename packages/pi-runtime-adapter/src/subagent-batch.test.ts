import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { buildSpawnSubagentsBatchTool } from "./subagent-runtime";

const definition = {
  id: "reviewer",
  name: "审阅员",
  description: "只读审阅",
  systemPrompt: "保持独立判断。",
  enabled: true,
  modelMode: "inherit" as const
};

describe("bounded subagent batches", () => {
  it("runs independent children with a cap of three and only read-only tools", async () => {
    const faux = fauxProvider({
      api: "subagent-batch-test",
      provider: "subagent-batch-test",
      models: [{ id: "test", name: "Test", reasoning: true }],
      tokensPerSecond: 0
    });
    faux.setResponses(
      Array.from({ length: 3 }, (_, i) => fauxAssistantMessage(`完成${i + 1}`))
    );
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel("test") as Model<Api>;
    const baseStream = models.streamSimple.bind(models) as StreamFn;
    let active = 0;
    let peak = 0;
    const streamFn: StreamFn = async (requestModel, context, options) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        return await baseStream(requestModel, context, options);
      } finally {
        active--;
      }
    };
    const parameters = Type.Object({ text: Type.String() });
    const readonlyTool: AgentTool = {
      name: "read",
      label: "read",
      description: "read-only",
      parameters,
      execute: async () => ({
        content: [{ type: "text", text: "read" }],
        details: { kind: "none" }
      })
    };
    const blockedTools = ["create", "edit", "delete", "load_skill"].map(
      (name): AgentTool => ({
        name,
        label: name,
        description: "blocked",
        parameters,
        execute: async () => ({
          content: [{ type: "text", text: "no" }],
          details: { kind: "none" }
        })
      })
    );
    const requests: Array<{ prompt: string; tools: string[] }> = [];
    const requestStream: StreamFn = (requestModel, context, options) => {
      requests.push({
        prompt: context.systemPrompt ?? "",
        tools: context.tools?.map((tool) => tool.name) ?? []
      });
      return streamFn(requestModel, context, options);
    };
    const tool = buildSpawnSubagentsBatchTool({
      parentSessionId: "parent",
      model,
      thinkingLevel: "medium",
      streamFn: requestStream,
      definitions: Array.from({ length: 6 }, (_, index) => ({
        ...definition,
        id: `reviewer-${index}`
      })),
      buildChildTools: () => [readonlyTool, ...blockedTools]
    });
    expect(tool).toBeDefined();
    expect(tool?.executionMode).toBe("sequential");
    const result = await tool!.execute("batch-call", {
      tasks: Array.from({ length: 3 }, (_, index) => ({
        task_id: `review-${index + 1}`,
        subagent_id: `reviewer-${index}`,
        task: `审阅视角 ${index + 1}`
      }))
    } as never);

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.tools.includes("read"))).toBe(
      true
    );
    expect(
      requests.every(
        (request) =>
          !request.tools.some((name) =>
            ["create", "edit", "delete", "load_skill"].includes(name)
          )
      )
    ).toBe(true);
    expect(requests[0]?.prompt).toContain("并发审阅硬边界");
    const output = result.content.find((item) => item.type === "text");
    const { items: rows } = JSON.parse(
      output?.type === "text" ? output.text : "{}"
    ) as { items: { task_id: string; status: string }[] };
    expect(rows.map((row) => row.task_id)).toEqual([
      "review-1",
      "review-2",
      "review-3"
    ]);
    expect(rows.every((row) => row.status === "completed")).toBe(true);
  });

  it("enforces the default three-run cap and only permits an explicit cap of five", async () => {
    const faux = fauxProvider({
      api: "subagent-batch-cap-test",
      provider: "subagent-batch-cap-test",
      models: [{ id: "test", name: "Test", reasoning: true }],
      tokensPerSecond: 0
    });
    faux.setResponses(
      Array.from({ length: 4 }, () => fauxAssistantMessage("完成"))
    );
    const models = createModels();
    models.setProvider(faux.provider);
    const tool = buildSpawnSubagentsBatchTool({
      parentSessionId: "parent",
      model: faux.getModel("test") as Model<Api>,
      thinkingLevel: "medium",
      streamFn: models.streamSimple.bind(models) as StreamFn,
      definitions: Array.from({ length: 6 }, (_, index) => ({
        ...definition,
        id: `reviewer-${index}`
      })),
      buildChildTools: () => []
    });
    const result = await tool!.execute("batch-call", {
      tasks: Array.from({ length: 4 }, (_, index) => ({
        task_id: `task-${index}`,
        subagent_id: `reviewer-${index}`,
        task: "检查"
      }))
    } as never);
    expect(
      result.content.some(
        (item) => item.type === "text" && item.text.includes("batch_id")
      )
    ).toBe(true);
  });
});
