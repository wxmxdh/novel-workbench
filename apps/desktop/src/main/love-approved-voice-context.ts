import { createHash } from "node:crypto";
import { createId } from "@deepwrite/shared";
import {
  CommandEnvelopeSchema,
  LongImportedSourceSchema,
  LongReadDocumentResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

type CoreRequest = (command: CommandEnvelope) => Promise<CommandResult>;

const LOVE_BOOK_ID = "longbook_9a146bbe";
const PACKAGE_ID = "LOVE-voice-2026-10-10-v1.0";
const VERSION = "v1.0";
const SOURCES = [
  {
    role: "manifest" as const,
    title: "LOVE 文风认可包清单 v1.0",
    sourcePath:
      "codex-approved-style/LOVE-voice-2026-10-10-v1.0/manifest.json",
    sha256:
      "AB2E53236B9AEE2EAA1D8088BE91CA563CB108F087C507FDA0B60D6E96EDBA38"
  },
  {
    role: "approved-style-sample" as const,
    title: "LOVE 第一章整体认可样本 v1.0",
    sourcePath:
      "codex-approved-style/LOVE-voice-2026-10-10-v1.0/第一章_整体认可稿.md",
    sha256:
      "A57D160AFAEDBABE0C6521D9436E9AFD23775B364DDF94CE8C671B1F0E8CAEF5"
  },
  {
    role: "author-style-feedback" as const,
    title: "LOVE 作者批语及适用边界 v1.0",
    sourcePath:
      "codex-approved-style/LOVE-voice-2026-10-10-v1.0/作者批语与适用边界.md",
    sha256:
      "6A1C57727BBD68B6BDBCF529DDF13860991DC2C8C9A1FED7C007634F5BCE2E36"
  }
];

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function requiredSources(index: unknown) {
  if (!index || typeof index !== "object")
    throw new Error("Core未返回LOVE认可文风资料索引。");
  const value = index as {
    bookId?: unknown;
    workspaceIndex?: {
      bookId?: unknown;
      importedSources?: unknown;
    };
  };
  if (
    value.bookId !== LOVE_BOOK_ID ||
    value.workspaceIndex?.bookId !== LOVE_BOOK_ID ||
    !Array.isArray(value.workspaceIndex.importedSources)
  )
    throw new Error("读取LOVE认可文风资料时作品索引不匹配。");
  const imported = value.workspaceIndex.importedSources.map((source) =>
    LongImportedSourceSchema.parse(source)
  );
  return SOURCES.map((expected) => {
    const found = imported.filter(
      (source) =>
        source.title === expected.title &&
        source.sourcePath === expected.sourcePath
    );
    if (found.length !== 1)
      throw new Error(
        `LOVE认可文风资料缺失或重复：${expected.title}；请通过工作台Core来源导入刷新。`
      );
    const source = found[0]!;
    if (source.sourceSha256?.toLowerCase() !== expected.sha256.toLowerCase())
      throw new Error(
        `LOVE认可文风资料版本/hash不匹配：${expected.title}；本轮已停止，需刷新整包。`
      );
    return { ...expected, source };
  });
}

async function readFullDocument(
  bookId: string,
  source: (typeof SOURCES)[number] & {
    source: ReturnType<typeof LongImportedSourceSchema.parse>;
  },
  query: (type: string, payload: object) => Promise<unknown>
) {
  const chunks: string[] = [];
  let offset = 0;
  let totalCharacters: number | undefined;
  while (true) {
    const page = LongReadDocumentResultSchema.parse(
      await query("long.readDocument", {
        bookId,
        fileId: source.source.file.id,
        offset,
        maxCharacters: 32_768
      })
    );
    if (
      page.bookId !== bookId ||
      page.file.id !== source.source.file.id ||
      page.offset !== offset ||
      page.file.updatedAt !== source.source.file.updatedAt ||
      (totalCharacters !== undefined && page.totalCharacters !== totalCharacters)
    )
      throw new Error(
        `LOVE认可文风资料在读取过程中发生变化：${source.title}；请重新发送。`
      );
    totalCharacters = page.totalCharacters;
    chunks.push(page.content);
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  const content = chunks.join("");
  if (!content.trim() || sha256(content) !== source.sha256.toLowerCase())
    throw new Error(
      `LOVE认可文风资料全文hash校验失败：${source.title}；本轮已停止。`
    );
  return content;
}

/**
 * Replaces renderer-supplied style snapshots with a fresh Core read. A missing
 * package blocks only an explicitly writing/revision run; discussions remain
 * available without the style packet.
 */
export async function prepareLoveApprovedVoiceContext(
  context: WorkspaceRuntimeContext | undefined,
  request: CoreRequest,
  options: { required: boolean }
): Promise<WorkspaceRuntimeContext | undefined> {
  const workspace = context?.longWorkspace;
  if (!context || !workspace) return context;
  const { approvedVoicePackage: _untrusted, ...trustedRest } = workspace;
  if (workspace.bookId !== LOVE_BOOK_ID)
    return { ...context, longWorkspace: trustedRest };
  if (!options.required) return { ...context, longWorkspace: trustedRest };

  const query = async (type: string, payload: object) => {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(type, payload, { id: createId("love-approved-style-read") })
    );
    const reply = await request(command);
    if (reply.status !== "accepted") throw new Error(reply.error.message);
    return reply.payload;
  };
  const index = await query("long.getWorkspaceIndex", {
    bookId: workspace.bookId
  });
  const resolved = requiredSources(index);
  const contents: string[] = [];
  for (const source of resolved)
    contents.push(await readFullDocument(workspace.bookId, source, query));

  const checked = requiredSources(
    await query("long.getWorkspaceIndex", { bookId: workspace.bookId })
  );
  if (
    checked.some(
      (source, index) =>
        source.source.id !== resolved[index]!.source.id ||
        source.source.file.id !== resolved[index]!.source.file.id ||
        source.source.sourceSha256 !== resolved[index]!.source.sourceSha256 ||
        source.source.file.updatedAt !== resolved[index]!.source.file.updatedAt
    )
  )
    throw new Error("LOVE认可文风资料导入版本在读取期间变化，请重新发送。");

  const manifest = JSON.parse(contents[0]!) as {
    package_id?: unknown;
    project?: unknown;
    status?: unknown;
    scope?: { description?: unknown };
    run_policy?: Record<string, unknown>;
    sources?: Array<{ path?: unknown; role?: unknown; sha256?: unknown }>;
    workbench_binding?: {
      book_id?: unknown;
      manifest?: { title?: unknown; source_path?: unknown };
      documents?: Array<{
        path?: unknown;
        title?: unknown;
        source_path?: unknown;
      }>;
    };
  };
  if (
    manifest.package_id !== PACKAGE_ID ||
    manifest.project !== "LOVE" ||
    manifest.status !== "author-approved-sample" ||
    manifest.workbench_binding?.book_id !== LOVE_BOOK_ID ||
    manifest.workbench_binding.manifest?.title !== SOURCES[0]!.title ||
    manifest.workbench_binding.manifest.source_path !== SOURCES[0]!.sourcePath ||
    manifest.sources?.length !== 2 ||
    !Array.isArray(manifest.workbench_binding.documents) ||
    manifest.workbench_binding.documents.length !== 2
  )
    throw new Error("LOVE认可文风清单内容与本轮绑定不匹配，请刷新整包。");
  for (let index = 1; index < SOURCES.length; index++) {
    const source = SOURCES[index]!;
    const listed = manifest.sources.find(
      (item) => item.path === source.sourcePath.split("/").at(-1)
    );
    const binding = manifest.workbench_binding.documents.find(
      (item) => item.source_path === source.sourcePath
    );
    if (
      !listed ||
      listed.sha256 !== source.sha256 ||
      binding?.title !== source.title ||
      binding.path !== source.sourcePath.split("/").at(-1)
    )
      throw new Error(`LOVE认可文风清单中来源hash/路径不匹配：${source.title}`);
  }
  const runPolicy = manifest.run_policy;
  if (
    !runPolicy ||
    typeof runPolicy.sample_use !== "string" ||
    typeof runPolicy.draft !== "string" ||
    typeof runPolicy.revision !== "string" ||
    typeof runPolicy.feedback_scope !== "string" ||
    typeof manifest.scope?.description !== "string"
  )
    throw new Error("LOVE认可文风清单缺少本轮适用边界。");

  return {
    ...context,
    longWorkspace: {
      ...trustedRest,
      approvedVoicePackage: {
        packageId: PACKAGE_ID,
        version: VERSION,
        manifestSha256: SOURCES[0]!.sha256.toLowerCase(),
        scope: manifest.scope.description,
        runPolicy: {
          sampleUse: runPolicy.sample_use,
          draft: runPolicy.draft,
          revision: runPolicy.revision,
          feedbackScope: runPolicy.feedback_scope
        },
        sources: resolved.map((source, index) => ({
          role: source.role,
          title: source.title,
          sourcePath: source.sourcePath,
          sourceId: source.source.id,
          fileId: source.source.file.id,
          updatedAt: source.source.file.updatedAt,
          sha256: source.sha256.toLowerCase(),
          content: contents[index]!
        }))
      }
    }
  };
}
