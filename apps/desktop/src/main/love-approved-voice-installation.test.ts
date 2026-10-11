import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  LongImportSourceInputSchema,
  LongReadDocumentInputSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { LongWorkspaceService } from "../utilities/long-workspace-service";
import publicBundle from "./love-approved-voice-bundle";
import type { LoveApprovedVoiceBundle } from "./love-approved-voice-bundle";
import { installLoveApprovedVoicePackage } from "./love-approved-voice-installation";

const roots: string[] = [];
const TEST_BOOK_ID = "longbook_voice_fixture";
const fixtureBundle: LoveApprovedVoiceBundle = {
  bookId: TEST_BOOK_ID,
  packageId: "test-approved-voice",
  files: [
    {
      title: "测试清单",
      sourcePath: "approved/manifest.json",
      content: '{"fixture":true}',
      sha256: ""
    },
    {
      title: "测试样本文本",
      sourcePath: "approved/sample.md",
      content: "Synthetic sample text used only in this test.",
      sha256: ""
    },
    {
      title: "测试范围说明",
      sourcePath: "approved/scope.md",
      content: "Synthetic scope notes used only in this test.",
      sha256: ""
    }
  ]
};
for (const source of fixtureBundle.files) {
  source.sha256 = createHash("sha256")
    .update(source.content, "utf8")
    .digest("hex");
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "approved-voice-install-"));
  roots.push(root);
  const service = new LongWorkspaceService({
    userDataPath: join(root, "profile")
  });
  await mkdir(join(root, "books"));
  const created = await service.store.createBook(join(root, "books"), {
    id: fixtureBundle.bookId,
    title: "LOVE",
    genre: "测试"
  });
  await service.openAtPath(created.projectDirectory);
  const request = async (command: CommandEnvelope): Promise<CommandResult> => {
    let payload: unknown;
    if (command.type === "long.list") payload = await service.list();
    else if (command.type === "long.getWorkspaceIndex")
      payload = await service.getWorkspaceIndex({
        bookId: fixtureBundle.bookId
      });
    else if (command.type === "long.importSource")
      payload = await service.importSource(
        LongImportSourceInputSchema.parse(command.payload)
      );
    else if (command.type === "long.readDocument")
      payload = await service.readDocument(
        LongReadDocumentInputSchema.parse(command.payload)
      );
    else throw new Error("Unexpected command " + command.type);
    return { status: "accepted", requestId: command.id, payload };
  };
  return { service, request, created };
}
describe("approved voice package Core installation", () => {
  it("does not query Core when the public repository has no private package", async () => {
    let calls = 0;
    const result = await installLoveApprovedVoicePackage(async () => {
      calls += 1;
      throw new Error("Core must not be called");
    });
    expect(result).toEqual({ status: "package-not-included", imported: 0 });
    expect(calls).toBe(0);
    expect(publicBundle.files).toEqual([]);
  });

  it("imports exact bytes through the real Core service and is idempotent", async () => {
    const f = await fixture();
    expect(
      (await installLoveApprovedVoicePackage(f.request, fixtureBundle)).imported
    ).toBe(3);
    expect(
      (await installLoveApprovedVoicePackage(f.request, fixtureBundle)).imported
    ).toBe(0);
    const { workspaceIndex } = await f.service.getWorkspaceIndex({
      bookId: fixtureBundle.bookId
    });
    expect(workspaceIndex.importedSources).toHaveLength(3);
    for (const source of workspaceIndex.importedSources) {
      const expected = fixtureBundle.files.find(
        (file) => file.sourcePath === source.sourcePath
      )!;
      expect(
        await readFile(
          join(f.created.projectDirectory, source.file.path),
          "utf8"
        )
      ).toBe(expected.content);
      expect(source.authority).toBe("reference");
      expect(source.sourceSha256).toBe(expected.sha256);
    }
  });
  it("preserves an existing conflicting source and imports nothing over it", async () => {
    const f = await fixture();
    const { workspaceIndex } = await f.service.getWorkspaceIndex({
      bookId: fixtureBundle.bookId
    });
    const existing = await f.service.importSource({
      bookId: fixtureBundle.bookId,
      title: fixtureBundle.files[0]!.title,
      sourceName: "manifest.json",
      sourcePath: fixtureBundle.files[0]!.sourcePath,
      content: "作者正在编辑的旧资料",
      purpose: "reference",
      authority: "reference",
      expectedIndexUpdatedAt: workspaceIndex.updatedAt
    });
    await expect(
      installLoveApprovedVoicePackage(f.request, fixtureBundle)
    ).rejects.toThrow("保留原文");
    expect(
      await readFile(
        join(f.created.projectDirectory, existing.source.file.path),
        "utf8"
      )
    ).toBe("作者正在编辑的旧资料");
    expect(
      (await f.service.getWorkspaceIndex({ bookId: fixtureBundle.bookId }))
        .workspaceIndex.importedSources
    ).toHaveLength(1);
  });
});
