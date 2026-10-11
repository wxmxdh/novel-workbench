import { z } from "zod";

/** Only non-sensitive colors cross into the isolated manuscript view. */
export const OTTER_REVIEW_COLOR_KEYS = [
  "paper",
  "paper-deep",
  "paper-light",
  "ink",
  "ink-light",
  "muted",
  "muted-light",
  "line",
  "line-strong",
  "coral",
  "coral-hover",
  "coral-light",
  "shadow",
  "shadow-md",
  "success",
  "success-light"
] as const;

const ColorSchema = z
  .string()
  .max(96)
  .regex(/^(#[0-9a-f]{3,8}|rgba?\([\d.,% /+-]+\))$/i);
export const OtterReviewThemeSchema = z
  .object({
    scheme: z.enum(["light", "dark"]),
    colors: z.record(z.enum(OTTER_REVIEW_COLOR_KEYS), ColorSchema)
  })
  .strict();
export type OtterReviewTheme = z.infer<typeof OtterReviewThemeSchema>;
