import type { MaterialQueryRunner } from "../material-query-runtime";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  AgentWriteApprovalMode,
  CommandResult,
  LongAgentProfile,
  LongChapterBodyChange,
  LongCharacterFileChange,
  LongCommitChapterInput,
  LongContinuityFileChange,
  LongWorkspaceCommandEnvelope,
  LongWorkspaceOperationBatch,
  LongWorkspaceRuntimeContext,
  LongPrepareComparisonDraftCommandEnvelope,
  LongDeliverComparisonDraftCommandEnvelope,
  LongPrepareLoveReviewCommandEnvelope,
  LongSubmitLoveReviewCommandEnvelope,
  LongLoveChapterWorkflowCommandEnvelope,
  LongPrepareLoveLocalRevisionCommandEnvelope,
  LongApplyLoveLocalRevisionCommandEnvelope,
  LongWorldbuildingFileChange,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { createLongToolContext } from "./context";
import {
  buildLoadSkillTool,
  buildQueryLinkedMaterialEntriesTool
} from "./catalog-tools";
import { buildListTool } from "./tool-list";
import { buildReadTool } from "./tool-read";
import { buildCreateTool } from "./tool-create";
import { buildEditTool } from "./tool-edit";
import { buildDeleteTool } from "./tool-delete";
import { buildLedgerCommitTool } from "./ledger-tools";
import { buildAskUserQuestionTool } from "./tool-ask-user-question";
import { buildSourceImportProposalTool } from "./tool-source-import";
import { buildQueryImportedSourcesTool } from "./tool-imported-sources";
import { buildPrepareCodexReviewTool } from "./tool-prepare-codex-review";
import type { AgentUserInputRequester } from "../runtime-types";
import type { LongWorkspaceToolSharedState } from "./proposal-overlay";
import { buildLongComparisonDraftTools } from "./tool-comparison-draft";
import { buildLoveChapterWorkflowTool } from "./tool-love-chapter-workflow";
import { buildLoveLocalRevisionTools } from "./tool-love-local-revision";

export type LongQueryCommandEnvelope = Extract<
  LongWorkspaceCommandEnvelope,
  {
    type:
      | "long.getWorkspaceIndex"
      | "long.readDocument"
      | "long.search"
      | "long.querySourceFolder"
      | "long.prepareCodexReview";
  }
>;

export type LongCommandExecutor = (
  command:
    | LongQueryCommandEnvelope
    | LongPrepareLoveReviewCommandEnvelope
    | LongSubmitLoveReviewCommandEnvelope
    | LongLoveChapterWorkflowCommandEnvelope,
  signal?: AbortSignal
) => Promise<CommandResult>;

export type LongComparisonDraftExecutor = (
  command:
    | LongPrepareComparisonDraftCommandEnvelope
    | LongDeliverComparisonDraftCommandEnvelope
    | LongPrepareLoveLocalRevisionCommandEnvelope
    | LongApplyLoveLocalRevisionCommandEnvelope,
  signal?: AbortSignal
) => Promise<CommandResult>;

export type LongAgentToolDetails =
  | { kind: "none" }
  | {
      kind: "long-mutation-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      summary: string;
    }
  | {
      kind: "long-worldbuilding-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      summary: string;
      files: LongWorldbuildingFileChange[];
    }
  | {
      kind: "long-character-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      summary: string;
      files: LongCharacterFileChange[];
    }
  | {
      kind: "long-continuity-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      summary: string;
      files: LongContinuityFileChange[];
    }
  | {
      kind: "long-chapter-write-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      file: LongChapterBodyChange;
      summary: string;
    }
  | {
      kind: "long-ledger-commit-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      input: LongCommitChapterInput;
      summary: string;
    };

export interface BuildLongWorkspaceToolsInput {
  workspace: LongWorkspaceRuntimeContext;
  profile: LongAgentProfile;
  sessionId: string;
  runId: string;
  writeApprovalMode?: AgentWriteApprovalMode;
  autoApproveCrossStageOperations?: boolean;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  queryMaterials?: MaterialQueryRunner | undefined;
  executor?: LongCommandExecutor;
  comparisonDraftWriterContext?: import("@deepwrite/contracts").ComparisonDraftWriterContext;
  comparisonDraftExecutor?: LongComparisonDraftExecutor;
  childRuntime?: import("@deepwrite/contracts").AgentRuntimeRef;
  childDefinitionId?: string;
  authorActionEvidence?: { requestId: string; quote: string };
  requestUserInput?: AgentUserInputRequester;
  includeAskUserQuestion?: boolean;
  sharedState?: LongWorkspaceToolSharedState;
  /** Called with a reset hook for when compaction drops earlier reads. */
  onContextCompacted?: (listener: () => void) => void;
}

/**
 * The unified long-form tool surface: five CRUD tools over every stage, plus
 * the material, skill and ledger-commit tools.
 */
export function buildLongWorkspaceTools(
  input: BuildLongWorkspaceToolsInput
): AgentTool[] {
  const ctx = createLongToolContext(input);
  const tools: AgentTool[] = [
    buildQueryLinkedMaterialEntriesTool(input),
    buildLoadSkillTool(input)
  ];
  if (input.includeAskUserQuestion !== false) {
    tools.push(buildAskUserQuestionTool(ctx));
  }
  if (ctx.capabilities.has("query_structure")) {
    tools.push(
      buildListTool(ctx),
      buildReadTool(ctx),
      buildQueryImportedSourcesTool(ctx),
      buildSourceImportProposalTool(ctx)
    );
  }
  if (ctx.writableRoots.size > 0) {
    tools.push(buildCreateTool(ctx), buildEditTool(ctx), buildDeleteTool(ctx));
  }
  if (ctx.capabilities.has("commit_ledger")) {
    tools.push(buildLedgerCommitTool(ctx));
  }
  const codexReviewTool = buildPrepareCodexReviewTool(ctx);
  if (codexReviewTool) tools.push(codexReviewTool);
  if (
    input.workspace.bookId === "longbook_9a146bbe" &&
    input.executor &&
    !input.childDefinitionId
  ) {
    tools.push(
      buildLoveChapterWorkflowTool({
        bookId: input.workspace.bookId,
        sessionId: input.sessionId,
        runId: input.runId,
        executor: input.executor,
        ...(input.authorActionEvidence
          ? { authorActionEvidence: input.authorActionEvidence }
          : {})
      })
    );
  }
  if (
    input.comparisonDraftWriterContext &&
    input.comparisonDraftExecutor &&
    (!input.childDefinitionId ||
      (input.childRuntime &&
        input.childDefinitionId.startsWith("love-writer-")))
  ) {
    const comparisonTools = buildLongComparisonDraftTools({
      context: input.comparisonDraftWriterContext,
      longContext: ctx,
      runtime:
        input.childRuntime ??
        input.comparisonDraftWriterContext.writers[0]!.runtime,
      definitionId:
        input.childDefinitionId ??
        (input.comparisonDraftWriterContext.writers[0]?.definitionId ===
        "love-writer-main-draft"
          ? "love-writer-main-draft"
          : "love-writer-preflight"),
      sessionId: input.sessionId,
      runId: input.runId,
      ...(input.onContextCompacted
        ? { onContextCompacted: input.onContextCompacted }
        : {}),
      executor: input.comparisonDraftExecutor
    });
    // The parent can inspect sources/preflight before paying for child runs.
    // A Main-minted solo draft capability also permits the actual parent model.
    tools.push(
      ...(input.childDefinitionId ||
      input.comparisonDraftWriterContext.writers[0]?.definitionId ===
        "love-writer-main-draft"
        ? comparisonTools
        : comparisonTools.slice(0, 1))
    );
    if (
      !input.childDefinitionId &&
      input.comparisonDraftWriterContext.writers[0]?.definitionId ===
        "love-writer-main-revision"
    ) {
      tools.push(
        ...buildLoveLocalRevisionTools({
          context: input.comparisonDraftWriterContext,
          runtime: input.comparisonDraftWriterContext.writers[0].runtime,
          sessionId: input.sessionId,
          runId: input.runId,
          executor: input.comparisonDraftExecutor,
          ...(input.onContextCompacted
            ? { onContextCompacted: input.onContextCompacted }
            : {})
        })
      );
    }
  }
  return tools;
}

export { isLongAgentToolDetails } from "./tool-details";
export { createLongWorkspaceToolSharedState } from "./proposal-overlay";
export type { LongWorkspaceToolSharedState } from "./proposal-overlay";
export type {
  LongReadDocumentResult,
  LongSearchResult
} from "@deepwrite/contracts";
