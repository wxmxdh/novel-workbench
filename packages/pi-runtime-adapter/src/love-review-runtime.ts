import { createHash, randomUUID } from "node:crypto";
import {
  createEnvelope,
  LongPrepareLoveReviewCommandEnvelopeSchema,
  LongSubmitLoveReviewCommandEnvelopeSchema,
  LoveReviewSnapshotSchema,
  type CommandResult,
  type LoveReviewCoverage,
  type LoveReviewReport,
  type LoveReviewSnapshot,
  type LongPrepareLoveReviewCommandEnvelope,
  type LongSubmitLoveReviewCommandEnvelope
} from "@deepwrite/contracts";

export type LoveReviewCommand =
  LongPrepareLoveReviewCommandEnvelope | LongSubmitLoveReviewCommandEnvelope;
export type LoveReviewCommandExecutor = (
  command: LoveReviewCommand,
  signal?: AbortSignal
) => Promise<CommandResult>;

export interface LoveReviewRunState {
  latestReviewId?: string;
  requested?: boolean;
  /** Actual revised model text and separate runtime adjudication notice. */
  correctedContent?: string | undefined;
  feedbackNotice?: string | undefined;
  reviews: Map<
    string,
    {
      snapshot: LoveReviewSnapshot;
      coverage: LoveReviewCoverage;
      finalSummarySha256?: string;
      summaryCorrectionAttempted?: boolean;
    }
  >;
  finalizeActualOutput?: (
    content: string,
    runtime: LoveReviewSnapshot["reports"][number]["runtime"],
    onProgress?: (
      progress: import("./subagent-types").SubagentToolProgress
    ) => void,
    reviseSummary?: (prompt: string) => Promise<string>
  ) => Promise<
    | {
        reviewCoverage?: LoveReviewCoverage;
        reviewNotice?: "not_started";
        content?: string;
      }
    | undefined
  >;
}

export function createLoveReviewRunState(): LoveReviewRunState {
  return { reviews: new Map() };
}

export interface LoveReviewRunCoordinates {
  bookId: string;
  sessionId: string;
  runId: string;
}

export interface PrepareLoveReviewOptions {
  reviewerIds: string[];
  authorText: string;
  reviewId?: string;
  resumeLatest?: boolean;
  chapter?: number;
  volume?: string;
  targetKind?: "drafts" | "chapter_card" | "chapter_body";
  targetPaths?: string[];
}

function requireAccepted(result: CommandResult): unknown {
  if (result.status !== "accepted")
    throw new Error(
      result.error?.message ?? "LOVE审核资料读取或报告提交失败。"
    );
  return result.payload;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertSnapshot(
  value: unknown,
  input: LoveReviewRunCoordinates,
  requestedReviewerIds: readonly string[],
  loadingExistingReview: boolean
): LoveReviewSnapshot {
  const snapshot = LoveReviewSnapshotSchema.parse(value);
  if (input.bookId !== "longbook_9a146bbe" || snapshot.bookId !== input.bookId)
    throw new Error("LOVE审核Core返回了其它项目的资料，已停止。 ");
  const requested = new Set(requestedReviewerIds);
  if (
    !loadingExistingReview &&
    (requested.size !== requestedReviewerIds.length ||
      snapshot.reviewerIds.length !== requested.size ||
      snapshot.reviewerIds.some((id) => !requested.has(id)))
  )
    throw new Error("Core返回的审阅成员范围与本轮请求不一致，已停止。 ");
  const targets = new Set(snapshot.targets.map(({ id }) => id));
  if (targets.size !== snapshot.targets.length)
    throw new Error("LOVE审核快照含重复目标，已停止。 ");
  for (const target of snapshot.targets) {
    if (sha256(target.content) !== target.sha256)
      throw new Error(
        `LOVE审核目标 ${target.id} 的内容与SHA-256不符，已停止。`
      );
  }
  const sources = new Set(snapshot.sources.map(({ id }) => id));
  if (sources.size !== snapshot.sources.length)
    throw new Error("LOVE审核快照含重复来源，已停止。 ");
  for (const source of snapshot.sources) {
    if (sha256(source.content) !== source.sha256)
      throw new Error(
        `LOVE审核来源 ${source.id} 的内容与SHA-256不符，已停止。`
      );
  }
  return snapshot;
}

export async function prepareLoveReviewSnapshot(input: {
  coordinates: LoveReviewRunCoordinates;
  executor: LoveReviewCommandExecutor;
  options: PrepareLoveReviewOptions;
  signal?: AbortSignal | undefined;
}): Promise<LoveReviewSnapshot> {
  if (input.coordinates.bookId !== "longbook_9a146bbe")
    throw new Error("LOVE审核工具仅对LOVE项目开放。");
  if (!input.options.authorText.trim())
    throw new Error("本轮没有可核对的作者原始消息，LOVE审核未启动。");
  const command = LongPrepareLoveReviewCommandEnvelopeSchema.parse(
    createEnvelope(
      "long.prepareLoveReview",
      {
        bookId: "longbook_9a146bbe",
        ...(input.options.reviewId ? { reviewId: input.options.reviewId } : {}),
        ...(input.options.resumeLatest ? { resumeLatest: true } : {}),
        ...(input.options.chapter ? { chapter: input.options.chapter } : {}),
        ...(input.options.volume ? { volume: input.options.volume } : {}),
        targetKind: input.options.targetKind ?? "drafts",
        ...(input.options.targetPaths
          ? { targetPaths: input.options.targetPaths }
          : {}),
        reviewerIds: input.options.reviewerIds,
        authorText: input.options.authorText
      },
      {
        id: `love-review-prepare-${randomUUID()}`,
        context: {
          sessionId: input.coordinates.sessionId,
          runId: input.coordinates.runId,
          resourceId: input.coordinates.bookId
        }
      }
    )
  );
  const payload = requireAccepted(await input.executor(command, input.signal));
  return assertSnapshot(
    payload,
    input.coordinates,
    input.options.reviewerIds,
    Boolean(input.options.reviewId)
  );
}

export async function submitLoveReviewReport(input: {
  coordinates: LoveReviewRunCoordinates;
  executor: LoveReviewCommandExecutor;
  reviewId: string;
  reviewerId: string;
  phase: "specialist" | "summary" | "independent";
  targetSetSha256: string;
  report: LoveReviewReport;
  runtime: LoveReviewSnapshot["reports"][number]["runtime"];
  signal?: AbortSignal | undefined;
}): Promise<LoveReviewCoverage> {
  if (input.coordinates.bookId !== "longbook_9a146bbe")
    throw new Error("LOVE审核报告只能提交至LOVE项目。");
  const command = LongSubmitLoveReviewCommandEnvelopeSchema.parse(
    createEnvelope(
      "long.submitLoveReview",
      {
        bookId: "longbook_9a146bbe",
        reviewId: input.reviewId,
        reviewerId: input.reviewerId,
        phase: input.phase,
        targetSetSha256: input.targetSetSha256,
        report: input.report,
        runtime: input.runtime
      },
      {
        id: `love-review-submit-${randomUUID()}`,
        context: {
          sessionId: input.coordinates.sessionId,
          runId: input.coordinates.runId,
          resourceId: input.coordinates.bookId
        }
      }
    )
  );
  const result = requireAccepted(await input.executor(command, input.signal));
  if (!result || typeof result !== "object" || !("coverage" in result))
    throw new Error("Core未返回LOVE审阅覆盖状态，报告不能记为已提交。");
  const coverage = LoveReviewSnapshotSchema.shape.coverage.parse(
    (result as { coverage: unknown }).coverage
  );
  if (
    coverage.reviewId !== input.reviewId ||
    coverage.targetSetSha256 !== input.targetSetSha256
  )
    throw new Error("Core提交回执的reviewId或稿件版本与本轮不一致。");
  return coverage;
}

export function loveReviewEvidenceSources(
  snapshot: LoveReviewSnapshot,
  supplementalSources: readonly { id: string; content: string }[] = []
) {
  return [
    ...snapshot.targets.map((target) => ({
      id: target.id,
      content: target.content
    })),
    ...snapshot.sources.map((source) => ({
      id: source.id,
      content: source.content
    })),
    ...snapshot.reports.map((report) => ({
      id: `${report.reviewerId}:${report.phase}`,
      content: JSON.stringify(report.report)
    })),
    ...snapshot.reports
      .filter(
        (report) => report.reviewerId === "main" && report.phase === "summary"
      )
      .map((report) => ({
        id: "main-summary",
        content: report.report.summary
      })),
    ...supplementalSources.map((source) => ({
      id: source.id,
      content: source.content
    }))
  ];
}

function loveReviewReportComparisonIndex(
  reports: LoveReviewSnapshot["reports"]
): string[] {
  const bySource = new Map<
    string,
    Array<{ reportId: string; finding: LoveReviewReport["findings"][number] }>
  >();
  const pending: string[] = [];
  for (const report of reports) {
    const reportId = `${report.reviewerId}:${report.phase}`;
    for (const finding of report.report.findings) {
      const entries = bySource.get(finding.sourceId) ?? [];
      entries.push({ reportId, finding });
      bySource.set(finding.sourceId, entries);
      if (finding.category === "uncertain")
        pending.push(
          `${reportId}#${finding.id}｜${finding.sourceId}｜uncertain`
        );
    }
    for (const source of report.report.missingSources)
      pending.push(`${reportId}｜missing: ${source}`);
    if (
      report.report.status === "incomplete" &&
      !report.report.missingSources.length
    )
      pending.push(`${reportId}｜incomplete；未说明具体缺项`);
  }
  if (!bySource.size && !pending.length) return [];

  const index = [
    "【已提交报告对照索引；仅按 sourceId 并列定位，不替代下方原报告全文】"
  ];
  for (const [sourceId, entries] of bySource) {
    index.push(`来源 ${sourceId}`);
    for (const { reportId, finding } of entries) {
      index.push(
        `- ${reportId}#${finding.id}${finding.reportId ? `→${finding.reportId}` : ""}｜${finding.category}｜${finding.scope}`
      );
    }
  }
  if (pending.length)
    index.push(
      "【未决与缺失来源；仍待核对】",
      ...pending.map((entry) => `- ${entry}`)
    );
  return [index.join("\n")];
}

export function loveReviewPacket(
  snapshot: LoveReviewSnapshot,
  supplementalSources: readonly {
    id: string;
    path: string;
    role: string;
    sha256: string;
    content: string;
  }[] = []
): string {
  return [
    `审阅标识：${snapshot.reviewId}`,
    `项目：LOVE（${snapshot.bookId}）`,
    `章节：第${snapshot.chapter}章；卷：${snapshot.volume}`,
    `待审目标类型：${snapshot.targetKind}`,
    `目标集SHA-256：${snapshot.targetSetSha256}`,
    `来源集SHA-256：${snapshot.sourceSetSha256}`,
    `【本轮作者实际消息】\n${snapshot.authorText}`,
    "【冻结的待审目标全文；请逐篇阅读全文，不得以父任务粘贴、同名旧稿或模型摘要替代】",
    ...snapshot.targets.map(
      (target) =>
        `【目标 ${target.id}｜${target.path}｜${target.version}｜SHA-256 ${target.sha256}${target.model ? `｜来源标记 ${target.model}` : ""}】\n${target.content}`
    ),
    "【本轮核对来源全文】",
    ...snapshot.sources.map(
      (source) =>
        `【来源 ${source.id}｜${source.role}｜${source.path}｜SHA-256 ${source.sha256}】\n${source.content}`
    ),
    ...(supplementalSources.length
      ? [
          "【本轮附加核对文本；由主运行提交，非项目正典】",
          ...supplementalSources.map(
            (source) =>
              `【来源 ${source.id}｜${source.role}｜${source.path}｜SHA-256 ${source.sha256}】\n${source.content}`
          )
        ]
      : []),
    ...loveReviewReportComparisonIndex(snapshot.reports),
    ...(snapshot.reports.length
      ? [
          "【本轮已经持久提交的报告全文；用于后续复核，不改变作者决定】",
          ...snapshot.reports.map((report) => {
            const reportId = `${report.reviewerId}:${report.phase}`;
            const summaryAlias =
              report.reviewerId === "main" && report.phase === "summary"
                ? "｜同一汇总的证据 ID：main:summary、main-summary"
                : "";
            return `【报告 ${reportId}${summaryAlias}｜模型运行身份 ${report.runtime.provider}/${report.runtime.model}】\n${JSON.stringify(report.report)}`;
          })
        ]
      : [])
  ].join("\n\n");
}

export function loveReviewSystemRequirements(input: {
  snapshot: LoveReviewSnapshot;
  reviewerId: string;
  phase: "specialist" | "independent";
  supplementalSources?: readonly { id: string; content: string }[];
}): string {
  const phaseInstructions =
    input.phase === "independent"
      ? "你是独立汇总复核员，核对主汇总与已提交的专业报告，不重做各专业维度审阅。检查引用和报告归属、遗漏的相反意见、局部意见被扩大、未决事项被写成确定结论、未审对象被说成已审，以及汇总新增判断。对照索引只用于定位，原报告全文是依据。涉及原报告时标出报告 ID，并保留 finding 的 scope、sourceId、quote；有 reportId 时一并标明。相反意见并列呈现，uncertain finding 与 missingSources 保持待核，不按报告数量替作者裁决文学问题。"
      : "你只负责分配给你的审阅维度。明确报告实际读到的目标和版本，区分冲突、现实核查、文学建议、作者偏好、未决事项；不得把单章观察扩大成全书规则，不得把审美判断包装成事实。每项拟删改说明真实影响、依据效力、最小处理和需要保留的部分；若存在合理反解释，保留建议或未决身份。允许零问题，不为体现工作量制造缺陷。";
  return [
    "【LOVE受控审阅运行边界】",
    `reviewId=${input.snapshot.reviewId}; targetSetSha256=${input.snapshot.targetSetSha256}; reviewerId=${input.reviewerId}; phase=${input.phase}`,
    "以下冻结来源全文由受控Core读取并逐份哈希核验。它们是唯一可审正文版本；父任务粘贴的其它稿件、‘同上’、记忆、对照栏或旧稿均不构成待审原文。若文本不完整或无法读取，输出status=incomplete并说明缺项。",
    "只引用本包真实存在的sourceId与精确原句quote；每条finding必须填写scope，限定本段/本章/本批，不默认上升为全书规则。没有问题可报告零条findings。",
    "这不是禁词检查。不要仅因某个词出现就判错；不要把语感偏好改写成作者禁令。未知事实标记uncertain，不装作已核实。作者偏好须以其本轮原话为依据。",
    "正式规则、作者选定执行大纲、候选稿和作者主观偏好身份不同。大纲选择不逐项批准新规则；动作/对白示例不是逐帧脚本。发现章卡概括比正式规则更强时报告差异，不机械按更严的一份判错。另一候选稿的安排不能裁定本稿事实。",
    phaseInstructions,
    `【全部来源 ID 清单：待审稿与依据都必须列入实际覆盖声明】${JSON.stringify(loveReviewEvidenceSources(input.snapshot, input.supplementalSources).map(({ id }) => id))}`,
    '【输出协议】最终答复只输出单个JSON对象，不加Markdown围栏或前后说明，结构为：{"status":"reviewed|incomplete","summary":"...","findings":[{"id":"...","category":"conflict|reality-check|literary-suggestion|author-preference|uncertain","scope":"...","issue":"...","sourceId":"本包来源ID","quote":"必须逐字摘自该来源","reportId":"独立复核引用报告时可填"}],"missingSources":[],"reviewedSourceIds":["逐一列出实际收到并覆盖的所有sourceId"]}。status=reviewed时reviewedSourceIds必须逐一包含本包全部来源ID，不足时status=incomplete并在missingSources列明。'
  ].join("\n");
}
