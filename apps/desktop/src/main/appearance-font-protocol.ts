import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { AppearanceCustomFontIdSchema } from "@deepwrite/contracts";
import type { AppearanceService } from "./appearance-service";

export const APPEARANCE_FONT_PROTOCOL_SCHEME = "deepwrite-font";
export const APPEARANCE_FONT_PROTOCOL_HOST = "asset";
const APPEARANCE_FONT_PROTOCOL_MAX_CONCURRENT_STREAMS = 8;

class StreamPermitPool {
  private active = 0;
  private readonly waiters: Array<(release: () => void) => void> = [];

  constructor(private readonly maximum: number) {}

  acquire(): Promise<() => void> {
    if (this.active < this.maximum) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(this.createRelease());
      } else {
        this.active -= 1;
      }
    };
  }
}

export interface AppearanceFontProtocolRegistrar {
  registerSchemesAsPrivileged(
    schemes: Parameters<typeof protocol.registerSchemesAsPrivileged>[0]
  ): void;
}

export interface AppearanceFontProtocolInstaller {
  handle(
    scheme: string,
    handler: (request: Request) => Promise<Response>
  ): void;
}

export type AppearanceFontAssetOpener = (
  path: string,
  flags: number
) => Promise<FileHandle>;

function response(status: number, headers?: HeadersInit): Response {
  return new Response(null, headers ? { status, headers } : { status });
}

export function registerAppearanceFontScheme(
  registrar: AppearanceFontProtocolRegistrar = protocol
): void {
  registrar.registerSchemesAsPrivileged([
    {
      scheme: APPEARANCE_FONT_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

export function createAppearanceFontProtocolHandler(
  service: Pick<AppearanceService, "resolveFontAsset">,
  openAsset: AppearanceFontAssetOpener = open
): (request: Request) => Promise<Response> {
  const streamPermits = new StreamPermitPool(
    APPEARANCE_FONT_PROTOCOL_MAX_CONCURRENT_STREAMS
  );
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return response(405, { Allow: "GET" });
    }

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return response(400);
    }
    if (
      url.protocol !== `${APPEARANCE_FONT_PROTOCOL_SCHEME}:` ||
      url.hostname !== APPEARANCE_FONT_PROTOCOL_HOST ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return response(400);
    }

    const rawId = url.pathname.slice(1);
    if (url.pathname !== `/${rawId}`) return response(400);
    const parsedId = AppearanceCustomFontIdSchema.safeParse(rawId);
    if (!parsedId.success) return response(400);

    let asset;
    try {
      asset = await service.resolveFontAsset(parsedId.data);
    } catch {
      return response(404);
    }
    if (!asset) return response(404);
    const releasePermit = await streamPermits.acquire();
    if (request.signal.aborted) {
      releasePermit();
      return response(400);
    }
    let handle: FileHandle | undefined;
    let sourceStream: ReturnType<FileHandle["createReadStream"]> | undefined;
    try {
      handle = await openAsset(
        asset.path,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      const info = await handle.stat();
      if (request.signal.aborted) {
        await handle.close();
        releasePermit();
        return response(400);
      }
      if (!info.isFile() || info.size !== asset.byteSize) {
        await handle.close();
        releasePermit();
        return response(404);
      }
      sourceStream = handle.createReadStream({
        autoClose: true,
        start: 0,
        end: asset.byteSize - 1
      });
      handle = undefined;
      const abortStream = () => sourceStream?.destroy();
      request.signal.addEventListener("abort", abortStream, { once: true });
      sourceStream.once("close", () => {
        request.signal.removeEventListener("abort", abortStream);
        releasePermit();
      });
      const body = Readable.toWeb(sourceStream) as ReadableStream<Uint8Array>;
      const result = new Response(body, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "private, max-age=31536000, immutable",
          "Content-Length": String(asset.byteSize),
          "Content-Type": asset.format === "ttf" ? "font/ttf" : "font/otf",
          "X-Content-Type-Options": "nosniff"
        }
      });
      return result;
    } catch {
      sourceStream?.destroy();
      await handle?.close().catch(() => undefined);
      releasePermit();
      return response(404);
    }
  };
}

export function installAppearanceFontProtocolHandler(
  service: Pick<AppearanceService, "resolveFontAsset">,
  installer: AppearanceFontProtocolInstaller = protocol
): void {
  installer.handle(
    APPEARANCE_FONT_PROTOCOL_SCHEME,
    createAppearanceFontProtocolHandler(service)
  );
}
