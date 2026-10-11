import type {
  LongApprovedVoicePackageSnapshot,
  LongSelectedChapterOutlineSnapshot,
  LongSelectedDraftReferenceSnapshot
} from "@deepwrite/contracts";

/** Full, versioned author evidence supplied by Main, not a summary from a child. */
export function approvedVoiceContextText(
  packet: LongApprovedVoicePackageSnapshot | undefined
): string {
  if (!packet) return "";
  return [
    `【作者认可文风资料 ${packet.packageId}｜${packet.version}｜清单 ${packet.manifestSha256}】`,
    `适用范围：${packet.scope}`,
    ...Object.values(packet.runPolicy),
    "资料是作者样本与批语，不是写作授权或故事正典。通读全文后结合本轮任务；修改先指出问题及要保护的表达，不因罕见词或通用方法机械重写。",
    ...packet.sources.map(
      (source) =>
        `【${source.role}｜${source.title}｜${source.sourcePath}｜SHA-256 ${source.sha256}】\n${source.content}`
    )
  ].join("\n\n");
}

/** Explicit native chapter choices are reference material, never canon or acceptance. */
export function nativeWritingReferenceContextText(
  references: readonly LongSelectedDraftReferenceSnapshot[] | undefined,
  outline: LongSelectedChapterOutlineSnapshot | undefined
): string {
  if (!references?.length && !outline) return "";
  const parts = ["【作者显式选择的本轮写作参考｜仅供写作参考，不是新的故事事实、正典或作者接受稿】"];
  if (outline) parts.push(`【本章选用大纲｜${outline.version}｜${outline.path}｜SHA-256 ${outline.hash}】\n${outline.content}`);
  for (const reference of references ?? []) {
    const relation = reference.relation === "previous" ? "上一章参考，不是正典或接受" : "本章参考";
    parts.push(`【${relation}｜${reference.title}｜${reference.model}｜${reference.version}｜${reference.path}｜SHA-256 ${reference.hash}】\n${reference.content}`);
  }
  return parts.join("\n\n");
}
