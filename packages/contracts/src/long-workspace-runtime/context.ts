import { z } from "zod";
import {
  LongBookIdSchema,
  LongAgentIdSchema,
  LongChapterCardIdSchema,
  LongFileIdSchema,
  LongWorkspaceNavigationSnapshotSchema,
  LongWorkspaceRootSchema,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  longAgentsMdCharacterCount
} from "../long-workspace";
import {
  LongWorldbuildingDirectorySnapshotSchema,
  LongWorldbuildingFocusSnapshotSchema
} from "./worldbuilding";
import { LongCharacterFocusSnapshotSchema } from "./character";
import { LongPlotFocusSnapshotSchema } from "./plot";
import { LongRequiredRulesSnapshotSchema } from "./required-rules";

export const LongApprovedVoicePackageSnapshotSchema = z
  .object({
    packageId: z.literal("LOVE-voice-2026-10-10-v1.0"),
    version: z.literal("v1.0"),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    scope: z.string().trim().min(1).max(1_000),
    runPolicy: z
      .object({
        sampleUse: z.string().trim().min(1).max(2_000),
        draft: z.string().trim().min(1).max(2_000),
        revision: z.string().trim().min(1).max(2_000),
        feedbackScope: z.string().trim().min(1).max(2_000)
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            role: z.enum([
              "manifest",
              "approved-style-sample",
              "author-style-feedback"
            ]),
            title: z.string().trim().min(1).max(256),
            sourcePath: z.string().trim().min(1).max(2_048),
            sourceId: z.string().trim().min(1).max(256),
            fileId: LongFileIdSchema,
            updatedAt: z.string().trim().min(1).max(128),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
            content: z.string().min(1).max(64_000)
          })
          .strict()
      )
      .length(3)
  })
  .strict();
export type LongApprovedVoicePackageSnapshot = z.infer<
  typeof LongApprovedVoicePackageSnapshotSchema
>;

export const LongSelectedDraftReferenceSnapshotSchema = z
  .object({
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    relation: z.enum(["current", "previous"]),
    title: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(1_024),
    hash: z.string().regex(/^[a-f0-9]{64}$/u),
    content: z.string().min(1).max(100_000),
    model: z.string().trim().min(1).max(200),
    version: z.string().trim().min(1).max(120)
  })
  .strict();
export type LongSelectedDraftReferenceSnapshot = z.infer<
  typeof LongSelectedDraftReferenceSnapshotSchema
>;

export const LongSelectedChapterOutlineSnapshotSchema = z
  .object({
    bookId: LongBookIdSchema,
    chapterCardId: LongChapterCardIdSchema,
    version: z.string().trim().min(1).max(256),
    path: z.string().trim().min(1).max(1_024),
    hash: z.string().regex(/^[a-f0-9]{64}$/u),
    content: z.string().min(1).max(100_000)
  })
  .strict();
export type LongSelectedChapterOutlineSnapshot = z.infer<
  typeof LongSelectedChapterOutlineSnapshotSchema
>;

export const LongWorkspaceRuntimeContextSchema = z
  .object({
    bookId: LongBookIdSchema,
    title: z.string().trim().min(1).max(256),
    activeRoot: LongWorkspaceRootSchema,
    activeAgentId: LongAgentIdSchema,
    interactionMode: z.literal("discussion").optional(),
    /** External discussions expose source reads without writing or delegation. */
    readOnly: z.boolean().optional(),
    activeFileId: LongFileIdSchema.optional(),
    activeChapterCardId: LongChapterCardIdSchema.optional(),
    navigation: LongWorkspaceNavigationSnapshotSchema,
    worldbuildingDirectory: LongWorldbuildingDirectorySnapshotSchema.optional(),
    worldbuildingFocus: LongWorldbuildingFocusSnapshotSchema.optional(),
    characterFocus: LongCharacterFocusSnapshotSchema.optional(),
    plotFocus: LongPlotFocusSnapshotSchema.optional(),
    requiredRules: LongRequiredRulesSnapshotSchema.optional(),
    approvedVoicePackage: LongApprovedVoicePackageSnapshotSchema.optional(),
    selectedDraftReferences: z
      .array(LongSelectedDraftReferenceSnapshotSchema)
      .max(2)
      .optional(),
    selectedChapterOutline: LongSelectedChapterOutlineSnapshotSchema.optional(),
    agentsMd: z
      .string()
      .max(LONG_AGENTS_MD_MAX_CHARACTERS * 2)
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.navigation.bookId !== value.bookId) {
      context.addIssue({
        code: "custom",
        path: ["navigation", "bookId"],
        message: "Long runtime navigation must belong to the active book."
      });
    }
    if (
      value.activeChapterCardId !== undefined &&
      !value.navigation.chapterCards.some(
        ({ id }) => id === value.activeChapterCardId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeChapterCardId"],
        message:
          "Long runtime active chapter must exist in the navigation snapshot."
      });
    }
    if (
      value.worldbuildingFocus !== undefined &&
      value.activeRoot !== "worldbuilding"
    ) {
      context.addIssue({
        code: "custom",
        path: ["worldbuildingFocus"],
        message:
          "Long worldbuilding focus may only be provided on the worldbuilding root."
      });
    }
    if (
      value.worldbuildingFocus !== undefined &&
      value.activeFileId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeFileId"],
        message:
          "Long worldbuilding focus requires the active worldbuilding file."
      });
    }
    if (
      value.characterFocus !== undefined &&
      value.activeRoot !== "character_design"
    ) {
      context.addIssue({
        code: "custom",
        path: ["characterFocus"],
        message:
          "Long character focus may only be provided on the character-design root."
      });
    }
    if (
      value.characterFocus !== undefined &&
      value.activeFileId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeFileId"],
        message: "Long character focus requires the active character file."
      });
    }
    if (value.plotFocus !== undefined && value.activeRoot !== "plot_design") {
      context.addIssue({
        code: "custom",
        path: ["plotFocus"],
        message: "Long plot focus may only be provided on the plot-design root."
      });
    }
    if (
      value.plotFocus?.volumeId !== undefined &&
      !value.navigation.volumes.some(
        ({ id }) => id === value.plotFocus!.volumeId
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["plotFocus", "volumeId"],
        message: "Long plot focus volume must exist in the navigation snapshot."
      });
    }
    if (value.plotFocus?.arcId !== undefined) {
      const focusedArc = value.navigation.arcs.find(
        ({ id }) => id === value.plotFocus!.arcId
      );
      if (!focusedArc) {
        context.addIssue({
          code: "custom",
          path: ["plotFocus", "arcId"],
          message: "Long plot focus arc must exist in the navigation snapshot."
        });
      } else if (focusedArc.volumeId !== value.plotFocus.volumeId) {
        context.addIssue({
          code: "custom",
          path: ["plotFocus", "arcId"],
          message: "Long plot focus arc must belong to the focused volume."
        });
      }
    }
    if (
      value.agentsMd !== undefined &&
      longAgentsMdCharacterCount(value.agentsMd) > LONG_AGENTS_MD_MAX_CHARACTERS
    ) {
      context.addIssue({
        code: "custom",
        path: ["agentsMd"],
        message:
          "Long runtime AGENTS.md context exceeds the maximum character count."
      });
    }
    if (value.plotFocus?.chapterCardId !== undefined) {
      const focusedChapterCard = value.navigation.chapterCards.find(
        ({ id }) => id === value.plotFocus!.chapterCardId
      );
      if (!focusedChapterCard) {
        context.addIssue({
          code: "custom",
          path: ["plotFocus", "chapterCardId"],
          message:
            "Long plot focus chapter card must exist in the navigation snapshot."
        });
      } else if (focusedChapterCard.volumeId !== value.plotFocus.volumeId) {
        context.addIssue({
          code: "custom",
          path: ["plotFocus", "chapterCardId"],
          message:
            "Long plot focus chapter card must belong to the focused volume."
        });
      }
    }
  });
export type LongWorkspaceRuntimeContext = z.infer<
  typeof LongWorkspaceRuntimeContextSchema
>;
