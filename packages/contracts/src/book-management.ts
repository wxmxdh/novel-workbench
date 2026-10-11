import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
export const HiddenBookSchema = z
  .object({
    id: z.string().min(1).max(256),
    kind: z.enum(["native", "external"]),
    title: z.string(),
    projectDirectory: z.string(),
    workspaceRoot: z.string().optional(),
    deletePending: z.boolean().optional(),
    deleteQuarantineDirectory: z.string().min(1).max(2048).optional(),
    identitySha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    hiddenAt: z.string().datetime()
  })
  .strict();
export type HiddenBook = z.infer<typeof HiddenBookSchema>;
export const HiddenBooksSchema = z.array(HiddenBookSchema).max(1000);
export const ExternalBookManagementInputSchema = z
  .object({
    projectId: z.string().regex(/^otter_[a-f0-9]{16,64}$/u),
    action: z.enum(["hide", "delete"]),
    expectedProjectDirectory: z.string().min(1).max(2048),
    expectedIdentitySha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    workspaceRoot: z.string().min(1).max(2048).optional()
  })
  .strict();
export type ExternalBookManagementInput = z.infer<
  typeof ExternalBookManagementInputSchema
>;
export const RestoreBookInputSchema = z
  .object({
    id: z.string().min(1).max(256),
    kind: z.enum(["native", "external"]),
    expectedProjectDirectory: z.string().min(1).max(2048),
    expectedIdentitySha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    workspaceRoot: z.string().min(1).max(2048).optional()
  })
  .strict();
export type RestoreBookInput = z.infer<typeof RestoreBookInputSchema>;
export const BookManagementResultSchema = z
  .object({
    bookId: z.string(),
    removed: z.boolean(),
    action: z.enum(["hide", "delete", "restore"])
  })
  .strict();
export const BookManagementCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("books.hidden"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("books.restore"),
    payload: RestoreBookInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("books.describeExternal"),
    payload: z
      .object({ projectId: z.string().regex(/^otter_[a-f0-9]{16,64}$/u) })
      .strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("books.removeExternal"),
    payload: ExternalBookManagementInputSchema
  })
] as const;
