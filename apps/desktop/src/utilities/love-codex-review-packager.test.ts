import { describe, expect, it } from "vitest";
import { prepareLoveCodexReview } from "./love-codex-review-packager";

describe("LOVE Codex review packager boundary", () => {
  it("rejects requests bound to another book before launching the packager", async () => {
    await expect(
      prepareLoveCodexReview({
        bookId: "longbook_other",
        scope: "chapter",
        sessionId: "session_1f834d31"
      })
    ).rejects.toThrow("仅对 LOVE 项目开放");
  });

  it.each(["../outside.md", "C:/outside.md", "/outside.md", "a//b.md"])(
    "rejects a target outside the project: %s",
    async (target) => {
      await expect(
        prepareLoveCodexReview({
          bookId: "longbook_9a146bbe",
          scope: "chapter",
          sessionId: "session_1f834d31",
          target
        })
      ).rejects.toThrow("项目内的相对文件路径");
    }
  );
});
