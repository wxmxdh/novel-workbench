import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OtterProjectAdapter } from "./project-adapter";

const roots: string[] = [];
const relativePath = "00_创作项目/项目/LOVE";
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "otter-registration-test-"));
  roots.push(root);
  const projectRoot = join(root, relativePath);
  const userData = join(root, "user-data");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(join(userData, "config"), { recursive: true });
  await writeFile(
    join(projectRoot, "AGENTS.md"),
    "# Isolated registration entry\n"
  );
  return {
    root,
    projectRoot,
    userData,
    adapter: new OtterProjectAdapter(root, userData)
  };
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("Core pre-registration directory resolution", () => {
  it("locates an existing AGENTS-only entry before its manifest is registered", async () => {
    const { adapter, projectRoot } = await setup();
    expect(await adapter.listProjects()).toEqual([]);
    const resolved =
      await adapter.resolveProjectRegistrationDirectory(relativePath);
    expect(resolved.projectRoot).toBe(projectRoot);
    expect(resolved.relativePath).toBe(relativePath);
    expect(await adapter.listProjects()).toEqual([]);
  });
  it("refuses a project pending deletion before registration writes occur", async () => {
    const { adapter, root, projectRoot, userData } = await setup();
    const id = `otter_${createHash("sha256").update(relativePath).digest("hex").slice(0, 16)}`;
    await writeFile(
      join(userData, "config/hidden-books.json"),
      JSON.stringify([
        {
          id,
          kind: "external",
          title: "LOVE",
          projectDirectory: projectRoot,
          workspaceRoot: root,
          hiddenAt: new Date().toISOString(),
          deletePending: true,
          deleteQuarantineDirectory: join(root, ".deepwrite-delete-pending")
        }
      ])
    );
    await expect(
      adapter.resolveProjectRegistrationDirectory(relativePath)
    ).rejects.toThrow("正在永久删除");
  });
  it("refuses traversal, missing directories, and entries without AGENTS", async () => {
    const { adapter, root } = await setup();
    await expect(
      adapter.resolveProjectRegistrationDirectory("../outside")
    ).rejects.toThrow();
    await expect(
      adapter.resolveProjectRegistrationDirectory("missing")
    ).rejects.toThrow();
    await mkdir(join(root, "empty"));
    await expect(
      adapter.resolveProjectRegistrationDirectory("empty")
    ).rejects.toThrow();
  });
});
