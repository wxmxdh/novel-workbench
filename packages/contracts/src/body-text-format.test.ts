import { describe, expect, it } from "vitest";
import { BodyTextFormatsSchema } from "./body-text-format";
import {
  createDefaultGeneralSettings,
  GeneralSettingsSchema
} from "./general-settings";

describe("body text format settings", () => {
  it("supplies missing preferences without replacing the existing view mode", () => {
    const { bodyTextFormats: _, ...legacy } = createDefaultGeneralSettings();
    expect(
      GeneralSettingsSchema.parse({ ...legacy, defaultTextViewMode: "preview" })
    ).toMatchObject({
      defaultTextViewMode: "preview",
      bodyTextFormats: {
        short: "flush-spaced",
        script: "flush-spaced",
        long: "flush-spaced"
      }
    });
    expect(BodyTextFormatsSchema.parse({ short: "indent-compact" })).toEqual({
      short: "indent-compact",
      script: "flush-spaced",
      long: "flush-spaced"
    });
  });
  it("validates all four independent choices", () => {
    for (const format of [
      "flush-compact",
      "flush-spaced",
      "indent-compact",
      "indent-spaced"
    ]) {
      expect(
        BodyTextFormatsSchema.parse({
          short: format,
          script: format,
          long: format
        }).short
      ).toBe(format);
    }
    expect(BodyTextFormatsSchema.safeParse({ short: "invalid" }).success).toBe(
      false
    );
  });
});
