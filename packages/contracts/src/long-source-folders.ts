import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { LongBookIdSchema } from "./long-workspace/ids";
import {
  LongSourceAuthoritySchema,
  LongSourcePurposeSchema
} from "./long-workspace/sources";

const Id = z.string().min(1).max(256);
export const LongSourceFolderSchema = z
  .object({
    id: Id,
    title: z.string().min(1).max(256),
    rootPath: z.string().min(1).max(2048),
    connectedAt: z.string().datetime(),
    purpose: LongSourcePurposeSchema,
    authority: LongSourceAuthoritySchema,
    allowedFileIds: z.array(Id).min(1).max(500)
  })
  .strict();
export type LongSourceFolder = z.infer<typeof LongSourceFolderSchema>;
export const SourceFolderFileSchema = z
  .object({
    id: Id,
    relativePath: z.string().min(1).max(2048),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();
export const SourceFolderListingSchema = z
  .object({
    files: z.array(SourceFolderFileSchema).max(500),
    skipped: z
      .array(
        z.object({ relativePath: z.string(), reason: z.string() }).strict()
      )
      .max(1000),
    limited: z.boolean()
  })
  .strict();
export const LongChooseSourceFolderInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    suggestedPath: z.string().trim().min(1).max(2048).optional()
  })
  .strict();
export const LongSourceFolderPreviewSchema = SourceFolderListingSchema.extend({
  previewId: Id,
  bookId: LongBookIdSchema,
  title: z.string(),
  rootPath: z.string(),
  expiresAt: z.string().datetime()
}).strict();
export const LongConfirmSourceFolderInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    previewId: Id,
    mode: z.enum(["copy", "connect"]),
    fileIds: z.array(Id).min(1).max(500),
    purpose: LongSourcePurposeSchema,
    authority: LongSourceAuthoritySchema
  })
  .strict();
export const LongConfirmSourceFolderResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    mode: z.enum(["copy", "connect"]),
    folder: LongSourceFolderSchema.optional(),
    imported: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    failures: z.array(
      z.object({ relativePath: z.string(), reason: z.string() }).strict()
    )
  })
  .strict();
export const LongConnectSourceFolderAtPathInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    rootPath: z.string().min(1).max(2048),
    title: z.string().min(1).max(256),
    purpose: LongSourcePurposeSchema,
    authority: LongSourceAuthoritySchema,
    allowedFileIds: z.array(Id).min(1).max(500)
  })
  .strict();
export const LongQuerySourceFolderInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    sourceId: Id.optional(),
    fileId: Id.optional(),
    query: z.string().max(200).optional()
  })
  .strict();
export const LongQuerySourceFolderResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    folders: z.array(LongSourceFolderSchema),
    listing: SourceFolderListingSchema.optional(),
    document: z
      .object({
        fileId: Id,
        relativePath: z.string(),
        sha256: z.string(),
        content: z.string().max(2 * 1024 * 1024)
      })
      .strict()
      .optional()
  })
  .strict();
export const LongDisconnectSourceFolderInputSchema = z
  .object({ bookId: LongBookIdSchema, sourceId: Id })
  .strict();
export const LongSourceFolderCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("long.chooseSourceFolder"),
    payload: LongChooseSourceFolderInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("long.confirmSourceFolder"),
    payload: LongConfirmSourceFolderInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("long.connectSourceFolderAtPath"),
    payload: LongConnectSourceFolderAtPathInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("long.querySourceFolder"),
    payload: LongQuerySourceFolderInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("long.disconnectSourceFolder"),
    payload: LongDisconnectSourceFolderInputSchema
  })
] as const;
export type LongSourceFolderPreview = z.infer<
  typeof LongSourceFolderPreviewSchema
>;
export type LongConfirmSourceFolderInput = z.infer<
  typeof LongConfirmSourceFolderInputSchema
>;
export type LongConfirmSourceFolderResult = z.infer<
  typeof LongConfirmSourceFolderResultSchema
>;
export type LongQuerySourceFolderInput = z.infer<
  typeof LongQuerySourceFolderInputSchema
>;
export type LongQuerySourceFolderResult = z.infer<
  typeof LongQuerySourceFolderResultSchema
>;
