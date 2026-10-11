import { lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Locate a co-located workspace from the application, never by recent activity.
 * Installed copies outside the workspace retain the explicit folder chooser. */
export async function findAdjacentOtterWorkspace(
  startPaths: string[]
): Promise<string | null> {
  const seen = new Set<string>();
  for (const start of startPaths) {
    let current = resolve(start);
    for (let depth = 0; depth < 10; depth++) {
      if (!seen.has(current)) {
        seen.add(current);
        const required = [
          join(current, ".novel", "protocol", "authority.md"),
          join(current, "06_脚本工具", "写作协议V1", "novel-cli.mjs"),
          join(current, "00_创作项目", "项目索引.md")
        ];
        const states = await Promise.all(
          required.map((path) => lstat(path).catch(() => null))
        );
        if (states.every((state) => state?.isFile() && !state.isSymbolicLink()))
          return realpath(current);
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}
