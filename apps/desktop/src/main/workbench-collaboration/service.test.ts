import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  createLongWorkspaceNavigationSnapshot,
  type CommandEnvelope,
  type CommandResult,
  type LongWorkspaceRuntimeContext,
  type SystemEventEnvelope,
  type WorkbenchPrepared
} from "@deepwrite/contracts";
import { fixtureWorldbuildingIndex } from "../../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import { hashText, verifyPrepared } from "./context";
import {
  WorkbenchCollaborationService,
  type WorkbenchServicePorts
} from "./service";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup() {
  const index = fixtureWorldbuildingIndex();
  const text = "已核验的书脊资料。";
  const agentsMd = "只读规则";
  const prepared: WorkbenchPrepared = {
    id: "prepared_test",
    bookId: index.bookId,
    title: "审计测试作品",
    indexUpdatedAt: index.updatedAt,
    sources: [
      {
        fileId: index.bookLine.id,
        title: "书脊",
        path: index.bookLine.path,
        sha256: hashText(text),
        content: text
      }
    ],
    agentsMd,
    createdAt: new Date().toISOString()
  };
  const runtime: LongWorkspaceRuntimeContext = {
    bookId: index.bookId,
    title: "审计测试作品",
    activeRoot: "sources",
    activeAgentId: "long",
    interactionMode: "discussion",
    readOnly: true,
    navigation: createLongWorkspaceNavigationSnapshot(index),
    agentsMd
  };
  const promptReplies: ReturnType<
    typeof deferred<CommandResult | undefined>
  >[] = [];
  const aborts: CommandEnvelope[] = [];
  const ports: WorkbenchServicePorts = {
    core: vi.fn(async (command: CommandEnvelope): Promise<CommandResult> => {
      let payload: unknown;
      if (command.type === "long.getWorkspaceIndex")
        payload = { bookId: index.bookId, workspaceIndex: index };
      else if (command.type === "long.readAgentsMd")
        payload = { bookId: index.bookId, content: agentsMd, truncated: false };
      else if (command.type === "long.readDocument")
        payload = {
          bookId: index.bookId,
          file: index.bookLine,
          content: text,
          offset: 0,
          totalCharacters: [...text].length,
          nextOffset: null
        };
      else throw new Error(`Unexpected core command ${command.type}`);
      return { status: "accepted", requestId: command.id, payload };
    }),
    session: vi.fn((command: CommandEnvelope) => {
      if (command.type === "session.prompt") {
        const reply = deferred<CommandResult | undefined>();
        promptReplies.push(reply);
        return reply.promise;
      }
      if (command.type === "session.abort") {
        aborts.push(command);
        return Promise.resolve({
          status: "accepted",
          requestId: command.id,
          payload: {
            ...command.payload,
            abortedAt: new Date().toISOString()
          }
        } as CommandResult);
      }
      throw new Error(`Unexpected session command ${command.type}`);
    }),
    capabilities: async () => ({ books: [], models: [] }),
    resolveModel: async (id) =>
      id === "model_exact" ? { model: "provider/model-exact" } : undefined
  };
  const directory = await mkdtemp(
    join(tmpdir(), "workbench-collaboration-test-")
  );
  directories.push(directory);
  const service = new WorkbenchCollaborationService(directory, ports);
  await service.initialize();
  (
    service as unknown as {
      prepared: Map<
        string,
        { prepared: WorkbenchPrepared; runtime: LongWorkspaceRuntimeContext }
      >;
    }
  ).prepared.set(prepared.id, { prepared, runtime });
  return { service, ports, index, prepared, promptReplies, aborts, directory };
}

const start = (n: number) => ({
  operation: "start" as const,
  preparedId: "prepared_test",
  requestKey: `request_${n}`,
  modelId: "model_exact",
  prompt: `任务 ${n}`,
  purpose: "brainstorm" as const
});
const acceptedPrompt = (
  command: CommandEnvelope
): Extract<CommandResult, { status: "accepted" }> => {
  const prompt = command as Extract<
    CommandEnvelope,
    { type: "session.prompt" }
  >;
  return {
    status: "accepted",
    requestId: command.id,
    payload: {
      sessionId: prompt.payload.sessionId,
      runId: `run_${command.id}`,
      acceptedAt: new Date().toISOString(),
      runtime: {
        provider: "test",
        model: "provider/model-exact",
        configId: "model_exact",
        mode: "provider"
      }
    }
  };
};

describe("Workbench collaboration service", () => {
  it("marks journaled running tasks interrupted after restart without retrying a model", async () => {
    const { service, ports, promptReplies, directory } = await setup();
    const pending = service.request(start(1));
    await vi.waitFor(() => expect(promptReplies).toHaveLength(1));
    promptReplies[0]!.resolve(
      acceptedPrompt(
        (ports.session as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      )
    );
    await pending;
    await service.dispose();
    const restarted = new WorkbenchCollaborationService(directory, ports);
    await restarted.initialize();
    expect([...restarted.tasks.values()]).toHaveLength(1);
    expect([...restarted.tasks.values()][0]?.status).toBe("interrupted");
    expect(ports.session).toHaveBeenCalledTimes(1);
    await restarted.dispose();
  });
  it("allows three concurrently preparing tasks and refuses a fourth without double-counting reservations", async () => {
    const { service, ports, promptReplies } = await setup();
    const starts = [1, 2, 3].map((n) => service.request(start(n)));
    await vi.waitFor(() => expect(promptReplies).toHaveLength(3));
    await expect(service.request(start(4))).rejects.toThrow(
      "最多同时运行三个模型任务"
    );
    for (let i = 0; i < 3; i++)
      promptReplies[i]!.resolve(
        acceptedPrompt(
          (ports.session as ReturnType<typeof vi.fn>).mock.calls[i]![0]
        )
      );
    const responses = await Promise.all(starts);
    expect(responses).toHaveLength(3);
    expect(
      [...service.tasks.values()].every((task) => task.status === "running")
    ).toBe(true);
    await service.dispose();
  });

  it("defers cancellation on a wrong-model event until prompt acceptance supplies a run id", async () => {
    const { service, ports, promptReplies, aborts } = await setup();
    const pending = service.request(start(1));
    await vi.waitFor(() => expect(promptReplies).toHaveLength(1));
    const promptCommand = (ports.session as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as CommandEnvelope;
    const task = [...service.tasks.values()][0]!;
    service.remember(
      createEnvelope(
        "agent.message_delta",
        {
          sessionId: task.sessionId,
          runId: "run_1",
          messageId: "msg_1",
          delta: "bad model",
          runtime: {
            provider: "other",
            model: "other/model",
            configId: "other",
            mode: "provider"
          }
        },
        { id: "evt_1", context: { sessionId: task.sessionId, runId: "run_1" } }
      ) as SystemEventEnvelope
    );
    expect(task.status).toBe("running");
    promptReplies[0]!.resolve(acceptedPrompt(promptCommand));
    const response = await pending;
    expect(response).toMatchObject({
      kind: "task",
      task: { status: "cancelled" }
    });
    expect(aborts).toHaveLength(1);
    expect(response).toMatchObject({
      kind: "task",
      task: { status: "cancelled", error: "收到非指定模型的结果，已中断。" }
    });
    await service.dispose();
  });

  it("preserves a completed result when cancellation races with completion", async () => {
    const { service, ports, promptReplies } = await setup();
    const pending = service.request(start(1));
    await vi.waitFor(() => expect(promptReplies).toHaveLength(1));
    const promptCommand = (ports.session as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as CommandEnvelope;
    promptReplies[0]!.resolve(acceptedPrompt(promptCommand));
    await pending;
    const task = [...service.tasks.values()][0]!;
    const abortReply = deferred<CommandResult | undefined>();
    const originalSession = ports.session;
    ports.session = vi.fn((command: CommandEnvelope) =>
      command.type === "session.abort"
        ? abortReply.promise
        : originalSession(command)
    );
    const cancellation = service.request({
      operation: "cancel",
      taskId: task.id,
      bookId: task.bookId
    });
    await vi.waitFor(() =>
      expect(ports.session).toHaveBeenCalledWith(
        expect.objectContaining({ type: "session.abort" })
      )
    );
    service.remember(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId: task.sessionId,
          runId: task.runId!,
          messageId: "message-race",
          content: "已完成的候选",
          runtime: {
            provider: "test",
            model: "provider/model-exact",
            configId: "model_exact",
            mode: "provider"
          }
        },
        {
          id: "event-race",
          context: { sessionId: task.sessionId, runId: task.runId! }
        }
      ) as SystemEventEnvelope
    );
    abortReply.resolve({
      status: "accepted",
      requestId: "abort-race",
      payload: {}
    } as CommandResult);
    const response = await cancellation;
    expect(response).toMatchObject({
      kind: "task",
      task: { status: "completed", content: "已完成的候选" }
    });
    await service.dispose();
  });

  it("does not keep an early completion as a candidate if acceptance reports another model", async () => {
    const { service, ports, promptReplies } = await setup();
    const pending = service.request(start(1));
    await vi.waitFor(() => expect(promptReplies).toHaveLength(1));
    const promptCommand = (ports.session as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as CommandEnvelope;
    const task = [...service.tasks.values()][0]!;
    service.remember(
      createEnvelope(
        "agent.message_completed",
        {
          sessionId: task.sessionId,
          runId: "run-before-ack",
          messageId: "message-before-ack",
          content: "不得保存的模型结果"
        },
        {
          id: "event-before-ack",
          context: { sessionId: task.sessionId, runId: "run-before-ack" }
        }
      ) as SystemEventEnvelope
    );
    const accepted = acceptedPrompt(promptCommand);
    (accepted.payload as { runtime: { configId: string } }).runtime.configId =
      "different-model-config";
    promptReplies[0]!.resolve(accepted);
    const response = await pending;
    expect(response).toMatchObject({
      kind: "task",
      task: {
        status: "failed",
        content: "",
        error: "实际模型与指定配置不一致，结果不可作为候选。"
      }
    });
    await service.dispose();
  });

  it("rejects a prepared snapshot if the workspace revision changes during verification", async () => {
    const { service, ports, prepared, index } = await setup();
    let indexRead = 0;
    ports.core = vi.fn(
      async (command: CommandEnvelope): Promise<CommandResult> => {
        let payload: unknown;
        if (command.type === "long.getWorkspaceIndex") {
          indexRead++;
          payload = {
            bookId: index.bookId,
            workspaceIndex:
              indexRead === 1
                ? index
                : {
                    ...index,
                    updatedAt: new Date(
                      Date.parse(index.updatedAt) + 1
                    ).toISOString()
                  }
          };
        } else if (command.type === "long.readAgentsMd") {
          payload = {
            bookId: index.bookId,
            content: prepared.agentsMd,
            truncated: false
          };
        } else if (command.type === "long.readDocument") {
          payload = {
            bookId: index.bookId,
            file: index.bookLine,
            content: "已核验的书脊资料。",
            offset: 0,
            totalCharacters: [..."已核验的书脊资料。"].length,
            nextOffset: null
          };
        } else throw new Error(`Unexpected core command ${command.type}`);
        return { status: "accepted", requestId: command.id, payload };
      }
    );
    await expect(verifyPrepared(ports.core, prepared)).rejects.toThrow(
      "核验期间作品资料发生变化"
    );
    await service.dispose();
  });
});
