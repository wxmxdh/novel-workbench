import { z } from "zod";

export const MarketplaceEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(320);
export const MarketplaceEmailCodeInputSchema = z
  .object({
    email: MarketplaceEmailSchema,
    purpose: z.enum(["register", "account"])
  })
  .strict();
export type MarketplaceEmailCodeInput = z.infer<
  typeof MarketplaceEmailCodeInputSchema
>;
export const MarketplaceEmailCodeResultSchema = z
  .object({
    expiresIn: z.number().int().positive().max(3600),
    retryAfter: z.number().int().positive().max(3600)
  })
  .strict();
export type MarketplaceEmailCodeResult = z.infer<
  typeof MarketplaceEmailCodeResultSchema
>;
export const MarketplaceBindEmailInputSchema = z
  .object({
    email: MarketplaceEmailSchema,
    emailCode: z
      .string()
      .trim()
      .regex(/^[0-9]{6}$/u)
  })
  .strict();
export type MarketplaceBindEmailInput = z.infer<
  typeof MarketplaceBindEmailInputSchema
>;
