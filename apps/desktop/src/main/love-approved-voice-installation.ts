import { createHash } from "node:crypto";
import {
  CommandEnvelopeSchema,
  LongListBooksResultSchema,
  LongWorkspaceIndexResultSchema,
  LongImportSourceResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import bundle from "./love-approved-voice-bundle";
import type { LoveApprovedVoiceBundle } from "./love-approved-voice-bundle";

/** Uses Core's normal import and revision checks; existing documents are never replaced. */
export async function installLoveApprovedVoicePackage(
  requestCore: (command: CommandEnvelope) => Promise<CommandResult>,
  voiceBundle: LoveApprovedVoiceBundle = bundle
) {
  if (voiceBundle.files.length === 0)
    return { status: "package-not-included", imported: 0 } as const;
  const query = async (type: string, payload: object) => {
    const reply = await requestCore(
      CommandEnvelopeSchema.parse(
        createEnvelope(type, payload, { id: createId("voice-package-install") })
      )
    );
    if (reply.status !== "accepted") throw new Error(reply.error.message);
    return reply.payload;
  };
  const books = LongListBooksResultSchema.parse(await query("long.list", {}));
  if (!books.books.some((book) => book.id === voiceBundle.bookId))
    return { status: "book-not-registered", imported: 0 };
  let imported = 0;
  for (const source of voiceBundle.files) {
    const hash = createHash("sha256")
      .update(source.content, "utf8")
      .digest("hex");
    if (hash !== source.sha256) throw new Error("认可资料打包内容校验失败。");
    const { workspaceIndex } = LongWorkspaceIndexResultSchema.parse(
      await query("long.getWorkspaceIndex", { bookId: voiceBundle.bookId })
    );
    const matching = workspaceIndex.importedSources.filter(
      (item) =>
        item.sourcePath === source.sourcePath || item.title === source.title
    );
    if (matching.length) {
      if (
        matching.length !== 1 ||
        matching[0]!.sourceSha256 !== source.sha256 ||
        matching[0]!.sourcePath !== source.sourcePath ||
        matching[0]!.title !== source.title
      )
        throw new Error(
          `已存在的认可资料与安装包不同，保留原文并停止导入：${source.title}`
        );
      continue;
    }
    const result = LongImportSourceResultSchema.parse(
      await query("long.importSource", {
        bookId: voiceBundle.bookId,
        title: source.title,
        sourceName: source.sourcePath.split("/").at(-1),
        sourcePath: source.sourcePath,
        content: source.content,
        purpose: "reference",
        authority: "reference",
        purposeNote:
          "作者认可的文风样本及具体批语；适用边界以资料包为准，不登记故事正典，不授予正文生成或修改权限。",
        expectedIndexUpdatedAt: workspaceIndex.updatedAt
      })
    );
    if (result.source.sourceSha256 !== source.sha256)
      throw new Error(`Core导入字节与认可资料不符：${source.title}`);
    imported++;
  }
  return { status: "installed", imported, packageId: voiceBundle.packageId };
}
