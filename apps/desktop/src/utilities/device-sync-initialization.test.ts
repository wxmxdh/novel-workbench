import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sameSyncContent, syncItemSchema, syncKey } from "@deepwrite/contracts";
import {
  catalogFixture,
  FolderCatalogStore,
  makeTemporaryRoot
} from "./folder-catalog-store.test-support";
import { LongWorkspaceService } from "./long-workspace-service";
import {
  desktopSyncInventory,
  syncRegistrations
} from "./device-sync-inventory";
import {
  inspectDesktopInitialization,
  INITIALIZATION_RECEIPT
} from "./device-sync-initialization-inspection";
import { replaceDesktopInitialization } from "./device-sync-initialization";

async function setup() {
  const root = await realpath(
    await makeTemporaryRoot("deepwrite-initialization-")
  );
  const userDataPath = join(root, "data");
  const catalog = new FolderCatalogStore({ userDataPath });
  const long = new LongWorkspaceService({ userDataPath });
  await catalog.migrateSnapshot(catalogFixture());
  await long.create(root, { title: "旧长篇", genre: "悬疑" });
  const items = syncItemSchema
    .array()
    .parse(
      JSON.parse(
        await readFile(
          fileURLToPath(
            new URL("./fixtures/device-sync-mobile.json", import.meta.url)
          ),
          "utf8"
        )
      )
    );
  const replace = async (expectedFingerprint: string) =>
    replaceDesktopInitialization(userDataPath, {
      token: "initialize_test",
      items,
      expectedFingerprint,
      workspaceDirectory: join(root, "remote-projects")
    });
  return { root, userDataPath, catalog, long, items, replace };
}

describe("PC 从远端初始化本机", () => {
  it("目录缺失、清单损坏时仍可用手机真实数据重建，保留旧目录和注册表备份", async () => {
    const { userDataPath, items, replace, catalog, long } = await setup();
    const before = await syncRegistrations(userDataPath);
    const missing = before[0]!;
    const corrupt = before[1]!;
    await rm(missing.root, { recursive: true });
    await writeFile(
      join(corrupt.root, "deepwrite.json"),
      "broken old manifest"
    );
    const oldRegistry = await readFile(
      join(userDataPath, "catalog-registry.json"),
      "utf8"
    );
    expect(
      (await desktopSyncInventory(userDataPath)).issues.length
    ).toBeGreaterThan(0);
    const inspection = await inspectDesktopInitialization(userDataPath);
    expect(inspection.itemCount).toBe(before.length);
    await replace(inspection.fingerprint);
    const after = await desktopSyncInventory(userDataPath);
    expect(after.issues).toEqual([]);
    expect(after.items).toHaveLength(items.length);
    for (const item of items)
      expect(
        sameSyncContent(
          after.items.find((value) => syncKey(value) === syncKey(item)) ?? null,
          item
        )
      ).toBe(true);
    // Existing service instances read the new registries instead of cached ones.
    expect((await catalog.snapshot()).books).toHaveLength(2);
    expect((await long.list()).books).toHaveLength(1);
    expect(await readFile(join(corrupt.root, "deepwrite.json"), "utf8")).toBe(
      "broken old manifest"
    );
    const receipt = JSON.parse(
      await readFile(join(userDataPath, INITIALIZATION_RECEIPT), "utf8")
    );
    expect(receipt.token).toBe("initialize_test");
    expect(
      await readFile(
        join(userDataPath, receipt.recoveryDirectory, "catalog-registry.json"),
        "utf8"
      )
    ).toBe(oldRegistry);
    expect(
      await readFile(join(userDataPath, "catalog-registry.json.bak"), "utf8")
    ).toBe(await readFile(join(userDataPath, "catalog-registry.json"), "utf8"));
  }, 20_000);

  it("确认前本地新修改阻止替换，旧注册表和内容保留", async () => {
    const { userDataPath, replace } = await setup();
    const inspection = await inspectDesktopInitialization(userDataPath);
    const entry = (await syncRegistrations(userDataPath))[0]!;
    const registry = await readFile(
      join(userDataPath, "catalog-registry.json"),
      "utf8"
    );
    await writeFile(join(entry.root, "AGENTS.md"), "新的写作要求");
    await expect(replace(inspection.fingerprint)).rejects.toThrow(
      "本机数据已变化"
    );
    expect(
      await readFile(join(userDataPath, "catalog-registry.json"), "utf8")
    ).toBe(registry);
    expect(await readFile(join(entry.root, "AGENTS.md"), "utf8")).toBe(
      "新的写作要求"
    );
  }, 20_000);

  it("远端缺引用文件时不发布注册表，不清除任何本地项目", async () => {
    const { userDataPath, items, replace } = await setup();
    const before = await desktopSyncInventory(userDataPath);
    const target = items.find((item) => item.kind === "long-book")!;
    delete target.files["long/index.json"];
    const inspection = await inspectDesktopInitialization(userDataPath);
    await expect(replace(inspection.fingerprint)).rejects.toThrow();
    expect(await desktopSyncInventory(userDataPath)).toEqual(before);
    expect(await readdir(userDataPath)).not.toContain(INITIALIZATION_RECEIPT);
  }, 20_000);

  it("全新 PC 可以初始化，后续读取不会重新迁入旧快照", async () => {
    const { root, items } = await setup();
    const userDataPath = join(root, "fresh");
    await mkdir(userDataPath);
    const inspection = await inspectDesktopInitialization(userDataPath);
    await replaceDesktopInitialization(userDataPath, {
      token: "fresh_test",
      items,
      expectedFingerprint: inspection.fingerprint,
      workspaceDirectory: root
    });
    const catalog = new FolderCatalogStore({
      userDataPath,
      initialSnapshot: catalogFixture()
    });
    expect((await catalog.snapshot()).books).toHaveLength(2);
    expect(
      JSON.parse(
        await readFile(join(userDataPath, "catalog-registry.json"), "utf8")
      ).sourceCatalogMigrated
    ).toBe(true);
  }, 20_000);
});
