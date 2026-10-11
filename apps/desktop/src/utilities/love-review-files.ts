import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

export const reviewHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const reviewSetHash = (entries: { id: string; sha256: string }[]) =>
  reviewHash(JSON.stringify(entries.map(({ id, sha256 }) => ({ id, sha256 }))));

export async function readReviewFile(
  root: string,
  path: string
): Promise<string> {
  if (
    !path ||
    isAbsolute(path) ||
    /[:\0]/u.test(path) ||
    path.split(/[\\/]/u).some((part) => !part || part === "." || part === "..")
  )
    throw new Error("审阅来源必须是 LOVE 项目内的相对路径。");
  const filename = join(root, path);
  const stat = await lstat(filename);
  const actual = await realpath(filename);
  const boundary = relative(await realpath(root), actual);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 8_000_000 ||
    isAbsolute(boundary) ||
    boundary === ".." ||
    boundary.startsWith(`..${sep}`)
  )
    throw new Error("审阅来源越界、不是普通文件或过大。");
  return readFile(actual, "utf8");
}

export async function writeReviewJson(
  root: string,
  reviewId: string,
  value: unknown
) {
  if (!/^review-[a-zA-Z0-9-]{16,100}$/u.test(reviewId))
    throw new Error("审阅批次标识无效。");
  const directory = join(root, ".novel", "reviews", reviewId);
  await mkdir(directory, { recursive: true });
  const location = relative(await realpath(root), await realpath(directory));
  if (
    isAbsolute(location) ||
    location === ".." ||
    location.startsWith(`..${sep}`)
  )
    throw new Error("审阅记录目录越界。");
  const filename = join(directory, "manifest.json");
  try {
    const previousText = await readReviewFile(
      root,
      `.novel/reviews/${reviewId}/manifest.json`
    );
    const previous = JSON.parse(previousText) as {
      snapshot?: {
        targetSetSha256?: string;
        sourceSetSha256?: string;
        reports?: unknown[];
        coverage?: unknown;
      };
    };
    // Preserve prior judgments before a replacement summary/report invalidates
    // them. History is evidence of an older stage, never current coverage.
    if (
      previous.snapshot?.reports?.length &&
      previousText !== JSON.stringify(value, null, 2) + "\n"
    ) {
      await writeFile(
        join(directory, `history-${randomUUID()}.json`),
        JSON.stringify(
          {
            recordedAt: new Date().toISOString(),
            reviewId,
            targetSetSha256: previous.snapshot.targetSetSha256,
            sourceSetSha256: previous.snapshot.sourceSetSha256,
            reports: previous.snapshot.reports,
            coverage: previous.snapshot.coverage
          },
          null,
          2
        ) + "\n",
        { flag: "wx" }
      );
    }
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
  }
  const temporary = join(
    dirname(filename),
    `manifest-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
  );
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx"
  });
  await rename(temporary, filename);
}

export function reviewField(
  content: string,
  field: string
): string | undefined {
  const header = content
    .replace(/^\uFEFF/u, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1];
  const raw = header
    ?.match(new RegExp(`^${field}:\\s*(.+)$`, "mu"))?.[1]
    ?.trim();
  if (!raw) return undefined;
  if (raw.startsWith('"')) {
    try {
      return String(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  return raw.replace(/^'|'$/gu, "");
}
