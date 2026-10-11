import { describe, expect, it } from "vitest";
import type {
  AgentProviderRuntimeConfig,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import {
  explicitlyNamesLoveWriter,
  selectLoveWriters
} from "./love-writer-selection";

const definitions: ShortAgentSubagentDefinition[] = [
  {
    id: "love-writer-deepseek",
    name: "DeepSeek R1",
    description: "writer",
    systemPrompt: "writer",
    enabled: true,
    modelMode: "custom",
    modelId: "deepseek"
  },
  {
    id: "love-writer-gemini",
    name: "Gemini 2.5 Flash",
    description: "writer",
    systemPrompt: "writer",
    enabled: true,
    modelMode: "custom",
    modelId: "gemini"
  },
  {
    id: "love-writer-gpt",
    name: "GPT 6.1 Sol",
    description: "writer",
    systemPrompt: "writer",
    enabled: true,
    modelMode: "custom",
    modelId: "gpt"
  }
];

const runtimeConfigs = {
  deepseek: {
    id: "deepseek-config",
    label: "DeepSeek R1",
    provider: "deepseek",
    modelId: "deepseek-r1",
    apiKey: "test-invalid-api-key",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.2, 0.7, 1]
  },
  gemini: {
    id: "gemini-config",
    label: "Gemini 2.5 Flash",
    provider: "google",
    modelId: "gemini-2.5-flash",
    apiKey: "test-invalid-api-key",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.2, 0.7, 1]
  },
  gpt: {
    id: "gpt-config",
    label: "GPT 6.1 Sol",
    provider: "openai",
    modelId: "gpt-6.1-sol",
    apiKey: "test-invalid-api-key",
    api: "openai-responses",
    baseUrl: "https://example.test/v1",
    reasoning: true,
    defaultThinkingLevel: "medium",
    thinkingLevelOptions: ["low", "medium", "high"],
    temperatureOptions: [0.2, 0.7, 1]
  }
} satisfies Record<string, AgentProviderRuntimeConfig>;

describe("selectLoveWriters", () => {
  it("recognizes an explicit model reference only in an actual author action", () => {
    expect(
      explicitlyNamesLoveWriter("重试 DeepSeek 和 Gemini 2.5 的第一章独立稿")
    ).toBe(true);
    expect(
      explicitlyNamesLoveWriter("讨论 DeepSeek 和 Gemini 2.5 的授权方式")
    ).toBe(false);
    expect(explicitlyNamesLoveWriter("写第一章正文 for Love")).toBe(false);
  });

  it("resolves explicit DeepSeek and Gemini 2.5 names without adding other ready writers", () => {
    const selected = selectLoveWriters({
      authorText:
        "重试 DeepSeek 和 Gemini 2.5 的第一章独立稿，保留已经保存的其他稿件。",
      definitions,
      runtimeConfigs
    });

    expect(selected?.definitions.map(({ id }) => id)).toEqual([
      "love-writer-deepseek",
      "love-writer-gemini"
    ]);
    expect(selected?.writers.map(({ definitionId }) => definitionId)).toEqual([
      "love-writer-deepseek",
      "love-writer-gemini"
    ]);
  });

  it("does not fan out when a named family is ambiguous", () => {
    const proDefinition: ShortAgentSubagentDefinition = {
      ...definitions[1]!,
      id: "love-writer-gemini-pro",
      name: "Gemini 2.5 Pro",
      modelId: "gemini-pro"
    };
    const proConfig: AgentProviderRuntimeConfig = {
      ...runtimeConfigs.gemini,
      id: "gemini-pro-config",
      label: "Gemini 2.5 Pro",
      modelId: "gemini-2.5-pro"
    };

    expect(
      selectLoveWriters({
        authorText: "让 Gemini 2.5 写两份第一章独立稿",
        writerCount: 2,
        definitions: [...definitions, proDefinition],
        runtimeConfigs: { ...runtimeConfigs, "gemini-pro": proConfig }
      })
    ).toBeUndefined();
  });

  it("matches the configured runtime Flash specification, not stale labels", () => {
    const runtime = {
      ...runtimeConfigs.gemini,
      label: "Gemini 2.5 Pro",
      modelId: "gemini-2.5-flash"
    };
    const selected = selectLoveWriters({
      authorText: "重试 Gemini 2.5 Flash 的第一章独立稿",
      definitions: [{ ...definitions[1]!, name: "Gemini 2.5 Pro" }],
      runtimeConfigs: { gemini: runtime }
    });

    expect(selected?.writers[0]?.runtime.model).toBe("gemini-2.5-flash");
  });

  it("matches the configured runtime Pro specification, not stale labels", () => {
    const runtime = {
      ...runtimeConfigs.gemini,
      label: "Gemini 2.5 Flash",
      modelId: "gemini-2.5-pro"
    };
    const selected = selectLoveWriters({
      authorText: "重试 Gemini 2.5 Pro 的第一章独立稿",
      definitions: [{ ...definitions[1]!, name: "Gemini 2.5 Flash" }],
      runtimeConfigs: { gemini: runtime }
    });

    expect(selected?.writers[0]?.runtime.model).toBe("gemini-2.5-pro");
  });

  it("matches a lower-case specification against the configured runtime model", () => {
    const runtime = {
      ...runtimeConfigs.gemini,
      label: "Gemini 2.5 Pro",
      modelId: "gemini-2.5-flash"
    };
    const selected = selectLoveWriters({
      authorText: "重试 gemini 2.5 flash 的第一章独立稿",
      definitions: [definitions[1]!],
      runtimeConfigs: { gemini: runtime }
    });

    expect(selected?.writers[0]?.runtime.model).toBe("gemini-2.5-flash");
  });

  it("rejects a lower-case requested specification absent from runtime config", () => {
    const runtime = {
      ...runtimeConfigs.gemini,
      modelId: "gemini-2.5-pro"
    };

    expect(
      selectLoveWriters({
        authorText: "重试 gemini 2.5 flash 的第一章独立稿",
        definitions: [definitions[1]!],
        runtimeConfigs: { gemini: runtime }
      })
    ).toBeUndefined();
  });

  it("does not mistake an English connector after a version for a model specification", () => {
    const selected = selectLoveWriters({
      authorText: "重试 gemini 2.5 for Love 的第一章独立稿",
      definitions: [definitions[1]!],
      runtimeConfigs
    });

    expect(selected?.writers[0]?.runtime.model).toBe("gemini-2.5-flash");
  });

  it("recognizes a short model family name without selecting sibling versions", () => {
    const selected = selectLoveWriters({
      authorText: "让 GPT 写第一章独立稿 for Love",
      definitions,
      runtimeConfigs
    });

    expect(selected?.definitions.map(({ id }) => id)).toEqual([
      "love-writer-gpt"
    ]);
  });

  it("keeps a short family name ambiguous when multiple versions are configured", () => {
    const gpt5: ShortAgentSubagentDefinition = {
      ...definitions[2]!,
      id: "love-writer-gpt5",
      name: "GPT 5.6 Sol",
      modelId: "gpt5"
    };
    const gpt5Config: AgentProviderRuntimeConfig = {
      ...runtimeConfigs.gpt,
      id: "gpt5-config",
      label: "GPT 5.6 Sol",
      modelId: "gpt-5.6-sol"
    };

    expect(
      selectLoveWriters({
        authorText: "让 GPT 写第一章独立稿",
        definitions: [...definitions, gpt5],
        runtimeConfigs: { ...runtimeConfigs, gpt5: gpt5Config }
      })
    ).toBeUndefined();
  });

  it("does not count an explicitly named but unconfigured model as a missing-name fallback", () => {
    expect(
      selectLoveWriters({
        authorText: "让 Aster 写两份第一章独立稿",
        writerCount: 2,
        definitions: [definitions[0]!, definitions[1]!],
        runtimeConfigs
      })
    ).toBeUndefined();
  });

  it("ignores model names that appear only in preserved or prohibited scope", () => {
    const selected = selectLoveWriters({
      authorText:
        "让 DeepSeek 写第一章独立稿，保留 Gemini 和 GPT 的成功稿，不要重写其他稿。",
      definitions,
      runtimeConfigs
    });

    expect(selected?.definitions.map(({ id }) => id)).toEqual([
      "love-writer-deepseek"
    ]);
  });

  it("selects only the explicitly named writer for an authorized redraft", () => {
    const authorText = "请按已选大纲让 DeepSeek 二次创作第一章正文。";
    const selected = selectLoveWriters({
      authorText,
      definitions,
      runtimeConfigs
    });

    expect(explicitlyNamesLoveWriter(authorText)).toBe(true);
    expect(selected?.definitions.map(({ id }) => id)).toEqual([
      "love-writer-deepseek"
    ]);
    expect(selected?.writers.map(({ definitionId }) => definitionId)).toEqual([
      "love-writer-deepseek"
    ]);
  });

  it("does not use a model named only in the preserved-success scope of a redraft", () => {
    const selected = selectLoveWriters({
      authorText: "按已选大纲重写第一章正文，保留 DeepSeek 的成功稿。",
      definitions,
      runtimeConfigs
    });

    expect(selected).toBeUndefined();
  });

  it("only permits count-based all-writer selection when the count exactly matches the ready team", () => {
    expect(
      selectLoveWriters({
        authorText: "让团队写第一章两份独立稿",
        writerCount: 2,
        definitions,
        runtimeConfigs
      })
    ).toBeUndefined();
    expect(
      selectLoveWriters({
        authorText: "让团队写第一章三份独立稿",
        writerCount: 3,
        definitions,
        runtimeConfigs
      })?.definitions
    ).toHaveLength(3);
  });
});
