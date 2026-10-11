import { z } from "zod";
import {
  LongFileIdSchema,
  LongWorldbuildingItemIdSchema
} from "../long-workspace";

export const LONG_REQUIRED_RULES_MAX_ITEMS = 16;
export const LONG_REQUIRED_RULES_MAX_CHARACTERS = 64_000;

/** Explicit book-level binding in AGENTS.md; never infer bindings from prose. */
export function parseLongRequiredRuleIds(content: string): string[] {
  const ids: string[] = [];
  for (const match of content.matchAll(
    /<!--\s*deepwrite-required-rules:([\s\S]*?)-->/gu
  )) {
    for (const token of match[1]!
      .trim()
      .split(/[\s,，]+/u)
      .filter(Boolean)) {
      ids.push(LongWorldbuildingItemIdSchema.parse(token));
    }
  }
  const unique = [...new Set(ids)];
  if (unique.length > LONG_REQUIRED_RULES_MAX_ITEMS) {
    throw new Error("本书绑定的必读规则超过16条，请先收准必读范围。");
  }
  return unique;
}

export const LongRequiredRuleSnapshotSchema = z
  .object({
    itemId: LongWorldbuildingItemIdSchema,
    fileId: LongFileIdSchema,
    title: z.string().trim().min(1).max(256),
    updatedAt: z.string().datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    content: z
      .string()
      .min(1)
      .max(LONG_REQUIRED_RULES_MAX_CHARACTERS * 2)
  })
  .strict();

export const LongRequiredRulesSnapshotSchema = z
  .array(LongRequiredRuleSnapshotSchema)
  .max(LONG_REQUIRED_RULES_MAX_ITEMS)
  .superRefine((rules, ctx) => {
    const ids = new Set<string>();
    let characters = 0;
    for (const rule of rules) {
      if (ids.has(rule.itemId)) {
        ctx.addIssue({ code: "custom", message: "必读规则绑定不能重复。" });
      }
      ids.add(rule.itemId);
      characters += Array.from(rule.content).length;
    }
    if (characters > LONG_REQUIRED_RULES_MAX_CHARACTERS) {
      ctx.addIssue({ code: "custom", message: "必读规则全文超过上下文容量。" });
    }
  });
