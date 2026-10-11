import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_SETTINGS,
  type LongAgentSettingsInput
} from "@deepwrite/contracts";
import {
  LONG_AGENT_SETTINGS_DISK_VERSION,
  LongAgentConfigStore
} from "./long-agent-config-store";

async function createStore(): Promise<{
  root: string;
  store: LongAgentConfigStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-long-agent-store-"));
  return { root, store: new LongAgentConfigStore(root) };
}

function settingsPath(root: string): string {
  return join(root, "config", "long-workspace-agents.json");
}

async function writeDisk(root: string, value: unknown): Promise<void> {
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(
    settingsPath(root),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
}

function editableDefaults(): LongAgentSettingsInput {
  return {
    workspaceType: "long",
    agents: DEFAULT_LONG_AGENT_SETTINGS.agents.map((agent) => ({
      id: agent.id,
      systemPrompt: agent.systemPrompt,
      welcomeShortcuts: [
        agent.welcomeShortcuts[0],
        agent.welcomeShortcuts[1],
        agent.welcomeShortcuts[2]
      ],
      readAccess: {
        workspaceRoots: [...agent.readAccess.workspaceRoots],
        materialKinds: [...agent.readAccess.materialKinds],
        skillKinds: [...agent.readAccess.skillKinds]
      }
    }))
  };
}

describe("LongAgentConfigStore", () => {
  it("returns the single builtin long agent when nothing is stored", async () => {
    const { store } = await createStore();
    const settings = await store.list();

    expect(settings.agents).toHaveLength(1);
    expect(settings.agents[0]!.id).toBe("long");
    expect(settings.agents[0]!.systemPrompt).toBe(
      DEFAULT_LONG_AGENT_SETTINGS.agents[0]!.systemPrompt
    );
  });

  it("persists a customized prompt and catalog scope at the current version", async () => {
    const { root, store } = await createStore();
    const input = editableDefaults();
    input.agents[0]!.systemPrompt = "只做最小改动，并解释理由。";
    input.agents[0]!.welcomeShortcuts[0] = "检查当前章连续性";
    input.agents[0]!.readAccess.materialKinds = ["plot"];

    const saved = await store.save(input);
    expect(saved.agents[0]!.systemPrompt).toBe("只做最小改动，并解释理由。");
    expect(saved.agents[0]!.readAccess.materialKinds).toEqual(["plot"]);

    const disk = JSON.parse(await readFile(settingsPath(root), "utf8")) as {
      version: number;
      agents: { id: string }[];
    };
    expect(disk.version).toBe(LONG_AGENT_SETTINGS_DISK_VERSION);
    expect(disk.agents.map(({ id }) => id)).toEqual(["long"]);

    const reloaded = await new LongAgentConfigStore(root).list();
    expect(reloaded.agents[0]!.systemPrompt).toBe("只做最小改动，并解释理由。");
  });

  it("switches existing users to the new builtin prompt on upgrade without touching the file", async () => {
    const { root, store } = await createStore();
    const legacy = {
      version: 2,
      workspaceType: "long",
      agents: [
        {
          id: "long",
          systemPrompt: "旧的长篇智能体提示词。",
          welcomeShortcuts: ["a", "b", "c"],
          readAccess: {
            workspaceRoots: [
              "worldbuilding",
              "character_design",
              "plot_design",
              "draft",
              "continuity_ledger"
            ],
            materialKinds: ["plot"],
            skillKinds: ["general"]
          }
        }
      ]
    };
    await writeDisk(root, legacy);

    const settings = await store.list();
    expect(settings.agents.map(({ id }) => id)).toEqual(["long"]);
    expect(settings.agents[0]!.systemPrompt).toBe(
      DEFAULT_LONG_AGENT_SETTINGS.agents[0]!.systemPrompt
    );

    const disk = JSON.parse(await readFile(settingsPath(root), "utf8")) as {
      version: number;
    };
    expect(disk.version).toBe(2);
  });

  it("rejects a current-version payload whose contents are invalid", async () => {
    const { root, store } = await createStore();
    await writeDisk(root, {
      version: LONG_AGENT_SETTINGS_DISK_VERSION,
      workspaceType: "long",
      agents: [{ id: "long", systemPrompt: "" }]
    });

    await expect(store.list()).rejects.toThrow(/配置内容无效/);
  });

  it("restores the builtin prompt on reset and resolves the active profile", async () => {
    const { store } = await createStore();
    const input = editableDefaults();
    input.agents[0]!.systemPrompt = "临时提示词。";
    await store.save(input);
    expect((await store.resolve("long")).systemPrompt).toBe("临时提示词。");

    const reset = await store.reset("long");
    expect(reset.agents[0]!.systemPrompt).toBe(
      DEFAULT_LONG_AGENT_SETTINGS.agents[0]!.systemPrompt
    );

    const profile = await store.resolve("long");
    expect(profile.id).toBe("long");
    expect(profile.writeAccess.workspaceRoots).toEqual([
      "worldbuilding",
      "character_design",
      "plot_design",
      "draft",
      "continuity_ledger"
    ]);
  });
});
