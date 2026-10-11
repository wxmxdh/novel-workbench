import { describe, expect, it } from "vitest";
import type { ShortAgentSubagentDefinition } from "@deepwrite/contracts";
import {
  createCopiedSubagent,
  nextCopiedSubagentName
} from "./agentTeamSettingsEditorHelpers";

describe("nextCopiedSubagentName", () => {
  it("appends an incrementing number after the original name", () => {
    expect(nextCopiedSubagentName("写手小弟", ["写手小弟"], 80)).toBe(
      "写手小弟 2"
    );
    expect(
      nextCopiedSubagentName("写手小弟", ["写手小弟", "写手小弟 2"], 80)
    ).toBe("写手小弟 3");
  });

  it("continues from a trailing copy number instead of stacking suffixes", () => {
    expect(
      nextCopiedSubagentName("写手小弟 2", ["写手小弟", "写手小弟 2"], 80)
    ).toBe("写手小弟 3");
  });

  it("skips names that already exist regardless of case", () => {
    expect(
      nextCopiedSubagentName("写手小弟", ["写手小弟", "写手小弟 2"], 80)
    ).toBe("写手小弟 3");
    expect(nextCopiedSubagentName("Alpha", ["Alpha", "alpha 2"], 80)).toBe(
      "Alpha 3"
    );
  });

  it("keeps names within the max length", () => {
    const longName = "写".repeat(78);
    const copied = nextCopiedSubagentName(longName, [longName], 80);
    expect(copied.length).toBeLessThanOrEqual(80);
    expect(copied.endsWith(" 2")).toBe(true);
  });
});

describe("createCopiedSubagent", () => {
  it("copies settings and assigns a new id and numbered name", () => {
    const source = {
      id: "subagent_source",
      name: "写手小弟",
      description: "负责小节写作",
      systemPrompt: "只写指定小节。",
      enabled: true,
      modelMode: "custom" as const,
      modelId: "model_custom",
      thinkingLevel: "high" as const
    };

    const copied = createCopiedSubagent(source, [source], "subagent_copy", 80);

    expect(copied).toEqual({
      ...source,
      id: "subagent_copy",
      name: "写手小弟 2"
    });
    expect(copied).not.toBe(source);
  });

  it("inserts the copy immediately after the source subagent", () => {
    const first = {
      id: "subagent_first",
      name: "写手小弟",
      description: "负责小节写作",
      systemPrompt: "只写指定小节。",
      enabled: true,
      modelMode: "inherit" as const
    };
    const second = {
      ...first,
      id: "subagent_second",
      name: "审阅小弟"
    };
    const subagents: ShortAgentSubagentDefinition[] = [first, second];
    const copied = createCopiedSubagent(first, subagents, "subagent_copy", 80);
    subagents.splice(1, 0, copied);
    expect(subagents.map((item) => item.id)).toEqual([
      "subagent_first",
      "subagent_copy",
      "subagent_second"
    ]);
    expect(subagents[1]?.name).toBe("写手小弟 2");
  });
});
