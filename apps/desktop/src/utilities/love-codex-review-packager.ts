import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const LOVE_CODEX_REVIEW_BOOK_ID = "longbook_9a146bbe";
const SCRIPT_PATH =
  "D:/AI/Claude Code/03_娱乐与创作/01_小说创作/小说/我的小说工作台/LOVE_Codex审核交接/工具/love-audit-pack.mjs";
const DRAFT_HANDOFF_SCRIPT_PATH =
  "D:/AI/Claude Code/03_娱乐与创作/01_小说创作/小说/我的小说工作台/LOVE_Codex审核交接/工具/love-draft-handoff.mjs";
const WORKSPACE_PATH =
  "D:/AI/Claude Code/03_娱乐与创作/01_小说创作/小说/我的小说工作台/LOVE_Codex审核交接";

async function runTrustedPackager(
  args: string[],
  script = SCRIPT_PATH
): Promise<string> {
  try {
    const result = await execFileAsync(process.execPath, [script, ...args], {
      cwd: WORKSPACE_PATH,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    });
    return result.stdout;
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) {
      const stdout = (error as { stdout?: unknown }).stdout;
      if (typeof stdout === "string" && stdout.trim()) return stdout;
    }
    throw error;
  }
}

export interface LoveCodexReviewRequest {
  bookId: string;
  scope: string;
  sessionId: string;
  target?: string | undefined;
  purpose?: "review" | "draft_handoff" | undefined;
  chapter?: number | undefined;
  volume?: string | undefined;
}

function validateTarget(target: string | undefined): void {
  if (target === undefined) return;
  const segments = target.replaceAll("\\", "/").split("/");
  if (
    target.startsWith("/") ||
    target.includes(":") ||
    target.includes("\0") ||
    segments.some(
      (segment) => segment === ".." || segment === "." || segment === ""
    )
  ) {
    throw new Error("审核交接 target 必须是项目内的相对文件路径。");
  }
}

export async function prepareLoveCodexReview(
  request: LoveCodexReviewRequest
): Promise<unknown> {
  if (request.bookId !== LOVE_CODEX_REVIEW_BOOK_ID) {
    throw new Error("Codex 审核交接仅对 LOVE 项目开放。");
  }
  if (!request.sessionId.trim()) {
    throw new Error("Codex 审核交接需要当前已授权会话 ID。");
  }
  validateTarget(request.target);

  const draftHandoff = request.purpose === "draft_handoff";
  if (
    draftHandoff &&
    (!Number.isInteger(request.chapter) ||
      !request.chapter ||
      request.chapter < 1 ||
      request.chapter > 100_000)
  ) {
    throw new Error("写作接续交接需要明确的章节号。");
  }
  const args = draftHandoff
    ? ["--chapter", String(request.chapter)]
    : ["pack", "--scope", request.scope, "--session", request.sessionId];
  if (draftHandoff) {
    if (request.target)
      throw new Error("写作交接从当前登记定位大纲，不接受替代 target。");
    if (request.volume) args.push("--volume", request.volume);
  } else if (request.target) args.push("--target", request.target);
  const output = await runTrustedPackager(
    args,
    draftHandoff ? DRAFT_HANDOFF_SCRIPT_PATH : SCRIPT_PATH
  );
  let payload: unknown;
  try {
    payload = JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error("LOVE 审核打包器没有返回有效的 JSON 结果。");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("ok" in payload) ||
    (payload as { ok?: unknown }).ok !== true
  ) {
    throw new Error(`LOVE 审核打包未完成：${JSON.stringify(payload)}`);
  }
  return payload;
}

export async function verifyLoveCodexReview(
  packageId: string
): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(packageId)) {
    throw new Error("审核资料包 ID 格式无效。");
  }
  const output = await runTrustedPackager(["verify", packageId]);
  try {
    return JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error("LOVE 审核资料包校验没有返回有效 JSON。");
  }
}
