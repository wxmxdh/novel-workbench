import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  WorkbenchRequestSchema,
  WorkbenchResponseSchema,
  SessionPromptAcceptedPayloadSchema,
  WorkbenchTaskSchema,
  LongImportSourceResultSchema,
  LongWorkspaceIndexResultSchema,
  type CommandEnvelope,
  type CommandResult,
  type LongWorkspaceRuntimeContext,
  type SystemEventEnvelope,
  type WorkbenchRequest,
  type WorkbenchTask,
  type WorkbenchPrepared
} from "@deepwrite/contracts";
import {
  corePayload,
  hashText,
  prepareContext,
  verifyPrepared,
  type CoreRequest
} from "./context";

export interface WorkbenchServicePorts {
  core: CoreRequest;
  session(command: CommandEnvelope): Promise<CommandResult | undefined>;
  capabilities(): Promise<{
    books: { id: string; title: string }[];
    models: { id: string; title: string; model: string }[];
  }>;
  resolveModel(id: string): Promise<{ model: string } | undefined>;
}
export class WorkbenchCollaborationService {
  readonly tasks = new Map<string, WorkbenchTask>();
  private readonly prepared = new Map<
    string,
    { prepared: WorkbenchPrepared; runtime: LongWorkspaceRuntimeContext }
  >();
  private readonly reservations = new Map<string, Promise<WorkbenchTask>>();
  private readonly pendingCancels = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly saves = new Map<string, Promise<void>>();
  private readonly cancellations = new Map<string, Promise<void>>();
  private persistence: Promise<void> = Promise.resolve();
  private endpointFile = "";
  constructor(
    private readonly directory: string,
    private readonly ports: WorkbenchServicePorts
  ) {}
  setEndpointFile(path: string) {
    this.endpointFile = path;
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try {
      const prior: unknown = JSON.parse(
        await readFile(join(this.directory, "tasks.json"), "utf8")
      );
      if (Array.isArray(prior))
        for (const item of prior.slice(-100)) {
          const parsed = WorkbenchTaskSchema.safeParse(item);
          if (!parsed.success) continue;
          const task = parsed.data;
          if (task.status === "running") {
            task.status = "interrupted";
            task.error = "应用已重启；未自动重试模型请求。";
          }
          this.tasks.set(task.id, task);
        }
    } catch {
      /* A missing journal does not start or retry a model request. */
    }
    await this.persist();
  }
  private persist() {
    const text = JSON.stringify([...this.tasks.values()].slice(-100));
    this.persistence = this.persistence
      .catch(() => undefined)
      .then(async () => {
        const path = join(this.directory, "tasks.json");
        await writeFile(`${path}.tmp`, text, { encoding: "utf8", mode: 0o600 });
        await rename(`${path}.tmp`, path);
      });
    return this.persistence;
  }
  async request(raw: WorkbenchRequest) {
    const input = WorkbenchRequestSchema.parse(raw);
    if (input.operation === "capabilities")
      return WorkbenchResponseSchema.parse({
        kind: "capabilities",
        ...(await this.ports.capabilities()),
        endpointFile: this.endpointFile,
        maxConcurrent: 3
      });
    if (input.operation === "prepare") {
      const entry = await prepareContext(this.ports.core, input);
      if (this.prepared.size >= 100)
        this.prepared.delete(this.prepared.keys().next().value!);
      this.prepared.set(entry.prepared.id, entry);
      return WorkbenchResponseSchema.parse({
        kind: "prepared",
        prepared: entry.prepared
      });
    }
    if (input.operation === "start") {
      const reservationKey = `${input.preparedId}:${input.requestKey}`;
      const existing = [...this.tasks.values()].find(
        (task) =>
          task.preparedId === input.preparedId &&
          task.requestKey === input.requestKey
      );
      if (existing) {
        if (
          existing.modelId !== input.modelId ||
          existing.prompt !== input.prompt ||
          existing.purpose !== input.purpose
        )
          throw new Error("同一请求编号不能用于不同任务。");
        return WorkbenchResponseSchema.parse({ kind: "task", task: existing });
      }
      if (this.reservations.has(reservationKey)) {
        const task = await this.reservations.get(reservationKey)!;
        if (
          task.modelId !== input.modelId ||
          task.prompt !== input.prompt ||
          task.purpose !== input.purpose
        )
          throw new Error("同一请求编号不能用于不同任务。");
        return WorkbenchResponseSchema.parse({ kind: "task", task });
      }
      const starting = [...this.reservations.keys()].filter(
        (key) =>
          ![...this.tasks.values()].some(
            (task) =>
              `${task.preparedId}:${task.requestKey}` === key &&
              task.status === "running"
          )
      ).length;
      if (
        [...this.tasks.values()].filter(({ status }) => status === "running")
          .length +
          starting >=
        3
      )
        throw new Error("最多同时运行三个模型任务。");
      const pending = this.start(input);
      this.reservations.set(reservationKey, pending);
      try {
        return WorkbenchResponseSchema.parse({
          kind: "task",
          task: await pending
        });
      } finally {
        this.reservations.delete(reservationKey);
      }
    }
    const task = this.tasks.get(input.taskId);
    if (!task || task.bookId !== input.bookId)
      throw new Error("任务不属于当前作品。");
    if (input.operation === "cancel") await this.cancel(task);
    if (input.operation === "saveCandidate") {
      if (!this.saves.has(task.id)) this.saves.set(task.id, this.save(task));
      try {
        await this.saves.get(task.id);
      } finally {
        this.saves.delete(task.id);
      }
    }
    return WorkbenchResponseSchema.parse({ kind: "task", task });
  }
  private async start(
    input: Extract<WorkbenchRequest, { operation: "start" }>
  ) {
    const entry = this.prepared.get(input.preparedId);
    if (!entry) throw new Error("准备记录已失效，请重新读取资料。");
    await verifyPrepared(this.ports.core, entry.prepared);
    const sourceText = entry.prepared.sources
      .map(
        (source) =>
          `资料：${source.title}\n文件标识：${source.fileId}\n路径：${source.path}\nSHA-256：${source.sha256}\n\n${source.content}`
      )
      .join("\n\n---\n\n");
    if (sourceText.length > 200_000)
      throw new Error("本次资料包超过模型附件上限，请减少资料后重试。");
    const config = await this.ports.resolveModel(input.modelId);
    if (!config) throw new Error("指定模型不可用；未替换成其他模型。");
    const now = new Date().toISOString();
    const task: WorkbenchTask = {
      id: randomUUID(),
      bookId: entry.prepared.bookId,
      preparedId: input.preparedId,
      requestKey: input.requestKey,
      modelId: input.modelId,
      actualModel: config.model,
      purpose: input.purpose,
      status: "running",
      prompt: input.prompt,
      content: "",
      createdAt: now,
      updatedAt: now,
      sessionId: `workbench_external_${randomUUID()}`,
      sources: entry.prepared.sources.map(
        ({ content: _content, ...source }) => source
      )
    };
    this.tasks.set(task.id, task);
    await this.persist();
    try {
      const result = await this.ports.session(
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "session.prompt",
            {
              sessionId: task.sessionId,
              modelId: input.modelId,
              message: input.prompt,
              writeApprovalMode: "request-approval",
              agentTeamMode: "normal",
              autoApproveCrossStageOperations: false,
              workspaceContext: { longWorkspace: entry.runtime },
              attachments: [
                {
                  kind: "text",
                  id: entry.prepared.id,
                  name: "本次已核验的作品资料包.md",
                  mediaType: "text/markdown",
                  size: Buffer.byteLength(sourceText),
                  content: sourceText
                }
              ]
            },
            {
              id: task.id,
              correlationId: task.id,
              context: { sessionId: task.sessionId }
            }
          )
        )
      );
      if (!result || result.status === "rejected")
        throw new Error("工作台未接受任务，请查看工作台任务诊断。");
      const accepted = SessionPromptAcceptedPayloadSchema.parse(result.payload);
      task.runId = accepted.runId;
      task.actualModel = accepted.runtime.model;
      if (
        accepted.runtime.configId !== task.modelId ||
        accepted.runtime.mode !== "provider"
      ) {
        this.pendingCancels.set(
          task.id,
          "实际模型与指定配置不一致；已中断任务。"
        );
        if (task.status === "completed") {
          task.status = "failed";
          task.content = "";
          task.error = "实际模型与指定配置不一致，结果不可作为候选。";
        }
      }
      const pendingCancel = this.pendingCancels.get(task.id);
      if (pendingCancel) await this.cancel(task, pendingCancel);
      else if (task.status === "running")
        this.timers.set(
          task.id,
          setTimeout(() => {
            void this.cancel(task, "任务已到五分钟上限。").catch(
              () => undefined
            );
          }, 300_000)
        );
    } catch {
      if (task.status === "running") {
        task.status = "failed";
        task.error = "任务发起失败，请查看工作台任务诊断。";
      }
    }
    task.updatedAt = new Date().toISOString();
    await this.persist();
    return task;
  }
  remember(event: SystemEventEnvelope) {
    if (
      event.type !== "agent.message_completed" &&
      event.type !== "agent.message_delta" &&
      event.type !== "agent.error"
    )
      return;
    const task = [...this.tasks.values()].find(
      (item) =>
        item.sessionId === event.payload.sessionId &&
        (!item.runId || item.runId === event.payload.runId)
    );
    if (!task || task.status !== "running") return;
    const runtime = event.payload.runtime;
    if (
      runtime &&
      (runtime.configId !== task.modelId || runtime.mode !== "provider")
    ) {
      this.pendingCancels.set(task.id, "收到非指定模型的结果，已中断。");
      if (task.runId)
        void this.cancel(task, "收到非指定模型的结果，已中断。").catch(
          () => undefined
        );
      return;
    }
    const pendingCancel = this.pendingCancels.get(task.id);
    if (pendingCancel) {
      if (event.type !== "agent.message_delta") {
        task.status = "cancelled";
        task.error = pendingCancel;
        this.pendingCancels.delete(task.id);
        clearTimeout(this.timers.get(task.id));
        this.timers.delete(task.id);
        task.updatedAt = new Date().toISOString();
        void this.persist().catch(() => undefined);
      }
      return;
    }
    task.runId = event.payload.runId;
    if (runtime) task.actualModel = runtime.model;
    if (event.type === "agent.message_delta") return;
    if (event.type === "agent.message_completed") {
      if (event.payload.content.length > 200_000) {
        task.status = "failed";
        task.error = "模型结果超过本次完整交付上限，请缩小任务后重试。";
      } else {
        task.content = event.payload.content;
        task.status = "completed";
      }
    } else {
      task.status = "failed";
      task.error = "模型任务失败，请查看工作台任务记录。";
    }
    clearTimeout(this.timers.get(task.id));
    this.timers.delete(task.id);
    task.updatedAt = new Date().toISOString();
    void this.persist().catch(() => undefined);
  }
  private async cancel(task: WorkbenchTask, reason = "作者已取消任务。") {
    if (task.status !== "running") return;
    if (!task.runId) {
      this.pendingCancels.set(task.id, reason);
      return;
    }
    const existing = this.cancellations.get(task.id);
    if (existing) return existing;
    const cancellation = this.abortAndMarkCancelled(task, reason);
    this.cancellations.set(task.id, cancellation);
    try {
      await cancellation;
    } finally {
      if (this.cancellations.get(task.id) === cancellation)
        this.cancellations.delete(task.id);
    }
  }
  private async abortAndMarkCancelled(task: WorkbenchTask, reason: string) {
    if (!task.runId) return;
    {
      const result = await this.ports.session(
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "session.abort",
            { sessionId: task.sessionId, runId: task.runId },
            {
              id: randomUUID(),
              context: { sessionId: task.sessionId, runId: task.runId }
            }
          )
        )
      );
      if (!result || result.status === "rejected")
        throw new Error("未确认模型已停止，请重试取消。");
    }
    if (task.status !== "running") return;
    task.status = "cancelled";
    task.error = reason;
    task.updatedAt = new Date().toISOString();
    this.pendingCancels.delete(task.id);
    clearTimeout(this.timers.get(task.id));
    this.timers.delete(task.id);
    await this.persist();
  }
  private async save(task: WorkbenchTask) {
    if (task.savedSource) return;
    if (task.status !== "completed" || !task.content.trim())
      throw new Error("只可保存已完成的候选。");
    const content = `---\nworkbench: novel-collaboration-v1\nstatus: candidate\nmodel: ${JSON.stringify(task.actualModel)}\ntask: ${JSON.stringify(task.id)}\n---\n\n${task.content}\n\n---\n资料来源：\n${task.sources.map((source) => `- ${source.path} (${source.sha256})`).join("\n")}`;
    const sourceName = `协作候选_${task.id}.md`;
    const expectedHash = hashText(content);
    const currentIndex = LongWorkspaceIndexResultSchema.parse(
      await corePayload(this.ports.core, "long.getWorkspaceIndex", {
        bookId: task.bookId
      })
    );
    const prior = currentIndex.workspaceIndex.importedSources.find(
      (source) =>
        source.sourceName === sourceName && source.sourceSha256 === expectedHash
    );
    if (prior) {
      task.savedSource = { fileId: prior.file.id, path: prior.file.path };
      await this.persist();
      return;
    }
    const entry = this.prepared.get(task.preparedId);
    if (!entry) throw new Error("来源记录已失效；请重新准备并核对后保存。");
    await verifyPrepared(this.ports.core, entry.prepared);
    const imported = LongImportSourceResultSchema.parse(
      await corePayload(this.ports.core, "long.importSource", {
        bookId: task.bookId,
        title: "协作候选",
        sourceName,
        content,
        purpose: "discussion",
        authority: "candidate",
        expectedIndexUpdatedAt: entry.prepared.indexUpdatedAt,
        purposeNote: "作者主动保存的协作结果；未选为大纲、正文或正典。"
      })
    );
    task.savedSource = {
      fileId: imported.source.file.id,
      path: imported.source.file.path
    };
    await this.persist();
  }
  async dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.persistence;
  }
  authorize(
    command: CommandEnvelope
  ): { authorized: boolean; code?: string; message?: string } | undefined {
    const sessionId = command.context.sessionId;
    if (!sessionId?.startsWith("workbench_external_")) return undefined;
    const task = [...this.tasks.values()].find(
      (item) => item.sessionId === sessionId && item.status === "running"
    );
    if (!task)
      return {
        authorized: false,
        code: "collaboration.inactive",
        message: "协作任务已结束。"
      };
    if (
      command.type === "long.getWorkspaceIndex" &&
      command.payload.bookId === task.bookId
    )
      return undefined;
    if (
      command.type === "long.readDocument" &&
      command.payload.bookId === task.bookId &&
      task.sources.some((source) => source.fileId === command.payload.fileId)
    )
      return undefined;
    return {
      authorized: false,
      code: "collaboration.read_scope",
      message: "只能读取本次已准备的作品资料。"
    };
  }
}
