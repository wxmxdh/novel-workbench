import { describe, expect, it } from "vitest";
import { createLongWorkspaceRefreshClock } from "./longWorkspaceRefresh";

describe("long workspace refresh coordination", () => {
  it("keeps request clocks isolated by book and rejects older requests", () => {
    const clock = createLongWorkspaceRefreshClock();
    const firstBookOne = clock.begin("book-one");
    const bookTwo = clock.begin("book-two");
    const secondBookOne = clock.begin("book-one");

    expect(clock.isCurrent("book-one", firstBookOne)).toBe(false);
    expect(clock.isCurrent("book-one", secondBookOne)).toBe(true);
    expect(clock.isCurrent("book-two", bookTwo)).toBe(true);

    clock.invalidate("book-two");
    expect(clock.isCurrent("book-two", bookTwo)).toBe(false);
  });
});
