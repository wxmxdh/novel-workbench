import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  AgentTeamCatalogSnapshotSchema,
  defaultBuiltinSubagentSettings,
  type AgentTeamCatalogSnapshot,
  type ModelSettings
} from "@deepwrite/contracts";
import type { OtterProjectAdapter } from "./project-adapter";
import type { createOtterProtocolService } from "./protocol-service";
import { OtterTeamService } from "./team-service";

const { prepareProjectDiscussion } = vi.hoisted(() => ({
  prepareProjectDiscussion: vi.fn()
}));
vi.mock("./discussion-service", () => ({ prepareProjectDiscussion }));

const projectId = "otter_0123456789abcdef";
const context = {
  projectId,
  contextPath: ".novel/context/CTX-BASE.json",
  receiptPath: ".novel/receipts/RCPT-BASE.json"
};
const currentPack = {
  sources: [
    {
      path: "draft.md",
      role: "text",
      purpose: "本轮审阅原稿",
      section: "selected excerpt",
      entities: [],
      line_start: 12,
      line_end: 30
    },
    {
      path: "character.md",
      role: "character",
      section: "角色资料",
      entities: ["甲"],
      line_start: 3,
      line_end: 18
    },
    {
      path: "external-reference.md",
      role: "reference",
      authority: "reference",
      purpose: "作者选定的外部参考",
      section: "方法摘录",
      entities: [],
      line_start: 1,
      line_end: 4
    },
    { path: "workspace:.novel/protocol/review-policy.md", role: "protocol" }
  ],
  relevant_characters: ["甲"],
  relevant_relationships: [],
  knowledge_boundary: ["仅当前章可知"],
  intentional_unknowns: ["甲的真实动机未确认"],
  recent_context: ["本章当前场次"],
  author_instructions: ["保留作者留白"],
  reference_scope: ["external-reference.md"],
  forbidden_future_info: ["后续章揭示"]
};

function createService(options?: {
  model?: boolean;
  comparisonFor?: (contextId: string) => string | null;
  catalog?: AgentTeamCatalogSnapshot;
}) {
  const contexts = new Map<string, { comparisonBaselineHash: string | null }>([
    [context.contextPath, { comparisonBaselineHash: "source-base" }]
  ]);
  const adapter = {
    readDocument: vi.fn(async (_id: string, path: string) => ({
      path,
      content:
        path === context.contextPath
          ? JSON.stringify(currentPack)
          : JSON.stringify({ project: "Fixture Novel" })
    }))
  } as unknown as OtterProjectAdapter;
  const protocol = {
    context: vi.fn(async (ref: { contextPath: string; contextId?: string }) => {
      const contextId =
        ref.contextId ?? /CTX-[\w-]+/.exec(ref.contextPath)?.[0] ?? "CTX-BASE";
      const key = ref.contextPath;
      return {
        contextId,
        comparisonBaselineHash:
          contexts.get(key)?.comparisonBaselineHash ??
          options?.comparisonFor?.(contextId) ??
          null
      };
    })
  } as unknown as ReturnType<typeof createOtterProtocolService>;
  const models = {
    models:
      options?.model === false
        ? []
        : [
            { id: "configured", hasApiKey: true },
            { id: "parent-selected", hasApiKey: true }
          ],
    defaultModelId: options?.model === false ? "" : "configured"
  } as unknown as ModelSettings;
  prepareProjectDiscussion.mockReset();
  let index = 0;
  prepareProjectDiscussion.mockImplementation(
    async (_adapter, _protocol, _input) => {
      const current = ++index;
      const contextId = `CTX-TEAM-${current}`;
      contexts.set(`.novel/context/${contextId}.json`, {
        comparisonBaselineHash:
          options?.comparisonFor?.(contextId) ?? "same-team-source-base"
      });
      return {
        projectId,
        contextPath: `.novel/context/${contextId}.json`,
        receiptPath: `.novel/receipts/RCPT-TEAM-${current}.json`,
        contextId,
        status: "PASS"
      };
    }
  );
  const service = new OtterTeamService("C:/temp/otter-team-test", {
    adapter: () => adapter,
    protocol: () => protocol,
    models: async () => models,
    catalog: async () =>
      options?.catalog ??
      AgentTeamCatalogSnapshotSchema.parse({
        enabledTeamIds: {},
        builtinSubagents: defaultBuiltinSubagentSettings(),
        teams: [
          {
            id: "default-long",
            name: "默认长篇团队",
            workspaceType: "long",
            settings: DEFAULT_LONG_AGENT_TEAM_SETTINGS
          }
        ]
      })
  });
  return { service, adapter, protocol, models };
}

describe("Otter team preparation", () => {
  it("rejects disabled configured models before reading member Contexts", async () => {
    const { service, models } = createService();
    models.models[0]!.enabled = false;
    await expect(
      service.prepare({
        context,
        teamIds: ["review"],
        topic: "检查停用模型",
        mode: "review"
      })
    ).rejects.toThrow(/模型不可用/);
    expect(prepareProjectDiscussion).not.toHaveBeenCalled();
  });
  it("projects enabled original long-team members into independent extras-agent plans", async () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    settings.teams[0]!.subagents.push({
      id: "character-review",
      name: "人物复核",
      description: "核对人物资料",
      systemPrompt: "只依据人物档案审阅。",
      enabled: true,
      modelMode: "custom",
      modelId: "configured",
      thinkingLevel: "high",
      temperature: 0.7
    });
    settings.teams[0]!.subagents.push({
      id: "disabled-review",
      name: "已停用成员",
      description: "不应出现",
      systemPrompt: "停用",
      enabled: false,
      modelMode: "inherit"
    });
    const catalog = AgentTeamCatalogSnapshotSchema.parse({
      enabledTeamIds: { long: "author-long" },
      builtinSubagents: defaultBuiltinSubagentSettings(),
      teams: [
        {
          id: "author-long",
          name: "作者长篇团队",
          workspaceType: "long",
          settings
        }
      ]
    });
    const { service } = createService({ catalog });
    const plan = await service.prepare({
      context,
      parentAgentId: "long",
      topic: "核对当前讨论",
      mode: "review"
    });
    expect(plan.members).toHaveLength(1);
    expect(plan.members[0]).toMatchObject({
      teamName: "作者长篇团队",
      memberName: "人物复核",
      memberId: "character-review",
      sourcePaths: ["draft.md", "character.md", "external-reference.md"],
      context: {
        projectId,
        contextPath: ".novel/context/CTX-TEAM-1.json",
        receiptPath: ".novel/receipts/RCPT-TEAM-1.json",
        contextId: "CTX-TEAM-1"
      },
      request: {
        modelId: "configured",
        thinkingLevel: "high",
        temperature: 0.7,
        conversation: {
          message: expect.stringContaining("只依据人物档案审阅。")
        }
      }
    });
  });
  it("inherits the parent conversation model and run settings for inherit members", async () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    settings.teams[0]!.subagents.push({
      id: "inherited-review",
      name: "继承助手",
      description: "沿用主对话参数",
      systemPrompt: "沿用主对话设置。",
      enabled: true,
      modelMode: "inherit",
      modelId: "stale-model",
      thinkingLevel: "high",
      temperature: 0.9
    });
    const catalog = AgentTeamCatalogSnapshotSchema.parse({
      enabledTeamIds: { long: "author-long" },
      builtinSubagents: defaultBuiltinSubagentSettings(),
      teams: [
        {
          id: "author-long",
          name: "作者长篇团队",
          workspaceType: "long",
          settings
        }
      ]
    });
    const { service } = createService({ catalog });
    const plan = await service.prepare({
      context,
      parentAgentId: "long",
      parentModelId: "parent-selected",
      parentThinkingLevel: "low",
      parentTemperature: 0.5,
      topic: "继承父对话设置",
      mode: "review"
    });

    expect(plan.members).toHaveLength(1);
    expect(plan.members[0]?.request).toMatchObject({
      modelId: "parent-selected",
      thinkingLevel: "low",
      temperature: 0.5
    });
  });

  it("rejects a stale inherited parent model before preparing member Contexts", async () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    settings.teams[0]!.subagents.push({
      id: "inherited-review",
      name: "继承助手",
      description: "沿用主对话模型",
      systemPrompt: "沿用主对话模型。",
      enabled: true,
      modelMode: "inherit"
    });
    const catalog = AgentTeamCatalogSnapshotSchema.parse({
      enabledTeamIds: { long: "author-long" },
      builtinSubagents: defaultBuiltinSubagentSettings(),
      teams: [
        {
          id: "author-long",
          name: "作者长篇团队",
          workspaceType: "long",
          settings
        }
      ]
    });
    const { service } = createService({ catalog });

    await expect(
      service.prepare({
        context,
        parentAgentId: "long",
        parentModelId: "stale-parent-model",
        topic: "检查继承模型校验",
        mode: "review"
      })
    ).rejects.toThrow(/成员“继承助手”使用的模型不可用/);
    expect(prepareProjectDiscussion).not.toHaveBeenCalled();
  });

  it("creates independent member Contexts with one verified source comparison baseline", async () => {
    const { service, protocol } = createService();
    const result = await service.prepare({
      context,
      teamIds: ["review"],
      topic: "检查这段讨论",
      material: "作者给出的待审段落",
      mode: "review"
    });
    expect(result.members).toHaveLength(3);
    expect(
      new Set(
        result.members.map(
          (item) =>
            (
              item.request.task.input as {
                otter?: { contextPath?: string };
              }
            ).otter?.contextPath
        )
      ).size
    ).toBe(3);
    expect(
      new Set(result.members.map((item) => item.request.sessionId)).size
    ).toBe(3);
    expect(protocol.context).toHaveBeenCalledTimes(4);
    expect(prepareProjectDiscussion).toHaveBeenCalledTimes(3);
    const calls = prepareProjectDiscussion.mock.calls.map(
      (call) => call[2] as Record<string, unknown>
    );
    for (const input of calls) {
      expect(input.sources).toEqual([
        "draft.md",
        "character.md",
        "external-reference.md"
      ]);
      expect(input.material).toBe("作者给出的待审段落");
      expect(input.boundary).toMatchObject({
        intentionalUnknowns: ["甲的真实动机未确认"],
        forbiddenFutureInfo: ["后续章揭示"]
      });
      expect(input.sourceMetadata).toEqual(currentPack.sources.slice(0, 3));
    }
    const firstMessage = result.members[0]!.request.conversation?.message ?? "";
    expect(firstMessage).toContain("待审/未定");
    expect(firstMessage).not.toContain("作者给出的待审段落");
  });

  it("rejects member Contexts whose V1 comparison baselines diverge", async () => {
    const { service } = createService({
      comparisonFor: (id) =>
        id === "CTX-TEAM-2" ? "different" : "same-team-source-base"
    });
    await expect(
      service.prepare({
        context,
        teamIds: ["review"],
        topic: "核对资料一致性",
        mode: "review"
      })
    ).rejects.toThrow(/资料范围已分叉/);
    expect(prepareProjectDiscussion).toHaveBeenCalledTimes(2);
  });

  it("refuses to prepare any team run when no API model has a key", async () => {
    const { service } = createService({ model: false });
    await expect(
      service.prepare({
        context,
        teamIds: ["review"],
        topic: "这轮不调用模型",
        mode: "review"
      })
    ).rejects.toThrow(/尚未配置 API 模型/);
    expect(prepareProjectDiscussion).not.toHaveBeenCalled();
  });
});
