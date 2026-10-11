import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  CatalogIndexSnapshotSchema,
  CatalogLibrarySchema,
  CatalogReadDocumentResultSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import sourceSnapshot from "./shuorenhua-skill-snapshot.json";

const LIBRARY_TITLE = "中文表达审核";
const LIBRARY_MARKER = "<!-- codex-installed-review-skill:shuorenhua:v1 -->";
const ENTRY_TITLE = "说人话";
const SOURCE_REVISION = "e7c2b8670bd3e1988bfec199e861cebd87fc5e9c";
const SOURCE_URL = `https://github.com/MrGeDiao/shuorenhua/tree/${SOURCE_REVISION}`;

export interface ShuorenhuaBootstrapResult {
  status: "installed" | "already-installed" | "skipped";
  reason?: "workspace-unavailable" | "library-title-conflict" | "entry-edited";
  libraryId?: string;
}

function resultPayload(result: CommandResult): unknown {
  if (result.status === "rejected") throw new Error(result.error.message);
  return result.payload;
}

function command<T extends CommandEnvelope["type"]>(
  type: T,
  payload: Extract<CommandEnvelope, { type: T }> extends { payload: infer P }
    ? P
    : never
): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, { id: `bootstrap_shuorenhua_${type.replaceAll(".", "_")}` })
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Build one native-library entry from the installed, pinned workspace files. */
export function buildShuorenhuaLibraryEntry(input: {
  skill: string;
  editingGuide: string;
  examples: string;
  license: string;
}): string {
  const sourceHash = sha256(input.skill);
  return [
    LIBRARY_MARKER,
    `<!-- source: ${SOURCE_URL} -->`,
    `<!-- source-skill-sha256: ${sourceHash} -->`,
    `<!-- license: MIT; copyright MrGeDiao -->`,
    "# 说人话",
    `来源版本：${SOURCE_REVISION}`,
    "",
    "## SKILL.md",
    input.skill,
    "## references/editing-guide.md",
    input.editingGuide,
    "## references/examples.md",
    input.examples,
    "## LICENSE",
    input.license
  ].join("\n\n");
}

/**
 * Idempotently installs Shuorenhua in the selected DeepWrite workspace using
 * only validated Main-to-Core catalog commands. Existing user content is never
 * overwritten; same-title collisions without the marker are left untouched.
 */
export async function bootstrapShuorenhuaSkillLibrary(input: {
  workspaceDirectory: string | null;
  content: string;
  requestCore: (command: CommandEnvelope) => Promise<CommandResult>;
}): Promise<ShuorenhuaBootstrapResult> {
  if (!input.workspaceDirectory)
    return { status: "skipped", reason: "workspace-unavailable" };

  const index = CatalogIndexSnapshotSchema.parse(
    resultPayload(await input.requestCore(command("catalog.index", {})))
  );
  const matchingTitle = index.skills.find(
    (library) => library.title === LIBRARY_TITLE
  );
  let libraryId: string;
  let libraryRevision: number;

  if (matchingTitle) {
    const overview = CatalogReadDocumentResultSchema.parse(
      resultPayload(
        await input.requestCore(
          command("catalog.readDocument", {
            projectId: matchingTitle.id,
            target: "overview"
          })
        )
      )
    );
    if (!overview.content.includes(LIBRARY_MARKER))
      return { status: "skipped", reason: "library-title-conflict" };
    libraryId = matchingTitle.id;
    libraryRevision = overview.projectRevision;
  } else {
    const created = CatalogLibrarySchema.parse(
      resultPayload(
        await input.requestCore(
          command("catalog.createLibraryAtPath", {
            domain: "skill",
            name: LIBRARY_TITLE,
            skillKind: "style",
            libraryType: "long",
            parentDirectory: join(input.workspaceDirectory, "skills")
          })
        )
      )
    );
    if (!("skillKind" in created))
      throw new Error("Core 创建的目录不是技能库。");
    libraryId = created.id;
    libraryRevision = created.projectRevision ?? 0;
    const saved = CatalogLibrarySchema.parse(
      resultPayload(
        await input.requestCore(
          command("catalog.updateLibrary", {
            domain: "skill",
            libraryId,
            overview: `${LIBRARY_MARKER}\n来源：${SOURCE_URL}\n来源提交：${SOURCE_REVISION}`,
            baseProjectRevision: libraryRevision
          })
        )
      )
    );
    if (!("skillKind" in saved))
      throw new Error("Core 创建的目录类型不匹配。");
    libraryRevision = saved.projectRevision ?? libraryRevision;
  }

  const latestIndex =
    matchingTitle === undefined
      ? undefined
      : CatalogIndexSnapshotSchema.parse(
          resultPayload(
            await input.requestCore(command("catalog.index", {}))
          )
        );
  const library = latestIndex?.skills.find(({ id }) => id === libraryId);
  if (library) {
    for (const existing of library.entries) {
      const document = CatalogReadDocumentResultSchema.parse(
        resultPayload(
          await input.requestCore(
            command("catalog.readDocument", {
              projectId: libraryId,
              target: "document",
              documentId: existing.id
            })
          )
        )
      );
      if (document.content.includes(LIBRARY_MARKER)) {
        if (document.content === input.content)
          return { status: "already-installed", libraryId };
        return { status: "skipped", reason: "entry-edited", libraryId };
      }
      if (existing.title === ENTRY_TITLE)
        return { status: "skipped", reason: "entry-edited", libraryId };
    }
  }

  const entryIndex =
    latestIndex ??
    CatalogIndexSnapshotSchema.parse(
      resultPayload(await input.requestCore(command("catalog.index", {})))
    );
  const current = entryIndex.skills.find(({ id }) => id === libraryId);
  if (!current) throw new Error("Core 技能库索引中找不到刚创建的技能库。");
  libraryRevision = current.projectRevision ?? libraryRevision;
  const createdEntry = resultPayload(
    await input.requestCore(
      command("catalog.createLibraryEntry", {
        domain: "skill",
        libraryId,
        title: ENTRY_TITLE,
        content: input.content,
        stageId: "draft",
        baseProjectRevision: libraryRevision
      })
    )
  );
  if (!createdEntry || typeof createdEntry !== "object")
    throw new Error("Core 未返回新建技能条目。");
  return { status: "installed", libraryId };
}

export const shuorenhuaSkillLibraryMarker = LIBRARY_MARKER;
export const shuorenhuaSkillLibraryEntryTitle = ENTRY_TITLE;
export const shuorenhuaSkillSourceUrl = SOURCE_URL;
export const shuorenhuaSkillLibraryContent = buildShuorenhuaLibraryEntry({
  skill: sourceSnapshot.files["SKILL.md"],
  editingGuide: sourceSnapshot.files["references/editing-guide.md"],
  examples: sourceSnapshot.files["references/examples.md"],
  license: sourceSnapshot.files.LICENSE
});
export const shuorenhuaSkillContentSha256 = sha256(
  sourceSnapshot.files["SKILL.md"]
);
