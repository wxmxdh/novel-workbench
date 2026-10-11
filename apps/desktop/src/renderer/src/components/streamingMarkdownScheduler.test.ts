import { describe, expect, it, vi } from "vitest";
import {
  createStreamingMarkdownScheduler,
  STREAMING_MARKDOWN_BACKGROUND_FALLBACK_MS,
  STREAMING_MARKDOWN_RENDER_INTERVAL_MS,
  type StreamingMarkdownSchedulerRuntime
} from "./streamingMarkdownScheduler";

interface ScheduledCallback {
  callback: () => void;
  delayMs: number;
}

function createRuntimeFixture(): {
  runtime: StreamingMarkdownSchedulerRuntime;
  timerCount: () => number;
  frameCount: () => number;
  runTimer: (delayMs: number) => void;
  runFrame: () => void;
} {
  let nextHandle = 1;
  const timers = new Map<number, ScheduledCallback>();
  const frames = new Map<number, (timestamp: number) => void>();
  const runtime: StreamingMarkdownSchedulerRuntime = {
    setTimeout(callback, delayMs) {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    requestAnimationFrame(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    }
  };

  return {
    runtime,
    timerCount: () => timers.size,
    frameCount: () => frames.size,
    runTimer(delayMs) {
      const entry = [...timers.entries()].find(
        ([, scheduled]) => scheduled.delayMs === delayMs
      );
      if (!entry) throw new Error(`Missing ${delayMs}ms timer.`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
    runFrame() {
      const entry = frames.entries().next().value as
        [number, (timestamp: number) => void] | undefined;
      if (!entry) throw new Error("Missing animation frame.");
      frames.delete(entry[0]);
      entry[1](STREAMING_MARKDOWN_RENDER_INTERVAL_MS);
    }
  };
}

describe("streaming Markdown scheduler", () => {
  it("coalesces rapid deltas into one frame-aligned render", () => {
    const fixture = createRuntimeFixture();
    const render = vi.fn();
    const scheduler = createStreamingMarkdownScheduler(render, fixture.runtime);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    expect(fixture.timerCount()).toBe(2);
    expect(render).not.toHaveBeenCalled();
    fixture.runTimer(STREAMING_MARKDOWN_RENDER_INTERVAL_MS);
    expect(fixture.frameCount()).toBe(1);
    fixture.runFrame();
    expect(render).toHaveBeenCalledTimes(1);
    expect(fixture.timerCount()).toBe(0);

    scheduler.schedule();
    fixture.runTimer(STREAMING_MARKDOWN_RENDER_INTERVAL_MS);
    fixture.runFrame();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("renders through the fallback when animation frames are suspended", () => {
    const fixture = createRuntimeFixture();
    const render = vi.fn();
    const scheduler = createStreamingMarkdownScheduler(render, fixture.runtime);

    scheduler.schedule();
    fixture.runTimer(STREAMING_MARKDOWN_RENDER_INTERVAL_MS);
    expect(fixture.frameCount()).toBe(1);
    fixture.runTimer(STREAMING_MARKDOWN_BACKGROUND_FALLBACK_MS);

    expect(render).toHaveBeenCalledTimes(1);
    expect(fixture.frameCount()).toBe(0);
    expect(fixture.timerCount()).toBe(0);
  });

  it("flushes final content immediately and cancels pending work", () => {
    const fixture = createRuntimeFixture();
    const render = vi.fn();
    const scheduler = createStreamingMarkdownScheduler(render, fixture.runtime);

    scheduler.schedule();
    scheduler.flush();

    expect(render).toHaveBeenCalledTimes(1);
    expect(fixture.timerCount()).toBe(0);
    expect(fixture.frameCount()).toBe(0);

    scheduler.schedule();
    scheduler.dispose();
    scheduler.schedule();
    scheduler.flush();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
