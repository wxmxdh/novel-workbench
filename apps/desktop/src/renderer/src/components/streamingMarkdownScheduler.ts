export const STREAMING_MARKDOWN_RENDER_INTERVAL_MS = 60;
export const STREAMING_MARKDOWN_BACKGROUND_FALLBACK_MS = 120;

export interface StreamingMarkdownSchedulerRuntime {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame:
    ((callback: (timestamp: number) => void) => number) | undefined;
  cancelAnimationFrame: ((handle: number) => void) | undefined;
}

export interface StreamingMarkdownScheduler {
  schedule(): void;
  flush(): void;
  dispose(): void;
}

function defaultRuntime(): StreamingMarkdownSchedulerRuntime {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    requestAnimationFrame:
      typeof globalThis.requestAnimationFrame === "function"
        ? (callback) => globalThis.requestAnimationFrame(callback)
        : undefined,
    cancelAnimationFrame:
      typeof globalThis.cancelAnimationFrame === "function"
        ? (handle) => globalThis.cancelAnimationFrame(handle)
        : undefined
  };
}

export function createStreamingMarkdownScheduler(
  render: () => void,
  runtime: StreamingMarkdownSchedulerRuntime = defaultRuntime()
): StreamingMarkdownScheduler {
  let delayTimer: number | undefined;
  let fallbackTimer: number | undefined;
  let frameHandle: number | undefined;
  let disposed = false;

  function cancelPending(): void {
    if (delayTimer !== undefined) {
      runtime.clearTimeout(delayTimer);
      delayTimer = undefined;
    }
    if (fallbackTimer !== undefined) {
      runtime.clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
    if (frameHandle !== undefined) {
      runtime.cancelAnimationFrame?.(frameHandle);
      frameHandle = undefined;
    }
  }

  function renderLatest(): void {
    cancelPending();
    if (!disposed) render();
  }

  function queueRenderFrame(): void {
    delayTimer = undefined;
    if (disposed) return;
    if (!runtime.requestAnimationFrame) {
      renderLatest();
      return;
    }
    frameHandle = runtime.requestAnimationFrame(() => {
      frameHandle = undefined;
      if (fallbackTimer !== undefined) {
        runtime.clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      }
      if (!disposed) render();
    });
  }

  function schedule(): void {
    if (
      disposed ||
      delayTimer !== undefined ||
      fallbackTimer !== undefined ||
      frameHandle !== undefined
    ) {
      return;
    }
    delayTimer = runtime.setTimeout(
      queueRenderFrame,
      STREAMING_MARKDOWN_RENDER_INTERVAL_MS
    );
    fallbackTimer = runtime.setTimeout(
      renderLatest,
      STREAMING_MARKDOWN_BACKGROUND_FALLBACK_MS
    );
  }

  function flush(): void {
    if (disposed) return;
    renderLatest();
  }

  function dispose(): void {
    cancelPending();
    disposed = true;
  }

  return { schedule, flush, dispose };
}
