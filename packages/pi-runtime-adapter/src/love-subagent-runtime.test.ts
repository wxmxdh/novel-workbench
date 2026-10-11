import { describe, expect, it, vi } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import { reviewFixture } from "./love-review.test-support";
import { buildRunTools } from "./run-tools";
import { profile, workspace } from "./long-agent-tools.test-support";

describe("LOVE evidence delivered to child provider", () => {
  it("passes Core project instructions, full rules and web tools through actual run wiring", async () => {
    const faux = fauxProvider({
      api: "love-rules-wiring",
      provider: "love-rules-wiring",
      tokensPerSecond: 0,
      models: [{ id: "test", name: "Test", reasoning: true }]
    });
    const review = reviewFixture("请审阅");
    faux.setResponses([fauxAssistantMessage(review.report())]);
    const models = createModels();
    models.setProvider(faux.provider);
    const requests: Array<{ system: string; tools: string[] }> = [];
    const streamFn: StreamFn = (model, context, options) => {
      requests.push({
        system: context.systemPrompt ?? "",
        tools: context.tools?.map((tool) => tool.name) ?? []
      });
      return models.streamSimple(model, context, options);
    };
    const book = workspace("long", "plot_design");
    book.bookId = "longbook_9a146bbe";
    book.navigation.bookId = book.bookId;
    book.agentsMd = "作者局部批评不能升级为全书禁令；这份执行说明来自 Core。";
    book.requiredRules = [
      {
        itemId: "worlditem_d1c23007",
        fileId: "file_rule",
        title: "现实主义",
        updatedAt: "2026-10-04T00:00:00.000Z",
        sha256: "a".repeat(64),
        content:
          "规则开头\n" +
          "需要完整传递的中间内容".repeat(1_000) +
          "\n规则末尾：允许情绪。"
      }
    ];
    const tools = buildRunTools(
      {
        sessionId: "test",
        runId: "run",
        prompt: "请审阅",
        longCommandExecutor: review.executor as never,
        longAgentProfile: profile("long"),
        workspaceContext: { longWorkspace: book },
        subagentDefinitions: [
          {
            id: "love-outline",
            name: "大纲员",
            description: "检查",
            systemPrompt: "中性查证",
            enabled: true,
            modelMode: "inherit"
          }
        ]
      },
      {
        model: faux.getModel("test") as Model<Api>,
        streamFn,
        thinkingLevel: "off",
        parentRuntime: { provider: "test", model: "test", mode: "provider" },
        toolExecutionHooks: {},
        requestUserInput: vi.fn(),
        getParentMessages: () => [],
        portableToolSchemaProfile: "writing-workspace"
      }
    );
    await tools
      .find((tool) => tool.name === "spawn_subagent")!
      .execute("test", {
        subagent_id: "love-outline",
        task: "核对场次"
      } as never);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.system).toContain(book.agentsMd);
    expect(requests[0]!.system).toContain(book.requiredRules[0]!.content);
    expect(requests[0]!.system).toContain(book.bookId);
    expect(requests[0]!.tools).toContain("web_search");
    expect(requests[0]!.tools).toContain("web_fetch");
    expect(requests[0]!.tools).not.toContain("prepare_codex_review");
    expect(requests[0]!.tools).not.toContain("spawn_subagent");
  });
  it.each(["love-outline", "ordinary-outline"])(
    "scopes visible history to %s",
    async (id) => {
      const faux = fauxProvider({
        api: `love-evidence-${id}`,
        provider: `love-evidence-${id}`,
        tokensPerSecond: 0,
        models: [{ id: "test", name: "Test", reasoning: true }]
      });
      const review = reviewFixture("只改这里，未禁止全书", [id]);
      faux.setResponses([
        fauxAssistantMessage(
          id.startsWith("love-") ? review.report() : "已审阅"
        )
      ]);
      const models = createModels();
      models.setProvider(faux.provider);
      const requests: string[] = [];
      const streamFn: StreamFn = (model, context, options) => {
        requests.push(JSON.stringify(context));
        return models.streamSimple(model, context, options);
      };
      const tool = buildSpawnSubagentTool({
        parentSessionId: "test-session",
        loveReviewExecutor: review.executor,
        loveReviewCoordinates: {
          bookId: "longbook_9a146bbe",
          sessionId: "test-session",
          runId: "test-run"
        },
        model: faux.getModel("test") as Model<Api>,
        streamFn,
        thinkingLevel: "off",
        definitions: [
          {
            id,
            name: "检查员",
            description: "检查",
            systemPrompt: "查证",
            modelMode: "inherit",
            enabled: true
          }
        ],
        getParentMessages: () => [
          { role: "user", content: "只改这里，未禁止全书", timestamp: 1 }
        ],
        buildChildTools: () => [],
        systemPromptRequirements: "本书必读规则全文"
      })!;
      await tool.execute("test-call", {
        subagent_id: id,
        task: "核对具体范围"
      } as never);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain("本书必读规则全文");
      expect(requests[0]?.includes("只改这里，未禁止全书")).toBe(
        id.startsWith("love-")
      );
      if (id.startsWith("love-")) {
        expect(requests[0]).toContain("实际磁盘稿件");
        expect(review.snapshot.reports).toHaveLength(1);
      }
    }
  );
});
