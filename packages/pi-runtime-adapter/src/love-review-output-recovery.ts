import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { LoveReviewSnapshot } from "@deepwrite/contracts";
import { readAssistantText } from "./subagent-helpers";
import { loveReviewEvidenceSources } from "./love-review-runtime";
import { validateLoveReviewReport } from "./love-review-report";

/** One bounded correction request; never manufacture a coverage declaration. */
export function loveReviewCorrectionPrompt(
  message: AssistantMessage | undefined,
  snapshot: LoveReviewSnapshot,
  supplementalSources: readonly { id: string; content: string }[] = []
): string | undefined {
  if (
    !message ||
    message.stopReason === "error" ||
    message.stopReason === "aborted"
  )
    return undefined;
  const sources = loveReviewEvidenceSources(snapshot, supplementalSources);
  const checked = validateLoveReviewReport(readAssistantText(message), sources);
  if (message.stopReason !== "length" && checked.ok) return undefined;
  const reason =
    message.stopReason === "length"
      ? "上一条输出达到长度上限，尚未交付完整报告。"
      : checked.ok
        ? "需要完整报告。"
        : checked.reason;
  return [
    "【本运行唯一一次报告补交】",
    reason,
    "冻结全文仍在当前上下文，沿用原审阅范围与原版本，不重新搜旧项目、不换审聊天合稿。",
    `本轮全部可核对 ID（包含待审稿，不能只列依据）：${JSON.stringify(sources.map(({ id }) => id))}`,
    "请立即交付一个简短、完整的 JSON 审阅报告，使用 status、summary、findings、missingSources、reviewedSourceIds。只保留本维度主要发现，不追求穷尽。原句逐字引用，分类与范围遵循现有协议。",
    "实际完成阅读和审查才声明 reviewed 并列出全部已覆盖 ID；缺读或无法完成就声明 incomplete，逐项列明缺项。不要为了通过格式校验补造阅读或意见。不要输出推理过程、Markdown 前后说明或角色代言。"
  ].join("\n");
}
