import { describe, expect, it } from "vitest";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { findCodexExecutable, runCodexReview } from "./external-agent";

// Opt-in: uses the author's installed external Codex account, never an API proxy.
describe.skipIf(process.env.OTTER_REAL_CODEX !== "1")(
  "Installed Codex readonly integration",
  () => {
    it("reviews the first-chapter height/unknown regression with current source evidence", async () => {
      const workspace = resolve(process.cwd(), "../..");
      const sourceProject = join(
        workspace,
        "00_创作项目",
        "项目",
        "What Is Love"
      );
      const directory = await mkdtemp(
        join(tmpdir(), "otter-codex-readonly-regression-")
      );
      const project = join(directory, "readonly-project");
      await mkdir(project, { recursive: true });
      const paths = [
        [join(sourceProject, "project-profile.md"), "project-profile.md"],
        [join(sourceProject, "characters", "王天一.md"), "王天一.md"],
        [
          join(sourceProject, "canon", "open-questions.md"),
          "open-questions.md"
        ],
        [
          join(workspace, ".novel", "protocol", "review-policy.md"),
          "review-policy.md"
        ],
        [join(workspace, ".novel", "protocol", "authority.md"), "authority.md"]
      ];
      const sources = [];
      for (const [source, name] of paths) {
        await copyFile(source!, join(project, name!));
        const bytes = await readFile(join(project, name!));
        sources.push({
          path: name,
          hash: createHash("sha256").update(bytes).digest("hex"),
          must_read_fully: true
        });
      }
      const baselineHash = createHash("sha256")
        .update(JSON.stringify(sources))
        .digest("hex");
      const context = {
        contextId: "CTX-CODEX-READONLY-REGRESSION",
        baselineHash,
        comparisonBaselineHash: null,
        apiText:
          "External runner integration fixture; not a reusable V1 writing task.",
        agentText: JSON.stringify(
          {
            fixture:
              "readonly external-runner regression; no V1 prose permission",
            must_read: sources,
            must_not_read: ["本隔离目录之外的小说、凭据、历史文件和原Skill包"],
            task: "用当前项目来源只读审阅高度估计与人物动机留白；原件不在此夹具中，不要写任何文件。"
          },
          null,
          2
        )
      };
      const executable = await findCodexExecutable();
      expect(executable).not.toBeNull();
      const result = await runCodexReview(
        {
          userDataPath: join(directory, "host-review-results"),
          timeoutMs: 240_000
        },
        project,
        context,
        "第001章中宋观察眼前男生后说‘目测一米八左右’，这句话是否必须删掉？请核对提供的项目规则，不能仅以通用 Deep POV 理论判成硬性错误。同时，王天一是否吃醋/是否知道宋的喜欢能否自动写成事实？请区分文学建议、来源支持的硬边界、未评估项。引用你实际读取的文件证据，不创作正文，不推测真实动机。输出中文。"
      );
      const reports = join(
        workspace,
        "06_脚本工具",
        "桌面融合_20261001",
        "audit-env"
      );
      await mkdir(reports, { recursive: true });
      await writeFile(
        join(reports, "codex-live-regression.json"),
        JSON.stringify(
          { ...result, fixtureDirectory: directory, sources, baselineHash },
          null,
          2
        )
      );
      expect(result.status, result.message).toBe("completed");
      expect(result.report?.context_id).toBe(context.contextId);
      for (const source of sources) {
        expect(
          createHash("sha256")
            .update(await readFile(join(project, source.path!)))
            .digest("hex")
        ).toBe(source.hash);
      }
    }, 270_000);
  }
);
