import { z } from "zod";
import { LongBookIdSchema, LongMarkdownFileReferenceSchema } from "./ids";
import { LongTimestampSchema, LongTitleSchema } from "./primitives";

export const LongSourcePurposeSchema = z.enum([
  "foundation",
  "character",
  "outline",
  "discussion",
  "reference",
  "other"
]);
export type LongSourcePurpose = z.infer<typeof LongSourcePurposeSchema>;

/** These are source-handling states, never canon/confirmation states. */
export const LongSourceAuthoritySchema = z.enum([
  "candidate",
  "undecided",
  "reference"
]);
export type LongSourceAuthority = z.infer<typeof LongSourceAuthoritySchema>;

export type LongSourceImportIntent =
  { kind: "attach-source" } | { kind: "save-discussion-outline" } | undefined;

/** A single cross-process intent rule used by the native renderer and Pi runtime. */
export function detectLongSourceImportIntent(
  message: string
): LongSourceImportIntent {
  const normalized = message.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  if (
    /(?:不要|不必|先别|不用).{0,8}(?:导入|接入|纳入|保存|连接)/u.test(
      normalized
    )
  )
    return undefined;
  if (
    /(?:连接|接入|导入).{0,24}(?:文件夹|资料库)|(?:文件夹|资料库).{0,24}(?:连接|接入|导入)/u.test(
      normalized
    )
  )
    return { kind: "attach-source" };
  if (
    /(?:保存|整理|提炼|生成).{0,16}(?:本次讨论|这次讨论|当前讨论|聊天记录|对话).{0,12}(?:候选)?大纲/u.test(
      normalized
    ) ||
    /(?:把|将).{0,16}(?:本次讨论|这次讨论|当前讨论|聊天记录|对话).{0,16}保存为.{0,8}(?:候选)?大纲/u.test(
      normalized
    )
  ) {
    return { kind: "save-discussion-outline" };
  }
  if (
    /(?:导入|接入|纳入|作为.{0,8}资料|存入.{0,8}资料).{0,24}(?:资料|总稿|人设|人物|大纲|素材|文件|本书|新书)/u.test(
      normalized
    ) ||
    /(?:资料|总稿|人设|人物|大纲|素材|文件).{0,20}(?:导入|接入|纳入|存入本书|接到新书)/u.test(
      normalized
    )
  ) {
    return { kind: "attach-source" };
  }
  return undefined;
}

export const LongImportedSourceSchema = z
  .object({
    id: z.string().regex(/^source_[a-z0-9][a-z0-9_-]{0,120}$/u),
    title: LongTitleSchema,
    sourceName: z.string().trim().min(1).max(1_024),
    /** User-supplied label only; it does not assert that the file was verified. */
    sourcePath: z.string().trim().min(1).max(2_048).optional(),
    purpose: LongSourcePurposeSchema,
    authority: LongSourceAuthoritySchema,
    purposeNote: z.string().trim().min(1).max(4000).optional(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    importedAt: LongTimestampSchema,
    file: LongMarkdownFileReferenceSchema
  })
  .strict();
export type LongImportedSource = z.infer<typeof LongImportedSourceSchema>;

export const LongStageSourceImportInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    title: LongTitleSchema,
    sourceName: z.string().trim().min(1).max(1_024),
    sourcePath: z.string().trim().min(1).max(2_048).optional(),
    content: z
      .string()
      .min(1, "资料不能为空")
      .max(2 * 1024 * 1024)
      .refine((value) => value.trim().length > 0, "资料不能为空"),
    purpose: LongSourcePurposeSchema,
    authority: LongSourceAuthoritySchema,
    purposeNote: z.string().trim().min(1).max(4000).optional(),
    expectedIndexUpdatedAt: LongTimestampSchema
  })
  .strict();
export type LongStageSourceImportInput = z.infer<
  typeof LongStageSourceImportInputSchema
>;

export const LongStageSourceImportResultSchema = z
  .object({
    previewId: z.string().trim().min(1).max(256),
    expiresAt: LongTimestampSchema,
    bookId: LongBookIdSchema,
    title: LongTitleSchema,
    sourceName: z.string().trim().min(1).max(1_024),
    sourcePath: z.string().trim().min(1).max(2_048).optional(),
    content: z
      .string()
      .min(1, "资料不能为空")
      .max(2 * 1024 * 1024)
      .refine((value) => value.trim().length > 0, "资料不能为空"),
    purpose: LongSourcePurposeSchema,
    authority: LongSourceAuthoritySchema,
    purposeNote: z.string().trim().min(1).max(4000).optional(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();
export type LongStageSourceImportResult = z.infer<
  typeof LongStageSourceImportResultSchema
>;

export const LongConfirmSourceImportInputSchema = z
  .object({
    bookId: LongBookIdSchema,
    previewId: z.string().trim().min(1).max(256)
  })
  .strict();
export type LongConfirmSourceImportInput = z.infer<
  typeof LongConfirmSourceImportInputSchema
>;

export const LongImportSourceInputSchema = LongStageSourceImportInputSchema;
export type LongImportSourceInput = LongStageSourceImportInput;

export const LongImportSourceResultSchema = z
  .object({
    bookId: LongBookIdSchema,
    source: LongImportedSourceSchema
  })
  .strict();
export type LongImportSourceResult = z.infer<
  typeof LongImportSourceResultSchema
>;
