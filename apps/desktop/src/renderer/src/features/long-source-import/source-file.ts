const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export class SourceFileReadError extends Error {
  constructor(readonly reason: "too-large" | "invalid-utf8") {
    super(reason);
  }
}

/** Read text without replacement characters or newline/BOM normalization. */
export async function readUtf8SourceFile(
  file: Pick<File, "size" | "arrayBuffer">
): Promise<string> {
  if (file.size > MAX_SOURCE_BYTES) throw new SourceFileReadError("too-large");
  let content: string;
  try {
    content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true
    }).decode(await file.arrayBuffer());
  } catch {
    throw new SourceFileReadError("invalid-utf8");
  }
  if (new TextEncoder().encode(content).byteLength > MAX_SOURCE_BYTES)
    throw new SourceFileReadError("too-large");
  return content;
}
