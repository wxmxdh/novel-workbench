import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const root = resolve(scripts, "../../..");
const require = createRequire(import.meta.url);
const preload = join(root, "apps/desktop/out/preload/index.js");
const profile = await mkdtemp(join(tmpdir(), "deepwrite-clone-probe-"));
const server = await createServer({
  root,
  configFile: false,
  plugins: [vue()],
  server: {
    port: 0,
    hmr: false,
    watch: { ignored: ["**/out/**", "**/.git/**"] }
  },
  resolve: {
    alias: [
      {
        find: "@deepwrite/contracts/renderer",
        replacement: resolve(root, "packages/contracts/src/renderer.ts")
      },
      {
        find: "@deepwrite/contracts",
        replacement: resolve(root, "packages/contracts/src/renderer.ts")
      }
    ]
  }
});

try {
  await server.listen();
  const url = new URL(
    "apps/desktop/scripts/fixtures/clone-boundary-probe.html",
    server.resolvedUrls.local[0]
  );
  const electron = spawn(
    require("electron"),
    [join(scripts, "fixtures/clone-boundary-probe-main.mjs"), url.href],
    {
      env: {
        ...process.env,
        DEEPWRITE_CLONE_PROBE_PROFILE: profile,
        DEEPWRITE_CLONE_PROBE_PRELOAD: preload
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  let output = "";
  electron.stdout.on("data", (chunk) => {
    output += chunk;
  });
  electron.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const timeout = setTimeout(() => electron.kill("SIGKILL"), 30_000);
  const exit = await new Promise((resolveExit, reject) => {
    electron.once("error", reject);
    electron.once("close", resolveExit);
  }).finally(() => clearTimeout(timeout));
  assert.equal(exit, 0, output);
  assert.ok(output.includes("DEEPWRITE_CLONE_BOUNDARY_PROBE_OK"), output);
  console.log(
    "Electron contextBridge accepted reactive conversation checkpoints on both send routes."
  );
} finally {
  await server.close();
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(basename(profile).startsWith("deepwrite-clone-probe-"));
  await rm(profile, { recursive: true, force: true });
}
