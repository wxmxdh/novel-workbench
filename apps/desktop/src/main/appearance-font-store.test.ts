import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES,
  APPEARANCE_CUSTOM_FONT_MAX_TOTAL_BYTES,
  type AppearanceFontInstallResult
} from "@deepwrite/contracts";
import { AppearanceFontStore } from "./appearance-font-store";
import { canCreateFileSymlink } from "../test-utils/windows-fs";

const temporaryRoots: string[] = [];
const FILE_SYMLINK_AVAILABLE = await canCreateFileSymlink();

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `deepwrite-font-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function ttfBytes(marker = 0): Buffer {
  return Buffer.from([0x00, 0x01, 0x00, 0x00, marker]);
}

function otfBytes(marker = 0): Buffer {
  return Buffer.from([0x4f, 0x54, 0x54, 0x4f, marker]);
}

async function createFont(
  root: string,
  relativePath: string,
  bytes = ttfBytes()
): Promise<string> {
  const path = join(root, relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

function completed(result: AppearanceFontInstallResult) {
  expect(result.status).toBe("completed");
  if (result.status === "canceled") throw new Error("unexpected cancellation");
  return result;
}

describe("AppearanceFontStore", () => {
  it("copies an installed font into private storage and reloads it", async () => {
    const root = await temporaryRoot("persist");
    const userData = join(root, "user-data");
    const source = await createFont(root, "input/仓耳云黑.ttf", ttfBytes(7));
    const store = new AppearanceFontStore(
      userData,
      () => new Date("2026-08-24T00:00:00.000Z")
    );

    const installed = completed(await store.install([source]));
    expect(installed.installedIds).toHaveLength(1);
    expect(installed.catalog.fonts).toEqual([
      expect.objectContaining({
        id: installed.installedIds[0],
        displayName: "仓耳云黑",
        format: "ttf",
        byteSize: 5,
        installedAt: "2026-08-24T00:00:00.000Z"
      })
    ]);
    expect(await readFile(store.catalogPath, "utf8")).not.toContain(source);

    await rm(source);
    const reloaded = new AppearanceFontStore(userData);
    await expect(reloaded.list()).resolves.toEqual(installed.catalog);
    const asset = await reloaded.resolveAsset(installed.installedIds[0]!);
    expect(asset).toMatchObject({ format: "ttf", byteSize: 5 });
    await expect(readFile(asset!.path)).resolves.toEqual(ttfBytes(7));
  });

  it("deduplicates by content and disambiguates equal display names", async () => {
    const root = await temporaryRoot("dedupe");
    const first = await createFont(root, "one/Example.otf", otfBytes(1));
    const second = await createFont(root, "two/Example.otf", otfBytes(2));
    const store = new AppearanceFontStore(join(root, "user-data"));

    const initial = completed(await store.install([first, second]));
    expect(initial.catalog.fonts.map((font) => font.displayName)).toEqual([
      "Example",
      "Example (2)"
    ]);
    const duplicate = completed(await store.install([first]));
    expect(duplicate.installedIds).toEqual([]);
    expect(duplicate.duplicateIds).toEqual([initial.installedIds[0]]);
    expect(duplicate.catalog).toEqual(initial.catalog);
  });

  it("rejects unsafe, unsupported, invalid, oversized, and missing inputs", async () => {
    const root = await temporaryRoot("reject");
    const directory = join(root, "directory.ttf");
    await mkdir(directory);
    const unsupported = await createFont(root, "font.woff");
    const mismatched = await createFont(root, "font.ttf", otfBytes());
    const oversized = join(root, "oversized.ttf");
    const oversizedHandle = await open(oversized, "w");
    await oversizedHandle.truncate(APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES + 1);
    await oversizedHandle.close();
    const missing = join(root, "missing.otf");

    const result = completed(
      await new AppearanceFontStore(join(root, "user-data")).install([
        directory,
        unsupported,
        mismatched,
        oversized,
        missing
      ])
    );
    expect(result.installedIds).toEqual([]);
    expect(result.rejected.map((entry) => entry.code)).toEqual([
      "not_regular_file",
      "unsupported_format",
      "invalid_font",
      "file_too_large",
      "read_failed"
    ]);
  });

  it.skipIf(!FILE_SYMLINK_AVAILABLE)(
    "rejects regular-file symlinks when the host permits creating them",
    async () => {
      const root = await temporaryRoot("reject-symlink");
      const original = await createFont(root, "original.ttf");
      const linked = join(root, "linked.ttf");
      await symlink(original, linked, "file");

      const result = completed(
        await new AppearanceFontStore(join(root, "user-data")).install([linked])
      );
      expect(result.installedIds).toEqual([]);
      expect(result.rejected.map((entry) => entry.code)).toEqual([
        "not_regular_file"
      ]);
    }
  );

  it("limits one batch to twenty selected files", async () => {
    const root = await temporaryRoot("batch");
    const sources = await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        createFont(root, `input/font-${index}.ttf`, ttfBytes(index))
      )
    );
    const result = completed(
      await new AppearanceFontStore(join(root, "user-data")).install(sources)
    );

    expect(result.installedIds).toHaveLength(20);
    expect(result.catalog.fonts).toHaveLength(20);
    expect(result.rejected).toEqual([
      { displayName: "font-20.ttf", code: "catalog_limit" }
    ]);
  });

  it("enforces the one-hundred-font catalog limit", async () => {
    const root = await temporaryRoot("count-limit");
    const store = new AppearanceFontStore(join(root, "user-data"));
    for (let batch = 0; batch < 5; batch += 1) {
      const sources = await Promise.all(
        Array.from({ length: 20 }, (_, offset) => {
          const index = batch * 20 + offset;
          return createFont(
            root,
            `input/font-${index}.ttf`,
            Buffer.concat([ttfBytes(), Buffer.from(String(index))])
          );
        })
      );
      expect(completed(await store.install(sources)).installedIds).toHaveLength(
        20
      );
    }
    const extra = await createFont(root, "input/extra.ttf", ttfBytes(255));
    const result = completed(await store.install([extra]));

    expect(result.catalog.fonts).toHaveLength(100);
    expect(result.rejected).toEqual([
      { displayName: "extra.ttf", code: "catalog_limit" }
    ]);
  });

  it("enforces the total private font storage limit", async () => {
    const root = await temporaryRoot("size-limit");
    const store = new AppearanceFontStore(join(root, "user-data"));
    await mkdir(store.filesDirectory, { recursive: true });
    const fonts = [];
    for (
      let index = 0;
      index <
      APPEARANCE_CUSTOM_FONT_MAX_TOTAL_BYTES /
        APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES;
      index += 1
    ) {
      const id = `font_${index.toString(16).padStart(64, "0")}`;
      const path = join(store.filesDirectory, `${id}.ttf`);
      const handle = await open(path, "w");
      await handle.truncate(APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES);
      await handle.close();
      fonts.push({
        id,
        displayName: `Seed ${index}`,
        format: "ttf",
        byteSize: APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES,
        installedAt: "2026-08-24T00:00:00.000Z"
      });
    }
    await writeFile(
      store.catalogPath,
      `${JSON.stringify({ version: 1, fonts })}\n`,
      "utf8"
    );
    const extra = await createFont(root, "input/extra.ttf", ttfBytes(222));

    const result = completed(await store.install([extra]));
    expect(result.catalog.fonts).toHaveLength(fonts.length);
    expect(result.rejected).toEqual([
      { displayName: "extra.ttf", code: "catalog_limit" }
    ]);
  });

  it("serializes concurrent installs without losing or duplicating entries", async () => {
    const root = await temporaryRoot("queue");
    const source = await createFont(root, "input/Concurrent.ttf", ttfBytes(9));
    const store = new AppearanceFontStore(join(root, "user-data"));

    const results = (
      await Promise.all([store.install([source]), store.install([source])])
    ).map(completed);
    expect(results.flatMap((result) => result.installedIds)).toHaveLength(1);
    expect(results.flatMap((result) => result.duplicateIds)).toHaveLength(1);
    await expect(store.list()).resolves.toMatchObject({ fonts: [{}] });
  });

  it("removes catalog and asset data and safely rejects unknown asset ids", async () => {
    const root = await temporaryRoot("remove");
    const source = await createFont(root, "input/Remove.otf", otfBytes(8));
    const store = new AppearanceFontStore(join(root, "user-data"));
    const installed = completed(await store.install([source]));
    const id = installed.installedIds[0]!;
    const asset = await store.resolveAsset(id);

    await expect(store.resolveAsset("../catalog.json")).resolves.toBeNull();
    await expect(store.remove(id)).resolves.toEqual({
      removed: true,
      catalog: { fonts: [] }
    });
    await expect(lstat(asset!.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.remove(id)).resolves.toEqual({
      removed: false,
      catalog: { fonts: [] }
    });
  });

  it("recovers from a malformed catalog without exposing orphaned files", async () => {
    const root = await temporaryRoot("corrupt");
    const store = new AppearanceFontStore(join(root, "user-data"));
    await mkdir(join(store.catalogPath, ".."), { recursive: true });
    await mkdir(store.filesDirectory, { recursive: true });
    const orphan = join(store.filesDirectory, `font_${"a".repeat(64)}.ttf`);
    await writeFile(orphan, ttfBytes(4));
    await writeFile(store.catalogPath, "{ invalid", "utf8");

    await expect(store.list()).resolves.toEqual({ fonts: [] });
    await expect(
      store.resolveAsset(`font_${"a".repeat(64)}`)
    ).resolves.toBeNull();
    const files = await readdir(join(store.catalogPath, ".."));
    expect(files.sort()).toEqual(["catalog.json", "files"]);
    await expect(readdir(store.filesDirectory)).resolves.toEqual([]);
    await expect(readFile(store.catalogPath, "utf8")).resolves.toContain(
      '"version": 1'
    );
  });
});
