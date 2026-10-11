import { WebContentsView, type BrowserWindow } from "electron";
import type { OtterReviewTheme } from "@deepwrite/contracts";
import {
  onWindowFullscreenSettled,
  setWindowFullscreen,
  toggleWindowFullscreen
} from "../../main/window-frame";
import {
  DESKTOP_REVIEW_THEME_CSS,
  OTTER_REVIEW_EXIT_FULLSCREEN_URL,
  reviewAppearanceScript
} from "./review-appearance";
import {
  OTTER_REVIEW_URL,
  OTTER_REVIEW_WEB_PREFERENCES,
  constrainOtterReviewWebContents
} from "./review-protocol";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The author review page has no DeepWrite preload or privileged IPC bridge. */
export class OtterReviewView {
  private view: WebContentsView | undefined;
  private window: BrowserWindow | undefined;
  private requestedBounds: Bounds | undefined;
  private readonly themes = new Map<number, OtterReviewTheme>();
  private themeCss: Promise<string> | undefined;
  private stopFullscreen: (() => void) | undefined;
  private exitRequest: Promise<void> | undefined;
  private overlayVisible = false;
  private overlayRevision = 0;
  private documentRevision = 0;
  private readonly resize = () => this.applyBounds();
  private readonly fullscreenChanged = () => {
    void this.applyAppearance().catch(() =>
      console.warn("Review appearance update failed.")
    );
  };

  async setTheme(
    window: BrowserWindow,
    theme: OtterReviewTheme
  ): Promise<void> {
    this.themes.set(window.id, theme);
    if (this.window === window) await this.applyAppearance();
  }

  async setOverlay(
    window: BrowserWindow,
    visible: boolean
  ): Promise<{ preview: string | null }> {
    const view = this.view;
    if (
      this.window !== window ||
      window.isDestroyed() ||
      !view ||
      view.webContents.isDestroyed()
    )
      return { preview: null };
    const revision = ++this.overlayRevision;
    this.overlayVisible = visible;
    // A DOM z-index cannot cover a native child view. Pause its hit testing
    // while the host draws a memory-only preview underneath its menus.
    view.setVisible(!visible);
    if (!visible) return { preview: null };
    try {
      const captured = await view.webContents.capturePage(undefined, {
        stayHidden: true
      });
      if (
        revision !== this.overlayRevision ||
        this.view !== view ||
        this.window !== window ||
        !this.overlayVisible ||
        view.webContents.isDestroyed()
      )
        return { preview: null };
      const image = captured.resize({
        width: Math.min(1920, captured.getSize().width)
      });
      const preview = `data:image/jpeg;base64,${image.toJPEG(80).toString("base64")}`;
      return { preview: preview.length <= 8_000_000 ? preview : null };
    } catch {
      return { preview: null };
    }
  }

  private async applyAppearance(): Promise<void> {
    const window = this.window;
    const view = this.view;
    const revision = this.documentRevision;
    if (
      !window ||
      !view ||
      window.isDestroyed() ||
      view.webContents.isDestroyed() ||
      view.webContents.isLoadingMainFrame()
    )
      return;
    // Trusted fixed application CSS is installed by Main without relaxing the
    // review page's style-src 'self' policy or accepting renderer CSS payloads.
    if (!this.themeCss)
      this.themeCss = view.webContents.insertCSS(DESKTOP_REVIEW_THEME_CSS);
    await this.themeCss;
    if (
      this.window !== window ||
      this.view !== view ||
      revision !== this.documentRevision ||
      window.isDestroyed() ||
      view.webContents.isDestroyed()
    )
      return;
    await view.webContents.executeJavaScript(
      reviewAppearanceScript(this.themes.get(window.id), window.isFullScreen())
    );
  }

  private async changeFullscreen(target?: boolean): Promise<void> {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    try {
      if (target === undefined) await toggleWindowFullscreen(window);
      else await setWindowFullscreen(window, target);
      if (this.window === window) await this.applyAppearance();
    } catch {
      if (this.window !== window || this.view?.webContents.isDestroyed())
        return;
      console.warn("Review fullscreen transition failed.");
      await this.view?.webContents
        .executeJavaScript(
          `(() => {
          const toast = document.getElementById('toast');
          if (!toast) return;
          toast.textContent = '未能切换阅读全屏，请重试 F11 或退出按钮。';
          toast.hidden = false;
          setTimeout(() => { toast.hidden = true; }, 5000);
        })()`
        )
        .catch(() => {});
    }
  }

  private leaveFullscreen(): void {
    if (this.exitRequest) return;
    const request = this.changeFullscreen(false);
    this.exitRequest = request;
    void request.finally(() => {
      if (this.exitRequest === request) this.exitRequest = undefined;
    });
  }

  async show(window: BrowserWindow, bounds: Bounds | null): Promise<void> {
    if (!bounds) {
      this.hide();
      return;
    }
    this.requestedBounds = bounds;
    if (this.window !== window) {
      this.hide();
      this.window = window;
      window.on("resize", this.resize);
      this.stopFullscreen = onWindowFullscreenSettled(window, () => {
        if (this.window !== window) return;
        this.applyBounds();
        this.fullscreenChanged();
      });
      window.once("closed", () => {
        this.themes.delete(window.id);
        if (this.window === window) this.dispose();
      });
    }
    if (!this.view || this.view.webContents.isDestroyed()) {
      this.view = new WebContentsView({
        webPreferences: OTTER_REVIEW_WEB_PREFERENCES
      });
      this.themeCss = undefined;
      this.view.webContents.on(
        "did-start-navigation",
        (details, _url, inPlace, mainFrame) => {
          if (
            !(details.isMainFrame ?? mainFrame) ||
            (details.isSameDocument ?? inPlace)
          )
            return;
          this.documentRevision++;
          this.themeCss = undefined;
        }
      );
      this.view.webContents.on("did-finish-load", () => {
        this.fullscreenChanged();
      });
      // did-finish-load may precede the main-frame loading flag settling.
      // Retry at the settled event so navigation cannot drop the theme update.
      this.view.webContents.on("did-stop-loading", this.fullscreenChanged);
      // The sandboxed view can only request leaving fullscreen, never arbitrary IPC.
      this.view.webContents.on("will-navigate", (event, url) => {
        if (url === OTTER_REVIEW_EXIT_FULLSCREEN_URL) {
          event.preventDefault();
          this.leaveFullscreen();
        }
      });
      this.view.webContents.on("will-frame-navigate", (event) => {
        if (
          event.isMainFrame &&
          event.url === OTTER_REVIEW_EXIT_FULLSCREEN_URL
        ) {
          event.preventDefault();
          this.leaveFullscreen();
        }
      });
      constrainOtterReviewWebContents(this.view.webContents);
      this.view.webContents.on("before-input-event", (event, input) => {
        if (
          input.type !== "keyDown" ||
          !this.window ||
          this.window.isDestroyed()
        )
          return;
        if (input.key === "F11") {
          event.preventDefault();
          void this.changeFullscreen();
        } else if (input.key === "Escape" && this.window.isFullScreen()) {
          event.preventDefault();
          this.leaveFullscreen();
        }
      });
      // A review page never needs privileged downloads or attached guests.
      this.view.webContents.on("will-attach-webview", (event) =>
        event.preventDefault()
      );
      window.contentView.addChildView(this.view);
      this.applyBounds();
      await this.view.webContents.loadURL(OTTER_REVIEW_URL);
      await this.applyAppearance();
    } else {
      window.contentView.addChildView(this.view);
      this.applyBounds();
      await this.applyAppearance();
    }
  }

  private applyBounds(): void {
    if (!this.window || !this.view || !this.requestedBounds) return;
    const available = this.window.getContentBounds();
    const bounds = this.requestedBounds;
    const x = Math.min(bounds.x, Math.max(0, available.width - 1));
    const y = Math.min(bounds.y, Math.max(0, available.height - 1));
    this.view.setBounds({
      x,
      y,
      width: Math.max(1, Math.min(bounds.width, available.width - x)),
      height: Math.max(1, Math.min(bounds.height, available.height - y))
    });
    this.view.setVisible(!this.overlayVisible);
  }

  hide(): void {
    this.overlayRevision++;
    this.overlayVisible = false;
    this.view?.setVisible(false);
    if (this.window && !this.window.isDestroyed() && this.view) {
      this.window.contentView.removeChildView(this.view);
      this.window.removeListener("resize", this.resize);
    }
    this.stopFullscreen?.();
    this.stopFullscreen = undefined;
    this.window = undefined;
  }

  async reload(): Promise<void> {
    this.documentRevision++;
    this.themeCss = undefined;
    if (this.view && !this.view.webContents.isDestroyed())
      await this.view.webContents.loadURL(OTTER_REVIEW_URL);
    await this.applyAppearance();
  }

  contentsForSmoke() {
    if (process.env.DEEPWRITE_SMOKE !== "1")
      throw new Error("Review inspection requires an isolated smoke profile.");
    return this.view?.webContents;
  }

  dispose(): void {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed())
      this.view.webContents.close();
    this.view = undefined;
    this.themeCss = undefined;
    this.themes.clear();
  }
}
