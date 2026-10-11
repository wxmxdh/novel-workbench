import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { ComparisonCliPreparation } from "./comparison-cli-bridge";

const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const portable = (value: string) => value.replace(/\\/g, "/");

/**
 * Builds a fresh, real V1 revise Pack and reader Receipt for a local edit.
 * It inherits the selected chapter task's current plan and relevant sources,
 * but binds the target and authorization to this exact saved draft and turn.
 */
export async function prepareLoveLocalRevisionCli(input: {
  workspace: string;
  projectRelative: string;
  projectRoot: string;
  chapter: number;
  volume: string;
  selectedOutline: { path: string; hash: string };
  chapterTaskPath: string;
  sourcePath: string;
  sourceSha256: string;
  authorizationId: string;
  authorRevisionText: string;
  authorRevisionEvidence: { path: string; sha256: string; quote: string };
  nativeEvidence?: string;
}): Promise<ComparisonCliPreparation> {
  const directory = join(input.workspace, "06_脚本工具/写作协议V1");
  const core = await import(
    /* @vite-ignore */ pathToFileURL(join(directory, "novel-cli.mjs")).href
  );
  const flow = await import(
    /* @vite-ignore */ pathToFileURL(join(directory, "flow-v1-1.mjs")).href
  );
  const project = core.loadProject(input.workspace, input.projectRelative);
  const taskFile = core.safe(project.root, input.chapterTaskPath);
  const baseTask = JSON.parse(await readFile(taskFile, "utf8"));
  if (
    baseTask._template_only ||
    baseTask.project !== project.config.project ||
    baseTask.task !== "draft" ||
    baseTask.scope !== "chapter" ||
    baseTask.chapter !== input.chapter ||
    baseTask.volume !== input.volume
  )
    throw new Error("本章当前写作任务缺失或与局部修订范围不一致。");
  if (!/^004_写作中\/第\d{3,}章_正文草稿_[^/\\]+\.md$/u.test(input.sourcePath))
    throw new Error("局部修订来源必须是本章写作目录内的独立稿件。");
  if (!input.authorRevisionText.trim())
    throw new Error("缺少本轮作者明确的局部修订要求。");

  const loveProject = project.config.project === "LOVE";
  let nativeHash: string | undefined;
  let nativeSourcePath: string | undefined;
  if (loveProject) {
    if (!input.nativeEvidence?.trim())
      throw new Error(
        "局部修订缺少Core本轮重建的LOVE原生资料；请从工作台重新读取后准备。"
      );
    const registration = project.config as {
      bridge_owner?: string;
      canon?: { source?: string; hash?: string };
    };
    nativeHash = hash(input.nativeEvidence);
    nativeSourcePath = registration.canon?.source;
    if (
      registration.bridge_owner !== "native-love-comparison-v1" ||
      !nativeSourcePath ||
      registration.canon?.hash !== nativeHash
    )
      throw new Error(
        "Core当前资料与LOVE执行snapshot不一致；请从工作台刷新本轮执行资料后重新准备。"
      );
    let registeredNative: string;
    try {
      registeredNative = await readFile(
        core.safe(project.root, nativeSourcePath),
        "utf8"
      );
    } catch {
      throw new Error(
        "LOVE当前原生资料snapshot缺失；请从工作台刷新执行资料后重新准备。"
      );
    }
    if (
      registeredNative !== input.nativeEvidence ||
      hash(registeredNative) !== nativeHash
    )
      throw new Error(
        "LOVE当前原生资料snapshot已变化；请刷新本轮执行资料后重新准备。"
      );
    const nativeRoles = new Set([
      "character",
      "relationship",
      "scene",
      "timeline",
      "knowledge",
      "unknown"
    ]);
    if (
      (Array.isArray(baseTask.sources) ? baseTask.sources : []).some(
        (source: { path?: string; role?: string }) =>
          nativeRoles.has(source.role ?? "") &&
          source.path !== nativeSourcePath
      )
    )
      throw new Error(
        "当前V1任务仍绑定其他人物或规则snapshot；请刷新LOVE执行资料后重新准备。"
      );
  }

  const asksForNotes = /(?:按|根据|结合).{0,12}(?:批注|意见)/u.test(
    input.authorRevisionText
  );
  const mayReferenceOtherDraft =
    /(?:参考|借鉴|参照).{0,16}(?:批注|意见|别稿|其他稿|另一稿|上一稿|旧稿)|(?:批注|意见|别稿|其他稿|另一稿|上一稿|旧稿).{0,16}(?:参考|借鉴|参照)/u.test(
      input.authorRevisionText
    );
  let annotationSource: { path: string; hash: string } | undefined;
  let backgroundSources: Array<{ path: string; hash: string; section: string }> = [];
  let boundNotePaths: string[] = [];
  let annotationReminder = "";
  if (asksForNotes) {
    const workflowPath = join(
      input.workspace,
      "我的小说工作台/LOVE_Codex审核交接/工具/love-chapter-workflow.mjs"
    );
    const workflow = await import(
      /* @vite-ignore */ pathToFileURL(workflowPath).href
    );
    const prepared = await workflow.prepareLoveChapterContext({
      root: project.root,
      chapter: input.chapter,
      volume: input.volume,
      mode: "redraft",
      nativeEvidence: input.nativeEvidence,
      write: true
    });
    const packet = prepared.packet as {
      selectedOutline?: { path?: string; hash?: string } | null;
      baseDraft?: { path?: string; hash?: string; content?: string } | null;
      authorNotes?: Array<{
        path?: string;
        hash?: string;
        content?: string;
        sourceAlignment?: string;
      }>;
      adoptedAnnotations?: {
        state?: string;
        items?: Array<{ id?: string }>;
        staleItems?: Array<{ id?: string; reason?: string }>;
      };
      files?: { adoptedAnnotations?: string };
      nativeCurrent?: { status?: string; hash?: string; content?: string };
    };
    if (
      loveProject &&
      (packet.nativeCurrent?.status !== "verified_current" ||
        packet.nativeCurrent.hash !== nativeHash ||
        packet.nativeCurrent.content !== input.nativeEvidence)
    )
      throw new Error(
        "章节材料中的Core原生资料与本轮局部修订输入不一致；请重新读取并准备。"
      );
    if (
      packet.baseDraft?.path !== input.sourcePath ||
      packet.baseDraft.hash !== input.sourceSha256
    )
      throw new Error(
        "当前工作流选定底稿与本轮待修订稿不一致，不能套用旧批注。"
      );
    if (
      packet.selectedOutline?.path !== input.selectedOutline.path ||
      packet.selectedOutline.hash !== input.selectedOutline.hash
    )
      throw new Error("批注接续包的大纲版本与本轮 V1 选定大纲不一致。");
    boundNotePaths = (packet.authorNotes ?? [])
      .map((note) => note.path)
      .filter((path): path is string => Boolean(path));
    const adoptedItems = packet.adoptedAnnotations?.items ?? [];
    const staleItems = packet.adoptedAnnotations?.staleItems ?? [];
    if (adoptedItems.length === 0)
      throw new Error(
        "作者要求按批注修订，但当前没有作者明确采用且复验有效的条目；请重新核对并明确采用目标条目。"
      );
    const adoptedPath = packet.files?.adoptedAnnotations;
    if (!adoptedPath)
      throw new Error(
        "当前有效采用批注缺少独立材料文件；请重新准备章节材料后再修订。"
      );
    const adoptedText = await readFile(core.safe(project.root, adoptedPath), "utf8");
    annotationSource = { path: adoptedPath, hash: hash(adoptedText) };
    backgroundSources = (packet.authorNotes ?? [])
      .filter(
        (note) =>
          note.path &&
          note.hash &&
          (note.sourceAlignment !== "cross-draft-or-mixed" ||
            mayReferenceOtherDraft)
      )
      .map((note) => ({
        path: note.path!,
        hash: note.hash!,
        section:
          note.sourceAlignment === "cross-draft-or-mixed"
            ? "作者本轮明确指定的跨稿参考；仅作参考，不修改其原稿"
            : "未采用批注，仅作背景材料，不作为修订指令"
      }));
    if (staleItems.length) {
      annotationReminder = `\n\n本轮批注复验提醒：以下先前采用项已失效，未作为指令：${staleItems
        .map(({ id, reason }) => `${id ?? "未知条目"}（${reason ?? "版本或锚点变化"}）`)
        .join("；")}。请作者重新核对后再采用。`;
    }
    if (!annotationSource.path || !annotationSource.hash)
      throw new Error("已绑定批注缺少独立材料或版本证据，不能进入修订Context。");
    (packet.authorNotes ?? []).forEach((note) => {
      if (!note.path || !note.hash || !note.content)
        throw new Error("已绑定批注缺少原文或版本证据，不能进入修订Context。");
    });
  }

  const id = randomUUID();
  const requestPath = input.authorRevisionEvidence.path;
  const requestContent = await readFile(
    core.safe(project.root, requestPath),
    "utf8"
  );
  if (
    hash(requestContent) !== input.authorRevisionEvidence.sha256 ||
    !requestContent.includes(input.authorRevisionEvidence.quote) ||
    input.authorRevisionEvidence.quote !== input.authorRevisionText
  )
    throw new Error("局部修订授权来源与本轮作者原话不一致。");
  const replacedSourcePaths = new Set([
    input.sourcePath,
    ...(annotationSource ? [annotationSource.path] : []),
    ...boundNotePaths,
    ...backgroundSources.map(({ path }) => path)
  ]);
  const task = {
    ...baseTask,
    task_id: `TASK-${id}`,
    context_id: `CTX-${id}`,
    task: "revise",
    target: input.sourcePath,
    authorization: {
      action: "revise",
      scope: input.sourcePath,
      evidence: {
        path: requestPath,
        hash: input.authorRevisionEvidence.sha256,
        quote: input.authorRevisionEvidence.quote
      }
    },
    author_instructions: [input.authorRevisionText],
    sources: [
      ...(Array.isArray(baseTask.sources)
        ? baseTask.sources.filter(
            (source: { path?: string; role?: string }) =>
              !replacedSourcePaths.has(source.path ?? "") &&
              source.role !== "annotation"
          )
        : []),
      {
        path: input.sourcePath,
        role: "text",
        section: "本轮被指定的待修订稿全文"
      },
      ...backgroundSources.map((note) => ({
        path: note.path,
        role: "reference",
        purpose: note.section,
        section: "full-source"
      })),
      ...(annotationSource
        ? [
            {
              path: annotationSource.path,
              role: "annotation",
              purpose: "仅作者明确采用且当前复验有效的批注是修订指令",
              section: "full-source"
            }
          ]
        : [])
    ]
  };
  const chunks: string[] = [];
  const result = flow.prepareTask(
    project,
    task,
    "deepwrite-love-local-revision",
    core.flowServices(),
    (text: string) => chunks.push(text)
  );
  if (!(["PASS", "WARN"] as string[]).includes(result.status))
    throw new Error(`局部修订共用写作预检未通过：${result.status}`);
  const pack = JSON.parse(await readFile(result.pack, "utf8"));
  if (loveProject) {
    const currentNativeSource = pack.sources?.find(
      (source: { path?: string; hash?: string }) =>
        source.path === nativeSourcePath && source.hash === nativeHash
    );
    if (!currentNativeSource)
      throw new Error(
        "V1 Context没有实际读取Core本轮LOVE原生资料；请刷新执行资料后重新准备。"
      );
    const nativeRoles = new Set([
      "character",
      "relationship",
      "scene",
      "timeline",
      "knowledge",
      "unknown"
    ]);
    if (
      pack.sources.some(
        (source: { path?: string; role?: string }) =>
          nativeRoles.has(source.role ?? "") &&
          source.path !== nativeSourcePath
      )
    )
      throw new Error(
        "V1 Context同时读取了其他人物或规则snapshot；局部修订已停止，请刷新当前执行资料。"
      );
  }
  if (
    pack.task !== "revise" ||
    pack.target !== input.sourcePath ||
    pack.selected_outline?.path !== input.selectedOutline.path ||
    pack.selected_outline?.hash !== input.selectedOutline.hash ||
    !pack.sources.some(
      (source: { path: string; role: string }) =>
        source.path === input.sourcePath && source.role === "text"
    )
  )
    throw new Error("局部修订V1 Context与来源稿、大纲或任务类型不一致。");
  const revisionSource = pack.sources.find(
    (source: { path: string; role: string; hash: string }) =>
      source.path === input.sourcePath && source.role === "text"
  );
  if (!revisionSource?.hash || revisionSource.hash !== input.sourceSha256)
    throw new Error("局部修订 V1 Context 未记录同一版原稿 hash，拒绝继续。");
  for (const note of [
    ...(annotationSource ? [annotationSource] : []),
    ...backgroundSources.map(({ path, hash }) => ({ path, hash }))
  ]) {
    const source = pack.sources?.find(
      (item: { path?: string; hash?: string }) => item.path === note.path
    );
    if (!source || source.hash !== note.hash)
      throw new Error(`批注材料在Context读取期间发生变化：${note.path}`);
  }
  return {
    packPath: portable(relative(project.root, result.pack)),
    receiptPath: portable(relative(project.root, result.receipt)),
    contextId: pack.context_id,
    readContent: `${chunks.join("")}${annotationReminder}`,
    comparisonBaseline: pack.comparison_baseline_hash,
    revisionBase: { path: input.sourcePath, sha256: revisionSource.hash },
    ...(nativeHash && nativeSourcePath
      ? { nativeEvidenceHash: nativeHash, nativeSourcePath }
      : {})
  };
}
