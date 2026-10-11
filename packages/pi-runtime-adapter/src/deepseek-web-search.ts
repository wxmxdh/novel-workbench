import {
  isDeepSeekWebSearchCompatible,
  type AgentProviderRuntimeConfig,
  type ModelApi
} from "@deepwrite/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWebSearchTool(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.type === "web_search" ||
    value.type === "web_search_2025_08_26" ||
    value.type === "web_search_20250305"
  );
}

export function assertDeepSeekWebSearchCompatible(
  config: AgentProviderRuntimeConfig
): void {
  if (isDeepSeekWebSearchCompatible(config)) return;
  throw new Error(
    "智能搜索仅支持 Provider 为 DeepSeek，且 API 类型为 OpenAI Responses 或 Anthropic Messages 的模型。"
  );
}

export function renderDeepSeekWebSearchCapabilityPrompt(): string {
  return [
    "【智能搜索能力】",
    "本轮已启用 DeepSeek 服务端智能搜索工具 web_search。用户请求实时、近期或其它外部公开信息时，应按需调用该工具，并基于实际返回的搜索结果回答。",
    "智能搜索是只读且按需使用的能力，不必为无需外部信息的问题强制搜索。只有实际获得搜索结果后才能声称已经搜索或引用实时信息；搜索失败时应如实说明。"
  ].join("\n");
}

export function renderDeepSeekWebSearchNetworkBoundary(): string {
  return "网络能力仅限本轮列出的 DeepSeek 服务端 web_search，不具备浏览器控制、任意 HTTP 请求或其它联网能力。";
}

export function appendDeepSeekWebSearchTool(
  payload: unknown,
  api: ModelApi
): unknown {
  if (!isRecord(payload)) {
    throw new Error("DeepSeek 智能搜索无法扩展当前 Provider 请求。");
  }
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  if (tools.some(isWebSearchTool)) return payload;
  const webSearchTool =
    api === "anthropic-messages"
      ? { type: "web_search_20250305", name: "web_search" }
      : { type: "web_search" };
  return { ...payload, tools: [...tools, webSearchTool] };
}
