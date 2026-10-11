import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "@deepwrite/contracts";
import {
  buildLibraryMarkdownZip,
  readLibraryMarkdownZip,
  writeLibraryMarkdownZip
} from "./library-markdown-archive";
import { readExternalLibraryEntries } from "./external-library-import";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

function catalogFixture(): CatalogSnapshot {
  return {
    schemaVersion: 1,
    revision: 1,
    creativePlotStages: [],
    books: [],
    materials: [],
    materialGroups: [],
    skills: [
      {
        id: "skills-1",
        title: "说人话",
        skillType: "short",
        skillKind: "general",
        overview: "自然中文表达",
        isBuiltin: false,
        entries: [
          {
            id: "entry-1",
            stageId: "draft",
            title: "口语化审读",
            body: "保留作者原意。\n检查翻译腔。",
            createdAt: "2026-10-11T00:00:00.000Z",
            updatedAt: "2026-10-11T00:00:00.000Z"
          }
        ],
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z"
      }
    ],
    skillGroups: [],
    updatedAt: "2026-10-11T00:00:00.000Z"
  } as CatalogSnapshot;
}

describe("library Markdown ZIP transfer", () => {
  it("round-trips a native skill library's Markdown entries through ZIP", async () => {
    const archive = buildLibraryMarkdownZip(catalogFixture(), {
      domain: "skill",
      targetType: "library",
      targetId: "skills-1"
    });
    const root = await mkdtemp(join(tmpdir(), "deepwrite-library-zip-"));
    roots.push(root);
    const path = join(root, archive.fileName);
    await writeLibraryMarkdownZip(path, archive.entries);

    const imported = await readLibraryMarkdownZip(path);
    expect(imported.candidates).toEqual([
      {
        sourceName: "口语化审读.md",
        title: "口语化审读",
        content: "保留作者原意。\n检查翻译腔。"
      }
    ]);
    expect((await readFile(path)).subarray(0, 2)).toEqual(Buffer.from("PK"));
    const preview = await readExternalLibraryEntries("file", [path]);
    expect(preview.candidates).toEqual([
      {
        id: "external-library-entry-1",
        title: "口语化审读",
        sourceName: "口语化审读.md",
        content: "保留作者原意。\n检查翻译腔。"
      }
    ]);
  });

  it("exports only the member libraries of the selected group", () => {
    const snapshot = catalogFixture();
    snapshot.skillGroups = [
      {
        id: "group-1",
        title: "审稿组",
        members: { general: "skills-1" },
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z"
      }
    ];
    const archive = buildLibraryMarkdownZip(snapshot, {
      domain: "skill",
      targetType: "group",
      targetId: "group-1"
    });
    expect(archive.entries.map(({ name }) => name)).toEqual([
      "说人话/口语化审读.md"
    ]);
  });

  it("allocates unique ZIP paths for duplicate and case-folded names", () => {
    const snapshot = catalogFixture();
    const firstLibrary = snapshot.skills[0]!;
    firstLibrary.title = "Foo";
    firstLibrary.entries.push(
      {
        ...firstLibrary.entries[0]!,
        id: "entry-2",
        title: "case",
        body: "lowercase"
      },
      {
        ...firstLibrary.entries[0]!,
        id: "entry-3",
        title: "Case",
        body: "uppercase"
      },
      {
        ...firstLibrary.entries[0]!,
        id: "entry-5",
        title: "口语化审读 (2)",
        body: "suffix collision"
      }
    );
    snapshot.skills.push({
      ...firstLibrary,
      id: "skills-2",
      title: "foo",
      entries: [
        {
          ...firstLibrary.entries[0]!,
          id: "entry-4",
          body: "same folder and entry title"
        }
      ]
    });
    snapshot.skillGroups = [
      {
        id: "group-1",
        title: "审稿组",
        members: { general: "skills-1", plot: "skills-2" },
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z"
      }
    ];

    const archive = buildLibraryMarkdownZip(snapshot, {
      domain: "skill",
      targetType: "group",
      targetId: "group-1"
    });

    const normalizedNames = archive.entries.map(({ name }) =>
      name.normalize("NFC").toLocaleLowerCase("en-US")
    );
    expect(new Set(normalizedNames).size).toBe(normalizedNames.length);
    expect(archive.entries.map(({ name }) => name)).toContain(
      "Foo/口语化审读.md"
    );
    expect(archive.entries.map(({ name }) => name)).toContain(
      "foo/口语化审读 (3).md"
    );
    expect(archive.entries.map(({ name }) => name)).toContain(
      "Foo/Case (2).md"
    );
  });

  it("reports ZIP entries omitted by the candidate limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-library-limit-"));
    roots.push(root);
    const path = join(root, "large.zip");
    await writeLibraryMarkdownZip(
      path,
      Array.from({ length: 4_097 }, (_, index) => ({
        name: `entry-${index}.md`,
        data: Buffer.from(`content ${index}`, "utf8")
      }))
    );

    const preview = await readExternalLibraryEntries("file", [path]);

    expect(preview.candidates).toHaveLength(4_096);
    expect(preview.scanned).toBe(4_097);
    expect(preview.skipped.limitExceeded).toBe(1);
  });

  it("surfaces the aggregate extracted-text limit instead of treating it as unreadable", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-library-size-"));
    roots.push(root);
    const path = join(root, "large-text.zip");
    const body = Buffer.from("x".repeat(4 * 1024 * 1024), "utf8");
    await writeLibraryMarkdownZip(
      path,
      Array.from({ length: 9 }, (_, index) => ({
        name: `large-${index}.md`,
        data: body
      }))
    );

    const preview = await readExternalLibraryEntries("file", [path]);

    expect(preview.candidates).toHaveLength(0);
    expect(preview.skipped.tooLarge).toBe(1);
    expect(preview.skipped.unreadable).toBe(0);
  });
});
