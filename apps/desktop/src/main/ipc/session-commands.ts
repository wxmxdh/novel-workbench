import { acquireConversationOperation } from "./conversation-operation-guard";
import {
  loveLocalRevisionIntent,
  loveRedraftIntent,
  loveFailureContinuationIntent
} from "../love-workflow-intent";
import { createHash, randomUUID } from "node:crypto";
import {
  comparisonWritingIntent,
  chapterNumber,
  parallelWritingRequest,
  splitAuthorActionClauses
} from "../comparison-writing-intent";
import { resolveAgentTeamRuntime } from "../agent-team-run-mode";
import {
  explicitlyNamesLoveWriter,
  selectLoveWriters,
  selectRecoveredLoveWriters
} from "../love-writer-selection";
import { readLoveFailureContinuationHistory } from "../love-failure-continuation-history";
import { recoverLoveFailureContinuation } from "../love-failure-continuation-recovery";
import { prepareLibraryManagementRunContext } from "../library-management-run-context";
import { prepareMaterialRunContext } from "../material-run-context";
import { prepareLongRequiredRuleContext } from "../long-required-rule-context";
import { prepareLoveApprovedVoiceContext } from "../love-approved-voice-context";
import { prepareNativeWritingReferenceContext } from "../native-writing-reference-context";
import {
  CommandEnvelopeSchema,
  SessionAbortAcceptedPayloadSchema,
  SessionUserInputResponseAcceptedPayloadSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  isDeepSeekWebSearchCompatible,
  ComparisonDraftWriterContextSchema,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  resolveContextCompactionRun,
  withCompactionUsageConfig
} from "../context-compaction-run";
import { resolveModelRunSettings } from "../model-run-settings";
import { createUsageRunContext } from "../usage-observation";
import { usageModuleForPrompt } from "../usage-module";
import { safeErrorDetails } from "./errors";
import type { IpcCommandContext } from "./command-types";

function explicitlyRequestsMainDraft(text: string): boolean {
  return splitAuthorActionClauses(text).some(
    ({ text: clause }) =>
      /(?:(?:让|由|请|交给).{0,8})?(?:主模型|主智能体).{0,12}(?:写|撰写|创作)/u.test(
        clause
      ) && !/(?:不要|不许|不能|不得|别|暂不|先不|还不)/u.test(clause)
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readWholeLongDocument(
  ctx: Pick<IpcCommandContext, "supervisor">,
  bookId: string,
  fileId: string
): Promise<string | undefined> {
  try {
    let offset = 0;
    let totalCharacters: number | undefined;
    let content = "";
    for (;;) {
      const reply = await ctx.supervisor.requestCommand(
        "core",
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "long.readDocument",
            { bookId, fileId, offset, maxCharacters: 32_768 },
            { id: randomUUID() }
          )
        ),
        10_000
      );
      if (reply.status !== "accepted") return undefined;
      const page = LongReadDocumentResultSchema.parse(reply.payload);
      if (
        page.bookId !== bookId ||
        page.file.id !== fileId ||
        page.offset !== offset ||
        page.totalCharacters > 500_000 ||
        (totalCharacters !== undefined &&
          totalCharacters !== page.totalCharacters)
      )
        return undefined;
      totalCharacters = page.totalCharacters;
      content += page.content;
      if (content.length > 500_000) return undefined;
      if (page.nextOffset === null)
        return content.length === totalCharacters ? content : undefined;
      if (page.nextOffset <= offset) return undefined;
      offset = page.nextOffset;
    }
  } catch {
    return undefined;
  }
}

interface VerifiedLoveContinuation {
  recovery: ReturnType<typeof recoverLoveFailureContinuation> & {};
  chapter: { id: string; title: string };
  fingerprint: {
    chapterCardSha256: string;
    volumeId: string;
    volumeSha256: string;
  };
}

async function recoverVerifiedLoveContinuation(
  ctx: Pick<IpcCommandContext, "supervisor">,
  input: {
    bookId: string;
    sessionId: string;
    currentText: string;
    continuation: NonNullable<ReturnType<typeof loveFailureContinuationIntent>>;
  }
): Promise<VerifiedLoveContinuation | undefined> {
  try {
    const messages = await readLoveFailureContinuationHistory({
      bookId: input.bookId,
      sessionId: input.sessionId,
      currentText: input.currentText,
      sendCoreCommand: (envelope, timeoutMs) =>
        ctx.supervisor.requestCommand("core", envelope, timeoutMs)
    });
    if (!messages) return undefined;
    const recovery = recoverLoveFailureContinuation(
      messages,
      input.continuation
    );
    if (!recovery) return undefined;

    const readIndex = async () => {
      const result = await ctx.supervisor.requestCommand(
        "core",
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "long.getWorkspaceIndex",
            { bookId: input.bookId },
            { id: randomUUID() }
          )
        ),
        10_000
      );
      if (result.status !== "accepted") return undefined;
      const parsed = LongWorkspaceIndexResultSchema.parse(result.payload);
      return parsed.bookId === input.bookId ? parsed.workspaceIndex : undefined;
    };
    const index = await readIndex();
    if (!index) return undefined;
    const matchingCards = index.plot.chapterCards.filter(
      ({ id }) => id === recovery.chapterCardId
    );
    const matchingChapterEntries = index.chapters.filter(
      ({ chapterCardId }) => chapterCardId === recovery.chapterCardId
    );
    const matchingVolumes = index.plot.volumes.filter(
      ({ id }) => id === recovery.volumeId
    );
    const card = matchingCards[0];
    const chapterEntry = matchingChapterEntries[0];
    const volume = matchingVolumes[0];
    if (
      matchingCards.length !== 1 ||
      matchingChapterEntries.length !== 1 ||
      matchingVolumes.length !== 1 ||
      !card ||
      chapterNumber(card.title) !== recovery.chapter ||
      card.volumeId !== recovery.volumeId ||
      !chapterEntry ||
      !volume
    )
      return undefined;
    const cardContent = await readWholeLongDocument(
      ctx,
      input.bookId,
      chapterEntry.card.id
    );
    if (!cardContent) return undefined;
    const fingerprint = {
      chapterCardSha256: sha256(cardContent),
      volumeId: volume.id,
      volumeSha256: sha256(volume.summary)
    };
    if (
      fingerprint.chapterCardSha256 !== recovery.chapterCardSha256 ||
      fingerprint.volumeId !== recovery.volumeId ||
      fingerprint.volumeSha256 !== recovery.volumeSha256
    )
      return undefined;

    const confirmedIndex = await readIndex();
    const confirmedCards =
      confirmedIndex?.plot.chapterCards.filter(
        ({ id }) => id === recovery.chapterCardId
      ) ?? [];
    const confirmedEntries =
      confirmedIndex?.chapters.filter(
        ({ chapterCardId }) => chapterCardId === recovery.chapterCardId
      ) ?? [];
    const confirmedVolumes =
      confirmedIndex?.plot.volumes.filter(
        ({ id }) => id === recovery.volumeId
      ) ?? [];
    const confirmedCard = confirmedCards[0];
    const confirmedEntry = confirmedEntries[0];
    const confirmedVolume = confirmedVolumes[0];
    if (
      !confirmedIndex ||
      confirmedCards.length !== 1 ||
      confirmedEntries.length !== 1 ||
      confirmedVolumes.length !== 1 ||
      !confirmedCard ||
      !confirmedEntry ||
      !confirmedVolume ||
      JSON.stringify(confirmedCard) !== JSON.stringify(card) ||
      confirmedEntry.card.id !== chapterEntry.card.id ||
      confirmedEntry.card.path !== chapterEntry.card.path ||
      confirmedVolume.summary !== volume.summary
    )
      return undefined;
    return {
      recovery,
      chapter: { id: card.id, title: card.title },
      fingerprint
    };
  } catch {
    return undefined;
  }
}

export async function handleSessionCommands(
  ctx: Pick<
    IpcCommandContext,
    | "activeRuns"
    | "supervisor"
    | "pendingUsageContexts"
    | "terminalRuns"
    | "requireModelConfigStore"
    | "requireWorkspaceAgentConfigStore"
    | "requireLongAgentConfigStore"
    | "requireAgentTeamConfigStore"
    | "requireLibraryAgentConfigStore"
    | "requireGeneralSettingsStore"
  >,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (command.type === "session.user_input_response") {
    try {
      // activeRuns is a Main-side event-stream mirror and can briefly lag the
      // Agent utility that owns the pending question. Forward the response to
      // that authoritative owner; it validates sessionId, runId, requestId and
      // every answer before resolving the waiting tool call.
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope("agent.user_input_response", command.payload, {
          id: command.id,
          context: command.context
        })
      );
      const result = await ctx.supervisor.requestCommand(
        "agent",
        internalCommand,
        10_000
      );
      if (result.status !== "accepted") return result;
      const accepted = SessionUserInputResponseAcceptedPayloadSchema.parse(
        result.payload
      );
      if (
        accepted.sessionId !== command.payload.sessionId ||
        accepted.runId !== command.payload.runId ||
        accepted.requestId !== command.payload.requestId
      ) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "ipc.invalid_agent_user_input_result",
            message: "Agent user-input result does not match the request."
          }
        };
      }
      return { status: "accepted", requestId: command.id, payload: accepted };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "ipc.agent_user_input_failed",
          message:
            error instanceof Error ? error.message : "提交用户回答失败。",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "session.abort") {
    try {
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope("agent.abort", command.payload, {
          id: command.id,
          context: command.context
        })
      );
      const result = await ctx.supervisor.requestCommand(
        "agent",
        internalCommand,
        10_000
      );
      if (result.status === "accepted") {
        const accepted = SessionAbortAcceptedPayloadSchema.parse(
          result.payload
        );
        if (
          accepted.sessionId !== command.payload.sessionId ||
          accepted.runId !== command.payload.runId
        ) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.invalid_agent_abort_result",
              message: "Agent abort result does not match the requested run."
            }
          };
        }
        return { status: "accepted", requestId: command.id, payload: accepted };
      }
      return result;
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "ipc.agent_abort_failed",
          message:
            error instanceof Error ? error.message : "Agent abort failed.",
          details: safeErrorDetails(error)
        }
      };
    }
  }

  if (command.type === "session.prompt") {
    const release = acquireConversationOperation(
      ctx.activeRuns,
      command.payload.sessionId,
      "prompt"
    );
    if (!release)
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "conversation_history.busy",
          message: "此对话正在管理历史，请稍后重试。"
        }
      };
    try {
      const runtimeConfig = await ctx
        .requireModelConfigStore()
        .resolve(command.payload.modelId);
      if (command.payload.webSearchEnabled === true) {
        if (!runtimeConfig || !isDeepSeekWebSearchCompatible(runtimeConfig)) {
          throw new Error(
            "智能搜索仅支持 Provider 为 DeepSeek，且 API 类型为 OpenAI Responses 或 Anthropic Messages 的模型。"
          );
        }
      }
      const shortWorkspace = command.payload.workspaceContext?.shortWorkspace;
      const scriptWorkspace = command.payload.workspaceContext?.scriptWorkspace;
      const longWorkspace = command.payload.workspaceContext?.longWorkspace;
      const libraryWorkspace =
        command.payload.workspaceContext?.libraryWorkspace;
      const creativeWorkspace = shortWorkspace ?? scriptWorkspace;
      const creativeWorkspaceType = scriptWorkspace ? "script" : "short";
      const agentProfile = creativeWorkspace
        ? await ctx
            .requireWorkspaceAgentConfigStore()
            .resolveForWorkspace(creativeWorkspace, creativeWorkspaceType)
        : undefined;
      const longAgentProfile = longWorkspace
        ? await ctx
            .requireLongAgentConfigStore()
            .resolve(longWorkspace.activeAgentId)
        : undefined;
      const { subagentDefinitions, subagentRuntimeConfigs } =
        await resolveAgentTeamRuntime(
          command.payload.agentTeamMode,
          agentProfile
            ? {
                workspaceType: creativeWorkspaceType,
                parentAgentId: agentProfile.id
              }
            : longAgentProfile
              ? {
                  workspaceType: "long",
                  parentAgentId: longAgentProfile.id,
                  ...(longWorkspace ? { bookId: longWorkspace.bookId } : {})
                }
              : undefined,
          {
            resolveDefinitions: (workspaceType, parentAgentId) =>
              ctx
                .requireAgentTeamConfigStore()
                .resolve(
                  workspaceType,
                  parentAgentId,
                  longWorkspace ? { bookId: longWorkspace.bookId } : {}
                ),
            resolveModel: (modelId) =>
              ctx.requireModelConfigStore().resolve(modelId)
          }
        );
      const continuationIntent =
        longWorkspace?.bookId === "longbook_9a146bbe"
          ? loveFailureContinuationIntent(command.payload.message)
          : undefined;
      const verifiedContinuation = continuationIntent
        ? await recoverVerifiedLoveContinuation(ctx, {
            bookId: longWorkspace!.bookId,
            sessionId: command.payload.sessionId,
            currentText: command.payload.message,
            continuation: continuationIntent
          })
        : undefined;
      const writingIntent = continuationIntent
        ? undefined
        : comparisonWritingIntent(command.payload.message);
      const revisionIntent = continuationIntent
        ? undefined
        : loveLocalRevisionIntent(command.payload.message);
      const redraftIntent = continuationIntent
        ? undefined
        : loveRedraftIntent(command.payload.message);
      const proseRequest = writingIntent ?? redraftIntent;
      const namedLoveWriter = Boolean(
        longWorkspace?.bookId === "longbook_9a146bbe" &&
        explicitlyNamesLoveWriter(command.payload.message)
      );
      const mainRequested = explicitlyRequestsMainDraft(
        command.payload.message
      );
      const mainDraftRequested = Boolean(
        proseRequest &&
        (command.payload.agentTeamMode === "team"
          ? mainRequested
          : !namedLoveWriter)
      );
      const parallelQuote = continuationIntent
        ? undefined
        : parallelWritingRequest(command.payload.message);
      const loveTeamWritingRequest = Boolean(
        longWorkspace?.bookId === "longbook_9a146bbe" &&
        command.payload.agentTeamMode === "team" &&
        (writingIntent || parallelQuote || redraftIntent) &&
        !revisionIntent &&
        !continuationIntent
      );
      let continuationTeamSelection: ReturnType<
        typeof selectRecoveredLoveWriters
      >;
      let continuationWriters:
        | import("@deepwrite/contracts").ComparisonDraftWriterContext["writers"]
        | undefined;
      if (verifiedContinuation) {
        const recoveredWriters = verifiedContinuation.recovery.writers;
        const mainWriters = recoveredWriters.filter(({ definitionId }) =>
          definitionId.startsWith("love-writer-main-")
        );
        const teamWriters = recoveredWriters.filter(
          ({ definitionId }) => !definitionId.startsWith("love-writer-main-")
        );
        const supportedMainIds = new Set([
          "love-writer-main-draft",
          "love-writer-main-revision"
        ]);
        const mainRuntimeMatches = mainWriters.every(
          ({ definitionId, runtime }) =>
            supportedMainIds.has(definitionId) &&
            runtimeConfig?.provider === runtime.provider &&
            runtimeConfig.modelId === runtime.model &&
            runtimeConfig.id === runtime.configId
        );
        continuationTeamSelection = teamWriters.length
          ? selectRecoveredLoveWriters({
              writers: teamWriters,
              definitions: subagentDefinitions,
              runtimeConfigs: subagentRuntimeConfigs
            })
          : undefined;
        if (
          mainRuntimeMatches &&
          (!teamWriters.length || continuationTeamSelection)
        )
          continuationWriters = recoveredWriters;
      }
      const loveWriterSelection = continuationWriters
        ? continuationTeamSelection
        : loveTeamWritingRequest
          ? selectLoveWriters({
              authorText: command.payload.message,
              ...(writingIntent?.writerCount !== undefined
                ? { writerCount: writingIntent.writerCount }
                : {}),
              definitions: subagentDefinitions,
              runtimeConfigs: subagentRuntimeConfigs
            })
          : undefined;
      const routedSubagentDefinitions =
        longWorkspace?.bookId === "longbook_9a146bbe"
          ? subagentDefinitions?.filter(
              (definition) =>
                !definition.id.startsWith("love-writer-") ||
                loveWriterSelection?.definitions.some(
                  ({ id }) => id === definition.id
                )
            )
          : subagentDefinitions;
      let longChapter: { id: string; title: string } | undefined =
        longWorkspace?.navigation.chapterCards.find(
          ({ id }) => id === longWorkspace.activeChapterCardId
        );
      if (verifiedContinuation && continuationWriters)
        longChapter = verifiedContinuation.chapter;
      if (
        longWorkspace?.bookId === "longbook_9a146bbe" &&
        (writingIntent || parallelQuote || revisionIntent || redraftIntent)
      ) {
        const reply = await ctx.supervisor.requestCommand(
          "core",
          CommandEnvelopeSchema.parse(
            createEnvelope(
              "long.getWorkspaceIndex",
              {
                bookId: longWorkspace.bookId
              },
              { id: randomUUID() }
            )
          ),
          10_000
        );
        if (reply.status !== "accepted") throw new Error(reply.error.message);
        const { workspaceIndex } = LongWorkspaceIndexResultSchema.parse(
          reply.payload
        );
        const cards = workspaceIndex.plot.chapterCards;
        const requestedChapter =
          writingIntent?.chapter ??
          revisionIntent?.chapter ??
          redraftIntent?.chapter ??
          chapterNumber(parallelQuote ?? "");
        const choices =
          requestedChapter !== undefined
            ? cards.filter(
                (card) => chapterNumber(card.title) === requestedChapter
              )
            : longChapter
              ? cards.filter((card) => card.id === longChapter!.id)
              : cards;
        if (choices.length !== 1)
          throw new Error(
            "本轮创作的章节不唯一，请说明要写第几章；不会从旧摘要猜测。"
          );
        longChapter = choices[0];
      }
      const titleChapter = longChapter
        ? chapterNumber(longChapter.title)
        : undefined;
      const comparisonChapter =
        (verifiedContinuation && continuationWriters
          ? verifiedContinuation.recovery.chapter
          : undefined) ??
        writingIntent?.chapter ??
        revisionIntent?.chapter ??
        redraftIntent?.chapter ??
        (parallelQuote || revisionIntent || redraftIntent
          ? titleChapter
          : undefined);
      const comparisonDraftWriterContext =
        longWorkspace?.bookId === "longbook_9a146bbe" &&
        (continuationWriters ||
          loveWriterSelection ||
          revisionIntent ||
          mainDraftRequested) &&
        comparisonChapter !== undefined &&
        longChapter &&
        titleChapter &&
        titleChapter === comparisonChapter
          ? ComparisonDraftWriterContextSchema.parse({
              authorizationId: randomUUID(),
              ...(verifiedContinuation && continuationWriters
                ? {
                    priorAuthorizationId:
                      verifiedContinuation.recovery.authorizationId,
                    priorAuthorTextSha256:
                      verifiedContinuation.recovery.priorAuthorTextSha256
                  }
                : {}),
              bookId: longWorkspace.bookId,
              chapter: comparisonChapter,
              chapterCardId: longChapter.id,
              ...(verifiedContinuation && continuationWriters
                ? { sourceMode: verifiedContinuation.recovery.sourceMode }
                : redraftIntent && !revisionIntent
                  ? { sourceMode: "redraft" as const }
                  : {}),
              writers:
                verifiedContinuation && continuationWriters
                  ? continuationWriters
                  : [
                      ...(revisionIntent || mainDraftRequested
                        ? [
                            {
                              definitionId: revisionIntent
                                ? "love-writer-main-revision"
                                : "love-writer-main-draft",
                              runtime: runtimeConfig
                                ? {
                                    provider: runtimeConfig.provider,
                                    model: runtimeConfig.modelId,
                                    mode: "provider" as const,
                                    configId: runtimeConfig.id
                                  }
                                : {
                                    mode: "local" as const,
                                    provider: "local",
                                    model: "unknown"
                                  }
                            }
                          ]
                        : []),
                      ...(loveWriterSelection?.writers ?? [])
                    ],
              authorRequest: {
                requestId: command.id,
                exactText: command.payload.message,
                authorizationQuote:
                  continuationIntent?.quote ??
                  revisionIntent?.quote ??
                  redraftIntent?.quote ??
                  writingIntent?.quote ??
                  parallelQuote!,
                receivedAt: new Date().toISOString()
              }
            })
          : undefined;
      const libraryAgentProfile = libraryWorkspace
        ? await ctx
            .requireLibraryAgentConfigStore()
            .resolve(libraryWorkspace.domain)
        : undefined;
      const { thinkingLevel, temperature } = resolveModelRunSettings(
        runtimeConfig,
        {
          thinkingLevel: command.payload.thinkingLevel,
          temperature: command.payload.temperature
        }
      );
      const {
        agentTeamMode: _requestedAgentTeamMode,
        thinkingLevel: _requestedThinkingLevel,
        temperature: _requestedTemperature,
        ...promptPayload
      } = command.payload;
      const compaction = await resolveContextCompactionRun(
        async () => (await ctx.requireGeneralSettingsStore().list()).settings,
        (modelId) => ctx.requireModelConfigStore().resolve(modelId),
        runtimeConfig?.id
      );
      const usageContext = createUsageRunContext(
        usageModuleForPrompt(command.payload),
        runtimeConfig,
        withCompactionUsageConfig(subagentRuntimeConfigs, compaction)
      );
      ctx.pendingUsageContexts.set(command.context.correlationId, usageContext);
      const libraryManagement = await prepareLibraryManagementRunContext(
        command.payload.workspaceContext,
        ctx.requireAgentTeamConfigStore(),
        ctx.requireLibraryAgentConfigStore(),
        (query) => ctx.supervisor.requestCommand("core", query, 60_000)
      );
      const materialWorkspaceContext = await prepareMaterialRunContext(
        {
          workspaceContext: command.payload.workspaceContext,
          ...(agentProfile ? { agentProfile } : {}),
          ...(longAgentProfile ? { longAgentProfile } : {}),
          snapshotMode: process.env.DEEPWRITE_MATERIAL_SNAPSHOT_MODE === "1"
        },
        (query) => ctx.supervisor.requestCommand("core", query, 60_000)
      );
      const ruleWorkspaceContext = await prepareLongRequiredRuleContext(
        materialWorkspaceContext,
        (query) => ctx.supervisor.requestCommand("core", query, 60_000)
      );
      const voicePreparedWorkspaceContext = await prepareLoveApprovedVoiceContext(
        ruleWorkspaceContext,
        (query) => ctx.supervisor.requestCommand("core", query, 60_000),
        {
          required: Boolean(
            proseRequest || revisionIntent || comparisonDraftWriterContext
          )
        }
      );
      const preparedWorkspaceContext = await prepareNativeWritingReferenceContext(
        voicePreparedWorkspaceContext,
        (query) => ctx.supervisor.requestCommand("core", query, 60_000),
        {
          required: Boolean(
            proseRequest || revisionIntent || comparisonDraftWriterContext
          ),
          ...(comparisonDraftWriterContext?.chapterCardId ?? longChapter?.id
            ? {
                targetChapterCardId:
                  comparisonDraftWriterContext?.chapterCardId ?? longChapter!.id
              }
            : {})
        }
      );
      const internalCommand = CommandEnvelopeSchema.parse(
        createEnvelope(
          "agent.prompt",
          {
            ...promptPayload,
            ...(libraryManagement ? { libraryManagement } : {}),
            ...(preparedWorkspaceContext
              ? { workspaceContext: preparedWorkspaceContext }
              : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(runtimeConfig ? { runtimeConfig } : {}),
            ...compaction,
            ...(agentProfile
              ? scriptWorkspace
                ? { scriptAgentProfile: agentProfile }
                : { agentProfile }
              : {}),
            ...(longAgentProfile ? { longAgentProfile } : {}),
            ...(routedSubagentDefinitions
              ? { subagentDefinitions: routedSubagentDefinitions }
              : {}),
            ...(comparisonDraftWriterContext
              ? { comparisonDraftWriterContext }
              : {}),
            ...(Object.keys(subagentRuntimeConfigs).length > 0
              ? { subagentRuntimeConfigs }
              : {}),
            ...(libraryAgentProfile ? { libraryAgentProfile } : {})
          },
          { id: command.id, context: command.context }
        )
      );
      const result = await ctx.supervisor.requestCommand(
        "agent",
        internalCommand,
        10_000
      );
      if (result.status === "accepted") {
        const accepted = SessionPromptAcceptedPayloadSchema.parse(
          result.payload
        );
        if (accepted.sessionId !== command.payload.sessionId) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.invalid_agent_acceptance",
              message:
                "Agent acceptance sessionId does not match the prompt command."
            }
          };
        }
        const provisional = [...ctx.activeRuns.entries()].find(
          ([, run]) => run.correlationId === command.context.correlationId
        );
        if (provisional && provisional[0] !== accepted.runId) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "ipc.invalid_agent_acceptance",
              message:
                "Agent acceptance runId does not match the provisional event stream."
            }
          };
        }
        if (!ctx.terminalRuns.has(accepted.runId)) {
          ctx.activeRuns.set(accepted.runId, {
            sessionId: accepted.sessionId,
            correlationId: command.context.correlationId,
            runtime: accepted.runtime,
            accepted: true,
            promptRequestId: internalCommand.id,
            reviewAuthorText: promptPayload.message,
            ...(libraryManagement
              ? { libraryManagementScope: libraryManagement.scope }
              : {}),
            ...(materialWorkspaceContext?.materialCatalog
              ? {
                  materialScope: materialWorkspaceContext.materialCatalog.scope
                }
              : {}),
            usageContext,
            ...(longWorkspace ? { resourceId: longWorkspace.bookId } : {}),
            ...(comparisonDraftWriterContext
              ? { comparisonDraftWriterContext }
              : {}),
            ...(verifiedContinuation && continuationWriters
              ? {
                  comparisonDraftSourceFingerprint:
                    verifiedContinuation.fingerprint
                }
              : {})
          });
        }
        ctx.pendingUsageContexts.delete(command.context.correlationId);
        return { status: "accepted", requestId: command.id, payload: accepted };
      }
      ctx.pendingUsageContexts.delete(command.context.correlationId);
      return result;
    } catch (error: unknown) {
      ctx.pendingUsageContexts.delete(command.context.correlationId);
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "ipc.agent_command_failed",
          message:
            error instanceof Error ? error.message : "Agent command failed.",
          details: safeErrorDetails(error)
        }
      };
    } finally {
      release();
    }
  }
  return undefined;
}
