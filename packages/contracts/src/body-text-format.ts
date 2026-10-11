import { z } from "zod";

export const BodyTextFormatSchema = z.enum([
  "flush-compact",
  "flush-spaced",
  "indent-compact",
  "indent-spaced"
]);
export type BodyTextFormat = z.infer<typeof BodyTextFormatSchema>;

export const BodyTextFormatsSchema = z.object({
  short: BodyTextFormatSchema.default("flush-spaced"),
  script: BodyTextFormatSchema.default("flush-spaced"),
  long: BodyTextFormatSchema.default("flush-spaced")
});
export type BodyTextFormats = z.infer<typeof BodyTextFormatsSchema>;
export type BodyTextKind = keyof BodyTextFormats;
export interface BodyTextFormatChange {
  kind: BodyTextKind;
  format: BodyTextFormat;
}
export function createDefaultBodyTextFormats(): BodyTextFormats {
  return {
    short: "flush-spaced",
    script: "flush-spaced",
    long: "flush-spaced"
  };
}
