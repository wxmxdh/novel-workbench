import type { BrowserWindow } from "electron";

/** Load the local build when the development server is unavailable at startup. */
export async function loadWindowRenderer(
  window: Pick<BrowserWindow, "loadURL" | "loadFile" | "isDestroyed">,
  indexPath: string,
  developmentUrl?: string
): Promise<void> {
  if (developmentUrl) {
    try {
      await window.loadURL(developmentUrl);
      return;
    } catch {
      if (window.isDestroyed()) return;
      // The built renderer uses the same validated preload bridge.
    }
  }
  if (!window.isDestroyed()) {
    if (
      process.env.DEEPWRITE_SMOKE === "1" &&
      process.env.DEEPWRITE_SMOKE_SUITE === "parallel-ui"
    ) {
      await window.loadFile(indexPath, { query: { "parallel-ui-smoke": "1" } });
    } else await window.loadFile(indexPath);
  }
}
