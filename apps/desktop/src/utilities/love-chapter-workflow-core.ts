import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { promisify } from "node:util";
import {
  LongLoveChapterWorkflowCommandEnvelopeSchema,
  type LongLoveChapterWorkflowCommandInput
} from "@deepwrite/contracts";
import { withExternalProjectLock } from "./external-project-operations";
import { requireProject } from "./novel-writing-store";

const execFileAsync = promisify(execFile);
const LOVE_BOOK_ID = "longbook_9a146bbe";
const SCRIPT_PATH =
  "D:/AI/Claude Code/03_娱乐与创作/01_小说创作/小说/我的小说工作台/LOVE_Codex审核交接/工具/love-chapter-workflow.mjs";
const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const nativeTempPrefix = "deepwrite-love-native-";

async function ownedNativeTempPath(path: string): Promise<string> {
  const [tempRoot, tempParent, target] = await Promise.all([
    realpath(tmpdir()),
    realpath(dirname(path)),
    realpath(path)
  ]);
  const relativeTarget = relative(tempRoot, target);
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
  if (
    normalize(tempParent) !== normalize(tempRoot) ||
    normalize(resolve(dirname(target))) !== normalize(tempRoot) ||
    !basename(target).startsWith(nativeTempPrefix) ||
    !relativeTarget ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget) ||
    relativeTarget.includes(sep)
  )
    throw new Error("LOVE当前资料临时目录校验失败；没有清理范围外的目录。");
  return target;
}

function cliError(output: unknown): string | undefined {
  if (typeof output !== "string" || !output.trim()) return;
  try {
    const parsed: unknown = JSON.parse(output.trim());
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string"
    )
      return parsed.error.slice(0, 1_000);
  } catch {
    return;
  }
}

export async function runLoveChapterWorkflowCore(
  userDataPath: string,
  input: LongLoveChapterWorkflowCommandInput,
  nativeEvidence?: string
): Promise<unknown> {
  const request =
    LongLoveChapterWorkflowCommandEnvelopeSchema.shape.payload.parse(input);
  if (request.bookId !== LOVE_BOOK_ID) {
    throw new Error("章节接续工作流只对已登记 LOVE 书籍开放。");
  }
  const needsCurrentEvidence = request.action === "redraft_context";
  if (needsCurrentEvidence && !nativeEvidence?.trim())
    throw new Error(
      "Core本轮未能重建LOVE原生资料；请重新读取当前书库资料后再准备章节，未使用旧快照代替。"
    );
  const { project } = await requireProject(userDataPath);
  const root = project.projectRoot;
  return withExternalProjectLock(root, async () => {
    if (["select_draft", "attach_notes"].includes(request.action)) {
      if (
        !request.authorActionEvidence?.requestId ||
        !request.authorActionEvidence.quote.trim()
      )
        throw new Error(
          "缺少Main识别到的当前作者原话授权；不能写入选稿或批注状态。"
        );
    } else if (request.authorActionEvidence) {
      throw new Error("只读材料准备不得携带写入授权证据。");
    }
    const args = ["--root", root];
    if (request.action === "status") {
      args.unshift("status");
    } else {
      args.unshift(
        request.action === "select_draft"
          ? "select"
          : request.action === "attach_notes"
            ? "attach-notes"
            : request.action === "read_notes"
              ? "read-notes"
              : "prepare"
      );
      args.push(
        "--chapter",
        String(request.chapter),
        "--volume",
        request.volume!
      );
      if (request.action === "select_draft") {
        args.push(
          "--draft",
          request.draftPath!,
          "--status",
          request.draftStatus ?? "provisional"
        );
        args.push(
          "--request-id",
          request.authorActionEvidence!.requestId,
          "--author-quote",
          request.authorActionEvidence!.quote
        );
      } else if (request.action === "attach_notes") {
        for (const notePath of request.notePaths ?? [])
          args.push("--note", notePath);
        for (const annotationItemId of request.annotationItemIds ?? [])
          args.push("--annotation-item-id", annotationItemId);
        args.push(
          "--request-id",
          request.authorActionEvidence!.requestId,
          "--author-quote",
          request.authorActionEvidence!.quote
        );
      } else if (request.action === "read_notes") {
        if (request.targetDraftPath)
          args.push("--target-draft", request.targetDraftPath);
        if (request.targetModel)
          args.push("--target-model", request.targetModel);
      } else if (request.action === "redraft_context") {
        args.push("--mode", "redraft");
      } else if (request.action === "prepare") {
        args.push("--mode", "discussion");
      }
    }
    let tempDirectory: string | undefined;
    try {
      if (nativeEvidence?.trim()) {
        tempDirectory = await mkdtemp(join(tmpdir(), nativeTempPrefix));
        const evidenceFile = join(tempDirectory, "native-current.md");
        await writeFile(evidenceFile, nativeEvidence!, {
          encoding: "utf8",
          flag: "wx"
        });
        args.push(
          "--native-evidence-file",
          evidenceFile,
          "--native-evidence-sha256",
          sha256(nativeEvidence!)
        );
      }
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(
          process.execPath,
          [SCRIPT_PATH, ...args],
          {
            cwd: root,
            windowsHide: true,
            timeout: 120_000,
            maxBuffer: 24 * 1024 * 1024,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
          }
        ));
      } catch (error) {
        const details = error as { stdout?: unknown; stderr?: unknown };
        const message = cliError(details.stderr) ?? cliError(details.stdout);
        throw new Error(
          message ??
            "LOVE章节材料工具未能运行；请重新打开工作台并准备材料，未执行正文写入。"
        );
      }
      let result: unknown;
      try {
        result = JSON.parse(stdout.trim()) as unknown;
      } catch {
        throw new Error("LOVE章节材料工具未返回有效结果；请重新准备材料。");
      }
      if (
        !result ||
        typeof result !== "object" ||
        !("ok" in result) ||
        (result as { ok?: unknown }).ok !== true
      ) {
        const message = cliError(JSON.stringify(result));
        throw new Error(message ?? "LOVE章节材料准备未完成；请重新准备材料。");
      }
      return result;
    } finally {
      if (tempDirectory)
        await rm(await ownedNativeTempPath(tempDirectory), {
          recursive: true,
          force: true
        });
    }
  });
}
