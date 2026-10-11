import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceSource = path.resolve(here, "..", "..", "..");
const sourceProject = path.join(
  workspaceSource,
  "00_创作项目",
  "项目",
  "What Is Love"
);
const v1Root = path.join(workspaceSource, "06_脚本工具", "写作协议V1");
const cli = path.join(v1Root, "novel-cli.mjs");
const hashFile = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const mkdir = (dir) => fs.mkdirSync(dir, { recursive: true });
const write = (file, content) => {
  mkdir(path.dirname(file));
  fs.writeFileSync(file, content, { flag: "wx", encoding: "utf8" });
};
const copy = (source, target) => {
  mkdir(path.dirname(target));
  fs.copyFileSync(source, target);
};
const parseLastJson = (stdout) => {
  for (const index of [...stdout.matchAll(/^\s*\{/gm)]
    .map((x) => x.index ?? -1)
    .filter((x) => x >= 0)
    .reverse()) {
    try {
      return JSON.parse(stdout.slice(index).trim());
    } catch {
      /* the V1 reader prints snapshots before its result object */
    }
  }
  throw new Error(
    `V1 command omitted its final result JSON: ${stdout.slice(-1000)}`
  );
};
const readJson = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

function copyCurrentProjectFile(projectRoot, relativePath, seen) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).some((part) => part === ".." || part === ".")
  )
    throw new Error(
      `Unsafe source reference in live project metadata: ${relativePath}`
    );
  if (seen.has(relativePath)) return;
  const source = path.resolve(sourceProject, relativePath);
  const rel = path.relative(sourceProject, source);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error(`Project source escapes What Is Love: ${relativePath}`);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Expected an ordinary live project file: ${relativePath}`);
  const target = path.join(projectRoot, relativePath);
  copy(source, target);
  seen.add(relativePath);
}

function sourceClosure(manifest, chapterState, plan, registry, draftPath) {
  const paths = new Set([
    ".novel/project.json",
    ".novel/chapter-state.json",
    ".novel/current-workflow.md",
    ".novel/derived-registry.json",
    manifest.active_source,
    manifest.canon.source,
    ...(manifest.entry_sources || []),
    ...(manifest.confirmed_sources || []).map((x) => x.path),
    ...(manifest.support_sources || []).map((x) => x.path),
    ...(manifest.reference_sources || []).map((x) => x.path),
    ...(manifest.protected_sources || []),
    manifest.canonical_records?.facts,
    manifest.canonical_records?.decisions,
    manifest.canonical_records?.record_format,
    draftPath
  ]);
  for (const record of registry.records || []) {
    paths.add(record.path);
    if (record.source_canon) paths.add(record.source_canon);
    for (const dep of record.dependencies || []) paths.add(dep.path);
  }
  const chapter = (chapterState.chapters || []).find(
    (x) => Number(x.chapter) === 1 && x.volume === "第一卷"
  );
  if (!chapter)
    throw new Error(
      "Live chapter-state no longer registers chapter 1 in 第一卷."
    );
  if (chapter.volume_confirmation?.path)
    paths.add(chapter.volume_confirmation.path);
  for (const keep of chapter.retained_requirements || [])
    if (keep.evidence?.path) paths.add(keep.evidence.path);
  const selected = chapter.selected_outline;
  if (!selected?.path || !/^[a-f0-9]{64}$/.test(selected.hash || ""))
    throw new Error("Live chapter 1 selected outline is missing or malformed.");
  paths.add(selected.path);
  if (selected.selection_evidence?.path)
    paths.add(selected.selection_evidence.path);
  const registered = chapter.registered_plan;
  if (!registered?.path)
    throw new Error("Live selected outline has no registered V1 plan.");
  paths.add(registered.path);
  const planId = plan.plan_id;
  if (!planId) throw new Error("Registered V1 plan lacks an identifier.");
  paths.add(`.novel/state/plan-deliveries/${planId}.json`);
  if (plan.source_outline?.path) paths.add(plan.source_outline.path);
  for (const ref of plan.sources || []) if (ref.path) paths.add(ref.path);
  for (const ref of plan.retention_review || []) {
    if (ref.outline_evidence?.path) paths.add(ref.outline_evidence.path);
    if (ref.author_decision?.path) paths.add(ref.author_decision.path);
  }
  return [...paths];
}

/** Make a temp project from only the live What Is Love sources needed by a new review Context. */
export function createWhatIsLoveChapterOneSmoke({
  tempParent = os.tmpdir()
} = {}) {
  if (!fs.existsSync(cli)) throw new Error(`Live V1 CLI is missing: ${cli}`);
  const liveManifest = readJson(
    path.join(sourceProject, ".novel", "project.json")
  );
  const liveState = readJson(
    path.join(sourceProject, ".novel", "chapter-state.json")
  );
  const chapter = liveState.chapters.find(
    (x) => Number(x.chapter) === 1 && x.volume === "第一卷"
  );
  if (!chapter?.selected_outline)
    throw new Error("第001章当前大纲没有通过项目状态登记。");
  const selectedOutlineFile = path.join(
    sourceProject,
    chapter.selected_outline.path
  );
  if (hashFile(selectedOutlineFile) !== chapter.selected_outline.hash)
    throw new Error("第001章所选大纲hash已变化；停止只读兼容回归。");
  const plan = readJson(path.join(sourceProject, chapter.registered_plan.path));
  const registry = readJson(
    path.join(
      sourceProject,
      liveManifest.derived_registry || ".novel/derived-registry.json"
    )
  );
  const sourceDraft = "004_写作中/第001章_正文草稿_gpt-6.1-sol_v2.2_修订01.md";
  const taskId = `TASK-WIL-CH001-OTTER-${crypto.randomUUID()}`;
  const contextId = `CTX-WIL-CH001-OTTER-${crypto.randomUUID()}`;
  const workspaceRoot = fs.mkdtempSync(
    path.join(tempParent, "otter-wil-ch001-readonly-")
  );
  const projectRoot = path.join(
    workspaceRoot,
    "00_创作项目",
    "项目",
    "What Is Love"
  );
  const projectRelativePath = "00_创作项目/项目/What Is Love";
  mkdir(projectRoot);
  const sourcePaths = sourceClosure(
    liveManifest,
    liveState,
    plan,
    registry,
    sourceDraft
  );
  const copied = new Set();
  for (const relativePath of sourcePaths)
    copyCurrentProjectFile(projectRoot, relativePath, copied);
  for (const name of [
    "AGENTS.md",
    ".novel/protocol/authority.md",
    ".novel/protocol/task-routing.md",
    ".novel/protocol/chapter-workflow.md",
    ".novel/protocol/context-policy.md",
    ".novel/protocol/review-policy.md",
    ".novel/protocol/canon-policy.md",
    ".novel/protocol/third-party-policy.md",
    ".novel/protocol/skill-permissions.md"
  ])
    copy(path.join(workspaceSource, name), path.join(workspaceRoot, name));
  for (const name of [
    "otter-novel",
    "scene-craft",
    "voice-style",
    "line-editing",
    "revision-continuity",
    "story-maintenance"
  ])
    copy(
      path.join(workspaceSource, ".agents", "skills", name, "SKILL.md"),
      path.join(workspaceRoot, ".agents", "skills", name, "SKILL.md")
    );
  for (const name of [
    "novel-cli.mjs",
    "flow-v1-1.mjs",
    "draft-contract.mjs",
    "draft-delivery.mjs",
    "model-identity.mjs"
  ])
    copy(
      path.join(v1Root, name),
      path.join(workspaceRoot, "06_脚本工具", "写作协议V1", name)
    );

  const requestedRelationships = ["宋子凡-王天一", "宋子凡-汪志强"];
  const requestedCharacters = ["宋子凡", "王天一", "汪志强"];
  const sources = [
    ...requestedCharacters.map((name) => ({
      path: `characters/${name}.md`,
      role: "character",
      entities: [name],
      section: name,
      purpose: "相关人物派生卡；coverage/status由derived registry判定"
    })),
    {
      path: "relationships/宋子凡-王天一.md",
      role: "relationship",
      entities: [requestedRelationships[0]],
      section: requestedRelationships[0],
      purpose: "本章相关关系"
    },
    {
      path: "relationships/宋子凡-汪志强.md",
      role: "relationship",
      entities: [requestedRelationships[1]],
      section: requestedRelationships[1],
      purpose: "本章相关关系"
    },
    {
      path: chapter.selected_outline.path,
      role: "scene",
      entities: requestedCharacters,
      section: "所选大纲场次",
      purpose: "chapter-state当前选定大纲原文"
    },
    {
      path: "timeline/confirmed-events.md",
      role: "timeline",
      section: "相关时点",
      purpose: "当前有效时间锚点"
    },
    {
      path: "timeline/knowledge.jsonl",
      role: "knowledge",
      entities: requestedCharacters,
      section: "人物知识边界",
      purpose: "当前有效认知记录"
    },
    {
      path: "canon/open-questions.md",
      role: "unknown",
      entities: ["王天一"],
      section: "故意未知",
      purpose: "项目故意未知记录"
    },
    {
      path: sourceDraft,
      role: "text",
      section: "当前被审阅原文",
      purpose: "拷贝到只读兼容fixture的当前稿件字节"
    }
  ];
  const contextTask = {
    schema_version: 1,
    task_id: taskId,
    context_id: contextId,
    project: liveManifest.project,
    task: "review",
    scope: "fragment",
    chapter: 1,
    volume: "第一卷",
    volume_confirmation: chapter.volume_confirmation,
    target: sourceDraft,
    pov: "宋子凡",
    relevant_characters: requestedCharacters,
    relevant_relationships: requestedRelationships,
    knowledge_boundary: [
      "仅使用本Context所列当前知识来源，信息缺失应报未评估。"
    ],
    intentional_unknowns: ["严格沿用项目正典中的故意未知，不代作者补答。"],
    recent_context: [],
    author_instructions: ["只读验证V1/桌面适配，不修订、接受或登记事实。"],
    skills_allowed: [
      "otter-novel",
      "revision-continuity",
      "scene-craft",
      "voice-style",
      "line-editing"
    ],
    reference_scope: [],
    forbidden_future_info: ["任何未由当前Context授权的未来剧情"],
    sources
  };
  const taskInput = path.join(
    projectRoot,
    ".novel",
    "state",
    "task-inputs",
    `${taskId}.json`
  );
  write(taskInput, `${JSON.stringify(contextTask, null, 2)}\n`);
  const stdout = execFileSync(
    process.execPath,
    [
      cli,
      "prepare",
      "--workspace",
      workspaceRoot,
      "--project",
      projectRelativePath,
      "--input",
      taskInput,
      "--agent",
      "otter-wil-chapter1-readonly-regression"
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const prepared = parseLastJson(stdout);
  if (!["PASS", "WARN"].includes(prepared.status))
    throw new Error(
      `Fresh WIL chapter 1 fixture preflight failed: ${JSON.stringify(prepared)}`
    );
  return {
    workspaceRoot,
    projectRoot,
    projectId: liveManifest.project,
    projectRelativePath,
    taskInput,
    contextPath: `.novel/context/${contextId}.json`,
    receiptPath: path
      .relative(projectRoot, prepared.receipt)
      .split(path.sep)
      .join("/"),
    packPath: prepared.pack,
    preflightPath: prepared.preflight,
    sourceContextUsed: false,
    selectedOutline: prepared.selected_outline,
    status: prepared.status,
    sourceDraftHash: hashFile(path.join(sourceProject, sourceDraft))
  };
}

export function removeWhatIsLoveSmoke(fixture) {
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}
