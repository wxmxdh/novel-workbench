import { describe, expect, it } from "vitest";
import {
  canonicalBookConversationKey,
  longBookConversationKey,
  longChapterConversationKey,
  longStageConversationKey,
  shortBookConversationKey
} from "./bookConversationKey";

describe("book conversation keys", () => {
  it("keeps the old long shared conversation address stable", () => {
    expect(longBookConversationKey("书:一")).toBe(
      "long:%E4%B9%A6%3A%E4%B8%80:chat"
    );
  });

  it("builds distinct stage and chapter addresses", () => {
    expect(longStageConversationKey("book-one", "draft")).toBe(
      "long:book-one:stage:draft"
    );
    expect(longChapterConversationKey("book-one", "第1章:雨夜")).toBe(
      "long:book-one:chapter:%E7%AC%AC1%E7%AB%A0%3A%E9%9B%A8%E5%A4%9C"
    );
    expect(longChapterConversationKey("book-one", "chapter-two")).not.toBe(
      longChapterConversationKey("book-one", "chapter-one")
    );
  });

  it("canonicalizes only short book lanes and leaves long history addresses intact", () => {
    expect(
      canonicalBookConversationKey("book-one:plot_design", "book:book-one")
    ).toBe(shortBookConversationKey("book-one"));
    expect(
      canonicalBookConversationKey(
        "long:book-one:draft:__book__",
        "long:book-one"
      )
    ).toBe("long:book-one:draft:__book__");
    expect(
      canonicalBookConversationKey(
        "long:book-one:chapter:chapter-one",
        "long:book-one:chapter:chapter-one"
      )
    ).toBe("long:book-one:chapter:chapter-one");
  });
});
