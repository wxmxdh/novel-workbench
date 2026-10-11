import { describe, expect, it } from "vitest";
import type { ModelApi } from "@deepwrite/contracts/renderer";
import {
  isWorkspaceWebSearchAvailable,
  resolveWorkspaceWebSearchEnabled,
  workspaceWebSearchAfterModelChange,
  workspaceWebSearchPromptFields
} from "./web-search";

function model(provider: string, api: ModelApi) {
  return { provider, api };
}

describe("workspace web search preference", () => {
  it("is available only for DeepSeek Responses and Anthropic APIs", () => {
    expect(
      isWorkspaceWebSearchAvailable(model("deepseek", "openai-responses"))
    ).toBe(true);
    expect(
      isWorkspaceWebSearchAvailable(model("deepseek", "anthropic-messages"))
    ).toBe(true);
    expect(
      isWorkspaceWebSearchAvailable(model("deepseek", "openai-completions"))
    ).toBe(false);
    expect(
      isWorkspaceWebSearchAvailable(model("openai", "openai-responses"))
    ).toBe(false);
  });

  it("enables only when requested and the model is compatible", () => {
    expect(
      resolveWorkspaceWebSearchEnabled(
        model("deepseek", "openai-responses"),
        true
      )
    ).toBe(true);
    expect(
      resolveWorkspaceWebSearchEnabled(
        model("deepseek", "openai-responses"),
        false
      )
    ).toBe(false);
    expect(
      resolveWorkspaceWebSearchEnabled(
        model("openai", "openai-responses"),
        true
      )
    ).toBe(false);
  });

  it("auto-disables after switching to an incompatible model", () => {
    expect(
      workspaceWebSearchAfterModelChange(
        model("deepseek", "anthropic-messages"),
        true
      )
    ).toEqual({ enabled: true, autoDisabled: false });
    expect(
      workspaceWebSearchAfterModelChange(
        model("deepseek", "openai-completions"),
        true
      )
    ).toEqual({ enabled: false, autoDisabled: true });
    expect(
      workspaceWebSearchAfterModelChange(
        model("openai", "openai-responses"),
        false
      )
    ).toEqual({ enabled: false, autoDisabled: false });
  });

  it("omits the prompt field unless enabled", () => {
    expect(workspaceWebSearchPromptFields(true)).toEqual({
      webSearchEnabled: true
    });
    expect(workspaceWebSearchPromptFields(false)).toEqual({});
  });
});
