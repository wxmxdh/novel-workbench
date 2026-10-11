import { z } from "zod";
import {
  OtterReviewThemeSchema,
  type OtterReviewTheme
} from "./otter-review-theme";
export * from "./otter-review-theme";
import { EnvelopeBaseSchema } from "./envelope";
import {
  OtterContextRefSchema,
  OtterProjectSchema,
  OtterProjectIdSchema,
  OtterRelativePathSchema
} from "./otter-context";
export * from "./otter-context";
export * from "./otter-manual";
export * from "./otter-studio";
export * from "./otter-team";
export * from "./otter-writing";
import { OtterTeamCommandSchemas, type OtterTeamApi } from "./otter-team";
import {
  OtterWritingCommandSchemas,
  type OtterWritingApi
} from "./otter-writing";
import { OtterStudioCommandSchemas, type OtterStudioApi } from "./otter-studio";
import {
  OtterManualHandoffInputSchema,
  OtterManualHandoffResultSchema,
  OtterManualReportInputSchema,
  OtterManualReportSchema
} from "./otter-manual";

export const OtterSettingsSchema = z
  .object({ workspaceRoot: z.string().nullable() })
  .strict();
export const OtterProjectListSchema = z.array(OtterProjectSchema).max(500);
export const OtterDocumentSchema = z
  .object({
    id: z.string().min(1),
    path: OtterRelativePathSchema,
    title: z.string(),
    category: z.enum([
      "entry",
      "canon",
      "character",
      "relationship",
      "timeline",
      "workflow",
      "writing-support",
      "plan",
      "draft",
      "annotation",
      "protocol",
      "concept",
      "world",
      "map"
    ]),
    status: z.string(),
    kind: z.string().optional(),
    volume: z.string().optional(),
    chapter: z.string().optional(),
    model: z.string().optional(),
    outline: z.string().optional(),
    revision: z.string().optional(),
    version: z.string().optional(),
    workbench: z.string().optional(),
    revisionOf: OtterRelativePathSchema.optional(),
    writingRole: z.enum(["candidate", "work"]).optional(),
    selectedReference: z.boolean().optional(),
    importantCheckpoint: z.boolean().optional(),
    sourceCount: z.number().int().min(1).optional(),
    writingSources: z
      .array(
        z
          .object({
            title: z.string(),
            model: z.string(),
            version: z.string(),
            outline: OtterRelativePathSchema.optional(),
            revisionOf: OtterRelativePathSchema.optional(),
            savedAt: z.string()
          })
          .strict()
      )
      .optional(),
    readOnly: z.literal(true)
  })
  .strict();
const RecordSchema = z.record(z.string(), z.unknown());
export const OtterProjectViewSchema = z
  .object({
    project: OtterProjectSchema,
    activeSource: z.string().nullable(),
    documents: z.array(OtterDocumentSchema).max(20_000),
    protocolSummary: RecordSchema
  })
  .strict();
export const OtterProjectInputSchema = z
  .object({ projectId: OtterProjectIdSchema })
  .strict();
export const OtterReadInputSchema = OtterProjectInputSchema.extend({
  path: OtterRelativePathSchema
});
export const OtterReadResultSchema = z
  .object({
    path: OtterRelativePathSchema,
    content: z.string().max(5_000_000),
    hash: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();
export const OtterRouteInputSchema = OtterProjectInputSchema.extend({
  task: z.enum(["draft", "continue", "revise", "review", "plan", "discuss"]),
  chapter: z.number().int().positive().max(100_000),
  volume: z.string().min(1).max(200).optional()
});
export const OtterWorkflowInputSchema = OtterProjectInputSchema.extend({
  action: z.enum([
    "prepare",
    "preflight",
    "deliver-plan",
    "select-outline",
    "deliver-draft",
    "accept",
    "candidates",
    "decision",
    "commit",
    "derived"
  ]),
  input: RecordSchema,
  contextPath: OtterRelativePathSchema.optional(),
  receiptPath: OtterRelativePathSchema.optional(),
  planPath: OtterRelativePathSchema.optional(),
  authorIntent: z.string().max(10_000).optional()
}).refine(
  (value) => JSON.stringify(value.input).length <= 1_000_000,
  "Input too large"
);
export const OtterProtocolResultSchema = z
  .object({ result: RecordSchema })
  .strict();
export const OtterContextResultSchema = z
  .object({
    contextId: z.string().min(1),
    baselineHash: z.string().regex(/^[a-f0-9]{64}$/),
    comparisonBaselineHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    apiText: z.string().min(1).max(2_000_000),
    agentText: z.string().min(1).max(2_000_000)
  })
  .strict();
export const OtterHandoffInputSchema = OtterContextRefSchema.extend({
  tool: z.enum(["codex", "claude-code", "antigravity"])
});
export const OtterHandoffResultSchema = z
  .object({ directory: z.string(), prompt: z.string() })
  .strict();
export const OtterReviewInputSchema = OtterContextRefSchema.extend({
  instructions: z.string().min(1).max(20_000)
});
export const OtterExternalReviewSchema = z
  .object({
    summary: z.string(),
    context_id: z.string(),
    baseline_hash: z.string(),
    findings: z.array(
      z
        .object({
          kind: z.enum(["hard-boundary", "literary-advice", "not-evaluated"]),
          evidence: z.string(),
          message: z.string(),
          suggestion: z.string()
        })
        .strict()
    )
  })
  .strict();
export const OtterReviewResultSchema = z
  .object({
    status: z.enum(["completed", "unavailable"]),
    reportPath: z.string().nullable(),
    report: RecordSchema.nullable(),
    message: z.string()
  })
  .strict();
export const OtterReviewPageSchema = z
  .object({ url: z.string().regex(/^otter-review:\/\/app\/$/) })
  .strict();
export const OtterReviewBoundsSchema = z
  .object({
    x: z.number().int().nonnegative().max(100_000),
    y: z.number().int().nonnegative().max(100_000),
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000)
  })
  .strict();
export const OtterSetReviewBoundsSchema = z
  .object({ bounds: OtterReviewBoundsSchema.nullable() })
  .strict();
export const OtterSetReviewOverlaySchema = z
  .object({ visible: z.boolean() })
  .strict();
export const OtterReviewOverlaySchema = z
  .object({
    preview: z
      .string()
      .max(8_000_000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
      .nullable()
  })
  .strict();
export const OtterStageDraftInputSchema = OtterContextRefSchema.extend({
  receiptPath: OtterRelativePathSchema,
  body: z.string().min(1).max(2_000_000),
  title: z.string().min(1).max(240),
  revision: z.string().max(80).optional(),
  authorIntent: z.string().min(1).max(10_000),
  originRunId: z
    .string()
    .regex(/^[\w-]+$/)
    .max(200)
    .optional()
});
export type OtterProject = z.infer<typeof OtterProjectSchema>;
export type OtterProjectView = z.infer<typeof OtterProjectViewSchema>;
export type OtterReadInput = z.infer<typeof OtterReadInputSchema>;
export type OtterRouteInput = z.infer<typeof OtterRouteInputSchema>;
export type OtterWorkflowInput = z.infer<typeof OtterWorkflowInputSchema>;
export type OtterContextResult = z.infer<typeof OtterContextResultSchema>;
export type OtterStageDraftInput = z.infer<typeof OtterStageDraftInputSchema>;
export type OtterHandoffInput = z.infer<typeof OtterHandoffInputSchema>;
export type OtterReviewInput = z.infer<typeof OtterReviewInputSchema>;
export type OtterReviewResult = z.infer<typeof OtterReviewResultSchema>;

export const OtterCommandSchemas = [
  ...OtterStudioCommandSchemas,
  ...OtterTeamCommandSchemas,
  ...OtterWritingCommandSchemas,
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.manualHandoff"),
    payload: OtterManualHandoffInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.manualReport"),
    payload: OtterManualReportInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.settings"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.chooseWorkspace"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.projects"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.open"),
    payload: OtterProjectInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.read"),
    payload: OtterReadInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.route"),
    payload: OtterRouteInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.workflow"),
    payload: OtterWorkflowInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.context"),
    payload: OtterContextRefSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.handoff"),
    payload: OtterHandoffInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.reviewPage"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.setReviewBounds"),
    payload: OtterSetReviewBoundsSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.setReviewOverlay"),
    payload: OtterSetReviewOverlaySchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.setReviewTheme"),
    payload: OtterReviewThemeSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.stageDraft"),
    payload: OtterStageDraftInputSchema
  })
] as const;

export interface OtterApi
  extends OtterStudioApi, OtterTeamApi, OtterWritingApi {
  manualHandoff(
    input: z.infer<typeof OtterManualHandoffInputSchema>
  ): Promise<z.infer<typeof OtterManualHandoffResultSchema>>;
  manualReport(
    input: z.infer<typeof OtterManualReportInputSchema>
  ): Promise<z.infer<typeof OtterManualReportSchema>>;
  settings(): Promise<z.infer<typeof OtterSettingsSchema>>;
  chooseWorkspace(): Promise<z.infer<typeof OtterSettingsSchema> | null>;
  projects(): Promise<OtterProject[]>;
  open(
    input: z.infer<typeof OtterProjectInputSchema>
  ): Promise<OtterProjectView>;
  read(input: OtterReadInput): Promise<z.infer<typeof OtterReadResultSchema>>;
  route(
    input: OtterRouteInput
  ): Promise<z.infer<typeof OtterProtocolResultSchema>>;
  workflow(
    input: OtterWorkflowInput
  ): Promise<z.infer<typeof OtterProtocolResultSchema>>;
  context(
    input: z.infer<typeof OtterContextRefSchema>
  ): Promise<OtterContextResult>;
  handoff(
    input: OtterHandoffInput
  ): Promise<z.infer<typeof OtterHandoffResultSchema>>;
  reviewPage(): Promise<z.infer<typeof OtterReviewPageSchema>>;
  setReviewTheme(theme: OtterReviewTheme): Promise<void>;
  setReviewOverlay(
    visible: boolean
  ): Promise<z.infer<typeof OtterReviewOverlaySchema>>;
  setReviewBounds(
    bounds: z.infer<typeof OtterReviewBoundsSchema> | null
  ): Promise<void>;
  stageDraft(
    input: OtterStageDraftInput
  ): Promise<z.infer<typeof OtterProtocolResultSchema>>;
}
