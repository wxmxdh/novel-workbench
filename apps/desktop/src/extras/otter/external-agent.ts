import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { randomUUID } from "node:crypto";
import { OtterExternalReviewSchema } from "@deepwrite/contracts";
import type {
  OtterContextResult,
  OtterReviewResult
} from "@deepwrite/contracts";

const reviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "context_id", "baseline_hash", "findings"],
  properties: {
    summary: { type: "string" },
    context_id: { type: "string" },
    baseline_hash: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "evidence", "message", "suggestion"],
        properties: {
          kind: {
            type: "string",
            enum: ["hard-boundary", "literary-advice", "not-evaluated"]
          },
          evidence: { type: "string" },
          message: { type: "string" },
          suggestion: { type: "string" }
        }
      }
    }
  }
};

export async function findCodexExecutable(
  environment: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const names = process.platform === "win32" ? ["codex.exe"] : ["codex"];
  const candidates = (environment.PATH ?? "")
    .split(delimiter)
    .flatMap((path) => names.map((name) => join(path, name)));
  if (process.platform === "win32" && environment.LOCALAPPDATA) {
    const bin = join(environment.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    for (const entry of await readdir(bin, { withFileTypes: true }).catch(
      () => []
    )) {
      if (entry.isDirectory() && !entry.isSymbolicLink())
        candidates.push(join(bin, entry.name, "codex.exe"));
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* Try next installed executable. */
    }
  }
  return null;
}

export function codexReviewArguments(
  projectRoot: string,
  schema: string,
  output: string
): string[] {
  return [
    "exec",
    "--cd",
    projectRoot,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--output-schema",
    schema,
    "--output-last-message",
    output,
    "--json",
    "-c",
    'web_search="disabled"',
    "-c",
    'approval_policy="never"',
    "-"
  ];
}

export interface ExternalAgentOptions {
  userDataPath: string;
  executable?: string;
  timeoutMs?: number;
}

function run(
  executable: string,
  args: string[],
  input: string,
  timeout: number
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let bytes = 0;
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Codex 终审超时，未接受任何结果。"));
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 4_000_000) {
        child.kill();
        reject(new Error("Codex 输出超过安全上限。"));
        return;
      }
      output += chunk.toString();
    });
    // stderr may contain account/endpoint details; consume it without persistence.
    child.stderr.on("data", () => undefined);
    child.stdin.on("error", () => undefined);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.stdin.end(input);
  });
}

export async function createExternalHandoff(
  options: ExternalAgentOptions,
  projectRoot: string,
  context: OtterContextResult,
  tool: "codex" | "claude-code" | "antigravity"
): Promise<{ directory: string; prompt: string }> {
  const directory = join(
    options.userDataPath,
    "otter",
    "handoffs",
    randomUUID()
  );
  await mkdir(directory, { recursive: true });
  const prompt = [
    `请在 ${projectRoot} 执行本次只读审阅。外部工具：${tool}。`,
    "实际完整阅读导航要求的当前来源；路径与收据不证明你已理解内容。",
    "遵循当前项目 V1 协议及作者任务，保留本轮猜想和故意未知。",
    "只提出有证据的审阅建议，不修改作品或接受任何候选。",
    "must_not_read 是任务资料边界，read-only 沙箱是写入限制；两者不能混作同一项保证。",
    context.agentText
  ].join("\n\n");
  await writeFile(join(directory, "navigation.md"), prompt, { flag: "wx" });
  await writeFile(
    join(directory, "review.schema.json"),
    JSON.stringify(reviewJsonSchema, null, 2),
    { flag: "wx" }
  );
  return { directory, prompt };
}

export async function runCodexReview(
  options: ExternalAgentOptions,
  projectRoot: string,
  context: OtterContextResult,
  instructions: string
): Promise<OtterReviewResult> {
  const executable = options.executable ?? (await findCodexExecutable());
  if (!executable)
    return {
      status: "unavailable",
      reportPath: null,
      report: null,
      message: "未发现 Codex CLI；可生成导航包手动终审。"
    };
  const handoff = await createExternalHandoff(
    options,
    projectRoot,
    context,
    "codex"
  );
  const output = join(handoff.directory, "review.json");
  try {
    const capability = await run(executable, ["exec", "--help"], "", 15_000);
    if (
      capability.code !== 0 ||
      !["--sandbox", "--output-schema", "--ephemeral"].every((flag) =>
        capability.output.includes(flag)
      )
    ) {
      throw new Error("当前 Codex CLI 不具备已要求的只读结构化终审参数。");
    }
    const result = await run(
      executable,
      codexReviewArguments(
        projectRoot,
        join(handoff.directory, "review.schema.json"),
        output
      ),
      `${handoff.prompt}\n\n本次作者终审要求：\n${instructions}\n\n输出context_id=${context.contextId}，baseline_hash=${context.baselineHash}。`,
      options.timeoutMs ?? 300_000
    );
    if (result.code !== 0)
      throw new Error(
        "Codex 未完成终审。请在 Codex 应用检查本地登录、权限或服务状态；导航包已保留。"
      );
    const bytes = await readFile(output);
    if (bytes.length > 1_000_000) throw new Error("终审报告超出安全上限。");
    const report = OtterExternalReviewSchema.parse(
      JSON.parse(bytes.toString("utf8"))
    );
    if (
      report.context_id !== context.contextId ||
      report.baseline_hash !== context.baselineHash
    )
      throw new Error("终审结果与本轮 Context 基线不一致。");
    // The host persists candidate advice only; model has no project write permission.
    await writeFile(
      join(handoff.directory, "receipt.json"),
      JSON.stringify(
        {
          kind: "agent_suggestion",
          status: "pending-author-review",
          projectRoot,
          contextId: context.contextId,
          baselineHash: context.baselineHash,
          comparisonBaselineHash: context.comparisonBaselineHash,
          sandbox: "read-only",
          completedAt: new Date().toISOString()
        },
        null,
        2
      ),
      { flag: "wx" }
    );
    return {
      status: "completed",
      reportPath: output,
      report,
      message: "终审建议已保存，待作者审阅。"
    };
  } catch (error) {
    return {
      status: "unavailable",
      reportPath: null,
      report: null,
      message: error instanceof Error ? error.message : "Codex 终审未完成。"
    };
  }
}
