import { describe, expect, it } from "vitest";
import { readUtf8SourceFile } from "./source-file";

function sourceFile(bytes: Uint8Array): Pick<File, "size" | "arrayBuffer"> {
  return {
    size: bytes.byteLength,
    arrayBuffer: async () =>
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer
  };
}

describe("readUtf8SourceFile", () => {
  it("preserves UTF-8 BOM and CRLF exactly", async () => {
    const bytes = new TextEncoder().encode("\uFEFF第一行\r\n第二行\r\n");
    expect(await readUtf8SourceFile(sourceFile(bytes))).toBe(
      "\uFEFF第一行\r\n第二行\r\n"
    );
  });

  it("rejects invalid UTF-8 instead of silently replacing source bytes", async () => {
    await expect(
      readUtf8SourceFile(sourceFile(Uint8Array.from([0xc3, 0x28])))
    ).rejects.toMatchObject({
      reason: "invalid-utf8"
    });
  });

  it("checks size before reading the file", async () => {
    const arrayBuffer = async () => {
      throw new Error("should not read oversized source");
    };
    await expect(
      readUtf8SourceFile({ size: 2 * 1024 * 1024 + 1, arrayBuffer })
    ).rejects.toMatchObject({
      reason: "too-large"
    });
  });
});
