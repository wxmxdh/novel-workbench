import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentRuntimeRef } from "@deepwrite/contracts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const portable = (value: string) => value.replace(/\\/g, "/");

async function cli(workspace: string) {
  const directory = join(workspace, "06_脚本工具/写作协议V1");
  return {
    core: await import(
      /* @vite-ignore */ pathToFileURL(join(directory, "novel-cli.mjs")).href
    ),
    flow: await import(
      /* @vite-ignore */ pathToFileURL(join(directory, "flow-v1-1.mjs")).href
    ),
    delivery: await import(
      /* @vite-ignore */ pathToFileURL(join(directory, "draft-delivery.mjs"))
        .href
    )
  };
}

export interface ComparisonCliPreparation {
  packPath: string;
  receiptPath: string;
  contextId: string;
  readContent: string;
  comparisonBaseline: string;
  nativeEvidenceHash?: string;
  nativeSourcePath?: string;
  sourceMode?: "independent" | "redraft";
  redraftBase?: {
    path: string;
    sha256: string;
    notePaths: string[];
    noteSources: Array<{ path: string; sha256: string }>;
  };
  previousChapter?: { chapter: number; path: string; sha256: string };
  revisionBase?: { path: string; sha256: string };
}

function explicitlyRequestsBoundNotes(authorText: string): boolean {
  return /(?:按|根据|结合|照着|参照|依据).{0,16}(?:批注|意见)|(?:批注|意见).{0,16}(?:这些|上面|我给|我写|我的|文件)/u.test(
    authorText
  );
}

function explicitlyReferencesOtherDraftNotes(authorText: string): boolean {
  return /(?:参考|借鉴|参照).{0,16}(?:批注|意见|别稿|其他稿|另一稿|上一稿|旧稿)|(?:批注|意见|别稿|其他稿|另一稿|上一稿|旧稿).{0,16}(?:参考|借鉴|参照)/u.test(
    authorText
  );
}

/** Uses the public protocol rather than inventing a second receipt/preflight. */
export async function prepareComparisonCli(input: {
  workspace: string;
  projectRelative: string;
  projectRoot: string;
  chapter: number;
  volume: string;
  outline: { path: string; hash: string };
  taskPath: string;
  authorizationId: string;
  authorText: string;
  nativeEvidence?: string;
  sourceMode?: "independent" | "redraft";
}): Promise<ComparisonCliPreparation> {
  const { core, flow } = await cli(input.workspace);
  const project = core.loadProject(input.workspace, input.projectRelative);
  const task = JSON.parse(
    await readFile(core.safe(project.root, input.taskPath), "utf8")
  );
  if (
    task._template_only ||
    task.project !== project.config.project ||
    task.task !== "draft" ||
    task.scope !== "chapter" ||
    task.chapter !== input.chapter ||
    task.volume !== input.volume
  )
    throw new Error(
      "本章比较写作任务登记缺失或范围不一致，不能用示例任务代替。"
    );
  const loveProject = project.config.project === "LOVE";
  let nativeHash: string | undefined;
  let nativeSourcePath: string | undefined;
  const nativeAuthorityRoles = new Set([
    "character",
    "relationship",
    "scene",
    "timeline",
    "knowledge",
    "unknown"
  ]);
  if (loveProject) {
    if (!input.nativeEvidence?.trim())
      throw new Error(
        "缺少Core本轮重建的LOVE原生资料；请从工作台重新读取并准备，不能使用旧snapshot写作。"
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
        "Core当前资料与LOVE执行snapshot不一致；请通过工作台刷新本轮执行资料后重新准备，未使用两份冲突内容。"
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
        "LOVE当前原生资料snapshot已变化；请从工作台刷新执行资料后重新准备。"
      );
    task.sources = Array.isArray(task.sources) ? task.sources : [];
    if (
      task.sources.some(
        (source: { path?: string; role?: string }) =>
          nativeAuthorityRoles.has(source.role ?? "") &&
          source.path !== nativeSourcePath
      )
    )
      throw new Error(
        "写作任务仍绑定其他人物或规则snapshot；请刷新LOVE当前执行资料后重新准备，避免混用旧版本。"
      );
  }
  let redraftBase: ComparisonCliPreparation["redraftBase"];
  let previousChapter: ComparisonCliPreparation["previousChapter"];
  if (
    loveProject &&
    (input.sourceMode === "redraft" || input.chapter > 1)
  ) {
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
      mode: input.sourceMode === "redraft" ? "redraft" : "continue",
      nativeEvidence: input.nativeEvidence,
      write: true
    });
    const packet = prepared.packet as {
      selectedOutline?: { path?: string; hash?: string } | null;
      baseDraft?: { path?: string; hash?: string; content?: string } | null;
      previousDraft?: {
        chapter?: number;
        path?: string;
        hash?: string;
        content?: string;
      } | null;
      authorNotes?: Array<{
        path?: string;
        hash?: string;
        content?: string;
        sourceAlignment?: string;
      }>;
      adoptedAnnotations?: {
        state?: string;
        items?: Array<{ id?: string; sourcePath?: string }>;
      };
      files?: { adoptedAnnotations?: string };
      nativeCurrent?: { status?: string; hash?: string; content?: string };
    };
    if (
      packet.nativeCurrent?.status !== "verified_current" ||
      packet.nativeCurrent.hash !== nativeHash ||
      packet.nativeCurrent.content !== input.nativeEvidence
    )
      throw new Error(
        "章节材料中的Core原生资料与本轮输入不一致；请重新读取并准备，未继续写作。"
      );
    if (
      packet.selectedOutline?.path !== input.outline.path ||
      packet.selectedOutline.hash !== input.outline.hash
    )
      throw new Error("章节接续材料中的当前已选大纲与本轮写作大纲不一致。");
    if (input.chapter > 1) {
      const previous = packet.previousDraft;
      if (!previous?.path || !previous.hash || !previous.content)
        throw new Error("缺少作者选用的前章全文；不从候选稿猜测章节接续来源。");
      previousChapter = {
        chapter: previous.chapter ?? input.chapter - 1,
        path: previous.path,
        sha256: previous.hash
      };
    }
    task.sources = Array.isArray(task.sources) ? task.sources : [];
    if (input.sourceMode === "redraft") {
      const base = packet.baseDraft;
      if (!base?.path || !base.hash || !base.content)
        throw new Error("再创作缺少作者明确选择的当前底稿，停止，不猜测多稿。");
      const notes = packet.authorNotes ?? [];
      const adoptedItems = packet.adoptedAnnotations?.items ?? [];
      if (!adoptedItems.length && explicitlyRequestsBoundNotes(input.authorText))
        throw new Error(
          "作者明确要求依据批注/意见再创作，但当前没有作者明确采用且复验有效的条目；背景批注不能作为修订指令，请先明确采用目标条目后重新准备。"
        );
      const mayReferenceOtherDraft =
        explicitlyReferencesOtherDraftNotes(input.authorText);
      const usableBackgroundNotes = notes.filter(
        (note) =>
          note.path &&
          (note.sourceAlignment !== "cross-draft-or-mixed" ||
            mayReferenceOtherDraft)
      );
      let adoptedPath: string | undefined;
      let adoptedHash: string | undefined;
      if (adoptedItems.length) {
        adoptedPath = packet.files?.adoptedAnnotations;
        if (!adoptedPath)
          throw new Error(
            "当前采用批注缺少独立材料文件；请重新准备章节材料后再创作。"
          );
        const adoptedText = await readFile(
          core.safe(project.root, adoptedPath),
          "utf8"
        );
        adoptedHash = hash(adoptedText);
      }
      task.task = "revise";
      task.target = base.path;
      const notePaths = new Set([
        ...notes.map((note) => note.path).filter(Boolean),
        adoptedPath
      ]);
      task.sources = [
        ...task.sources.filter(
          (source: { path?: string }) =>
            source.path !== base.path && !notePaths.has(source.path)
        ),
        {
          path: base.path,
          role: "text",
          purpose: "作者明确选择的再创作底稿；全文作为当前修订目标",
          section: "full-source"
        },
        ...usableBackgroundNotes.map((note) => ({
          path: note.path,
          role: "reference",
          purpose:
            note.sourceAlignment === "cross-draft-or-mixed"
              ? "作者本轮明确指定的跨稿参考；仅作参考，不修改或覆盖其原稿，也不是正典"
              : "未采用批注，仅作背景材料；不得作为修订指令或升级为正典",
          section: "full-source"
        })),
        ...(adoptedPath
          ? [
              {
                path: adoptedPath,
                role: "annotation",
                purpose:
                  "仅此文件中的作者本轮明确采用且当前复验有效的批注是修订指令；不升级为正典",
                section: "full-source"
              }
            ]
          : [])
      ];
      task.author_instructions = [
        ...(Array.isArray(task.author_instructions)
          ? task.author_instructions
          : []),
        "本次是在作者明确选择的底稿上再创作。只有独立采用批注文件中的当前有效条目可作为修订指令；其他批注仅作背景，跨稿材料只有作者本轮明确要求参考时才能读取为参考，绝不修改或覆盖其原稿。按作者本轮指定的范围修改；局部意见不自动扩大为整章重写，作者明确要求整章二次创作时可以另存整章版本。保留作者认可且未要求改变的内容。"
      ];
      const noteSources = [
        ...usableBackgroundNotes.map((note) => ({
          path: note.path!,
          sha256: note.hash!
        })),
        ...(adoptedPath && adoptedHash
          ? [{ path: adoptedPath, sha256: adoptedHash }]
          : [])
      ];
      redraftBase = {
        path: base.path,
        sha256: base.hash,
        notePaths: noteSources.map((note) => note.path),
        noteSources
      };
    }
    if (previousChapter) {
      task.sources = [
        ...task.sources.filter(
          (source: { path?: string }) => source.path !== previousChapter!.path
        ),
        {
          path: previousChapter.path,
          role: "text",
          purpose: "作者选用的前章已发生内容与人物当前状态，不自动升级为正典",
          section: "full-source"
        }
      ];
    }
  }
  const requestPath = `.novel/author-requests/${input.authorizationId}.md`;
  const absolute = core.safe(project.root, requestPath, false);
  await mkdir(join(project.root, ".novel/author-requests"), {
    recursive: true
  });
  try {
    await writeFile(absolute, input.authorText, { flag: "wx" });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      (await readFile(absolute, "utf8")) !== input.authorText
    )
      throw error;
  }
  task.task_id = `TASK-${randomUUID()}`;
  task.context_id = `CTX-${randomUUID()}`;
  task.authorization = {
    action: redraftBase ? "revise" : "draft",
    scope: task.target,
    evidence: {
      path: requestPath,
      hash: hash(input.authorText),
      quote: input.authorText
    }
  };
  const chunks: string[] = [];
  const result = flow.prepareTask(
    project,
    task,
    "deepwrite-comparison-writer",
    core.flowServices(),
    (text: string) => chunks.push(text)
  );
  if (!["PASS", "WARN"].includes(result.status))
    throw new Error(`共用写作预检未通过：${result.status}`);
  const pack = JSON.parse(await readFile(result.pack, "utf8"));
  if (loveProject) {
    const currentNativeSource = pack.sources.find(
      (source: { path?: string; hash?: string }) =>
        source.path === nativeSourcePath && source.hash === nativeHash
    );
    if (!currentNativeSource)
      throw new Error(
        "V1 Context没有实际读取Core本轮原生资料；请刷新LOVE执行资料并重新准备。"
      );
    if (
      pack.sources.some(
        (source: { path?: string; role?: string }) =>
          nativeAuthorityRoles.has(source.role ?? "") &&
          source.path !== nativeSourcePath
      )
    )
      throw new Error(
        "V1 Context同时读取了其他人物或规则snapshot；本轮停止，请刷新LOVE执行资料后重新准备。"
      );
  }
  if (
    pack.selected_outline?.path !== input.outline.path ||
    pack.selected_outline?.hash !== input.outline.hash
  )
    throw new Error("共用Context所选大纲与本次准备的大纲不一致。");
  if (redraftBase) {
    const expected = [
      { path: redraftBase.path, sha256: redraftBase.sha256 },
      ...redraftBase.noteSources
    ];
    for (const { path: sourcePath, sha256: expectedHash } of expected) {
      const source = pack.sources.find(
        (item: { path?: string }) => item.path === sourcePath
      );
      if (!source || source.hash !== expectedHash)
        throw new Error(`再创作资料在 Context 读取期间发生变化：${sourcePath}`);
    }
  }
  if (previousChapter) {
    const source = pack.sources.find(
      (item: { path?: string; hash?: string; role?: string }) =>
        item.path === previousChapter!.path &&
        item.hash === previousChapter!.sha256 &&
        item.role === "text"
    );
    if (!source)
      throw new Error(
        `V1 Context/Receipt 未实际读取前章选用稿或版本已变化：${previousChapter.path}`
      );
  }
  return {
    packPath: portable(relative(project.root, result.pack)),
    receiptPath: portable(relative(project.root, result.receipt)),
    contextId: pack.context_id,
    comparisonBaseline: pack.comparison_baseline_hash,
    ...(nativeHash && nativeSourcePath
      ? { nativeEvidenceHash: nativeHash, nativeSourcePath }
      : {}),
    readContent: chunks.join(""),
    ...(input.sourceMode ? { sourceMode: input.sourceMode } : {}),
    ...(redraftBase ? { redraftBase } : {}),
    ...(previousChapter ? { previousChapter } : {})
  };
}

export async function deliverComparisonCli(input: {
  workspace: string;
  projectRelative: string;
  projectRoot: string;
  projectId: string;
  prepared: ComparisonCliPreparation;
  content: string;
  title: string;
  runtime: AgentRuntimeRef;
}) {
  const { core, delivery } = await cli(input.workspace);
  const project = core.loadProject(input.workspace, input.projectRelative);
  const pack = JSON.parse(
    await readFile(core.safe(project.root, input.prepared.packPath), "utf8")
  );
  if (input.prepared.nativeEvidenceHash || input.prepared.nativeSourcePath) {
    const nativeHash = input.prepared.nativeEvidenceHash;
    const nativeSourcePath = input.prepared.nativeSourcePath;
    const registration = project.config as {
      bridge_owner?: string;
      canon?: { source?: string; hash?: string };
    };
    if (
      !nativeHash ||
      !nativeSourcePath ||
      registration.bridge_owner !== "native-love-comparison-v1" ||
      registration.canon?.source !== nativeSourcePath ||
      registration.canon.hash !== nativeHash
    )
      throw new Error(
        "LOVE当前原生资料登记已变化；请从工作台重新读取并准备后再交付。"
      );
    let currentNative: string;
    try {
      currentNative = await readFile(
        core.safe(project.root, nativeSourcePath),
        "utf8"
      );
    } catch {
      throw new Error(
        "LOVE当前原生资料snapshot不可读取；请刷新本轮资料后重新准备。"
      );
    }
    if (hash(currentNative) !== nativeHash)
      throw new Error(
        "LOVE原生资料在准备后已变化；请刷新本轮资料并重新准备，未交付稿件。"
      );
    const nativeSource = pack.sources?.find(
      (source: { path?: string; hash?: string }) =>
        source.path === nativeSourcePath && source.hash === nativeHash
    );
    if (!nativeSource)
      throw new Error(
        "V1 Context未绑定本轮LOVE原生资料hash，拒绝交付修订稿。"
      );
  }
  const revisionBase =
    input.prepared.revisionBase ?? input.prepared.redraftBase;
  if (revisionBase) {
    const source = pack.sources?.find(
      (item: { path?: string; hash?: string; role?: string }) =>
        item.path === revisionBase.path &&
        item.hash === revisionBase.sha256 &&
        item.role === "text"
    );
    if (!source)
      throw new Error(
        "V1 Receipt/Context 未绑定原稿路径与 hash，拒绝交付局部修订。"
      );
  }
  const receipt = JSON.parse(
    await readFile(core.safe(project.root, input.prepared.receiptPath), "utf8")
  );
  const unique = randomUUID();
  const bodyPath = `.novel/tmp/comparison-${unique}.md`;
  const bodyFile = core.safe(project.root, bodyPath, false);
  await mkdir(join(project.root, ".novel/tmp"), { recursive: true });
  await writeFile(bodyFile, input.content.trim() + "\n", { flag: "wx" });
  const sessionId = `otter:${input.projectId}:${pack.context_id}:${unique}`;
  const sessionFile = core.safe(
    project.root,
    `.novel/tmp/runtime-${unique}.jsonl`,
    false
  );
  await writeFile(
    sessionFile,
    JSON.stringify({
      type: "deepwrite_response",
      schema_version: 1,
      sessionId,
      contextId: pack.context_id,
      workspaceRoot: input.workspace,
      projectId: input.projectId,
      runId: `comparison-${unique}`,
      runtime: input.runtime,
      contentHash: hash(input.content.trim() + "\n"),
      completedAt: new Date().toISOString()
    }) + "\n",
    { flag: "wx" }
  );
  const version = pack.selected_outline
    ? ((
        await readFile(
          core.safe(project.root, pack.selected_outline.path),
          "utf8"
        )
      )
        .match(/^version:\s*["']?([^\r\n"']+)/mu)?.[1]
        ?.trim() ?? "unknown")
    : "unknown";
  const metadata = (...args: unknown[]) => {
    const fields = [
      `outline_version: ${JSON.stringify(version)}`,
      `source_mode: ${JSON.stringify(input.prepared.revisionBase ? "local_revision" : (input.prepared.sourceMode ?? "independent"))}`
    ];
    if (revisionBase)
      fields.push(
        `revision_of: ${JSON.stringify(revisionBase.path)}`,
        `base_hash: ${JSON.stringify(revisionBase.sha256)}`
      );
    return core
      .draftMetadata(...args)
      .replace(/\n---$/u, `\n${fields.join("\n")}\n---`);
  };
  const result = delivery.deliverDraft(
    project,
    pack,
    receipt,
    {
      body_file: bodyPath,
      title: input.title,
      summary:
        "经本轮共用Context读取、preflight与交付契约核验；文学质量等待作者与Codex审阅。",
      ...(revisionBase
        ? {
            revision_base: {
              path: revisionBase.path,
              sha256: revisionBase.sha256
            }
          }
        : {}),
      used_skills: [],
      generator: "deepwrite",
      session_file: sessionFile,
      session_id: sessionId
    },
    {
      safe: core.safe,
      checkPack: core.checkPack,
      evidence: core.flowServices().evidence,
      draftMetadata: metadata,
      finishTask: core.finishTask
    }
  );
  if (
    result.identity.model_raw !== input.runtime.model ||
    result.identity.model === "unknown"
  )
    throw new Error("交付运行型号未核验，不能报告交付完成。");
  const artifact = await readFile(
    core.safe(project.root, result.artifact),
    "utf8"
  );
  return {
    path: result.artifact,
    sha256: hash(artifact),
    model: result.identity.model_raw,
    deliveryRecord: result.delivery
  };
}
