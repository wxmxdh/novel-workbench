import { describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  quitAndInstall: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  setFeedURL: vi.fn()
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "1.0.0", isPackaged: true },
  net: { fetch: electronMocks.fetch }
}));

vi.mock("electron-updater", () => ({ autoUpdater: electronMocks }));

import { UpdateService } from "./update-service";

describe("local fork updater policy", () => {
  it("reports updates as unsupported without contacting an update service", async () => {
    const service = new UpdateService(vi.fn());

    await expect(service.check()).resolves.toMatchObject({
      status: "unsupported",
      currentVersion: "1.0.0",
      canDownload: false,
      canInstall: false,
      message: expect.stringContaining("未启用自动更新")
    });
    expect(service.getState().status).toBe("unsupported");
    expect(electronMocks.fetch).not.toHaveBeenCalled();
    expect(electronMocks.checkForUpdates).not.toHaveBeenCalled();
    expect(electronMocks.setFeedURL).not.toHaveBeenCalled();
  });

  it("rejects download and install requests", async () => {
    const requestInstall = vi.fn();
    const service = new UpdateService(requestInstall);

    await expect(service.download()).rejects.toThrow("未启用自动更新");
    expect(() => service.install()).toThrow("未启用自动更新");
    expect(requestInstall).not.toHaveBeenCalled();
    expect(electronMocks.downloadUpdate).not.toHaveBeenCalled();
    expect(electronMocks.quitAndInstall).not.toHaveBeenCalled();
  });
});
