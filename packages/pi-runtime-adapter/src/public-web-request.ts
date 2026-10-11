import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { PublicWebTarget } from "./public-web-url";

export interface PublicWebResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
  truncated: boolean;
}

/** Uses the already-validated address for socket lookup, avoiding a second DNS resolution. */
export function requestPinnedPublicUrl(
  target: PublicWebTarget,
  signal: AbortSignal,
  maxBytes: number
): Promise<PublicWebResponse> {
  const { url, addresses } = target;
  const { address, family } = addresses[0]!;
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const request = transport(
      url,
      {
        method: "GET",
        agent: false,
        signal,
        headers: {
          accept: "text/html, text/plain, application/xhtml+xml",
          "accept-encoding": "identity"
        },
        lookup: (_hostname, options, callback) => {
          const callbackFn = (typeof options === "function"
            ? options
            : callback) as unknown as (
            error: NodeJS.ErrnoException | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number
          ) => void;
          if (typeof options !== "function" && options.all)
            callbackFn(null, [{ address, family }]);
          else callbackFn(null, address, family);
        }
      },
      (response) => {
        const chunks: Uint8Array[] = [];
        let total = 0;
        let truncated = false;
        response.on("data", (chunk: Buffer) => {
          const remaining = maxBytes - total;
          if (chunk.byteLength > remaining) {
            chunks.push(chunk.subarray(0, remaining));
            total += remaining;
            truncated = true;
            const body = Buffer.concat(chunks, total);
            finish(() =>
              resolve({
                statusCode: response.statusCode ?? 0,
                headers: response.headers,
                body,
                truncated
              })
            );
            response.destroy();
            request.destroy();
            return;
          }
          chunks.push(chunk);
          total += chunk.byteLength;
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks, total);
          finish(() =>
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: response.headers,
              body,
              truncated
            })
          );
        });
        response.on("error", (error) => finish(() => reject(error)));
      }
    );
    request.on("error", (error) => finish(() => reject(error)));
    request.end();
  });
}
