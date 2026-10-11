import { ipcRenderer } from "electron";
import {
  TEXT_CONTEXT_MENU_COMMAND_CHANNEL,
  TEXT_CONTEXT_MENU_EVENT_CHANNEL,
  TextContextMenuCommandSchema,
  TextContextMenuEventSchema,
  type TextContextMenuApi
} from "@deepwrite/contracts";

export const textContextMenu: TextContextMenuApi = {
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const result = TextContextMenuEventSchema.safeParse(raw);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(TEXT_CONTEXT_MENU_EVENT_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(TEXT_CONTEXT_MENU_EVENT_CHANNEL, handler);
  },
  reply(command) {
    ipcRenderer.send(
      TEXT_CONTEXT_MENU_COMMAND_CHANNEL,
      TextContextMenuCommandSchema.parse(command)
    );
  }
};
