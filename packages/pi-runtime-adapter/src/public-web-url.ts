import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255))
    return true;
  const [a, b] = octets;
  const c = octets[2]!;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 &&
      (b === 0 || b === 2 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !isPrivateIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    const firstGroup = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("2001:10:") ||
      firstGroup < 0x2000 ||
      firstGroup > 0x3fff
    );
  }
  return false;
}

export interface PublicWebTarget {
  url: URL;
  addresses: Array<{ address: string; family: number }>;
}

/** Resolve and validate every URL before pinning an outbound request. */
export async function resolvePublicWebTarget(
  value: string
): Promise<PublicWebTarget> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("只支持有效的公开网页 URL。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname) !== 0 ||
    url.hostname === "localhost" ||
    !url.hostname.includes(".")
  )
    throw new Error(
      "只支持公开 HTTP(S) 网页；本机、内网和自定义端口地址会被拒绝。"
    );

  const addresses = await new Promise<
    Array<{ address: string; family: number }>
  >((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("网页域名解析超时，已拒绝抓取。")),
      3_000
    );
    lookup(url.hostname, { all: true, verbatim: true }).then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      () => {
        clearTimeout(timeout);
        resolve([]);
      }
    );
  });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error("网页域名无法解析为公开地址，已拒绝抓取。");
  return { url, addresses };
}

export async function assertPublicWebUrl(value: string): Promise<URL> {
  return (await resolvePublicWebTarget(value)).url;
}
