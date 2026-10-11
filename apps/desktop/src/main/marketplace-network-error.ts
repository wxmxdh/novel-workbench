interface NetworkFailureDescription {
  message: string;
}

const DNS_CODES = new Set(["EAI_AGAIN", "ENOTFOUND", "ERR_NAME_NOT_RESOLVED"]);
const CERTIFICATE_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_CERT_AUTHORITY_INVALID",
  "ERR_CERT_COMMON_NAME_INVALID",
  "ERR_CERT_DATE_INVALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
]);
const PROXY_CODES = new Set([
  "ERR_PROXY_CONNECTION_FAILED",
  "ERR_TUNNEL_CONNECTION_FAILED",
  "UND_ERR_PROXY"
]);
const TIMEOUT_CODES = new Set([
  "ABORT_ERR",
  "ECONNABORTED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT"
]);
const INTERRUPTED_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_RESET",
  "UND_ERR_SOCKET"
]);

function errorRecord(error: unknown): Record<string, unknown> | undefined {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : undefined;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < 6) {
    if (visited.has(current)) break;
    visited.add(current);
    chain.push(current);
    current = errorRecord(current)?.cause;
  }
  return chain;
}

function errorCode(error: unknown): string {
  const value = errorRecord(error)?.code;
  return typeof value === "string" ? value.toUpperCase() : "";
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  return typeof error === "string" ? error : "";
}

function hasCode(
  chain: readonly unknown[],
  codes: ReadonlySet<string>
): boolean {
  return chain.some((error) => codes.has(errorCode(error)));
}

function hasText(chain: readonly unknown[], pattern: RegExp): boolean {
  return chain.some((error) => pattern.test(errorText(error)));
}

export function describeMarketplaceNetworkError(
  error: unknown
): NetworkFailureDescription {
  const chain = errorChain(error);

  if (
    hasCode(chain, TIMEOUT_CODES) ||
    hasText(chain, /\b(?:timeout|timed out)\b|aborted due to timeout/iu)
  ) {
    return {
      message: "连接技能广场超时，请检查网络或代理设置后重试。"
    };
  }
  if (
    hasCode(chain, DNS_CODES) ||
    hasText(chain, /name_not_resolved|getaddrinfo|dns|resolve host/iu)
  ) {
    return {
      message: "无法解析技能广场服务器地址，请检查 DNS 或网络连接。"
    };
  }
  if (
    hasCode(chain, CERTIFICATE_CODES) ||
    hasText(chain, /certificate|self[ -]signed|cert_|tls cert/iu)
  ) {
    return {
      message: "技能广场安全证书校验失败，请检查系统时间、网络代理或证书设置。"
    };
  }
  if (
    hasCode(chain, PROXY_CODES) ||
    hasText(chain, /proxy|tunnel connection/iu)
  ) {
    return {
      message: "无法通过网络代理连接技能广场，请检查系统代理设置。"
    };
  }
  if (
    hasCode(chain, new Set(["ECONNREFUSED", "ERR_CONNECTION_REFUSED"])) ||
    hasText(chain, /connection refused/iu)
  ) {
    return {
      message: "技能广场服务器拒绝了连接，请稍后重试。"
    };
  }
  if (
    hasCode(chain, INTERRUPTED_CODES) ||
    hasText(chain, /connection (?:closed|reset)|socket disconnected/iu)
  ) {
    return {
      message: "与技能广场的连接意外中断，请检查网络后重试。"
    };
  }
  return {
    message: "无法连接技能广场，请检查网络、防火墙或代理设置后重试。"
  };
}
