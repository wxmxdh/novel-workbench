import { createHash } from "node:crypto";
import {
  LOVE_REVIEW_INDEPENDENT_ID,
  type LoveReviewCoverage,
  type LoveReviewReport
} from "@deepwrite/contracts";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import { isSubagentToolProgressDetails } from "./subagent-types";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import { runtimeFromConfig } from "./subagent-helpers";
import { visibleLoveAuthorText } from "./love-subagent-evidence";
import {
  prepareLoveReviewSnapshot,
  submitLoveReviewReport
} from "./love-review-runtime";
import {
  independentReport,
  loveFeedbackNotice,
  loveSummaryCorrectionPrompt
} from "./love-review-feedback";
function latestLoveAuthorText(
  messages: ReturnType<
    NonNullable<BuildSpawnSubagentToolInput["getParentMessages"]>
  >
): string {
  return (
    messages
      .map((message) => visibleLoveAuthorText(message))
      .findLast((text) => text !== undefined) ?? ""
  );
}
function appendSystemRequirements(
  base: string | undefined,
  extra: string
): string {
  return [base?.trim(), extra].filter(Boolean).join("\n\n");
}
/** Persist the parent's actual final LOVE review summary, then run love-intent
 * against the reloaded frozen source packet and all persisted specialist reports. */
interface LoveFinalizationInput {
  subagentInput: BuildSpawnSubagentToolInput;
  state: NonNullable<BuildSpawnSubagentToolInput["loveReviewRunState"]>;
  content: string;
  onProgress?: (
    progress: import("./subagent-types").SubagentToolProgress
  ) => void;
  runtime: NonNullable<BuildSpawnSubagentToolInput["parentRuntime"]>;
  reviseSummary?: (prompt: string) => Promise<string>;
}

export async function finalizeLoveReviewActualOutput(
  input: LoveFinalizationInput
): Promise<LoveReviewCoverage | undefined> {
  let result = await auditLoveReviewActualOutput(input);
  if (result?.state !== "ready") return result;
  const id = input.state.latestReviewId;
  const stored = id ? input.state.reviews.get(id) : undefined;
  const coordinates = input.subagentInput.loveReviewCoordinates;
  const executor = input.subagentInput.loveReviewExecutor;
  if (!id || !stored || !coordinates || !executor) return result;
  const reload = async () => {
    const snapshot = await prepareLoveReviewSnapshot({
      coordinates,
      executor,
      options: {
        reviewId: id,
        reviewerIds: stored.snapshot.reviewerIds,
        authorText:
          input.subagentInput.loveReviewAuthorText ??
          stored.snapshot.authorText,
        chapter: stored.snapshot.chapter,
        volume: stored.snapshot.volume,
        targetKind: stored.snapshot.targetKind
      },
      signal: input.subagentInput.parentSignal
    });
    stored.snapshot = snapshot;
    stored.coverage = snapshot.coverage;
    return snapshot;
  };
  let snapshot = await reload();
  if (
    independentReport(snapshot)?.findings.length &&
    input.reviseSummary &&
    !stored.summaryCorrectionAttempted
  ) {
    stored.summaryCorrectionAttempted = true;
    try {
      const corrected = await input.reviseSummary(
        loveSummaryCorrectionPrompt(snapshot)
      );
      input.subagentInput.parentSignal?.throwIfAborted();
      // Reuse the actual frozen originals; only the summary is replaced and re-audited.
      result = await auditLoveReviewActualOutput({
        ...input,
        content: corrected
      });
      snapshot = await reload();
      if (result?.state === "ready" && snapshot.coverage.state === "ready") {
        input.state.correctedContent = corrected;
      } else {
        delete input.state.correctedContent;
      }
    } catch (error) {
      input.subagentInput.parentSignal?.throwIfAborted();
      input.state.feedbackNotice = loveFeedbackNotice(
        snapshot,
        error instanceof Error ? error.message : "本轮修正未完成"
      );
      return result;
    }
  }
  input.state.feedbackNotice = loveFeedbackNotice(snapshot);
  return result;
}

async function auditLoveReviewActualOutput(
  input: LoveFinalizationInput
): Promise<LoveReviewCoverage | undefined> {
  const reviewId = input.state.latestReviewId;
  if (!reviewId) return undefined;
  const stored = input.state.reviews.get(reviewId);
  if (!stored) return undefined;
  const initial = stored.coverage;
  if (
    initial.state === "incomplete" ||
    initial.state === "stale" ||
    initial.completedCount < initial.expectedCount ||
    initial.missingReviewerIds.length > 0
  )
    return initial;
  const coordinates = input.subagentInput.loveReviewCoordinates;
  const executor = input.subagentInput.loveReviewExecutor;
  if (!coordinates || !executor || coordinates.bookId !== "longbook_9a146bbe")
    return initial;
  if (!input.content.trim() || input.content.length > 80_000)
    return { ...initial, state: "needs_independent_review" };

  const frozen = await prepareLoveReviewSnapshot({
    coordinates,
    executor,
    options: {
      reviewerIds: stored.snapshot.reviewerIds,
      reviewId,
      authorText:
        input.subagentInput.loveReviewAuthorText ??
        latestLoveAuthorText(input.subagentInput.getParentMessages?.() ?? []),
      chapter: stored.snapshot.chapter,
      volume: stored.snapshot.volume,
      targetKind: stored.snapshot.targetKind
    },
    signal: input.subagentInput.parentSignal
  });
  if (
    frozen.targetSetSha256 !== stored.snapshot.targetSetSha256 ||
    frozen.coverage.state === "stale"
  )
    return frozen.coverage;
  const finalHash = createHash("sha256")
    .update(input.content, "utf8")
    .digest("hex");
  if (
    stored.finalSummarySha256 === finalHash &&
    frozen.coverage.state === "ready" &&
    frozen.sourceSetSha256 === stored.snapshot.sourceSetSha256
  )
    return frozen.coverage;

  const sourceIds = [
    ...frozen.targets.map((source) => source.id),
    ...frozen.sources.map((source) => source.id)
  ];
  const summaryReport: LoveReviewReport = {
    status: "reviewed",
    summary: input.content,
    findings: [],
    missingSources: [],
    reviewedSourceIds: sourceIds
  };
  const coverage = await submitLoveReviewReport({
    coordinates,
    executor,
    reviewId,
    reviewerId: "main",
    phase: "summary",
    targetSetSha256: frozen.targetSetSha256,
    report: summaryReport,
    runtime: input.runtime,
    signal: input.subagentInput.parentSignal
  });
  stored.finalSummarySha256 = finalHash;
  stored.coverage = coverage;

  const reviewPacket = await prepareLoveReviewSnapshot({
    coordinates,
    executor,
    options: {
      reviewerIds: frozen.reviewerIds,
      reviewId,
      authorText:
        input.subagentInput.loveReviewAuthorText ??
        latestLoveAuthorText(input.subagentInput.getParentMessages?.() ?? []),
      chapter: frozen.chapter,
      volume: frozen.volume,
      targetKind: frozen.targetKind
    },
    signal: input.subagentInput.parentSignal
  });
  if (
    reviewPacket.targetSetSha256 !== frozen.targetSetSha256 ||
    reviewPacket.coverage.state !== "needs_independent_review"
  )
    return reviewPacket.coverage;

  const enabled = input.subagentInput.definitions.filter(
    (definition) => definition.enabled
  );
  const intent = enabled.find(
    (definition) => definition.id === LOVE_REVIEW_INDEPENDENT_ID
  );
  if (!intent) return coverage;
  const referencedRuntimes = new Set([
    `${input.runtime.provider}/${input.runtime.model}`,
    ...reviewPacket.reports
      .filter((report) => report.phase === "specialist")
      .map((report) => `${report.runtime.provider}/${report.runtime.model}`)
  ]);
  const differentConfiguredMember = enabled.find((definition) => {
    if (definition.modelMode !== "custom" || !definition.modelId?.trim())
      return false;
    const config =
      input.subagentInput.subagentRuntimeConfigs?.[definition.modelId.trim()];
    if (!config) return false;
    const actual = runtimeFromConfig(config);
    return !referencedRuntimes.has(`${actual.provider}/${actual.model}`);
  });
  const independentDefinition = differentConfiguredMember
    ? {
        ...intent,
        modelMode: "custom" as const,
        modelId: differentConfiguredMember.modelId
      }
    : intent;
  const sameModelNotice = !differentConfiguredMember
    ? "没有找到不同于主模型与专业审阅员的已启用运行型号；请在报告中明确这是同型号交叉核对。"
    : "请在报告中如实记录实际运行身份。";
  const childInput: BuildSpawnSubagentToolInput = {
    ...input.subagentInput,
    buildChildTools: () => [],
    definitions: [independentDefinition],
    loveReviewSnapshot: reviewPacket,
    loveReviewPhase: "independent",
    allowIndependentLoveReview: true,
    systemPromptRequirements: appendSystemRequirements(
      input.subagentInput.systemPromptRequirements,
      sameModelNotice
    )
  };
  const delegate = buildSpawnSubagentTool(childInput);
  if (!delegate) return coverage;
  let finalCoverage: LoveReviewCoverage | undefined;
  const result = await delegate.execute(
    `love-review-finalize-${reviewId}`,
    {
      subagent_id: LOVE_REVIEW_INDEPENDENT_ID,
      task: "对照专业报告与主汇总，核验每项拟删改建议的报告归属、sourceId和原句引用，并检查遗漏的相反意见、未决事项被写成定论、范围扩大及汇总新增判断。按原报告ID并列呈现相反意见，保留uncertain和missingSources为待核对项；只复核汇总，不重做各专业维度，不改正文、不替作者裁决。"
    } as never,
    input.subagentInput.parentSignal,
    (partial) => {
      if (isSubagentToolProgressDetails(partial.details)) {
        input.onProgress?.(partial.details.progress);
        if (partial.details.progress.type === "completed")
          finalCoverage = partial.details.progress.reviewCoverage;
      }
    }
  );
  if (!finalCoverage) {
    const output = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    if (output.includes("审阅未登记")) return coverage;
  }
  if (finalCoverage) {
    stored.coverage = finalCoverage;
    return finalCoverage;
  }
  return coverage;
}
