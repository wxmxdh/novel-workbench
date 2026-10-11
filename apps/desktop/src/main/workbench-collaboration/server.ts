import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { WorkbenchRequestSchema } from "@deepwrite/contracts";
import type { WorkbenchCollaborationService } from "./service";

/** Loopback only; browser origins are rejected even if they learn the port. */
export async function startWorkbenchServer(
  directory: string,
  service: WorkbenchCollaborationService
) {
  await mkdir(directory, { recursive: true });
  const token = randomBytes(32).toString("hex");
  const server: Server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const supplied = request.headers.authorization;
    const expected = `Bearer ${token}`;
    if (
      request.headers.origin ||
      typeof supplied !== "string" ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      response.writeHead(403);
      response.end(JSON.stringify({ error: "本地协作授权无效。" }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/request") {
      response.writeHead(404);
      response.end("{}");
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > 128 * 1024) throw new Error("协作请求过大。");
        chunks.push(buffer);
      }
      const input = WorkbenchRequestSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8"))
      );
      const result = await service.request(input);
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400);
      const message = error instanceof Error ? error.message : "协作请求失败。";
      const hasCredential =
        /\b(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+\S+)\b/iu.test(message) ||
        /\b(?:api[ _-]?key|token|secret|credential|authorization|unauthorized|authentication)\b/iu.test(
          message
        );
      response.end(
        JSON.stringify({
          error: hasCredential
            ? "协作请求失败，请检查工作台内的任务记录。"
            : message.slice(0, 500)
        })
      );
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("无法建立本地协作入口。");
  const endpointFile = join(directory, "endpoint.json");
  await writeFile(
    `${endpointFile}.tmp`,
    JSON.stringify({
      version: 1,
      url: `http://127.0.0.1:${address.port}/request`,
      token,
      pid: process.pid
    }),
    { encoding: "utf8", mode: 0o600 }
  );
  await rename(`${endpointFile}.tmp`, endpointFile);
  service.setEndpointFile(endpointFile);
  return {
    endpointFile,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await rm(endpointFile, { force: true });
    }
  };
}
