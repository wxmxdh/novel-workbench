import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  CatalogIndexSnapshotSchema,
  CatalogLibrarySchema,
  CatalogReadDocumentResultSchema,
  CommandEnvelopeSchema,
  LongListBooksResultSchema,
  LongOpenBookResultSchema,
  MaterialLibrarySchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import bundle from "./love-approved-voice-bundle";

const BOOK_ID = "longbook_9a146bbe";
const PACKAGE_ID = "LOVE-voice-2026-10-10-v1.0";
const LIBRARY_TITLE = "LOVE 创作积累";
const LIBRARY_MARKER = `<!-- deepwrite-love-approved-material-library:${PACKAGE_ID} -->`;
const ENTRY_MARKER = `<!-- deepwrite-love-approved-material:${PACKAGE_ID}`;
const SOURCE_DEFINITIONS = [
  {
    sourcePath: `codex-approved-style/${PACKAGE_ID}/manifest.json`,
    title: "LOVE 文风认可包清单 v1.0"
  },
  {
    sourcePath: `codex-approved-style/${PACKAGE_ID}/第一章_整体认可稿.md`,
    title: "LOVE 第一章整体认可样本 v1.0"
  },
  {
    sourcePath: `codex-approved-style/${PACKAGE_ID}/作者批语与适用边界.md`,
    title: "LOVE 作者批语及适用边界 v1.0"
  }
] as const;

type CoreRequest = (command: CommandEnvelope) => Promise<CommandResult>;
type NativeSource = (typeof bundle.files)[number];

export interface LoveApprovedMaterialLibraryResult {
  status: "installed" | "already-installed" | "skipped";
  reason?:
    | "workspace-unavailable"
    | "package-not-included"
    | "book-unavailable"
    | "library-title-conflict"
    | "library-edited"
    | "entry-title-conflict"
    | "entry-edited";
  libraryId?: string;
}

function command<T extends CommandEnvelope["type"]>(
  type: T,
  payload: Extract<CommandEnvelope, { type: T }> extends {
    payload: infer P;
  }
    ? P
    : never
): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, {
      id: `bootstrap_love_material_${type.replaceAll(".", "_")}`
    })
  );
}

function payload(result: CommandResult): unknown {
  if (result.status === "rejected") throw new Error(result.error.message);
  return result.payload;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function approvedSources(): Array<{
  source: NativeSource;
  title: string;
  body: string;
}> {
  if (bundle.bookId !== BOOK_ID || bundle.packageId !== PACKAGE_ID)
    throw new Error("LOVE创作积累资料包身份与本书绑定不匹配。");
  const manifestSource = bundle.files.find(
    (file) => file.sourcePath === SOURCE_DEFINITIONS[0].sourcePath
  );
  if (
    !manifestSource ||
    sha256(manifestSource.content) !== manifestSource.sha256
  )
    throw new Error("LOVE创作积累清单缺失或hash校验失败。");
  const manifest = JSON.parse(manifestSource.content) as {
    package_id?: unknown;
    project?: unknown;
    status?: unknown;
    scope?: { description?: unknown };
    sources?: Array<{ path?: unknown; role?: unknown; sha256?: unknown }>;
    workbench_binding?: {
      book_id?: unknown;
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
    manifest.workbench_binding?.book_id !== BOOK_ID ||
    typeof manifest.scope?.description !== "string" ||
    manifest.sources?.length !== 2
  )
    throw new Error("LOVE创作积累清单范围/状态不匹配。");

  return SOURCE_DEFINITIONS.map((definition, index) => {
    const source = bundle.files.find(
      (file) => file.sourcePath === definition.sourcePath
    );
    if (!source || sha256(source.content) !== source.sha256)
      throw new Error(`LOVE认可资料缺失或hash校验失败：${definition.title}`);
    if (source.title !== definition.title)
      throw new Error(`LOVE创作积累素材标题不匹配：${definition.title}`);
    if (index > 0) {
      const listed = manifest.sources?.find(
        (item) => item.path === definition.sourcePath.split("/").at(-1)
      );
      const binding = manifest.workbench_binding?.documents?.find(
        (item) => item.source_path === definition.sourcePath
      );
      if (
        !listed ||
        typeof listed.sha256 !== "string" ||
        listed.sha256.toLowerCase() !== source.sha256.toLowerCase() ||
        binding?.title !== definition.title ||
        binding.path !== definition.sourcePath.split("/").at(-1)
      )
        throw new Error(`LOVE创作积累清单来源不匹配：${definition.title}`);
    }
    const body = [
      `${ENTRY_MARKER} role=${index === 0 ? "manifest" : index === 1 ? "approved-sample" : "author-feedback"} sha256=${source.sha256} -->`,
      `来源包：${PACKAGE_ID}`,
      `来源路径：${source.sourcePath}`,
      `SHA-256：${source.sha256}`,
      "资料身份：作者认可的样本与批语，不是故事正典，不单独授予写作授权。",
      "",
      source.content
    ].join("\n");
    return { source, title: definition.title, body };
  });
}

function libraryOverview(): string {
  return [
    LIBRARY_MARKER,
    `资料包：${PACKAGE_ID}`,
    `仅由启动初始化关联至 LOVE 长篇 ${BOOK_ID}；不写入正典。`,
    "三条素材分别保存清单、作者整体认可样本和作者批语/边界；来源身份与适用范围以每条原文为准。"
  ].join("\n");
}

async function readDocument(
  requestCore: CoreRequest,
  libraryId: string,
  target: "overview" | "document",
  documentId?: string
): Promise<string> {
  const result = CatalogReadDocumentResultSchema.parse(
    payload(
      await requestCore(
        target === "overview"
          ? command("catalog.readDocument", {
              projectId: libraryId,
              target: "overview"
            })
          : command("catalog.readDocument", {
              projectId: libraryId,
              target: "document",
              documentId: documentId ?? ""
            })
      )
    )
  );
  return result.content;
}

async function ensureMaterialLibrary(
  requestCore: CoreRequest,
  workspaceDirectory: string
): Promise<
  | {
      libraryId: string;
      index: ReturnType<typeof CatalogIndexSnapshotSchema.parse>;
    }
  | { skipped: "library-title-conflict" | "library-edited" }
> {
  let index = CatalogIndexSnapshotSchema.parse(
    payload(await requestCore(command("catalog.index", {})))
  );
  let existing = index.materials.find(
    (library) => library.title === LIBRARY_TITLE
  );
  if (existing) {
    const overview = await readDocument(requestCore, existing.id, "overview");
    if (!overview.includes(LIBRARY_MARKER))
      return { skipped: "library-title-conflict" };
    if (
      overview !== libraryOverview() ||
      existing.materialKind !== "other" ||
      existing.materialType !== "long"
    )
      return { skipped: "library-edited" };
    return { libraryId: existing.id, index };
  }

  const created = CatalogLibrarySchema.parse(
    payload(
      await requestCore(
        command("catalog.createLibraryAtPath", {
          domain: "material",
          name: LIBRARY_TITLE,
          materialKind: "other",
          libraryType: "long",
          parentDirectory: join(workspaceDirectory, "materials")
        })
      )
    )
  );
  if (!("materialKind" in created) || created.materialKind !== "other")
    throw new Error("Core创建的LOVE素材库类型不匹配。");
  const saved = MaterialLibrarySchema.parse(
    payload(
      await requestCore(
        command("catalog.updateLibrary", {
          domain: "material",
          libraryId: created.id,
          overview: libraryOverview(),
          baseProjectRevision: created.projectRevision ?? 0
        })
      )
    )
  );
  if (saved.id !== created.id || saved.materialKind !== "other")
    throw new Error("Core保存的LOVE素材库清单不匹配。");
  index = CatalogIndexSnapshotSchema.parse(
    payload(await requestCore(command("catalog.index", {})))
  );
  existing = index.materials.find(({ id }) => id === saved.id);
  if (!existing) throw new Error("Core素材库索引中找不到LOVE创作积累。");
  return { libraryId: saved.id, index };
}

async function ensureEntries(
  requestCore: CoreRequest,
  libraryId: string,
  index: ReturnType<typeof CatalogIndexSnapshotSchema.parse>,
  sources: ReturnType<typeof approvedSources>
): Promise<
  "installed" | "already-installed" | "entry-title-conflict" | "entry-edited"
> {
  let currentIndex = index;
  let createdAny = false;
  for (const source of sources) {
    const library = currentIndex.materials.find(({ id }) => id === libraryId);
    if (!library) throw new Error("Core素材库索引中找不到LOVE创作积累。");
    const matching = library.entries.filter(
      (entry) => entry.title === source.title
    );
    if (matching.length > 1) return "entry-title-conflict";
    const existing = matching[0];
    if (existing) {
      if (existing.stageId !== "other") return "entry-edited";
      const content = await readDocument(
        requestCore,
        libraryId,
        "document",
        existing.id
      );
      if (content !== source.body)
        return content.includes(ENTRY_MARKER)
          ? "entry-edited"
          : "entry-title-conflict";
      continue;
    }
    await requestCore(
      command("catalog.createLibraryEntry", {
        domain: "material",
        libraryId,
        title: source.title,
        content: source.body,
        stageId: "other",
        baseProjectRevision: library.projectRevision ?? 0
      })
    );
    createdAny = true;
    currentIndex = CatalogIndexSnapshotSchema.parse(
      payload(await requestCore(command("catalog.index", {})))
    );
  }
  return createdAny ? "installed" : "already-installed";
}

async function linkOnlyToLoveBook(
  requestCore: CoreRequest,
  libraryId: string
): Promise<boolean> {
  const result = LongListBooksResultSchema.parse(
    payload(await requestCore(command("long.list", {})))
  );
  const love = result.books.find(({ id }) => id === BOOK_ID);
  if (!love) return false;
  if (love.linkedMaterialIdsByKind.other.includes(libraryId)) return true;
  const updated = LongOpenBookResultSchema.parse(
    payload(
      await requestCore(
        command("long.updateBindings", {
          bookId: BOOK_ID,
          linkedMaterialIdsByKind: {
            ...love.linkedMaterialIdsByKind,
            other: [...love.linkedMaterialIdsByKind.other, libraryId]
          },
          linkedSkillIdsByKind: love.linkedSkillIdsByKind,
          linkedResourceStageScopes: love.linkedResourceStageScopes
        })
      )
    )
  );
  if (!updated.summary.linkedMaterialIdsByKind.other.includes(libraryId))
    throw new Error("LOVE长篇素材库关联未被Core确认。");
  return true;
}

/** Creates one native material library, imports only the pinned LOVE package, and links it only to LOVE. */
export async function bootstrapLoveApprovedMaterialLibrary(input: {
  workspaceDirectory: string | null;
  requestCore: CoreRequest;
}): Promise<LoveApprovedMaterialLibraryResult> {
  if (bundle.files.length === 0)
    return { status: "skipped", reason: "package-not-included" };
  if (!input.workspaceDirectory)
    return { status: "skipped", reason: "workspace-unavailable" };

  const longBooks = LongListBooksResultSchema.parse(
    payload(await input.requestCore(command("long.list", {})))
  );
  if (!longBooks.books.some(({ id }) => id === BOOK_ID))
    return { status: "skipped", reason: "book-unavailable" };

  const sources = approvedSources();
  const material = await ensureMaterialLibrary(
    input.requestCore,
    input.workspaceDirectory
  );
  if ("skipped" in material)
    return { status: "skipped", reason: material.skipped };

  const entries = await ensureEntries(
    input.requestCore,
    material.libraryId,
    material.index,
    sources
  );
  if (entries === "entry-title-conflict" || entries === "entry-edited")
    return {
      status: "skipped",
      reason: entries,
      libraryId: material.libraryId
    };
  if (!(await linkOnlyToLoveBook(input.requestCore, material.libraryId)))
    return {
      status: "skipped",
      reason: "book-unavailable",
      libraryId: material.libraryId
    };

  return {
    status: entries,
    libraryId: material.libraryId
  };
}

export const loveApprovedMaterialLibraryMarker = LIBRARY_MARKER;
export const loveApprovedMaterialLibraryTitle = LIBRARY_TITLE;
