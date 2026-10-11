import { z } from "zod";

export const OtterProjectIdSchema = z.string().regex(/^otter_[a-f0-9]{16,64}$/);
export const OtterRelativePathSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (path) =>
      !/^(?:[a-z]:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)|[\x00-\x1f]/i.test(path),
    "A project-relative path is required."
  );
export const OtterContextRefSchema = z
  .object({
    projectId: OtterProjectIdSchema,
    contextPath: OtterRelativePathSchema,
    receiptPath: OtterRelativePathSchema.optional()
  })
  .strict();
export type OtterContextRef = z.infer<typeof OtterContextRefSchema>;

export const OtterProjectSchema = z
  .object({
    id: OtterProjectIdSchema,
    title: z.string().min(1),
    relativePath: OtterRelativePathSchema,
    hasProtocol: z.boolean(),
    identityScope: z.enum(["project", "device-local"])
  })
  .strict();

/** Main builds this from the live V1 executor. Renderer supplies only a reference. */
export const OtterRuntimeContextSchema = z
  .object({
    projectId: OtterProjectIdSchema,
    contextId: z.string().min(1).max(200),
    baselineHash: z.string().regex(/^[a-f0-9]{64}$/),
    comparisonBaselineHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    apiText: z.string().min(1).max(2_000_000)
  })
  .strict();
export type OtterRuntimeContext = z.infer<typeof OtterRuntimeContextSchema>;
