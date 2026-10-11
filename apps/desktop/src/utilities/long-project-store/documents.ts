import { createHash } from "node:crypto";
import {
  DEFAULT_LONG_AGENTS_MD,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_AGENTS_MD_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  LongFileIdSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longAgentsMdCharacterCount
} from "@deepwrite/contracts";
import { sliceAgentsMdContent, tryReadAgentsMdFile } from "./agents-md";
import { loadIndexedFile, sliceIndexedUnicodeCodePointPage } from "./cache";
import { assertDirectlyMutableDocument } from "./integrity";
import {
  boundedPositiveInteger,
  commitLongProjectTransaction,
  nonnegativeInteger,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { updateChapterBodyStatus } from "./paths";
import { loadPublicPagedIndexedFile } from "./public-file-read";
import { encodeUtf8Strict } from "./utf8";
import type { LongProjectStoreContext } from "./store-context";
import {
  DEFAULT_READ_PAGE_CHARACTERS,
  MANIFEST_PATH,
  MAX_DOCUMENT_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  MAX_READ_PAGE_CHARACTERS,
  type OpenedLongBook,
  type ReadLongDocumentInput,
  type ReadLongDocumentResult,
  type RenameLongBookInput,
  type UpdateLongBookBindingsInput,
  type WriteLongDocumentInput,
  type WriteLongDocumentResult
} from "./types";

export async function openBook(
  ctx: LongProjectStoreContext,
  projectDirectory: string
): Promise<OpenedLongBook> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    return { book: loaded.book, summary: loaded.summary };
  });
}

export async function inspectBookManifest(
  ctx: LongProjectStoreContext,
  projectDirectory: string
): Promise<{
  bookId: string;
  updatedAt: string;
}> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const { manifest } = await loadProject(ctx, canonical);
    return {
      bookId: manifest.id,
      updatedAt: manifest.updatedAt
    };
  });
}

export async function updateBindings(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: UpdateLongBookBindingsInput
): Promise<OpenedLongBook> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const timestamp = ctx.timestamp();
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      linkedMaterialIdsByKind: input.linkedMaterialIdsByKind,
      linkedSkillIdsByKind: input.linkedSkillIdsByKind,
      linkedResourceStageScopes: input.linkedResourceStageScopes,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: timestamp
      }
    });
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    const next = await loadProject(ctx, loaded.projectDirectory);
    return { book: next.book, summary: next.summary };
  });
}

export async function renameBook(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: RenameLongBookInput
): Promise<OpenedLongBook> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const timestamp = ctx.timestamp();
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      title: input.title,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: timestamp
      }
    });
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    const next = await loadProject(ctx, loaded.projectDirectory);
    return { book: next.book, summary: next.summary };
  });
}

export async function readDocument(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: ReadLongDocumentInput
): Promise<ReadLongDocumentResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const fileId = LongFileIdSchema.parse(input.fileId);
    const file = await loadPublicPagedIndexedFile(ctx, loaded, fileId);
    const offset = nonnegativeInteger(input.offset ?? 0, "分页起点");
    const limit = boundedPositiveInteger(
      input.limit ?? DEFAULT_READ_PAGE_CHARACTERS,
      MAX_READ_PAGE_CHARACTERS,
      "分页长度"
    );
    const page = sliceIndexedUnicodeCodePointPage(file.paging, offset, limit);
    if (offset > page.totalCharacters) {
      throw new Error("长篇文档分页起点超过文件字符总数。");
    }
    return {
      fileId,
      path: file.reference.path,
      content: page.content,
      offset,
      nextOffset: page.nextOffset,
      totalCharacters: page.totalCharacters
    };
  });
}

export async function readAgentsMd(
  ctx: LongProjectStoreContext,
  projectDirectory: string
): Promise<{ content: string; truncated: boolean }> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    await loadProject(ctx, canonical);
    const existing = await tryReadAgentsMdFile(canonical);
    if (!existing) {
      const content = DEFAULT_LONG_AGENTS_MD;
      await commitLongProjectTransaction({
        projectRoot: canonical,
        operations: [
          {
            path: LONG_AGENTS_MD_PATH,
            content,
            expectedSha256: null
          }
        ],
        maxFileBytes: MAX_LEDGER_RECORD_BYTES
      });
      return { content, truncated: false };
    }
    return sliceAgentsMdContent(existing.content);
  });
}

export async function writeAgentsMd(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  content: string
): Promise<void> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    await loadProject(ctx, canonical);
    if (longAgentsMdCharacterCount(content) > LONG_AGENTS_MD_MAX_CHARACTERS) {
      throw new Error(
        `长篇上下文超过 ${LONG_AGENTS_MD_MAX_CHARACTERS} 个字符上限。`
      );
    }
    const existing = await tryReadAgentsMdFile(canonical);
    await commitLongProjectTransaction({
      projectRoot: canonical,
      operations: [
        {
          path: LONG_AGENTS_MD_PATH,
          content,
          ...(existing ? {} : { expectedSha256: null })
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
  });
}

export async function writeDocument(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: WriteLongDocumentInput
): Promise<WriteLongDocumentResult> {
  if (input.selectChapterOutline) {
    return await selectChapterOutline(
      ctx,
      projectDirectory,
      input.selectChapterOutline
    );
  }
  if (!input.fileId || input.content === undefined) {
    throw new Error("写入文档需要文件标识和正文内容。");
  }
  const fileIdInput = input.fileId;
  const content = input.content;
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const fileId = LongFileIdSchema.parse(fileIdInput);
    assertDirectlyMutableDocument(loaded.index, fileId);
    const file = await loadIndexedFile(loaded, fileId);
    if (file.kind !== "markdown") {
      throw new Error("第一阶段只允许通过 writeDocument 写入 Markdown 文件。");
    }
    const nextBytes = encodeUtf8Strict(content);
    if (nextBytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new Error("长篇 Markdown 文件超过 32 MiB 限制。");
    }
    const timestamp = ctx.timestamp();
    file.reference.updatedAt = timestamp;
    updateChapterBodyStatus(loaded.index, file.reference.id, content);
    const chapterEntry = loaded.index.chapters.find(
      (entry) => entry.body.id === file.reference.id
    );
    if (chapterEntry) {
      const latestCommit = [...loaded.index.ledger.commits]
        .reverse()
        .find((commit) =>
          (commit.chapterCardIds ?? [commit.chapterCardId]).includes(
            chapterEntry.chapterCardId
          )
        );
      const evidence = latestCommit?.chapterBodyEvidence?.find(
        (item) => item.chapterCardId === chapterEntry.chapterCardId
      );
      const sha256 = createHash("sha256").update(nextBytes).digest("hex");
      const hasPriorCommit = latestCommit !== undefined;
      if (evidence)
        chapterEntry.bodyEvidenceStatus =
          evidence.sha256 === sha256 ? "current" : "needs-review";
      else if (hasPriorCommit) chapterEntry.bodyEvidenceStatus = "unknown";
    }

    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: timestamp
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt: timestamp,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: timestamp
      }
    });
    const manifestContent = serializeJson(nextManifest);

    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { path: file.reference.path, content },
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: manifestContent }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });

    const next = await loadProject(ctx, loaded.projectDirectory);
    return {
      book: next.book,
      summary: next.summary,
      fileId
    };
  });
}
async function selectChapterOutline(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  choice: {
    chapterCardId: string;
    version: string;
    expectedIndexUpdatedAt: string;
  }
): Promise<WriteLongDocumentResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    if (loaded.index.updatedAt !== choice.expectedIndexUpdatedAt) {
      throw new Error("章表已更新，请刷新后再选择大纲。");
    }
    const chapter = loaded.index.plot.chapterCards.find(
      (item) => item.id === choice.chapterCardId
    );
    const chapterFiles = loaded.index.chapters.find(
      (item) => item.chapterCardId === choice.chapterCardId
    );
    if (!chapter || !chapterFiles) throw new Error("找不到这张章卡。");
    const file = await loadIndexedFile(loaded, chapterFiles.card.id);
    if (file.kind !== "markdown")
      throw new Error("章计划文件必须是 Markdown。");
    const selectedAt = ctx.timestamp();
    const sha256 = createHash("sha256")
      .update(encodeUtf8Strict(file.disk.content))
      .digest("hex");
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...loaded.index,
      updatedAt: selectedAt,
      plot: {
        ...loaded.index.plot,
        chapterCards: loaded.index.plot.chapterCards.map((item) =>
          item.id === chapter.id
            ? {
                ...item,
                outlineSelection: {
                  sourceFileId: chapterFiles.card.id,
                  version: choice.version,
                  sha256,
                  selectedAt,
                  evidence: "author-explicit-selection" as const
                }
              }
            : item
        )
      }
    });
    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt: selectedAt,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: selectedAt
      }
    });
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    const next = await loadProject(ctx, loaded.projectDirectory);
    const selectedFile = next.index.chapters.find(
      (item) => item.chapterCardId === choice.chapterCardId
    )!.card;
    return { book: next.book, summary: next.summary, fileId: selectedFile.id };
  });
}

export async function getChapterOutlineSha256(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  chapterCardId: string
): Promise<string> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const entry = loaded.index.chapters.find(
      (item) => item.chapterCardId === chapterCardId
    );
    if (!entry) throw new Error("找不到这张章卡。");
    const file = await loadIndexedFile(loaded, entry.card.id);
    if (file.kind !== "markdown")
      throw new Error("章计划文件必须是 Markdown。");
    return createHash("sha256")
      .update(encodeUtf8Strict(file.disk.content))
      .digest("hex");
  });
}

export async function getChapterBodyEvidenceStatus(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  chapterCardId: string
): Promise<"current" | "needs-review" | "unknown" | undefined> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const chapter = loaded.index.chapters.find(
      (item) => item.chapterCardId === chapterCardId
    );
    if (!chapter) return undefined;
    const latestCommit = [...loaded.index.ledger.commits]
      .reverse()
      .find((commit) =>
        (commit.chapterCardIds ?? [commit.chapterCardId]).includes(
          chapterCardId
        )
      );
    if (!latestCommit) return undefined;
    const evidence = latestCommit.chapterBodyEvidence?.find(
      (item) => item.chapterCardId === chapterCardId
    );
    if (!evidence) return "unknown";
    const body = await loadIndexedFile(loaded, chapter.body.id);
    if (body.kind !== "markdown") return "unknown";
    const currentHash = createHash("sha256")
      .update(encodeUtf8Strict(body.disk.content))
      .digest("hex");
    return currentHash === evidence.sha256 ? "current" : "needs-review";
  });
}

export async function getChapterTrackingStatuses(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  chapterCardIds: readonly string[]
): Promise<
  Map<
    string,
    {
      outlineSha256?: string;
      bodyEvidenceStatus?: "current" | "needs-review" | "unknown";
    }
  >
> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const result = new Map<
      string,
      {
        outlineSha256?: string;
        bodyEvidenceStatus?: "current" | "needs-review" | "unknown";
      }
    >();
    const latestCommitByChapter = new Map<
      string,
      (typeof loaded.index.ledger.commits)[number]
    >();
    for (const commit of [...loaded.index.ledger.commits].reverse()) {
      for (const id of commit.chapterCardIds ?? [commit.chapterCardId]) {
        if (!latestCommitByChapter.has(id))
          latestCommitByChapter.set(id, commit);
      }
    }
    for (const chapterCardId of chapterCardIds) {
      const entry = loaded.index.chapters.find(
        (item) => item.chapterCardId === chapterCardId
      );
      const card = loaded.index.plot.chapterCards.find(
        (item) => item.id === chapterCardId
      );
      if (!entry || !card) continue;
      const status: {
        outlineSha256?: string;
        bodyEvidenceStatus?: "current" | "needs-review" | "unknown";
      } = {};
      if (card.outlineSelection) {
        const plan = await loadIndexedFile(loaded, entry.card.id);
        if (plan.kind === "markdown")
          status.outlineSha256 = createHash("sha256")
            .update(encodeUtf8Strict(plan.disk.content))
            .digest("hex");
      }
      const latestCommit = latestCommitByChapter.get(chapterCardId);
      if (latestCommit) {
        const evidence = latestCommit.chapterBodyEvidence?.find(
          (item) => item.chapterCardId === chapterCardId
        );
        if (!evidence) status.bodyEvidenceStatus = "unknown";
        else {
          const body = await loadIndexedFile(loaded, entry.body.id);
          if (body.kind !== "markdown") status.bodyEvidenceStatus = "unknown";
          else {
            const currentHash = createHash("sha256")
              .update(encodeUtf8Strict(body.disk.content))
              .digest("hex");
            status.bodyEvidenceStatus =
              currentHash === evidence.sha256 ? "current" : "needs-review";
          }
        }
      }
      result.set(chapterCardId, status);
    }
    return result;
  });
}
