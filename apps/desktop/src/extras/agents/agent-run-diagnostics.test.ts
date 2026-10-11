import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type AgentProviderRuntimeConfig,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { AgentRunDiagnostics } from "./agent-run-diagnostics";
import { ExtrasAgentConfigStore } from "./config-store";
import { runExtrasAgent } from "./run-service";

const roots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "deepwrite-agent-diagnostics-"));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true }))
  );
});

describe("Main agent run diagnostics", () => {
  it("records a real Main-side budget rejection without writing prompt or identity text", async () => {
    const root = await temporaryDirectory();
    const diagnostics = new AgentRunDiagnostics(root);
    const configStore = new ExtrasAgentConfigStore(root);
    const sessionId =
      "otter:otter_0123456789abcdef:ctx-1:FAKE_TEST_KEY_DO_NOT_USE";
    const correlationId = "FAKE_TEST_CORRELATION_DO_NOT_USE";
    const projectId = "otter_0123456789abcdef";
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "extrasAgent.run",
        {
          sessionId,
          task: {
            agentId: "chat-normal",
            profileId: "default",
            input: {
              otter: { projectId, contextPath: "004_写作中/安全测试.md" }
            }
          },
          conversation: { message: "FAKE_TEST_PROMPT_DO_NOT_USE" }
        },
        {
          id: "diagnostic-test-command",
          context: { correlationId, sessionId }
        }
      )
    ) as Extract<CommandEnvelope, { type: "extrasAgent.run" }>;
    const requestAgent = vi.fn();

    const result = await runExtrasAgent(
      {
        configStore: () => configStore,
        diagnostics,
        chatSources: {
          core: async () =>
            ({
              status: "accepted",
              requestId: "test",
              payload: {}
            }) as CommandResult,
          listModels: async () => ({}),
          queryUsage: async () => ({}),
          appVersion: () => "0.0.0"
        },
        resolveModel: async () =>
          ({
            id: "test-model",
            contextWindow: 1_000_000,
            maxTokens: 1_000_000
          }) as AgentProviderRuntimeConfig,
        resolveOtterContext: async () => ({
          projectId,
          contextId: "ctx-1",
          baselineHash: "a".repeat(64),
          comparisonBaselineHash: null,
          apiText: "FAKE_TEST_NOVEL_TEXT_DO_NOT_USE"
        }),
        resolveContextCompaction: async () => ({
          contextCompactionSettings: { enabled: true, budgetTokens: 160_000 }
        }),
        requestAgent,
        acquireConversation: () => () => undefined,
        activeRuns: new Map(),
        terminalRuns: new Set(),
        pendingUsageContexts: new Map()
      },
      command
    );

    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "extras_agent.run_failed" }
    });
    expect(requestAgent).not.toHaveBeenCalled();
    const log = await readFile(
      join(root, "logs", "agent-run-diagnostics.jsonl"),
      "utf8"
    );
    expect(log).toContain('"phase":"request_received"');
    expect(log).toContain('"phase":"budget_rejected"');
    expect(log).toContain('"errorCode":"context_budget_exceeded"');
    for (const secret of [
      "FAKE_TEST_KEY_DO_NOT_USE",
      "FAKE_TEST_CORRELATION_DO_NOT_USE",
      "FAKE_TEST_PROMPT_DO_NOT_USE",
      "FAKE_TEST_NOVEL_TEXT_DO_NOT_USE"
    ])
      expect(log).not.toContain(secret);
  });

  it("rotates to one bounded backup and records only fixed terminal codes", async () => {
    const root = await temporaryDirectory();
    const diagnostics = new AgentRunDiagnostics(root, 420);
    await diagnostics.record({
      phase: "request_received",
      sessionId: "private-session-id",
      correlationId: "private-correlation-id"
    });
    await diagnostics.accepted({
      sessionId: "private-session-id",
      correlationId: "private-correlation-id",
      runId: "private-run-id"
    });
    await diagnostics.terminal("private-run-id", true);

    const logPath = join(root, "logs", "agent-run-diagnostics.jsonl");
    const active = await readFile(logPath, "utf8");
    const backup = await readFile(`${logPath}.1`, "utf8");
    expect(Buffer.byteLength(active, "utf8")).toBeLessThanOrEqual(420);
    expect(Buffer.byteLength(backup, "utf8")).toBeLessThanOrEqual(420);
    expect(`${active}\n${backup}`).toContain('"phase":"terminal"');
    expect(`${active}\n${backup}`).toContain('"errorCode":"agent_error"');
    expect(`${active}\n${backup}`).not.toContain("private-session-id");
    expect(`${active}\n${backup}`).not.toContain("private-correlation-id");
    expect(`${active}\n${backup}`).not.toContain("private-run-id");
  });

  it("pairs an early terminal with its later acceptance and bounds unrelated runs", async () => {
    const root = await temporaryDirectory();
    const diagnostics = new AgentRunDiagnostics(root);
    const correlationId = "known-pending-correlation";
    await diagnostics.record({
      phase: "request_received",
      sessionId: "private-session",
      correlationId
    });
    await diagnostics.terminal("accepted-run", true, correlationId);
    await diagnostics.accepted({
      sessionId: "private-session",
      correlationId,
      runId: "accepted-run"
    });

    const boundedCorrelation = "bounded-pending-correlation";
    await diagnostics.record({
      phase: "request_received",
      sessionId: "private-session",
      correlationId: boundedCorrelation
    });
    for (let index = 0; index < 140; index++)
      await diagnostics.terminal(
        `unrelated-${index}`,
        true,
        boundedCorrelation
      );
    const tracking = diagnostics as unknown as {
      earlyTerminals: Map<string, unknown>;
    };
    expect(tracking.earlyTerminals.size).toBeLessThanOrEqual(128);
    await diagnostics.terminal("unknown-run", true, "unknown-correlation");

    const log = await readFile(
      join(root, "logs", "agent-run-diagnostics.jsonl"),
      "utf8"
    );
    const phases = log
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { phase: string }).phase);
    expect(phases).toEqual([
      "request_received",
      "accepted",
      "terminal",
      "request_received"
    ]);
    expect(log).not.toContain("unrelated-");
    expect(log).not.toContain("unknown-run");
  });
});
