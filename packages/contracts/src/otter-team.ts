import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";
import {
  OtterContextRefSchema,
  OtterProjectIdSchema,
  OtterRelativePathSchema
} from "./otter-context";
import { ExtrasAgentRunRequestSchema } from "./extras-agent/tasks";
import { LONG_AGENT_SUBAGENT_MAX_COUNT } from "./agent-team";
import { LongAgentIdSchema } from "./long-workspace";
import { TemperatureSchema, ThinkingLevelSchema } from "./models";

export const OtterDiscussionInputSchema = z
  .object({
    projectId: OtterProjectIdSchema,
    topic: z.string().trim().min(1).max(20_000),
    sources: z.array(OtterRelativePathSchema).max(30).default([]),
    skills: z
      .array(
        z.enum([
          "otter-novel",
          "line-editing",
          "revision-continuity",
          "scene-craft",
          "story-maintenance",
          "voice-style"
        ])
      )
      .max(6)
      .optional(),
    targetPath: OtterRelativePathSchema.optional(),
    includeProjectPeople: z.boolean().optional()
  })
  .strict();
export const OtterDiscussionResultSchema = OtterContextRefSchema.extend({
  contextId: z.string(),
  status: z.enum(["PASS", "WARN"])
});
export const OtterTeamMemberContextSchema = OtterContextRefSchema.extend({
  contextId: z.string().min(1).max(200)
});
const KeySchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const OtterTeamMemberSchema = z
  .object({
    id: KeySchema,
    name: z.string().trim().min(1).max(80),
    role: z.string().trim().min(1).max(4000),
    modelId: z.string().min(1).max(120).optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional(),
    enabled: z.boolean().default(true)
  })
  .strict();
export const OtterTeamSchema = z
  .object({
    id: KeySchema,
    name: z.string().trim().min(1).max(80),
    members: z.array(OtterTeamMemberSchema).min(1).max(8)
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.members.map((m) => m.id)).size === value.members.length,
    "团队成员标识重复"
  );
export const OtterTeamsSchema = z
  .object({ teams: z.array(OtterTeamSchema).max(8) })
  .strict()
  .refine(
    (value) =>
      new Set(value.teams.map((t) => t.id)).size === value.teams.length,
    "团队标识重复"
  );
export const OtterTeamPlanInputSchema = z
  .object({
    context: OtterContextRefSchema,
    /** Preferred bridge: resolve the active original long-form team. */
    parentAgentId: LongAgentIdSchema.optional(),
    /** Explicit per-run selection; does not change the globally enabled team. */
    nativeTeamIds: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/))
      .min(1)
      .max(4)
      .optional(),
    memberKeys: z.array(z.string().min(1).max(250)).min(1).max(60).optional(),
    parentModelId: z.string().trim().min(1).max(120).optional(),
    parentThinkingLevel: ThinkingLevelSchema.optional(),
    parentTemperature: TemperatureSchema.optional(),
    /** Legacy Otter panel compatibility; ignored when parentAgentId is supplied. */
    teamIds: z.array(KeySchema).min(1).max(4).optional(),
    topic: z.string().trim().min(1).max(2000),
    material: z.string().max(12000).optional(),
    mode: z.enum(["review", "ideas"])
  })
  .strict()
  .refine((value) => !!value.parentAgentId || !!value.teamIds?.length, {
    message: "请选择原版长篇团队，或提供旧版团队标识。"
  })
  .refine((value) => !value.nativeTeamIds || !!value.parentAgentId, {
    message: "本轮团队选择需要指定原版主智能体。"
  })
  .refine((value) => !value.memberKeys || !!value.nativeTeamIds, {
    message: "本轮职责选择需要明确团队。"
  });
export const OtterTeamPlanSchema = z
  .object({
    batchId: z.string(),
    mode: z.enum(["review", "ideas"]),
    members: z
      .array(
        z
          .object({
            teamName: z.string(),
            memberName: z.string(),
            memberId: z.string().optional(),
            context: OtterTeamMemberContextSchema.optional(),
            sourcePaths: z.array(OtterRelativePathSchema).max(30).optional(),
            request: ExtrasAgentRunRequestSchema
          })
          .strict()
      )
      .max(LONG_AGENT_SUBAGENT_MAX_COUNT)
  })
  .strict();
export const OtterTeamCommandSchemas = [
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.prepareDiscussion"),
    payload: OtterDiscussionInputSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.teams"),
    payload: z.object({}).strict()
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.saveTeams"),
    payload: OtterTeamsSchema
  }),
  EnvelopeBaseSchema.extend({
    type: z.literal("otter.prepareTeam"),
    payload: OtterTeamPlanInputSchema
  })
] as const;
export type OtterDiscussionInput = z.infer<typeof OtterDiscussionInputSchema>;
export type OtterDiscussionResult = z.infer<typeof OtterDiscussionResultSchema>;
export type OtterTeams = z.infer<typeof OtterTeamsSchema>;
export type OtterTeamPlanInput = z.infer<typeof OtterTeamPlanInputSchema>;
export type OtterTeamPlan = z.infer<typeof OtterTeamPlanSchema>;
export interface OtterTeamApi {
  prepareDiscussion(
    input: OtterDiscussionInput
  ): Promise<OtterDiscussionResult>;
  teams(): Promise<OtterTeams>;
  saveTeams(input: OtterTeams): Promise<OtterTeams>;
  prepareTeam(input: OtterTeamPlanInput): Promise<OtterTeamPlan>;
}
