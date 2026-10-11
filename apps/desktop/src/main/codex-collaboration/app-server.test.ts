import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createEnvelope } from "@deepwrite/contracts";
import { CodexAppServer } from "./app-server";
import { handleCodexCollaborationCommand } from "./commands";

class FakeCodexChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  requests: Array<Record<string, unknown>> = [];

  constructor(
    private readonly options: {
      notifyTurnLifecycle?: boolean;
      threadModel?: string;
    } = {}
  ) {
    super();
    let buffer = "";
    this.stdin.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const boundary = buffer.indexOf("\n");
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        const request = JSON.parse(line) as Record<string, unknown>;
        this.requests.push(request);
        if (request.id === undefined) continue;
        const params = request.params as Record<string, unknown>;
        let result: unknown = {};
        if (request.method === "model/list") {
          result = {
            data: [
              {
                id: "catalog-model",
                model: "codex-real-model",
                displayName: "Real Model",
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium", description: "Balanced" }
                ]
              }
            ]
          };
        }
        if (
          request.method === "thread/start" ||
          request.method === "thread/resume"
        ) {
          result = {
            model: this.options.threadModel ?? String(params.model),
            thread: {
              id:
                request.method === "thread/start"
                  ? "thread-created"
                  : params.threadId
            }
          };
        }
        if (request.method === "turn/start")
          result = { turn: { id: "turn-response-only" } };
        this.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`
        );
        if (
          request.method === "turn/start" &&
          this.options.notifyTurnLifecycle !== false
        ) {
          const threadId = params.threadId;
          for (const notification of [
            {
              method: "turn/started",
              params: { threadId, turn: { id: "turn-1" } }
            },
            {
              method: "item/agentMessage/delta",
              params: { threadId, delta: "这是一段讨论结果。" }
            },
            {
              method: "turn/completed",
              params: { threadId, turn: { status: "completed" } }
            }
          ])
            this.stdout.write(
              `${JSON.stringify({ jsonrpc: "2.0", ...notification })}\n`
            );
        }
      }
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0);
    return true;
  }
}

describe("CodexAppServer", () => {
  const services: CodexAppServer[] = [];
  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.dispose()));
  });

  it("lists actual models and keeps a selected model in an isolated read-only session", async () => {
    const child = new FakeCodexChild();
    const service = new CodexAppServer({
      executable: () => "codex-test",
      launch: () => child as never
    });
    services.push(service);
    const models = await service.listModels();
    expect(models[0]?.model).toBe("codex-real-model");
    const session = await service.startSession({
      sessionId: "task-1",
      model: models[0]!.model,
      reasoningEffort: "medium",
      scopeKey: "book-a:source-a"
    });
    const start = child.requests.find(
      (request) => request.method === "thread/start"
    );
    const params = start?.params as Record<string, unknown>;
    expect(params.model).toBe("codex-real-model");
    expect(params.allowProviderModelFallback).toBe(false);
    expect(params.sandbox).toBe("read-only");
    expect(params.approvalPolicy).toBe("on-request");
    expect(params.cwd).toContain("deepwrite-codex-");
    expect(params.cwd).not.toContain("deepwrite-novel");
    expect(session.threadId).toBe("thread-created");
  });

  it("rejects a thread when the app-server reports a different actual model", async () => {
    const child = new FakeCodexChild({ threadModel: "unexpected-model" });
    const service = new CodexAppServer({
      executable: () => "codex-test",
      launch: () => child as never
    });
    services.push(service);
    await expect(
      service.startSession({
        sessionId: "task-wrong-model",
        model: "requested-model",
        scopeKey: "book-a"
      })
    ).rejects.toThrow("实际模型与指定模型不一致");
    expect(
      child.requests.some((request) => request.method === "thread/start")
    ).toBe(true);
  });

  it("streams discussion text, tracks turns for interruption and reports completion", async () => {
    const child = new FakeCodexChild();
    const service = new CodexAppServer({
      executable: () => "codex-test",
      launch: () => child as never
    });
    services.push(service);
    const session = await service.startSession({
      sessionId: "task-2",
      model: "selected-model",
      reasoningEffort: "high",
      scopeKey: "book-a"
    });
    const events: unknown[] = [];
    service.onEvent((event) => events.push(event));
    await service.startTurn({
      sessionId: session.sessionId,
      text: "只讨论，不修改文件。"
    });
    expect(
      child.requests.find((request) => request.method === "turn/start")?.params
    ).toMatchObject({ model: "selected-model", effort: "high" });
    expect(events).toContainEqual({
      type: "text",
      sessionId: "task-2",
      text: "这是一段讨论结果。"
    });
    expect(events).toContainEqual({
      type: "status",
      sessionId: "task-2",
      status: "completed"
    });
  });

  it("interrupts a turn identified by the start response even without lifecycle notifications", async () => {
    const child = new FakeCodexChild({ notifyTurnLifecycle: false });
    const service = new CodexAppServer({
      executable: () => "codex-test",
      launch: () => child as never
    });
    services.push(service);
    const session = await service.startSession({
      sessionId: "task-response-turn-id",
      model: "selected-model",
      scopeKey: "book-a"
    });
    await service.startTurn({ sessionId: session.sessionId, text: "开始讨论" });
    await service.closeSession({ sessionId: session.sessionId });
    expect(child.requests).toContainEqual(
      expect.objectContaining({
        method: "turn/interrupt",
        params: { threadId: session.threadId, turnId: "turn-response-only" }
      })
    );
  });

  it("rejects server permission requests instead of silently accepting them", async () => {
    const child = new FakeCodexChild();
    const service = new CodexAppServer({
      executable: () => "codex-test",
      launch: () => child as never
    });
    services.push(service);
    await service.startSession({
      sessionId: "task-3",
      model: "selected-model",
      scopeKey: "book-a"
    });
    const events: unknown[] = [];
    service.onEvent((event) => events.push(event));
    child.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-created" } })}\n`
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "approval-blocked", sessionId: "task-3" })
    );
    expect(child.requests.at(-1)).toMatchObject({
      id: "approval-1",
      error: { code: -32000 }
    });
  });

  it("does not resume a thread under a different work or source scope", async () => {
    const child = new FakeCodexChild();
    const service = new CodexAppServer({
      executable: () => "codex-test",
      launch: () => child as never
    });
    services.push(service);
    const session = await service.startSession({
      sessionId: "task-4",
      model: "selected-model",
      scopeKey: "book-a:source-a"
    });
    await expect(
      service.resumeSession({
        sessionId: "task-5",
        threadId: session.threadId,
        model: session.model,
        scopeKey: "book-b:source-a"
      })
    ).rejects.toThrow("当前作品或资料范围内");
  });

  it("routes only the narrow Codex envelope commands", async () => {
    const child = new FakeCodexChild();
    const service = new CodexAppServer({
      executable: () => "codex-test",
      launch: () => child as never
    });
    services.push(service);
    const result = await handleCodexCollaborationCommand(
      createEnvelope("codex.listModels", {}, { id: "cmd-1" }),
      service
    );
    expect(result).toMatchObject({ status: "accepted", requestId: "cmd-1" });
    await expect(
      handleCodexCollaborationCommand(
        createEnvelope("unrelated.command", {}, { id: "cmd-2" }) as never,
        service
      )
    ).resolves.toBeUndefined();
  });

  it("removes the temporary task directory when a session closes", async () => {
    const child = new FakeCodexChild();
    const service = new CodexAppServer({
      executable: () => "codex-test",
      launch: () => child as never
    });
    services.push(service);
    const session = await service.startSession({
      sessionId: "task-close",
      model: "selected-model",
      scopeKey: "book-a"
    });
    const params = child.requests.find(
      (request) => request.method === "thread/start"
    )?.params as Record<string, unknown>;
    const cwd = String(params.cwd);
    expect(existsSync(cwd)).toBe(true);
    await service.closeSession({ sessionId: session.sessionId });
    expect(existsSync(cwd)).toBe(false);
  });
});
