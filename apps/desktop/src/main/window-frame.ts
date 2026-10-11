import { app, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  createEnvelope,
  WINDOW_FRAME_COMMAND_CHANNEL,
  WINDOW_FRAME_EVENT_CHANNEL,
  WindowFrameCommandSchema,
  WindowFrameEventSchema
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import {
  onWindowFullscreenSettled,
  toggleWindowFullscreen
} from "./fullscreen-transition";

export {
  onWindowFullscreenSettled,
  setWindowFullscreen,
  toggleWindowFullscreen
} from "./fullscreen-transition";

export function usesCustomWindowFrame(platform = process.platform): boolean {
  return platform === "linux" || platform === "win32";
}

function windowFrameEvent(window: BrowserWindow) {
  return WindowFrameEventSchema.parse(
    createEnvelope(
      "windowFrame.state",
      {
        customTitlebar: usesCustomWindowFrame(),
        maximized: window.isMaximized(),
        fullscreen: window.isFullScreen()
      },
      { id: createId("evt_window") }
    )
  );
}

/** Window-local handler: subframes and embedded webviews cannot control the host. */
export function installWindowFrame(window: BrowserWindow): void {
  const contents = window.webContents;
  const publish = () => {
    if (!window.isDestroyed() && !contents.isDestroyed())
      contents.send(WINDOW_FRAME_EVENT_CHANNEL, windowFrameEvent(window));
  };
  const unsubscribeFullscreen = onWindowFullscreenSettled(window, publish);
  const handle = async (sender: IpcMainInvokeEvent, raw: unknown) => {
    if (
      sender.sender !== contents ||
      sender.senderFrame !== contents.mainFrame ||
      window.isDestroyed()
    )
      throw new Error("Untrusted window command.");

    const command = WindowFrameCommandSchema.parse(raw);
    const action = command.payload.action;
    switch (action) {
      case "minimize":
        window.minimize();
        break;
      case "toggleMaximize":
        if (!window.isFullScreen()) {
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
        }
        break;
      case "toggleFullscreen":
        await toggleWindowFullscreen(window);
        break;
    }
    const result = windowFrameEvent(window);
    if (action === "close" || action === "quit") {
      // Reply before lifecycle handlers potentially destroy the renderer.
      setImmediate(() => {
        if (action === "quit") app.quit();
        else if (!window.isDestroyed()) window.close();
      });
    }
    return result;
  };
  contents.ipc.handle(WINDOW_FRAME_COMMAND_CHANNEL, handle);
  window.on("maximize", publish);
  window.on("unmaximize", publish);
  contents.on("did-finish-load", publish);
  window.once("closed", () => {
    unsubscribeFullscreen();
    if (!contents.isDestroyed())
      contents.ipc.removeHandler(WINDOW_FRAME_COMMAND_CHANNEL);
  });
}
