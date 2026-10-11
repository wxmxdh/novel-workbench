import type {
  AgentProviderRuntimeConfig,
  ModelApi
} from "@deepwrite/contracts";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiAgentRuntimeAdapter } from "./adapter";
import { buildProviderRuntime } from "./provider-runtime";

const apis = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages"
] as const;

function config(
  api: ModelApi,
  provider = "opencode-go"
): AgentProviderRuntimeConfig {
  return {
    id: "opencode-test",
    label: "OpenCode test",
    provider,
    modelId: "test-model",
    api,
    baseUrl: "https://gateway.example.test/v1",
    apiKey: "invalid-test-key",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["low"],
    temperatureOptions: [0.1, 0.7, 1]
  };
}

function captureRequests() {
  const headers: Headers[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    headers.push(new Headers(init?.headers));
    return Response.json(
      { error: { message: "expected test stop" } },
      { status: 400 }
    );
  };
  return { headers, fetcher };
}

async function request(
  runtime: ReturnType<typeof buildProviderRuntime>,
  options: SimpleStreamOptions
) {
  const stream = await runtime.streamFn(
    runtime.model,
    { messages: [{ role: "user", content: "OK", timestamp: 0 }] },
    { maxRetries: 0, ...options }
  );
  await stream.result();
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenCode request session headers", () => {
  it.each(apis)(
    "sends stable conversation IDs through %s even with caching disabled",
    async (api) => {
      const { headers, fetcher } = captureRequests();
      const options = {
        fetch: fetcher,
        sessionId: "conversation-one",
        cacheRetention: "none" as const,
        headers: { "x-test-option": "preserved" }
      };
      const runtime = buildProviderRuntime(config(api));
      runtime.model.headers = { "x-test-model": "preserved" };
      await request(runtime, options);
      await request(runtime, options);
      // The desktop rebuilds its provider runtime between conversation turns.
      await request(buildProviderRuntime(config(api)), options);
      await request(runtime, { ...options, sessionId: "conversation-two" });

      expect(headers.map((value) => value.get("x-opencode-session"))).toEqual([
        "conversation-one",
        "conversation-one",
        "conversation-one",
        "conversation-two"
      ]);
      expect(headers[0]?.get("x-test-model")).toBe("preserved");
      for (const value of headers) {
        expect(value.get("x-test-option")).toBe("preserved");
        expect(value.get("user-agent")).toBe("DeepWrite");
        expect(
          value.get(
            api === "anthropic-messages" ? "x-api-key" : "authorization"
          )
        ).toBe(
          api === "anthropic-messages"
            ? "invalid-test-key"
            : "Bearer invalid-test-key"
        );
      }
    }
  );

  it.each(["opengo", "opencode", "opencode-zen", " OpenCode-Go "])(
    "supports the %s provider alias",
    async (provider) => {
      const { headers, fetcher } = captureRequests();
      await request(
        buildProviderRuntime(config("openai-completions", provider)),
        {
          fetch: fetcher,
          sessionId: "alias-session"
        }
      );
      expect(headers[0]?.get("x-opencode-session")).toBe("alias-session");
    }
  );

  it("keeps standalone operation IDs stable without sharing them between operations", async () => {
    const { headers, fetcher } = captureRequests();
    const runtime = buildProviderRuntime(config("openai-completions"));
    await request(runtime, { fetch: fetcher });
    await request(runtime, { fetch: fetcher });
    await request(buildProviderRuntime(config("openai-completions")), {
      fetch: fetcher
    });
    const ids = headers.map((value) => value.get("x-opencode-session"));
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it.each(apis)("covers the desktop connection test for %s", async (api) => {
    const { headers, fetcher } = captureRequests();
    vi.stubGlobal("fetch", fetcher);
    const adapter = new PiAgentRuntimeAdapter();
    await expect(adapter.testConnection(config(api))).rejects.toThrow(
      "expected test stop"
    );
    expect(headers).toHaveLength(1);
    expect(headers[0]?.get("x-opencode-session")).toBeTruthy();
  });

  it("uses the desktop conversation ID for successive agent turns", async () => {
    const { headers, fetcher } = captureRequests();
    vi.stubGlobal("fetch", fetcher);
    const adapter = new PiAgentRuntimeAdapter();
    for (const runId of ["run-one", "run-two"]) {
      for await (const _event of adapter.start({
        runId,
        sessionId: "desktop-conversation",
        prompt: "OK",
        runtimeConfig: config("openai-completions")
      })) {
        // Consume the expected provider error without calling a live service.
      }
    }
    expect(headers.length).toBeGreaterThanOrEqual(2);
    expect(
      headers.every(
        (value) => value.get("x-opencode-session") === "desktop-conversation"
      )
    ).toBe(true);
  });

  it("does not add OpenCode headers to unrelated providers", async () => {
    const { headers, fetcher } = captureRequests();
    await request(
      buildProviderRuntime(config("openai-completions", "custom")),
      {
        fetch: fetcher,
        sessionId: "other-conversation"
      }
    );
    expect(headers[0]?.has("x-opencode-session")).toBe(false);
    expect(headers[0]?.get("user-agent")).not.toBe("DeepWrite");
  });
});
