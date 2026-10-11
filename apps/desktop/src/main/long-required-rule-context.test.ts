import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  createLongWorkspaceNavigationSnapshot,
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { fixtureWorldbuildingIndex } from "../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import { buildEffectiveSystemPrompt } from "../../../../packages/pi-runtime-adapter/src/prompts-system";
import { DEFAULT_LONG_AGENT_PROFILES } from "@deepwrite/contracts";
import { prepareLongRequiredRuleContext } from "./long-required-rule-context";
import { handleSessionCommands } from "./ipc/session-commands";
import type { IpcCommandContext } from "./ipc/command-types";

function fixture() {
  const index = fixtureWorldbuildingIndex();
  const category = index.worldbuilding.find(
    (entry) => entry.format === "list"
  )!;
  if (category.format !== "list") throw new Error("Missing fixture category");
  const item = category.items[0]!;
  const state = {
    index,
    agents: `<!-- deepwrite-required-rules: ${item.id} -->`,
    text: "局部意见不能扩成全书禁令。",
    drift: false,
    indexReads: 0
  };
  const context: WorkspaceRuntimeContext = {
    longWorkspace: {
      bookId: index.bookId,
      title: "本书",
      activeRoot: "draft",
      activeAgentId: "long",
      agentsMd: "Renderer 伪造说明",
      navigation: createLongWorkspaceNavigationSnapshot(index)
    }
  };
  const request = vi.fn(async (command: CommandEnvelope) => {
    let payload: unknown;
    if (command.type === "long.readAgentsMd") {
      payload = {
        bookId: index.bookId,
        content: state.agents,
        truncated: false
      };
    } else if (command.type === "long.getWorkspaceIndex") {
      state.indexReads++;
      payload = {
        bookId: index.bookId,
        workspaceIndex: {
          ...state.index,
          ...(state.drift && state.indexReads > 1
            ? { updatedAt: "2026-08-01T00:00:00.000Z" }
            : {})
        }
      };
    } else if (command.type === "long.readDocument") {
      const chars = Array.from(state.text);
      const offset = command.payload.offset ?? 0;
      const end = Math.min(offset + 17_000, chars.length);
      payload = {
        bookId: index.bookId,
        file: item.file,
        content: chars.slice(offset, end).join(""),
        offset,
        totalCharacters: chars.length,
        nextOffset: end < chars.length ? end : null
      };
    } else throw new Error(`Unexpected query: ${command.type}`);
    return { status: "accepted" as const, requestId: command.id, payload };
  });
  return { state, context, request, item };
}

describe("Main-owned required rule context", () => {
  it("takes complete paged Unicode text from Core and puts it in the system prompt", async () => {
    const { state, context, request, item } = fixture();
    state.text = "甲🙂".repeat(18_000) + "最后一句仍要阅读";
    const result = await prepareLongRequiredRuleContext(context, request);
    const rules = result!.longWorkspace!.requiredRules!;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      itemId: item.id,
      content: state.text,
      sha256: createHash("sha256").update(state.text).digest("hex")
    });
    expect(result!.longWorkspace!.agentsMd).toBe(state.agents);
    const prompt = buildEffectiveSystemPrompt("base", {
      runId: "run_test",
      sessionId: "session_test",
      prompt: "审阅",
      longAgentProfile: DEFAULT_LONG_AGENT_PROFILES.find(
        (p) => p.id === "long"
      )!,
      workspaceContext: result!
    });
    expect(prompt).toContain(state.text);
    expect(prompt).toContain("局部意见按其范围处理");
    expect(
      request.mock.calls.filter(([c]) => c.type === "long.readDocument")
    ).toHaveLength(3);
  });

  it("refreshes a later turn and ignores a Renderer-supplied stale snapshot", async () => {
    const { state, context, request } = fixture();
    const first = await prepareLongRequiredRuleContext(context, request);
    state.text = "作者已修改：保留自然的笑、欲望与长段落。";
    const second = await prepareLongRequiredRuleContext(first, request);
    expect(second!.longWorkspace!.requiredRules![0]!.content).toBe(state.text);
    expect(second!.longWorkspace!.requiredRules![0]!.sha256).not.toBe(
      first!.longWorkspace!.requiredRules![0]!.sha256
    );
  });

  it("does not infer requirements for another book, and clears injected snapshots", async () => {
    const { state, context, request } = fixture();
    const first = await prepareLongRequiredRuleContext(context, request);
    state.agents = "这本书没有明确绑定；worlditem_memory 只是讨论中的编号。";
    request.mockClear();
    const result = await prepareLongRequiredRuleContext(first, request);
    expect(result!.longWorkspace!.requiredRules).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "empty", "oversize", "drift", "malformed"])(
    "stops before sending an incomplete or inconsistent rule: %s",
    async (problem) => {
      const { state, context, request } = fixture();
      if (problem === "missing")
        state.agents = "<!-- deepwrite-required-rules: worlditem_missing -->";
      if (problem === "empty") state.text = "   ";
      if (problem === "oversize") state.text = "甲".repeat(64_001);
      if (problem === "drift") state.drift = true;
      if (problem === "malformed")
        state.agents = "<!-- deepwrite-required-rules: wrong-id -->";
      await expect(
        prepareLongRequiredRuleContext(context, request)
      ).rejects.toThrow();
    }
  );

  it("leaves non-long workspaces alone", async () => {
    const request = vi.fn();
    expect(
      await prepareLongRequiredRuleContext(undefined, request)
    ).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "gates the actual Main session dispatch (missing=%s)",
    async (missing) => {
      const { state, context, request } = fixture();
      if (missing)
        state.agents = "<!-- deepwrite-required-rules: worlditem_missing -->";
      let dispatched: CommandEnvelope | undefined;
      const requestCommand = vi.fn(
        async (target: string, command: CommandEnvelope) => {
          if (target === "agent") {
            dispatched = command;
            return {
              status: "rejected" as const,
              requestId: command.id,
              error: {
                code: "test.transport_end",
                message: "End of test transport"
              }
            };
          }
          if (command.type === "catalog.queryMaterials")
            return {
              status: "accepted" as const,
              requestId: command.id,
              payload: { status: "ok", entries: [], total: 0, notices: [] }
            };
          return request(command);
        }
      );
      const ctx = {
        activeRuns: new Map(),
        terminalRuns: new Map(),
        pendingUsageContexts: new Map(),
        supervisor: { requestCommand },
        requireModelConfigStore: () => ({ resolve: async () => undefined }),
        requireLongAgentConfigStore: () => ({
          resolve: async () =>
            DEFAULT_LONG_AGENT_PROFILES.find((p) => p.id === "long")!
        }),
        requireAgentTeamConfigStore: () => ({
          list: async () => ({
            builtinSubagents: {
              skill: { enabled: false },
              material: { enabled: false }
            }
          })
        }),
        requireLibraryAgentConfigStore: () => ({}),
        requireGeneralSettingsStore: () => ({
          list: async () => ({
            settings: {
              contextCompaction: { enabled: false, budgetTokens: 16_000 }
            }
          })
        })
      } as unknown as IpcCommandContext;
      const command = CommandEnvelopeSchema.parse(
        createEnvelope(
          "session.prompt",
          {
            sessionId: "session_gate",
            message: "讨论规则",
            workspaceContext: context
          },
          { id: "command_gate", context: { sessionId: "session_gate" } }
        )
      );
      const result = await handleSessionCommands(ctx, command);
      if (missing) {
        expect(dispatched).toBeUndefined();
        expect(result).toMatchObject({
          status: "rejected",
          error: { message: expect.stringContaining("必读规则不存在") }
        });
      } else {
        expect(dispatched).toMatchObject({
          type: "agent.prompt",
          payload: {
            workspaceContext: {
              longWorkspace: { requiredRules: [{ content: state.text }] }
            }
          }
        });
      }
    }
  );
});
