import {
  estimateTextTokens,
  type OtterRuntimeContext
} from "@deepwrite/contracts";

export function renderOtterRuntimeContext(
  context: OtterRuntimeContext
): string {
  return [
    "【本次会话固定 Context Pack：由当前作品 V1 执行器展开】",
    `项目：${context.projectId}；Context：${context.contextId}`,
    `完整性基线：${context.baselineHash}`,
    `比较基线：${context.comparisonBaselineHash ?? "unknown"}`,
    context.apiText
  ].join("\n");
}

/** The latest user turn carries the full pack. Recovery pins its identity;
 * older duplicate snapshots can be pruned without replacing the live pack. */
export async function rehydrateOtterContext(
  context: OtterRuntimeContext,
  budget: number
): Promise<string> {
  const full = renderOtterRuntimeContext(context);
  const identity = [
    `当前Context：${context.contextId}；项目：${context.projectId}`,
    `完整性基线：${context.baselineHash}；比较基线：${context.comparisonBaselineHash ?? "unknown"}`,
    "完整来源仍在本轮固定用户上下文中。压缩摘要中的猜想不得变成事实，故意未知保持未知。"
  ].join("\n");
  const text = estimateTextTokens(full) <= budget ? full : identity;
  if (estimateTextTokens(text) > budget) {
    throw new Error(
      "Context Pack 超过压缩恢复预算。请缩小本轮来源范围或选择容量更大的模型。"
    );
  }
  return text;
}
