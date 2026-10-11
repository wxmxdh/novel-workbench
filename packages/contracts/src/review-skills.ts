import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const REVIEW_SKILL_IDS = [
  "shuorenhua",
  "humanizer-zh",
  "human-writing",
  "sepia"
] as const;
export const DEFAULT_REVIEW_SKILL_IDS = ["shuorenhua"] as const;
export const ReviewSkillIdSchema = z.enum(REVIEW_SKILL_IDS);
export type ReviewSkillId = z.infer<typeof ReviewSkillIdSchema>;
export const ReviewSkillIdsSchema = z
  .array(ReviewSkillIdSchema)
  .max(REVIEW_SKILL_IDS.length)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Review skills must be unique."
  );
export const ReviewSkillSettingsSchema = z
  .object({
    enabledIds: ReviewSkillIdsSchema
  })
  .strict();
export type ReviewSkillSettings = z.infer<typeof ReviewSkillSettingsSchema>;
export function defaultReviewSkillSettings(): ReviewSkillSettings {
  return { enabledIds: [...DEFAULT_REVIEW_SKILL_IDS] };
}
export const REVIEW_SKILL_CATALOG = [
  {
    id: "shuorenhua",
    revision: "e7c2b86",
    source:
      "https://github.com/MrGeDiao/shuorenhua/tree/e7c2b8670bd3e1988bfec199e861cebd87fc5e9c",
    defaultEnabled: true,
    archived: false
  },
  {
    id: "humanizer-zh",
    revision: "2026-09-23",
    source: "https://github.com/op7418/Humanizer-zh",
    defaultEnabled: false,
    archived: true
  },
  {
    id: "human-writing",
    revision: "1.1.0",
    source: "https://github.com/KKKKhazix/human-writing",
    defaultEnabled: false,
    archived: true
  },
  {
    id: "sepia",
    revision: "0.12.3",
    source: "https://github.com/Nanako0129/sepia",
    defaultEnabled: false,
    archived: true
  }
] as const;
export const AgentTeamsSaveReviewSkillsCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agentTeams.saveReviewSkills"),
    payload: ReviewSkillSettingsSchema
  });
