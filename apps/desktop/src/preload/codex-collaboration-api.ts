import { ipcRenderer } from "electron";
import {
  CodexEventEnvelopeSchema,
  CodexInterruptInputSchema,
  CodexModelSchema,
  CodexResumeSessionInputSchema,
  CodexSessionSchema,
  CodexStartSessionInputSchema,
  CodexTurnInputSchema,
  IPC_EVENT_CHANNEL,
  createEnvelope,
  type CodexCollaborationApi,
  type CodexCollaborationCommand,
  type CommandEnvelope
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

async function command<T>(
  type: CodexCollaborationCommand,
  payload: unknown
): Promise<T> {
  const id = browserId("cmd_codex");
  const envelope = createEnvelope(type, payload as never, {
    id,
    correlationId: id
  }) as CommandEnvelope;
  return invokeCommand<T>(envelope);
}

export const codexCollaboration: CodexCollaborationApi = {
  async listModels() {
    const result = await command<unknown[]>("codex.listModels", {});
    return result.map((model) => CodexModelSchema.parse(model));
  },
  async startSession(rawInput) {
    const input = CodexStartSessionInputSchema.parse(rawInput);
    return CodexSessionSchema.parse(await command("codex.startSession", input));
  },
  async resumeSession(rawInput) {
    const input = CodexResumeSessionInputSchema.parse(rawInput);
    return CodexSessionSchema.parse(
      await command("codex.resumeSession", input)
    );
  },
  async startTurn(rawInput) {
    const input = CodexTurnInputSchema.parse(rawInput);
    await command("codex.startTurn", input);
  },
  async interrupt(rawInput) {
    const input = CodexInterruptInputSchema.parse(rawInput);
    await command("codex.interrupt", input);
  },
  async closeSession(rawInput) {
    const input = CodexInterruptInputSchema.parse(rawInput);
    await command("codex.closeSession", input);
  },
  async dispose() {
    await command("codex.dispose", {});
  },
  onEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
      const parsed = CodexEventEnvelopeSchema.safeParse(raw);
      if (parsed.success) listener(parsed.data.payload);
    };
    ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
  }
};
