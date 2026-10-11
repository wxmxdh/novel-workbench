import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { LongPrepareComparisonDraftInput } from "@deepwrite/contracts";
import { withExternalProjectLock } from "./external-project-operations";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const owner = "native-love-comparison-v1";
export interface NativeComparisonSource {
  cardTitle: string;
  cardContent: string;
  chapterCardId: string;
  volumeId: string;
  volumeLabel: string;
  volumeContent: string;
  nativeEvidence?: string;
}

/** Execution registration only. Native book remains the authority; no story facts are approved. */
export async function registerNativeComparison(input: {
  workspace: string;
  relative: string;
  root: string;
  request: LongPrepareComparisonDraftInput;
  source: NativeComparisonSource;
}) {
  const { request, source, root } = input;
  const nativeEvidence = source.nativeEvidence;
  if (!nativeEvidence?.trim()) return;
  if (!/^[\w-]{16,128}$/u.test(request.authorizationId))
    throw new Error("写作授权标识不合法。");
  return withExternalProjectLock(root, async () => {
    const directory = join(input.workspace, "06_脚本工具/写作协议V1");
    const core = await import(
      /* @vite-ignore */ pathToFileURL(join(directory, "novel-cli.mjs")).href
    );
    const flow = await import(
      /* @vite-ignore */ pathToFileURL(join(directory, "flow-v1-1.mjs")).href
    );
    const read = async (path: string) =>
      JSON.parse(await readFile(core.safe(root, path), "utf8"));
    const put = async (path: string, value: unknown) => {
      const file = core.safe(root, path, false);
      const bytes =
        typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2) + "\n";
      await mkdir(dirname(file), { recursive: true });
      try {
        await writeFile(file, bytes, { flag: "wx" });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await readFile(file, "utf8")) !== bytes
        )
          throw error;
      }
      return hash(bytes);
    };
    let config: Record<string, unknown> | undefined;
    try {
      config = await read(".novel/project.json");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        !(error instanceof Error && error.message.includes("文件缺失"))
      )
        throw error;
    }
    // An independently registered project must keep its own source decisions.
    if (config && config.bridge_owner !== owner) return;
    if (hash(source.cardContent) !== request.chapterCardSha256)
      throw new Error("当前章卡内容与本轮准备版本不一致，请重新读取章卡。");
    const outlineText = `---\nkind: outline\nchapter: ${request.chapter}\nvolume: ${JSON.stringify(source.volumeLabel)}\nversion: native-${request.chapterCardSha256.slice(0, 12)}\n---\n${source.cardContent}`;
    const outlineHash = hash(outlineText);
    let retainedOutline: { path: string; hash: string } | undefined;
    if (config) {
      const previousProject = core.loadProject(input.workspace, input.relative);
      const previousState = flow.chapterState(
        previousProject,
        core.flowServices()
      );
      const matching = previousState.chapters.filter(
        (entry: { chapter: number; volume: string; status?: string }) =>
          entry.chapter === request.chapter &&
          entry.volume === source.volumeLabel &&
          entry.status !== "retired"
      );
      if (matching.length > 1)
        throw new Error("本章登记不唯一，请先核对当前卷章，不会重新选择大纲。");
      if (matching[0]?.selected_outline) {
        const chosen = flow.selectedOutline(
          previousProject,
          {
            chapter: request.chapter,
            volume: source.volumeLabel
          },
          core.flowServices()
        );
        if (chosen.hash !== outlineHash)
          throw new Error(
            "当前章卡与作者已选大纲不是同一版本。请核对执行来源；写稿或重试不会自动重新选纲。"
          );
        retainedOutline = { path: chosen.path, hash: chosen.hash };
      }
    }
    const base = `.novel/native-sources/${hash(nativeEvidence)}`;
    const evidencePath = `${base}/native-current.md`;
    const evidenceHash = await put(evidencePath, nativeEvidence);
    const entryPath = `${base}/source-entry.md`;
    await put(
      entryPath,
      `# LOVE 原生来源定位\n\n${evidencePath}\n${evidenceHash}\n\n仅为当前原生书资料的运行快照，原状态与未知保留；章卡及作者本轮修正属于执行要求，不因此成为正典。\n`
    );
    if (!config) {
      config = {
        schema_version: 1,
        project: "LOVE",
        bridge_owner: owner,
        active_source: entryPath,
        entry_sources: ["AGENTS.md", entryPath],
        canon: {
          source: evidencePath,
          hash: evidenceHash,
          version: `native-${evidenceHash.slice(0, 12)}`
        },
        chapter_state: ".novel/chapter-state.json",
        derived_registry: ".novel/derived-registry.json",
        protected_sources: [evidencePath],
        reference_sources: []
      };
      core.registerProject(input.workspace, input.relative, config);
    } else if ((config.canon as { hash: string }).hash !== evidenceHash) {
      config = {
        ...config,
        active_source: entryPath,
        entry_sources: ["AGENTS.md", entryPath],
        canon: {
          source: evidencePath,
          hash: evidenceHash,
          version: `native-${evidenceHash.slice(0, 12)}`
        },
        protected_sources: [evidencePath]
      };
      const old = await readFile(
        core.safe(root, ".novel/project.json"),
        "utf8"
      );
      core
        .flowServices()
        .atomic(core.safe(root, ".novel/project.json"), config, hash(old));
    }
    const runBase = `.novel/native-execution/${request.authorizationId}`;
    const authorPath = `${runBase}/author-request.md`;
    const authorHash = await put(authorPath, request.authorRequest.exactText);
    const outlinePath = retainedOutline?.path ?? `${runBase}/chapter-card.md`;
    if (!retainedOutline) await put(outlinePath, outlineText);
    const scope = {
      project: "LOVE",
      chapter: request.chapter,
      volume: source.volumeLabel
    };
    const proof = {
      actor: "user",
      scope,
      path: authorPath,
      hash: authorHash,
      quote: request.authorRequest.authorizationQuote
    };
    const project = core.loadProject(input.workspace, input.relative);
    const services = core.flowServices();
    let state = flow.chapterState(project, services);
    const existing = state.chapters.find(
      (entry: { chapter: number; volume: string; status?: string }) =>
        entry.chapter === request.chapter &&
        entry.volume === source.volumeLabel &&
        entry.status !== "retired"
    );
    const taskPath = `${runBase}/task.json`;
    if (existing?.comparison_task === taskPath) {
      if (existing.selected_outline?.hash !== outlineHash)
        throw new Error("同一写作批次的大纲版本已变化。");
      return;
    }
    if (!retainedOutline)
      flow.selectOutlineSource(
        project,
        {
          project: "LOVE",
          chapter: request.chapter,
          volume: source.volumeLabel,
          volume_confirmation: proof,
          selection_evidence: proof,
          source_outline: { path: outlinePath, hash: outlineHash }
        },
        services
      );
    state = flow.chapterState(project, services);
    const selected = state.chapters.find(
      (entry: { chapter: number; volume: string; status?: string }) =>
        entry.chapter === request.chapter &&
        entry.volume === source.volumeLabel &&
        entry.status !== "retired"
    );
    await put(taskPath, {
      schema_version: 1,
      project: "LOVE",
      task: "draft",
      scope: "chapter",
      chapter: request.chapter,
      volume: source.volumeLabel,
      volume_confirmation: selected.volume_confirmation,
      plan: selected.registered_plan.path,
      target: "004_写作中/新模型候选稿.md",
      pov: "宋子凡",
      relevant_characters: ["宋子凡", "贾思远", "程北辰"],
      relevant_relationships: [],
      knowledge_boundary: [],
      intentional_unknowns: [],
      recent_context: [],
      author_instructions: [request.authorRequest.exactText],
      skills_allowed: ["otter-novel"],
      reference_scope: [],
      forbidden_future_info: [],
      sources: [
        {
          path: evidencePath,
          role: "character",
          entities: ["宋子凡", "贾思远", "程北辰"],
          section: "当前原生人物全文，保留未决与来源身份"
        },
        {
          path: evidencePath,
          role: "relationship",
          section: "当前关系全文；不补未知"
        },
        ...["scene", "timeline", "knowledge", "unknown"].map((role) => ({
          path: evidencePath,
          role,
          section: "原生资料与章卡中的原文边界，不另造设定"
        }))
      ]
    });
    selected.comparison_task = taskPath;
    const statePath = core.safe(root, ".novel/chapter-state.json");
    const oldState = await readFile(statePath, "utf8");
    services.atomic(statePath, state, hash(oldState));
  });
}
