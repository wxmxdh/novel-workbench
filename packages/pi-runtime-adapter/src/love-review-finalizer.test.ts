import { describe, expect, it } from "vitest";
import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type Context,
  type Model
} from "@earendil-works/pi-ai";
import {
  buildSpawnSubagentTool,
  buildSpawnSubagentsBatchTool
} from "./subagent-runtime";
import { finalizeLoveReviewActualOutput } from "./love-review-finalizer";
import {
  createLoveReviewRunState,
  prepareLoveReviewSnapshot
} from "./love-review-runtime";
import { reviewFixture } from "./love-review.test-support";
import { planWorkspaceRun } from "./workspace-run-plan";
import { runAgentWithTurnRetries } from "./agent-turn-retry";
import { profile, workspace } from "./long-agent-tools.test-support";

describe("LOVE final summary audit", () => {
  it("sends the complete approved package in the actual parent model request", async () => {
    const faux = fauxProvider({
      api: "love-approved-parent",
      provider: "love-approved-parent",
      tokensPerSecond: 0,
      models: [{ id: "parent-model", name: "Parent" }]
    });
    faux.setResponses([fauxAssistantMessage("done")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const requests: Context[] = [];
    const sourceStream = models.streamSimple.bind(models) as StreamFn;
    const streamFn: StreamFn = (model, context, options) => {
      requests.push(context);
      return sourceStream(model, context, options);
    };
    const book = workspace("long", "plot_design");
    book.bookId = "longbook_9a146bbe";
    const packageSnapshot = {
      packageId: "LOVE-voice-2026-10-10-v1.0",
      version: "v1.0",
      manifestSha256: "a".repeat(64),
      scope: "第一章认可样本及明确批语范围",
      runPolicy: {
        sampleUse: "整体参考，不逐句仿写",
        draft: "保护留白和现场反应",
        revision: "先确认问题，保护成立表达",
        feedbackScope: "一次批语不扩大为全书规则"
      },
      sources: [
        {
          role: "approved-style-sample",
          title: "认可稿",
          sourcePath: "sample.md",
          sourceId: "sample-source",
          fileId: "sample-file",
          updatedAt: "2026-10-10T00:00:00.000Z",
          sha256: "b".repeat(64),
          content:
            "AUTHOR_APPROVED_PARENT_REQUEST_FULL_TEXT_SENTINEL\n完整认可样本文本。"
        }
      ]
    } as NonNullable<typeof book.approvedVoicePackage>;
    book.approvedVoicePackage = packageSnapshot;
    const plan = planWorkspaceRun(
      {
        sessionId: "session-approved-style",
        runId: "run-approved-style",
        prompt: "按当前任务处理",
        workspaceContext: { longWorkspace: book }
      },
      { basePrompt: "LOVE主智能体", toolExecutionHooks: {} }
    );
    const promptContent = plan.userMessageContent(true);
    const promptText =
      typeof promptContent === "string"
        ? promptContent
        : promptContent
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("\n");
    const model = faux.getModel("parent-model") as Model<Api>;
    const agent = new Agent({
      initialState: { model, systemPrompt: "test", thinkingLevel: "off" },
      streamFn
    });
    await runAgentWithTurnRetries({
      agent,
      initialPrompt: { role: "user", content: promptText, timestamp: 1 },
      runId: "run-approved-style"
    });

    expect(requests).toHaveLength(1);
    const sentMessages = JSON.stringify(requests[0]!.messages);
    expect(sentMessages).toContain(
      "AUTHOR_APPROVED_PARENT_REQUEST_FULL_TEXT_SENTINEL"
    );
    expect(sentMessages).toContain("完整认可样本文本。");
    expect(sentMessages).toContain("一次批语不扩大为全书规则");
  });

  it("persists the actual final text, sends original reports to intent, and exposes its result", async () => {
    const review = reviewFixture("请团队审阅第一章。");
    const faux = fauxProvider({
      api: "love-finalizer",
      provider: "love-finalizer",
      tokensPerSecond: 0,
      models: [{ id: "audit-model", name: "Audit" }]
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const requests: string[] = [];
    const streamFn: StreamFn = (model, context, options) => {
      requests.push(JSON.stringify(context));
      return models.streamSimple(model, context, options);
    };
    const state = createLoveReviewRunState();
    const runtime = {
      mode: "provider" as const,
      provider: "love-finalizer",
      model: "audit-model"
    };
    const input = {
      parentSessionId: "session",
      parentRuntime: runtime,
      model: faux.getModel("audit-model") as Model<Api>,
      thinkingLevel: "off" as const,
      streamFn,
      definitions: [
        {
          id: "love-outline",
          name: "大纲员",
          description: "检查",
          systemPrompt: "核对",
          enabled: true,
          modelMode: "inherit" as const
        },
        {
          id: "love-intent",
          name: "汇总复核员",
          description: "核对汇总",
          systemPrompt: "独立核对",
          enabled: true,
          modelMode: "inherit" as const
        }
      ],
      buildChildTools: () => [],
      loveReviewExecutor: review.executor,
      loveReviewCoordinates: {
        bookId: "longbook_9a146bbe",
        sessionId: "session",
        runId: "run"
      },
      loveReviewAuthorText: review.snapshot.authorText,
      loveReviewRunState: state
    };
    const initialReport = JSON.parse(review.report());
    initialReport.findings = [
      {
        id: "fixture-uncertainty",
        category: "uncertain",
        scope: "synthetic finalizer fixture",
        issue:
          "Synthetic structure-only finding to verify live evidence indexing.",
        sourceId: "draft-1",
        quote: review.snapshot.targets[0]!.content
      }
    ];
    faux.setResponses([fauxAssistantMessage(JSON.stringify(initialReport))]);
    await buildSpawnSubagentTool(input)!.execute("call", {
      subagent_id: "love-outline",
      task: "父任务错误粘贴的稿件，不应替代磁盘原文。"
    } as never);
    expect(state.latestReviewId).toBe(review.snapshot.reviewId);
    faux.setResponses([
      fauxAssistantMessage(
        review.report([
          "love-outline:specialist",
          "main:summary",
          "main-summary"
        ])
      )
    ]);
    const actualFinal = "此段可以斟酌，但作者没有禁止全书心理描写。";
    const progress: string[] = [];
    const result = await finalizeLoveReviewActualOutput({
      subagentInput: input,
      state,
      content: actualFinal,
      runtime,
      onProgress: (event) => progress.push(event.type)
    });
    expect(result?.state).toBe("ready");
    expect(
      review.snapshot.reports.find((entry) => entry.phase === "summary")?.report
        .summary
    ).toBe(actualFinal);
    expect(requests[1]).toContain(actualFinal);
    expect(requests[1]).toContain("love-outline:specialist");
    expect(requests[1]).toContain("main-summary");
    expect(requests[1]).toContain("sourceId");
    expect(requests[1]).toContain("原报告全文");
    expect(requests[1]).toContain(
      "uncertain finding 与 missingSources 保持待核"
    );
    expect(requests[1]).toContain("同型号交叉核对");
    expect(progress).toContain("completed");
    await finalizeLoveReviewActualOutput({
      subagentInput: input,
      state,
      content: actualFinal,
      runtime
    });
    expect(requests).toHaveLength(2);
  });
  it("fans out the same full sources concurrently and retains partial completion", async () => {
    const ids = ["love-outline", "love-viewpoint"],
      review = reviewFixture("再完整审阅第一章", ids);
    const faux = fauxProvider({
      api: "love-batch-freeze",
      provider: "love-batch-freeze",
      tokensPerSecond: 0,
      models: [{ id: "m", name: "M" }]
    });
    faux.setResponses([
      fauxAssistantMessage(review.report()),
      fauxAssistantMessage("只运行结束，没有有效报告"),
      fauxAssistantMessage("补交后仍无有效报告")
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    let active = 0,
      peak = 0;
    const requests: string[] = [];
    const streamFn: StreamFn = async (model, context, options) => {
      active++;
      peak = Math.max(peak, active);
      requests.push(JSON.stringify(context));
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        return await models.streamSimple(model, context, options);
      } finally {
        active--;
      }
    };
    const state = createLoveReviewRunState();
    const tool = buildSpawnSubagentsBatchTool({
      parentSessionId: "s",
      model: faux.getModel("m") as Model<Api>,
      thinkingLevel: "off",
      streamFn,
      definitions: ids.map((id) => ({
        id,
        name: id,
        description: "审阅",
        systemPrompt: "核对",
        enabled: true,
        modelMode: "inherit" as const
      })),
      buildChildTools: () => [],
      loveReviewExecutor: review.executor,
      loveReviewCoordinates: {
        bookId: "longbook_9a146bbe",
        sessionId: "s",
        runId: "r"
      },
      loveReviewAuthorText: review.snapshot.authorText,
      loveReviewRunState: state
    });
    await tool!.execute("batch", {
      mode: "read_only",
      tasks: ids.map((id, index) => ({
        task_id: "task-" + index,
        subagent_id: id,
        task: index === 0 ? "核对" : "文本同上"
      }))
    } as never);
    expect(peak).toBe(2);
    expect(requests).toHaveLength(3);
    expect(requests[2]).toContain("唯一一次报告补交");
    expect(requests.every((text) => text.includes("实际磁盘稿件"))).toBe(true);
    expect(review.snapshot.coverage).toMatchObject({
      state: "incomplete",
      expectedCount: 2,
      completedCount: 1
    });
    expect(review.snapshot.reports).toHaveLength(1);
  });
  it("does not run intent or mark complete while a specialist is missing", async () => {
    const review = reviewFixture("请审阅");
    const state = createLoveReviewRunState();
    state.latestReviewId = review.snapshot.reviewId;
    state.reviews.set(review.snapshot.reviewId, {
      snapshot: review.snapshot,
      coverage: review.snapshot.coverage
    });
    const result = await finalizeLoveReviewActualOutput({
      subagentInput: { loveReviewRunState: state } as never,
      state,
      content: "全部审完。",
      runtime: { mode: "provider", provider: "p", model: "m" }
    });
    expect(result?.state).toBe("incomplete");
    expect(review.snapshot.reports).toHaveLength(0);
  });
  it("rejects corrupted snapshot bytes before any reviewer receives them", async () => {
    const review = reviewFixture("请审阅");
    review.snapshot.targets[0]!.content = "替换了正文但伪装旧hash";
    await expect(
      prepareLoveReviewSnapshot({
        coordinates: {
          bookId: "longbook_9a146bbe",
          sessionId: "s",
          runId: "r"
        },
        executor: review.executor,
        options: { reviewerIds: ["love-outline"], authorText: "请审阅" }
      })
    ).rejects.toThrow("SHA-256");
  });
  it("reports an explicit team review with no tool calls as not started", async () => {
    const book = workspace("long", "plot_design");
    book.bookId = "longbook_9a146bbe";
    const plan = planWorkspaceRun(
      {
        sessionId: "s",
        runId: "r",
        prompt: "请团队完整审阅第一章",
        workspaceContext: { longWorkspace: book },
        longAgentProfile: profile("long")
      },
      { basePrompt: "检查", toolExecutionHooks: {} }
    );
    expect(
      await plan.beforeComplete!(
        {
          type: "agent.completed",
          sessionId: "s",
          runId: "r",
          payload: {
            messageId: "m",
            content: "我审完了",
            runtime: { mode: "provider", provider: "p", model: "m" }
          }
        },
        () => {}
      )
    ).toMatchObject({
      reviewNotice: "not_started",
      content: expect.stringContaining("专业团队尚未启动")
    });
    const ordinary = planWorkspaceRun(
      {
        sessionId: "s",
        runId: "r",
        prompt: "这个人物怎么样",
        workspaceContext: { longWorkspace: book }
      },
      { basePrompt: "讨论", toolExecutionHooks: {} }
    );
    expect(
      await ordinary.beforeComplete!(
        {
          type: "agent.completed",
          sessionId: "s",
          runId: "r",
          payload: {
            messageId: "m",
            content: "意见",
            runtime: { mode: "provider", provider: "p", model: "m" }
          }
        },
        () => {}
      )
    ).toBeUndefined();
  });
});
