import { z } from "zod";

export const CREATIVE_PLOT_STAGE_MAX_COUNT = 32;
export const CreativePlotStageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    "Plot stage ids may contain only letters, numbers, dots, underscores, colons, and hyphens."
  )
  .refine((value) => value !== "character_design" && value !== "draft", {
    message: "Plot stage ids cannot use reserved workspace stage ids."
  });
export type CreativePlotStageId = z.infer<typeof CreativePlotStageIdSchema>;

export const CreativePlotStageSchema = z
  .object({
    id: CreativePlotStageIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(20_000)
  })
  .strict();
export type CreativePlotStage = z.infer<typeof CreativePlotStageSchema>;

function refineUniqueCreativePlotStages(
  stages: ReadonlyArray<{ id: string; title: string }>,
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = new Set<string>();
  const titles = new Set<string>();
  stages.forEach((stage, index) => {
    if (ids.has(stage.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate plot stage id: ${stage.id}`
      });
    }
    ids.add(stage.id);
    const normalizedTitle = stage.title.toLocaleLowerCase();
    if (titles.has(normalizedTitle)) {
      context.addIssue({
        code: "custom",
        path: [index, "title"],
        message: `Duplicate plot stage title: ${stage.title}`
      });
    }
    titles.add(normalizedTitle);
  });
}

export const CreativePlotStagesSchema = z
  .array(CreativePlotStageSchema)
  .min(1)
  .max(CREATIVE_PLOT_STAGE_MAX_COUNT)
  .superRefine(refineUniqueCreativePlotStages);

/** Per-book binding: definition is global; order + enabled are book-local. */
export const BookPlotStageSchema = z
  .object({
    id: CreativePlotStageIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(20_000),
    enabled: z.boolean()
  })
  .strict();
export type BookPlotStage = z.infer<typeof BookPlotStageSchema>;

export const BookPlotStagesSchema = z
  .array(BookPlotStageSchema)
  .min(1)
  .max(CREATIVE_PLOT_STAGE_MAX_COUNT)
  .superRefine((stages, context) => {
    refineUniqueCreativePlotStages(stages, context);
    if (!stages.some((stage) => stage.enabled)) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "At least one plot stage must remain enabled."
      });
    }
  });

export const DEFAULT_CREATIVE_PLOT_STAGES = [
  {
    id: "worldbuilding",
    title: "世界观",
    description:
      "建立故事发生的世界背景、规则体系、地理时空、势力组织、科技或超自然设定，以及会影响人物选择与冲突推进的关键背景约束。只写服务于情节的设定，避免百科式堆砌；与已确认人物、剧情事实保持一致。"
  },
  {
    id: "plot_design",
    title: "剧情设计",
    description:
      "设计核心命题、人物目标、主要冲突、因果链、关键转折、真实时间线和结局兑现。每个重要情节点都要明确触发原因、人物选择、直接后果与后续压力，并区分故事真实时间线和读者看到的信息顺序。"
  },
  {
    id: "intro_design",
    title: "导语设计",
    description:
      "设计书名建议、开篇导语和前十秒钩子。导语必须与主线事实一致，建立人物处境、阅读期待与悬念，但不能替代完整剧情设计，也不能提前泄露尚不该公开的信息。"
  },
  {
    id: "plot_refine",
    title: "剧情细化",
    description:
      "把已确认剧情细化为可供正文直接执行的场景链、节拍、信息投放、人物选择、情绪推进、伏笔与回收。内容应具体到可写场景，同时保持因果、转折、人物状态与结局承诺一致，不直接写成小说正文。"
  },
  {
    id: "narrative_perspective",
    title: "叙事视角",
    description:
      "确定叙事人称、主要视角角色、时态、叙事距离与语言基调；明确读者和各人物在不同阶段的知识边界、可感知信息及视角切换规则，避免越过当前视角泄露未知事实。"
  },
  {
    id: "outline",
    title: "大纲",
    description:
      "把人物与全部剧情结构整理为可直接指导分节写作的完整大纲。保留已确认的人物、因果、时间线、关键情节和结局；列出全文定位、主线目标、核心冲突、正文小节总数与顺序，以及每节标题、字数、出场人物、场景、起始状态、详细剧情、关键选择、转折、信息投放、结尾钩子、人物状态变化和伏笔回收。发现冲突时应标明并采用最小改动方案。"
  }
] as const satisfies readonly CreativePlotStage[];

export const BUILTIN_CREATIVE_PLOT_STAGE_IDS = new Set<string>(
  DEFAULT_CREATIVE_PLOT_STAGES.map((stage) => stage.id)
);

/** Newly created short/script books enable only these three by default. */
export const DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS = new Set<string>([
  "plot_design",
  "intro_design",
  "plot_refine"
]);

export function isBuiltinCreativePlotStageId(stageId: string): boolean {
  return BUILTIN_CREATIVE_PLOT_STAGE_IDS.has(stageId);
}

export function createDefaultCreativePlotStages(): CreativePlotStage[] {
  return DEFAULT_CREATIVE_PLOT_STAGES.map((stage) => ({ ...stage }));
}

export function createDefaultBookPlotStages(options?: {
  /** Existing books migrate with every stage enabled. */
  allEnabled?: boolean;
  /** New books may override the built-in enabled-stage defaults. */
  enabledStageIds?: ReadonlySet<string> | readonly string[];
}): BookPlotStage[] {
  const allEnabled = options?.allEnabled === true;
  const enabledStageIds = new Set(
    options?.enabledStageIds ?? DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS
  );
  return DEFAULT_CREATIVE_PLOT_STAGES.map((stage) => ({
    ...stage,
    enabled: allEnabled || enabledStageIds.has(stage.id)
  }));
}

export function toCreativePlotStage(stage: BookPlotStage): CreativePlotStage {
  return {
    id: stage.id,
    title: stage.title,
    description: stage.description
  };
}

export function enabledCreativePlotStages(
  stages: readonly BookPlotStage[]
): CreativePlotStage[] {
  return stages.filter((stage) => stage.enabled).map(toCreativePlotStage);
}
