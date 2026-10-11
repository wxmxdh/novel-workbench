import { z } from "zod";

import { MarketplaceSourceSchema } from "../marketplace";
import {
  CatalogIdSchema,
  CatalogTitleSchema,
  LibraryTypeSchema,
  MaterialLibraryKindSchema,
  MaterialStageIdSchema,
  SkillKindSchema,
  SkillStageIdSchema,
  TimestampSchema
} from "./kinds";

export const MaterialEntrySchema = z.object({
  id: CatalogIdSchema,
  stageId: MaterialStageIdSchema,
  title: CatalogTitleSchema,
  body: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type MaterialEntry = z.infer<typeof MaterialEntrySchema>;

export const MaterialLibrarySchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  materialType: LibraryTypeSchema,
  materialKind: MaterialLibraryKindSchema,
  parentGenre: z.string(),
  subGenre: z.string(),
  overview: z.string(),
  entries: z.array(MaterialEntrySchema),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type MaterialLibrary = z.infer<typeof MaterialLibrarySchema>;

export const MaterialLibraryGroupSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  members: z.object({
    character: CatalogIdSchema.optional(),
    gimmick: CatalogIdSchema.optional(),
    plot: CatalogIdSchema.optional(),
    draft: CatalogIdSchema.optional(),
    other: CatalogIdSchema.optional()
  }),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type MaterialLibraryGroup = z.infer<typeof MaterialLibraryGroupSchema>;

export const SkillEntrySchema = z.object({
  id: CatalogIdSchema,
  stageId: SkillStageIdSchema,
  title: CatalogTitleSchema,
  body: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  marketplaceSource: MarketplaceSourceSchema.optional(),
  sourceCommonSkillId: CatalogIdSchema.optional(),
  sourceSkillId: CatalogIdSchema.optional(),
  sourceSkillEntryId: CatalogIdSchema.optional()
});
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const SkillLibrarySchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  skillType: LibraryTypeSchema,
  skillKind: SkillKindSchema,
  overview: z.string(),
  isBuiltin: z.boolean(),
  marketplaceSource: MarketplaceSourceSchema.optional(),
  entries: z.array(SkillEntrySchema),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type SkillLibrary = z.infer<typeof SkillLibrarySchema>;

export const SkillLibraryGroupSchema = z.object({
  id: CatalogIdSchema,
  title: CatalogTitleSchema,
  members: z.object({
    general: CatalogIdSchema.optional(),
    plot: CatalogIdSchema.optional(),
    style: CatalogIdSchema.optional(),
    other: CatalogIdSchema.optional()
  }),
  marketplaceSource: MarketplaceSourceSchema.optional(),
  projectRevision: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});
export type SkillLibraryGroup = z.infer<typeof SkillLibraryGroupSchema>;
