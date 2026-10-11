import { describe, expect, it } from "vitest";
import { applyProviderPresetDefaults } from "../components/modelProviderPresets";
import {
  builtinProviderSets,
  collectUserProviderIds,
  mergeProviderSelectOptions,
  resolveCustomProviderName
} from "./customModelProvider";

const builtin = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI" },
  { value: "custom", label: "其他兼容服务" }
] as const;

describe("customModelProvider", () => {
  it("collects unique user providers and skips builtin ids", () => {
    const { values } = builtinProviderSets(builtin);
    expect(
      collectUserProviderIds(
        ["硅基流动", "DeepSeek", "custom", "SILICONFLOW", "硅基流动", ""],
        values
      )
    ).toEqual(["硅基流动", "siliconflow"]);
  });

  it("places user providers between named presets and 其他兼容服务", () => {
    const options = mergeProviderSelectOptions(builtin, [
      "硅基流动",
      "deepseek",
      "siliconflow"
    ]);
    expect(options.map((option) => option.value)).toEqual([
      "deepseek",
      "openai",
      "硅基流动",
      "siliconflow",
      "custom"
    ]);
    expect(options.at(-1)).toEqual({
      value: "custom",
      label: "其他兼容服务"
    });
  });

  it("rejects empty, oversized, and builtin names", () => {
    expect(resolveCustomProviderName("  ", builtin)).toEqual({
      status: "invalid",
      message: "请输入提供商名称"
    });
    expect(resolveCustomProviderName("x".repeat(121), builtin).status).toBe(
      "invalid"
    );
    expect(resolveCustomProviderName("DeepSeek", builtin)).toEqual({
      status: "invalid",
      message: "这是内置提供商，请直接从列表选择"
    });
    expect(resolveCustomProviderName("其他兼容服务", builtin)).toEqual({
      status: "invalid",
      message: "这是内置提供商，请直接从列表选择"
    });
  });

  it("reuses an existing user provider name instead of creating a duplicate", () => {
    expect(resolveCustomProviderName(" 硅基流动 ", builtin)).toEqual({
      status: "ok",
      provider: "硅基流动"
    });
  });

  it("keeps api and base url when applying a user provider", () => {
    const target = {
      provider: "deepseek",
      api: "anthropic-messages" as const,
      baseUrl: "https://previous.example.test/v1"
    };
    applyProviderPresetDefaults(target, "硅基流动");
    expect(target).toEqual({
      provider: "硅基流动",
      api: "anthropic-messages",
      baseUrl: "https://previous.example.test/v1"
    });
  });
});
