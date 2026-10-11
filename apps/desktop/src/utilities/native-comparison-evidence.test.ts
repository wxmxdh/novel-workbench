import { describe, expect, it, vi } from "vitest";
import { fixtureWorldbuildingIndex } from "../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import type { LongWorkspaceService } from "./long-workspace-service";
import { readNativeComparisonEvidence } from "./native-comparison-evidence";

describe("native comparison evidence", () => {
  it("reads complete source and character pages, preserving original paths without other model bodies", async () => {
    const index = fixtureWorldbuildingIndex();
    const refs = [
      index.bookLine,
      ...index.characterFiles.flatMap((item) => [
        item.coreProfile,
        item.relationships
      ]),
      ...index.worldbuilding.flatMap((category) =>
        category.format === "list"
          ? category.items.map((item) => item.file)
          : [category.file]
      )
    ];
    const firstPage = "上半段。";
    const secondPage = "末段未决。";
    const readDocument = vi.fn(
      async ({ fileId, offset }: { fileId: string; offset: number }) => {
        const file = refs.find((item) => item.id === fileId)!;
        return {
          bookId: index.bookId,
          file,
          content: offset === 0 ? firstPage : secondPage,
          offset,
          totalCharacters: Array.from(firstPage + secondPage).length,
          nextOffset: offset === 0 ? Array.from(firstPage).length : null
        };
      }
    );
    const service = {
      readAgentsMd: async () => ({ content: "本书边界", truncated: false }),
      readDocument
    } as unknown as LongWorkspaceService;
    const text = await readNativeComparisonEvidence(service, index);
    expect(text).toContain("上半段。末段未决。");
    for (const file of refs) expect(text).toContain(file.path);
    expect(readDocument.mock.calls).toHaveLength(refs.length * 2);
    expect(
      readDocument.mock.calls.every(([query]) =>
        refs.some((file) => file.id === query.fileId)
      )
    ).toBe(true);
  });
  it("refuses a changed or incorrectly identified document", async () => {
    const index = fixtureWorldbuildingIndex();
    const service = {
      readAgentsMd: async () => ({ content: "规则", truncated: false }),
      readDocument: async () => ({
        bookId: "wrong-book",
        file: index.bookLine,
        content: "坏来源",
        totalCharacters: 3,
        nextOffset: null
      })
    } as unknown as LongWorkspaceService;
    await expect(readNativeComparisonEvidence(service, index)).rejects.toThrow(
      "读取中变化"
    );
  });
});
