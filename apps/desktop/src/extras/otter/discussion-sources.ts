import type { OtterProjectAdapter } from "./project-adapter";

/** Resolve declared project sources. Neither filenames nor version numbers select authority. */
export async function discussionSources(
  adapter: OtterProjectAdapter,
  projectId: string,
  config: { project: string; chapter_state?: string },
  targetPath?: string,
  includePeople = false
) {
  const view = await adapter.openProject(projectId);
  const target = view.documents.find((item) => item.path === targetPath);
  if (targetPath && !target)
    throw new Error("审阅文件不在当前项目目录，请重新选择。");
  const sources: Array<{
    path: string;
    role: string;
    section: string;
    authority?: string;
    purpose?: string;
    entities?: string[];
    line_start?: number;
    line_end?: number;
  }> = [];
  if (target)
    sources.push({ path: target.path, role: "text", section: "full-source" });
  if (includePeople) {
    for (const item of view.documents.filter(
      (item) =>
        ["character", "relationship"].includes(item.category) &&
        !/(^|\/)index\.md$/i.test(item.path) &&
        !/(^|\/)(?:archive|archived|history|backup|backups|归档|历史|备份)(?:\/|$)/i.test(
          item.path
        ) &&
        !/historical|archive|backup|retired|stale|partial/i.test(item.status)
    )) {
      sources.push({
        path: item.path,
        role: item.category,
        section: "full-source"
      });
    }
  }
  let chapter: number | undefined;
  let volume: string | undefined;
  let volumeConfirmation: unknown;
  if (target && config.chapter_state) {
    const state = JSON.parse(
      (await adapter.readDocument(projectId, config.chapter_state)).content
    );
    if (
      state.project !== config.project ||
      state.schema_version !== 1 ||
      !Array.isArray(state.chapters)
    )
      throw new Error("章节登记格式错误或不属于当前项目。");
    const number = Number(target.chapter?.match(/\d+/)?.[0]);
    const entries = state.chapters.filter(
      (entry: {
        status?: string;
        chapter: number;
        volume: string;
        selected_outline?: { path: string };
      }) =>
        entry.status !== "retired" &&
        (entry.selected_outline?.path === target.path ||
          (Number.isInteger(number) &&
            number > 0 &&
            Number(entry.chapter) === number &&
            (!target.volume || entry.volume === target.volume)))
    );
    if (entries.length > 1)
      throw new Error("审阅文件的卷章有多个登记，请明确卷次后再开始。");
    if (entries.length === 1) {
      const entry = entries[0];
      chapter = Number(entry.chapter);
      volume = entry.volume;
      volumeConfirmation = entry.volume_confirmation;
      sources.push({
        path: config.chapter_state,
        role: "chapter-state",
        section: "full-source"
      });
      // V1 itself checks the selected outline hash and author selection evidence,
      // and reads the complete original. Do not duplicate or synthesize that proof here.
    }
  }
  if (sources.length > 30)
    throw new Error(
      "本轮自动资料超过30份，请缩小审阅范围或分轮讨论；不会静默丢掉资料。"
    );
  return { sources, chapter, volume, volumeConfirmation };
}
