import { type FileHandle, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_FONT_PROTOCOL_SCHEME,
  createAppearanceFontProtocolHandler,
  installAppearanceFontProtocolHandler,
  registerAppearanceFontScheme,
  type AppearanceFontProtocolInstaller,
  type AppearanceFontProtocolRegistrar
} from "./appearance-font-protocol";

const temporaryRoots: string[] = [];
const fontId = `font_${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("appearance font protocol", () => {
  it("registers only the restricted secure custom scheme", () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerAppearanceFontScheme({
      registerSchemesAsPrivileged
    } as AppearanceFontProtocolRegistrar);

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: "deepwrite-font",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true
        }
      }
    ]);
  });

  it("installs the generated handler for the expected scheme", () => {
    const handle = vi.fn();
    const service = { resolveFontAsset: vi.fn() };
    installAppearanceFontProtocolHandler(service, {
      handle
    } as AppearanceFontProtocolInstaller);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[0]).toBe(APPEARANCE_FONT_PROTOCOL_SCHEME);
    expect(handle.mock.calls[0]?.[1]).toEqual(expect.any(Function));
  });

  it("serves a cataloged asset with immutable font headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-font-protocol-"));
    temporaryRoots.push(root);
    const path = join(root, "font.ttf");
    const bytes = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x01]);
    await writeFile(path, bytes);
    const resolveFontAsset = vi.fn(async () => ({
      path,
      format: "ttf" as const,
      byteSize: bytes.byteLength
    }));
    const handler = createAppearanceFontProtocolHandler({ resolveFontAsset });

    const result = await handler(
      new Request(`deepwrite-font://asset/${fontId}`)
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("font/ttf");
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(result.headers.get("Cache-Control")).toContain("immutable");
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
    expect(resolveFontAsset).toHaveBeenCalledWith(fontId);
  });

  it("bounds concurrent font streams until an earlier response is released", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-font-streams-"));
    temporaryRoots.push(root);
    const path = join(root, "font.ttf");
    const bytes = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x02]);
    await writeFile(path, bytes);
    const handler = createAppearanceFontProtocolHandler({
      resolveFontAsset: vi.fn(async () => ({
        path,
        format: "ttf" as const,
        byteSize: bytes.byteLength
      }))
    });
    const firstResponses = await Promise.all(
      Array.from({ length: 8 }, () =>
        handler(new Request(`deepwrite-font://asset/${fontId}`))
      )
    );
    let ninthSettled = false;
    const ninthResponse = handler(
      new Request(`deepwrite-font://asset/${fontId}`)
    ).then((result) => {
      ninthSettled = true;
      return result;
    });

    await Promise.resolve();
    expect(ninthSettled).toBe(false);
    await firstResponses[0]!.body?.cancel();
    const ninth = await ninthResponse;
    expect(ninth.status).toBe(200);

    await Promise.all([
      ...firstResponses.slice(1).map((result) => result.body?.cancel()),
      ninth.body?.cancel()
    ]);
  });

  it("releases its file and stream permit when a request aborts during stat", async () => {
    const controller = new AbortController();
    let finishStat: (() => void) | undefined;
    const stat = vi.fn(
      () =>
        new Promise<{ isFile(): boolean; size: number }>((resolve) => {
          finishStat = () => resolve({ isFile: () => true, size: 5 });
        })
    );
    const close = vi.fn(async () => undefined);
    const createReadStream = vi.fn();
    const openAsset = vi.fn(
      async () => ({ stat, close, createReadStream }) as unknown as FileHandle
    );
    const handler = createAppearanceFontProtocolHandler(
      {
        resolveFontAsset: vi.fn(async () => ({
          path: "/virtual/font.ttf",
          format: "ttf" as const,
          byteSize: 5
        }))
      },
      openAsset
    );
    const pending = handler(
      new Request(`deepwrite-font://asset/${fontId}`, {
        signal: controller.signal
      })
    );
    for (let attempt = 0; attempt < 5 && !finishStat; attempt += 1) {
      await Promise.resolve();
    }
    expect(finishStat).toBeTypeOf("function");

    controller.abort();
    finishStat?.();
    await expect(pending).resolves.toMatchObject({ status: 400 });
    expect(close).toHaveBeenCalledOnce();
    expect(createReadStream).not.toHaveBeenCalled();

    const nextController = new AbortController();
    nextController.abort();
    await expect(
      handler(
        new Request(`deepwrite-font://asset/${fontId}`, {
          signal: nextController.signal
        })
      )
    ).resolves.toMatchObject({ status: 400 });
  });

  it.each([
    [
      "non-GET",
      new Request(`deepwrite-font://asset/${fontId}`, { method: "POST" }),
      405
    ],
    ["wrong host", new Request(`deepwrite-font://other/${fontId}`), 400],
    ["query", new Request(`deepwrite-font://asset/${fontId}?raw=1`), 400],
    [
      "traversal",
      new Request("deepwrite-font://asset/%2e%2e%2fcatalog.json"),
      400
    ],
    ["malformed id", new Request("deepwrite-font://asset/font_short"), 400]
  ])("rejects %s requests", async (_label, request, expectedStatus) => {
    const resolveFontAsset = vi.fn();
    const result = await createAppearanceFontProtocolHandler({
      resolveFontAsset
    })(request);
    expect(result.status).toBe(expectedStatus);
    expect(resolveFontAsset).not.toHaveBeenCalled();
  });

  it("returns a path-free not-found response for absent and failed assets", async () => {
    const absent = await createAppearanceFontProtocolHandler({
      resolveFontAsset: vi.fn(async () => null)
    })(new Request(`deepwrite-font://asset/${fontId}`));
    expect(absent.status).toBe(404);
    expect(await absent.text()).toBe("");

    const failed = await createAppearanceFontProtocolHandler({
      resolveFontAsset: vi.fn(async () => {
        throw new Error("/private/secret/font.ttf");
      })
    })(new Request(`deepwrite-font://asset/${fontId}`));
    expect(failed.status).toBe(404);
    expect(await failed.text()).not.toContain("secret");
  });
});
