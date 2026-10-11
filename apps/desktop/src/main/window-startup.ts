import type { BrowserWindow } from "electron";
import type { StartupLog } from "./startup-log";

interface WindowStartupOptions {
  log: StartupLog;
  onFailure: (error: unknown) => void;
  show: boolean;
  timeoutMs?: number;
}

/** A hidden window must either finish loading or report a bounded startup failure. */
export function guardWindowStartup(
  window: BrowserWindow,
  options: WindowStartupOptions
) {
  let settled = false;
  let loadFinished = false;
  let visibilityRetry: ReturnType<typeof setTimeout> | undefined;
  const loadedLog = (): void => {
    options.log.write("window.loaded");
  };
  const show = (): void => {
    if (settled || window.isDestroyed() || !options.show || window.isVisible())
      return;
    window.show();
    if (loadFinished && !window.isVisible() && visibilityRetry === undefined)
      visibilityRetry = setTimeout(retryVisibility, 100);
  };
  const retryVisibility = (): void => {
    visibilityRetry = undefined;
    if (settled || window.isDestroyed()) return;
    show();
    if (window.isVisible()) {
      cleanup();
      loadedLog();
    }
  };
  const cleanup = (): void => {
    settled = true;
    clearTimeout(timer);
    if (visibilityRetry !== undefined) clearTimeout(visibilityRetry);
    visibilityRetry = undefined;
    window.removeListener("ready-to-show", show);
    window.removeListener("closed", cleanup);
    window.webContents.removeListener("did-finish-load", loaded);
    window.webContents.removeListener("preload-error", preloadFailed);
    window.webContents.removeListener("render-process-gone", rendererGone);
  };
  const fail = (error: unknown): void => {
    if (settled) return;
    cleanup();
    options.onFailure(error);
  };
  const loaded = (): void => {
    // Some machines never emit ready-to-show. A completed load is also sufficient.
    loadFinished = true;
    show();
    if (options.show && !window.isVisible()) return;
    cleanup();
    loadedLog();
  };
  const preloadFailed = (_event: unknown, _path: string, error: Error): void =>
    fail(error);
  const rendererGone = (
    _event: unknown,
    details: Electron.RenderProcessGoneDetails
  ): void => {
    fail(
      Object.assign(new Error("Renderer exited during startup"), {
        code: details.exitCode
      })
    );
  };
  const timer = setTimeout(() => {
    fail(
      Object.assign(new Error("Window startup timed out"), {
        code: "WINDOW_STARTUP_TIMEOUT"
      })
    );
  }, options.timeoutMs ?? 30_000);
  timer.unref();
  window.once("ready-to-show", show);
  window.once("closed", cleanup);
  window.webContents.once("did-finish-load", loaded);
  window.webContents.once("preload-error", preloadFailed);
  window.webContents.once("render-process-gone", rendererGone);
  return { fail };
}
