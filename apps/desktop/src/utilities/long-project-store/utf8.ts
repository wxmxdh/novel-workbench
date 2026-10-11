import { TextDecoder } from "node:util";

export function encodeUtf8Strict(content: string): Buffer {
  const bytes = Buffer.from(content, "utf8");
  if (
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !==
    content
  ) {
    throw new Error("长篇文件内容包含无效 Unicode 字符。");
  }
  return bytes;
}
