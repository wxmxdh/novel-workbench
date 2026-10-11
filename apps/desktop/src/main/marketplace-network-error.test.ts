import { describe, expect, it } from "vitest";
import { describeMarketplaceNetworkError } from "./marketplace-network-error";

function fetchFailure(cause: unknown): Error {
  return new TypeError("fetch failed", { cause });
}

describe("describeMarketplaceNetworkError", () => {
  it.each([
    [
      { code: "ENOTFOUND" },
      "无法解析技能广场服务器地址，请检查 DNS 或网络连接。"
    ],
    [
      { code: "CERT_HAS_EXPIRED" },
      "技能广场安全证书校验失败，请检查系统时间、网络代理或证书设置。"
    ],
    [
      new Error("net::ERR_PROXY_CONNECTION_FAILED"),
      "无法通过网络代理连接技能广场，请检查系统代理设置。"
    ],
    [
      { code: "UND_ERR_CONNECT_TIMEOUT" },
      "连接技能广场超时，请检查网络或代理设置后重试。"
    ],
    [{ code: "ECONNREFUSED" }, "技能广场服务器拒绝了连接，请稍后重试。"],
    [{ code: "ECONNRESET" }, "与技能广场的连接意外中断，请检查网络后重试。"]
  ])("describes a nested transport failure", (cause, expected) => {
    expect(describeMarketplaceNetworkError(fetchFailure(cause)).message).toBe(
      expected
    );
  });

  it("does not expose an unknown low-level error message", () => {
    const failure = fetchFailure(
      new Error("request contained private-machine-details")
    );

    expect(describeMarketplaceNetworkError(failure).message).toBe(
      "无法连接技能广场，请检查网络、防火墙或代理设置后重试。"
    );
  });
});
