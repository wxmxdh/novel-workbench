import { ReviewSkillIdsSchema, type ReviewSkillId } from "@deepwrite/contracts";

export type LoveReviewFindingCategory =
  | "conflict"
  | "reality-check"
  | "literary-suggestion"
  | "author-preference"
  | "uncertain";

export interface LoveReviewFinding {
  id: string;
  category: LoveReviewFindingCategory;
  scope: string;
  issue: string;
  sourceId: string;
  quote: string;
  suggestion?: string;
  skillIds?: ReviewSkillId[];
  reportId?: string;
}

export interface LoveReviewReport {
  status: "reviewed" | "incomplete";
  summary: string;
  findings: LoveReviewFinding[];
  missingSources: string[];
  reviewedSourceIds: string[];
}

export interface LoveReviewEvidenceSource {
  id: string;
  content: string;
}

export type LoveReviewReportValidation =
  { ok: true; report: LoveReviewReport } | { ok: false; reason: string };

const categories = new Set<LoveReviewFindingCategory>([
  "conflict",
  "reality-check",
  "literary-suggestion",
  "author-preference",
  "uncertain"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

/**
 * Validate a model-authored report against immutable source text. The hash is
 * checked separately against the prepared batch because this function only
 * validates report structure and its quoted evidence.
 */
export function validateLoveReviewReport(
  raw: string,
  sources: readonly LoveReviewEvidenceSource[]
): LoveReviewReportValidation {
  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch {
    return { ok: false, reason: "报告不是完整 JSON，未提交审阅结果。" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "报告根节点必须是对象。" };
  if (parsed.status !== "reviewed" && parsed.status !== "incomplete")
    return { ok: false, reason: "报告缺少有效的 reviewed/incomplete 状态。" };
  if (!nonempty(parsed.summary)) return { ok: false, reason: "报告缺少摘要。" };
  if (!Array.isArray(parsed.findings) || !Array.isArray(parsed.missingSources))
    return {
      ok: false,
      reason: "报告必须包含 findings 和 missingSources 数组。"
    };
  if (parsed.missingSources.some((item) => !nonempty(item)))
    return { ok: false, reason: "missingSources 中有空项。" };
  if (
    !Array.isArray(parsed.reviewedSourceIds) ||
    parsed.reviewedSourceIds.some((item) => !nonempty(item))
  )
    return { ok: false, reason: "报告必须列明实际覆盖的 reviewedSourceIds。" };
  const reviewedSourceIds = parsed.reviewedSourceIds as string[];
  if (new Set(reviewedSourceIds).size !== reviewedSourceIds.length)
    return { ok: false, reason: "reviewedSourceIds 含重复来源。" };
  if (parsed.status === "reviewed" && parsed.missingSources.length > 0)
    return {
      ok: false,
      reason: "报告声明已完成却仍有未取得来源，状态矛盾。"
    };

  const sourceById = new Map(
    sources.map((source) => [source.id, source.content])
  );
  if (reviewedSourceIds.some((id) => !sourceById.has(id)))
    return { ok: false, reason: "reviewedSourceIds 声明了未提供的来源。" };
  if (
    parsed.status === "reviewed" &&
    (reviewedSourceIds.length !== sourceById.size ||
      [...sourceById.keys()].some((id) => !reviewedSourceIds.includes(id)))
  )
    return {
      ok: false,
      reason: "reviewed状态必须逐一列出本轮提供的全部来源ID。"
    };
  const findings: LoveReviewFinding[] = [];
  const findingIds = new Set<string>();
  for (const [index, value] of parsed.findings.entries()) {
    if (!isRecord(value))
      return { ok: false, reason: `第 ${index + 1} 条意见格式无效。` };
    if (
      !nonempty(value.id) ||
      findingIds.has(value.id) ||
      !nonempty(value.scope) ||
      !nonempty(value.issue) ||
      !nonempty(value.sourceId) ||
      !nonempty(value.quote) ||
      !categories.has(value.category as LoveReviewFindingCategory)
    )
      return {
        ok: false,
        reason: `第 ${index + 1} 条意见缺少字段或使用了无效类别。`
      };
    const sourceText = sourceById.get(value.sourceId);
    if (sourceText === undefined)
      return {
        ok: false,
        reason: `第 ${index + 1} 条意见引用了未提供的来源 ${value.sourceId}。`
      };
    if (!sourceText.includes(value.quote))
      return {
        ok: false,
        reason: `第 ${index + 1} 条意见的原文引句不在来源 ${value.sourceId} 中。`
      };
    if (
      value.suggestion !== undefined &&
      (!nonempty(value.suggestion) || value.suggestion.length > 4_000)
    )
      return { ok: false, reason: `第 ${index + 1} 条修改建议格式无效。` };
    const skills =
      value.skillIds === undefined
        ? undefined
        : ReviewSkillIdsSchema.safeParse(value.skillIds);
    if (skills && !skills.success)
      return { ok: false, reason: `第 ${index + 1} 条意见的 Skill 标记无效。` };
    const finding: LoveReviewFinding = {
      id: value.id,
      category: value.category as LoveReviewFindingCategory,
      scope: value.scope,
      issue: value.issue,
      sourceId: value.sourceId,
      quote: value.quote,
      ...(nonempty(value.suggestion) ? { suggestion: value.suggestion } : {}),
      ...(skills?.success ? { skillIds: skills.data } : {}),
      ...(nonempty(value.reportId) ? { reportId: value.reportId } : {})
    };
    findingIds.add(finding.id);
    findings.push(finding);
  }
  const report: LoveReviewReport = {
    status: parsed.status,
    summary: parsed.summary,
    findings,
    missingSources: [...parsed.missingSources],
    reviewedSourceIds
  };
  return { ok: true, report };
}
