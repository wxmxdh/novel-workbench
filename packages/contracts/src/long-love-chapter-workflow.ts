import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

const relativeProjectPath = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !/^(?:[a-z]:|[\\/])/iu.test(value) &&
      !value
        .split(/[\\/]/u)
        .some((part) => !part || part === "." || part === ".."),
    "Only normalized LOVE project-relative paths are accepted."
  );

const LongLoveChapterWorkflowFields = {
  bookId: z.literal("longbook_9a146bbe"),
  action: z.enum([
    "prepare",
    "select_draft",
    "attach_notes",
    "read_notes",
    "redraft_context",
    "status"
  ]),
  chapter: z.number().int().min(1).max(100_000).optional(),
  volume: z.string().trim().min(1).max(100).optional(),
  draftPath: relativeProjectPath.optional(),
  draftStatus: z.enum(["provisional", "selected"]).optional(),
  targetDraftPath: relativeProjectPath.optional(),
  targetModel: z.string().trim().min(1).max(100).optional(),
  notePaths: z.array(relativeProjectPath).max(20).optional(),
  annotationItemIds: z
    .array(z.string().trim().min(1).max(200))
    .max(200)
    .optional()
};

function validateInput(
  value: z.infer<z.ZodObject<typeof LongLoveChapterWorkflowFields>>,
  context: z.RefinementCtx
) {
  if (value.action !== "status" && (!value.chapter || !value.volume)) {
    context.addIssue({
      code: "custom",
      message: "This action requires chapter and volume."
    });
  }
  if (value.action === "select_draft" && !value.draftPath) {
    context.addIssue({
      code: "custom",
      message: "select_draft requires a selected draftPath."
    });
  }
  if (
    value.action !== "select_draft" &&
    (value.draftPath || value.draftStatus)
  ) {
    context.addIssue({
      code: "custom",
      message: "draftPath/draftStatus are only valid for select_draft."
    });
  }
  if (value.action === "read_notes") {
    if (value.targetDraftPath && value.targetModel) {
      context.addIssue({
        code: "custom",
        message: "read_notes accepts targetDraftPath or targetModel, not both."
      });
    }
  } else if (value.targetDraftPath || value.targetModel) {
    context.addIssue({
      code: "custom",
      message: "targetDraftPath/targetModel are only valid for read_notes."
    });
  }
  if (value.action === "attach_notes" && !value.notePaths?.length) {
    context.addIssue({
      code: "custom",
      message: "attach_notes requires explicit notePaths."
    });
  }
  if (value.action !== "attach_notes" && value.notePaths?.length) {
    context.addIssue({
      code: "custom",
      message: "notePaths are only valid for attach_notes."
    });
  }
  if (
    value.action !== "attach_notes" &&
    value.annotationItemIds !== undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "annotationItemIds are only valid for attach_notes."
    });
  }
}

export const LongLoveChapterWorkflowInputSchema = z
  .object(LongLoveChapterWorkflowFields)
  .strict()
  .superRefine(validateInput);

export const LongLoveChapterWorkflowCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("long.loveChapterWorkflow"),
    payload: z
      .object({
        ...LongLoveChapterWorkflowFields,
        authorActionEvidence: z
          .object({
            requestId: z.string().trim().min(1).max(200),
            quote: z.string().trim().min(1).max(2_000)
          })
          .strict()
          .optional()
      })
      .strict()
      .superRefine((value, context) => {
        validateInput(value, context);
        if (
          ["select_draft", "attach_notes"].includes(value.action) &&
          !value.authorActionEvidence
        ) {
          context.addIssue({
            code: "custom",
            path: ["authorActionEvidence"],
            message:
              "Selection and annotation binding require current author evidence."
          });
        }
        if (value.action === "read_notes" && value.authorActionEvidence) {
          context.addIssue({
            code: "custom",
            path: ["authorActionEvidence"],
            message:
              "Read-only annotation retrieval cannot carry write evidence."
          });
        }
      })
  });

export const LongLoveChapterWorkflowResultSchema = z
  .object({
    ok: z.literal(true),
    action: z.string(),
    statePath: relativeProjectPath.optional(),
    packet: z.record(z.string(), z.unknown()).optional(),
    selection: z.record(z.string(), z.unknown()).optional(),
    status: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export type LongLoveChapterWorkflowInput = z.infer<
  typeof LongLoveChapterWorkflowInputSchema
>;
export type LongLoveChapterWorkflowCommandEnvelope = z.infer<
  typeof LongLoveChapterWorkflowCommandEnvelopeSchema
>;
export type LongLoveChapterWorkflowCommandInput = z.infer<
  typeof LongLoveChapterWorkflowCommandEnvelopeSchema.shape.payload
>;
