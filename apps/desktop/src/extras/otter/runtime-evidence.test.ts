import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEnvelope,
  SystemEventEnvelopeSchema
} from "@deepwrite/contracts";
import { OtterRuntimeEvidenceStore } from "./runtime-evidence";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
const projectId = "otter_0123456789abcdef";
const event = (mode: "provider" | "local-faux", body = "隔离测试答复。") =>
  SystemEventEnvelopeSchema.parse(
    createEnvelope(
      "agent.message_completed",
      {
        sessionId: `otter:${projectId}:CTX-TEST-001:fixture`,
        runId: "run-test-1",
        messageId: "message-1",
        role: "assistant",
        content: body,
        stopReason: "stop",
        runtime: { provider: "example", model: "example-test-model", mode }
      },
      {
        id: "event-1",
        context: {
          sessionId: `otter:${projectId}:CTX-TEST-001:fixture`,
          runId: "run-test-1"
        }
      }
    )
  );

describe("Main runtime model evidence", () => {
  it("binds actual provider identity to exact response bytes without storing credentials or prose", async () => {
    directory = await mkdtemp(join(tmpdir(), "otter-evidence-test-"));
    const store = new OtterRuntimeEvidenceStore(directory);
    store.remember("D:/fixture-workspace", event("provider"));
    const identity = await store.forDraft({
      projectId,
      contextId: "CTX-TEST-001",
      body: "隔离测试答复。",
      runId: "run-test-1",
      workspaceRoot: "D:/fixture-workspace"
    });
    expect(identity).not.toBeNull();
    const record = await readFile(identity!.sessionFile, "utf8");
    expect(record).toContain("example-test-model");
    expect(record).not.toContain("隔离测试答复。");
    expect(record).not.toMatch(/apiKey|credential|accessToken/);
    expect(
      await store.forDraft({
        projectId,
        contextId: "CTX-TEST-001",
        body: "作者编辑了字节。",
        runId: "run-test-1",
        workspaceRoot: "D:/fixture-workspace"
      })
    ).toBeNull();
    expect(
      await store.forDraft({
        projectId,
        contextId: "CTX-OTHER",
        body: "隔离测试答复。",
        runId: "run-test-1",
        workspaceRoot: "D:/fixture-workspace"
      })
    ).toBeNull();
  });
  it("never presents local Faux responses as real provider output", async () => {
    directory = await mkdtemp(join(tmpdir(), "otter-evidence-test-"));
    const store = new OtterRuntimeEvidenceStore(directory);
    store.remember("D:/fixture-workspace", event("local-faux"));
    expect(
      await store.forDraft({
        projectId,
        contextId: "CTX-TEST-001",
        body: "隔离测试答复。",
        runId: "run-test-1",
        workspaceRoot: "D:/fixture-workspace"
      })
    ).toBeNull();
  });
});
