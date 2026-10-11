/** Canonical persisted metadata, independent of prompts and runtime schemas. */
export const BUILTIN_AGENT_METADATA = {
  short: {
    label: "短篇智能体",
    description:
      "统一负责人物、动态剧情阶段和正文创作，并按当前阶段加载上下文。"
  },
  script: {
    label: "剧本智能体",
    description:
      "统一负责人物、动态剧情阶段和剧本正文创作，并按当前阶段加载上下文。"
  },
  long: {
    label: "长篇智能体",
    description:
      "围绕整本书讨论，并按需查询和维护各阶段内容。"
  },
  material: {
    label: "素材库管理智能体",
    description:
      "创建、修改、检索和整理当前素材库，维护条目名称、使用说明与库介绍。"
  },
  skill: {
    label: "技能库管理智能体",
    description:
      "创建、修改和管理可复用写作技能，维护方法步骤、使用说明与技能库索引。"
  }
} as const;

export const DEFAULT_LONG_AGENT_WELCOME_SHORTCUTS = [
  "讨论本书任何问题",
  "检查设定与剧情冲突",
  "梳理下一步创作"
] as const;
