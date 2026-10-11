import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type ComparisonDraftWriterContext,
  type UtilityWorkerName
} from "@deepwrite/contracts";
import { createCoreCommandExecutor } from "../utilities/agent-run-input";
import {
  AGENT_CORE_COMMANDS,
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";

const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({ utilityProcess: { fork: mocks.fork } }));
import { UtilitySupervisor } from "./supervisor";

const runId = "run-comparison-bridge";
const sessionId = "session-comparison-bridge";
const promptRequestId = "prompt-comparison-bridge";
const runtime = {
  provider: "fixture-provider",
  model: "gemini-2.5-flash-thinking",
  mode: "provider" as const,
  configId: "fixture-config"
};
const capability: ComparisonDraftWriterContext = {
  authorizationId: "authorization-bridge-01",
  bookId: "longbook_9a146bbe",
  chapter: 1,
  chapterCardId: "chapter_d9489ee2",
  authorRequest: {
    requestId: "author-request-bridge",
    exactText: "按第一章已确认章卡同时调用写作团队创作。",
    authorizationQuote: "同时调用写作团队创作",
    receivedAt: "2026-10-04T00:00:00.000Z"
  },
  writers: [{ definitionId: "love-writer-fixture", runtime }]
};

class Worker extends EventEmitter {
  readonly pid = 12345;
  readonly commands: CommandEnvelope[] = [];
  readonly pending = new Map<string, (result: CommandResult) => void>();
  postMessage(raw: unknown): void {
    const message = raw as {
      kind: string;
      requestId: string;
      command: CommandEnvelope;
      result: CommandResult;
    };
    if (message.kind === "utility.internal.command.result") {
      this.pending.get(message.requestId)?.(message.result);
      this.pending.delete(message.requestId);
    } else if (message.kind === "utility.command.request") {
      this.commands.push(message.command);
      queueMicrotask(() =>
        this.emit("message", {
          kind: "utility.command.result",
          worker: "core",
          requestId: message.requestId,
          result: {
            status: "accepted",
            requestId: message.command.id,
            payload: { reachedCore: message.command.type }
          }
        })
      );
    } else if (message.kind === "utility.shutdown") {
      queueMicrotask(() => this.emit("exit", 0));
    }
  }
  kill(): boolean {
    this.emit("exit", 0);
    return true;
  }
}

function command(
  type: "long.prepareComparisonDraft" | "long.deliverComparisonDraft"
) {
  const payload =
    type === "long.prepareComparisonDraft"
      ? {
          bookId: capability.bookId,
          authorizationId: capability.authorizationId,
          chapter: capability.chapter,
          chapterCardId: capability.chapterCardId,
          authorRequestId: capability.authorRequest.requestId,
          authorRequest: capability.authorRequest,
          chapterCardSha256: "a".repeat(64),
          volumeId: "volume_3e9287d3",
          volumeSha256: "b".repeat(64)
        }
      : {
          bookId: capability.bookId,
          authorizationId: capability.authorizationId,
          preparationId: "preparation-bridge-01",
          definitionId: capability.writers[0]!.definitionId,
          runtime,
          content: "隔离测试交付文本"
        };
  const result = CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, {
      id: `command-${type}`,
      context: { runId, sessionId, resourceId: capability.bookId }
    })
  );
  if (
    result.type !== "long.prepareComparisonDraft" &&
    result.type !== "long.deliverComparisonDraft"
  )
    throw new Error("Unexpected comparison fixture command");
  return result;
}

describe("comparison drafting through Agent executor and production Main bridge", () => {
  const workers = new Map<UtilityWorkerName, Worker>();
  const activeRuns = new Map<string, MainInternalCommandActiveRun>();
  let supervisor: UtilitySupervisor;
  beforeEach(() => {
    workers.clear();
    activeRuns.clear();
    mocks.fork.mockImplementation(
      (_path: string, _args: string[], options: { serviceName: string }) => {
        const worker = new Worker();
        workers.set(
          options.serviceName.replace("deepwrite-", "") as UtilityWorkerName,
          worker
        );
        return worker;
      }
    );
    supervisor = new UtilitySupervisor({
      onUtilityEvent: vi.fn(),
      onUnexpectedExit: vi.fn(),
      onWorkerRestarted: vi.fn(),
      internalCommandAllowlist: { core: AGENT_CORE_COMMANDS },
      internalCommandAuthorize: (context) =>
        authorizeMainInternalCommand(context, activeRuns)
    });
    supervisor.startAll();
    activeRuns.set(runId, {
      accepted: true,
      sessionId,
      promptRequestId,
      resourceId: capability.bookId,
      comparisonDraftWriterContext: capability
    });
  });
  afterEach(async () => {
    await supervisor.shutdownAll();
  });

  function executor(parentRequestId = promptRequestId) {
    return createCoreCommandExecutor({
      worker: "agent",
      requestId: parentRequestId,
      requestInternalCommand: (target, request, options) =>
        new Promise((resolve) => {
          const agent = workers.get("agent")!;
          const requestId = `internal-${request.id}`;
          agent.pending.set(requestId, resolve);
          agent.emit("message", {
            kind: "utility.internal.command.request",
            worker: "agent",
            target,
            requestId,
            parentRequestId,
            timeoutMs: options?.timeoutMs ?? 60_000,
            command: request
          });
        })
    });
  }

  it.each([
    "long.prepareComparisonDraft",
    "long.deliverComparisonDraft"
  ] as const)(
    "admits and returns %s through the production allowlist and authorizer",
    async (type) => {
      const request = command(type);
      await expect(executor()(request)).resolves.toEqual({
        status: "accepted",
        requestId: request.id,
        payload: { reachedCore: type }
      });
      expect(workers.get("core")!.commands).toEqual([request]);
    }
  );

  it.each([
    "long.prepareComparisonDraft",
    "long.deliverComparisonDraft"
  ] as const)(
    "keeps %s blocked without the current writing capability",
    async (type) => {
      delete activeRuns.get(runId)!.comparisonDraftWriterContext;
      await expect(executor()(command(type))).resolves.toMatchObject({
        status: "rejected",
        error: { code: "utility.internal_command_unauthorized" }
      });
      expect(workers.get("core")!.commands).toEqual([]);
    }
  );

  it("rejects another parent prompt before Core receives a command", async () => {
    await expect(
      executor("wrong-prompt")(command("long.prepareComparisonDraft"))
    ).resolves.toMatchObject({
      status: "rejected",
      error: { code: "utility.internal_command_unauthorized" }
    });
    expect(workers.get("core")!.commands).toEqual([]);
  });

  it("does not admit general project mutations", () => {
    expect(AGENT_CORE_COMMANDS).not.toContain("long.writeChapter");
    expect(AGENT_CORE_COMMANDS).not.toContain("catalog.deleteProject");
  });
});
