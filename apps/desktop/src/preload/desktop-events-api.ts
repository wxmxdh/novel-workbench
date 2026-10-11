import { ipcRenderer } from "electron";
import {
  IPC_EVENT_CHANNEL,
  SystemEventEnvelopeSchema,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { windowFrame } from "./window-frame-api";

export const desktopEvents = {
  windowFrame,
  events: {
    subscribe(listener: (event: SystemEventEnvelope) => void): () => void {
      const handler = (
        _event: Electron.IpcRendererEvent,
        rawEvent: unknown
      ): void => {
        const parsed = SystemEventEnvelopeSchema.safeParse(rawEvent);
        if (!parsed.success) {
          console.warn("DeepWrite discarded an invalid desktop event.");
          return;
        }
        listener(parsed.data as SystemEventEnvelope);
      };
      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    }
  }
};
