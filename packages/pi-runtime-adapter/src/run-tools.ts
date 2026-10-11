import type {
  AgentMessage,
  AgentTool,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import type { AgentRunInput, AgentUserInputRequester } from "./runtime-types";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import type { PortableToolSchemaProfile } from "./portable-tool-schema";
import { createLibraryManagementRuntime } from "./library-management-runtime";
import { createMaterialQueryRunner } from "./material-query-runtime";
import { buildLibraryAgentTools } from "./library-agent-tools";
import {
  buildLongWorkspaceTools,
  createLongWorkspaceToolSharedState
} from "./long-agent-tools";
import { detectLongSourceImportIntent } from "@deepwrite/contracts";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools,
  createScriptWorkspaceToolSharedState,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import { buildSubagentAuthoringTools } from "./subagent-authoring-tools";
import { buildSubagentMaterialContext } from "./prompts-material";
import {
  buildSpawnSubagentTool,
  buildSpawnSubagentsBatchTool
} from "./subagent-runtime";
import { workspaceContextPolicy } from "./workspace-context-policy";
import type { LoveReviewRunState } from "./love-review-runtime";
import { buildPrepareLoveReviewTool } from "./love-review-prepare-tool";
import { finalizeLoveReviewActualOutput } from "./love-review-finalizer";
import { buildProviderRuntime, toPiThinkingLevel } from "./provider-runtime";
import { buildPublicWebTools } from "./public-web-tools";
import { buildLongSubagentRequirements } from "./long-subagent-requirements";
import {
  scriptRuntimeSystemRequirements,
  shortRuntimeSystemRequirements
} from "./prompts";

const LONG_SOURCE_IMPORT_READONLY_TOOLS = new Set([
  "query_linked_material_entries",
  "load_skill",
  "ask_user_question",
  "list",
  "read",
  "query_imported_sources",
  "propose_long_source_import"
]);

export function restrictLongSourceImportTools(
  tools: AgentTool[],
  prompt: string
): AgentTool[] {
  if (!detectLongSourceImportIntent(prompt)) return tools;
  return tools.filter((tool) =>
    LONG_SOURCE_IMPORT_READONLY_TOOLS.has(tool.name)
  );
}
export interface BuildRunToolsOptions extends Pick<
  BuildSpawnSubagentToolInput,
  | "model"
  | "streamFn"
  | "parentRuntime"
  | "parentSignal"
  | "toolExecutionHooks"
  | "retryPolicy"
  | "timeoutMs"
> {
  parentRuntime: NonNullable<BuildSpawnSubagentToolInput["parentRuntime"]>;
  toolExecutionHooks: NonNullable<
    BuildSpawnSubagentToolInput["toolExecutionHooks"]
  >;
  thinkingLevel: PiThinkingLevel;
  requestUserInput: AgentUserInputRequester;
  getParentMessages: () => readonly AgentMessage[];
  portableToolSchemaProfile: PortableToolSchemaProfile;
  subagentTimeoutMs?: number;
  onContextCompacted?: (listener: () => void) => void;
  loveReviewRunState?: LoveReviewRunState;
}
export function buildRunTools(
  input: AgentRunInput,
  options: BuildRunToolsOptions
): AgentTool[] {
  const {
    model,
    thinkingLevel: effectiveThinkingLevel,
    streamFn: spawnStreamFn,
    parentRuntime: runtime,
    requestUserInput,
    portableToolSchemaProfile
  } = options;
  const {
    shortWorkspace,
    scriptWorkspace,
    longWorkspace,
    libraryWorkspace,
    subagentAuthoring
  } = input.workspaceContext ?? {};
  const explicitSourceImport = Boolean(
    longWorkspace &&
    input.longAgentProfile &&
    detectLongSourceImportIntent(input.prompt)
  );
  const writingToolSharedState =
    scriptWorkspace && input.scriptAgentProfile
      ? createScriptWorkspaceToolSharedState(scriptWorkspace)
      : shortWorkspace && input.agentProfile
        ? createShortWorkspaceToolSharedState(shortWorkspace)
        : undefined;
  const longToolSharedState =
    longWorkspace && input.longAgentProfile
      ? createLongWorkspaceToolSharedState()
      : undefined;
  const buildWritingTools = (
    onContextCompacted = options.onContextCompacted
  ): AgentTool[] => {
    if (scriptWorkspace && input.scriptAgentProfile) {
      return buildScriptWorkspaceTools({
        workspace: scriptWorkspace,
        profile: input.scriptAgentProfile,
        writeApprovalMode: input.writeApprovalMode ?? "request-approval",
        autoApproveCrossStageOperations:
          input.autoApproveCrossStageOperations === true,
        attachedSkills: input.workspaceContext?.attachedSkills,
        attachedMaterials: input.workspaceContext?.attachedMaterials,
        queryMaterials: createMaterialQueryRunner(input),
        requestUserInput,
        ...(onContextCompacted ? { onContextCompacted } : {}),
        ...(writingToolSharedState
          ? { sharedState: writingToolSharedState }
          : {})
      });
    }
    return shortWorkspace && input.agentProfile
      ? buildShortWorkspaceTools({
          workspace: shortWorkspace,
          profile: input.agentProfile,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          autoApproveCrossStageOperations:
            input.autoApproveCrossStageOperations === true,
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials,
          queryMaterials: createMaterialQueryRunner(input),
          requestUserInput,
          ...(onContextCompacted ? { onContextCompacted } : {}),
          ...(writingToolSharedState
            ? { sharedState: writingToolSharedState }
            : {})
        })
      : [];
  };
  const buildLongTools = (
    includeAskUserQuestion = true,
    onContextCompacted = options.onContextCompacted,
    childDefinition?: BuildSpawnSubagentToolInput["definitions"][number],
    childRuntime?: BuildSpawnSubagentToolInput["parentRuntime"]
  ): AgentTool[] =>
    longWorkspace && input.longAgentProfile
      ? [
          ...buildLongWorkspaceTools({
            workspace: longWorkspace,
            profile: input.longAgentProfile,
            sessionId: input.sessionId,
            runId: input.runId,
            writeApprovalMode: input.writeApprovalMode ?? "request-approval",
            autoApproveCrossStageOperations:
              input.autoApproveCrossStageOperations === true,
            attachedSkills: input.workspaceContext?.attachedSkills,
            attachedMaterials: input.workspaceContext?.attachedMaterials,
            queryMaterials: createMaterialQueryRunner(input),
            ...(input.longCommandExecutor
              ? { executor: input.longCommandExecutor }
              : {}),
            ...(input.comparisonDraftWriterContext
              ? {
                  comparisonDraftWriterContext:
                    input.comparisonDraftWriterContext
                }
              : {}),
            ...(input.comparisonDraftExecutor
              ? { comparisonDraftExecutor: input.comparisonDraftExecutor }
              : {}),
            ...(childRuntime ? { childRuntime } : {}),
            ...(childDefinition
              ? { childDefinitionId: childDefinition.id }
              : {}),
            requestUserInput,
            includeAskUserQuestion,
            ...(!childDefinition && longWorkspace.bookId === "longbook_9a146bbe"
              ? {
                  authorActionEvidence: {
                    requestId: input.runId,
                    quote: input.prompt.slice(0, 2_000)
                  }
                }
              : {}),
            ...(onContextCompacted ? { onContextCompacted } : {}),
            ...(longToolSharedState ? { sharedState: longToolSharedState } : {})
          }),
          ...buildPublicWebTools()
        ]
      : [];
  const management = createLibraryManagementRuntime(input);
  let tools: AgentTool[] = subagentAuthoring
    ? buildSubagentAuthoringTools(subagentAuthoring)
    : libraryWorkspace && input.libraryAgentProfile
      ? buildLibraryAgentTools({
          workspace: libraryWorkspace,
          profile: input.libraryAgentProfile,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          attachedSkills: input.workspaceContext?.attachedSkills
        })
      : longWorkspace && input.longAgentProfile
        ? buildLongTools()
        : (scriptWorkspace && input.scriptAgentProfile) ||
            (shortWorkspace && input.agentProfile)
          ? buildWritingTools()
          : [];
  if (
    ((scriptWorkspace && input.scriptAgentProfile) ||
      (shortWorkspace && input.agentProfile) ||
      (longWorkspace && input.longAgentProfile)) &&
    !subagentAuthoring &&
    !explicitSourceImport
  ) {
    const parentPolicy = workspaceContextPolicy(input);
    const childContextPolicy = parentPolicy && {
      settings: parentPolicy.settings,
      task: parentPolicy.task,
      toolCompactors: parentPolicy.toolCompactors,
      ...(parentPolicy.rehydrate ? { rehydrate: parentPolicy.rehydrate } : {})
    };
    const subagentInput: BuildSpawnSubagentToolInput = {
      parentSessionId: input.sessionId,
      ...((options.parentSignal ?? input.signal)
        ? { parentSignal: options.parentSignal ?? input.signal }
        : {}),
      parentRuntime: runtime,
      model,
      thinkingLevel: effectiveThinkingLevel,
      streamFn: spawnStreamFn,
      definitions: [
        ...(input.subagentDefinitions ?? []),
        ...management.definitions
      ],
      ...(input.comparisonDraftWriterContext
        ? { comparisonDraftWriterContext: input.comparisonDraftWriterContext }
        : {}),
      ...(input.comparisonDraftExecutor
        ? { comparisonDraftExecutor: input.comparisonDraftExecutor }
        : {}),
      prepareChild: management.prepareChild,
      getParentMessages: options.getParentMessages,
      ...(childContextPolicy ? { contextPolicy: childContextPolicy } : {}),
      materialContext: buildSubagentMaterialContext(input),
      approvedVoicePackage: longWorkspace?.approvedVoicePackage,
      selectedDraftReferences: longWorkspace?.selectedDraftReferences,
      selectedChapterOutline: longWorkspace?.selectedChapterOutline,
      ...(input.subagentRuntimeConfigs
        ? { subagentRuntimeConfigs: input.subagentRuntimeConfigs }
        : {}),
      ...(longWorkspace?.bookId === "longbook_9a146bbe" &&
      input.longCommandExecutor
        ? {
            loveReviewExecutor: input.longCommandExecutor,
            loveReviewAuthorText: input.prompt,
            loveReviewCoordinates: {
              bookId: longWorkspace.bookId,
              sessionId: input.sessionId,
              runId: input.runId
            }
          }
        : {}),
      ...(options.loveReviewRunState
        ? { loveReviewRunState: options.loveReviewRunState }
        : {}),
      enabledSubagentRuntimeDefinitions: input.subagentDefinitions ?? [],
      buildCustomModelRuntime: (config, options) => {
        const childThinking =
          options?.thinkingLevel ?? config.defaultThinkingLevel ?? "medium";
        const childTemperature =
          childThinking === "off"
            ? (options?.temperature ?? config.temperatureOptions[1])
            : undefined;
        const childRuntime = buildProviderRuntime(
          config,
          childTemperature,
          childThinking,
          { portableToolSchemaProfile }
        );
        return {
          model: childRuntime.model,
          streamFn: childRuntime.streamFn,
          thinkingLevel: toPiThinkingLevel(childThinking)
        };
      },
      buildChildTools:
        longWorkspace && input.longAgentProfile
          ? (listener, definition, childRuntime) =>
              buildLongTools(false, listener, definition, childRuntime)
          : buildWritingTools,
      ...(scriptWorkspace
        ? {
            systemPromptRequirements: scriptRuntimeSystemRequirements(input)
          }
        : shortWorkspace
          ? {
              systemPromptRequirements: shortRuntimeSystemRequirements(input)
            }
          : longWorkspace
            ? {
                systemPromptRequirements: buildLongSubagentRequirements(input)
              }
            : {}),
      toolExecutionHooks: options.toolExecutionHooks,
      ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
      ...(options.subagentTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.subagentTimeoutMs }),
      depth: 0
    };
    if (options.loveReviewRunState && subagentInput.loveReviewCoordinates) {
      options.loveReviewRunState.finalizeActualOutput = async (
        content,
        parentRuntime,
        onProgress,
        reviseSummary
      ) => {
        if (!options.loveReviewRunState?.latestReviewId)
          return options.loveReviewRunState?.requested
            ? { reviewNotice: "not_started" }
            : undefined;
        try {
          const reviewCoverage = await finalizeLoveReviewActualOutput({
            subagentInput,
            state: options.loveReviewRunState,
            content,
            runtime: parentRuntime,
            ...(reviseSummary ? { reviseSummary } : {}),
            ...(onProgress ? { onProgress } : {})
          });
          return reviewCoverage
            ? {
                reviewCoverage,
                ...(options.loveReviewRunState.correctedContent
                  ? { content: options.loveReviewRunState.correctedContent }
                  : {})
              }
            : undefined;
        } catch {
          const existing = options.loveReviewRunState?.latestReviewId
            ? options.loveReviewRunState.reviews.get(
                options.loveReviewRunState.latestReviewId
              )?.coverage
            : undefined;
          return existing
            ? {
                reviewCoverage: {
                  ...existing,
                  state:
                    existing.state === "ready"
                      ? "needs_independent_review"
                      : existing.state
                }
              }
            : { reviewNotice: "not_started" };
        }
      };
    }
    const prepareReviewTool = buildPrepareLoveReviewTool(subagentInput);
    if (prepareReviewTool) tools = [...tools, prepareReviewTool];
    const spawnTool = buildSpawnSubagentTool(subagentInput);
    const batchTool = buildSpawnSubagentsBatchTool(subagentInput);
    if (spawnTool) tools = [...tools, spawnTool];
    if (batchTool) tools = [...tools, batchTool];
  }

  if (longWorkspace?.readOnly) {
    const permitted = new Set([
      "list",
      "read",
      "load_skill",
      "query_linked_material_entries"
    ]);
    return tools.filter((tool) => permitted.has(tool.name));
  }
  return explicitSourceImport
    ? restrictLongSourceImportTools(tools, input.prompt)
    : tools;
}
