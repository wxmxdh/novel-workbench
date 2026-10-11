import { describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import {
  buildProviderRuntime,
  buildWorkspaceProviderRuntimes
} from "./provider-runtime";
import { appendDeepSeekWebSearchTool } from "./deepseek-web-search";

function config(
  api: "openai-responses" | "anthropic-messages",
  provider = "deepseek"
): AgentProviderRuntimeConfig {
  return {
    id: `search-${api}`,
    label: "DeepSeek search test",
    provider,
    modelId: "deepseek-search-test",
    api,
    baseUrl: "https://provider.example.test",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low"],
    temperatureOptions: [0.1, 0.7, 1],
    apiKey: "invalid-test-key"
  };
}

const localTool: AgentTool = {
  name: "local_lookup",
  label: "Local lookup",
  description: "Read a local test value.",
  parameters: Type.Object({ query: Type.String() }),
  execute: async () => ({
    content: [{ type: "text", text: "test" }],
    details: {}
  })
};

async function captureStreamPayload(
  runtime: ReturnType<typeof buildProviderRuntime>
): Promise<{ payload: Record<string, unknown>; upstreamCalls: number }> {
  let payload: Record<string, unknown> | undefined;
  const upstream = vi.fn((value: unknown) => ({
    ...(value as Record<string, unknown>),
    upstream_marker: true
  }));
  const fetcher: typeof globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ error: { message: "expected test stop" } }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  };
  const stream = await runtime.streamFn(
    runtime.model,
    {
      systemPrompt: "Use tools when useful.",
      messages: [{ role: "user", content: "Search the web.", timestamp: 0 }],
      tools: [localTool]
    },
    { fetch: fetcher, onPayload: upstream }
  );
  const result = await stream.result();
  expect(result.stopReason).toBe("error");
  if (!payload) throw new Error("Provider payload was not captured.");
  return { payload, upstreamCalls: upstream.mock.calls.length };
}

async function captureProviderPayload(
  runtimeConfig: AgentProviderRuntimeConfig,
  webSearchEnabled: boolean
): Promise<{ payload: Record<string, unknown>; upstreamCalls: number }> {
  return captureStreamPayload(
    buildProviderRuntime(runtimeConfig, 0.7, "off", { webSearchEnabled })
  );
}

describe("DeepSeek server-side web search", () => {
  it.each([
    ["openai-responses", { type: "web_search" }],
    ["anthropic-messages", { type: "web_search_20250305", name: "web_search" }]
  ] as const)(
    "injects the expected %s tool without replacing local tools",
    async (api, expectedTool) => {
      const { payload, upstreamCalls } = await captureProviderPayload(
        config(api),
        true
      );
      const tools = payload.tools as Array<Record<string, unknown>>;

      expect(payload.upstream_marker).toBe(true);
      expect(upstreamCalls).toBe(1);
      expect(tools).toContainEqual(expectedTool);
      expect(tools).toHaveLength(2);
    }
  );

  it("does not inject the server tool when search is disabled", async () => {
    const { payload } = await captureProviderPayload(
      config("openai-responses"),
      false
    );
    expect(payload.tools).toHaveLength(1);
  });

  it("deduplicates an existing versioned web search tool", () => {
    const payload = {
      tools: [{ type: "web_search_2025_08_26" }]
    };
    expect(appendDeepSeekWebSearchTool(payload, "openai-responses")).toBe(
      payload
    );
  });

  it("rejects an incompatible provider before starting a request", () => {
    expect(() =>
      buildProviderRuntime(
        config("openai-responses", "deepseek-official"),
        0.7,
        "off",
        { webSearchEnabled: true }
      )
    ).toThrow(/智能搜索仅支持/u);
  });

  it("keeps spawn requests free of the parent web search tool", async () => {
    const runtimes = buildWorkspaceProviderRuntimes(
      config("openai-responses"),
      0.7,
      "off",
      { webSearchEnabled: true }
    );
    const parent = await captureStreamPayload({
      model: runtimes.model,
      streamFn: runtimes.streamFn
    });
    const spawn = await captureStreamPayload({
      model: runtimes.model,
      streamFn: runtimes.spawnStreamFn
    });

    expect(parent.payload.tools).toContainEqual({ type: "web_search" });
    expect(spawn.payload.tools).toHaveLength(1);
    expect(spawn.payload.tools).not.toContainEqual({ type: "web_search" });
  });
});
