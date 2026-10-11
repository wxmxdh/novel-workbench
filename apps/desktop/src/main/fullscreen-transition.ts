import type { BrowserWindow, WebContents } from "electron";

const FULLSCREEN_TIMEOUT_MS = 2_000;
const FULLSCREEN_POLL_MS = 25;
type FullscreenListener = (fullscreen: boolean) => void;

interface FullscreenRequest {
  target: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  pollTimer: ReturnType<typeof setTimeout> | undefined;
  timeoutTimer: ReturnType<typeof setTimeout> | undefined;
}

interface FullscreenCoordinator {
  window: BrowserWindow;
  contents: WebContents;
  active: FullscreenRequest | undefined;
  queue: FullscreenRequest[];
  listeners: Set<FullscreenListener>;
  lastObserved: boolean;
  closed: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClosed: () => void;
  onContentsDestroyed: () => void;
  detached: boolean;
}

const coordinators = new WeakMap<BrowserWindow, FullscreenCoordinator>();

function unavailable(window: BrowserWindow): boolean {
  if (window.isDestroyed()) return true;
  try {
    return window.webContents.isDestroyed();
  } catch {
    // Electron may invalidate the BrowserWindow.webContents getter at close.
    return true;
  }
}

function settleListeners(
  coordinator: FullscreenCoordinator,
  fullscreen: boolean
): void {
  if (fullscreen === coordinator.lastObserved) return;
  coordinator.lastObserved = fullscreen;
  for (const listener of coordinator.listeners) {
    try {
      listener(fullscreen);
    } catch (error) {
      console.error("Fullscreen state listener failed.", error);
    }
  }
}

function clearTimers(request?: FullscreenRequest): void {
  if (!request) return;
  if (request.pollTimer) clearTimeout(request.pollTimer);
  if (request.timeoutTimer) clearTimeout(request.timeoutTimer);
}

function detach(coordinator: FullscreenCoordinator): void {
  if (coordinator.detached) return;
  coordinator.detached = true;
  const { window } = coordinator;
  window.removeListener("enter-full-screen", coordinator.onEnter);
  window.removeListener("leave-full-screen", coordinator.onLeave);
  window.removeListener("closed", coordinator.onClosed);
  if (!coordinator.contents.isDestroyed())
    coordinator.contents.removeListener(
      "destroyed",
      coordinator.onContentsDestroyed
    );
  coordinators.delete(window);
}

function cancel(coordinator: FullscreenCoordinator): void {
  if (coordinator.closed) return;
  coordinator.closed = true;
  const error = new Error("窗口已关闭，已取消全屏切换。");
  clearTimers(coordinator.active);
  coordinator.active?.reject(error);
  coordinator.active = undefined;
  for (const request of coordinator.queue.splice(0)) request.reject(error);
  coordinator.listeners.clear();
  detach(coordinator);
}

function releaseIfIdle(coordinator: FullscreenCoordinator): void {
  if (coordinator.closed || coordinator.detached) return;
  if (
    !coordinator.active &&
    coordinator.queue.length === 0 &&
    coordinator.listeners.size === 0
  )
    detach(coordinator);
}

function makeCoordinator(window: BrowserWindow): FullscreenCoordinator {
  const contents = window.webContents;
  const coordinator: FullscreenCoordinator = {
    window,
    contents,
    active: undefined,
    queue: [],
    listeners: new Set<FullscreenListener>(),
    lastObserved: window.isFullScreen(),
    closed: false,
    detached: false,
    onEnter: () => undefined,
    onLeave: () => undefined,
    onClosed: () => undefined,
    onContentsDestroyed: () => undefined
  };
  const check = () => {
    const request = coordinator.active;
    if (!request) {
      if (!unavailable(window))
        settleListeners(coordinator, window.isFullScreen());
      return;
    }
    if (unavailable(window)) {
      cancel(coordinator);
      return;
    }
    if (window.isFullScreen() === request.target) {
      clearTimers(request);
      coordinator.active = undefined;
      settleListeners(coordinator, request.target);
      request.resolve();
      pump(coordinator);
      releaseIfIdle(coordinator);
      return;
    }
    if (!request.pollTimer)
      request.pollTimer = setTimeout(() => {
        request.pollTimer = undefined;
        check();
      }, FULLSCREEN_POLL_MS);
  };
  coordinator.onEnter = check;
  coordinator.onLeave = check;
  coordinator.onClosed = () => cancel(coordinator);
  coordinator.onContentsDestroyed = () => cancel(coordinator);
  window.on("enter-full-screen", coordinator.onEnter);
  window.on("leave-full-screen", coordinator.onLeave);
  window.once("closed", coordinator.onClosed);
  if (!contents.isDestroyed())
    contents.once("destroyed", coordinator.onContentsDestroyed);
  coordinators.set(window, coordinator);
  return coordinator;
}

function forWindow(window: BrowserWindow): FullscreenCoordinator {
  const existing = coordinators.get(window);
  return existing && !existing.closed ? existing : makeCoordinator(window);
}

function newRequest(target: boolean): FullscreenRequest {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Native event handlers can fire-and-forget; avoid unhandled cancellation errors.
  void promise.catch(() => undefined);
  return {
    target,
    promise,
    resolve,
    reject,
    pollTimer: undefined,
    timeoutTimer: undefined
  };
}

function pump(coordinator: FullscreenCoordinator): void {
  if (coordinator.closed || coordinator.active) return;
  const request = coordinator.queue.shift();
  if (!request) {
    releaseIfIdle(coordinator);
    return;
  }
  const { window } = coordinator;
  if (unavailable(window)) {
    request.reject(new Error("窗口已关闭，已取消全屏切换。"));
    cancel(coordinator);
    return;
  }
  coordinator.active = request;
  if (window.isFullScreen() === request.target) {
    coordinator.active = undefined;
    settleListeners(coordinator, request.target);
    request.resolve();
    pump(coordinator);
    releaseIfIdle(coordinator);
    return;
  }
  request.timeoutTimer = setTimeout(() => {
    if (coordinator.active !== request) return;
    if (!unavailable(window) && window.isFullScreen() === request.target) {
      coordinator.onEnter();
      return;
    }
    clearTimers(request);
    coordinator.active = undefined;
    request.reject(new Error("窗口全屏状态未能在 2 秒内完成。"));
    pump(coordinator);
  }, FULLSCREEN_TIMEOUT_MS);
  try {
    window.setFullScreen(request.target);
    // The native flag can change after return, with or without a lifecycle event.
    coordinator.onEnter();
  } catch (error) {
    clearTimers(request);
    coordinator.active = undefined;
    request.reject(
      error instanceof Error ? error : new Error("无法切换窗口全屏状态。")
    );
    pump(coordinator);
  }
}

function rejected(message: string): Promise<void> {
  const promise = Promise.reject(new Error(message));
  void promise.catch(() => undefined);
  return promise;
}

/** Resolve after the requested native state has actually been observed. */
export function setWindowFullscreen(
  window: BrowserWindow,
  enabled: boolean
): Promise<void> {
  if (unavailable(window)) return rejected("窗口已关闭，已取消全屏切换。");
  const coordinator = forWindow(window);
  const tail = coordinator.queue.at(-1) ?? coordinator.active;
  if (tail?.target === enabled) return tail.promise;
  if (!tail && window.isFullScreen() === enabled) {
    settleListeners(coordinator, enabled);
    releaseIfIdle(coordinator);
    return Promise.resolve();
  }
  const request = newRequest(enabled);
  coordinator.queue.push(request);
  pump(coordinator);
  return request.promise;
}

/** Toggle relative to the pending target, not a possibly stale native flag. */
export function toggleWindowFullscreen(window: BrowserWindow): Promise<void> {
  if (unavailable(window)) return rejected("窗口已关闭，已取消全屏切换。");
  const coordinator = forWindow(window);
  const tail = coordinator.queue.at(-1) ?? coordinator.active;
  return setWindowFullscreen(window, !(tail?.target ?? window.isFullScreen()));
}

/** Observe confirmed transitions and fullscreen changes made outside commands. */
export function onWindowFullscreenSettled(
  window: BrowserWindow,
  listener: FullscreenListener
): () => void {
  if (unavailable(window)) return () => undefined;
  const coordinator = forWindow(window);
  coordinator.listeners.add(listener);
  return () => {
    coordinator.listeners.delete(listener);
    releaseIfIdle(coordinator);
  };
}
