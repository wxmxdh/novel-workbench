import type { LongWorkspaceIndexResult } from "@deepwrite/contracts";
import type { LongWorkspaceService } from "./long-workspace-service";

/** Core reads current native book sources, without other models' prose or archived projects. */
export async function readNativeComparisonEvidence(
  service: LongWorkspaceService,
  index: LongWorkspaceIndexResult["workspaceIndex"]
) {
  const bookId = index.bookId;
  const agents = await service.readAgentsMd({ bookId });
  if (agents.truncated) throw new Error("本书执行说明未能完整读取。");
  const chunks = [
    "# 当前 LOVE 原生资料运行快照\n保留原资料的未决、候选和知识边界，不因本次写作登记升级正典。",
    agents.content
  ];
  let size = agents.content.length;
  const files = index.worldbuilding.flatMap((category) =>
    category.format === "list"
      ? category.items.map((item) => ({ title: item.title, file: item.file }))
      : [{ title: category.title, file: category.file }]
  );
  files.push({
    title: "全书故事线（规划参考，不是叙述者当下已知）",
    file: index.bookLine
  });
  for (const entry of index.characterFiles) {
    const name =
      index.characters.find((character) => character.id === entry.characterId)
        ?.name ?? entry.characterId;
    files.push(
      { title: `${name} / 人物原文`, file: entry.coreProfile },
      { title: `${name} / 关系原文`, file: entry.relationships }
    );
  }
  for (const { title, file } of files) {
    let offset = 0;
    let total: number | undefined;
    const parts: string[] = [];
    let charactersRead = 0;
    for (;;) {
      const page = await service.readDocument({
        bookId,
        fileId: file.id,
        offset,
        maxCharacters: 32_768
      });
      if (
        page.offset !== offset ||
        page.bookId !== bookId ||
        page.file.id !== file.id ||
        page.file.path !== file.path ||
        page.file.updatedAt !== file.updatedAt ||
        (total !== undefined && total !== page.totalCharacters)
      )
        throw new Error("原生写作资料在读取中变化，请重新开始。");
      total = page.totalCharacters;
      if (size + total > 1_000_000)
        throw new Error("原生写作资料超出全文读取上限，本轮没有截断发送。");
      parts.push(page.content);
      charactersRead += Array.from(page.content).length;
      if (page.nextOffset === null) {
        if (charactersRead !== total)
          throw new Error("原生资料分页不完整，本轮未提交。");
        break;
      }
      if (page.nextOffset <= offset) throw new Error("写作来源分页游标异常。");
      offset = page.nextOffset;
    }
    const content = parts.join("");
    size += content.length;
    chunks.push(`\n## ${title}\n原生路径：${file.path}\n${content}`);
  }
  return chunks.join("\n");
}
