import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTransientScrollbarController,
  TRANSIENT_SCROLLBAR_ACTIVE_CLASS
} from "./transientScrollbar";

function createElement(): HTMLElement {
  const classes = new Set<string>();
  return {
    classList: {
      add: (...tokens: string[]) =>
        tokens.forEach((token) => classes.add(token)),
      remove: (...tokens: string[]) =>
        tokens.forEach((token) => classes.delete(token)),
      contains: (token: string) => classes.has(token)
    }
  } as unknown as HTMLElement;
}

describe("createTransientScrollbarController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the scrollbar visible while scrolling and hides it after inactivity", () => {
    vi.useFakeTimers();
    const element = createElement();
    const controller = createTransientScrollbarController(800);

    controller.reveal(element);
    expect(element.classList.contains(TRANSIENT_SCROLLBAR_ACTIVE_CLASS)).toBe(
      true
    );

    vi.advanceTimersByTime(600);
    controller.reveal(element);
    vi.advanceTimersByTime(799);
    expect(element.classList.contains(TRANSIENT_SCROLLBAR_ACTIVE_CLASS)).toBe(
      true
    );

    vi.advanceTimersByTime(1);
    expect(element.classList.contains(TRANSIENT_SCROLLBAR_ACTIVE_CLASS)).toBe(
      false
    );
  });

  it("clears the active state when disposed", () => {
    vi.useFakeTimers();
    const element = createElement();
    const controller = createTransientScrollbarController();

    controller.reveal(element);
    controller.dispose();

    expect(element.classList.contains(TRANSIENT_SCROLLBAR_ACTIVE_CLASS)).toBe(
      false
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
