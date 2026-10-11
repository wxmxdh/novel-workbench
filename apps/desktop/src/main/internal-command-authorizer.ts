import type {
  CommandEnvelope,
  MaterialReadScope,
  LibraryManagementScope
} from "@deepwrite/contracts";
import type {
  UtilityInternalCommandAuthorizationContext,
  UtilityInternalCommandAuthorizationResult
} from "./supervisor";
import {
  loveLocalRevisionIntent,
  loveWorkflowActionAuthorized,
  loveWorkflowAnnotationContextAuthorized
} from "./love-workflow-intent";

export const AGENT_CORE_LONG_QUERY_COMMANDS = [
  "long.getWorkspaceIndex",
  "long.readDocument",
  "long.querySourceFolder",
  "long.search"
] as const satisfies readonly CommandEnvelope["type"][];

export const AGENT_CORE_LONG_EXPORT_COMMANDS = [
  "long.prepareCodexReview",
  "long.prepareLoveReview",
  "long.submitLoveReview",
  "long.loveChapterWorkflow"
] as const satisfies readonly CommandEnvelope["type"][];

export const AGENT_CORE_COMPARISON_DRAFT_COMMANDS = [
  "long.prepareComparisonDraft",
  "long.deliverComparisonDraft",
  "long.prepareLoveLocalRevision",
  "long.applyLoveLocalRevision"
] as const satisfies readonly CommandEnvelope["type"][];

/** Transport admission only; each request still requires run-bound authorization. */
export const AGENT_CORE_COMMANDS = [
  ...AGENT_CORE_LONG_QUERY_COMMANDS,
  ...AGENT_CORE_LONG_EXPORT_COMMANDS,
  ...AGENT_CORE_COMPARISON_DRAFT_COMMANDS,
  "catalog.queryMaterials",
  "catalog.queryLibraryManagement"
] as const;

const LONG_QUERY_COMMAND_TYPES = new Set<string>([
  ...AGENT_CORE_LONG_QUERY_COMMANDS,
  ...AGENT_CORE_LONG_EXPORT_COMMANDS
]);

export interface MainInternalCommandActiveRun {
  sessionId: string;
  /** Present only for a long-form run accepted from Main's session.prompt. */
  resourceId?: string;
  /** Main->Agent transport request that created the accepted run. */
  promptRequestId?: string;
  accepted: boolean;
  reviewAuthorText?: string;
  materialScope?: MaterialReadScope;
  libraryManagementScope?: LibraryManagementScope;
  comparisonDraftWriterContext?: import("@deepwrite/contracts").ComparisonDraftWriterContext;
  /** Main-derived chapter/volume content hashes for recovered retries. */
  comparisonDraftSourceFingerprint?: {
    chapterCardSha256: string;
    volumeId: string;
    volumeSha256: string;
  };
}

function denied(
  code: string,
  message: string
): UtilityInternalCommandAuthorizationResult {
  return { authorized: false, code, message };
}

/**
 * Authorizes reads, exports and scoped deliveries for Main-accepted runs.
 * All compared identities originate from the validated session.prompt and
 * its acceptance chain; command context supplied by Agent is only evidence
 * to compare, never the source of authority.
 */
export function authorizeMainInternalCommand(
  context: UtilityInternalCommandAuthorizationContext,
  activeRuns: ReadonlyMap<string, MainInternalCommandActiveRun>
): UtilityInternalCommandAuthorizationResult {
  const { source, target, message } = context;
  if (source !== "agent" || message.worker !== "agent" || target !== "core") {
    return denied(
      "main.invalid_bridge_route",
      "Only Agent-to-Core internal commands are authorized."
    );
  }
  if (message.command.type === "catalog.queryLibraryManagement") {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    const scope = run?.libraryManagementScope;
    if (
      !run?.accepted ||
      !scope ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== scope.bookId ||
      command.payload.scope.bookId !== scope.bookId ||
      command.payload.scope.bookType !== scope.bookType
    ) {
      return denied(
        "main.library_management_not_authorized",
        "Library management queries require the accepted owning work and prompt."
      );
    }
    return true;
  }
  if (
    message.command.type === "long.prepareComparisonDraft" ||
    message.command.type === "long.deliverComparisonDraft"
  ) {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    const capability = run?.comparisonDraftWriterContext;
    const payload = command.payload;
    const recoveredSourceChanged =
      command.type === "long.prepareComparisonDraft" &&
      capability?.priorAuthorizationId !== undefined &&
      (!run?.comparisonDraftSourceFingerprint ||
        command.payload.chapterCardSha256 !==
          run.comparisonDraftSourceFingerprint.chapterCardSha256 ||
        command.payload.volumeId !==
          run.comparisonDraftSourceFingerprint.volumeId ||
        command.payload.volumeSha256 !==
          run.comparisonDraftSourceFingerprint.volumeSha256);
    if (
      !run?.accepted ||
      !capability ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== capability.bookId ||
      payload.bookId !== capability.bookId ||
      payload.authorizationId !== capability.authorizationId ||
      (command.type === "long.prepareComparisonDraft" &&
        (command.payload.chapter !== capability.chapter ||
          command.payload.chapterCardId !== capability.chapterCardId ||
          command.payload.authorRequestId !==
            capability.authorRequest.requestId ||
          (command.payload.sourceMode ?? "independent") !==
            (capability.sourceMode ?? "independent") ||
          JSON.stringify(command.payload.authorRequest) !==
            JSON.stringify(capability.authorRequest) ||
          (capability.priorAuthorizationId !== undefined &&
            recoveredSourceChanged))) ||
      (command.type === "long.deliverComparisonDraft" &&
        !capability?.writers.some(
          (writer) =>
            writer.definitionId === command.payload.definitionId &&
            writer.runtime.mode === command.payload.runtime.mode &&
            writer.runtime.configId === command.payload.runtime.configId &&
            writer.runtime.model === command.payload.runtime.model &&
            writer.runtime.provider === command.payload.runtime.provider
        ))
    ) {
      return denied(
        recoveredSourceChanged
          ? "main.comparison_draft_source_changed"
          : "main.comparison_draft_not_authorized",
        recoveredSourceChanged
          ? "本轮章节或卷次资料已变化，请先重新核对当前材料；未重写已保存稿。"
          : "本轮没有可执行的指定稿件任务，请说明缺失目标；讨论仍可继续。"
      );
    }
    return true;
  }
  if (
    message.command.type === "long.prepareLoveLocalRevision" ||
    message.command.type === "long.applyLoveLocalRevision"
  ) {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    const capability = run?.comparisonDraftWriterContext;
    if (
      !run?.accepted ||
      !capability ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== capability.bookId ||
      command.payload.bookId !== capability.bookId ||
      command.payload.authorizationId !== capability.authorizationId
    )
      return denied(
        "main.local_revision_not_authorized",
        "Local revision requires this accepted chapter task and source preparation."
      );
    if (
      command.type === "long.applyLoveLocalRevision" &&
      command.payload.action === "deliver"
    ) {
      if (
        !loveLocalRevisionIntent(run.reviewAuthorText ?? "") ||
        !command.payload.authorRevisionEvidence ||
        !capability.writers.some(
          ({ runtime }) =>
            runtime.mode === command.payload.runtime?.mode &&
            runtime.provider === command.payload.runtime?.provider &&
            runtime.model === command.payload.runtime?.model &&
            runtime.configId === command.payload.runtime?.configId
        )
      )
        return denied(
          "main.local_revision_delivery_not_authorized",
          "Saving a revision requires the author's current revision instruction and actual running model."
        );
    }
    return true;
  }
  if (
    message.target === "core" &&
    message.command.type === "catalog.queryMaterials"
  ) {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    const scope = run?.materialScope;
    const requested = command.payload.scope;
    if (
      !run?.accepted ||
      !scope ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== scope.bookId
    ) {
      return denied(
        "main.material_run_not_authorized",
        "Material queries require the active accepted run and its prompt context."
      );
    }
    if (
      requested.bookId !== scope.bookId ||
      requested.bookType !== scope.bookType ||
      requested.stageId !== scope.stageId ||
      requested.kinds.some((kind) => !scope.kinds.includes(kind))
    ) {
      return denied(
        "main.material_scope_mismatch",
        "Material queries cannot expand the accepted book, stage or kinds."
      );
    }
    return true;
  }
  if (
    message.target !== "core" ||
    !LONG_QUERY_COMMAND_TYPES.has(message.command.type)
  ) {
    return denied(
      "main.command_not_long_query",
      "Only long-form query commands are authorized."
    );
  }

  const command = message.command;
  if (
    command.type !== "long.getWorkspaceIndex" &&
    command.type !== "long.readDocument" &&
    command.type !== "long.querySourceFolder" &&
    command.type !== "long.search" &&
    command.type !== "long.prepareCodexReview" &&
    command.type !== "long.prepareLoveReview" &&
    command.type !== "long.submitLoveReview" &&
    command.type !== "long.loveChapterWorkflow"
  ) {
    return denied(
      "main.command_not_long_query",
      "Only long-form query commands are authorized."
    );
  }

  const runId = command.context.runId;
  const sessionId = command.context.sessionId;
  const resourceId = command.context.resourceId;
  if (!runId || !sessionId || !resourceId) {
    return denied(
      "main.missing_command_context",
      "Long-form internal commands require sessionId, runId and resourceId."
    );
  }

  const run = activeRuns.get(runId);
  if (!run || !run.accepted) {
    return denied(
      "main.run_not_accepted",
      "The long-form agent run is not active and accepted."
    );
  }
  if (!run.resourceId) {
    return denied(
      "main.run_not_long_form",
      "The active run is not bound to a long-form resource."
    );
  }
  if (run.sessionId !== sessionId) {
    return denied(
      "main.session_mismatch",
      "The internal command session does not match its active run."
    );
  }
  if (run.resourceId !== resourceId) {
    return denied(
      "main.resource_mismatch",
      "The internal command resource does not match its active run."
    );
  }
  if (command.payload.bookId !== resourceId) {
    return denied(
      "main.book_mismatch",
      "The internal command book does not match its bound resource."
    );
  }
  if (
    command.type === "long.prepareCodexReview" &&
    command.payload.bookId !== "longbook_9a146bbe"
  ) {
    return denied(
      "main.codex_review_book_unavailable",
      "Codex review packaging is only available for the LOVE project."
    );
  }
  if (!run.promptRequestId || message.parentRequestId !== run.promptRequestId) {
    return denied(
      "main.parent_request_mismatch",
      "The internal command is not attached to the prompt that created its run."
    );
  }
  if (command.type === "long.loveChapterWorkflow") {
    if (resourceId !== "longbook_9a146bbe")
      return denied(
        "main.workflow_book_unavailable",
        "Chapter workflow is restricted to LOVE."
      );
    if (
      command.payload.action === "select_draft" ||
      command.payload.action === "attach_notes"
    ) {
      const evidence = command.payload.authorActionEvidence;
      const annotationIds =
        command.payload.action === "attach_notes"
          ? (command.payload.annotationItemIds ?? [])
          : [];
      const annotationActionAuthorized =
        command.payload.action !== "attach_notes" || annotationIds.length > 0
          ? loveWorkflowActionAuthorized(
              run.reviewAuthorText ?? "",
              command.payload.action
            )
          : loveWorkflowActionAuthorized(
              run.reviewAuthorText ?? "",
              "attach_notes"
            ) ||
            loveWorkflowAnnotationContextAuthorized(run.reviewAuthorText ?? "");
      if (
        !run.reviewAuthorText ||
        !evidence ||
        evidence.requestId !== runId ||
        evidence.quote !== run.reviewAuthorText.slice(0, 2_000) ||
        !annotationActionAuthorized
      )
        return denied(
          "main.workflow_action_not_authorized",
          "Selecting a draft or binding annotations requires the accepted author's current action, not model-generated evidence."
        );
    }
  }
  if (
    command.type === "long.prepareLoveReview" &&
    (!run.reviewAuthorText ||
      command.payload.authorText !== run.reviewAuthorText)
  ) {
    return denied(
      "main.review_author_text_mismatch",
      "Review sources require the actual author message of this accepted run."
    );
  }
  if (
    (command.type === "long.prepareLoveReview" ||
      command.type === "long.submitLoveReview") &&
    resourceId !== "longbook_9a146bbe"
  ) {
    return denied(
      "main.review_book_unavailable",
      "This review pipeline is restricted to LOVE."
    );
  }
  return true;
}
