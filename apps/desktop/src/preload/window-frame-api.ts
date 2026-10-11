import { ipcRenderer } from "electron";
import {
  createEnvelope,
  WINDOW_FRAME_COMMAND_CHANNEL,
  WINDOW_FRAME_EVENT_CHANNEL,
  WindowFrameCommandSchema,
  WindowFrameEventSchema,
  type WindowFrameApi
} from "@deepwrite/contracts";
import { browserId } from "./invoke";

export const windowFrame: WindowFrameApi = {
  async command(action) {
    const command = WindowFrameCommandSchema.parse(
      createEnvelope(
        "windowFrame.command",
        { action },
        { id: browserId("cmd_window") }
      )
    );
    return WindowFrameEventSchema.parse(
      await ipcRenderer.invoke(WINDOW_FRAME_COMMAND_CHANNEL, command)
    ).payload;
  },
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const result = WindowFrameEventSchema.safeParse(raw);
      if (result.success) listener(result.data.payload);
    };
    ipcRenderer.on(WINDOW_FRAME_EVENT_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(WINDOW_FRAME_EVENT_CHANNEL, handler);
  }
};
