import {
  mkdir,
  lstat,
  readFile,
  readdir,
  writeFile,
  rename,
  rm
} from "node:fs/promises";
import { join } from "node:path";
import { createId } from "@deepwrite/shared";
import {
  ShortBookAnalysisSourceSchema,
  type CommandEnvelope,
  type CommandResult,
  type ShortBookAnalysisSource
} from "@deepwrite/contracts";

async function directory(workspace: string): Promise<string> {
  const path = join(workspace, "short-book-analysis-sources");
  await mkdir(path, { recursive: true });
  if (
    !(await lstat(path)).isDirectory() ||
    (await lstat(path)).isSymbolicLink()
  )
    throw new Error("短篇来源目录不安全。");
  return path;
}
async function load(
  path: string,
  id: string
): Promise<ShortBookAnalysisSource> {
  const file = join(path, `${id}.json`);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
    throw new Error("短篇来源快照不安全或过大。");
  const source = ShortBookAnalysisSourceSchema.parse(
    JSON.parse(await readFile(file, "utf8"))
  );
  if (source.id !== id) throw new Error("短篇来源标识不一致。");
  return source;
}
export function withShortBookAnalysisSources(
  handler: (command: CommandEnvelope) => Promise<CommandResult>
) {
  return async (command: CommandEnvelope): Promise<CommandResult> => {
    if (
      command.type !== "shortBookAnalysis.storeSources" &&
      command.type !== "shortBookAnalysis.deleteStoredSource" &&
      command.type !== "shortBookAnalysis.querySources"
    )
      return handler(command);
    try {
      const path = await directory(command.payload.workspaceDirectory);
      let payload: unknown;
      if (command.type === "shortBookAnalysis.storeSources") {
        for (const source of command.payload.sources) {
          const target = join(path, `${source.id}.json`);
          const temporary = join(path, `${createId("pending")}.tmp`);
          try {
            await writeFile(temporary, JSON.stringify(source), {
              encoding: "utf8",
              flag: "wx",
              mode: 0o600
            });
            await rename(temporary, target);
          } finally {
            await rm(temporary, { force: true });
          }
        }
        payload = command.payload.sources;
      } else if (command.type === "shortBookAnalysis.deleteStoredSource") {
        const sourceId = ShortBookAnalysisSourceSchema.shape.id.parse(
          command.payload.sourceId
        );
        await rm(join(path, `${sourceId}.json`), { force: true });
        payload = sourceId;
      } else if (command.payload.sourceId) {
        payload = await load(path, command.payload.sourceId);
      } else {
        const sources = [];
        for (const name of await readdir(path)) {
          if (!/^[a-z0-9_-]+\.json$/iu.test(name)) continue;
          const source = await load(path, name.slice(0, -5));
          const { text, ...summary } = source;
          sources.push({ ...summary, characterCount: text.length });
        }
        payload = {
          sources: sources.sort((a, b) =>
            b.importedAt.localeCompare(a.importedAt)
          )
        };
      }
      return { status: "accepted", requestId: command.id, payload };
    } catch (error) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "short_book_analysis.source_failed",
          message: error instanceof Error ? error.message : "读取短篇来源失败。"
        }
      };
    }
  };
}
