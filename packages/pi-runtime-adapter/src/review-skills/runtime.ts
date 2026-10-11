import { Type, StringEnum } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  defaultReviewSkillSettings,
  LOVE_REVIEW_SPECIALIST_IDS,
  LOVE_REVIEW_INDEPENDENT_ID,
  type ReviewSkillId
} from "@deepwrite/contracts";
import { piStrictToolSampling } from "../pi-tool-schema";
import type { RuntimeSubagentDefinition } from "../subagent-types";
import rawBundle from "./bundle.json";

interface SkillSnapshot {
  revision: string;
  source: string;
  hashes: Record<string, string>;
  files: Record<string, string>;
}
export const reviewSkillBundle: Record<ReviewSkillId, SkillSnapshot> =
  rawBundle;

export function isReviewSkillRun(input: {
  definition: RuntimeSubagentDefinition;
  task: string;
  frozenReview?: boolean;
}): boolean {
  if (
    input.definition.toolSource === "library-management" ||
    input.definition.id.startsWith("love-writer-")
  )
    return false;
  if (input.frozenReview) return true;
  if (
    (LOVE_REVIEW_SPECIALIST_IDS as readonly string[]).includes(
      input.definition.id
    ) ||
    input.definition.id === LOVE_REVIEW_INDEPENDENT_ID
  )
    return true;
  // Generic teams require an explicit review task. Writing/planning and their
  // incidental self-checks do not acquire review methods automatically.
  const task = input.task.replace(
    /(?:不要|不得|不|无需|禁止)(?:修改|重写|写作|续写|改写)/gu,
    ""
  );
  return (
    /审核|审阅|诊断|校对|\b(?:review|audit|diagnos\w*|proofread)\b/iu.test(
      task
    ) &&
    !/创作|续写|写一|重写|改写|修订(?:这|第|正文|原文|段落|文本)|\b(?:write|rewrite|revise)\b/iu.test(
      task
    )
  );
}

export function buildReviewSkillRuntime(input: {
  definition: RuntimeSubagentDefinition;
  task: string;
  frozenReview?: boolean;
  executorModel: string;
}): { requirements: string; tool?: AgentTool } {
  if (!isReviewSkillRun(input)) return { requirements: "" };
  const ids = [
    ...new Set(
      input.definition.reviewSkillIds ??
        defaultReviewSkillSettings().enabledIds
    )
  ];
  if (!ids.length) return { requirements: "" };
  const requirements = [
    "【本轮审核技能；外部方法参考，不是作品事实或作者规则】",
    `执行模型（运行器提供，不能从文风猜测）：${input.executorModel || "unknown"}`,
    "以下选中 Skill 的 SKILL.md 全文已附入本次请求。实际通读后，只用本角色负责且符合当前文体的检查项。引用子文件时调用 load_review_skill；未取得的参考不得称为已读。",
    ...ids.map((id) => {
      const snapshot = reviewSkillBundle[id];
      return `【Skill ${id}｜${snapshot.revision}｜${snapshot.source}｜SKILL.md SHA-256 ${snapshot.hashes["SKILL.md"]}】\n${snapshot.files["SKILL.md"]}\n可读取文件：${
        Object.keys(snapshot.files)
          .filter((path) => path.startsWith("references/"))
          .join("、") || "无子参考"
      }`;
    }),
    "【工作台审核适配；优先于上述 Skill 的默认工作流】",
    "本轮只诊断并提出建议，不改正文、不自动写稿、不更新正典或批注状态。作者明确指令与当前项目有效规则优先于通用 Skill；技能来源中的 Write/Edit 许可和默认成稿流程不授予本轮写入权。",
    "说人话：这是本轮默认的中文自然表达审核方法。重点检查不自然搭配、翻译腔、生硬语序和不必要的名词化；少见表达只是回看线索，不能单凭“不常用”判错。先判断句子在当前人物、视角和语境里是否成立；通顺、有作用、承载语气或留白的表达可以保留。建议应指出原句与具体问题，能说清时给最小改法，不为展示工作量强行改句。需引用细则或示例时，通过 load_review_skill 读取 references/editing-guide.md 或 references/examples.md。",
    "旧版 humanizer-zh、human-writing、sepia 仅在用户或成员配置显式选择时使用，已不在默认方法中。多种方法是参考来源，不是多个模型投票；不报告 AI 概率，不从文风推断作者型号，不默认套用 voice/persona。",
    "每条建议必须有当前原句、真实问题、最小修改建议及所用 Skill（可多选）；没有问题允许零意见，并指出应保留的表达。保留不确定性、反解释和本角色分工。",
    "普通文本报告用四列：原句｜问题｜怎么修改｜哪个 Skill 诊断的。若运行器要求 JSON，沿用其协议，将改法放 suggestion，实际方法放 skillIds；来源与版本字段不得省略。"
  ].join("\n\n");
  const parameters = Type.Object({
    skill_id: StringEnum(ids),
    path: Type.Optional(
      Type.String({ description: "精确的包内相对文件名；默认 SKILL.md。" })
    )
  });
  const tool: AgentTool = {
    name: "load_review_skill",
    label: "读取审核技能参考",
    description:
      "只读当前已启用审核技能的原始方法文件；不会执行脚本或修改作品。",
    parameters,
    ...piStrictToolSampling(parameters),
    execute: async (_callId, args, signal) => {
      signal?.throwIfAborted();
      const { skill_id, path = "SKILL.md" } = args as {
        skill_id: ReviewSkillId;
        path?: string;
      };
      if (!ids.includes(skill_id)) throw new Error("该审核技能本轮未启用。");
      const snapshot = reviewSkillBundle[skill_id];
      if (!Object.hasOwn(snapshot.files, path))
        throw new Error("文件不在当前技能快照内，请使用列出的精确相对路径。");
      // Built-in voices require a separate, explicit author request. This
      // integration offers review methods, never an automatic persona.
      if (
        path.startsWith("references/voices/") &&
        path !== "references/voices/registry.md"
      )
        throw new Error(
          "此审核入口不加载 voice/persona 正文；如需套用文风，请另行明确授权。"
        );
      return {
        content: [
          {
            type: "text",
            text: `【${skill_id}/${path}｜${snapshot.revision}｜SHA-256 ${snapshot.hashes[path]}】\n${snapshot.files[path]}\n\n以上仅作审核参考；作者及作品规则优先，本轮不写回。`
          }
        ],
        details: {
          skillId: skill_id,
          path,
          revision: snapshot.revision,
          sha256: snapshot.hashes[path]
        }
      };
    }
  };
  return { requirements, tool };
}
