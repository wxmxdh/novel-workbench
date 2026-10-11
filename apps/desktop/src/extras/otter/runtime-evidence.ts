import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemEventEnvelope } from "@deepwrite/contracts";

const hash = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");
export interface RuntimeEvidence {
  schema_version: 1;
  type: "deepwrite_response";
  workspaceRoot: string;
  projectId: string;
  contextId: string;
  sessionId: string;
  runId: string;
  runtime: {
    provider: string;
    model: string;
    mode: "provider";
    configId?: string;
  };
  contentHash: string;
  completedAt: string;
}

/** Only Main's schema-validated Agent utility events can enter this store.
 * It never uses the renderer's selected model label as runtime evidence. */
export class OtterRuntimeEvidenceStore {
  private readonly records = new Map<
    string,
    { record: RuntimeEvidence; file: string; saved: Promise<void> }
  >();
  constructor(private readonly userDataPath: string) {}

  remember(workspaceRoot: string | null, event: SystemEventEnvelope): void {
    if (!workspaceRoot || event.type !== "agent.message_completed") return;
    const payload = event.payload;
    if (
      payload.runtime.mode !== "provider" ||
      ["aborted", "length", "error"].includes(payload.stopReason ?? "")
    )
      return;
    const match = /^otter:(otter_[a-f0-9]{16,64}):(CTX-[\w-]+):/.exec(
      payload.sessionId
    );
    if (!match || !/^[\w-]+$/.test(payload.runId)) return;
    const directory = join(this.userDataPath, "otter", "runtime-evidence");
    const file = join(directory, `${payload.runId}.jsonl`);
    const record: RuntimeEvidence = {
      schema_version: 1,
      type: "deepwrite_response",
      workspaceRoot,
      projectId: match[1]!,
      contextId: match[2]!,
      sessionId: payload.sessionId,
      runId: payload.runId,
      runtime: {
        provider: payload.runtime.provider,
        model: payload.runtime.model,
        mode: "provider",
        ...(payload.runtime.configId
          ? { configId: payload.runtime.configId }
          : {})
      },
      contentHash: hash(payload.content),
      completedAt: event.timestamp
    };
    const saved = mkdir(directory, { recursive: true }).then(() =>
      writeFile(file, `${JSON.stringify(record)}\n`, { flag: "wx" })
    );
    // Delivery awaits the real failure; the event stream itself must keep running.
    void saved.catch(() => undefined);
    this.records.set(payload.runId, { record, file, saved });
    while (this.records.size > 500)
      this.records.delete(this.records.keys().next().value!);
  }

  async forDraft(input: {
    projectId: string;
    contextId: string;
    body: string;
    runId?: string | undefined;
    workspaceRoot: string;
  }): Promise<{ sessionFile: string; sessionId: string } | null> {
    if (!input.runId) return null;
    const entry = this.records.get(input.runId);
    if (
      !entry ||
      entry.record.projectId !== input.projectId ||
      entry.record.contextId !== input.contextId ||
      entry.record.workspaceRoot !== input.workspaceRoot ||
      entry.record.contentHash !== hash(input.body)
    )
      return null;
    await entry.saved;
    return { sessionFile: entry.file, sessionId: entry.record.sessionId };
  }
}
