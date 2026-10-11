import {
  NovelPlotCandidateSetSchema,
  NovelRequirementReviewSchema,
  type NovelPlotCandidateSet,
  type NovelRequirementReview,
  type WorkbenchPrepared,
  type WorkbenchTask
} from "@deepwrite/contracts";
import type { NovelChapterSource } from "./sources";

export async function prepareNovelRun(
  bookId: string,
  chapterCardId: string,
  sources: NovelChapterSource[]
): Promise<WorkbenchPrepared> {
  const api = window.deepwrite?.workbenchCollaboration;
  if (!api) throw new Error("工作台协作服务尚未就绪。");
  const response = await api.request({
    operation: "prepare",
    bookId,
    chapterCardId,
    fileIds: sources.map((source) => source.fileId)
  });
  if (response.kind !== "prepared")
    throw new Error("工作台没有返回当前作品的准备资料。");
  const prepared = response.prepared;
  if (
    prepared.bookId !== bookId ||
    prepared.chapterCardId !== chapterCardId ||
    !prepared.sources.length
  )
    throw new Error("工作台没有返回当前作品的准备资料。");
  if (
    prepared.sources.some(
      (source) =>
        !sources.some(
          (loaded) =>
            loaded.fileId === source.fileId && loaded.sha256 === source.sha256
        )
    )
  )
    throw new Error("准备阶段发现资料版本变化，请刷新后重新运行。");
  return prepared;
}

export async function startNovelTask(
  bookId: string,
  preparedId: string,
  modelId: string,
  prompt: string,
  purpose: "brainstorm" | "review"
): Promise<WorkbenchTask> {
  const response = await window.deepwrite?.workbenchCollaboration?.request({
    operation: "start",
    preparedId,
    requestKey: crypto.randomUUID(),
    modelId,
    prompt,
    purpose
  });
  if (!response || response.kind !== "task")
    throw new Error("工作台未能启动所选模型。");
  const task = response.task;
  if (task.bookId !== bookId || task.modelId !== modelId)
    throw new Error("工作台返回了不匹配的作品或模型任务。");
  if (task.status === "failed") throw new Error(task.error || "模型任务失败。");
  return task;
}

export async function waitNovelTask(
  bookId: string,
  initial: WorkbenchTask,
  onActiveChange: (taskId: string, active: boolean) => void
): Promise<WorkbenchTask> {
  let task = initial;
  onActiveChange(task.id, true);
  try {
    const deadline = Date.now() + 5 * 60_000;
    while (task.status === "running" && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      const response = await window.deepwrite?.workbenchCollaboration?.request({
        operation: "get",
        taskId: task.id,
        bookId
      });
      const latest = response?.kind === "task" ? response.task : undefined;
      if (!latest || latest.bookId !== bookId || latest.id !== task.id)
        throw new Error("任务状态无法核验。");
      task = latest;
    }
    if (task.status === "running") {
      await cancelNovelTask(bookId, task.id);
      throw new Error("模型任务运行超过五分钟，已发出停止请求。");
    }
    if (task.status !== "completed")
      throw new Error(task.error || "模型任务未完成。");
    return task;
  } finally {
    onActiveChange(task.id, false);
  }
}

export async function cancelNovelTask(
  bookId: string,
  taskId: string
): Promise<void> {
  await window.deepwrite?.workbenchCollaboration?.request({
    operation: "cancel",
    taskId,
    bookId
  });
}

export async function saveNovelCandidate(
  bookId: string,
  taskId: string
): Promise<void> {
  const response = await window.deepwrite?.workbenchCollaboration?.request({
    operation: "saveCandidate",
    taskId,
    bookId
  });
  if (!response || response.kind !== "task" || !response.task.savedSource)
    throw new Error("候选没有保存成功。");
}

export function novelReviewPrompt(
  prepared: WorkbenchPrepared,
  instructions: string,
  outlineContext: string
): string {
  const sourceList = prepared.sources
    .map((source) => `${source.fileId} | ${source.path}`)
    .join("\n");
  return `请核对作者给出的每条本章要求是否在本章正文落实。不要仅凭关键词判断剧情或心理；每条只能标为 supported（正文有直接证据）、missing（正文未出现）、uncertain（现有材料不能判断）。supported 必须引用正文里的连续原句，并给出从文件开头算起的 UTF-16 字符偏移，引用必须逐字匹配。不要把背景资料要求误判为本章必须出现。只返回 JSON：{"checks":[{"id":"req-1","requirement":"原要求","kind":"must-appear|must-preserve|background|exploration","status":"supported|missing|uncertain","evidence":[{"fileId":"来源fileId","start":0,"end":1,"quote":"原文","explanation":"判断理由"}],"note":"可选说明"}]}。大纲来源状态：\n${outlineContext}\n来源列表：\n${sourceList}\n\n作者要求：\n${instructions}`;
}

export function novelCandidatePrompt(
  prepared: WorkbenchPrepared,
  question: string,
  outlineContext: string
): string {
  const sourceList = prepared.sources
    .map((source) => `${source.fileId} | ${source.path}`)
    .join("\n");
  return `围绕作者的问题提出一个独立剧情候选。尊重已选章节资料，不把新增推测写成已确认设定；说明行动、动机、与现有约束的关系，以及需要作者确认的新设定。只输出可供作者讨论的候选文本，不写入作品。作品：${prepared.title}\n本章问题：${question}\n大纲来源状态：\n${outlineContext}\n资料来源：\n${sourceList}`;
}

export function parseNovelReview(
  task: WorkbenchTask,
  bookId: string,
  chapterCardId: string,
  sources: NovelChapterSource[]
): NovelRequirementReview {
  const raw = parseObject(task.content);
  const checksRaw = Array.isArray(raw.checks) ? raw.checks : [];
  const checks = checksRaw.map((item, index) => {
    if (!item || typeof item !== "object")
      throw new Error("核对结果格式不完整。");
    const check = item as Record<string, unknown>;
    const evidence = Array.isArray(check.evidence)
      ? check.evidence.map((value) => {
          if (!value || typeof value !== "object")
            throw new Error("原文证据格式不完整。");
          const entry = value as Record<string, unknown>;
          const source = sources.find(
            (candidate) => candidate.fileId === entry.fileId
          );
          if (
            !source ||
            source.role !== "draft" ||
            typeof entry.start !== "number" ||
            typeof entry.end !== "number" ||
            typeof entry.quote !== "string" ||
            typeof entry.explanation !== "string"
          )
            throw new Error("核对结果引用了未准备的文件或缺少原文位置。");
          if (source.content.slice(entry.start, entry.end) !== entry.quote)
            throw new Error("模型给出的引文与原文不一致；请重新核对。");
          return {
            source: {
              bookId: source.bookId,
              fileId: source.fileId,
              path: source.path,
              updatedAt: source.updatedAt,
              sha256: source.sha256
            },
            start: entry.start,
            end: entry.end,
            quote: entry.quote,
            explanation: entry.explanation
          };
        })
      : [];
    return {
      id: typeof check.id === "string" ? check.id : `requirement-${index + 1}`,
      requirement: String(check.requirement ?? ""),
      kind: check.kind,
      status: check.status,
      evidence,
      ...(typeof check.note === "string" ? { note: check.note } : {})
    };
  });
  const parsed = NovelRequirementReviewSchema.safeParse({
    bookId,
    chapterCardId,
    checkedAt: new Date().toISOString(),
    sources: sources.map(
      ({
        content: _content,
        role: _role,
        outlineState: _outlineState,
        outlineVersion: _outlineVersion,
        ...source
      }) => source
    ),
    checks
  });
  if (!parsed.success)
    throw new Error("模型返回的核对结构无效；请调整要求后重试。");
  return parsed.data;
}

export function makeNovelCandidateSet(
  bookId: string,
  chapterCardId: string,
  prompt: string,
  sources: NovelChapterSource[],
  tasks: WorkbenchTask[],
  modelLabels: ReadonlyMap<string, string>,
  outlineSelection?: NovelPlotCandidateSet["outlineSelection"]
): NovelPlotCandidateSet {
  const parsed = NovelPlotCandidateSetSchema.safeParse({
    bookId,
    chapterCardId,
    prompt,
    sources: sources.map(
      ({
        content: _content,
        role: _role,
        outlineState: _outlineState,
        outlineVersion: _outlineVersion,
        ...source
      }) => source
    ),
    ...(outlineSelection ? { outlineSelection } : {}),
    candidates: tasks.map((task) => ({
      id: task.id.slice(0, 120),
      ...(task.id.length <= 160 ? { sourceRunId: task.id } : {}),
      model: task.actualModel || modelLabels.get(task.modelId) || task.modelId,
      body: task.content.trim(),
      createdAt: task.updatedAt
    }))
  });
  if (!parsed.success) throw new Error("模型没有返回可用的候选内容。");
  return parsed.data;
}

function parseObject(text: string): Record<string, unknown> {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "");
  const value: unknown = JSON.parse(stripped);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("模型没有返回可读取的结构化结果，请重试或调整要求。");
  return value as Record<string, unknown>;
}
