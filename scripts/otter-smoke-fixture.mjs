import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_WORKSPACE = path.resolve(here, "..", "..", "..");
const HASH = (value) => crypto.createHash("sha256").update(value).digest("hex");
const writeJson = (file, value) =>
  write(file, `${JSON.stringify(value, null, 2)}\n`);
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { flag: "wx", encoding: "utf8" });
  return file;
}
function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
function parseLastJson(stdout) {
  const starts = [...stdout.matchAll(/^\s*\{/gm)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .reverse();
  for (const start of starts) {
    try {
      return JSON.parse(stdout.slice(start).trim());
    } catch {
      /* source read output can contain braces; continue */
    }
  }
  throw new Error(
    `V1 prepare output did not end in structured JSON: ${stdout.slice(-1000)}`
  );
}

function copyTree(
  sourceRoot,
  targetRoot,
  { skipDirectories = new Set(), includeFile = () => true } = {}
) {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      if (skipDirectories.has(entry.name.toLowerCase())) continue;
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target, { skipDirectories, includeFile });
    } else if (entry.isFile() && includeFile(entry.name, source))
      copy(source, target);
  }
}

/** Build a disposable central-catalogue workspace from live adapters and explicitly fictional story data. */
export function createOtterSmokeFixture({
  sourceWorkspace = DEFAULT_SOURCE_WORKSPACE,
  profile = os.tmpdir(),
  runPrepare = false
} = {}) {
  const v1Root = path.join(sourceWorkspace, "06_脚本工具", "写作协议V1");
  const cli = path.join(v1Root, "novel-cli.mjs");
  if (!fs.existsSync(cli)) throw new Error(`Live V1 CLI not found: ${cli}`);
  fs.mkdirSync(profile, { recursive: true });
  const workspaceRoot = fs.mkdtempSync(
    path.join(profile, "deepwrite-otter-smoke-workspace-")
  );
  const relativeProjectPath = "00_创作项目/项目/Fixture Novel";
  const projectRoot = path.join(workspaceRoot, relativeProjectPath);
  const projectId = "Otter Smoke Fixture";
  const taskId = "TASK-NATIVE-OTTER-01";
  const contextId = "CTX-NATIVE-OTTER-01";
  const factsText = "";
  const decisionsText = "";
  const canonText =
    [
      "# Fixture canon (fictional test data only)",
      "Fixture Student is a test character. The test relationship is neutral. The test scene is a classroom. The test time is Monday.",
      "Known fact: the test character knows the other's name. Unknown: any internal motive."
    ].join("\n") + "\n";
  const authorText =
    [
      "Fictional test authorization evidence.",
      "确认隔离测试章属于第一卷。",
      "授权起草隔离测试片段。",
      "仅测试数据，不对应任何作品人物或剧情。"
    ].join("\n") + "\n";
  const authorHash = HASH(authorText);
  const canonHash = HASH(canonText);
  const active = `source.md\n${canonHash}\n`;
  const derivedCard =
    "Partial fixture-derived character card; not a story fact.\n";
  const derivedHash = HASH(derivedCard);
  const factsHash = HASH(factsText);
  const decisionsHash = HASH(decisionsText);
  const taskInputPath = path.join(
    projectRoot,
    ".novel",
    "state",
    "task-inputs",
    `${taskId}.json`
  );
  const draftBodyPath = path.join(
    projectRoot,
    ".novel",
    "state",
    "task-inputs",
    taskId,
    "body.md"
  );
  const draftDeliveryInputPath = path.join(
    projectRoot,
    ".novel",
    "state",
    "task-inputs",
    `${taskId}-delivery.json`
  );
  const outlinePath = path.join(
    projectRoot,
    "004_写作中",
    "第001章_测试大纲.md"
  );

  fs.mkdirSync(projectRoot, { recursive: true });
  write(
    path.join(workspaceRoot, "AGENTS.md"),
    fs.readFileSync(path.join(sourceWorkspace, "AGENTS.md"), "utf8")
  );
  for (const name of [
    "authority",
    "task-routing",
    "chapter-workflow",
    "context-policy",
    "review-policy",
    "canon-policy",
    "third-party-policy",
    "skill-permissions"
  ])
    copy(
      path.join(sourceWorkspace, ".novel", "protocol", `${name}.md`),
      path.join(workspaceRoot, ".novel", "protocol", `${name}.md`)
    );
  for (const name of [
    "otter-novel",
    "scene-craft",
    "voice-style",
    "line-editing",
    "revision-continuity",
    "story-maintenance"
  ])
    copy(
      path.join(sourceWorkspace, ".agents", "skills", name, "SKILL.md"),
      path.join(workspaceRoot, ".agents", "skills", name, "SKILL.md")
    );
  // Copy all live local .mjs runtime sources needed by V1, while excluding archived/reference/test material.
  copyTree(v1Root, path.join(workspaceRoot, "06_脚本工具", "写作协议V1"), {
    skipDirectories: new Set([
      "参考源码",
      "实施记录",
      "实施包",
      "test",
      "tests",
      "node_modules",
      ".git",
      "备份"
    ]),
    includeFile: (name) => name.endsWith(".mjs") || name === "package.json"
  });
  // The local page-facing site is copied as code/public assets only. Persistent data is empty and fixture-owned.
  const liveReviewRoot = path.join(
    sourceWorkspace,
    "06_脚本工具",
    "小说对照工作台"
  );
  const fixtureReviewRoot = path.join(
    workspaceRoot,
    "06_脚本工具",
    "小说对照工作台"
  );
  copyTree(liveReviewRoot, fixtureReviewRoot, {
    skipDirectories: new Set([
      "data",
      "node_modules",
      "test",
      "tests",
      "实施记录",
      "备份",
      "参考源码",
      ".git",
      "dist"
    ])
  });
  fs.mkdirSync(path.join(fixtureReviewRoot, "data"), { recursive: true });

  write(
    path.join(projectRoot, "AGENTS.md"),
    "Fictional fixture project entry. Use only test data in this directory.\n"
  );
  write(
    path.join(projectRoot, "project-profile.md"),
    "# Fixture Novel\nAll people, events, and facts in this fixture are fictional test data.\n"
  );
  write(path.join(projectRoot, "canon", "source.md"), canonText);
  write(path.join(projectRoot, "canon", "active-source.md"), active);
  write(path.join(projectRoot, "canon", "facts.jsonl"), factsText);
  write(path.join(projectRoot, "canon", "decisions.jsonl"), decisionsText);
  write(
    path.join(projectRoot, "canon", "record-format.md"),
    "Fixture-only record format.\n"
  );
  write(path.join(projectRoot, "canon", "author-evidence.md"), authorText);
  write(
    path.join(projectRoot, "characters", "fixture-character.md"),
    derivedCard
  );
  write(
    path.join(projectRoot, "relationships", "fixture-relationship.md"),
    "Fixture relationship evidence; no story facts.\n"
  );
  write(
    path.join(projectRoot, "timeline", "knowledge.jsonl"),
    JSON.stringify({ fixture: true, state: "test-only" }) + "\n"
  );
  write(
    path.join(projectRoot, "timeline", "fixture-event.md"),
    "# Fixture event\nA synthetic event marker for category discovery only.\n"
  );
  write(
    path.join(projectRoot, ".novel", "notes", "concepts", "fixture-concept.md"),
    "# Fixture concept\nA possible test-only scene idea; not an event or canon fact.\n"
  );
  write(
    path.join(projectRoot, ".novel", "notes", "world", "fixture-world.md"),
    "# Fixture world note\nAn unconfirmed synthetic worldbuilding placeholder.\n"
  );
  write(
    path.join(projectRoot, ".novel", "notes", "maps", "fixture-map.md"),
    "# Fixture map note\nA text-only synthetic map placeholder; no confirmed geography.\n"
  );
  write(
    path.join(projectRoot, ".novel", "plans", "fixture-plan.json"),
    JSON.stringify({
      fixture: true,
      status: "candidate",
      note: "synthetic test plan only"
    }) + "\n"
  );
  write(
    path.join(projectRoot, "004_写作中", "第001章_测试正文.md"),
    "# Fixture draft\nSynthetic test-only draft placeholder; not story canon.\n"
  );
  write(
    path.join(projectRoot, "timeline", "confirmed-events.md"),
    "# Fixture time anchors\nMonday, test-only.\n"
  );
  write(
    path.join(projectRoot, "004_写作中", "第001章_测试大纲.md"),
    "# Fixture outline\n\n## 场次一：测试开始\n\n## 场次二：测试结束\n"
  );
  write(
    path.join(projectRoot, "006_批注", "批注入口.md"),
    "# Fixture annotations\nNo author annotations.\n"
  );
  write(
    path.join(projectRoot, ".novel", "author-decisions", "fixture.md"),
    authorText
  );
  const chapterState = {
    schema_version: 1,
    project: projectId,
    chapters: [
      {
        chapter: 1,
        volume: "第一卷",
        volume_title: null,
        status: "current",
        volume_confirmation: {
          actor: "user",
          scope: { project: projectId, chapter: 1, volume: "第一卷" },
          path: ".novel/author-decisions/fixture.md",
          hash: authorHash,
          quote: "确认隔离测试章属于第一卷。"
        },
        selected_outline: null,
        registered_plan: null
      }
    ]
  };
  writeJson(
    path.join(projectRoot, ".novel", "chapter-state.json"),
    chapterState
  );
  write(
    path.join(projectRoot, ".novel", "current-workflow.md"),
    "# Fixture workflow\nNo real chapter state.\n"
  );
  const registry = {
    schema_version: 1,
    project: projectId,
    records: [
      {
        path: "characters/fixture-character.md",
        hash: derivedHash,
        authority: "derived",
        source_canon: "canon/source.md",
        source_hash: canonHash,
        source_version: "fixture-1",
        coverage: "partial",
        status: "current",
        verified_at: null,
        source_sections: [
          { path: "canon/source.md", section: "Fixture canon" }
        ],
        dependencies: []
      },
      {
        path: "relationships/fixture-relationship.md",
        hash: HASH(
          fs.readFileSync(
            path.join(projectRoot, "relationships", "fixture-relationship.md")
          )
        ),
        authority: "derived",
        source_canon: "canon/source.md",
        source_hash: canonHash,
        source_version: "fixture-1",
        coverage: "full",
        status: "current",
        verified_at: null,
        source_sections: [
          { path: "canon/source.md", section: "Fixture relationship" }
        ],
        dependencies: []
      }
    ]
  };
  writeJson(
    path.join(projectRoot, ".novel", "derived-registry.json"),
    registry
  );
  const manifest = {
    schema_version: 1,
    project: projectId,
    active_source: "canon/active-source.md",
    canon: { source: "canon/source.md", version: "fixture-1", hash: canonHash },
    entry_sources: [
      "AGENTS.md",
      "project-profile.md",
      "canon/active-source.md",
      ".novel/current-workflow.md"
    ],
    confirmed_sources: [
      { path: "canon/facts.jsonl", hash: factsHash },
      { path: "canon/decisions.jsonl", hash: decisionsHash }
    ],
    support_sources: [
      {
        path: "canon/author-evidence.md",
        hash: authorHash,
        authority: "evidence",
        scope: "fixture author evidence"
      },
      {
        path: ".novel/author-decisions/fixture.md",
        hash: authorHash,
        authority: "evidence",
        scope: "fixture volume decision"
      },
      {
        path: "relationships/fixture-relationship.md",
        hash: HASH(
          fs.readFileSync(
            path.join(projectRoot, "relationships", "fixture-relationship.md")
          )
        ),
        authority: "evidence",
        scope: "fixture relationship"
      },
      {
        path: "timeline/knowledge.jsonl",
        hash: HASH(
          fs.readFileSync(path.join(projectRoot, "timeline", "knowledge.jsonl"))
        ),
        authority: "evidence",
        scope: "fixture knowledge"
      },
      {
        path: "timeline/confirmed-events.md",
        hash: HASH(
          fs.readFileSync(
            path.join(projectRoot, "timeline", "confirmed-events.md")
          )
        ),
        authority: "evidence",
        scope: "fixture timeline"
      },
      {
        path: "004_写作中/第001章_测试大纲.md",
        hash: HASH(fs.readFileSync(outlinePath)),
        authority: "evidence",
        scope: "fixture outline"
      }
    ],
    protected_sources: ["canon/source.md"],
    derived_registry: ".novel/derived-registry.json",
    chapter_state: ".novel/chapter-state.json",
    canonical_records: {
      format: "what-is-love-jsonl-v1",
      facts: "canon/facts.jsonl",
      decisions: "canon/decisions.jsonl",
      record_format: "canon/record-format.md"
    },
    reference_sources: [],
    outline_directory: "004_写作中"
  };
  writeJson(path.join(projectRoot, ".novel", "project.json"), manifest);
  const source =
    "Fixture prose only: this sentence exists to validate delivery and identity handling.\n";
  write(draftBodyPath, source);
  const quote = (text) => ({
    path: "canon/author-evidence.md",
    hash: authorHash,
    quote: text
  });
  const task = {
    schema_version: 1,
    task_id: taskId,
    context_id: contextId,
    project: projectId,
    task: "draft",
    scope: "fragment",
    chapter: 1,
    volume: "第一卷",
    volume_confirmation: {
      actor: "user",
      scope: { project: projectId, chapter: 1, volume: "第一卷" },
      ...quote("确认隔离测试章属于第一卷。")
    },
    target: "requested-fragment.md",
    pov: "Fixture Student",
    relevant_characters: ["Fixture Student"],
    relevant_relationships: ["Fixture relationship"],
    knowledge_boundary: ["Knows only the test name."],
    intentional_unknowns: ["Internal motives remain unknown."],
    recent_context: [],
    author_instructions: ["Fictional test data only; no real story facts."],
    skills_allowed: ["otter-novel"],
    reference_scope: [],
    forbidden_future_info: ["Later fixture stages"],
    authorization: {
      action: "draft",
      scope: "requested-fragment.md",
      evidence: quote("授权起草隔离测试片段。")
    },
    sources: [
      {
        path: "canon/source.md",
        role: "character",
        entities: ["Fixture Student"],
        section: "Fixture character"
      },
      {
        path: "characters/fixture-character.md",
        role: "character",
        entities: ["Fixture Student"],
        section: "Partial fixture-derived card"
      },
      {
        path: "canon/source.md",
        role: "relationship",
        entities: ["Fixture relationship"],
        section: "Fixture relationship"
      },
      {
        path: "relationships/fixture-relationship.md",
        role: "relationship",
        entities: ["Fixture relationship"],
        section: "Fixture relationship source"
      },
      { path: "canon/source.md", role: "scene", section: "Fixture scene" },
      {
        path: "timeline/confirmed-events.md",
        role: "timeline",
        section: "Fixture time"
      },
      {
        path: "timeline/knowledge.jsonl",
        role: "knowledge",
        section: "Fixture knowledge"
      },
      { path: "canon/source.md", role: "unknown", section: "Fixture unknowns" },
      {
        path: "004_写作中/第001章_测试大纲.md",
        role: "text",
        purpose: "fixture outline navigation only",
        section: "Fixture outline"
      }
    ]
  };
  writeJson(taskInputPath, task);
  writeJson(draftDeliveryInputPath, {
    body_file: path
      .relative(projectRoot, draftBodyPath)
      .split(path.sep)
      .join("/"),
    title: "Fixture fragment",
    generator: "unknown",
    used_skills: [],
    summary: "Isolated test fixture draft; not a story fact."
  });

  const fixturePath = path.join(workspaceRoot, "fixture-manifest.json");
  const projectRelativePathPosix = relativeProjectPath;
  const projectIdHash = `otter_${HASH(projectRelativePathPosix).slice(0, 16)}`;
  writeJson(fixturePath, {
    workspaceRoot,
    projectRoot,
    projectRelativePath: relativeProjectPath,
    projectId,
    projectAdapterId: projectIdHash,
    taskInput: taskInputPath,
    contextId,
    contextPath: `.novel/context/${contextId}.json`,
    taskId,
    draftBodyPath,
    draftDeliveryInputPath,
    reviewRoot: fixtureReviewRoot,
    authorization:
      "All fiction and author statements in this disposable project are fixture-only.",
    sourceWorkspace
  });
  let prepared = null;
  if (runPrepare) {
    const stdout = execFileSync(
      process.execPath,
      [
        cli,
        "prepare",
        "--workspace",
        workspaceRoot,
        "--project",
        relativeProjectPath,
        "--input",
        taskInputPath,
        "--agent",
        "otter-smoke-fixture"
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );
    prepared = parseLastJson(stdout);
    if (prepared.status === "FAIL")
      throw new Error(prepared.reason || "Fixture prepare failed.");
  }
  const contextPath = `.novel/context/${contextId}.json`;
  const receiptPath = prepared
    ? path.relative(projectRoot, prepared.receipt).split(path.sep).join("/")
    : null;
  return {
    workspaceRoot,
    projectRoot,
    projectId,
    projectRelativePath: relativeProjectPath,
    taskInput: taskInputPath,
    projectIdHash,
    taskId,
    contextId,
    fixturePath,
    contextPath,
    receiptPath,
    packPath: prepared ? prepared.pack : null,
    preflightPath: prepared ? prepared.preflight : null,
    draftInput: draftDeliveryInputPath,
    draftBody: draftBodyPath,
    screenshotPath: path.join(profile, "otter-smoke.png"),
    reviewRoot: fixtureReviewRoot,
    v1Cli: cli,
    prepareStatus: prepared?.status ?? null
  };
}

export function removeOtterSmokeFixture(fixture) {
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}
