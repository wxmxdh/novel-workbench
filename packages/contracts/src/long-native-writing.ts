import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import { LongBookIdSchema, LongChapterCardIdSchema } from "./long-workspace";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
export const LongNativeWritingListInputSchema = z.object({
  bookId: LongBookIdSchema,
  chapterCardId: LongChapterCardIdSchema
}).strict();
export const LongNativeWritingSaveInputSchema = LongNativeWritingListInputSchema.extend({
  role: z.enum(["work", "candidate"]),
  source: z.enum(["current", "pasted"]),
  origin: z.enum(["author-input", "cli-delivery"]).default("author-input"),
  content: z.string().max(100_000).optional(),
  expectedCurrentBodyHash: sha256.optional(),
  revisionOf: z.object({ path: z.string().max(1024), hash: sha256 }).strict().optional(),
  changeSummary: z.string().trim().max(1000).optional(),
  title: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(200).default("unknown"),
  version: z.string().trim().min(1).max(120),
  expectedHash: sha256.optional()
}).strict().refine((value) => value.source === "pasted" ? Boolean(value.content?.trim()) && value.expectedCurrentBodyHash === undefined : value.content === undefined && value.expectedCurrentBodyHash !== undefined, "粘贴稿需提供正文；当前正文保存需绑定所见版本。");
export const LongNativeWritingSelectInputSchema = LongNativeWritingListInputSchema.extend({
  path: z.string().min(1).max(1024),
  hash: sha256,
  action: z.enum(["reference", "important"])
}).strict();
export const LongNativeWritingReadInputSchema = LongNativeWritingSelectInputSchema.pick({ bookId: true, chapterCardId: true, path: true, hash: true }).strict();
export const LongNativeWritingSourceSchema = z.object({
  title: z.string().max(120),
  model: z.string().max(200),
  version: z.string().max(120),
  outline: z.string().max(1024).optional(),
  revisionOf: z.string().max(1024).optional(),
  revisionOfHash: sha256.optional(),
  changeSummary: z.string().max(1000).optional(),
  savedAt: z.string().max(64)
}).strict();
export const LongNativeWritingItemSchema = z.object({
  path: z.string().max(1024),
  hash: sha256,
  contentHash: sha256,
  role: z.enum(["current", "work", "candidate"]),
  title: z.string().max(120),
  model: z.string().max(200),
  version: z.string().max(120),
  important: z.boolean(),
  selectedReference: z.boolean(),
  sources: z.array(LongNativeWritingSourceSchema),
}).strict();
export const LongNativeWritingListResultSchema = z.object({
  bookId: LongBookIdSchema,
  chapterCardId: LongChapterCardIdSchema,
  items: z.array(LongNativeWritingItemSchema).max(10_000),
  currentBodyTooLarge: z.boolean().optional(),
  currentBody: z.object({ content: z.string().max(100_000), hash: sha256 }).strict().optional()
}).strict();
export const LongNativeWritingSaveResultSchema = z.object({
  path: z.string().max(1024), hash: sha256,
  role: z.enum(["work", "candidate"]), deduplicated: z.boolean()
}).strict();
export const LongNativeWritingSelectResultSchema = z.object({
  selected: z.literal(true), path: z.string().max(1024), hash: sha256,
  action: z.enum(["reference", "important"])
}).strict();
export const LongNativeWritingReadResultSchema = z.object({ path: z.string().max(1024), hash: sha256, role: z.enum(["work", "candidate"]), content: z.string().max(100_000) }).strict();

export const LongNativeWritingListCommandSchema = EnvelopeBaseSchema.extend({ type: z.literal("long.nativeWritingList"), payload: LongNativeWritingListInputSchema });
export const LongNativeWritingSaveCommandSchema = EnvelopeBaseSchema.extend({ type: z.literal("long.nativeWritingSave"), payload: LongNativeWritingSaveInputSchema });
export const LongNativeWritingSelectCommandSchema = EnvelopeBaseSchema.extend({ type: z.literal("long.nativeWritingSelect"), payload: LongNativeWritingSelectInputSchema });
export const LongNativeWritingReadCommandSchema = EnvelopeBaseSchema.extend({ type: z.literal("long.nativeWritingRead"), payload: LongNativeWritingReadInputSchema });
export const LongNativeWritingCommandSchemas = [LongNativeWritingListCommandSchema, LongNativeWritingSaveCommandSchema, LongNativeWritingSelectCommandSchema, LongNativeWritingReadCommandSchema] as const;
export type LongNativeWritingListInput = z.infer<typeof LongNativeWritingListInputSchema>;
export type LongNativeWritingSaveInput = z.input<typeof LongNativeWritingSaveInputSchema>;
export type LongNativeWritingSelectInput = z.infer<typeof LongNativeWritingSelectInputSchema>;
export type LongNativeWritingReadInput = z.infer<typeof LongNativeWritingReadInputSchema>;
