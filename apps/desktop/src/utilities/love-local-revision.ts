import { createHash } from "node:crypto";
import type { LoveLocalRevisionPatch } from "@deepwrite/contracts";

export interface LoveLocalRevisionPatchPreview {
  oldText: string;
  newText: string;
  reason: string;
  occurrence: number;
  start: number;
  end: number;
}

export interface LoveLocalRevisionPreview {
  sourceSha256: string;
  outputSha256: string;
  content: string;
  patches: LoveLocalRevisionPatchPreview[];
}

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function occurrencesOf(source: string, search: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (from <= source.length - search.length) {
    const index = source.indexOf(search, from);
    if (index < 0) break;
    positions.push(index);
    from = index + search.length;
  }
  return positions;
}

function proseStart(source: string): number {
  const openingStart = source.startsWith("\uFEFF") ? 1 : 0;
  if (
    !source.startsWith("---\n", openingStart) &&
    !source.startsWith("---\r\n", openingStart)
  )
    return openingStart;
  const openingEnd = source.indexOf("\n") + 1;
  const closing = /^(?:---|\.\.\.)[ \t]*\r?$/gmu;
  closing.lastIndex = openingEnd;
  const match = closing.exec(source);
  if (!match) throw new Error("底稿 YAML frontmatter 未闭合；局部修订已停止。");
  const afterFence = match.index + match[0].length;
  return source[afterFence] === "\n"
    ? afterFence + 1
    : source[afterFence] === "\r" && source[afterFence + 1] === "\n"
      ? afterFence + 2
      : afterFence;
}

/**
 * Validates and previews exact-text local revisions without touching disk.
 * Every target is located against the same immutable source so patches cannot
 * accidentally begin matching text produced by another patch.
 */
export function previewLoveLocalRevision(input: {
  source: string;
  expectedSourceSha256: string;
  patches: readonly LoveLocalRevisionPatch[];
}): LoveLocalRevisionPreview {
  const sourceSha256 = sha256(input.source);
  if (sourceSha256 !== input.expectedSourceSha256)
    throw new Error("底稿版本已变化；局部修订预览已停止，请重新读取底稿。");
  if (input.source.length === 0 || input.source.length > 200_000)
    throw new Error("底稿为空或超过局部修订范围上限。");
  if (input.patches.length === 0 || input.patches.length > 100)
    throw new Error("局部修订必须包含 1 到 100 条具体修改。");

  const bodyStart = proseStart(input.source);
  const body = input.source.slice(bodyStart);
  if (!body.trim()) throw new Error("底稿没有可局部修订的正文。");

  const located = input.patches.map((patch, index) => {
    if (!patch.oldText.trim() || !patch.reason.trim())
      throw new Error(`第 ${index + 1} 条修改缺少原句或理由。`);
    const bodyPositions = occurrencesOf(body, patch.oldText);
    const positions = bodyPositions.map((position) => position + bodyStart);
    if (positions.length === 0)
      throw new Error(
        `第 ${index + 1} 条原句不在正文中（或只出现在 YAML 元数据中）；没有应用任何修改。`
      );
    const occurrence = patch.occurrence ?? (positions.length === 1 ? 1 : 0);
    if (!occurrence)
      throw new Error(
        `第 ${index + 1} 条原句在底稿中出现 ${positions.length} 次；请明确 occurrence 后重试。`
      );
    if (occurrence > positions.length)
      throw new Error(
        `第 ${index + 1} 条指定了第 ${occurrence} 处，但底稿只有 ${positions.length} 处。`
      );
    const start = positions[occurrence - 1]!;
    return {
      oldText: patch.oldText,
      newText: patch.newText,
      reason: patch.reason,
      occurrence,
      start,
      end: start + patch.oldText.length
    } satisfies LoveLocalRevisionPatchPreview;
  });

  const ordered = [...located].sort((left, right) => left.start - right.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.start < previous.end)
      throw new Error("局部修改范围相互重叠；请合并或缩小修改范围后重试。");
  }

  let bodyCursor = bodyStart;
  let coversWholeBody = true;
  for (const patch of ordered) {
    if (input.source.slice(bodyCursor, patch.start).trim()) {
      coversWholeBody = false;
      break;
    }
    bodyCursor = patch.end;
  }
  if (input.source.slice(bodyCursor).trim()) coversWholeBody = false;
  if (coversWholeBody)
    throw new Error(
      "局部修订不能替换完整正文；请通过再创作流程处理整段或整章重写。"
    );

  let content = input.source;
  for (const patch of [...ordered].reverse()) {
    content =
      content.slice(0, patch.start) + patch.newText + content.slice(patch.end);
  }
  if (content.trim().length === 0 || content.length > 200_000)
    throw new Error("局部修改结果为空或超过交付上限。");

  return {
    sourceSha256,
    outputSha256: sha256(content),
    content,
    patches: ordered
  };
}
