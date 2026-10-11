import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  OTTER_REVIEW_COLOR_KEYS,
  OtterReviewThemeSchema
} from "@deepwrite/contracts";
import { OtterReviewView } from "./review-view";

interface MockView {
  webContents: EventEmitter & {
    insertCSS: Mock;
    executeJavaScript: Mock;
    capturePage: Mock;
    isLoadingMainFrame: Mock;
  };
  setVisible: Mock;
}
const native = vi.hoisted(() => ({ views: [] as MockView[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class View {
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      isLoadingMainFrame: vi.fn(() => false),
      insertCSS: vi.fn(async () => "css-key"),
      executeJavaScript: vi.fn(async () => undefined),
      capturePage: vi.fn(),
      close: vi.fn(),
      loadURL: vi.fn(async () => {
        this.webContents.emit(
          "did-start-navigation",
          {},
          "otter-review://app/",
          false,
          true
        );
        this.webContents.emit("did-finish-load");
      })
    });
    setVisible = vi.fn();
    setBounds = vi.fn();
    constructor() {
      native.views.push(this);
    }
  }
  return { WebContentsView: View };
});
vi.mock("../../main/window-frame", () => ({
  onWindowFullscreenSettled: () => () => {},
  setWindowFullscreen: vi.fn(),
  toggleWindowFullscreen: vi.fn()
}));
vi.mock("./review-protocol", () => ({
  OTTER_REVIEW_URL: "otter-review://app/",
  OTTER_REVIEW_WEB_PREFERENCES: { sandbox: true },
  constrainOtterReviewWebContents: vi.fn()
}));

function fixture() {
  const owner = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    isFullScreen: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }
  }) as unknown as BrowserWindow;
  const manager = new OtterReviewView();
  return { owner, manager, bounds: { x: 280, y: 72, width: 920, height: 728 } };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => {
  native.views.length = 0;
});

describe("native review overlay and document lifecycle", () => {
  it("keeps the child hidden during resize and restores it when the menu closes", async () => {
    const { owner, manager, bounds } = fixture();
    await manager.show(owner, bounds);
    const view = native.views[0]!;
    const image = {
      getSize: () => ({ width: 920 }),
      resize: vi.fn(),
      toJPEG: () => Buffer.from("fixture")
    };
    image.resize.mockReturnValue(image);
    view.webContents.capturePage.mockResolvedValue(image);
    const result = await manager.setOverlay(owner, true);
    expect(result.preview).toMatch(/^data:image\/jpeg;base64,/);
    expect(view.webContents.capturePage).toHaveBeenCalledWith(undefined, {
      stayHidden: true
    });
    await manager.show(owner, { ...bounds, width: 900 });
    owner.emit("resize");
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(await manager.setOverlay(owner, false)).toEqual({ preview: null });
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    manager.dispose();
  });

  it("discards a delayed capture after closing its overlay or disposing the view", async () => {
    const { owner, manager, bounds } = fixture();
    await manager.show(owner, bounds);
    const view = native.views[0]!;
    let finish!: (image: unknown) => void;
    view.webContents.capturePage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = manager.setOverlay(owner, true);
    await manager.setOverlay(owner, false);
    finish({});
    expect(await pending).toEqual({ preview: null });
    const pendingClose = manager.setOverlay(owner, true);
    manager.dispose();
    finish({});
    expect(await pendingClose).toEqual({ preview: null });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(await manager.setOverlay(owner, true)).toEqual({ preview: null });
  });

  it("reinstalls desktop CSS and appearance after inner-page navigation", async () => {
    const { owner, manager, bounds } = fixture();
    await manager.show(owner, bounds);
    const contents = native.views[0]!.webContents;
    await turn();
    contents.insertCSS.mockClear();
    contents.executeJavaScript.mockClear();
    contents.emit(
      "did-start-navigation",
      {},
      "otter-review://app/",
      false,
      true
    );
    contents.emit("did-finish-load");
    await turn();
    expect(contents.insertCSS).toHaveBeenCalledTimes(1);
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(contents.executeJavaScript.mock.calls[0]![0]).toContain(
      "otter-desktop-exit-fullscreen"
    );
    contents.emit(
      "did-start-navigation",
      {},
      "otter-review://app/#fragment",
      true,
      true
    );
    await manager.setTheme(
      owner,
      OtterReviewThemeSchema.parse({
        scheme: "light",
        colors: Object.fromEntries(
          OTTER_REVIEW_COLOR_KEYS.map((key) => [key, "#f2eee7"])
        )
      })
    );
    expect(contents.insertCSS).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("restores appearance when navigation finishes before loading settles", async () => {
    const { owner, manager, bounds } = fixture();
    await manager.setTheme(
      owner,
      OtterReviewThemeSchema.parse({
        scheme: "light",
        colors: Object.fromEntries(
          OTTER_REVIEW_COLOR_KEYS.map((key) => [key, "#f2eee7"])
        )
      })
    );
    await manager.show(owner, bounds);
    await turn();
    const contents = native.views[0]!.webContents;
    contents.insertCSS.mockClear();
    contents.executeJavaScript.mockClear();
    contents.isLoadingMainFrame.mockReturnValue(true);
    contents.emit("did-start-navigation", {
      isMainFrame: true,
      isSameDocument: false
    });
    contents.emit("did-finish-load");
    await turn();
    expect(contents.executeJavaScript).not.toHaveBeenCalled();
    contents.isLoadingMainFrame.mockReturnValue(false);
    contents.emit("did-stop-loading");
    await turn();
    expect(contents.insertCSS).toHaveBeenCalledTimes(1);
    expect(contents.executeJavaScript.mock.calls[0]![0]).toContain("#f2eee7");
    manager.dispose();
  });

  it("ignores overlay requests from a different window", async () => {
    const { owner, manager, bounds } = fixture();
    await manager.show(owner, bounds);
    const view = native.views[0]!;
    view.setVisible.mockClear();
    expect(
      await manager.setOverlay({ ...owner, id: 2 } as BrowserWindow, true)
    ).toEqual({ preview: null });
    expect(view.setVisible).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("keeps menus operable if preview capture fails and restores reading on close", async () => {
    const { owner, manager, bounds } = fixture();
    await manager.show(owner, bounds);
    const view = native.views[0]!;
    view.webContents.capturePage.mockRejectedValue(
      new Error("fixture capture failure")
    );
    expect(await manager.setOverlay(owner, true)).toEqual({ preview: null });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    await manager.setOverlay(owner, false);
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    manager.dispose();
  });
});
