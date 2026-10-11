import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { OtterProjectAdapter } from "./project-adapter";
import { OtterProjectStudio } from "./project-studio";

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "otter-studio-"));
  roots.push(root);
  await mkdir(join(root, "00_创作项目", "项目"), { recursive: true });
  const userDataPath = join(root, "user-data");
  const adapter = new OtterProjectAdapter(root, userDataPath);
  return { root, adapter, userDataPath };
}
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
);

describe("OtterProjectStudio", () => {
  it("creates a collision-safe blank V1 project through the V1 registration seam", async () => {
    const { root, adapter } = await setup();
    let registration: Record<string, unknown> | null = null;
    const studio = new OtterProjectStudio({
      workspaceRoot: root,
      adapter,
      registerWithV1: async (relativePath, value) => {
        registration = value;
        const project = join(root, relativePath);
        await mkdir(join(project, ".novel"), { recursive: true });
        await writeFile(
          join(project, ".novel", "project.json"),
          JSON.stringify(value)
        );
        await writeFile(
          join(project, ".novel", "derived-registry.json"),
          JSON.stringify({
            schema_version: 1,
            project: value.project,
            records: []
          })
        );
      }
    });
    const created = await studio.createProject({ title: "星海 计划" });
    expect(created.relativePath).toContain("00_创作项目/项目/星海-计划");
    expect(registration).not.toBeNull();
    const canon = await readFile(
      join(root, created.relativePath, "001_正典", "项目正典.md"),
      "utf8"
    );
    expect(canon).toContain("（尚无）");
    expect(canon).not.toContain("人物");
    const profile = await readFile(
      join(root, created.relativePath, "project-profile.md"),
      "utf8"
    );
    expect(profile).toContain(createHash("sha256").update(canon).digest("hex"));
    await expect(
      studio.createProject({ title: "星海 计划" })
    ).rejects.toThrow();
  });

  it("writes ideas as author-review candidates and never edits canon", async () => {
    const { root, adapter } = await setup();
    const project = join(root, "00_创作项目", "项目", "novel");
    await mkdir(join(project, ".novel", "notes"), { recursive: true });
    await mkdir(join(project, "001_正典"), { recursive: true });
    await mkdir(join(project, "世界观"), { recursive: true });
    await mkdir(join(project, "地图"), { recursive: true });
    await writeFile(
      join(project, "世界观", "当前世界规则.md"),
      "read-only source\n"
    );
    await writeFile(
      join(project, "地图", "当前地图说明.md"),
      "read-only map\n"
    );
    const canon = "# Existing canon\nOnly author confirmed facts.\n";
    const hash = createHash("sha256").update(canon).digest("hex");
    await writeFile(join(project, "001_正典", "facts.md"), canon);
    await writeFile(join(project, "project-profile.md"), `facts.md ${hash}`);
    await writeFile(join(project, "AGENTS.md"), "project entry");
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({
        schema_version: 1,
        project: "Novel",
        canon: { source: "001_正典/facts.md", hash },
        active_source: "project-profile.md",
        entry_sources: ["AGENTS.md", "project-profile.md"]
      })
    );
    const [item] = await adapter.listProjects();
    expect(item).toBeDefined();
    const studio = new OtterProjectStudio({
      workspaceRoot: root,
      adapter,
      registerWithV1: async () => {
        throw new Error("unused");
      }
    });
    const saved = await studio.saveConcept({
      projectId: item!.id,
      title: "可能的重逢",
      content: "也许在旧车站见面。"
    });
    expect(saved.status).toBe("candidate");
    expect(await readFile(join(project, "001_正典", "facts.md"), "utf8")).toBe(
      canon
    );
    const concept = await readFile(join(project, saved.path), "utf8");
    expect(concept).toContain("未定情节构想");
    expect(concept).toContain("候选材料，不是正典事实");
    const world = await studio.saveWorldNote({
      projectId: item!.id,
      title: "一种尚未确认的规则想法",
      content: "仅供讨论的候选。"
    });
    const mapNote = await studio.saveMapNote({
      projectId: item!.id,
      title: "路线草图说明",
      content: "距离待确认。"
    });
    expect(world.path).toMatch(/^\.novel\/notes\/world\//);
    expect(mapNote.path).toMatch(/^\.novel\/notes\/maps\//);
    expect(
      await readFile(join(project, "世界观", "当前世界规则.md"), "utf8")
    ).toBe("read-only source\n");
    expect(
      await readFile(join(project, "地图", "当前地图说明.md"), "utf8")
    ).toBe("read-only map\n");
  });

  it("rechecks the persisted deletion state immediately before publishing a cached-project candidate", async () => {
    const { root, adapter, userDataPath } = await setup();
    const project = join(root, "00_创作项目", "项目", "pending-novel");
    const config = join(userDataPath, "config");
    await mkdir(join(project, ".novel"), { recursive: true });
    await mkdir(config, { recursive: true });
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({ project: "Pending novel" })
    );
    const [listed] = await adapter.listProjects();
    if (!listed) throw new Error("test fixture project was not discovered");

    const resolveProject = adapter.resolveProject.bind(adapter);
    let resolutions = 0;
    adapter.resolveProject = async (projectId) => {
      resolutions += 1;
      if (resolutions === 2) {
        await writeFile(
          join(config, "hidden-books.json"),
          JSON.stringify([
            {
              id: listed.id,
              kind: "external",
              title: listed.title,
              projectDirectory: project,
              workspaceRoot: root,
              hiddenAt: new Date().toISOString(),
              deletePending: true,
              deleteQuarantineDirectory: join(root, ".deepwrite-delete-pending")
            }
          ])
        );
      }
      return await resolveProject(projectId);
    };
    const studio = new OtterProjectStudio({
      workspaceRoot: root,
      adapter,
      registerWithV1: async () => {
        throw new Error("unused");
      }
    });

    await expect(
      studio.saveConcept({
        projectId: listed.id,
        title: "Late proposal",
        content: "Must not be written once deletion is pending."
      })
    ).rejects.toThrow("正在永久删除");
    await expect(
      readdir(join(project, ".novel", "notes", "concepts"))
    ).resolves.toEqual([]);
  });

  it("registers a freshly created blank project with the actual V1 implementation", async () => {
    const { root, adapter } = await setup();
    const v1ModulePath = new URL(
      "../../../../../../写作协议V1/novel-cli.mjs",
      import.meta.url
    );
    const v1 = await import(v1ModulePath.href);
    const studio = new OtterProjectStudio({
      workspaceRoot: root,
      adapter,
      registerWithV1: async (relativePath, input) => {
        const inputPath = join(root, "register-input.json");
        await writeFile(inputPath, JSON.stringify(input), { flag: "wx" });
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(v1ModulePath),
            "register",
            "--workspace",
            root,
            "--project",
            relativePath,
            "--input",
            inputPath
          ],
          { encoding: "utf8" }
        );
        if (result.status !== 0)
          throw new Error(
            result.stderr || result.stdout || "V1 register command failed"
          );
      }
    });
    const created = await studio.createProject({ title: "真实 V1 空白登记" });
    const loaded = v1.loadProject(root, created.relativePath);
    expect(loaded.config.project).toBe("真实 V1 空白登记");
    expect(loaded.config.canon.source).toBe("001_正典/项目正典.md");
    expect(loaded.config.canon.hash).toBe(
      createHash("sha256")
        .update(
          await readFile(
            join(root, created.relativePath, loaded.config.canon.source)
          )
        )
        .digest("hex")
    );
  });

  it("does not silently choose a project when saved selection conflicts with page handoff", async () => {
    const { root, adapter } = await setup();
    const projectsRoot = join(root, "00_创作项目", "项目");
    const entries = ["a", "b"];
    for (const name of entries) {
      const project = join(projectsRoot, name);
      await mkdir(join(project, ".novel"), { recursive: true });
      await writeFile(
        join(project, ".novel", "project.json"),
        JSON.stringify({
          schema_version: 1,
          project: name,
          canon: { source: "facts.md", hash: "0".repeat(64) },
          active_source: "profile.md",
          entry_sources: ["profile.md"]
        })
      );
    }
    const projects = await adapter.listProjects();
    const recentRoot = join(projectsRoot, "a");
    const studio = new OtterProjectStudio({
      workspaceRoot: root,
      adapter,
      registerWithV1: async () => {
        throw new Error("unused");
      },
      readCurrentContext: async () => ({
        root: recentRoot,
        project: "a",
        volume: "第一卷",
        chapter: "002",
        activeFile: { path: join(recentRoot, "draft.md") }
      })
    });
    const result = await studio.readingContext({
      savedProjectId: projects.find((p) => p.title === "b")!.id
    });
    expect(result.current.conflict).toBe(true);
    expect(result.current.projectId).toBeNull();
    expect(result.candidates).toHaveLength(2);
    const matchingSaved = await studio.readingContext({
      savedProjectId: projects.find((p) => p.title === "a")!.id
    });
    expect(matchingSaved.current.conflict).toBe(false);
    expect(matchingSaved.current.chapter).toBe("002");
    expect(matchingSaved.current.activeDocumentPath).toBe("draft.md");
  });

  it("imports only signature-checked map images into candidate references", async () => {
    const { root, adapter } = await setup();
    const project = join(root, "00_创作项目", "项目", "map-novel");
    await mkdir(join(project, ".novel"), { recursive: true });
    await mkdir(join(project, "地图"), { recursive: true });
    await writeFile(
      join(project, "地图", "作者地图.md"),
      "作者的既有地图说明。\n"
    );
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({ project: "Map Novel" })
    );
    const [listed] = await adapter.listProjects();
    expect(listed).toBeDefined();
    const source = join(root, "map.png");
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from("local-image-bytes")
    ]);
    await writeFile(source, png);
    const studio = new OtterProjectStudio({
      workspaceRoot: root,
      adapter,
      registerWithV1: async () => {
        throw new Error("unused");
      },
      chooseMapFile: async () => ({ path: source }),
      makeMapPreview: (_bytes, type) => `data:${type};base64,AA==`
    });
    const imported = await studio.importMap({
      projectId: listed!.id,
      title: "北境草图"
    });
    expect(imported?.mediaType).toBe("image/png");
    expect(imported?.path).toMatch(/^\.novel\/notes\/maps\/references\//);
    expect(await readFile(join(project, "地图", "作者地图.md"), "utf8")).toBe(
      "作者的既有地图说明。\n"
    );
    expect(imported?.dataUrl).toContain("image/png");
    expect(await readFile(join(project, imported!.path))).toEqual(png);
    expect(
      await readFile(join(project, `${imported!.path}.reference.md`), "utf8")
    ).toContain("不自动确认为世界观或地理事实");
    const view = await studio.storySpace({ projectId: listed!.id });
    const savedMap = view.maps.find(
      (item) => item.document.path === imported!.path
    );
    expect(savedMap?.previewDataUrl).toContain("image/png");
  });

  it("rejects an image that the native preview decoder cannot decode before saving it", async () => {
    const { root, adapter } = await setup();
    const project = join(root, "00_创作项目", "项目", "bad-map-novel");
    await mkdir(join(project, ".novel"), { recursive: true });
    await writeFile(
      join(project, ".novel", "project.json"),
      JSON.stringify({ project: "Bad Map Novel" })
    );
    const [listed] = await adapter.listProjects();
    expect(listed).toBeDefined();
    const source = join(root, "invalid.png");
    await writeFile(
      source,
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        Buffer.from("not a decodable png")
      ])
    );
    const studio = new OtterProjectStudio({
      workspaceRoot: root,
      adapter,
      registerWithV1: async () => {
        throw new Error("unused");
      },
      chooseMapFile: async () => ({ path: source }),
      makeMapPreview: () => {
        throw new Error("nativeImage returned an empty image");
      }
    });
    await expect(
      studio.importMap({ projectId: listed!.id, title: "invalid" })
    ).rejects.toThrow("nativeImage returned an empty image");
    const mapDir = join(project, ".novel", "notes", "maps", "references");
    await expect(readdir(mapDir)).rejects.toThrow();
  });
});
