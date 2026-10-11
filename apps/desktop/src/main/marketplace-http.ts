import { MarketplaceClientError } from "./marketplace-response";
const MARKETPLACE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MarketplaceClientError(
      "marketplace.invalid_base_url",
      "技能广场接口基址无效。"
    );
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new MarketplaceClientError(
      "marketplace.invalid_base_url",
      "技能广场接口基址无效。"
    );
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}`;
}

export async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MARKETPLACE_MAX_RESPONSE_BYTES
  ) {
    throw new MarketplaceClientError(
      "marketplace.response_too_large",
      "技能广场响应超过大小限制。"
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MARKETPLACE_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new MarketplaceClientError(
          "marketplace.response_too_large",
          "技能广场响应超过大小限制。"
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8"
  );
}
