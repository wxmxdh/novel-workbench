import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSmokeWorkspace } from "./smoke-workspace.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repository = resolve(appDir, "../..");
function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
const profile = await mkdtemp(
  join(tmpdir(), "deepwrite-long-isolation-smoke-")
);
const hashFile = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
try {
  await prepareSmokeWorkspace(profile);
  const electron = resolve(
    option("--executable") ??
      resolve(repository, "node_modules/electron/dist/electron.exe")
  );
  const packaged = Boolean(option("--executable"));
  const asar = join(dirname(electron), "resources", "app.asar");
  const client = resolve(
    option("--client-path") ??
      resolve(repository, "tools/novel-workbench-client.mjs")
  );
  if (!packaged) await access(resolve(appDir, "out/main/index.js"));
  await access(electron);
  await access(client);

  const child = spawn(
    electron,
    [...(packaged ? [] : ["."]), `--user-data-dir=${profile}`],
    {
      cwd: appDir,
      windowsHide: true,
      env: {
        ...process.env,
        DEEPWRITE_SMOKE: "1",
        DEEPWRITE_SMOKE_SUITE: "long-conversation-isolation",
        DEEPWRITE_SMOKE_NODE: process.execPath,
        DEEPWRITE_SMOKE_CLIENT: client,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const exit = await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error("Long conversation isolation smoke exceeded 90 seconds.")
      );
    }, 90_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
  const marker = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("DEEPWRITE_SMOKE_OK "));
  if (exit.code !== 0 || !marker || output.includes("DEEPWRITE_SMOKE_FAIL")) {
    console.error(output.slice(-12000));
    throw new Error(
      `Long conversation isolation smoke failed (${String(exit.code)} ${String(exit.signal)}).`
    );
  }
  const summary = JSON.parse(marker.slice("DEEPWRITE_SMOKE_OK ".length));
  if (summary.health?.status !== "ok" || summary.isolation?.status !== "ok")
    throw new Error(`Invalid smoke summary: ${JSON.stringify(summary)}`);
  console.log(JSON.stringify(summary.isolation, null, 2));
  if (option("--report-directory")) {
    const runId = new Date().toISOString().replaceAll(/[:.]/gu, "-");
    const reportDirectory = join(resolve(option("--report-directory")), runId);
    await mkdir(reportDirectory, { recursive: true });
    await cp(profile, join(reportDirectory, "profile"), { recursive: true });
    const executableHash = await hashFile(electron);
    let asarMetadata = null;
    try {
      await access(asar);
      asarMetadata = { path: asar, sha256: await hashFile(asar) };
    } catch {
      // Development Electron has no app.asar; its executable hash still binds the receipt.
    }
    await writeFile(
      join(reportDirectory, "report.json"),
      `${JSON.stringify(
        {
          status: "ok",
          executable: { path: electron, sha256: executableHash },
          asar: asarMetadata,
          mcpClient: { path: client, sha256: await hashFile(client) },
          userData: {
            retainedProfile: join(reportDirectory, "profile"),
            isolated: true
          },
          workspace: {
            bookId: summary.isolation.bookId,
            synthetic: true,
            preparedSourceCount: summary.isolation.preparedSourceCount
          },
          modelTurnStarted: summary.isolation.modelTurnStarted,
          isolation: summary.isolation
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    console.log(`Report retained at ${reportDirectory}`);
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}
