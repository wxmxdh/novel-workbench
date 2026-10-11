import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AgentRunDiagnosticPhase =
  | "request_received"
  | "budget_rejected"
  | "request_rejected"
  | "accepted"
  | "terminal";

export type AgentRunDiagnosticCode =
  | "conversation_history_busy"
  | "context_budget_exceeded"
  | "agent_dispatch_rejected"
  | "invalid_acceptance"
  | "run_failed"
  | "agent_error";

interface DiagnosticIdentity {
  sessionId: string;
  correlationId: string;
  runId?: string;
}

interface DiagnosticRecord extends DiagnosticIdentity {
  phase: AgentRunDiagnosticPhase;
  errorCode?: AgentRunDiagnosticCode;
}

interface HashedIdentity {
  session: string;
  correlation: string;
  run?: string;
}

interface PendingIdentity extends HashedIdentity {
  seenAt: number;
}

interface EarlyTerminal {
  correlationId: string;
  failed: boolean;
  seenAt: number;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Writes bounded, privacy-safe Main-side run breadcrumbs. Only phase, a
 * fixed error code, timestamp and one-way identity fingerprints are persisted.
 */
export class AgentRunDiagnostics {
  private readonly path: string;
  private readonly backupPath: string;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly active = new Map<string, HashedIdentity>();
  private readonly pending = new Map<string, PendingIdentity>();
  private readonly earlyTerminals = new Map<string, EarlyTerminal>();
  private readonly pendingTtlMs = 2 * 60 * 1000;

  constructor(
    userDataPath: string,
    private readonly maxBytes = 256 * 1024
  ) {
    const directory = join(userDataPath, "logs");
    this.path = join(directory, "agent-run-diagnostics.jsonl");
    this.backupPath = `${this.path}.1`;
  }

  record(record: DiagnosticRecord): Promise<void> {
    this.prunePending();
    if (record.phase === "request_received") {
      this.pending.set(record.correlationId, {
        session: fingerprint(record.sessionId),
        correlation: fingerprint(record.correlationId),
        seenAt: Date.now()
      });
      this.trim(this.pending, 128);
    } else if (
      record.phase === "budget_rejected" ||
      record.phase === "request_rejected"
    ) {
      this.pending.delete(record.correlationId);
    }
    const entry = {
      at: new Date().toISOString(),
      phase: record.phase,
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
      session: fingerprint(record.sessionId),
      correlation: fingerprint(record.correlationId),
      ...(record.runId ? { run: fingerprint(record.runId) } : {})
    };
    return this.enqueue(entry);
  }

  async accepted(identity: Required<DiagnosticIdentity>): Promise<void> {
    this.prunePending();
    const pending = this.pending.get(identity.correlationId);
    this.pending.delete(identity.correlationId);
    const hashed: HashedIdentity = pending
      ? {
          session: pending.session,
          correlation: pending.correlation,
          run: fingerprint(identity.runId)
        }
      : {
          session: fingerprint(identity.sessionId),
          correlation: fingerprint(identity.correlationId),
          run: fingerprint(identity.runId)
        };
    this.active.set(identity.runId, hashed);
    this.trim(this.active, 256);
    await this.enqueue({
      at: new Date().toISOString(),
      phase: "accepted",
      ...hashed
    });
    const early = this.earlyTerminals.get(identity.runId);
    if (early?.correlationId === identity.correlationId) {
      this.earlyTerminals.delete(identity.runId);
      await this.writeTerminal(identity.runId, early.failed);
    }
  }

  async terminal(
    runId: string,
    failed: boolean,
    correlationId?: string
  ): Promise<void> {
    const identity = this.active.get(runId);
    if (!identity) {
      this.prunePending();
      if (!correlationId || !this.pending.has(correlationId)) return;
      this.earlyTerminals.set(runId, {
        correlationId,
        failed,
        seenAt: Date.now()
      });
      this.trim(this.earlyTerminals, 128);
      return;
    }
    await this.writeTerminal(runId, failed);
  }

  private async writeTerminal(runId: string, failed: boolean): Promise<void> {
    const identity = this.active.get(runId);
    if (!identity) return;
    this.active.delete(runId);
    await this.enqueue({
      at: new Date().toISOString(),
      phase: "terminal",
      ...(failed ? { errorCode: "agent_error" as const } : {}),
      ...identity
    });
  }

  private prunePending(): void {
    const cutoff = Date.now() - this.pendingTtlMs;
    for (const [key, value] of this.pending)
      if (value.seenAt < cutoff) this.pending.delete(key);
    for (const [key, value] of this.earlyTerminals)
      if (value.seenAt < cutoff) this.earlyTerminals.delete(key);
  }

  private trim<T>(map: Map<string, T>, limit: number): void {
    while (map.size > limit) {
      const oldest = map.keys().next().value as string | undefined;
      if (!oldest) return;
      map.delete(oldest);
    }
  }

  private enqueue(record: object): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        let size = 0;
        try {
          size = (await stat(this.path)).size;
        } catch {
          // A missing file is the normal first-write case.
        }
        if (size + Buffer.byteLength(line, "utf8") > this.maxBytes) {
          await rm(this.backupPath, { force: true });
          try {
            await rename(this.path, this.backupPath);
          } catch {
            // Keep the bounded prior file intact if rotation is unavailable.
            return;
          }
          try {
            if ((await stat(this.backupPath)).size > this.maxBytes)
              await rm(this.backupPath, { force: true });
          } catch {
            // Rotation may leave no backup if the source disappeared.
          }
        }
        await appendFile(this.path, line, { encoding: "utf8", mode: 0o600 });
      })
      .catch(() => undefined);
    return this.writeChain;
  }
}
