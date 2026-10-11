import { describe, expect, it } from "vitest";
import { orderLongChapterNavigationItems } from "./orderLongChapterNavigationItems";

describe("orderLongChapterNavigationItems", () => {
  it("uses narrative order even when generated ids sort in the opposite order", () => {
    expect(
      orderLongChapterNavigationItems([
        { id: "chapter_16a05068", label: "第七章", narrativeOrder: 7 },
        { id: "chapter_5db50ad0", label: "第六章", narrativeOrder: 6 }
      ]).map(({ label }) => label)
    ).toEqual(["第六章", "第七章"]);
  });

  it("preserves source order for legacy items without explicit order", () => {
    const items = [
      { id: "chapter_second", label: "第二章", narrativeOrder: 2 },
      { id: "chapter_legacy", label: "旧章卡" },
      { id: "chapter_first", label: "第一章", narrativeOrder: 1 }
    ];
    expect(orderLongChapterNavigationItems(items)).toEqual(items);
  });
});
