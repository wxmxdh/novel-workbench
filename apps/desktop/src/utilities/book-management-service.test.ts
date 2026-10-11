import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope
} from "@deepwrite/contracts";
import { OtterProjectAdapter } from "../extras/otter/project-adapter";
import type { LongWorkspaceService } from "./long-workspace-service";
import {
  BookManagementService,
  readHiddenBooks,
  type BookManagementFileOperations
} from "./book-management-service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture(
  options: Partial<BookManagementFileOperations> = {},
  removeHistory: (id: string) => Promise<void> = async () => {}
) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-book-management-"));
  roots.push(root);
  const userDataPath = join(root, "user-data");
  const config = join(userDataPath, "config");
  const workspaceRoot = join(root, "workspace");
  const projectDirectory = join(workspaceRoot, "Novel");
  await mkdir(config, { recursive: true });
  await mkdir(join(projectDirectory, ".novel"), { recursive: true });
  await writeFile(
    join(config, "otter-workspace.json"),
    JSON.stringify({ workspaceRoot }),
    "utf8"
  );
  await writeFile(
    join(projectDirectory, ".novel", "project.json"),
    JSON.stringify({ project: "测试小说" }),
    "utf8"
  );
  const service = new BookManagementService(
    userDataPath,
    {} as LongWorkspaceService,
    removeHistory,
    options
  );
  const [project] = await new OtterProjectAdapter(
    workspaceRoot,
    userDataPath
  ).listProjects();
  if (!project) throw new Error("test fixture project was not discovered");
  const described = await run(service, "books.describeExternal", {
    projectId: project.id
  });
  return {
    root,
    userDataPath,
    workspaceRoot,
    projectDirectory,
    service,
    projectId: project.id,
    identitySha256: (described as { identitySha256: string }).identitySha256
  };
}

function command<T extends CommandEnvelope["type"]>(
  type: T,
  payload: unknown
): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, { id: `test-${Math.random()}` })
  );
}

async function run<T extends CommandEnvelope["type"]>(
  service: BookManagementService,
  type: T,
  payload: unknown
): Promise<unknown> {
  const result = await service.handle(command(type, payload));
  if (!result || result.status !== "accepted")
    throw new Error(`Command ${type} was not accepted`);
  return result.payload;
}

function deletionInput(fixtureValue: Awaited<ReturnType<typeof fixture>>) {
  return {
    projectId: fixtureValue.projectId,
    action: "delete" as const,
    expectedProjectDirectory: fixtureValue.projectDirectory,
    expectedIdentitySha256: fixtureValue.identitySha256,
    workspaceRoot: fixtureValue.workspaceRoot
  };
}

describe("BookManagementService external deletion recovery", () => {
  it("hides and restores a legacy project without a project manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-legacy-book-"));
    roots.push(root);
    const userDataPath = join(root, "user-data");
    const workspaceRoot = join(root, "workspace");
    const projectDirectory = join(
      workspaceRoot,
      "00_创作项目",
      "项目",
      "催眠禁书目录_同人"
    );
    await mkdir(join(userDataPath, "config"), { recursive: true });
    await mkdir(join(projectDirectory, ".rules"), { recursive: true });
    await writeFile(
      join(projectDirectory, "AGENTS.md"),
      "fixture only",
      "utf8"
    );
    await writeFile(
      join(userDataPath, "config", "otter-workspace.json"),
      JSON.stringify({ workspaceRoot }),
      "utf8"
    );

    const service = new BookManagementService(
      userDataPath,
      {} as LongWorkspaceService
    );
    const adapter = new OtterProjectAdapter(workspaceRoot, userDataPath);
    const project = (await adapter.listProjects()).find(
      (item) => item.relativePath === "00_创作项目/项目/催眠禁书目录_同人"
    );
    expect(project).toMatchObject({
      title: "催眠禁书目录_同人",
      hasProtocol: false
    });
    if (!project) throw new Error("legacy fixture was not discovered");

    const described = (await run(service, "books.describeExternal", {
      projectId: project.id
    })) as { id: string; projectDirectory: string; identitySha256?: string };
    expect(described).toMatchObject({
      id: project.id,
      projectDirectory
    });
    expect(described.identitySha256).toBeUndefined();

    await expect(
      run(service, "books.removeExternal", {
        projectId: project.id,
        action: "hide",
        expectedProjectDirectory: projectDirectory,
        workspaceRoot
      })
    ).resolves.toMatchObject({ removed: true, action: "hide" });
    expect(await readHiddenBooks(userDataPath)).toMatchObject([
      { id: project.id, kind: "external", projectDirectory }
    ]);
    await expect(
      run(service, "books.removeExternal", {
        projectId: project.id,
        action: "delete",
        expectedProjectDirectory: projectDirectory,
        workspaceRoot
      })
    ).rejects.toThrow("不能彻底删除");

    await expect(
      run(service, "books.restore", {
        id: project.id,
        kind: "external",
        expectedProjectDirectory: projectDirectory,
        workspaceRoot
      })
    ).resolves.toMatchObject({ removed: false, action: "restore" });
    expect(await readHiddenBooks(userDataPath)).toEqual([]);
  });

  it("keeps a retryable pending record when rename fails and refuses restore until cleanup completes", async () => {
    let fail = true;
    let historyCalls = 0;
    const fixtureValue = await fixture(
      {
        renameDirectory: async (source, target) => {
          if (fail) {
            fail = false;
            throw new Error("simulated rename failure");
          }
          await rename(source, target);
        }
      },
      async () => {
        historyCalls += 1;
      }
    );
    const service = fixtureValue.service;
    const input = deletionInput(fixtureValue);

    await expect(run(service, "books.removeExternal", input)).rejects.toThrow(
      "simulated rename failure"
    );
    const pending = await readHiddenBooks(fixtureValue.userDataPath);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      deletePending: true,
      deleteQuarantineDirectory: expect.any(String)
    });
    expect(
      await readFile(
        join(fixtureValue.projectDirectory, ".novel", "project.json"),
        "utf8"
      )
    ).toContain("测试小说");
    await expect(
      run(service, "books.restore", {
        id: fixtureValue.projectId,
        kind: "external",
        expectedProjectDirectory: fixtureValue.projectDirectory,
        expectedIdentitySha256: fixtureValue.identitySha256,
        workspaceRoot: fixtureValue.workspaceRoot
      })
    ).rejects.toThrow("正在永久删除");

    await expect(
      run(service, "books.removeExternal", input)
    ).resolves.toMatchObject({ removed: true, action: "delete" });
    await expect(readFile(fixtureValue.projectDirectory)).rejects.toMatchObject(
      { code: "ENOENT" }
    );
    expect(await readHiddenBooks(fixtureValue.userDataPath)).toEqual([]);
    expect(historyCalls).toBe(1);
    expect(
      (await readdir(fixtureValue.workspaceRoot)).filter((name) =>
        name.startsWith(".deepwrite-delete-")
      ).length
    ).toBe(0);
  });

  it("retries quarantine cleanup and retains pending state if final registry replacement fails", async () => {
    let removals = 0;
    let registryReplacements = 0;
    let historyCalls = 0;
    const fixtureValue = await fixture(
      {
        removeDirectory: async (path) => {
          removals += 1;
          if (removals === 1)
            throw new Error("simulated quarantine cleanup failure");
          await rm(path, { recursive: true, force: false });
        },
        replaceFile: async (tempPath, targetPath) => {
          registryReplacements += 1;
          if (registryReplacements === 2)
            throw new Error("simulated atomic registry replacement failure");
          await rename(tempPath, targetPath);
        }
      },
      async () => {
        historyCalls += 1;
      }
    );
    const input = deletionInput(fixtureValue);

    await expect(
      run(fixtureValue.service, "books.removeExternal", input)
    ).rejects.toThrow("simulated quarantine cleanup failure");
    let pending = await readHiddenBooks(fixtureValue.userDataPath);
    expect(pending[0]).toMatchObject({
      deletePending: true,
      deleteQuarantineDirectory: expect.any(String)
    });

    await expect(
      run(fixtureValue.service, "books.removeExternal", input)
    ).rejects.toThrow("simulated atomic registry replacement failure");
    pending = await readHiddenBooks(fixtureValue.userDataPath);
    expect(pending[0]?.deletePending).toBe(true);
    expect(historyCalls).toBe(1);
    expect(
      (await readdir(join(fixtureValue.userDataPath, "config"))).some((name) =>
        name.endsWith(".tmp")
      )
    ).toBe(false);

    await expect(
      run(fixtureValue.service, "books.removeExternal", input)
    ).resolves.toMatchObject({ removed: true });
    expect(await readHiddenBooks(fixtureValue.userDataPath)).toEqual([]);
    expect(historyCalls).toBe(2);
  });

  it("does not restore a replaced external project or use another workspace's same relative ID", async () => {
    const fixtureValue = await fixture();
    await run(fixtureValue.service, "books.removeExternal", {
      ...deletionInput(fixtureValue),
      action: "hide"
    });
    await writeFile(
      join(fixtureValue.projectDirectory, ".novel", "project.json"),
      JSON.stringify({ project: "被替换的另一项目" }),
      "utf8"
    );
    await expect(
      run(fixtureValue.service, "books.restore", {
        id: fixtureValue.projectId,
        kind: "external",
        expectedProjectDirectory: fixtureValue.projectDirectory,
        expectedIdentitySha256: fixtureValue.identitySha256,
        workspaceRoot: fixtureValue.workspaceRoot
      })
    ).rejects.toThrow("身份已变化");
    expect(await readHiddenBooks(fixtureValue.userDataPath)).toHaveLength(1);
  });
});
