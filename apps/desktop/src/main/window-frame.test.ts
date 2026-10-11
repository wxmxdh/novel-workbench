import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { createEnvelope, WindowFrameCommandSchema } from "@deepwrite/contracts";
import {
  installWindowFrame,
  onWindowFullscreenSettled,
  setWindowFullscreen,
  toggleWindowFullscreen
} from "./window-frame";
import { guardConversationWindowClose } from "./conversation-window-close";

vi.mock("electron", () => ({ app: { quit: vi.fn() } }));
function fixture() {
  let handler: (sender: IpcMainInvokeEvent, raw: unknown) => unknown;
  let contentsDestroyed = false;
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => contentsDestroyed,
    send: vi.fn(),
    ipc: {
      handle: vi.fn((_channel, callback) => {
        handler = callback;
      }),
      removeHandler: vi.fn()
    }
  });
  let maximized = false;
  let fullscreen = false;
  let destroyed = false;
  let setFullscreenState = (value: boolean) => {
    fullscreen = value;
    window.emit(value ? "enter-full-screen" : "leave-full-screen");
  };
  const window = Object.assign(new EventEmitter(), {
    get webContents() {
      if (destroyed) throw new TypeError("Object has been destroyed");
      return contents;
    },
    isDestroyed: () => destroyed,
    isMaximized: () => maximized,
    isFullScreen: () => fullscreen,
    maximize: vi.fn(() => {
      maximized = true;
      window.emit("maximize");
    }),
    unmaximize: vi.fn(() => {
      maximized = false;
      window.emit("unmaximize");
    }),
    setFullScreen: vi.fn((value: boolean) => {
      setFullscreenState(value);
    }),
    minimize: vi.fn(),
    close: vi.fn(() => {
      let prevented = false;
      window.emit("close", {
        preventDefault: () => {
          prevented = true;
        }
      });
      if (!prevented) destroyed = true;
    })
  });
  installWindowFrame(window as unknown as BrowserWindow);
  const sender = {
    sender: contents,
    senderFrame: contents.mainFrame
  } as unknown as IpcMainInvokeEvent;
  const command = (action: string, source = sender) =>
    handler(
      source,
      createEnvelope("windowFrame.command", { action }, { id: "cmd_test" })
    );
  return {
    window,
    contents,
    command,
    sender,
    destroyWindow: () => {
      destroyed = true;
      window.emit("closed");
    },
    destroyContents: () => {
      contentsDestroyed = true;
      contents.emit("destroyed");
    },
    setFullscreenStateHandler: (handler: (value: boolean) => void) => {
      setFullscreenState = handler;
    }
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => vi.clearAllMocks());
describe("window frame boundary and lifecycle", () => {
  it("rejects unknown actions, malformed envelopes and guest/subframe senders", async () => {
    const f = fixture();
    await expect(f.command("destroy")).rejects.toThrow();
    expect(
      WindowFrameCommandSchema.safeParse({ payload: { action: "close" } })
        .success
    ).toBe(false);
    await expect(
      f.command("close", { ...f.sender, senderFrame: {} } as IpcMainInvokeEvent)
    ).rejects.toThrow("Untrusted");
    await expect(
      f.command("close", { ...f.sender, sender: {} } as IpcMainInvokeEvent)
    ).rejects.toThrow("Untrusted");
    expect(f.window.close).not.toHaveBeenCalled();
  });
  it("uses native minimize/maximize/fullscreen and publishes native changes", async () => {
    const f = fixture();
    await f.command("minimize");
    expect(f.window.minimize).toHaveBeenCalledOnce();
    await f.command("toggleMaximize");
    expect(f.window.isMaximized()).toBe(true);
    expect(f.contents.send.mock.lastCall?.[1].payload.maximized).toBe(true);
    await f.command("toggleMaximize");
    expect(f.window.isMaximized()).toBe(false);
    await f.command("toggleFullscreen");
    expect(f.contents.send.mock.lastCall?.[1].payload.fullscreen).toBe(true);
    await f.command("toggleMaximize");
    expect(f.window.isFullScreen()).toBe(true);
    expect(f.window.isMaximized()).toBe(false);
    await f.command("toggleFullscreen");
    expect(f.contents.send.mock.lastCall?.[1].payload.fullscreen).toBe(false);
  });
  it("waits for the existing close guard to save and does not bypass cancellation", async () => {
    const f = fixture();
    let resolveSave!: () => void;
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );
    guardConversationWindowClose(f.window, {
      skip: () => false,
      flush,
      onError: vi.fn()
    });
    await f.command("close");
    await tick();
    expect(flush).toHaveBeenCalledOnce();
    expect(f.window.isDestroyed()).toBe(false);
    resolveSave();
    await tick();
    expect(f.window.isDestroyed()).toBe(true);
  });
  it("keeps the window open when saving fails and routes quit through app.quit", async () => {
    const f = fixture();
    const onError = vi.fn();
    guardConversationWindowClose(f.window, {
      skip: () => false,
      flush: async () => {
        throw new Error("save failed");
      },
      onError
    });
    f.command("close");
    await tick();
    expect(onError).toHaveBeenCalledOnce();
    expect(f.window.isDestroyed()).toBe(false);
    await f.command("quit");
    await tick();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("waits for a delayed native flag when the platform emits no fullscreen event", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.setFullscreenStateHandler((value) => {
        setTimeout(() => {
          (f.window as unknown as { isFullScreen(): boolean }).isFullScreen =
            () => value;
        }, 40);
      });
      const settled = vi.fn();
      const unsubscribe = onWindowFullscreenSettled(f.window as never, settled);
      const transition = f.command("toggleFullscreen") as Promise<{
        payload: { fullscreen: boolean };
      }>;
      let complete = false;
      void transition.then(() => (complete = true));
      await vi.advanceTimersByTimeAsync(25);
      expect(complete).toBe(false);
      // The fixture's state reader is deliberately delayed independently from
      // the method return and no native event is emitted.
      await vi.advanceTimersByTimeAsync(40);
      await transition;
      expect(complete).toBe(true);
      expect(f.contents.send.mock.lastCall?.[1].payload.fullscreen).toBe(true);
      expect(settled).toHaveBeenCalledTimes(1);
      expect(settled).toHaveBeenLastCalledWith(true);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a fullscreen transition on bounded timeout and removes listeners", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.setFullscreenStateHandler(() => undefined);
      const transition = setWindowFullscreen(f.window as never, true);
      const rejected = expect(transition).rejects.toThrow("2 秒");
      await vi.advanceTimersByTimeAsync(2_100);
      await rejected;
      // The installed window-frame subscriber remains until window close;
      // only the timed transition itself must no longer hold extra listeners.
      expect(f.window.listenerCount("enter-full-screen")).toBe(1);
      expect(f.window.listenerCount("leave-full-screen")).toBe(1);
      f.window.emit("closed");
      expect(f.window.listenerCount("enter-full-screen")).toBe(0);
      expect(f.window.listenerCount("leave-full-screen")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles only once when both native fullscreen events arrive", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.setFullscreenStateHandler((value) => {
        setTimeout(() => {
          (f.window as unknown as { isFullScreen(): boolean }).isFullScreen =
            () => value;
          f.window.emit("enter-full-screen");
          f.window.emit("leave-full-screen");
        }, 20);
      });
      const settled = vi.fn();
      const unsubscribe = onWindowFullscreenSettled(f.window as never, settled);
      const transition = setWindowFullscreen(f.window as never, true);
      await vi.advanceTimersByTimeAsync(25);
      await transition;
      expect(settled).toHaveBeenCalledTimes(1);
      expect(settled).toHaveBeenCalledWith(true);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates concurrent requests for the same target", async () => {
    const f = fixture();
    const settled = vi.fn();
    const unsubscribe = onWindowFullscreenSettled(f.window as never, settled);
    const first = setWindowFullscreen(f.window as never, true);
    const second = setWindowFullscreen(f.window as never, true);
    await Promise.all([first, second]);
    expect(f.window.setFullScreen).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("queues quick toggles against the pending target and reaches the latest target", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      const requested: boolean[] = [];
      f.setFullscreenStateHandler((value) => {
        requested.push(value);
        setTimeout(() => {
          (f.window as unknown as { isFullScreen(): boolean }).isFullScreen =
            () => value;
        }, 40);
      });
      const first = toggleWindowFullscreen(f.window as never);
      const second = toggleWindowFullscreen(f.window as never);
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all([first, second]);
      expect(requested).toEqual([true, false]);
      expect(f.window.isFullScreen()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels transitions and queued work when the window closes", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.setFullscreenStateHandler(() => undefined);
      const first = setWindowFullscreen(f.window as never, true);
      const second = setWindowFullscreen(f.window as never, false);
      const firstRejected = expect(first).rejects.toThrow("关闭");
      const secondRejected = expect(second).rejects.toThrow("关闭");
      f.destroyWindow();
      await Promise.all([firstRejected, secondRejected]);
      await vi.advanceTimersByTimeAsync(2_100);
      expect(f.window.listenerCount("enter-full-screen")).toBe(0);
      expect(f.window.listenerCount("leave-full-screen")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not touch BrowserWindow.webContents after the window is destroyed or unsubscribe twice", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      const unsubscribe = onWindowFullscreenSettled(f.window as never, vi.fn());
      f.destroyWindow();
      expect(() => unsubscribe()).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();
      expect(f.window.listenerCount("enter-full-screen")).toBe(0);
      expect(f.window.listenerCount("leave-full-screen")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues queued work after the active transition times out", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.setFullscreenStateHandler(() => undefined);
      const first = setWindowFullscreen(f.window as never, true);
      const second = setWindowFullscreen(f.window as never, false);
      const firstRejected = expect(first).rejects.toThrow("2 秒");
      await vi.advanceTimersByTimeAsync(2_100);
      await firstRejected;
      await expect(second).resolves.toBeUndefined();
      expect(f.window.setFullScreen).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels active and queued requests when the host webContents is destroyed", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.setFullscreenStateHandler(() => undefined);
      const first = setWindowFullscreen(f.window as never, true);
      const second = setWindowFullscreen(f.window as never, false);
      const firstRejected = expect(first).rejects.toThrow("关闭");
      const secondRejected = expect(second).rejects.toThrow("关闭");
      f.destroyContents();
      await Promise.all([firstRejected, secondRejected]);
      await vi.advanceTimersByTimeAsync(2_100);
      expect(f.window.listenerCount("enter-full-screen")).toBe(0);
      expect(f.window.listenerCount("leave-full-screen")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
