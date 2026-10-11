import { z } from "zod";

import {
  LongMarkdownFileReferenceSchema,
  LongWorldbuildingCategoryIdSchema,
  LongWorldbuildingItemIdSchema,
  longWorldbuildingFileId,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewFileId
} from "./ids";
import { LongTitleSchema } from "./primitives";

export const LongWorldbuildingFormatSchema = z.enum(["list", "text"]);
export type LongWorldbuildingFormat = z.infer<
  typeof LongWorldbuildingFormatSchema
>;

export const LongWorldbuildingItemLayoutSchema = z.enum([
  "top-tabs",
  "right-list",
  "left-tree"
]);
export type LongWorldbuildingItemLayout = z.infer<
  typeof LongWorldbuildingItemLayoutSchema
>;

export const DEFAULT_LONG_WORKSPACE_FEATURE_SETTINGS = {
  worldbuildingItemLayout: "top-tabs",
  characterAndContinuityItemLayout: "top-tabs",
  plotItemLayout: "top-tabs"
} as const;

export const LongWorkspaceFeatureSettingsSchema = z
  .object({
    worldbuildingItemLayout: LongWorldbuildingItemLayoutSchema.default(
      DEFAULT_LONG_WORKSPACE_FEATURE_SETTINGS.worldbuildingItemLayout
    ),
    characterAndContinuityItemLayout: LongWorldbuildingItemLayoutSchema.default(
      DEFAULT_LONG_WORKSPACE_FEATURE_SETTINGS.characterAndContinuityItemLayout
    ),
    plotItemLayout: LongWorldbuildingItemLayoutSchema.default(
      DEFAULT_LONG_WORKSPACE_FEATURE_SETTINGS.plotItemLayout
    )
  })
  .strict();
export type LongWorkspaceFeatureSettings = z.infer<
  typeof LongWorkspaceFeatureSettingsSchema
>;

export const LongWorldbuildingItemSchema = z
  .object({
    id: LongWorldbuildingItemIdSchema,
    title: LongTitleSchema,
    order: z.number().int().positive(),
    file: LongMarkdownFileReferenceSchema
  })
  .strict()
  .superRefine((item, context) => {
    if (item.file.id !== longWorldbuildingItemFileId(item.id)) {
      context.addIssue({
        code: "custom",
        path: ["file", "id"],
        message: "Worldbuilding item file id must match its stable item id."
      });
    }
  });
export type LongWorldbuildingItem = z.infer<typeof LongWorldbuildingItemSchema>;

const LongWorldbuildingCategorySharedShape = {
  id: LongWorldbuildingCategoryIdSchema,
  title: LongTitleSchema,
  order: z.number().int().positive()
};

export const LongWorldbuildingListCategorySchema = z
  .object({
    ...LongWorldbuildingCategorySharedShape,
    format: z.literal("list"),
    contentAuthority: z.literal("files"),
    /**
     * Optional only for loading pre-overview v1 projects. All newly-created
     * list categories include this file, and the project store migrates older
     * categories before exposing them.
     */
    overview: LongMarkdownFileReferenceSchema.optional(),
    items: z.array(LongWorldbuildingItemSchema).max(10_000)
  })
  .strict()
  .superRefine((category, context) => {
    if (
      category.overview &&
      category.overview.id !== longWorldbuildingOverviewFileId(category.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["overview", "id"],
        message:
          "Worldbuilding overview file id must match its stable category id."
      });
    }
    const ids = new Set<string>();
    const fileIds = new Set<string>();
    const paths = new Set<string>();
    category.items.forEach((item, index) => {
      if (ids.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "id"],
          message: `Duplicate worldbuilding item id: ${item.id}`
        });
      }
      if (fileIds.has(item.file.id)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "file", "id"],
          message: `Duplicate worldbuilding item file id: ${item.file.id}`
        });
      }
      if (paths.has(item.file.path)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "file", "path"],
          message: `Duplicate worldbuilding item file path: ${item.file.path}`
        });
      }
      ids.add(item.id);
      fileIds.add(item.file.id);
      paths.add(item.file.path);
    });
  });
export type LongWorldbuildingListCategory = z.infer<
  typeof LongWorldbuildingListCategorySchema
>;

export const LongWorldbuildingTextCategorySchema = z
  .object({
    ...LongWorldbuildingCategorySharedShape,
    format: z.literal("text"),
    contentAuthority: z.literal("markdown"),
    file: LongMarkdownFileReferenceSchema
  })
  .strict()
  .superRefine((category, context) => {
    if (category.file.id !== longWorldbuildingFileId(category.id)) {
      context.addIssue({
        code: "custom",
        path: ["file", "id"],
        message: "Worldbuilding text file id must match its stable category id."
      });
    }
  });
export type LongWorldbuildingTextCategory = z.infer<
  typeof LongWorldbuildingTextCategorySchema
>;

export const LongWorldbuildingCategorySchema = z.discriminatedUnion("format", [
  LongWorldbuildingListCategorySchema,
  LongWorldbuildingTextCategorySchema
]);
export type LongWorldbuildingCategory = z.infer<
  typeof LongWorldbuildingCategorySchema
>;
