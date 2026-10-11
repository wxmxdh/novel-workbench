import { describe, expect, it } from "vitest";
import source from "./usePopupSelect.ts?raw";

describe("usePopupSelect", () => {
  it("scrolls the current option into view when the menu opens with a pointer", () => {
    expect(source).toContain("function revealSelectedOption");
    expect(source).toContain("scrollSelectedIntoView(");
    const openMenuStart = source.indexOf("async function openMenu");
    const openMenuEnd = source.indexOf("function closeMenu", openMenuStart);
    const openMenu = source.slice(openMenuStart, openMenuEnd);

    expect(openMenu).toContain("if (focusSelection)");
    expect(openMenu).toContain("focusOption(selectedEnabledIndex())");
    expect(openMenu).toContain("revealSelectedOption()");
  });
});
