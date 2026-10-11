import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OtterProjectAdapter } from "../extras/otter/project-adapter";
import {
  listNativeNovelWriting,
  readNativeNovelWriting,
  saveNativeNovelWriting,
  saveNovelWriting,
  selectNativeNovelWriting,
  selectNovelWriting
} from "./novel-writing-store";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "novel-writing-store-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  const project = join(workspace, "Novel");
  const userData = join(root, "user-data");
  await mkdir(join(project, ".novel"), { recursive: true });
  await mkdir(join(project, "004_写作中"), { recursive: true });
  await mkdir(join(userData, "config"), { recursive: true });
  await writeFile(
    join(project, ".novel", "project.json"),
    JSON.stringify({ project: "Synthetic fixture" })
  );
  await writeFile(
    join(project, "004_写作中", "source.md"),
    "Synthetic outline source\n"
  );
  await writeFile(
    join(userData, "config", "otter-workspace.json"),
    JSON.stringify({ workspaceRoot: workspace })
  );
  const adapter = new OtterProjectAdapter(workspace, userData);
  const projectId = (await adapter.listProjects())[0]!.id;
  return { root, workspace, project, userData, projectId, adapter };
}

const input = (projectId: string) => ({
  projectId,
  title: "Synthetic chapter candidate",
  kind: "draft" as const,
  content: "A synthetic paragraph for isolated storage testing.",
  volume: "第一卷",
  chapter: 1,
  model: "fixture-model-a",
  version: "初稿",
  mode: "candidate" as const,
  outline: "004_写作中/source.md"
});

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
);

describe("saveNovelWriting", () => {
  it("scopes native candidates by stable book and chapter ids across renamed or reordered cards", async () => {
    const f = await fixture();
    const base = { bookId: "longbook_nativefixture", chapterCardId: "card-stable-a", chapter: 1, volume: "卷一", cardTitle: "旧标题" };
    const first = await saveNativeNovelWriting(f.project, base, {
      role: "candidate", content: "Same exact native comparison text.\n", title: "旧标题", model: "model-a", version: "rev-1"
    });
    const renamed = await saveNativeNovelWriting(f.project, { ...base, chapter: 8, volume: "改名后的卷", cardTitle: "新标题" }, {
      role: "candidate", content: "Same exact native comparison text.\n", title: "新标题", model: "model-b", version: "rev-2"
    });
    expect(renamed).toMatchObject({ path: first.path, hash: first.hash, deduplicated: true });
    const otherChapter = await saveNativeNovelWriting(f.project, { ...base, chapterCardId: "card-stable-b" }, {
      role: "candidate", content: "Same exact native comparison text.\n", title: "相邻章", model: "model-a", version: "rev-1"
    });
    expect(otherChapter.path).not.toBe(first.path);
    const listed = await listNativeNovelWriting(f.project, { ...base, chapter: 8, volume: "改名后的卷", cardTitle: "新标题" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.sources.map(({ model }) => model)).toEqual(["model-a", "model-b"]);
    const bytes = await readFile(join(f.project, ...first.path.split("/")), "utf8");
    await selectNativeNovelWriting(f.project, base, { path: first.path, hash: first.hash, action: "reference" });
    await selectNativeNovelWriting(f.project, base, { path: first.path, hash: first.hash, action: "important" });
    expect(await readFile(join(f.project, ...first.path.split("/")), "utf8")).toBe(bytes);
    expect((await listNativeNovelWriting(f.project, base))[0]).toMatchObject({ selectedReference: true, important: true });
    const opened = await readNativeNovelWriting(f.project, base, { path: first.path, hash: first.hash });
    expect(opened.content).toBe("Same exact native comparison text.\n");
  });

  it("uses hash conflict protection for native work drafts and never checkpoints a work file", async () => {
    const f = await fixture();
    const scope = { bookId: "longbook_nativefixture", chapterCardId: "card-a", chapter: 1, volume: "卷一", cardTitle: "章一" };
    const first = await saveNativeNovelWriting(f.project, scope, {
      role: "work", content: "Working text one", title: "章一", model: "unknown", version: "unknown"
    });
    const path = join(f.project, ...first.path.split("/"));
    const before = await readFile(path, "utf8");
    await expect(saveNativeNovelWriting(f.project, scope, {
      role: "work", content: "Must not overwrite", title: "章一", model: "unknown", version: "unknown", expectedHash: "0".repeat(64)
    })).rejects.toThrow(/工作稿已变化/);
    expect(await readFile(path, "utf8")).toBe(before);
    const updated = await saveNativeNovelWriting(f.project, scope, {
      role: "work", content: "Working text two", title: "章一", model: "unknown", version: "unknown", expectedHash: first.hash
    });
    const after = await readFile(path, "utf8");
    await expect(selectNativeNovelWriting(f.project, scope, { path: updated.path, hash: updated.hash, action: "important" })).rejects.toThrow(/不属于当前章节/);
    expect(await readFile(path, "utf8")).toBe(after);
  });

  it("rejects cross-project workspace references for outline and revisions", async () => {
    const f = await fixture();
    await expect(
      saveNovelWriting(f.userData, {
        ...input(f.projectId),
        outline: "workspace:some-other-project/outline.md"
      })
    ).rejects.toThrow(/project-local|当前作品内/);
    await expect(
      saveNovelWriting(f.userData, {
        ...input(f.projectId),
        outline: undefined,
        revisionOf: "workspace:some-other-project/draft.md"
      })
    ).rejects.toThrow(/project-local|当前作品内/);
  });

  it("refuses to publish a proposal after exact-path external deletion becomes pending", async () => {
    const f = await fixture();
    await writeFile(
      join(f.userData, "config", "hidden-books.json"),
      JSON.stringify([
        {
          id: f.projectId,
          kind: "external",
          title: "Synthetic fixture",
          projectDirectory: f.project,
          workspaceRoot: f.workspace,
          hiddenAt: new Date().toISOString(),
          deletePending: true,
          deleteQuarantineDirectory: join(
            f.workspace,
            ".deepwrite-delete-pending"
          )
        }
      ])
    );

    await expect(
      saveNovelWriting(f.userData, input(f.projectId))
    ).rejects.toThrow("正在永久删除");
    await expect(
      readFile(join(f.project, ".novel", "notes", "writing"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically saves an isolated, read-only candidate and preserves its source", async () => {
    const f = await fixture();
    const sourceBefore = await readFile(
      join(f.project, "004_写作中", "source.md"),
      "utf8"
    );
    const result = await saveNovelWriting(f.userData, input(f.projectId));
    expect(result).toMatchObject({ status: "author-candidate" });
    expect(result.path).toMatch(/^\.novel\/notes\/writing\/.+\.md$/);
    const saved = await readFile(
      join(f.project, ...result.path.split("/")),
      "utf8"
    );
    expect(saved).toContain("workbench: novel-author-candidate-v1");
    expect(saved).toContain('title: "Synthetic chapter candidate"');
    expect(saved).toContain('outline: "004_写作中/source.md"');
    expect(saved).toContain(input(f.projectId).content);
    const opened = await f.adapter.openProject(f.projectId);
    expect(
      opened.documents.find((document) => document.path === result.path)
    ).toMatchObject({
      category: "draft",
      status: "candidate",
      title: "Synthetic chapter candidate",
      model: "fixture-model-a",
      version: "初稿"
    });
    expect(
      await readFile(join(f.project, "004_写作中", "source.md"), "utf8")
    ).toBe(sourceBefore);
    const duplicate = await saveNovelWriting(f.userData, input(f.projectId));
    expect(duplicate).toEqual({ ...result, deduplicated: true });
    const catalog = JSON.parse(
      await readFile(
        join(f.project, ".novel", "notes", "writing", "catalog.json"),
        "utf8"
      )
    ) as { records: Array<{ sources: Array<{ model: string }> }> };
    expect(catalog.records[0]?.sources).toEqual([
      expect.objectContaining({ model: "fixture-model-a" })
    ]);
  });

  it("deduplicates only byte-identical prose within the same chapter and preserves whitespace variants", async () => {
    const f = await fixture();
    const first = await saveNovelWriting(f.userData, input(f.projectId));
    const duplicate = await saveNovelWriting(f.userData, {
      ...input(f.projectId),
      model: "fixture-model-b",
      version: "independent"
    });
    expect(duplicate.path).toBe(first.path);
    expect(duplicate.deduplicated).toBe(true);
    const whitespaceVariant = await saveNovelWriting(f.userData, {
      ...input(f.projectId),
      content: `${input(f.projectId).content} `
    });
    expect(whitespaceVariant.path).not.toBe(first.path);
    expect(whitespaceVariant.deduplicated).toBe(false);
    const catalog = JSON.parse(
      await readFile(
        join(f.project, ".novel", "notes", "writing", "catalog.json"),
        "utf8"
      )
    ) as { records: Array<{ sources: Array<{ model: string }> }> };
    expect(catalog.records[0]?.sources.map(({ model }) => model)).toEqual([
      "fixture-model-a",
      "fixture-model-b"
    ]);
    const opened = await f.adapter.openProject(f.projectId);
    expect(
      opened.documents.find(({ path }) => path === first.path)?.writingSources
    ).toEqual([
      expect.objectContaining({
        model: "fixture-model-a",
        version: "初稿",
        outline: "004_写作中/source.md"
      }),
      expect.objectContaining({
        model: "fixture-model-b",
        version: "independent"
      })
    ]);
  });

  it("updates a fixed working copy only with its current hash and delivers it as a separate candidate", async () => {
    const f = await fixture();
    const original = await saveNovelWriting(f.userData, {
      ...input(f.projectId),
      mode: "work"
    });
    expect(original.status).toBe("author-work-draft");
    const oldText = await readFile(
      join(f.project, ...original.path.split("/")),
      "utf8"
    );
    await expect(
      saveNovelWriting(f.userData, {
        ...input(f.projectId),
        mode: "work",
        content: "stale overwrite"
      })
    ).rejects.toThrow(/未读取其当前版本/);
    expect(
      await readFile(join(f.project, ...original.path.split("/")), "utf8")
    ).toBe(oldText);
    const updated = await saveNovelWriting(f.userData, {
      ...input(f.projectId),
      mode: "work",
      content: "Accumulated working draft.",
      expectedHash: original.hash
    });
    expect(updated.path).toBe(original.path);
    expect(updated.hash).not.toBe(original.hash);
    const candidate = await saveNovelWriting(f.userData, {
      ...input(f.projectId),
      content: "Accumulated working draft.",
      revisionOf: updated.path
    });
    expect(candidate.status).toBe("author-candidate");
    expect(candidate.path).not.toBe(updated.path);
    expect(
      await readFile(join(f.project, ...original.path.split("/")), "utf8")
    ).toContain("Accumulated working draft.");
    expect(
      await readFile(join(f.project, ...candidate.path.split("/")), "utf8")
    ).toContain("Accumulated working draft.");
  });

  it("requires an explicit hash-checked selection and leaves it stale when the candidate changes", async () => {
    const f = await fixture();
    const candidate = await saveNovelWriting(f.userData, input(f.projectId));
    const opened = await f.adapter.openProject(f.projectId);
    expect(
      opened.documents.find(({ path }) => path === candidate.path)
        ?.selectedReference
    ).toBe(false);
    await expect(
      selectNovelWriting(f.userData, {
        projectId: f.projectId,
        path: candidate.path,
        hash: "0".repeat(64)
      })
    ).rejects.toThrow(/内容已变化/);
    await selectNovelWriting(f.userData, {
      projectId: f.projectId,
      path: candidate.path,
      hash: candidate.hash
    });
    const selected = await f.adapter.openProject(f.projectId);
    expect(
      selected.documents.find(({ path }) => path === candidate.path)
    ).toMatchObject({
      writingRole: "candidate",
      selectedReference: true
    });
    await selectNovelWriting(f.userData, {
      projectId: f.projectId,
      path: candidate.path,
      hash: candidate.hash,
      action: "important"
    });
    const checkpoint = await f.adapter.openProject(f.projectId);
    expect(
      checkpoint.documents.find(({ path }) => path === candidate.path)
    ).toMatchObject({
      selectedReference: true,
      importantCheckpoint: true
    });
  });

  it("does not let the direct selection API mark a mutable work draft important", async () => {
    const f = await fixture();
    const work = await saveNovelWriting(f.userData, {
      ...input(f.projectId),
      mode: "work"
    });
    const path = join(f.project, ...work.path.split("/"));
    const before = await readFile(path, "utf8");
    await expect(selectNovelWriting(f.userData, {
      projectId: f.projectId,
      path: work.path,
      hash: work.hash,
      action: "important"
    })).rejects.toThrow(/工作稿.*重要节点/);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("adds a sidecar selection and checkpoint to a read-only V1 delivery", async () => {
    const f = await fixture();
    const path = "004_写作中/第001章_正文草稿_gpt-6.1-sol.md";
    const prose = "A protocol-delivered comparison draft.";
    const delivered = [
      "---",
      "workbench: novel-draft-v1",
      'kind: "draft"',
      'volume: "第一卷"',
      "chapter: 1",
      'model: "gpt-6.1-sol"',
      "status: 待审阅",
      "---",
      "",
      prose
    ].join("\n");
    await writeFile(join(f.project, path), delivered);
    const hash = (await f.adapter.readDocument(f.projectId, path)).hash;
    await selectNovelWriting(f.userData, {
      projectId: f.projectId,
      path,
      hash,
      action: "reference"
    });
    await selectNovelWriting(f.userData, {
      projectId: f.projectId,
      path,
      hash,
      action: "important"
    });
    const opened = await f.adapter.openProject(f.projectId);
    expect(opened.documents.find((item) => item.path === path)).toMatchObject({
      category: "draft",
      writingRole: "candidate",
      selectedReference: true,
      importantCheckpoint: true,
      model: "gpt-6.1-sol"
    });
    expect(await readFile(join(f.project, path), "utf8")).toBe(delivered);
  });

  it("rejects cross-project references before creating a candidate", async () => {
    const f = await fixture();
    await expect(
      saveNovelWriting(f.userData, {
        ...input(f.projectId),
        outline: "../outside.md"
      })
    ).rejects.toThrow();
    await expect(
      readFile(join(f.project, ".novel", "notes", "writing"))
    ).rejects.toThrow();
  });

  it("refuses a symlink at the fixed candidate directory", async () => {
    const f = await fixture();
    const external = join(f.root, "outside");
    await mkdir(external);
    await mkdir(join(f.project, ".novel", "notes"), { recursive: true });
    try {
      await symlink(
        external,
        join(f.project, ".novel", "notes", "writing"),
        "dir"
      );
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "EPERM" ||
        (error as NodeJS.ErrnoException).code === "EACCES"
      )
        return;
      throw error;
    }
    await expect(
      saveNovelWriting(f.userData, input(f.projectId))
    ).rejects.toThrow(/链接/);
    expect(
      (await import("node:fs/promises")).readdir(external)
    ).resolves.toEqual([]);
  });
});
