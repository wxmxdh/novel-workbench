import { createHash } from "node:crypto";
import {
  LONG_WORKSPACE_INDEX_PATH,
  LongImportedSourceSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  type LongImportSourceInput,
  type LongImportSourceResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import {
  commitLongProjectTransaction,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { type LongProjectStoreContext } from "./store-context";
import { MANIFEST_PATH, MAX_LEDGER_RECORD_BYTES } from "./types";
import { encodeUtf8Strict } from "./utf8";

const MAX_IMPORTED_SOURCE_BYTES = 2 * 1024 * 1024;

/** Store an exact, immutable copy of a user-confirmed source in long/sources. */
export async function importSource(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: LongImportSourceInput
): Promise<LongImportSourceResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    if (input.bookId !== loaded.book.id) {
      throw new Error("导入资料所属书籍与当前长篇项目不一致。");
    }
    if (input.expectedIndexUpdatedAt !== loaded.index.updatedAt) {
      throw new Error("预览后工作区资料已变化，请重新预览并确认导入。");
    }

    const bytes = encodeUtf8Strict(input.content);
    if (bytes.byteLength > MAX_IMPORTED_SOURCE_BYTES) {
      throw new Error("单份导入资料不能超过 2 MiB（UTF-8）。");
    }
    if (!input.content.trim()) throw new Error("资料不能为空。");

    const id = createId("source");
    const currentTimestamp = Date.parse(ctx.timestamp());
    const previousIndexTimestamp = Date.parse(loaded.index.updatedAt);
    const importedAt = new Date(
      Math.max(currentTimestamp, previousIndexTimestamp + 1)
    ).toISOString();
    const path = `long/sources/${id}.md`;
    const file = { id: createId("file"), path, updatedAt: importedAt };
    const source = LongImportedSourceSchema.parse({
      id,
      title: input.title,
      sourceName: input.sourceName,
      ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
      purpose: input.purpose,
      authority: input.authority,
      ...(input.purposeNote ? { purposeNote: input.purposeNote } : {}),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      importedAt,
      file
    });
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      importedSources: [...loaded.index.importedSources, source],
      updatedAt: importedAt
    });
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt: importedAt,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: importedAt
      }
    });

    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { path, content: input.content, expectedSha256: null },
        { path: LONG_WORKSPACE_INDEX_PATH, content: serializeJson(nextIndex) },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    return { bookId: loaded.book.id, source };
  });
}
