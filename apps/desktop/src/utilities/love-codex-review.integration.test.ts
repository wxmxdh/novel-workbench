import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getDefaultLongAgentProfile,
  type CommandEnvelope,
  type LongWorkspaceRuntimeContext,
  type UtilityInternalCommandRequestMessage
} from "@deepwrite/contracts";
import { buildLongWorkspaceTools } from "@deepwrite/pi-runtime-adapter";
import {
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "../main/internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "../main/supervisor";
import { handleLongCoreCommand } from "./long-core-commands";
import { verifyLoveCodexReview } from "./love-codex-review-packager";

const BOOK_ID = "longbook_9a146bbe";
const SESSION_ID = "session_1f834d31";
const RUN_ID = "codex-review-integration-run";
const PROMPT_REQUEST_ID = "codex-review-integration-prompt";

function workspace(bookId: string): LongWorkspaceRuntimeContext {
  const profile = getDefaultLongAgentProfile("long");
  return {
    bookId,
    title: "LOVE",
    activeRoot: "plot_design",
    activeAgentId: profile.id,
    navigation: { bookId } as LongWorkspaceRuntimeContext["navigation"]
  } as LongWorkspaceRuntimeContext;
}

describe.runIf(process.env.DEEPWRITE_LOVE_LOCAL_SMOKE === "1")(
  "LOVE Codex review tool end-to-end",
  () => {
    it("executes the writing handoff through the authorized Main/Core bridge", async () => {
      const activeRuns = new Map([
        [
          RUN_ID,
          {
            sessionId: SESSION_ID,
            resourceId: BOOK_ID,
            promptRequestId: PROMPT_REQUEST_ID,
            accepted: true
          }
        ]
      ]);
      const tools = buildLongWorkspaceTools({
        workspace: workspace(BOOK_ID),
        profile: getDefaultLongAgentProfile("long"),
        sessionId: SESSION_ID,
        runId: RUN_ID,
        executor: async (command) => {
          const authorization: UtilityInternalCommandAuthorizationContext = {
            source: "agent",
            target: "core",
            message: {
              kind: "utility.internal.command.request",
              worker: "agent",
              target: "core",
              requestId: `bridge-${command.id}`,
              parentRequestId: PROMPT_REQUEST_ID,
              timeoutMs: 120_000,
              command: command as CommandEnvelope
            }
          };
          expect(authorizeMainInternalCommand(authorization, activeRuns)).toBe(
            true
          );
          const result = await handleLongCoreCommand(
            undefined as never,
            command as CommandEnvelope
          );
          if (!result || result.status === "rejected")
            throw new Error("Writing handoff was not accepted.");
          return result;
        }
      });
      const tool = tools.find(
        (candidate) => candidate.name === "prepare_codex_review"
      )!;
      const result = await tool.execute("writing-handoff-call", {
        scope: "第一章Codex底稿交接",
        purpose: "draft_handoff",
        chapter: 1
      } as never);
      const output = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      expect(output).toContain('"purpose": "draft_handoff"');
      const payload = JSON.parse(output.slice(output.indexOf("\n") + 1));
      const projectRoot =
        "D:/AI/Claude Code/03_娱乐与创作/01_小说创作/小说/00_创作项目/项目/LOVE";
      const prompt = readFileSync(
        join(projectRoot, payload.promptPath),
        "utf8"
      );
      expect(prompt).toContain(
        "为 LOVE / 第一卷 / 第1章独立写一份待审底稿/demo"
      );
      expect(prompt).toContain("native-4c146a202284");
      const manifest = JSON.parse(
        readFileSync(join(projectRoot, payload.manifestPath), "utf8")
      );
      expect(manifest.nativeEvidence.verified).toBe(true);
      expect(manifest.volume).toBe("第一卷");
      expect(manifest.output.relativePath).toBe("004_写作中");
    });
    it("is LOVE-only and creates a session-scoped package through authorization and Core", async () => {
      const profile = getDefaultLongAgentProfile("long");
      const foreignTools = buildLongWorkspaceTools({
        workspace: workspace("longbook_other"),
        profile,
        sessionId: SESSION_ID,
        runId: RUN_ID,
        executor: async () => {
          throw new Error("Foreign books must not reach the packager.");
        }
      });
      expect(
        foreignTools.some((tool) => tool.name === "prepare_codex_review")
      ).toBe(false);

      const activeRun: MainInternalCommandActiveRun = {
        sessionId: SESSION_ID,
        resourceId: BOOK_ID,
        promptRequestId: PROMPT_REQUEST_ID,
        accepted: true
      };
      const activeRuns = new Map([[RUN_ID, activeRun]]);
      const tools = buildLongWorkspaceTools({
        workspace: workspace(BOOK_ID),
        profile,
        sessionId: SESSION_ID,
        runId: RUN_ID,
        executor: async (command) => {
          const message: UtilityInternalCommandRequestMessage = {
            kind: "utility.internal.command.request",
            worker: "agent",
            target: "core",
            requestId: `bridge-${command.id}`,
            parentRequestId: PROMPT_REQUEST_ID,
            timeoutMs: 120_000,
            command: command as CommandEnvelope
          };
          const authorization: UtilityInternalCommandAuthorizationContext = {
            source: "agent",
            target: "core",
            message
          };
          expect(authorizeMainInternalCommand(authorization, activeRuns)).toBe(
            true
          );
          const result = await handleLongCoreCommand(
            undefined as never,
            command as CommandEnvelope
          );
          if (!result || result.status === "rejected") {
            throw new Error("Core did not create the Codex review package.");
          }
          return result;
        }
      });

      const tool = tools.find(
        (candidate) => candidate.name === "prepare_codex_review"
      );
      expect(tool).toBeDefined();
      const result = await tool!.execute("review-call", {
        scope: "集成测试：LOVE 当前会话 Codex 审核",
        target: undefined
      } as never);
      const output = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      expect(output).toContain("审核状态：");
      expect(output).toContain("本次会话：" + SESSION_ID);
      expect(output).toContain("不代表作者已确认其中内容为正典");
      expect(output).toContain("未选择大纲或文件目标");

      const payloadMatch = output.match(/打包结果：(\{[\s\S]+\})$/);
      expect(payloadMatch).not.toBeNull();
      const payload = JSON.parse(payloadMatch![1]!) as {
        packageId: string;
        packageDir: string;
        coverage: {
          reviewReady: boolean;
          dialogue: {
            selectedSessionId: string;
            latestSavedAssistantMessage: {
              sessionId: string;
              messageId: string;
              contentSha256: string;
            } | null;
          };
        };
      };
      expect(payload.coverage.dialogue.selectedSessionId).toBe(SESSION_ID);
      expect(output).toContain(
        payload.coverage.reviewReady
          ? "审核状态：候选会话资料完整"
          : "审核状态：资料未完整就绪"
      );
      expect(
        payload.coverage.dialogue.latestSavedAssistantMessage?.sessionId
      ).toBe(SESSION_ID);

      const manifest = JSON.parse(
        readFileSync(join(payload.packageDir, "manifest.json"), "utf8")
      ) as {
        selection: { sessionId: string; latestSavedAssistantMessage: unknown };
        files: Array<{ path: string; sha256: string }>;
      };
      expect(manifest.selection.sessionId).toBe(SESSION_ID);
      expect(manifest.selection.latestSavedAssistantMessage).toBeTruthy();
      expect(manifest.files.length).toBeGreaterThan(0);
      for (const entry of manifest.files) {
        const bytes = readFileSync(join(payload.packageDir, entry.path));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          entry.sha256
        );
      }
      const verified = (await verifyLoveCodexReview(payload.packageId)) as {
        status: string;
        internalChecks: Array<{ status: string }>;
        liveChecks: Array<{ status: string }>;
      };
      expect(verified.status).toBe("current");
      expect(
        verified.internalChecks.every((check) => check.status === "match")
      ).toBe(true);
      expect(
        verified.liveChecks.every((check) => check.status === "current")
      ).toBe(true);
    });
  }
);
