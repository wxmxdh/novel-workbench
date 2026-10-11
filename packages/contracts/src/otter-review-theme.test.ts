import { describe, expect, it } from "vitest";
import {
  OTTER_REVIEW_COLOR_KEYS,
  OtterReviewThemeSchema
} from "./otter-review-theme";

const theme = {
  scheme: "light",
  colors: Object.fromEntries(
    OTTER_REVIEW_COLOR_KEYS.map((key) => [key, "#f2eee7"])
  )
};
describe("isolated manuscript theme boundary", () => {
  it("accepts resolved hexadecimal and rgba palette colors", () => {
    expect(OtterReviewThemeSchema.parse(theme).scheme).toBe("light");
    expect(
      OtterReviewThemeSchema.parse({
        ...theme,
        colors: { ...theme.colors, line: "rgba(98, 81, 63, .13)" }
      }).colors.line
    ).toContain("rgba");
  });
  it("rejects extra fields and CSS containing URLs or declarations", () => {
    expect(
      OtterReviewThemeSchema.safeParse({
        ...theme,
        apiKey: "invalid-fixture-key"
      }).success
    ).toBe(false);
    for (const line of [
      "url(https://example.test/)",
      "#fff; background:red",
      "var(--secret)"
    ]) {
      expect(
        OtterReviewThemeSchema.safeParse({
          ...theme,
          colors: { ...theme.colors, line }
        }).success
      ).toBe(false);
    }
    expect(
      OtterReviewThemeSchema.safeParse({
        ...theme,
        colors: { ...theme.colors, extra: "#fff" }
      }).success
    ).toBe(false);
  });
});
