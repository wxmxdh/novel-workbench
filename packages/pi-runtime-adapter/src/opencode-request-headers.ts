import { randomUUID } from "node:crypto";

interface ProviderEndpoint {
  provider: string;
  baseUrl: string;
}

function isOpenCodeEndpoint({ provider, baseUrl }: ProviderEndpoint): boolean {
  if (
    ["opengo", "opencode", "opencode-go", "opencode-zen"].includes(
      provider.trim().toLowerCase()
    )
  ) {
    return true;
  }
  try {
    const url = new URL(baseUrl);
    return (
      url.hostname === "opencode.ai" && /^\/zen(?:\/|$)/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** Share one fallback ID across retries of a standalone operation. */
export function createOpenCodeRequestHeaders(endpoint: ProviderEndpoint) {
  const enabled = isOpenCodeEndpoint(endpoint);
  let fallbackSessionId: string | undefined;
  return (sessionId?: string): Record<string, string> | undefined => {
    if (!enabled) return undefined;
    return {
      "x-opencode-session":
        sessionId?.trim() || (fallbackSessionId ??= randomUUID()),
      "User-Agent": "DeepWrite"
    };
  };
}
