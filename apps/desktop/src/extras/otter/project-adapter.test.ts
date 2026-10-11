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
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { OtterProjectAdapter } from "./project-adapter";

const roots: string[] = [];
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "otter-project-adapter-"));
  roots.push(root);
  return root;
}
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
);

describe("OtterProjectAdapter", () => {
  it("discovers only current project roots and assigns explicit device-local path identity", async () => {
    const root = await tempRoot();
    const project = join(root, "works", "a-novel");
    const archived = join(root, "archive", "old-project");
    await mkdir(join(project, ".novel"), { recursive: true });
    await mkdir(join(archived, ".novel"), { recursive: true });
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({ project: "Author Book" })
    );
    await writeFile(
      join(archived, ".novel", "project.json"),
      JSON.stringify({ project: "Old Book" })
    );
    const adapter = new OtterProjectAdapter(root, join(root, "user-data"));
    const projects = await adapter.listProjects();
    expect(projects).toEqual([
      {
        id: `otter_${createHash("sha256").update("works/a-novel").digest("hex").slice(0, 16)}`,
        title: "Author Book",
        relativePath: "works/a-novel",
        hasProtocol: false,
        identityScope: "device-local"
      }
    ]);
  });

  it("refuses cached project resolution as soon as exact-path deletion becomes pending", async () => {
    const root = await tempRoot();
    const workspace = join(root, "workspace");
    const project = join(workspace, "Novel");
    const userData = join(root, "user-data");
    await mkdir(join(project, ".novel"), { recursive: true });
    await mkdir(join(userData, "config"), { recursive: true });
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({ project: "Pending fixture" })
    );
    const adapter = new OtterProjectAdapter(workspace, userData);
    const [listed] = await adapter.listProjects();
    if (!listed) throw new Error("test fixture project was not discovered");

    await writeFile(
      join(userData, "config", "hidden-books.json"),
      JSON.stringify([
        {
          id: listed.id,
          kind: "external",
          title: listed.title,
          projectDirectory: project,
          workspaceRoot: workspace,
          hiddenAt: new Date().toISOString(),
          deletePending: true,
          deleteQuarantineDirectory: join(
            workspace,
            ".deepwrite-delete-pending"
          )
        }
      ])
    );

    await expect(adapter.resolveProject(listed.id)).rejects.toThrow(
      "正在永久删除"
    );
  });

  it("reports active canon and derived partial/stale state without editing source files", async () => {
    const root = await tempRoot();
    const project = join(root, "novel");
    await mkdir(join(project, ".novel"), { recursive: true });
    await mkdir(join(project, "canon"), { recursive: true });
    await mkdir(join(project, "characters"), { recursive: true });
    const canon = "# Current canon\n";
    const card = "partial derived card\n";
    await writeFile(join(project, "canon", "main.md"), canon);
    await writeFile(join(project, "characters", "one.md"), card);
    const hash = (await import("node:crypto"))
      .createHash("sha256")
      .update(canon)
      .digest("hex");
    const cardHash = (await import("node:crypto"))
      .createHash("sha256")
      .update(card)
      .digest("hex");
    await writeFile(
      join(project, "canon", "active-source.md"),
      `main.md\n${hash}\n`
    );
    await writeFile(
      join(project, ".novel", "derived-registry.json"),
      JSON.stringify({
        records: [
          {
            path: "characters/one.md",
            hash: cardHash,
            authority: "derived",
            source_canon: "canon/main.md",
            source_hash: hash,
            coverage: "partial",
            status: "current"
          }
        ]
      })
    );
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({
        project: "Novel",
        active_source: "canon/active-source.md",
        canon: { source: "canon/main.md", hash, version: "1" },
        derived_registry: ".novel/derived-registry.json"
      })
    );
    const before = await readFile(
      join(project, "characters", "one.md"),
      "utf8"
    );
    const adapter = new OtterProjectAdapter(root, join(root, "user-data"));
    const projects = await adapter.listProjects();
    const opened = await adapter.openProject(projects[0]!.id);
    expect(opened.protocolSummary.canon).toMatchObject({ status: "current" });
    expect(opened.protocolSummary.derived).toMatchObject([
      { path: "characters/one.md", status: "partial", coverage: "partial" }
    ]);
    expect(await readFile(join(project, "characters", "one.md"), "utf8")).toBe(
      before
    );
    await writeFile(join(project, "canon", "main.md"), "# Changed canon\n");
    const refreshed = await adapter.listProjects();
    expect(refreshed[0]!.id).toBe(projects[0]!.id);
    expect(
      (await adapter.openProject(refreshed[0]!.id)).protocolSummary.derived
    ).toMatchObject([{ status: "stale" }]);
  });

  it("prefers the central project catalogue, accepts explicit legacy roots, and skips tool/rollback trees", async () => {
    const root = await tempRoot();
    const central = join(root, "00_创作项目", "项目");
    const current = join(central, "Current Work");
    const legacy = join(central, "Legacy Work");
    const rollback = join(central, "回滚点", "Rollback Project");
    const toolProject = join(root, "06_脚本工具", "DeepWrite", "Nested Source");
    for (const dir of [
      join(current, ".novel"),
      join(legacy, ".rules"),
      join(rollback, ".novel"),
      join(toolProject, ".novel")
    ])
      await mkdir(dir, { recursive: true });
    await writeFile(
      join(current, ".novel", "project.json"),
      JSON.stringify({ project: "Current" })
    );
    await writeFile(join(legacy, "AGENTS.md"), "Legacy project entry\n");
    await writeFile(
      join(rollback, ".novel", "project.json"),
      JSON.stringify({ project: "Rollback" })
    );
    await writeFile(
      join(toolProject, ".novel", "project.json"),
      JSON.stringify({ project: "Tool checkout" })
    );
    await writeFile(join(root, "AGENTS.md"), "Workspace entry\n");
    const adapter = new OtterProjectAdapter(root, join(root, "user-data"));
    const projects = await adapter.listProjects();
    expect(projects.map((project) => project.title)).toEqual([
      "Current",
      "Legacy Work"
    ]);
    expect(projects.map((project) => project.relativePath)).toEqual([
      "00_创作项目/项目/Current Work",
      "00_创作项目/项目/Legacy Work"
    ]);
  });

  it("does not traverse or read symlinks and rejects traversal and oversized files", async () => {
    const root = await tempRoot();
    const project = join(root, "novel");
    const outside = join(root, "outside");
    await mkdir(join(project, ".novel"), { recursive: true });
    await mkdir(join(project, ".rules"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(project, "AGENTS.md"), "entry\n");
    await writeFile(join(outside, "secret.md"), "secret\n");
    const hasSymlink = await symlink(outside, join(project, "linked"), "dir")
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EPERM" || error.code === "EACCES") return false;
        throw error;
      });
    const adapter = new OtterProjectAdapter(root, join(root, "user-data"), {
      maxFileBytes: 16
    });
    const projects = await adapter.listProjects();
    await expect(
      adapter.readDocument(projects[0]!.id, "../outside/secret.md")
    ).rejects.toThrow();
    if (hasSymlink)
      await expect(
        adapter.readDocument(projects[0]!.id, "linked/secret.md")
      ).rejects.toThrow(/Symbolic links/);
    await expect(
      adapter.readDocument(projects[0]!.id, "AGENTS.md")
    ).resolves.toMatchObject({ content: "entry\n" });
    await writeFile(join(project, "large.md"), "x".repeat(64));
    await expect(
      adapter.readDocument(projects[0]!.id, "large.md")
    ).rejects.toThrow(/limit/);
  });

  it("classifies real writing files from front matter and conservatively keeps support files separate", async () => {
    const root = await tempRoot();
    const project = join(root, "novel");
    const writing = join(project, "004_写作中");
    const historical = join(writing, "旧稿");
    const plans = join(project, ".novel", "plans");
    await mkdir(writing, { recursive: true });
    await mkdir(historical, { recursive: true });
    await mkdir(plans, { recursive: true });
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({
        project: "Fixture Novel",
        confirmed_sources: [{ path: "004_写作中/第001章_大纲规划_v2.2.md" }],
        support_sources: [{ path: "004_写作中/第002章_正文.md" }]
      })
    );
    const files = {
      outline: join(writing, "第001章_大纲规划_v2.2.md"),
      draft: join(writing, "第001章_正文草稿_gemini-3.8-flash_修订01.md"),
      prompt: join(writing, "GPT审阅提示词.md"),
      prose: join(writing, "第002章_正文.md"),
      oldDraft: join(historical, "第001章_正文稿_gpt-6.1-sol.md"),
      record: join(plans, "plan-run.json")
    };
    await writeFile(
      files.outline,
      "---\nkind: outline\nvolume: 第一卷\nchapter: 第001章\nmodel: unknown\n---\noutline\n"
    );
    await writeFile(
      files.draft,
      "---\nkind: draft\nvolume: 第一卷\nchapter: 第001章\nmodel: Gemini 3.8 Flash\nrevision: 修订01\noutline: plans/approved.md\n---\ndraft\n"
    );
    await writeFile(files.prompt, "审阅提示词\n");
    await writeFile(files.prose, "正文仅按文件名识别\n");
    await writeFile(files.oldDraft, "旧稿正文\n");
    await writeFile(files.record, "{}\n");
    const adapter = new OtterProjectAdapter(root, join(root, "user-data"));
    const projectId = (await adapter.listProjects())[0]!.id;
    const opened = await adapter.openProject(projectId);
    const byPath = new Map(
      opened.documents.map((document) => [document.path, document])
    );
    expect(byPath.get("004_写作中/第001章_大纲规划_v2.2.md")).toMatchObject({
      category: "plan",
      volume: "第一卷",
      chapter: "第001章",
      model: "unknown",
      readOnly: true
    });
    expect(
      byPath.get("004_写作中/第001章_正文草稿_gemini-3.8-flash_修订01.md")
    ).toMatchObject({
      category: "draft",
      model: "Gemini 3.8 Flash",
      revision: "修订01",
      outline: "plans/approved.md",
      readOnly: true
    });
    expect(byPath.get("004_写作中/GPT审阅提示词.md")?.category).toBe(
      "writing-support"
    );
    expect(byPath.get("004_写作中/第001章_大纲规划_v2.2.md")).toMatchObject({
      category: "plan",
      status: "current"
    });
    await expect(
      adapter.readSource(root, "novel", "004_写作中/第001章_大纲规划_v2.2.md")
    ).resolves.toMatchObject({ authority: "confirmed", kind: "plan" });
    expect(byPath.get("004_写作中/第002章_正文.md")).toMatchObject({
      category: "draft",
      status: "current"
    });
    expect(
      byPath.get("004_写作中/旧稿/第001章_正文稿_gpt-6.1-sol.md")
    ).toMatchObject({
      category: "draft",
      model: "gpt-6.1-sol",
      readOnly: true
    });
    expect(byPath.get(".novel/plans/plan-run.json")?.category).toBe("workflow");
    expect(await readFile(files.draft, "utf8")).toContain("kind: draft");
  });

  it("keeps author candidates distinct from canon when reading source authority", async () => {
    const root = await tempRoot();
    const project = join(root, "novel");
    await mkdir(join(project, ".novel", "notes", "writing"), {
      recursive: true
    });
    await mkdir(join(project, "canon"), { recursive: true });
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({
        project: "Authority fixture",
        canon: { source: "canon/facts.md" }
      })
    );
    await writeFile(
      join(project, "canon", "facts.md"),
      "Confirmed synthetic source.\n"
    );
    await writeFile(
      join(project, ".novel", "notes", "writing", "candidate.md"),
      "---\nworkbench: novel-author-candidate-v1\nkind: outline\nstatus: author-candidate\nmodel: unknown\n---\nSynthetic candidate only.\n"
    );
    const adapter = new OtterProjectAdapter(root, join(root, "user-data"));
    const candidate = await adapter.readSource(
      root,
      "novel",
      ".novel/notes/writing/candidate.md"
    );
    const canon = await adapter.readSource(root, "novel", "canon/facts.md");
    expect(candidate).toMatchObject({ authority: "candidate", kind: "plan" });
    const listing = await adapter.openProject(
      (await adapter.listProjects())[0]!.id
    );
    expect(
      listing.documents.find(
        (document) => document.path === ".novel/notes/writing/candidate.md"
      )
    ).toMatchObject({ category: "plan", status: "candidate" });
    expect(canon).toMatchObject({ authority: "canon" });
  });
});
