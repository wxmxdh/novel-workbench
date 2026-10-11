import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  deliverComparisonCli,
  prepareComparisonCli
} from "./comparison-cli-bridge";
import { prepareLoveLocalRevisionCli } from "./love-local-revision-cli-bridge";
import { registerNativeComparison } from "./native-comparison-registration";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../写作协议V1/test/fixtures.mjs"
);
const { fixture } = require(fixturePath) as { fixture: () => unknown };
const publicCli = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../写作协议V1"
);
const fixtures: Array<{ cleanup: () => void }> = [];

interface FixtureTask {
  task: string;
  scope: string;
  chapter: number;
  volume?: string;
  volume_confirmation?: unknown;
  plan?: string;
  target: string;
  authorization?: unknown;
  [key: string]: unknown;
}

interface ComparisonFixture {
  workspace: string;
  relative: string;
  root: string;
  config: { project: string };
  task: FixtureTask;
  volume_confirmation: { hash: string; [key: string]: unknown };
  put: (path: string, value: unknown, base?: string) => string;
  hash: (path: string) => string;
  cleanup: () => void;
}

async function setup(selected = true) {
  const f = fixture() as ComparisonFixture;
  fixtures.push(f);
  const cliDest = join(f.workspace, "06_脚本工具", "写作协议V1");
  mkdirSync(cliDest, { recursive: true });
  for (const file of readdirSync(publicCli, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".mjs"))
      cpSync(join(publicCli, file.name), join(cliDest, file.name));
  }
  const outlinePath = "outlines/chapter-001-selected.md";
  const outlineText =
    '---\nkind: outline\nvolume: 第一卷\nchapter: 1\nversion: "test"\n---\n# 隔离大纲\n第1章：测试重点\n开场：测试开头\n结尾：测试结尾\n关键：只供测试的场次\n';
  f.put(outlinePath, outlineText);
  const outlineHash = f.hash(outlinePath);
  const proofQuote = "作者明确选定隔离测试大纲作为第1章依据";
  const authorText = `确认本测试章属于第一卷；${proofQuote}；授权起草本测试新稿。`;
  f.put("author.md", authorText);
  f.volume_confirmation.hash = f.hash("author.md");
  const selectionEvidence = {
    actor: "user",
    scope: { project: f.config.project, volume: "第一卷", chapter: 1 },
    path: "author.md",
    hash: f.hash("author.md"),
    quote: proofQuote
  };
  const plan = {
    schema_version: 1,
    plan_id: "PLAN-TEST-SELECTED",
    project: f.config.project,
    chapter: 1,
    volume: "第一卷",
    volume_confirmation: f.volume_confirmation,
    mode: "planned",
    status: "source_selected",
    approval_kind: "author-selected-outline",
    selection_evidence: selectionEvidence,
    focus: "第1章：测试重点",
    opening: "开场：测试开头",
    ending: "结尾：测试结尾",
    character_relation_change: [],
    key_turns: ["只供测试的场次"],
    must_include: [],
    must_not_resolve: [],
    intentional_unknowns: [],
    author_notes: [],
    source_projection: {
      fields: {
        focus: "第1章：测试重点",
        opening: "开场：测试开头",
        ending: "结尾：测试结尾",
        character_relation_change: [],
        key_turns: ["只供测试的场次"],
        must_include: [],
        must_not_resolve: [],
        intentional_unknowns: [],
        author_notes: []
      }
    },
    sources: [{ path: outlinePath, hash: outlineHash, quote: "# 隔离大纲" }],
    source_outline: { path: outlinePath, hash: outlineHash },
    author_confirmation: null,
    retention_review: []
  };
  const planPath = ".novel/plans/PLAN-TEST-SELECTED.json";
  f.put(planPath, plan);
  const { objectHash, planApprovalHash } = await import(
    pathToFileURL(join(publicCli, "flow-v1-1.mjs")).href
  );
  f.put(".novel/state/plan-deliveries/PLAN-TEST-SELECTED.json", {
    schema_version: 1,
    project: f.config.project,
    volume: "第一卷",
    chapter: 1,
    plan_id: plan.plan_id,
    plan_hash: objectHash(plan),
    approval_object_hash: planApprovalHash(plan),
    status: plan.status,
    source_outline: plan.source_outline
  });
  f.task.task = "draft";
  f.task.scope = "chapter";
  f.task.chapter = 1;
  f.task.volume = "第一卷";
  f.task.volume_confirmation = f.volume_confirmation;
  f.task.plan = planPath;
  f.task.authorization = {
    action: "draft",
    scope: f.task.target,
    evidence: {
      path: "author.md",
      hash: f.hash("author.md"),
      quote: "授权起草本测试新稿"
    }
  };
  const taskPath = ".novel/tasks/comparison-task.json";
  f.put(taskPath, f.task);
  if (selected)
    f.put(".novel/chapter-state.json", {
      schema_version: 1,
      project: f.config.project,
      chapters: [
        {
          chapter: 1,
          volume: "第一卷",
          status: "current",
          volume_confirmation: f.volume_confirmation,
          selected_outline: {
            path: outlinePath,
            hash: outlineHash,
            selection_evidence: selectionEvidence
          },
          registered_plan: { path: planPath, hash: f.hash(planPath) },
          retained_requirements: [],
          comparison_task: taskPath
        }
      ]
    });
  return { f, outlinePath, outlineText, outlineHash, authorText, taskPath };
}

function prepare(
  f: ComparisonFixture,
  data: Awaited<ReturnType<typeof setup>>,
  sourceMode?: "independent" | "redraft",
  nativeEvidence?: string,
  authorText = data.authorText
) {
  return prepareComparisonCli({
    workspace: f.workspace,
    projectRelative: f.relative,
    projectRoot: f.root,
    chapter: 1,
    volume: "第一卷",
    outline: { path: data.outlinePath, hash: data.outlineHash },
    taskPath: data.taskPath,
    authorizationId: "test-auth",
    authorText,
    ...(nativeEvidence ? { nativeEvidence } : {}),
    ...(sourceMode ? { sourceMode } : {})
  });
}

afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("comparison CLI bridge", () => {
  it("delivers a local revision with its source path and exact base hash in metadata", async () => {
    const data = await setup();
    const sourcePath = "004_写作中/第001章_正文草稿_gpt-6.1-sol.md";
    const sourceText =
      "---\nmodel: gpt-6.1-sol\ntitle: 测试章\n---\n原稿首句。原稿次句。\n";
    data.f.put(sourcePath, sourceText);
    const authorText = "按作者当前指定的一句进行局部修改。";
    const evidencePath = ".novel/author-requests/revision-auth.md";
    data.f.put(evidencePath, authorText);
    const evidence = {
      path: evidencePath,
      sha256: data.f.hash(evidencePath),
      quote: authorText
    };
    const prepared = await prepareLoveLocalRevisionCli({
      workspace: data.f.workspace,
      projectRelative: data.f.relative,
      projectRoot: data.f.root,
      chapter: 1,
      volume: "第一卷",
      selectedOutline: { path: data.outlinePath, hash: data.outlineHash },
      chapterTaskPath: data.taskPath,
      sourcePath,
      sourceSha256: data.f.hash(sourcePath),
      authorizationId: "local-revision-test-authorization",
      authorRevisionText: authorText,
      authorRevisionEvidence: evidence
    });
    expect(prepared.revisionBase).toEqual({
      path: sourcePath,
      sha256: data.f.hash(sourcePath)
    });
    expect(prepared.readContent).toContain(sourceText);
    const delivered = await deliverComparisonCli({
      workspace: data.f.workspace,
      projectRelative: data.f.relative,
      projectRoot: data.f.root,
      projectId: "otter_0123456789abcdef",
      prepared,
      content: "原稿首句。修订后的次句。",
      title: "测试章",
      runtime: {
        provider: "fixture-provider",
        model: "gpt-6.1-sol",
        mode: "provider"
      }
    });
    const output = readFileSync(join(data.f.root, delivered.path), "utf8");
    expect(output).toContain(`revision_of: "${sourcePath}"`);
    expect(output).toContain(`base_hash: "${data.f.hash(sourcePath)}"`);
    expect(
      JSON.parse(
        readFileSync(join(data.f.root, delivered.deliveryRecord), "utf8")
      ).revision_base
    ).toEqual({ path: sourcePath, sha256: data.f.hash(sourcePath) });
    expect(readFileSync(join(data.f.root, sourcePath), "utf8")).toBe(
      sourceText
    );
  });

  it("registers native chapter execution once and uses public prepare/delivery without a second manual manifest", async () => {
    const { f } = await setup();
    const relative = "projects/native-LOVE";
    const root = join(f.workspace, relative);
    mkdirSync(root, { recursive: true });
    f.put("AGENTS.md", "# LOVE 独立模型稿交付入口\n", root);
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const card =
      "# 第一章\n## 开场\n宋子凡进入教室。\n## 散场\n宋子凡取回水瓶离开。\n";
    const request = {
      bookId: "longbook_9a146bbe" as const,
      authorizationId: "fixture-native-auth-01",
      chapter: 1,
      chapterCardId: "chapter_d9489ee2",
      authorRequestId: "request-native",
      volumeId: "volume_3e9287d3",
      authorRequest: {
        requestId: "request-native",
        exactText: "然后你同时推几个创作团队来分别创作吧",
        authorizationQuote: "然后你同时推几个创作团队来分别创作吧",
        receivedAt: "2026-10-04T00:00:00.000Z"
      },
      chapterCardSha256: digest(card),
      volumeSha256: digest("测试卷卡")
    };
    const source = {
      cardTitle: "第一章",
      cardContent: card,
      chapterCardId: request.chapterCardId,
      volumeId: request.volumeId,
      volumeLabel: "第一卷",
      volumeContent: "测试卷卡",
      nativeEvidence:
        "宋子凡、贾思远、程北辰是测试人物。关系待定；仅知当前姓名；其余故意未知。测试时间为开学日上午，场景为测试教室。"
    };
    await registerNativeComparison({
      workspace: f.workspace,
      relative,
      root,
      request,
      source
    });
    await registerNativeComparison({
      workspace: f.workspace,
      relative,
      root,
      request,
      source
    });
    const state = JSON.parse(
      readFileSync(join(root, ".novel/chapter-state.json"), "utf8")
    );
    const entry = state.chapters[0];
    const prepared = await prepareComparisonCli({
      workspace: f.workspace,
      projectRelative: relative,
      projectRoot: root,
      chapter: 1,
      volume: "第一卷",
      outline: entry.selected_outline,
      taskPath: entry.comparison_task,
      authorizationId: request.authorizationId,
      authorText: request.authorRequest.exactText,
      nativeEvidence: source.nativeEvidence
    });
    expect(prepared.readContent).toContain(card);
    expect(prepared.readContent).toContain(source.nativeEvidence);
    expect(prepared.nativeEvidenceHash).toBe(digest(source.nativeEvidence));
    expect(prepared.nativeSourcePath).toBeTruthy();
    const result = await deliverComparisonCli({
      workspace: f.workspace,
      projectRelative: relative,
      projectRoot: root,
      projectId: "otter_0123456789abcdef",
      prepared,
      content: "隔离测试候选正文。",
      title: "测试章",
      runtime: {
        provider: "fixture-provider",
        model: "gemini-2.5-flash-thinking",
        mode: "provider"
      }
    });
    expect(result.model).toBe("gemini-2.5-flash-thinking");
    expect(result.path).toContain("004_写作中");
    expect(readFileSync(join(root, result.path), "utf8")).toContain(
      "隔离测试候选正文。"
    );
    const registration = JSON.parse(
      readFileSync(join(root, ".novel/project.json"), "utf8")
    );
    const nativePath = registration.canon.source as string;
    const nativeSnapshot = readFileSync(join(root, nativePath), "utf8");
    writeFileSync(join(root, nativePath), `${nativeSnapshot}\n变化`);
    await expect(
      deliverComparisonCli({
        workspace: f.workspace,
        projectRelative: relative,
        projectRoot: root,
        projectId: "otter_0123456789abcdef",
        prepared,
        content: "不得基于旧资料再次交付。",
        title: "测试章",
        runtime: {
          provider: "fixture-provider",
          model: "gemini-2.5-flash-thinking",
          mode: "provider"
        }
      })
    ).rejects.toThrow("原生资料在准备后已变化");
    writeFileSync(join(root, nativePath), nativeSnapshot);
    await expect(
      registerNativeComparison({
        workspace: f.workspace,
        relative,
        root,
        request,
        source: { ...source, cardContent: card + "改变" }
      })
    ).rejects.toThrow();
  });
  it("refuses preparation without a registered selected outline/source", async () => {
    const data = await setup(false);
    await expect(prepare(data.f, data)).rejects.toThrow();
  });

  it("uses public prepare and delivery receipts and saves separate model drafts", async () => {
    const data = await setup();
    const prepared = await prepare(data.f, data);
    const secondPreparation = await prepare(data.f, data);
    expect(prepared.contextId).toMatch(/^CTX-/);
    expect(prepared.readContent).toContain(`outline=${data.outlinePath}`);
    expect(existsSync(join(data.f.root, prepared.packPath))).toBe(true);
    expect(existsSync(join(data.f.root, prepared.receiptPath))).toBe(true);
    const preparedPack = JSON.parse(
      readFileSync(join(data.f.root, prepared.packPath), "utf8")
    );
    const preparedReceipt = JSON.parse(
      readFileSync(join(data.f.root, prepared.receiptPath), "utf8")
    );
    const run = JSON.parse(
      readFileSync(
        join(data.f.root, ".novel/state/runs", `${preparedPack.task_id}.json`),
        "utf8"
      )
    );
    expect(run.phase).toBe("ready");
    expect(run.receipt).toBe(prepared.receiptPath);
    expect(run.baseline_hash).toBe(preparedPack.baseline_hash);
    expect(run.receipt).toBe(
      `.novel/receipts/${preparedReceipt.receipt_id}.json`
    );
    const runtime = (model: string) => ({
      provider: "fixture-provider",
      model,
      mode: "provider" as const
    });
    const first = await deliverComparisonCli({
      workspace: data.f.workspace,
      projectRelative: data.f.relative,
      projectRoot: data.f.root,
      projectId: "otter_0123456789abcdef",
      prepared,
      content: "隔离测试稿一。",
      title: "测试稿",
      runtime: runtime("gemini-3.8-flash-high")
    });
    const second = await deliverComparisonCli({
      workspace: data.f.workspace,
      projectRelative: data.f.relative,
      projectRoot: data.f.root,
      projectId: "otter_0123456789abcdef",
      prepared: secondPreparation,
      content: "隔离测试稿二。",
      title: "测试稿",
      runtime: runtime("gpt-6.1-sol")
    });
    expect(first.path).not.toBe(second.path);
    expect(prepared.contextId).not.toBe(secondPreparation.contextId);
    expect(first.model).toBe("gemini-3.8-flash-high");
    expect(second.model).toBe("gpt-6.1-sol");
    expect(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(data.f.root, first.path), "utf8")
      )
    ).toContain("隔离测试稿一。");
    expect(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(data.f.root, second.path), "utf8")
      )
    ).toContain("隔离测试稿二。");
    expect(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(data.f.root, "draft.md"), "utf8")
      )
    ).toContain("测试标记存在");
    expect(first.deliveryRecord).toBeTruthy();
  }, 30_000);

  it("keeps only explicitly adopted annotations actionable in the redraft Context and Receipt", async () => {
    const data = await setup();
    const { f } = data;
    const loveWorkflow = resolve(
      process.cwd(),
      "../../我的小说工作台/LOVE_Codex审核交接/工具/love-chapter-workflow.mjs"
    );
    const workflowDestination = join(
      f.workspace,
      "我的小说工作台",
      "LOVE_Codex审核交接",
      "工具"
    );
    mkdirSync(workflowDestination, { recursive: true });
    cpSync(
      loveWorkflow,
      join(workflowDestination, "love-chapter-workflow.mjs")
    );

    const config = JSON.parse(
      readFileSync(join(f.root, ".novel/project.json"), "utf8")
    );
    const nativePath = "canon.md";
    const nativeText =
      "# 当前隔离测试资料\n测试人物甲。甲的当前关系待定；其余心理故意未知。测试时间为开学日上午，场景为隔离测试教室。\n";
    f.put(nativePath, nativeText);
    config.project = "LOVE";
    config.bridge_owner = "native-love-comparison-v1";
    config.canon = {
      source: nativePath,
      hash: createHash("sha256").update(nativeText).digest("hex"),
      version: "native-test"
    };
    f.put("active-source.md", `${nativePath}\n${config.canon.hash}\n`);
    f.put(".novel/project.json", config);
    const taskPath = ".novel/tasks/comparison-task.json";
    const task = JSON.parse(readFileSync(join(f.root, taskPath), "utf8"));
    task.project = "LOVE";
    task.volume_confirmation.scope.project = "LOVE";
    task.sources = [
      "character",
      "relationship",
      "scene",
      "timeline",
      "knowledge",
      "unknown"
    ].map((role) => ({
      path: nativePath,
      role,
      ...(role === "character"
        ? { entities: ["测试人物甲"] }
        : role === "relationship"
          ? { entities: ["甲的当前关系"] }
          : {}),
      section: "当前原生运行资料"
    }));
    f.put(taskPath, task);
    const planPath = ".novel/plans/PLAN-TEST-SELECTED.json";
    const plan = JSON.parse(readFileSync(join(f.root, planPath), "utf8"));
    plan.project = "LOVE";
    plan.volume_confirmation.scope.project = "LOVE";
    plan.selection_evidence.scope.project = "LOVE";
    plan.status = "approved";
    const { objectHash, planApprovalHash } = await import(
      pathToFileURL(join(publicCli, "flow-v1-1.mjs")).href
    );
    plan.author_confirmation = {
      actor: "user",
      object_id: plan.plan_id,
      object_hash: planApprovalHash(plan),
      scope: { project: "LOVE", volume: plan.volume, chapter: plan.chapter },
      path: "author.md",
      hash: f.hash("author.md"),
      quote: "作者明确选定隔离测试大纲作为第1章依据"
    };
    f.put(planPath, plan);
    f.put(".novel/state/plan-deliveries/PLAN-TEST-SELECTED.json", {
      schema_version: 1,
      project: "LOVE",
      volume: plan.volume,
      chapter: plan.chapter,
      plan_id: plan.plan_id,
      plan_hash: objectHash(plan),
      approval_object_hash: planApprovalHash(plan),
      status: plan.status,
      source_outline: plan.source_outline
    });
    const chapterState = JSON.parse(
      readFileSync(join(f.root, ".novel/chapter-state.json"), "utf8")
    );
    chapterState.project = "LOVE";
    for (const entry of chapterState.chapters) {
      entry.volume_confirmation.scope.project = "LOVE";
      entry.selected_outline.selection_evidence.scope.project = "LOVE";
      entry.registered_plan.hash = f.hash(planPath);
    }
    f.put(".novel/chapter-state.json", chapterState);

    const draftPath = "004_写作中/第001章_正文草稿_gpt-6.1-sol.md";
    const draftText =
      '---\nworkbench: novel-draft-v1\nmodel: "gpt-6.1-sol"\nvolume: "第一卷"\nchapter: "1"\nkind: draft\nstatus: 待审阅\n---\nGPT底稿中需要保留的段落。';
    const notesPath = "006_批注/第001章_批注汇总.md";
    const noteText =
      "作者批注：第二场中略微增加教室的环境声音，保留目前克制的语气。";
    const annotationPath = "006_批注/批注.json";
    const anchor = "GPT底稿中需要保留的段落。";
    const webItem = {
      id: "web-comment-01",
      fileRelative: draftPath,
      sourceHash: createHash("sha256").update(draftText).digest("hex"),
      start: draftText.indexOf(anchor),
      end: draftText.indexOf(anchor) + anchor.length,
      quote: anchor,
      comment: "保留这段克制表达。",
      authorText: "保留这段克制表达。",
      status: "resolved",
      updated: "2026-10-06T00:00:00.000Z"
    };
    const annotationText = JSON.stringify({ schema: 1, items: [webItem] });
    f.put(draftPath, draftText);
    f.put(notesPath, noteText);
    f.put(annotationPath, annotationText);
    const draftHash = createHash("sha256").update(draftText).digest("hex");
    f.put(".novel/workflow/chapter-workflow.json", {
      schema: "love-chapter-workflow/v1",
      project: "LOVE",
      updatedAt: "2026-10-05T00:00:00.000Z",
      chapters: {
        "第一卷::1": {
          chapter: 1,
          volume: "第一卷",
          selection: {
            path: draftPath,
            hash: draftHash,
            status: "selected"
          },
          noteSources: [
            {
              path: notesPath,
              hash: createHash("sha256").update(noteText).digest("hex")
            },
            {
              path: annotationPath,
              hash: createHash("sha256").update(annotationText).digest("hex")
            }
          ],
          noteAdoption: {
            schema: "love-annotation-adoption/v1",
            state: "adopted",
            draftPath,
            draftHash,
            annotationItemIds: [webItem.id],
            items: [
              {
                id: webItem.id,
                updated: webItem.updated,
                itemHash: createHash("sha256")
                  .update(JSON.stringify(webItem))
                  .digest("hex"),
                fileRelative: webItem.fileRelative,
                sourceHash: webItem.sourceHash,
                start: webItem.start,
                end: webItem.end,
                quote: webItem.quote,
                authorText: webItem.authorText,
                comment: webItem.comment,
                status: webItem.status,
                sourcePath: annotationPath
              }
            ],
            updatedAt: "2026-10-06T00:00:00.000Z",
            authorAction: {
              path: ".novel/workflow/author-actions/fixture.json",
              hash: "fixture-only",
              requestId: "fixture-author-action",
              quote: "明确采用 web-comment-01"
            }
          }
        }
      }
    });

    const currentRequest = "按当前底稿和已采用批注，只修改批注明确指出的段落。";
    const changedCurrentNative = `${nativeText}\nCore本轮新增资料，不是正典批准。`;
    const selectedOutlineBefore = readFileSync(join(f.root, data.outlinePath), "utf8");
    await expect(
      prepare(f, data, "redraft", undefined, currentRequest)
    ).rejects.toThrow("缺少Core本轮重建的LOVE原生资料");
    await expect(
      prepare(f, data, "redraft", changedCurrentNative, currentRequest)
    ).rejects.toThrow("Core当前资料与LOVE执行snapshot不一致");
    expect(readFileSync(join(f.root, data.outlinePath), "utf8")).toBe(
      selectedOutlineBefore
    );
    expect(
      JSON.parse(readFileSync(join(f.root, ".novel/project.json"), "utf8"))
        .canon.hash
    ).toBe(createHash("sha256").update(nativeText).digest("hex"));

    const prepared = await prepare(
      f,
      data,
      "redraft",
      nativeText,
      currentRequest
    );
    expect(prepared.sourceMode).toBe("redraft");
    expect(prepared.redraftBase?.path).toBe(draftPath);
    expect(prepared.readContent).toContain("GPT底稿中需要保留的段落。");
    expect(prepared.readContent).toContain("保留这段克制表达。");
    expect(prepared.readContent).toContain(
      "作者批注：第二场中略微增加教室的环境声音"
    );
    expect(prepared.readContent).toContain(nativeText);
    const pack = JSON.parse(
      readFileSync(join(f.root, prepared.packPath), "utf8")
    );
    expect(pack.task).toBe("revise");
    expect(pack.target).toBe(draftPath);
    expect(
      pack.sources.find((source: { path: string }) => source.path === draftPath)
        ?.role
    ).toBe("text");
    expect(
      pack.sources.find((source: { path: string }) => source.path === notesPath)
        ?.role
    ).toBe("reference");
    expect(
      pack.sources.find(
        (source: { role: string; path: string }) =>
          source.role === "annotation" && source.path !== notesPath
      )?.path
    ).toBeTruthy();
    expect(
      pack.sources
        .filter((source: { role?: string }) =>
          [
            "character",
            "relationship",
            "scene",
            "timeline",
            "knowledge",
            "unknown"
          ].includes(source.role ?? "")
        )
        .every((source: { path: string }) => source.path === nativePath)
    ).toBe(true);
    const receipt = JSON.parse(
      readFileSync(join(f.root, prepared.receiptPath), "utf8")
    );
    expect(
      receipt.read_sources.some(
        (source: { path: string; hash: string }) =>
          source.path === draftPath &&
          source.hash === prepared.redraftBase?.sha256
      )
    ).toBe(true);
    expect(
      receipt.read_sources.some(
        (source: { path: string }) => source.path === notesPath
      )
    ).toBe(true);
    expect(
      receipt.read_sources.some(
        (source: { path: string }) => source.path === annotationPath
      )
    ).toBe(true);

    const unadoptedState = JSON.parse(
      readFileSync(join(f.root, ".novel/workflow/chapter-workflow.json"), "utf8")
    );
    delete unadoptedState.chapters["第一卷::1"].noteAdoption;
    f.put(".novel/workflow/chapter-workflow.json", unadoptedState);
    await expect(
      prepare(f, data, "redraft", nativeText, currentRequest)
    ).rejects.toThrow("背景批注不能作为修订指令");

    const crossDraftItem = {
      ...webItem,
      fileRelative: "004_写作中/another-draft.md",
      comment: "跨稿意见内容。",
      authorText: "跨稿意见内容。"
    };
    const crossDraftText = JSON.stringify({
      schema: 1,
      items: [crossDraftItem]
    });
    f.put(annotationPath, crossDraftText);
    unadoptedState.chapters["第一卷::1"].noteSources[1].hash = createHash(
      "sha256"
    )
      .update(crossDraftText)
      .digest("hex");
    f.put(".novel/workflow/chapter-workflow.json", unadoptedState);
    const withoutCrossDraftReference = await prepareComparisonCli({
      workspace: f.workspace,
      projectRelative: f.relative,
      projectRoot: f.root,
      chapter: 1,
      volume: "第一卷",
      outline: { path: data.outlinePath, hash: data.outlineHash },
      taskPath: data.taskPath,
      authorizationId: "cross-draft-not-referenced",
      authorText: "请对当前底稿进行整章二次创作，保留现有段落。",
      nativeEvidence: nativeText,
      sourceMode: "redraft"
    });
    expect(withoutCrossDraftReference.readContent).not.toContain("跨稿意见内容。");
    expect(
      JSON.parse(
        readFileSync(join(f.root, withoutCrossDraftReference.packPath), "utf8")
      ).sources.some((source: { path: string }) => source.path === annotationPath)
    ).toBe(false);
    const explicitCrossDraftReference = await prepareComparisonCli({
      workspace: f.workspace,
      projectRelative: f.relative,
      projectRoot: f.root,
      chapter: 1,
      volume: "第一卷",
      outline: { path: data.outlinePath, hash: data.outlineHash },
      taskPath: data.taskPath,
      authorizationId: "cross-draft-reference-only",
      authorText: "请参考上一稿的批注，仅借鉴表达节奏，不改变其原稿。",
      nativeEvidence: nativeText,
      sourceMode: "redraft"
    });
    expect(explicitCrossDraftReference.readContent).toContain("跨稿意见内容。");
    const explicitReferencePack = JSON.parse(
      readFileSync(join(f.root, explicitCrossDraftReference.packPath), "utf8")
    );
    expect(
      explicitReferencePack.sources.find(
        (source: { path: string }) => source.path === annotationPath
      )?.role
    ).toBe("reference");

    // A selected base is sufficient when the author asks for a whole-chapter
    // redraft without referring to comments. Notes remain optional inputs.
    const workflowState = JSON.parse(
      readFileSync(
        join(f.root, ".novel/workflow/chapter-workflow.json"),
        "utf8"
      )
    );
    delete workflowState.chapters["第一卷::1"].noteSources;
    delete workflowState.chapters["第一卷::1"].noteAdoption;
    f.put(".novel/workflow/chapter-workflow.json", workflowState);
    const bareBase = await prepareComparisonCli({
      workspace: f.workspace,
      projectRelative: f.relative,
      projectRoot: f.root,
      chapter: 1,
      volume: "第一卷",
      outline: { path: data.outlinePath, hash: data.outlineHash },
      taskPath: data.taskPath,
      authorizationId: "test-bare-base-redraft",
      authorText: "请在作者选定的 GPT 底稿基础上进行整章二次创作，另存新稿。",
      nativeEvidence: nativeText,
      sourceMode: "redraft"
    });
    expect(bareBase.readContent).toContain("GPT底稿中需要保留的段落。");
    expect(bareBase.redraftBase?.path).toBe(draftPath);
    expect(bareBase.redraftBase?.notePaths).toEqual([]);
    expect(bareBase.readContent).not.toContain("作者批注：第二场");
    const delivered = await deliverComparisonCli({
      workspace: f.workspace,
      projectRelative: f.relative,
      projectRoot: f.root,
      projectId: "otter_0123456789abcdef",
      prepared: bareBase,
      content: "根据底稿进行的整章二次创作隔离文本。",
      title: "测试再创作",
      runtime: {
        provider: "fixture-provider",
        model: "gemini-3.8-flash-high",
        mode: "provider"
      }
    });
    const saved = readFileSync(join(f.root, delivered.path), "utf8");
    expect(saved).toContain('source_mode: "redraft"');
    expect(saved).toContain(draftPath);
    expect(saved).toContain(
      createHash("sha256").update(draftText).digest("hex")
    );
    expect(readFileSync(join(f.root, draftPath), "utf8")).toBe(draftText);
  }, 30_000);

  it("rejects delivery if the selected outline changes after prepare", async () => {
    const data = await setup();
    const prepared = await prepare(data.f, data);
    data.f.put(data.outlinePath, `${data.outlineText}\n变更后的大纲。\n`);
    await expect(
      deliverComparisonCli({
        workspace: data.f.workspace,
        projectRelative: data.f.relative,
        projectRoot: data.f.root,
        projectId: "otter_0123456789abcdef",
        prepared,
        content: "隔离测试稿。",
        title: "测试稿",
        runtime: {
          provider: "fixture-provider",
          model: "gemini-3.8-flash-high",
          mode: "provider"
        }
      })
    ).rejects.toThrow();
  });
});
