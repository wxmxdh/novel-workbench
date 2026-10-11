import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createModels,
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
  fauxProvider,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import { buildPrepareLoveReviewTool } from "./love-review-prepare-tool";
import {
  buildSpawnSubagentTool,
  buildSpawnSubagentsBatchTool
} from "./subagent-runtime";
import { createLoveReviewRunState } from "./love-review-runtime";
import { reviewFixture } from "./love-review.test-support";
import { planWorkspaceRun } from "./workspace-run-plan";
import { profile, workspace } from "./long-agent-tools.test-support";
import { PiAgentRuntimeAdapter } from "./adapter";
import * as provider from "./provider-runtime";
import type { AgentRunInput } from "./runtime-types";

function fixture(reviewers = ["love-outline", "love-life"]) {
  const authorText = "请团队审阅第一卷第一章已保存的四份独立稿，先取得全文。";
  const review = reviewFixture(authorText, reviewers);
  review.snapshot.targets.splice(
    0,
    1,
    ...Array.from({ length: 4 }, (_, i) => {
      const content = `独立稿${i + 1}开头\n${"真实原文".repeat(800)}\n独立稿${i + 1}末尾`;
      return {
        id: `draft-${i + 1}`,
        path: `004_写作中/稿件${i + 1}.md`,
        role: "draft",
        content,
        sha256: createHash("sha256").update(content).digest("hex"),
        version: "test-current",
        model: `test-model-${i + 1}`
      };
    })
  );
  review.snapshot.targetSetSha256 = createHash("sha256")
    .update(
      JSON.stringify(
        review.snapshot.targets.map(({ id, sha256 }) => ({ id, sha256 }))
      )
    )
    .digest("hex");
  review.snapshot.coverage.targetSetSha256 = review.snapshot.targetSetSha256;
  const faux = fauxProvider({
    api: "love-prepare-entry",
    provider: "love-prepare-entry",
    tokensPerSecond: 0,
    models: [{ id: "test", name: "Test" }]
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const requests: string[] = [];
  const streamFn: StreamFn = (model, context, options) => {
    requests.push(JSON.stringify(context));
    return models.streamSimple(model, context, options);
  };
  const executor = vi.fn(review.executor);
  const input: BuildSpawnSubagentToolInput = {
    parentSessionId: "session",
    model: faux.getModel("test") as Model<Api>,
    thinkingLevel: "off",
    streamFn,
    definitions: review.snapshot.reviewerIds.map((id) => ({
      id,
      name: id,
      description: "检查",
      systemPrompt: "逐篇核对",
      enabled: true,
      modelMode: "inherit"
    })),
    buildChildTools: () => [],
    loveReviewExecutor: executor,
    loveReviewAuthorText: authorText,
    loveReviewCoordinates: {
      bookId: "longbook_9a146bbe",
      sessionId: "session",
      runId: "run"
    },
    loveReviewRunState: createLoveReviewRunState()
  };
  return { review, faux, requests, executor, input };
}

describe("parent LOVE review preparation", () => {
  it.each(["missing-draft-ids", "thinking-only-length"])(
    "allows one honest correction for %s while retaining all frozen texts",
    async (failure) => {
      const f = fixture(["love-outline"]);
      const omitted = {
        ...JSON.parse(f.review.report()),
        reviewedSourceIds: f.review.snapshot.sources.map(({ id }) => id)
      };
      f.faux.setResponses([
        failure === "missing-draft-ids"
          ? fauxAssistantMessage(JSON.stringify(omitted))
          : fauxAssistantMessage(
              fauxThinking("invalid-test-private-reasoning"),
              { stopReason: "length" }
            ),
        fauxAssistantMessage(f.review.report())
      ]);
      const result = await buildSpawnSubagentTool(f.input)!.execute("one", {
        subagent_id: "love-outline",
        task: "核对四稿"
      } as never);
      expect(f.requests).toHaveLength(2);
      expect(f.requests[1]).toContain("唯一一次报告补交");
      for (const target of f.review.snapshot.targets)
        expect(f.requests[1]).toContain(
          JSON.stringify(target.content).slice(1, -1)
        );
      expect(f.review.snapshot.reports).toHaveLength(1);
      expect(result.content).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining("invalid-test-private-reasoning")
          })
        ])
      );
    }
  );

  it("replaces an invented team verdict in the completion and in the next model's cached history", async () => {
    const f = fixture(["love-outline"]);
    const invented = "love-intent已经完成全部专业和作者意图复核，全部通过。";
    f.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("spawn_subagent", {
          subagent_id: "love-outline",
          task: "审阅"
        }),
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("没有完整报告"),
      fauxAssistantMessage("补交仍无完整报告"),
      fauxAssistantMessage(invented)
    ]);
    const spy = vi
      .spyOn(provider, "buildWorkspaceProviderRuntimes")
      .mockReturnValue({
        model: f.input.model,
        streamFn: f.input.streamFn,
        spawnStreamFn: f.input.streamFn
      });
    try {
      const runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 });
      const book = workspace("long", "plot_design");
      book.bookId = "longbook_9a146bbe";
      book.navigation.bookId = book.bookId;
      const input: AgentRunInput = {
        sessionId: "session",
        runId: "first",
        prompt: f.input.loveReviewAuthorText!,
        workspaceContext: { longWorkspace: book },
        longAgentProfile: profile("long"),
        longCommandExecutor: f.executor as never,
        subagentDefinitions: [...f.input.definitions],
        runtimeConfig: {
          id: "test-config",
          label: "Test",
          provider: "custom",
          modelId: "test",
          api: "openai-completions" as const,
          baseUrl: "https://example.test/v1",
          apiKey: "invalid-test-key",
          reasoning: false,
          defaultThinkingLevel: "off" as const,
          thinkingLevelOptions: ["off"],
          temperatureOptions: [0, 0.5, 1]
        }
      };
      const events = [];
      for await (const event of runtime.start(input)) events.push(event);
      const completed = events.find((e) => e.type === "agent.completed");
      expect(completed?.type).toBe("agent.completed");
      if (completed?.type !== "agent.completed") return;
      expect(completed.payload.content).toContain("本轮团队审阅尚未完成");
      expect(completed.payload.content).not.toContain(invented);
      expect(completed.payload.reviewCoverage?.completedCount).toBe(0);
      f.faux.setResponses([fauxAssistantMessage("继续讨论。")]);
      for await (const event of runtime.start({
        ...input,
        runId: "second",
        prompt: "继续讨论"
      }))
        void event;
      expect(f.requests.at(-1)).toContain("本轮团队审阅尚未完成");
      expect(f.requests.at(-1)).not.toContain(invented);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns four complete physical texts before any child starts, then reuses the same review", async () => {
    const f = fixture();
    const result = await buildPrepareLoveReviewTool(f.input)!.execute(
      "prepare",
      {
        reviewer_ids: ["love-outline", "love-life"],
        chapter: 1,
        volume: "第一卷"
      } as never
    );
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    for (const target of f.review.snapshot.targets)
      expect(text).toContain(target.content);
    expect(text).toContain('"target_count":4');
    expect(text).toContain('"review_started":false');
    expect(f.requests).toHaveLength(0);
    expect(f.input.loveReviewRunState!.latestReviewId).toBe(
      f.review.snapshot.reviewId
    );
    expect(f.review.snapshot.reports).toHaveLength(0);
    expect(f.executor.mock.calls[0]![0].payload).toMatchObject({
      authorText: f.input.loveReviewAuthorText,
      chapter: 1,
      volume: "第一卷"
    });
    f.faux.setResponses([
      fauxAssistantMessage(f.review.report()),
      fauxAssistantMessage(f.review.report())
    ]);
    await buildSpawnSubagentsBatchTool(f.input)!.execute("batch", {
      mode: "love_review",
      love_review: {
        review_id: f.review.snapshot.reviewId,
        chapter: 1,
        volume: "第一卷"
      },
      tasks: f.review.snapshot.reviewerIds.map((id) => ({
        task_id: id,
        subagent_id: id,
        task: "核对四稿"
      }))
    } as never);
    expect(f.executor.mock.calls[1]![0].payload).toMatchObject({
      reviewId: f.review.snapshot.reviewId,
      volume: "第一卷"
    });
    expect(f.requests).toHaveLength(2);
    for (const request of f.requests) {
      for (const target of f.review.snapshot.targets)
        expect(request).toContain(JSON.stringify(target.content).slice(1, -1));
    }
    expect(f.input.loveReviewRunState!.latestReviewId).toBe(
      f.review.snapshot.reviewId
    );
    expect(f.review.snapshot.reports).toHaveLength(2);
  });

  it("keeps a Core missing-source error without pretending that review started", async () => {
    const f = fixture();
    f.input.loveReviewExecutor = async (c) => ({
      requestId: c.id,
      status: "rejected",
      error: { code: "MISSING_SOURCE", message: "第四稿缺失" }
    });
    await expect(
      buildPrepareLoveReviewTool(f.input)!.execute("prepare", {
        reviewer_ids: ["love-outline"]
      } as never)
    ).rejects.toThrow("第四稿缺失");
    expect(f.requests).toHaveLength(0);
    expect(f.input.loveReviewRunState!.reviews.size).toBe(0);
  });

  it("stops before exposing text when the Core hash is inconsistent", async () => {
    const f = fixture();
    f.review.snapshot.targets[0]!.content += "未经核对的变化";
    await expect(
      buildPrepareLoveReviewTool(f.input)!.execute("prepare", {
        reviewer_ids: ["love-outline", "love-life"]
      } as never)
    ).rejects.toThrow("SHA-256");
    expect(f.input.loveReviewRunState!.reviews.size).toBe(0);
  });

  it("does not expose this entry to child runs, other books, or a disconnected bridge", () => {
    const f = fixture();
    expect(
      buildPrepareLoveReviewTool({ ...f.input, depth: 1 })
    ).toBeUndefined();
    expect(
      buildPrepareLoveReviewTool({
        ...f.input,
        loveReviewCoordinates: {
          ...f.input.loveReviewCoordinates!,
          bookId: "other-book"
        }
      })
    ).toBeUndefined();
    const disconnected = { ...f.input };
    delete disconnected.loveReviewExecutor;
    expect(buildPrepareLoveReviewTool(disconnected)).toBeUndefined();
  });

  it("wires the real parent plan with explicit instructions and the preparation tool", () => {
    const f = fixture();
    const book = workspace("long", "plot_design");
    book.bookId = "longbook_9a146bbe";
    book.navigation.bookId = book.bookId;
    const plan = planWorkspaceRun(
      {
        sessionId: "session",
        runId: "run",
        prompt: f.input.loveReviewAuthorText!,
        workspaceContext: { longWorkspace: book },
        longAgentProfile: profile("long"),
        longCommandExecutor: f.executor as never,
        subagentDefinitions: [...f.input.definitions]
      },
      { basePrompt: "主模型", toolExecutionHooks: {} }
    );
    const assembled = plan.build({
      model: f.input.model,
      thinkingLevel: "off",
      runtime: {
        provider: "test",
        model: "test",
        mode: "provider"
      },
      spawnStreamFn: f.input.streamFn,
      parentSignal: new AbortController().signal,
      requestUserInput: vi.fn(),
      getParentMessages: () => [],
      onContextCompacted: () => {}
    });
    expect(assembled.tools.map((t) => t.name)).toContain("prepare_love_review");
    expect(assembled.systemPrompt).toContain("先调用 prepare_love_review");
    expect(assembled.systemPrompt).toContain("旧对话中的");
  });
});
