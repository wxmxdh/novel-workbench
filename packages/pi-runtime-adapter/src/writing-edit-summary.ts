export const WRITING_EDIT_SUMMARY_DESCRIPTION =
  "建议提供本次改动的一句话说明，会显示在审批卡上；可省略，省略或留空时系统根据目标和操作生成说明。";

export function resolveWritingEditSummary(
  summary: string | undefined,
  title: string,
  params: { content?: unknown; replacements?: unknown; meta?: unknown }
): string {
  const provided = summary?.trim();
  if (provided) return provided;
  const hasContent =
    params.content !== undefined || params.replacements !== undefined;
  const action =
    params.content === "" ? "清空" : params.replacements ? "局部修改" : "更新";
  const scope = hasContent
    ? params.meta
      ? params.content === ""
        ? "内容并更新属性"
        : "内容及属性"
      : "内容"
    : "属性";
  return `${action}《${title.slice(0, 800)}》的${scope}`;
}
