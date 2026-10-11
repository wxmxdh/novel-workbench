export interface ContextRecord extends Record<string, unknown> {
  path: string;
  hash: string;
  role: string;
  authority?: string;
  line_start: number;
  line_end: number;
  purpose?: string;
  content_hash?: string;
  content?: string;
}

export interface ContextPack extends Record<string, unknown> {
  context_id: string;
  task_id: string;
  project: string;
  project_root: string;
  task: string;
  scope: string;
  target: string;
  chapter?: number | null;
  volume?: string | null;
  volume_confirmation?: { path: string; hash: string; quote: string } | null;
  canon?: { source: string; version: string; hash: string };
  plan?: { id: string; path: string; hash: string } | null;
  selected_outline?: { path: string; hash: string } | null;
  pov: string;
  relevant_characters: string[];
  relevant_relationships: string[];
  knowledge_boundary: string[];
  intentional_unknowns: string[];
  recent_context: string[];
  author_instructions: string[];
  skills_allowed: string[];
  reference_scope: string[];
  forbidden_future_info: string[];
  warnings: string[];
  exploration?: Record<string, unknown> | null;
  sources: ContextRecord[];
  must_not_read?: string[];
  baseline_hash: string;
  comparison_baseline_hash?: string;
}

export interface PreflightResult extends Record<string, unknown> {
  status: string;
  context_id: string;
}

export interface OtterContextRenderInput {
  pack: ContextPack;
  preflight: PreflightResult;
  savedPreflight: PreflightResult;
  sourceLineCounts?: Record<string, number>;
}

export interface OtterContextRenderResult {
  contextId: string;
  baselineHash: string;
  comparisonBaselineHash: string | null;
  apiText: string;
  agentText: string;
  navigation: {
    contextId: string;
    baselineHash: string;
    comparisonBaselineHash: string | null;
    must_read: Array<{
      path: string;
      hash: string;
      role: string;
      lineStart: number;
      lineEnd: number;
      mustReadFully: boolean;
      purpose: string;
    }>;
    must_not_read: string[];
    must_not_read_information: string[];
    note: string;
  };
  preflight: PreflightResult;
}

/** Render existing V1 snapshots without summarizing, editing, or adding story facts. */
export function renderOtterContext({
  pack,
  preflight,
  savedPreflight,
  sourceLineCounts = {}
}: OtterContextRenderInput): OtterContextRenderResult {
  const mustRead = pack.sources.map((source) => ({
    path: source.path,
    hash: source.hash,
    role: source.role,
    lineStart: source.line_start,
    lineEnd: source.line_end,
    mustReadFully:
      source.line_start === 1 &&
      source.line_end === sourceLineCounts[source.path],
    purpose: source.purpose ?? "读取Context中绑定的来源快照"
  }));
  const declaredMustNotRead = (pack.must_not_read ?? []).filter(
    (value) => typeof value === "string"
  );
  const mustNotRead = [
    "当前选定项目根目录以外的其它作品正文、人物资料与备份（除非本Context显式登记为reference source）",
    "归档/历史/备份目录（包括旧003_人物档案/**），除非该路径已由项目有效入口、canon、或登记reference明确列入本Context",
    ...declaredMustNotRead
  ];
  const forbiddenInfo = pack.forbidden_future_info ?? [];
  const relevantCharacters = pack.relevant_characters ?? [];
  const relevantRelationships = pack.relevant_relationships ?? [];
  const knowledgeBoundary = pack.knowledge_boundary ?? [];
  const intentionalUnknowns = pack.intentional_unknowns ?? [];
  const recentContext = pack.recent_context ?? [];
  const authorInstructions = pack.author_instructions ?? [];
  const skillsAllowed = pack.skills_allowed ?? [];
  const warnings = pack.warnings ?? [];
  const referenceScope = pack.reference_scope ?? [];
  const navigation = {
    contextId: pack.context_id,
    baselineHash: pack.baseline_hash,
    comparisonBaselineHash: pack.comparison_baseline_hash ?? null,
    must_read: mustRead,
    must_not_read: mustNotRead,
    must_not_read_information: forbiddenInfo,
    note: "Navigation guidance is scoped to this Context. It does not assert that the operating system enforces these paths as an access-control sandbox."
  };
  const envelope = {
    contextId: pack.context_id,
    baselineHash: pack.baseline_hash,
    comparisonBaselineHash: pack.comparison_baseline_hash ?? null,
    preflight,
    navigation,
    metadata: {
      project: pack.project,
      projectRoot: pack.project_root,
      taskId: pack.task_id,
      task: pack.task,
      scope: pack.scope,
      target: pack.target,
      volume: pack.volume ?? null,
      volumeConfirmation: pack.volume_confirmation ?? null,
      chapter: pack.chapter ?? null,
      canon: pack.canon ?? null,
      plan: pack.plan ?? null,
      selectedOutline: pack.selected_outline ?? null,
      pov: pack.pov,
      relevantCharacters,
      relevantRelationships,
      knowledgeBoundary,
      intentionalUnknowns,
      recentContext,
      authorInstructions,
      skillsAllowed,
      referenceScope,
      forbiddenFutureInfo: forbiddenInfo,
      warnings: pack.warnings,
      exploration: pack.exploration ?? null
    },
    referenceScope,
    sources: pack.sources.map((source) => ({
      path: source.path,
      hash: source.hash,
      role: source.role,
      authority: source.authority,
      line_start: source.line_start,
      line_end: source.line_end,
      purpose: source.purpose ?? "",
      content_hash: source.content_hash,
      content: source.content
    }))
  };
  const agentText = [
    `# V1 Context ${pack.context_id}`,
    `Project: ${pack.project} | Volume: ${pack.volume ?? "unknown"} | Chapter: ${pack.chapter ?? "unknown"}`,
    `Integrity baseline: ${pack.baseline_hash}`,
    `Comparison baseline: ${pack.comparison_baseline_hash ?? "unavailable"}`,
    `Preflight: ${preflight.status} (saved preflight: ${savedPreflight.status})`,
    "The following source snapshots were emitted by the V1 reader. This confirms byte delivery, not comprehension.",
    "## Task and fact boundaries",
    `Task: ${pack.task} / ${pack.scope}; target: ${pack.target}`,
    `POV: ${pack.pov}`,
    `Relevant characters: ${relevantCharacters.join("; ")}`,
    `Relevant relationships: ${relevantRelationships.join("; ")}`,
    `Knowledge boundary: ${knowledgeBoundary.join("; ")}`,
    `Intentional unknowns: ${intentionalUnknowns.join("; ")}`,
    `Recent context: ${recentContext.join("; ")}`,
    `Author instructions: ${authorInstructions.join("; ")}`,
    `Allowed Skills: ${skillsAllowed.join(", ")}`,
    `Warnings: ${warnings.join("; ") || "none recorded"}`,
    "## Navigation",
    `Canon: ${pack.canon?.source ?? "unknown"} @ ${pack.canon?.version ?? "unknown"} [${pack.canon?.hash ?? "unknown"}]`,
    `Plan: ${pack.plan ? `${pack.plan.id} ${pack.plan.path} [${pack.plan.hash}]` : "none recorded"}`,
    `Selected outline: ${pack.selected_outline ? `${pack.selected_outline.path} [${pack.selected_outline.hash}]` : "none recorded"}`,
    `Volume evidence: ${pack.volume_confirmation ? `${pack.volume_confirmation.path} [${pack.volume_confirmation.hash}] — ${pack.volume_confirmation.quote}` : "none recorded"}`,
    `must_read:\n${mustRead.map((source) => `${source.path} [${source.hash}] role=${source.role} L${source.lineStart}-${source.lineEnd} must_read_fully=${source.mustReadFully} — ${source.purpose}`).join("\n") || "none recorded"}`,
    `must_not_read paths: ${mustNotRead.join(", ") || "none recorded"}`,
    `must_not_read information: ${forbiddenInfo.join("; ") || "none recorded"}`,
    "These are task navigation instructions, not operating-system access controls.",
    "Open each must_read source at the listed path and range in the selected workspace. A complete-file instruction is true only when the range spans the current whole file; a hash or pack is not evidence of comprehension."
  ].join("\n\n");
  const apiText = JSON.stringify(envelope, null, 2);
  if (
    Buffer.byteLength(apiText, "utf8") > 2_000_000 ||
    Buffer.byteLength(agentText, "utf8") > 2_000_000
  )
    throw new Error("Expanded V1 Context exceeds the 2 MiB renderer limit.");
  return {
    contextId: pack.context_id,
    baselineHash: pack.baseline_hash,
    comparisonBaselineHash: pack.comparison_baseline_hash ?? null,
    apiText,
    agentText,
    navigation,
    preflight
  };
}
