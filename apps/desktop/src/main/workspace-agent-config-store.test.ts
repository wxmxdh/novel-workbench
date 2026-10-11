import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS,
  DEFAULT_SCRIPT_SYSTEM_PROMPT,
  DEFAULT_SHORT_SYSTEM_PROMPT,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  createDefaultCreativePlotStages,
  createShortWorkspaceContentRevision,
  type ScriptWorkspaceAgentSettingsInput,
  type ShortWorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { WorkspaceAgentConfigStore } from "./workspace-agent-config-store";

const temporaryRoots = new Set<string>();

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), "deepwrite-workspace-agent-store-")
  );
  temporaryRoots.add(root);
  return root;
}

function defaultInput(): ShortWorkspaceAgentSettingsInput {
  const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!;
  return {
    workspaceType: "short",
    defaultPlotStageIds: [
      ...DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS.defaultPlotStageIds
    ],
    agents: [
      {
        id: "short",
        systemPrompt: profile.systemPrompt,
        welcomeShortcuts: [...profile.welcomeShortcuts],
        readAccess: {
          material: [...profile.readAccess.material],
          skill: [...profile.readAccess.skill]
        }
      }
    ]
  };
}

function customizedInput(prefix: string): ShortWorkspaceAgentSettingsInput {
  const input = defaultInput();
  input.agents[0] = {
    ...input.agents[0]!,
    systemPrompt: `${prefix}:short`,
    welcomeShortcuts: ["指令一", "指令二", "指令三"],
    readAccess: { material: ["character", "plot"], skill: ["general"] }
  };
  return input;
}

function customizedScriptInput(
  prefix: string
): ScriptWorkspaceAgentSettingsInput {
  return {
    workspaceType: "script",
    agents: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES.map((agent) => ({
      id: agent.id,
      systemPrompt: `${prefix}:${agent.id}`,
      welcomeShortcuts: [...agent.welcomeShortcuts],
      readAccess: { material: [], skill: [] }
    }))
  };
}

function legacyShortDisk() {
  return {
    version: 2,
    workspaceType: "short",
    agents: [
      {
        id: "character_design",
        systemPrompt: "自定义人物提示词",
        welcomeShortcuts: ["人物一", "人物二", "人物三"],
        readAccess: {
          material: ["character"],
          skill: ["general", "plot", "other"],
          workspace: ["character_design"]
        }
      },
      {
        id: "plot_design",
        systemPrompt: "自定义剧情提示词",
        welcomeShortcuts: ["剧情一", "剧情二", "剧情三"],
        readAccess: {
          material: ["gimmick", "character", "plot"],
          skill: ["general", "plot", "other"]
        }
      },
      {
        id: "expert_draft_coordinator",
        systemPrompt: "自定义正文提示词",
        welcomeShortcuts: ["正文一", "正文二", "正文三"],
        readAccess: {
          material: ["character", "draft", "other"],
          skill: ["style", "general", "other"]
        }
      }
    ]
  };
}

function legacyScriptDisk() {
  return {
    ...legacyShortDisk(),
    workspaceType: "script"
  };
}

function shortWorkspace(activeStageId: "outline" | "draft") {
  const revision = createShortWorkspaceContentRevision("");
  return {
    id: "short-1",
    title: "雨夜来信",
    categories: ["悬疑"],
    activeStageId,
    ...(activeStageId === "draft"
      ? {
          activeAgentId: "short" as const,
          activeSectionId: "section-1"
        }
      : {}),
    characterStructure: { format: "text" as const },
    plotStages: createDefaultCreativePlotStages(),
    expertDraft: {
      id: "draft" as const,
      title: "正文",
      revision,
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "1000 字",
          body: {
            documentId: "draft:section-1:body",
            title: "第一节",
            content: "",
            revision
          },
          characterState: {
            documentId: "draft:section-1:character-state",
            title: "第一节 · 人物状态",
            content: "",
            revision
          }
        }
      ]
    },
    stages: [
      "character_design",
      ...createDefaultCreativePlotStages().map(({ id }) => id)
    ].map((stageId) => ({
      stageId,
      title: stageId,
      content: "",
      revision
    }))
  };
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
  temporaryRoots.clear();
});

describe("WorkspaceAgentConfigStore", () => {
  it("returns one cloned builtin short profile when no file exists", async () => {
    const settings = await new WorkspaceAgentConfigStore(
      await makeTemporaryRoot()
    ).list();
    expect(settings).toEqual(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
    expect(settings.agents).toHaveLength(1);
    expect(settings.agents[0]).not.toBe(
      DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]
    );
  });

  it("migrates three prompts and shortcuts to defaults and unions read access", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "config"));
    await writeFile(
      join(root, "config", "workspace-agents.json"),
      JSON.stringify(legacyShortDisk())
    );

    const settings = await new WorkspaceAgentConfigStore(root).list();
    expect(settings.agents).toHaveLength(1);
    expect(settings.agents[0]).toMatchObject({
      id: "short",
      systemPrompt: DEFAULT_SHORT_SYSTEM_PROMPT,
      welcomeShortcuts:
        DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0]!.welcomeShortcuts,
      readAccess: {
        material: ["character", "gimmick", "plot", "draft", "other"],
        skill: ["general", "plot", "other", "style"]
      }
    });
    expect(
      JSON.parse(
        await readFile(join(root, "config", "workspace-agents.json"), "utf8")
      )
    ).toMatchObject({ version: 5, workspaceType: "short" });
  });

  it("upgrades a version-three unified prompt to the new builtin", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "config"));
    const customized = customizedInput("custom");
    await writeFile(
      join(root, "config", "workspace-agents.json"),
      JSON.stringify({ version: 3, ...customized })
    );
    const settings = await new WorkspaceAgentConfigStore(root).list();
    expect(settings.agents[0]).toMatchObject({
      ...customized.agents[0],
      systemPrompt: DEFAULT_SHORT_SYSTEM_PROMPT
    });
    expect(
      JSON.parse(
        await readFile(join(root, "config", "workspace-agents.json"), "utf8")
      )
    ).toMatchObject({ version: 5, workspaceType: "short" });
  });

  it("preserves a valid version-four unified customization", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "config"));
    const customized = customizedInput("custom-v4");
    await writeFile(
      join(root, "config", "workspace-agents.json"),
      JSON.stringify({ version: 4, ...customized })
    );
    expect(await new WorkspaceAgentConfigStore(root).list()).toMatchObject(
      customized
    );
    expect(
      JSON.parse(
        await readFile(join(root, "config", "workspace-agents.json"), "utf8")
      )
    ).toMatchObject({
      version: 5,
      defaultPlotStageIds: ["plot_design", "intro_design", "plot_refine"]
    });
  });

  it("persists customized default plot stages for new short books", async () => {
    const root = await makeTemporaryRoot();
    const store = new WorkspaceAgentConfigStore(root);
    const input = customizedInput("custom-default-stages");
    input.defaultPlotStageIds = ["custom-plot-stage", "plot_refine"];

    await expect(store.save(input)).resolves.toMatchObject({
      defaultPlotStageIds: ["custom-plot-stage", "plot_refine"]
    });
    await expect(store.list()).resolves.toMatchObject({
      defaultPlotStageIds: ["custom-plot-stage", "plot_refine"]
    });
  });

  it("does not overwrite malformed legacy data when migration fails", async () => {
    const root = await makeTemporaryRoot();
    const config = join(root, "config");
    const path = join(config, "workspace-agents.json");
    await mkdir(config);
    const original = JSON.stringify({
      version: 2,
      workspaceType: "short",
      agents: [{ id: "plot_design", readAccess: { material: [], skill: [] } }]
    });
    await writeFile(path, original);
    await expect(new WorkspaceAgentConfigStore(root).list()).rejects.toThrow(
      "未覆盖原文件"
    );
    await expect(readFile(path, "utf8")).resolves.toBe(original);
  });

  it("keeps short and script files independent", async () => {
    const root = await makeTemporaryRoot();
    const store = new WorkspaceAgentConfigStore(root);
    const short = await store.save(customizedInput("short-custom"));
    const script = await store.save(customizedScriptInput("script-custom"));
    expect((await store.list()).agents[0]?.systemPrompt).toBe(
      "short-custom:short"
    );
    expect(await store.list("script")).toEqual(script);
    expect(short.workspaceType).toBe("short");
    expect(
      JSON.parse(
        await readFile(join(root, "config", "workspace-agents.json"), "utf8")
      ).version
    ).toBe(5);
    expect(
      JSON.parse(
        await readFile(
          join(root, "config", "workspace-agents-script.json"),
          "utf8"
        )
      ).version
    ).toBe(4);
  });

  it("resets the unified profile and resolves every short stage to it", async () => {
    const store = new WorkspaceAgentConfigStore(await makeTemporaryRoot());
    await store.save(customizedInput("discarded"));
    expect(await store.reset("short", "short")).toEqual(
      DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS
    );
    await expect(
      store.resolveForStage("character_design")
    ).resolves.toMatchObject({ id: "short" });
    await expect(store.resolveForStage("outline")).resolves.toMatchObject({
      id: "short"
    });
    await expect(
      store.resolveForWorkspace(shortWorkspace("draft"), "short")
    ).resolves.toMatchObject({ id: "short" });
  });

  it("migrates the three script profiles into one validated profile", async () => {
    const root = await makeTemporaryRoot();
    await mkdir(join(root, "config"));
    await writeFile(
      join(root, "config", "workspace-agents-script.json"),
      JSON.stringify(legacyScriptDisk())
    );
    const settings = await new WorkspaceAgentConfigStore(root).list("script");
    expect(settings.agents).toHaveLength(1);
    expect(settings.agents[0]).toMatchObject({
      id: "script",
      systemPrompt: DEFAULT_SCRIPT_SYSTEM_PROMPT,
      welcomeShortcuts:
        DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!.welcomeShortcuts,
      readAccess: {
        material: ["character", "gimmick", "plot", "draft", "other"],
        skill: ["general", "plot", "other", "style"]
      }
    });
    expect(
      JSON.parse(
        await readFile(
          join(root, "config", "workspace-agents-script.json"),
          "utf8"
        )
      ).version
    ).toBe(4);
  });

  it("does not overwrite malformed legacy script data", async () => {
    const root = await makeTemporaryRoot();
    const config = join(root, "config");
    const path = join(config, "workspace-agents-script.json");
    await mkdir(config);
    const original = JSON.stringify({
      version: 2,
      workspaceType: "script",
      agents: [{ id: "plot_design", readAccess: { material: [], skill: [] } }]
    });
    await writeFile(path, original);
    await expect(
      new WorkspaceAgentConfigStore(root).list("script")
    ).rejects.toThrow("未覆盖原文件");
    await expect(readFile(path, "utf8")).resolves.toBe(original);
  });

  it("retains unified script defaults and routes every stage to script", async () => {
    const store = new WorkspaceAgentConfigStore(await makeTemporaryRoot());
    expect(await store.list("script")).toEqual(
      DEFAULT_SCRIPT_WORKSPACE_AGENT_SETTINGS
    );
    await expect(
      store.resolveForStage("plot_design", "script")
    ).resolves.toMatchObject({ id: "script" });
    await expect(
      store.resolveForStage("draft", "script")
    ).resolves.toMatchObject({ id: "script" });
  });

  it("continues the write queue after a failed persistence operation", async () => {
    const root = await makeTemporaryRoot();
    const blockingConfigPath = join(root, "config");
    await writeFile(blockingConfigPath, "not-a-directory", "utf8");
    const store = new WorkspaceAgentConfigStore(root);

    await expect(store.save(customizedInput("failed"))).rejects.toBeTruthy();
    await unlink(blockingConfigPath);
    await mkdir(blockingConfigPath);
    const recovered = await store.save(customizedInput("recovered"));
    expect(recovered.agents[0]?.systemPrompt).toBe("recovered:short");
    expect(await store.list()).toEqual(recovered);
  });
});
