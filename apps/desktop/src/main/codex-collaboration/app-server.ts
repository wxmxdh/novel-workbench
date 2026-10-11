import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodexInterruptInputSchema,
  CodexEventSchema,
  CodexModelSchema,
  CodexResumeSessionInputSchema,
  CodexStartSessionInputSchema,
  CodexSessionSchema,
  CodexTurnInputSchema,
  type CodexCollaborationApi,
  type CodexEvent,
  type CodexModel,
  type CodexSession
} from "@deepwrite/contracts";

type Json = Record<string, unknown>;
type Child = Pick<
  ChildProcessWithoutNullStreams,
  "stdin" | "stdout" | "stderr" | "kill" | "once"
>;
type Launch = (binary: string) => Child;
type Pending = { resolve(value: unknown): void; reject(error: Error): void };
type SessionState = {
  session: CodexSession;
  turnId: string | undefined;
  turnStart: Promise<void> | undefined;
  turnCompleted: boolean;
  closing: boolean;
  cwd: string;
};

async function resolveCodexExecutable(): Promise<string> {
  const configured = process.env.DEEPWRITE_CODEX_EXECUTABLE?.trim();
  if (configured) {
    if (process.platform !== "win32" || /\.exe$/iu.test(configured))
      return configured;
    throw new Error(
      "DEEPWRITE_CODEX_EXECUTABLE 必须指向 codex.exe；请勿配置 .cmd/.bat 包装器。"
    );
  }
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const candidates = execFileSync(command, ["codex"], { encoding: "utf8" })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const found =
      process.platform === "win32"
        ? candidates.find((line) => /\.exe$/iu.test(line))
        : candidates[0];
    if (found) return found;
  } catch {
    // Desktop launches may not inherit the shell PATH; try the installed app binary.
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const root = join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const candidates = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const executable = join(root, entry.name, "codex.exe");
            try {
              return { executable, modified: (await stat(executable)).mtimeMs };
            } catch {
              return undefined;
            }
          })
      );
      const newest = candidates
        .filter(
          (item): item is { executable: string; modified: number } => !!item
        )
        .sort((a, b) => b.modified - a.modified)[0];
      if (newest) return newest.executable;
    } catch {
      // Return the actionable missing-executable error below.
    }
  }
  return "";
}

function defaultLaunch(binary: string): Child {
  const child = spawn(binary, ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, CODEX_TUI: "0" }
  });
  return child as Child;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Codex 请求失败。";
  if (
    /api[_ -]?key|token|secret|credential|authorization|bearer/i.test(message)
  ) {
    return "Codex 请求失败。请在 Codex 应用中检查登录状态。";
  }
  return message.slice(0, 300);
}

export class CodexAppServer implements CodexCollaborationApi {
  private child: Child | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly ownedThreads = new Map<string, string>();
  private readonly deferredDirectories = new Set<string>();
  private readonly listeners = new Set<(event: CodexEvent) => void>();
  private buffer = "";
  private nextId = 0;
  private ready: Promise<void> | undefined;
  private readonly launch: Launch;
  private readonly executable: () => string | Promise<string>;

  constructor(
    options: {
      launch?: Launch;
      executable?: () => string | Promise<string>;
    } = {}
  ) {
    this.launch = options.launch ?? defaultLaunch;
    this.executable = options.executable ?? resolveCodexExecutable;
  }

  onEvent(listener: (event: CodexEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listModels(): Promise<CodexModel[]> {
    await this.ensureReady();
    const result = (await this.request("model/list", {
      limit: 200,
      includeHidden: false
    })) as { data?: unknown[] };
    return (result.data ?? []).map((model) => {
      const raw = model as Json;
      return CodexModelSchema.parse({
        id: raw.id,
        model: raw.model,
        displayName: raw.displayName,
        description: raw.description,
        isDefault: raw.isDefault,
        defaultReasoningEffort: raw.defaultReasoningEffort,
        supportedReasoningEfforts: raw.supportedReasoningEfforts
      });
    });
  }

  async startSession(
    raw: Parameters<CodexCollaborationApi["startSession"]>[0]
  ): Promise<CodexSession> {
    const input = CodexStartSessionInputSchema.parse(raw);
    await this.ensureReady();
    if (this.sessions.has(input.sessionId))
      throw new Error("任务会话编号已存在。");
    const cwd = await mkdtemp(join(tmpdir(), "deepwrite-codex-"));
    try {
      const response = (await this.request("thread/start", {
        model: input.model,
        allowProviderModelFallback: false,
        cwd,
        sandbox: "read-only",
        approvalPolicy: "on-request",
        runtimeWorkspaceRoots: [cwd],
        ephemeral: false,
        experimentalRawEvents: false
      })) as { thread?: { id?: string }; model?: unknown };
      if (!response.thread?.id) throw new Error("Codex 没有返回线程编号。");
      if (typeof response.model !== "string" || !response.model.trim())
        throw new Error("Codex 没有返回实际使用的模型标识。");
      if (response.model !== input.model)
        throw new Error(
          "Codex 返回的实际模型与指定模型不一致，已拒绝创建任务。"
        );
      const session = CodexSessionSchema.parse({
        sessionId: input.sessionId,
        threadId: response.thread.id,
        model: response.model,
        reasoningEffort: input.reasoningEffort,
        scopeKey: input.scopeKey,
        createdAt: new Date().toISOString()
      });
      this.ownedThreads.set(session.threadId, session.scopeKey);
      this.sessions.set(input.sessionId, {
        session,
        cwd,
        turnId: undefined,
        turnStart: undefined,
        turnCompleted: false,
        closing: false
      });
      return session;
    } catch (error) {
      await rm(cwd, { recursive: true, force: true });
      throw error;
    }
  }

  async resumeSession(
    raw: Parameters<CodexCollaborationApi["resumeSession"]>[0]
  ): Promise<CodexSession> {
    const input = CodexResumeSessionInputSchema.parse(raw);
    await this.ensureReady();
    if (this.ownedThreads.get(input.threadId) !== input.scopeKey) {
      throw new Error(
        "只能恢复当前作品或资料范围内、本工作台创建的 Codex 任务。"
      );
    }
    if (this.sessions.has(input.sessionId))
      throw new Error("任务会话编号已存在。");
    const cwd = await mkdtemp(join(tmpdir(), "deepwrite-codex-"));
    try {
      const response = (await this.request("thread/resume", {
        threadId: input.threadId,
        model: input.model,
        cwd,
        sandbox: "read-only",
        approvalPolicy: "on-request",
        runtimeWorkspaceRoots: [cwd]
      })) as { thread?: { id?: string }; model?: unknown };
      if (response.thread?.id !== input.threadId)
        throw new Error("Codex 恢复的线程与请求不一致。");
      if (typeof response.model !== "string" || !response.model.trim())
        throw new Error("Codex 没有返回恢复任务的实际模型标识。");
      if (response.model !== input.model)
        throw new Error(
          "Codex 恢复任务的实际模型与指定模型不一致，已拒绝恢复。"
        );
      const session = CodexSessionSchema.parse({
        sessionId: input.sessionId,
        threadId: input.threadId,
        model: response.model,
        reasoningEffort: input.reasoningEffort,
        scopeKey: input.scopeKey,
        createdAt: new Date().toISOString()
      });
      this.sessions.set(input.sessionId, {
        session,
        cwd,
        turnId: undefined,
        turnStart: undefined,
        turnCompleted: false,
        closing: false
      });
      return session;
    } catch (error) {
      await rm(cwd, { recursive: true, force: true });
      throw error;
    }
  }

  async startTurn(
    raw: Parameters<CodexCollaborationApi["startTurn"]>[0]
  ): Promise<void> {
    const input = CodexTurnInputSchema.parse(raw);
    const state = this.requireSession(input.sessionId);
    if (state.closing || state.turnId || state.turnStart)
      throw new Error("Codex 会话已有正在运行的任务。");
    state.turnCompleted = false;
    const start = (async () => {
      await this.ensureReady();
      this.emit({
        type: "status",
        sessionId: input.sessionId,
        status: "started"
      });
      return this.request("turn/start", {
        threadId: state.session.threadId,
        input: [{ type: "text", text: input.text }],
        model: state.session.model,
        cwd: state.cwd,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        approvalPolicy: "on-request",
        ...(state.session.reasoningEffort
          ? { effort: state.session.reasoningEffort }
          : {})
      });
    })()
      .then((rawResult) => {
        const result = rawResult as { turn?: { id?: string } };
        if (!state.turnCompleted && !state.turnId && result.turn?.id)
          state.turnId = result.turn.id;
      })
      .finally(() => {
        if (state.turnStart === start) state.turnStart = undefined;
      });
    state.turnStart = start;
    try {
      await start;
    } catch (error) {
      this.emit({
        type: "status",
        sessionId: input.sessionId,
        status: "failed"
      });
      throw error;
    }
  }

  async interrupt(
    raw: Parameters<CodexCollaborationApi["interrupt"]>[0]
  ): Promise<void> {
    const input = CodexInterruptInputSchema.parse(raw);
    const state = this.requireSession(input.sessionId);
    if (state.turnStart) {
      try {
        await state.turnStart;
      } catch {
        return;
      }
    }
    if (!state.turnId) return;
    await this.request("turn/interrupt", {
      threadId: state.session.threadId,
      turnId: state.turnId
    });
  }

  async closeSession(
    raw: Parameters<CodexCollaborationApi["closeSession"]>[0]
  ): Promise<void> {
    const input = CodexInterruptInputSchema.parse(raw);
    const state = this.sessions.get(input.sessionId);
    if (!state) return;
    state.closing = true;
    if (state.turnStart) {
      try {
        await state.turnStart;
      } catch {
        /* A rejected start has no active turn to interrupt. */
      }
    }
    if (state.turnId) await this.interrupt(input);
    this.sessions.delete(input.sessionId);
    try {
      await rm(state.cwd, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
      // The app-server may retain a thread's cwd until its process exits.
      this.deferredDirectories.add(state.cwd);
    }
  }

  async dispose(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    if (child) {
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve())
      );
      child.kill();
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000))
      ]);
    }
    const directories = new Set([
      ...[...this.sessions.values()].map((state) => state.cwd),
      ...this.deferredDirectories
    ]);
    await Promise.all(
      [...directories].map((directory) =>
        rm(directory, { recursive: true, force: true }).catch(() => undefined)
      )
    );
    this.sessions.clear();
    this.ownedThreads.clear();
    this.deferredDirectories.clear();
    for (const pending of this.pending.values())
      pending.reject(new Error("Codex 连接已关闭。"));
    this.pending.clear();
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const binary = await this.executable();
      if (!binary)
        throw new Error("未找到 Codex CLI；请确认 codex 已加入 PATH。");
      const child = this.launch(binary);
      this.child = child;
      child.stdout.on("data", (chunk: Buffer) =>
        this.accept(chunk.toString("utf8"))
      );
      child.stderr.on("data", () => undefined);
      child.once("error", (error: Error) => this.failAll(error));
      child.once("exit", (code: number | null) => {
        if (this.child === child) {
          this.child = undefined;
          this.ready = undefined;
        }
        this.failAll(
          new Error(`Codex app-server 已退出 (${code ?? "unknown"})。`)
        );
        for (const id of this.sessions.keys())
          this.emit({
            type: "error",
            sessionId: id,
            message: "Codex 连接已断开。"
          });
      });
      await this.request("initialize", {
        clientInfo: {
          name: "deepwrite-novel-workbench",
          title: "DeepWrite Novel Workbench",
          version: "1.0.0"
        },
        capabilities: { experimentalApi: true }
      });
      this.notify("initialized", {});
    })();
    try {
      await this.ready;
    } catch (error) {
      this.child?.kill();
      this.child = undefined;
      this.ready = undefined;
      throw new Error(safeErrorMessage(error));
    }
  }

  private request(method: string, params: Json): Promise<unknown> {
    if (!this.child)
      return Promise.reject(new Error("Codex app-server 未启动。"));
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child?.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error?: Error | null) => {
          if (!error) return;
          this.pending.delete(id);
          reject(error);
        }
      );
    });
  }

  private notify(method: string, params: Json): void {
    this.child?.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`
    );
  }

  private accept(chunk: string): void {
    this.buffer += chunk;
    while (this.buffer.includes("\n")) {
      const at = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      try {
        this.acceptMessage(JSON.parse(line) as Json);
      } catch {
        /* Ignore malformed protocol output; stderr remains private. */
      }
    }
  }

  private acceptMessage(message: Json): void {
    if (
      message.id !== undefined &&
      ("result" in message || "error" in message)
    ) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error)
        pending.reject(
          new Error(
            safeErrorMessage(
              new Error(
                String((message.error as Json).message ?? "Codex 请求失败。")
              )
            )
          )
        );
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      const method = String(message.method);
      const threadId = String(
        (message.params as Json | undefined)?.threadId ?? ""
      );
      const affected = [...this.sessions.entries()].filter(
        ([, state]) => state.session.threadId === threadId
      );
      for (const [sessionId] of affected)
        this.emit({
          type: "approval-blocked",
          sessionId,
          method,
          message:
            "Codex 请求了额外权限。为保护小说文件，本次连接不会批准该请求。"
        });
      this.child?.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "DeepWrite Codex bridge does not grant filesystem or tool permissions." } })}\n`
      );
      return;
    }
    const method = String(message.method ?? "");
    const params = (message.params ?? {}) as Json;
    const threadId = String(params.threadId ?? "");
    const owner = [...this.sessions.entries()].find(
      ([, state]) => state.session.threadId === threadId
    );
    if (!owner) return;
    const [sessionId, state] = owner;
    if (method === "turn/started") {
      state.turnId = String((params.turn as Json | undefined)?.id ?? "");
      state.turnCompleted = false;
    }
    if (method === "item/agentMessage/delta") {
      const delta = String(params.delta ?? "");
      if (delta) this.emit({ type: "text", sessionId, text: delta });
    }
    if (method === "turn/completed") {
      const status = String(
        (params.turn as Json | undefined)?.status ?? "completed"
      );
      state.turnId = undefined;
      state.turnCompleted = true;
      this.emit({
        type: "status",
        sessionId,
        status:
          status === "interrupted"
            ? "interrupted"
            : status === "failed"
              ? "failed"
              : "completed"
      });
    }
  }

  private requireSession(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error("找不到这个 Codex 任务会话。");
    return state;
  }
  private emit(event: CodexEvent): void {
    const parsed = CodexEventSchema.safeParse(event);
    if (parsed.success)
      for (const listener of this.listeners) listener(parsed.data);
  }
  private failAll(error: Error): void {
    const safe = new Error(safeErrorMessage(error));
    for (const item of this.pending.values()) item.reject(safe);
    this.pending.clear();
  }
}
