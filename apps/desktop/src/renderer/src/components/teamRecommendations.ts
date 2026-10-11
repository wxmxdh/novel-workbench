import type {
  LongAgentTeamSettingsInput,
  ModelConfig
} from "@deepwrite/contracts";
import { DEFAULT_LONG_AGENT_TEAM_SETTINGS } from "@deepwrite/contracts";

export interface TeamRoleRecommendation {
  id: "divergent" | "continuity" | "realism" | "viewpoint" | "scoring";
  name: string;
  roleName: string;
  description: string;
  systemPrompt: string;
  modelLabel: string | null;
  modelId: string | null;
  thinkingLevel: ModelConfig["defaultThinkingLevel"] | undefined;
  temperature: number | undefined;
  usage: string;
}

export interface TeamRecommendationApplyInput {
  name: string;
  settings: LongAgentTeamSettingsInput;
}

const PROJECT_AUTHORITY_RULES =
  "每次工作先遵守当前作品实际提供的项目说明、AGENTS.md、有效规则和所选大纲；项目明确表达的写作边界优先于本角色的一般方法。只有实际读取到的资料才能称为已核对；资料缺失或互相矛盾时指出路径/依据并标为待作者决定。只提交分析和可选建议，不代作者写正文、不修改文件、不把结论写成正式设定或正典。";

type PresetDefinition = Pick<
  TeamRoleRecommendation,
  "id" | "name" | "roleName" | "description" | "systemPrompt"
> & { modelPatterns: readonly RegExp[] };

const PRESETS: readonly PresetDefinition[] = [
  {
    id: "divergent",
    name: "情节发散",
    roleName: "情节可能性顾问",
    description: "围绕作者提出的问题，整理几条不同走向及各自代价。",
    modelPatterns: [/gemini[\s._-]*3[._-]?8.*flash/iu, /gemini.*flash/iu],
    systemPrompt:
      "负责发散情节与场景可能性。先复述作者本轮的目标和限制，再给出少量彼此真正不同的方案，说明每种方案对人物、节奏、后续情节的影响。不要为了反转而反转，不把自己提出的内容写成既定事实，不替作者选择。"
  },
  {
    id: "continuity",
    name: "逻辑与连续性",
    roleName: "逻辑与连续性核对员",
    description: "核对因果、时间、人物已知信息和前后文是否冲突。",
    modelPatterns: [/deepseek.*v4.*flash/iu, /deepseek/iu],
    systemPrompt:
      "负责逻辑和连续性核对。分开报告明确矛盾、需要补证的疑点、资料缺口与合理留白；每点写出对应原文或项目规则依据。不要用猜测补齐信息，也不要把人物的沉默或未知动机强行解释成矛盾。"
  },
  {
    id: "realism",
    name: "现实主义与人物表达",
    roleName: "现实感与人物表达审阅员",
    description: "观察细节、行为和情绪是否有文本依据、是否自然可信。",
    modelPatterns: [/claude.*opus/iu, /gemini.*flash/iu, /deepseek/iu],
    systemPrompt:
      "从现实感和人物表达角度审阅作者指定的材料。说明具体文字带来的阅读效果，区分可观察细节、文本已表达的心理和你的解释。尊重项目对视角、克制、留白、语气的要求；不要把某一种文学技巧当成通用标准，不替作者补写或润色正文。"
  },
  {
    id: "viewpoint",
    name: "叙述视角",
    roleName: "叙述视角核对员",
    description: "检查视角是否稳定、信息是否超出叙述者当下所知。",
    modelPatterns: [/claude.*opus/iu, /deepseek/iu, /gemini.*flash/iu],
    systemPrompt:
      "只检查作者指定文本的叙述视角和信息边界。标出视角线索、可能越界的位置及其他合理解释；依据项目明确要求判断，不假定全书必须采用某种视角。发现不确定时说明证据不足，不直接替作者改写。"
  },
  {
    id: "scoring",
    name: "量表评分",
    roleName: "分项评分审阅员",
    description: "按明确标准逐项评分，提供证据和不确定度，避免空泛总评。",
    modelPatterns: [/gpt[\s._-]*6[._-]?1.*sol/iu, /deepseek.*v4/iu],
    systemPrompt:
      "只有作者提供或项目明确规定评分量表时才评分；逐项引用依据并说明不确定处。没有标准就先询问或给出待作者确认的量表草案，不伪装客观分数，不用分数覆盖作者审美和项目目标。"
  }
];

function getConfiguredModels(models: readonly ModelConfig[]): ModelConfig[] {
  return models.filter((model) => model.hasApiKey && model.enabled !== false);
}

function findSuggestedModel(
  models: readonly ModelConfig[],
  patterns: readonly RegExp[]
): ModelConfig | undefined {
  const usable = getConfiguredModels(models);
  for (const pattern of patterns) {
    const match = usable.find((model) =>
      pattern.test(`${model.label} ${model.provider} ${model.modelId}`)
    );
    if (match) return match;
  }
  return undefined;
}

function preferredThinkingLevel(
  model: ModelConfig | undefined
): ModelConfig["defaultThinkingLevel"] | undefined {
  if (!model) return undefined;
  if (
    model.defaultThinkingLevel === "off" ||
    model.thinkingLevelOptions.includes(model.defaultThinkingLevel)
  ) {
    return model.defaultThinkingLevel;
  }
  return model.thinkingLevelOptions[0] ?? "off";
}

export function buildTeamRecommendations(
  models: readonly ModelConfig[]
): TeamRoleRecommendation[] {
  return PRESETS.map((preset) => {
    const model = findSuggestedModel(models, preset.modelPatterns);
    return {
      id: preset.id,
      name: preset.name,
      roleName: preset.roleName,
      description: preset.description,
      systemPrompt: `${preset.systemPrompt}\n\n${PROJECT_AUTHORITY_RULES}`,
      modelLabel: model?.label ?? null,
      modelId: model?.id ?? null,
      thinkingLevel: preferredThinkingLevel(model),
      temperature: model?.temperatureOptions[1] ?? model?.temperatureOptions[0],
      usage: model
        ? `建议使用「${model.label}」。这里只按已启用且已配置密钥的模型名称匹配，职责建议不代表能力保证。`
        : "没有匹配到可用模型，创建后先沿用主智能体模型；你可以再手动选择。"
    };
  });
}

export function uniqueTeamName(
  baseName: string,
  existingNames: readonly string[]
): string {
  const existing = new Set(
    existingNames.map((name) => name.toLocaleLowerCase())
  );
  if (!existing.has(baseName.toLocaleLowerCase())) return baseName;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${baseName} ${Date.now()}`;
}

export function buildLongTeamPresetSettings(
  recommendation: TeamRoleRecommendation,
  projectNote: string
): LongAgentTeamSettingsInput {
  return buildLongTeamSettings([
    buildPresetSubagent(recommendation, projectNote)
  ]);
}

export function buildCombinedLongTeamPresetSettings(
  recommendations: readonly TeamRoleRecommendation[],
  projectNote: string
): LongAgentTeamSettingsInput {
  if (
    new Set(recommendations.map(({ id }) => id)).size !== recommendations.length
  ) {
    throw new Error("综合团队中不能重复添加同一职责。");
  }
  return buildLongTeamSettings(
    recommendations.map((recommendation) =>
      buildPresetSubagent(recommendation, projectNote)
    )
  );
}

function buildPresetSubagent(
  recommendation: TeamRoleRecommendation,
  projectNote: string
) {
  const note = projectNote.trim();
  const systemPrompt = note
    ? `${recommendation.systemPrompt}\n\n【作者补充的团队通用说明；本团队在其它作品中使用时也会带上。当前对话Context里实际提供的本作品project-profile和rules优先于这段通用说明；未实际收到的资料不要声称读过】\n${note}`
    : recommendation.systemPrompt;
  const hasCustomModel = Boolean(recommendation.modelId);
  return {
    id: `preset-${recommendation.id}`,
    name: recommendation.roleName,
    description: recommendation.description,
    systemPrompt,
    enabled: true,
    modelMode: hasCustomModel ? ("custom" as const) : ("inherit" as const),
    ...(recommendation.modelId ? { modelId: recommendation.modelId } : {}),
    ...(recommendation.thinkingLevel !== undefined
      ? { thinkingLevel: recommendation.thinkingLevel }
      : {}),
    ...(recommendation.thinkingLevel === "off" &&
    recommendation.temperature !== undefined
      ? { temperature: recommendation.temperature }
      : {})
  };
}

function buildLongTeamSettings(
  subagents: ReturnType<typeof buildPresetSubagent>[]
): LongAgentTeamSettingsInput {
  return {
    ...DEFAULT_LONG_AGENT_TEAM_SETTINGS,
    teams: DEFAULT_LONG_AGENT_TEAM_SETTINGS.teams.map((team) =>
      team.parentAgentId === "long"
        ? { ...team, subagents }
        : { ...team, subagents: [...team.subagents] }
    )
  };
}
