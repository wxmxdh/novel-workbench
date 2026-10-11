import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorkbenchServer } from "./server";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function setup(request: (input: unknown) => Promise<unknown>) {
  const directory = await mkdtemp(join(tmpdir(), "workbench-server-test-"));
  const service = { setEndpointFile: vi.fn(), request: vi.fn(request) };
  const server = await startWorkbenchServer(directory, service as never);
  cleanups.push(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const endpoint = JSON.parse(await readFile(server.endpointFile, "utf8")) as {
    url: string;
    token: string;
  };
  return { endpoint, endpointFile: server.endpointFile, service };
}

describe("workbench local HTTP server", () => {
  it("exposes the local bridge through the shipped stdio MCP client without revealing its bearer token", async () => {
    const { endpoint, endpointFile, service } = await setup(async () => ({
      kind: "capabilities",
      books: [],
      models: [],
      maxConcurrent: 3
    }));
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "tools/novel-workbench-client.mjs",
          "--mcp",
          "--endpoint-file",
          endpointFile
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (part) => {
        stdout += part.toString();
      });
      child.stderr.on("data", (part) => {
        stderr += part.toString();
      });
      child.once("error", reject);
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("MCP client timed out"));
      }, 8000);
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(stderr || "MCP client failed"));
        else resolve(stdout);
      });
      child.stdin.end(
        [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2024-11-05" }
          },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "novel_workbench_request",
              arguments: { operation: "capabilities" }
            }
          }
        ]
          .map((message) => JSON.stringify(message))
          .join("\n") + "\n"
      );
    });
    expect(output).not.toContain(endpoint.token);
    const replies = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(replies[0].result.serverInfo.name).toBe("novel-workbench");
    expect(replies[1].result.tools[0].name).toBe("novel_workbench_request");
    expect(JSON.parse(replies[2].result.content[0].text).kind).toBe(
      "capabilities"
    );
    expect(service.request).toHaveBeenCalledTimes(1);
  });
  it("requires bearer auth, rejects browser origins, and routes authorized requests", async () => {
    const { endpoint, service } = await setup(async () => ({
      kind: "capabilities"
    }));
    const missing = await fetch(endpoint.url, {
      method: "POST",
      body: JSON.stringify({ operation: "capabilities" })
    });
    expect(missing.status).toBe(403);
    expect(await missing.text()).not.toContain(endpoint.token);
    const browser = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        origin: "https://attacker.example"
      },
      body: JSON.stringify({ operation: "capabilities" })
    });
    expect(browser.status).toBe(403);
    const allowed = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ operation: "capabilities" })
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ kind: "capabilities" });
    expect(service.request).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized bodies and does not return provider credentials in errors", async () => {
    const { endpoint } = await setup(async (input) => {
      if ((input as { operation?: string }).operation === "get")
        throw new Error("Invalid API key: sk-proj-secretcredentialvalue");
      if ((input as { operation?: string }).operation === "saveCandidate")
        throw new Error(
          "Provider rejected the API key configured for this model"
        );
      return { kind: "capabilities" };
    });
    const headers = {
      authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json"
    };
    const oversized = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: "x".repeat(128 * 1024 + 1)
    });
    expect(oversized.status).toBe(400);
    const credentialError = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operation: "get",
        taskId: "task_test",
        bookId: "longbook_test"
      })
    });
    expect(credentialError.status).toBe(400);
    const body = await credentialError.text();
    expect(body).not.toContain("sk-proj-secretcredentialvalue");
    expect(body).toContain("请检查工作台内的任务记录");
    const authPhrase = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operation: "saveCandidate",
        taskId: "task_test",
        bookId: "longbook_test"
      })
    });
    expect(await authPhrase.text()).toContain("请检查工作台内的任务记录");
  });
});
