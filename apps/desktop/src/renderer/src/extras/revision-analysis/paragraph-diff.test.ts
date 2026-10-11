import { describe, expect, it } from "vitest";
import { compareRevisionParagraphs } from "./paragraph-diff";
describe("revision paragraph comparison", () => {
  it("ignores blank lines and newline conventions, preserving meaningful spacing", () => {
    expect(compareRevisionParagraphs("甲\r\n\r\n乙", "甲\n乙\n")).toEqual([]);
    expect(compareRevisionParagraphs("甲 乙", "甲乙")).toMatchObject([
      { before: "甲 乙", after: "甲乙" }
    ]);
  });
  it("groups replacements, insertions and deletions with source line positions", () => {
    const changes = compareRevisionParagraphs(
      "开头\n旧句\n相同\n删除\n结尾",
      "开头\n新句\n相同\n结尾\n新增"
    );
    expect(changes).toMatchObject([
      { before: "旧句", after: "新句", beforeStart: 2, afterStart: 2 },
      { before: "删除", after: "", beforeStart: 4, afterStart: 0 },
      { before: "", after: "新增", beforeStart: 0, afterStart: 5 }
    ]);
  });
  it("handles split, merged and moved paragraphs without losing changed text", () => {
    expect(
      compareRevisionParagraphs("开头\n甲乙\n结尾", "开头\n甲\n乙\n结尾")
    ).toMatchObject([{ before: "甲乙", after: "甲\n乙" }]);
    expect(compareRevisionParagraphs("甲\n乙", "甲乙")).toMatchObject([
      { before: "甲\n乙", after: "甲乙" }
    ]);
    const moved = compareRevisionParagraphs("甲\n乙\n丙", "乙\n甲\n丙");
    expect(moved.some((c) => !c.before)).toBe(true);
    expect(moved.some((c) => !c.after)).toBe(true);
  });
  it("retains only uniquely matched reasons and stable ids", () => {
    const original = compareRevisionParagraphs("甲\n旧\n尾", "甲\n新\n尾");
    original[0]!.reason = "更准确";
    const shifted = compareRevisionParagraphs(
      "首\n甲\n旧\n尾",
      "首\n甲\n新\n尾",
      original
    );
    expect(shifted[0]).toMatchObject({
      id: original[0]!.id,
      reason: "更准确",
      beforeStart: 3
    });
    expect(
      compareRevisionParagraphs("旧", "新", [
        ...original,
        { ...original[0]!, id: "duplicate" }
      ])[0]!.reason
    ).toBe("");
    const repeated = compareRevisionParagraphs(
      "旧\n间隔\n旧",
      "新\n间隔\n新",
      original
    );
    expect(repeated.map((c) => c.reason)).toEqual(["", ""]);
  });
  it("falls back to an intact coarse replacement for large unrelated documents", () => {
    const left = Array.from({ length: 1800 }, (_, i) => `旧段${i}`).join("\n");
    const right = Array.from({ length: 1800 }, (_, i) => `新段${i}`).join("\n");
    expect(
      compareRevisionParagraphs(`首\n${left}\n尾`, `首\n${right}\n尾`)
    ).toMatchObject([{ before: left, after: right, coarse: true }]);
  });
  it("can reconstruct arbitrary after paragraphs using all returned changes", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed;
    };
    for (let test = 0; test < 150; test++) {
      const before = Array.from(
        { length: (rand() % 20) + 1 },
        () => `段${rand() % 7}`
      );
      const after = Array.from(
        { length: (rand() % 20) + 1 },
        () => `段${rand() % 7}`
      );
      const changes = compareRevisionParagraphs(
        before.join("\n"),
        after.join("\n")
      );
      // Remove changed old paragraphs, then insert changed new paragraphs at their final positions.
      const result = [...before];
      for (const c of [...changes].reverse())
        if (c.before)
          result.splice(c.beforeStart - 1, c.before.split("\n").length);
      for (const c of changes)
        if (c.after) result.splice(c.afterStart - 1, 0, ...c.after.split("\n"));
      expect(result).toEqual(after);
    }
  });
});
