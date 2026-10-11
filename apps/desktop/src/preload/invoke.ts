import { ipcRenderer } from "electron";
import {
  CommandResultSchema,
  IPC_COMMAND_CHANNEL,
  type CommandEnvelope
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";

export function browserId(prefix: string): string {
  return createId(prefix);
}

function isDataCloneFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown };
  return (
    candidate.name === "DataCloneError" ||
    (typeof candidate.message === "string" &&
      /could not be cloned/i.test(candidate.message))
  );
}

export async function invokeCommand<TPayload>(
  command: CommandEnvelope
): Promise<TPayload> {
  const expectedRequestId = command.id;
  let response: unknown;
  try {
    response = await ipcRenderer.invoke(IPC_COMMAND_CHANNEL, command);
  } catch (error: unknown) {
    if (isDataCloneFailure(error)) {
      // Log only stable routing metadata; exception text can contain payload data.
      console.error(
        `DEEPWRITE_SERIALIZATION_FAILURE boundary=preload.ipcRenderer.invoke command=${command.type} error=DataCloneError`
      );
    }
    throw error;
  }
  const result = CommandResultSchema.parse(response);
  if (result.requestId !== expectedRequestId) {
    // Prefer the real rejection reason when main returned requestId "unknown"
    // (or another mismatched id) for an invalid/untrusted command.
    if (result.status === "rejected") {
      throw result.error;
    }
    throw new Error(
      `IPC result requestId does not match command id. expected=${expectedRequestId} actual=${result.requestId}`
    );
  }
  if (result.status === "rejected") {
    throw result.error;
  }
  return result.payload as TPayload;
}
