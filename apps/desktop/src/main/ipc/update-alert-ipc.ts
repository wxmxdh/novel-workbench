import { ipcMain, type BrowserWindow } from "electron";
import {
  APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL,
  APP_ALERT_GET_CHANNEL,
  AppAlertDesktopRevisionSchema,
  AppAlertSnapshotSchema,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  type AppAlertSnapshot,
  type UpdateState
} from "@deepwrite/contracts";
import type { AppAlertStore } from "../app-alert-store";
import type { UpdateService } from "../update-service";

export function registerUpdateAlertIpc(options: {
  getMainWindow: () => BrowserWindow | undefined;
  getUpdateService: () => UpdateService | undefined;
  getAppAlertStore: () => AppAlertStore | undefined;
}): void {
  const requireUpdateService = (
    event: Electron.IpcMainInvokeEvent
  ): UpdateService => {
    const mainWindow = options.getMainWindow();
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents
    ) {
      throw new Error(
        "IPC update request sender is not the active DeepWrite window."
      );
    }
    const updateService = options.getUpdateService();
    if (!updateService) throw new Error("更新服务尚未初始化。");
    return updateService;
  };
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, (event): UpdateState =>
    requireUpdateService(event).getState()
  );
  ipcMain.handle(UPDATE_CHECK_CHANNEL, (event): Promise<UpdateState> =>
    requireUpdateService(event).check()
  );
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, (event): Promise<UpdateState> =>
    requireUpdateService(event).download()
  );
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, (event): void => {
    requireUpdateService(event).install();
  });
  const requireAppAlertStore = (
    event: Electron.IpcMainInvokeEvent
  ): AppAlertStore => {
    const mainWindow = options.getMainWindow();
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents
    ) {
      throw new Error(
        "IPC app alert request sender is not the active DeepWrite window."
      );
    }
    const appAlertStore = options.getAppAlertStore();
    if (!appAlertStore) throw new Error("提醒服务尚未初始化。");
    return appAlertStore;
  };
  ipcMain.handle(
    APP_ALERT_GET_CHANNEL,
    async (event): Promise<AppAlertSnapshot> =>
      AppAlertSnapshotSchema.parse(
        await requireAppAlertStore(event).getSnapshot()
      )
  );
  ipcMain.handle(
    APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL,
    async (event, rawRevision: unknown): Promise<void> => {
      const revision = AppAlertDesktopRevisionSchema.parse(rawRevision);
      await requireAppAlertStore(event).acknowledgeDesktop(revision);
    }
  );
}
