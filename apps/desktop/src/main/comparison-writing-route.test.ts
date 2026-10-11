import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  CommandEnvelopeSchema,
  DEFAULT_LONG_AGENT_PROFILES,
  createEnvelope,
  createLongWorkspaceNavigationSnapshot,
  type CommandEnvelope
} from "@deepwrite/contracts";
import { fixtureWorldbuildingIndex } from "../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import { handleSessionCommands } from "./ipc/session-commands";
import { comparisonWritingIntent } from "./comparison-writing-intent";
import type { IpcCommandContext } from "./ipc/command-types";

interface DispatchOptions {
  acceptAgent?: boolean;
  addSameChapterInOtherVolume?: boolean;
  duplicateRecoveredCardId?: boolean;
  changeVolumeOnSecondIndexRead?: boolean;
}

async function dispatch(
  message: string,
  ambiguous = false,
  writerModels: string[] = ["gemini"],
  teamMode: "normal" | "team" = "team",
  historyValues?: Array<{
    role: string;
    content?: string;
    [key: string]: unknown;
  }>,
  chapterContent = "# 第一章计划\n",
  options: DispatchOptions = {}
) {
  const index = fixtureWorldbuildingIndex();
  index.bookId = "longbook_9a146bbe";
  if (ambiguous)
    index.plot.chapterCards.push({
      ...index.plot.chapterCards[0]!,
      id: "chapter_two",
      title: "第二章",
      narrativeOrder: 2
    });
  if (ambiguous)
    index.chapters.push(
      JSON.parse(
        JSON.stringify(index.chapters[0])
          .replaceAll(index.plot.chapterCards[0]!.id, "chapter_two")
          .replaceAll("chapters/one/", "chapters/two/")
      )
    );
  if (options.addSameChapterInOtherVolume) {
    const originalCard = index.plot.chapterCards[0]!;
    const otherArcId = "arc_two";
    index.plot.volumes.push({
      ...index.plot.volumes[0]!,
      id: "volume_two",
      title: "第二卷",
      order: 2,
      summary: "第二卷卷卡"
    });
    index.plot.arcs.push({
      ...index.plot.arcs[0]!,
      id: otherArcId,
      volumeId: "volume_two",
      title: "第二卷主线"
    });
    index.plot.chapterCards.push({
      ...originalCard,
      id: "chapter_one_other_volume",
      volumeId: "volume_two",
      primaryArcId: otherArcId,
      narrativeOrder: 1
    });
    index.chapters.push(
      JSON.parse(
        JSON.stringify(index.chapters[0])
          .replaceAll("chapter_one", "chapter_one_other_volume")
          .replaceAll("chapters/one/", "chapters/other-volume/")
      )
    );
  }
  if (options.duplicateRecoveredCardId)
    index.plot.chapterCards.push({ ...index.plot.chapterCards[0]! });
  let sent: CommandEnvelope | undefined;
  const activeRuns = new Map();
  let workspaceIndexReadCount = 0;
  const runtime = {
    id: "fixture-writer",
    label: "fixture",
    provider: "custom",
    modelId: "gemini-2.5-flash-thinking",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.2, 0.7, 1],
    apiKey: "invalid-test-key"
  };
  const writerConfigs = {
    deepseek: {
      ...runtime,
      id: "fixture-deepseek",
      label: "DeepSeek R1",
      provider: "deepseek",
      modelId: "deepseek-r1"
    },
    gemini: {
      ...runtime,
      id: "fixture-gemini",
      label: "Gemini 2.5 Flash",
      provider: "google",
      modelId: "gemini-2.5-flash"
    },
    geminiPro: {
      ...runtime,
      id: "fixture-gemini-pro",
      label: "Gemini 2.5 Pro",
      provider: "google",
      modelId: "gemini-2.5-pro"
    },
    gpt: {
      ...runtime,
      id: "fixture-gpt",
      label: "GPT 6.1 Sol",
      provider: "openai",
      modelId: "gpt-6.1-sol"
    }
  };
  const modelLabels: Record<
    string,
    { name: string; config: (typeof writerConfigs)[keyof typeof writerConfigs] }
  > = {
    deepseek: { name: "DeepSeek R1", config: writerConfigs.deepseek },
    gemini: { name: "Gemini 2.5 Flash", config: writerConfigs.gemini },
    geminiPro: { name: "Gemini 2.5 Pro", config: writerConfigs.geminiPro },
    gpt: { name: "GPT 6.1 Sol", config: writerConfigs.gpt }
  };
  const teamWriters = writerModels.map((model) => ({
    id: `love-writer-${model.toLocaleLowerCase()}`,
    name: modelLabels[model]!.name,
    description: "测试",
    systemPrompt: "测试",
    enabled: true,
    modelMode: "custom" as const,
    modelId: modelLabels[model]!.config.id,
    thinkingLevel: "medium" as const
  }));
  const ctx = {
    activeRuns,
    terminalRuns: new Map(),
    pendingUsageContexts: new Map(),
    requireModelConfigStore: () => ({
      resolve: async (modelId: string) =>
        modelId === runtime.id
          ? runtime
          : Object.values(writerConfigs).find((config) => config.id === modelId)
    }),
    requireLongAgentConfigStore: () => ({
      resolve: async () =>
        DEFAULT_LONG_AGENT_PROFILES.find((p) => p.id === "long")
    }),
    requireAgentTeamConfigStore: () => ({
      resolve: async () => teamWriters,
      list: async () => ({
        builtinSubagents: {
          skill: { enabled: false },
          material: { enabled: false }
        }
      })
    }),
    requireLibraryAgentConfigStore: () => ({}),
    requireGeneralSettingsStore: () => ({
      list: async () => ({
        settings: { contextCompaction: { enabled: false, budgetTokens: 16000 } }
      })
    }),
    supervisor: {
      requestCommand: vi.fn(
        async (target: string, command: CommandEnvelope) => {
          if (target === "agent") {
            sent = command;
            if (options.acceptAgent)
              return {
                status: "accepted",
                requestId: command.id,
                payload: {
                  sessionId: "session_fixture",
                  runId: "run_fixture",
                  acceptedAt: "2026-10-06T00:00:00.000Z",
                  runtime: {
                    mode: "provider",
                    provider: runtime.provider,
                    model: runtime.modelId,
                    configId: runtime.id
                  }
                }
              };
            return {
              status: "rejected",
              requestId: command.id,
              error: {
                code: "test.stop",
                message: "Stop before invoking any model"
              }
            };
          }
          if (
            command.type === "rendererState.history.session" &&
            historyValues
          ) {
            return {
              status: "accepted",
              requestId: command.id,
              payload: {
                sessionId: command.payload.sessionId,
                metadata: {},
                revision: 1,
                generation: 1,
                sequence: 1,
                deleted: false,
                messageCount: historyValues.length,
                byteLength: 10_000
              }
            };
          }
          if (
            command.type === "rendererState.history.messages" &&
            historyValues
          ) {
            return {
              status: "accepted",
              requestId: command.id,
              payload: {
                revision: 1,
                generation: 1,
                messages: historyValues.map((value, position) => ({
                  messageId: String(value.id),
                  position,
                  value,
                  details: [],
                  byteLength: Buffer.byteLength(JSON.stringify(value))
                })),
                nextPosition: null
              }
            };
          }
          const payload =
            command.type === "long.getWorkspaceIndex"
              ? (() => {
                  workspaceIndexReadCount += 1;
                  const workspaceIndex = structuredClone(index);
                  if (
                    options.changeVolumeOnSecondIndexRead &&
                    workspaceIndexReadCount === 2
                  )
                    workspaceIndex.plot.volumes[0]!.summary = "卷卡已变化";
                  return { bookId: index.bookId, workspaceIndex };
                })()
              : command.type === "long.readDocument"
                ? {
                    bookId: index.bookId,
                    file: index.chapters[0]!.card,
                    content: chapterContent.slice(
                      command.payload.offset,
                      command.payload.offset + command.payload.maxCharacters
                    ),
                    offset: command.payload.offset,
                    totalCharacters: chapterContent.length,
                    nextOffset:
                      command.payload.offset + command.payload.maxCharacters <
                      chapterContent.length
                        ? command.payload.offset + command.payload.maxCharacters
                        : null
                  }
                : command.type === "long.readAgentsMd"
                  ? {
                      bookId: index.bookId,
                      content: "测试执行入口",
                      truncated: false
                    }
                  : command.type === "catalog.queryMaterials"
                    ? { status: "ok", entries: [], total: 0, notices: [] }
                    : undefined;
          if (!payload) throw new Error(command.type);
          return { status: "accepted", requestId: command.id, payload };
        }
      )
    }
  } as unknown as IpcCommandContext;
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "session.prompt",
      {
        sessionId: "session_fixture",
        modelId: runtime.id,
        message,
        agentTeamMode: teamMode,
        workspaceContext: {
          longWorkspace: {
            bookId: index.bookId,
            title: "LOVE",
            activeRoot: "draft",
            activeAgentId: "long",
            navigation: createLongWorkspaceNavigationSnapshot(
              options.duplicateRecoveredCardId
                ? {
                    ...index,
                    plot: {
                      ...index.plot,
                      chapterCards: index.plot.chapterCards.slice(0, -1)
                    }
                  }
                : index
            )
          }
        }
      },
      { id: "request_fixture", context: { sessionId: "session_fixture" } }
    )
  );
  const result = await handleSessionCommands(ctx, command);
  return { sent, result, activeRuns };
}

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function continuationHistory(input: {
  currentText?: string;
  main?: "failed" | "saved";
  team?: Array<{
    id: string;
    model: string;
    provider: string;
    configId: string;
    saved?: boolean;
  }>;
  chapterContent?: string;
  volumeContent?: string;
  mainRuntime?: { provider: string; model: string; configId: string };
}) {
  const originalText = "请写第1章正文。";
  const currentText =
    input.currentText ?? "继续失败的稿，保留成功稿，不要重写其他稿。";
  const cardContent = input.chapterContent ?? "# 第一章计划\n";
  const volumeContent =
    input.volumeContent ?? fixtureWorldbuildingIndex().plot.volumes[0]!.summary;
  const originalQuote = comparisonWritingIntent(originalText)!.quote;
  const authorizationId = "authorization-original-001";
  const runtimeFor = (provider: string, model: string, configId: string) => ({
    mode: "provider",
    provider,
    model,
    configId
  });
  const prepare = (
    definitionId: string,
    runtimeValue: ReturnType<typeof runtimeFor>
  ) => ({
    version: 1,
    bookId: "longbook_9a146bbe",
    authorizationId,
    chapter: 1,
    chapterCardId: "chapter_one",
    chapterCardSha256: hash(cardContent),
    volumeId: "volume_one",
    volumeSha256: hash(volumeContent),
    sourceMode: "independent",
    definitionId,
    runtime: runtimeValue,
    authorRequestId: "request-original-001",
    authorTextSha256: hash(originalText.trim()),
    authorRequestQuote: originalQuote
  });
  const prepCall = (
    definitionId: string,
    runtimeValue: ReturnType<typeof runtimeFor>
  ) => ({
    id: `prepare-${definitionId}`,
    name: "prepare_comparison_draft",
    status: "completed",
    isError: false,
    resultSummary: `【LOVE对照稿恢复证据 v1】${JSON.stringify(prepare(definitionId, runtimeValue))}`
  });
  const deliverCall = (
    definitionId: string,
    runtimeValue: ReturnType<typeof runtimeFor>
  ) => ({
    id: `deliver-${definitionId}`,
    name: "deliver_comparison_draft",
    status: "completed",
    isError: false,
    resultSummary: `【LOVE对照稿交付证据 v1】${JSON.stringify({
      version: 1,
      bookId: "longbook_9a146bbe",
      authorizationId,
      definitionId,
      runtime: runtimeValue,
      path: `004_写作中/${definitionId}.md`,
      sha256: "d".repeat(64),
      model: runtimeValue.model,
      status: "待审阅",
      deliveryRecord: `004_写作中/records/${definitionId}.json`
    })}`
  });
  const mainRuntime = runtimeFor(
    input.mainRuntime?.provider ?? "custom",
    input.mainRuntime?.model ?? "gemini-2.5-flash-thinking",
    input.mainRuntime?.configId ?? "fixture-writer"
  );
  const mainCalls = input.main
    ? [
        prepCall("love-writer-main-draft", mainRuntime),
        ...(input.main === "saved"
          ? [deliverCall("love-writer-main-draft", mainRuntime)]
          : [])
      ]
    : [];
  const subagentRuns = (input.team ?? []).map((writer) => {
    const writerRuntime = runtimeFor(
      writer.provider,
      writer.model,
      writer.configId
    );
    return {
      subagentId: writer.id,
      subagentRunId: `run-${writer.id}`,
      name: writer.id,
      status: writer.saved ? "completed" : "error",
      runtime: writerRuntime,
      toolCalls: [
        prepCall(writer.id, writerRuntime),
        ...(writer.saved ? [deliverCall(writer.id, writerRuntime)] : [])
      ],
      startedAt: "2026-10-06T00:00:00.000Z"
    };
  });
  return [
    { id: "author-original", role: "user", content: originalText },
    {
      id: "assistant-original",
      role: "assistant",
      content: "原任务已结束。",
      status: "completed",
      runId: "original-run",
      toolCalls: mainCalls,
      subagentRuns
    },
    { id: "author-current", role: "user", content: currentText }
  ];
}

describe("actual Main comparison-writing dispatch", () => {
  it("injects a bound writer capability in free discussion with one authoritative chapter", async () => {
    const { sent, result } = await dispatch(
      "1.徐\n3.这个细节太夸张\n后面的再商量。然后你同时推几个创作团队来分别创作吧"
    );
    expect(
      result?.status === "rejected" ? result.error.message : "unexpected"
    ).toBe("Stop before invoking any model");
    expect(sent).toMatchObject({
      type: "agent.prompt",
      payload: {
        comparisonDraftWriterContext: {
          bookId: "longbook_9a146bbe",
          chapter: 1,
          writers: [
            {
              definitionId: "love-writer-gemini",
              runtime: { model: "gemini-2.5-flash" }
            }
          ],
          authorRequest: {
            authorizationQuote: "然后你同时推几个创作团队来分别创作吧"
          }
        }
      }
    });
  });
  it("does not guess between multiple chapters, and accepts an explicit chapter", async () => {
    expect((await dispatch("让团队分别创作吧", true)).result).toMatchObject({
      status: "rejected",
      error: { message: expect.stringContaining("章节不唯一") }
    });
    expect((await dispatch("让团队分别创作第一章吧", true)).sent).toMatchObject(
      { payload: { comparisonDraftWriterContext: { chapter: 1 } } }
    );
  });
  it("does not grant prose permission to discussion or refusals", async () => {
    for (const text of ["不要让团队分别创作", "讨论团队分别创作的功能"]) {
      expect((await dispatch(text)).sent).not.toHaveProperty(
        "payload.comparisonDraftWriterContext"
      );
    }
  });
  it("authorizes the exact retry request from the author screenshot in the real dispatch path", async () => {
    const text =
      "重试 DeepSeek 和 Gemini 2.5 的第一章独立稿，保留已经保存的其他稿件。";
    const { sent } = await dispatch(text, true, ["deepseek", "gemini", "gpt"]);
    expect(sent).toMatchObject({
      payload: {
        comparisonDraftWriterContext: {
          chapter: 1,
          chapterCardId: "chapter_one",
          writers: [
            { definitionId: "love-writer-deepseek" },
            { definitionId: "love-writer-gemini" }
          ],
          authorRequest: {
            exactText: text,
            authorizationQuote: text
          }
        }
      }
    });
    expect(
      (
        sent?.payload as { subagentDefinitions?: Array<{ id: string }> }
      ).subagentDefinitions?.map(({ id }) => id)
    ).toEqual(["love-writer-deepseek", "love-writer-gemini"]);
  });

  it("does not grant every team writer for an ambiguous model family", async () => {
    const { sent } = await dispatch("让 Gemini 2.5 写两份第一章独立稿", false, [
      "gemini",
      "geminiPro",
      "deepseek"
    ]);

    expect(sent).not.toHaveProperty("payload.comparisonDraftWriterContext");
    expect(
      (
        sent?.payload as { subagentDefinitions?: Array<{ id: string }> }
      ).subagentDefinitions?.filter(({ id }) => id.startsWith("love-writer-"))
    ).toEqual([]);
  });

  it("does not substitute the Main model when named writers are unavailable in single mode", async () => {
    const { sent } = await dispatch(
      "重试 DeepSeek 和 Gemini 2.5 的第一章独立稿",
      false,
      ["deepseek", "gemini", "gpt"],
      "normal"
    );

    expect(sent).not.toHaveProperty("payload.comparisonDraftWriterContext");
    expect(sent).not.toHaveProperty("payload.subagentDefinitions");
  });

  it("keeps an explicitly requested Main writer alongside only the named team writer", async () => {
    const { sent } = await dispatch(
      "重试 DeepSeek 的第一章独立稿，同时让主模型也写一份",
      false,
      ["deepseek", "gemini", "gpt"]
    );

    expect(sent).toMatchObject({
      payload: {
        comparisonDraftWriterContext: {
          writers: [
            { definitionId: "love-writer-main-draft" },
            { definitionId: "love-writer-deepseek" }
          ]
        }
      }
    });
    expect(
      (
        sent?.payload as { subagentDefinitions?: Array<{ id: string }> }
      ).subagentDefinitions?.map(({ id }) => id)
    ).toEqual(["love-writer-deepseek"]);
  });

  it("recovers only failed writers by card identity even when another volume repeats the chapter number", async () => {
    const text = "继续失败的两份，保留成功稿，不要重写其他稿。";
    const history = continuationHistory({
      currentText: text,
      main: "failed",
      team: [
        {
          id: "love-writer-deepseek",
          model: "deepseek-r1",
          provider: "deepseek",
          configId: "fixture-deepseek"
        },
        {
          id: "love-writer-gemini",
          model: "gemini-2.5-flash",
          provider: "google",
          configId: "fixture-gemini",
          saved: true
        }
      ]
    });
    const { sent, result, activeRuns } = await dispatch(
      text,
      false,
      ["deepseek", "gemini", "gpt"],
      "team",
      history,
      undefined,
      { acceptAgent: true, addSameChapterInOtherVolume: true }
    );

    expect(result?.status).toBe("accepted");
    expect(sent).toMatchObject({
      payload: {
        comparisonDraftWriterContext: {
          chapter: 1,
          chapterCardId: "chapter_one",
          sourceMode: "independent",
          writers: [
            { definitionId: "love-writer-deepseek" },
            { definitionId: "love-writer-main-draft" }
          ]
        }
      }
    });
    expect(
      (
        sent?.payload as { subagentDefinitions?: Array<{ id: string }> }
      ).subagentDefinitions?.map(({ id }) => id)
    ).toEqual(["love-writer-deepseek"]);
    expect(activeRuns.get("run_fixture")).toMatchObject({
      comparisonDraftSourceFingerprint: {
        chapterCardSha256: hash("# 第一章计划\n"),
        volumeId: "volume_one",
        volumeSha256: hash("")
      }
    });
  });

  it("does not turn failed continuation recovery into an ordinary writer grant", async () => {
    const text = "继续失败的两份，保留成功稿，不要重写其他稿。";
    const { sent } = await dispatch(text, false, ["deepseek", "gemini", "gpt"]);

    expect(sent).not.toHaveProperty("payload.comparisonDraftWriterContext");
    expect(
      (
        sent?.payload as { subagentDefinitions?: Array<{ id: string }> }
      ).subagentDefinitions?.filter(({ id }) => id.startsWith("love-writer-"))
    ).toEqual([]);
  });

  it("rejects duplicate recovered card IDs and a volume change during recovery", async () => {
    const text = "继续失败的稿，保留成功稿，不要重写其他稿。";
    const history = continuationHistory({
      currentText: text,
      team: [
        {
          id: "love-writer-deepseek",
          model: "deepseek-r1",
          provider: "deepseek",
          configId: "fixture-deepseek"
        }
      ]
    });
    for (const options of [
      { duplicateRecoveredCardId: true },
      { changeVolumeOnSecondIndexRead: true }
    ]) {
      const { sent } = await dispatch(
        text,
        false,
        ["deepseek"],
        "team",
        history,
        undefined,
        options
      );
      expect(sent).not.toHaveProperty("payload.comparisonDraftWriterContext");
    }
  });

  it("fails closed when the recovered Main or team writer runtime changed", async () => {
    const text = "继续失败的稿，保留成功稿，不要重写其他稿。";
    const mainHistory = continuationHistory({
      currentText: text,
      main: "failed",
      mainRuntime: {
        provider: "custom",
        model: "gemini-2.5-flash-thinking",
        configId: "old-main-config"
      }
    });
    const teamHistory = continuationHistory({
      currentText: text,
      team: [
        {
          id: "love-writer-deepseek",
          model: "deepseek-r1",
          provider: "deepseek",
          configId: "old-deepseek-config"
        }
      ]
    });
    for (const history of [mainHistory, teamHistory]) {
      const { sent } = await dispatch(
        text,
        false,
        ["deepseek"],
        "team",
        history
      );
      expect(sent).not.toHaveProperty("payload.comparisonDraftWriterContext");
      expect(
        (
          sent?.payload as { subagentDefinitions?: Array<{ id: string }> }
        ).subagentDefinitions?.filter(({ id }) => id.startsWith("love-writer-"))
      ).toEqual([]);
    }
  });

  it("routes an explicitly named LOVE redraft only to that team writer", async () => {
    const text = "请按已选大纲让 DeepSeek 二次创作第一章正文。";
    const { sent } = await dispatch(text, false, ["deepseek", "gemini", "gpt"]);

    expect(sent).toMatchObject({
      payload: {
        comparisonDraftWriterContext: {
          sourceMode: "redraft",
          writers: [{ definitionId: "love-writer-deepseek" }]
        }
      }
    });
    expect(
      (
        sent?.payload as { subagentDefinitions?: Array<{ id: string }> }
      ).subagentDefinitions?.map(({ id }) => id)
    ).toEqual(["love-writer-deepseek"]);
  });
});
