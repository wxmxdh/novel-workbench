import {
  CODEX_COLLABORATION_COMMANDS,
  CodexEventSchema,
  CodexInterruptInputSchema,
  CodexModelSchema,
  CodexResumeSessionInputSchema,
  CodexSessionSchema,
  CodexStartSessionInputSchema,
  CodexTurnInputSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { CodexAppServer } from "./app-server";

export type CodexEventSink = (
  event: ReturnType<typeof CodexEventSchema.parse>
) => void;

export async function handleCodexCollaborationCommand(
  command: CommandEnvelope,
  server: CodexAppServer
): Promise<CommandResult | undefined> {
  if (
    !(CODEX_COLLABORATION_COMMANDS as readonly string[]).includes(command.type)
  )
    return undefined;
  try {
    let payload: unknown;
    switch (command.type) {
      case "codex.listModels":
        payload = (await server.listModels()).map((model) =>
          CodexModelSchema.parse(model)
        );
        break;
      case "codex.startSession":
        payload = CodexSessionSchema.parse(
          await server.startSession(
            CodexStartSessionInputSchema.parse(command.payload)
          )
        );
        break;
      case "codex.resumeSession":
        payload = CodexSessionSchema.parse(
          await server.resumeSession(
            CodexResumeSessionInputSchema.parse(command.payload)
          )
        );
        break;
      case "codex.startTurn":
        await server.startTurn(CodexTurnInputSchema.parse(command.payload));
        payload = { started: true };
        break;
      case "codex.interrupt":
        await server.interrupt(
          CodexInterruptInputSchema.parse(command.payload)
        );
        payload = { interrupted: true };
        break;
      case "codex.closeSession":
        await server.closeSession(
          CodexInterruptInputSchema.parse(command.payload)
        );
        payload = { closed: true };
        break;
      case "codex.dispose":
        await server.dispose();
        payload = { disposed: true };
        break;
      default:
        return undefined;
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "codex.operation_failed",
        message: error instanceof Error ? error.message : "Codex 任务失败。"
      }
    };
  }
}

export function subscribeCodexEvents(
  server: CodexAppServer,
  sink: CodexEventSink
): () => void {
  return server.onEvent((raw) => sink(CodexEventSchema.parse(raw)));
}
