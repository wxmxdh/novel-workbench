import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OtterManualHandoffService } from "./manual-handoff";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "otter-manual-"));
  roots.push(root);
  const workspaceRoot = join(root, "workspace");
  const projectRoot = join(workspaceRoot, "Novel");
  const userData = join(root, "user-data");
  await mkdir(join(projectRoot, "drafts"), { recursive: true });
  await mkdir(join(workspaceRoot, ".novel", "protocol"), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(
    join(workspaceRoot, "AGENTS.md"),
    "Current workspace policy.\n"
  );
  for (const name of [
    "authority",
    "task-routing",
    "chapter-workflow",
    "context-policy",
    "review-policy",
    "canon-policy",
    "third-party-policy",
    "skill-permissions"
  ])
    await writeFile(
      join(workspaceRoot, ".novel", "protocol", `${name}.md`),
      `# ${name}\n`
    );
  const source = join(projectRoot, "drafts", "chapter.md");
  await writeFile(source, "# Current draft\n\nText to review.\n");
  const service = new OtterManualHandoffService(userData, {
    resolveProject: async () => ({
      workspaceRoot,
      projectRoot,
      relativePath: "Novel"
    }),
    readSource: async (_projectId, path) => {
      const workspaceScoped = path.startsWith("workspace:");
      const root = workspaceScoped ? workspaceRoot : projectRoot;
      const relativePath = workspaceScoped
        ? path.slice("workspace:".length)
        : path;
      return {
        path,
        content: await readFile(resolve(root, relativePath), "utf8")
      };
    }
  });
  return { root, userData, projectRoot, source, service };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("manual Codex handoff", () => {
  it("creates navigation only, with an explicit writable report path and no project edits", async () => {
    const { source, projectRoot, service } = await fixture();
    const original = await readFile(source, "utf8");
    const result = await service.create({
      projectId: "otter_0123456789abcdef",
      sources: ["drafts/chapter.md"],
      instructions: "只核对本稿与明确来源，不推断人物心理。"
    });
    expect(result.prompt).toContain(resolve(source));
    expect(result.prompt).toContain("Do not modify any project file");
    expect(result.prompt).toContain("not evaluated");
    expect(result.prompt).toContain("third-party-policy.md");
    expect(result.prompt).toContain("snapshotted in this handoff");
    expect(result.reportPath).toBe(join(result.directory, "意见.md"));
    expect(await readFile(source, "utf8")).toBe(original);
    expect(
      (await service.readReport({ handoffId: result.handoffId })).status
    ).toBe("pending");
    expect(
      await readFile(join(projectRoot, "drafts", "chapter.md"), "utf8")
    ).toBe(original);
  });

  it("returns a readable report and marks it stale after a source changes", async () => {
    const { source, service } = await fixture();
    const result = await service.create({
      projectId: "otter_0123456789abcdef",
      sources: ["drafts/chapter.md"],
      instructions: "Review this draft."
    });
    await writeFile(
      result.reportPath,
      "# Findings\n\nNo hard-boundary issue found.\n"
    );
    const current = await service.readReport({ handoffId: result.handoffId });
    expect(current.status).toBe("pending");
    expect(current.markdown).toContain("No hard-boundary issue");
    expect(current.updatedAt).toBeTruthy();
    await writeFile(source, "# Changed draft\n\nNew text.\n");
    const stale = await service.readReport({ handoffId: result.handoffId });
    expect(stale.status).toBe("stale");
    expect(stale.markdown).toContain("# Findings");
  });

  it("uses a validated Context only for its current navigation and preserves its forbidden-read boundary", async () => {
    const { projectRoot, source, userData } = await fixture();
    const contextPath = ".novel/context/CTX-test.json";
    await mkdir(join(projectRoot, ".novel", "context"), { recursive: true });
    await writeFile(
      join(projectRoot, contextPath),
      JSON.stringify({
        sources: [{ path: "drafts/chapter.md", role: "draft under review" }],
        must_not_read: ["archive/ending.md"],
        intentional_unknowns: ["未确认角色当时的动机"]
      })
    );
    let validated = false;
    const service = new OtterManualHandoffService(userData, {
      resolveProject: async () => ({
        workspaceRoot: join(projectRoot, ".."),
        projectRoot,
        relativePath: "Novel"
      }),
      readSource: async (_projectId, path) => {
        const workspaceScoped = path.startsWith("workspace:");
        const root = workspaceScoped ? join(projectRoot, "..") : projectRoot;
        const relativePath = workspaceScoped
          ? path.slice("workspace:".length)
          : path;
        return {
          path,
          content: await readFile(resolve(root, relativePath), "utf8")
        };
      },
      resolveContext: async () => {
        validated = true;
        return { apiText: "verified context navigation" };
      }
    });
    const handoff = await service.create({
      projectId: "otter_0123456789abcdef",
      context: {
        projectId: "otter_0123456789abcdef",
        contextPath,
        receiptPath: ".novel/receipts/RCPT-test.json"
      },
      sources: [],
      instructions: "Review only the selected chapter."
    });
    expect(validated).toBe(true);
    expect(handoff.prompt).toContain(
      "Receipt records a read/preflight operation"
    );
    expect(handoff.prompt).toContain("archive/ending.md");
    expect(handoff.prompt).toContain("未确认角色当时的动机");
    expect(handoff.prompt).toContain(
      "V1 Context role metadata: draft under review"
    );
    expect(handoff.prompt).not.toContain("Text to review.");
    expect(await readFile(source, "utf8")).toContain("Text to review.");
  });

  it("rejects escaped, symbolic-link, and oversized report targets", async () => {
    const { root, service } = await fixture();
    await expect(
      service.create({
        projectId: "otter_0123456789abcdef",
        sources: ["../outside.md"],
        instructions: "review"
      })
    ).rejects.toThrow();
    const result = await service.create({
      projectId: "otter_0123456789abcdef",
      sources: ["drafts/chapter.md"],
      instructions: "review"
    });
    await rm(result.reportPath, { force: true });
    try {
      const { symlink } = await import("node:fs/promises");
      await symlink(join(root, "outside.md"), result.reportPath);
      await expect(
        service.readReport({ handoffId: result.handoffId })
      ).rejects.toThrow(/regular Markdown/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
  });

  it("detects handoff metadata tampering and rejects reading after workspace switch", async () => {
    const { root, userData, service } = await fixture();
    const first = await service.create({
      projectId: "otter_0123456789abcdef",
      sources: ["drafts/chapter.md"],
      instructions: "Review this source."
    });
    const manifestPath = join(first.directory, ".handoff.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      snapshots: Array<{ hash: string }>;
      [key: string]: unknown;
    };
    manifest.snapshots[0]!.hash = "0".repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(
      service.readReport({ handoffId: first.handoffId })
    ).rejects.toThrow(/metadata changed/);

    const second = await service.create({
      projectId: "otter_0123456789abcdef",
      sources: ["drafts/chapter.md"],
      instructions: "Review this source."
    });
    const otherWorkspace = join(root, "other-workspace");
    const otherProject = join(otherWorkspace, "Novel");
    await mkdir(otherProject, { recursive: true });
    const otherService = new OtterManualHandoffService(userData, {
      resolveProject: async () => ({
        workspaceRoot: otherWorkspace,
        projectRoot: otherProject,
        relativePath: "Novel"
      }),
      readSource: async () => ({ path: "", content: "" })
    });
    await expect(
      otherService.readReport({ handoffId: second.handoffId })
    ).rejects.toThrow(/selected project roots/);
  });
});
