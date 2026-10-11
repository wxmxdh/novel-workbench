import { assertRevisionAnalysisBudget } from "../revision-analysis-budget";
import { assertShortAnalysisBudget } from "../short-book-analysis-budget";
import { assertStyleComparisonBudget } from "../style-comparison";
import type { ExtrasAgentResolvedTask } from "./tasks";
import { estimateTextTokens } from "../token-estimate";
import { MODEL_MINIMUM_CONTEXT_OUTPUT_GAP } from "../model-configuration";

interface ModelCapacity {
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
}

/**
 * Rejects inputs that cannot fit the model without truncation. Renderer runs
 * it for early feedback; Main and the Agent Utility re-check authoritatively.
 */
export function assertExtrasAgentBudget(
  task: ExtrasAgentResolvedTask,
  model: ModelCapacity | undefined
): void {
  if (
    model?.contextWindow !== undefined &&
    model.maxTokens !== undefined &&
    model.contextWindow - model.maxTokens < MODEL_MINIMUM_CONTEXT_OUTPUT_GAP
  ) {
    throw new Error(
      `模型容量设置冲突：上下文总量为 ${model.contextWindow.toLocaleString()} token，最高输出为 ${model.maxTokens.toLocaleString()} token。两者至少要相差 8,192 token（4,096 留给运行提示，至少 4,096 留给输入）。请到模型高级配置调整；这些数字代表不同限制，不是两块可相加的内存。`
    );
  }
  switch (task.agentId) {
    case "revision-analysis":
      if (!model) throw new Error("请选择可用模型。");
      assertRevisionAnalysisBudget(task.input, task.profile, model);
      return;
    case "short-book-analysis":
      if (!model) throw new Error("请选择可用模型。");
      assertShortAnalysisBudget(task.input, task.profile, model);
      return;
    case "long-book-analysis":
      // The Renderer pipeline sizes each batch to the model before sending it.
      return;
    case "style-comparison":
      if (model) assertStyleComparisonBudget(task.input, task.profile, model);
      return;
    case "chat-normal":
      if (task.input.otterContext && model?.contextWindow) {
        const fixed = estimateTextTokens(
          task.input.otterContext.apiText + task.profile.systemPrompt
        );
        const available =
          model.contextWindow - (model.maxTokens ?? 4096) - 4096;
        if (fixed > available)
          throw new Error(
            "Context Pack 超过模型可用上下文，请缩小来源范围；资料不能静默截断。"
          );
      }
      return;
    case "chat-project":
    case "chat-roleplay":
      // Chat history is bounded by the conversation schema instead.
      return;
  }
}
