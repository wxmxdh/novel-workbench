import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const CodexModelSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  displayName: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  defaultReasoningEffort: z.string().optional(),
  supportedReasoningEfforts: z
    .array(z.object({ reasoningEffort: z.string(), description: z.string() }))
    .default([])
});
export type CodexModel = z.infer<typeof CodexModelSchema>;

export const CodexSessionSchema = z.object({
  sessionId: z.string().min(1),
  threadId: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().optional(),
  scopeKey: z.string().min(1).max(240),
  createdAt: z.string().datetime()
});
export type CodexSession = z.infer<typeof CodexSessionSchema>;

export const CodexStartSessionInputSchema = z.object({
  sessionId: z.string().min(1).max(120),
  model: z.string().min(1).max(120),
  reasoningEffort: z.string().min(1).max(40).optional(),
  scopeKey: z.string().min(1).max(240)
});
export const CodexResumeSessionInputSchema = z.object({
  sessionId: z.string().min(1).max(120),
  threadId: z.string().min(1).max(200),
  model: z.string().min(1).max(120),
  reasoningEffort: z.string().min(1).max(40).optional(),
  scopeKey: z.string().min(1).max(240)
});
export const CodexTurnInputSchema = z.object({
  sessionId: z.string().min(1).max(120),
  text: z.string().min(1).max(100_000)
});
export const CodexInterruptInputSchema = z.object({
  sessionId: z.string().min(1).max(120)
});

export const CodexEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    sessionId: z.string(),
    text: z.string()
  }),
  z.object({
    type: z.literal("status"),
    sessionId: z.string(),
    status: z.enum(["started", "completed", "interrupted", "failed"])
  }),
  z.object({
    type: z.literal("approval-blocked"),
    sessionId: z.string(),
    method: z.string(),
    message: z.string()
  }),
  z.object({
    type: z.literal("error"),
    sessionId: z.string(),
    message: z.string()
  })
]);
export type CodexEvent = z.infer<typeof CodexEventSchema>;
export const CodexEventEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("codex.event"),
  payload: CodexEventSchema
});

const EmptyPayloadSchema = z.object({}).strict();
export const CodexCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("codex.listModels"),
    payload: EmptyPayloadSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("codex.startSession"),
    payload: CodexStartSessionInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("codex.resumeSession"),
    payload: CodexResumeSessionInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("codex.startTurn"),
    payload: CodexTurnInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("codex.interrupt"),
    payload: CodexInterruptInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("codex.closeSession"),
    payload: CodexInterruptInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("codex.dispose"),
    payload: EmptyPayloadSchema
  })
] as const;

export const CODEX_COLLABORATION_CHANNEL = "codex-collaboration";
export const CODEX_COLLABORATION_COMMANDS = [
  "codex.listModels",
  "codex.startSession",
  "codex.resumeSession",
  "codex.startTurn",
  "codex.interrupt",
  "codex.closeSession",
  "codex.dispose"
] as const;
export type CodexCollaborationCommand =
  (typeof CODEX_COLLABORATION_COMMANDS)[number];

export interface CodexCollaborationApi {
  listModels(): Promise<CodexModel[]>;
  startSession(
    input: z.input<typeof CodexStartSessionInputSchema>
  ): Promise<CodexSession>;
  resumeSession(
    input: z.input<typeof CodexResumeSessionInputSchema>
  ): Promise<CodexSession>;
  startTurn(input: z.input<typeof CodexTurnInputSchema>): Promise<void>;
  interrupt(input: z.input<typeof CodexInterruptInputSchema>): Promise<void>;
  closeSession(input: z.input<typeof CodexInterruptInputSchema>): Promise<void>;
  dispose(): Promise<void>;
  onEvent(listener: (event: CodexEvent) => void): () => void;
}
