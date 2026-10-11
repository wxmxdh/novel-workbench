import { z } from "zod";
import {
  OtterContextRefSchema,
  OtterProjectIdSchema,
  OtterRelativePathSchema
} from "./otter-context";

/** A local, user-run external review. This never starts an agent or network call. */
export const OtterManualHandoffInputSchema = z
  .object({
    projectId: OtterProjectIdSchema,
    context: OtterContextRefSchema.optional(),
    sources: z.array(OtterRelativePathSchema).max(30).default([]),
    instructions: z.string().max(20_000).default("")
  })
  .strict()
  .refine(
    (value) => value.context !== undefined || value.sources.length > 0,
    "Choose a verified V1 Context or explicitly select at least one source."
  );

export const OtterManualHandoffResultSchema = z
  .object({
    handoffId: z.string().regex(/^[a-f0-9-]{36}$/),
    directory: z.string().min(1),
    prompt: z.string().min(1).max(40_000),
    reportPath: z.string().min(1),
    sourceSummary: z
      .array(
        z.object({ path: OtterRelativePathSchema, title: z.string() }).strict()
      )
      .max(40)
  })
  .strict();

export const OtterManualReportInputSchema = z
  .object({
    handoffId: z.string().regex(/^[a-f0-9-]{36}$/)
  })
  .strict();

export const OtterManualReportSchema = z
  .object({
    handoffId: z.string().regex(/^[a-f0-9-]{36}$/),
    status: z.enum(["pending", "stale", "no-report"]),
    markdown: z.string().max(250_000).nullable(),
    updatedAt: z.string().nullable()
  })
  .strict();

export type OtterManualHandoffInput = z.infer<
  typeof OtterManualHandoffInputSchema
>;
export type OtterManualHandoffResult = z.infer<
  typeof OtterManualHandoffResultSchema
>;
export type OtterManualReportInput = z.infer<
  typeof OtterManualReportInputSchema
>;
export type OtterManualReport = z.infer<typeof OtterManualReportSchema>;
