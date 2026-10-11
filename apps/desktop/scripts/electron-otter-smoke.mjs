import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSmokeWorkspace } from "./smoke-workspace.mjs";
import { createOtterSmokeFixture } from "../../../scripts/otter-smoke-fixture.mjs";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(appDirectory, "../..");
const sourceWorkspace = resolve(repository, "../..");
const reportDirectory = resolve(
  sourceWorkspace,
  "06_脚本工具/桌面融合_20261001/audit-env"
);
const profile = await mkdtemp(join(tmpdir(), "otter-native-desktop-fixture-"));
await prepareSmokeWorkspace(profile);
const fixture = await createOtterSmokeFixture({ sourceWorkspace, profile });
fixture.taskInput = JSON.parse(await readFile(fixture.taskInput, "utf8"));
await mkdir(reportDirectory, { recursive: true });
fixture.screenshotPath = join(reportDirectory, "otter-native-review.png");
const fixturePath = join(profile, "otter-smoke.json");
await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
await writeFile(
  join(profile, "config", "otter-workspace.json"),
  JSON.stringify({ workspaceRoot: fixture.workspaceRoot })
);
const executableArg = process.argv.indexOf("--executable");
const packaged = executableArg >= 0;
const executable = packaged
  ? resolve(process.argv[executableArg + 1])
  : resolve(repository, "node_modules/electron/dist/electron.exe");
await access(executable);
const args = [...(packaged ? [] : ["."]), `--user-data-dir=${profile}`];
const result = await new Promise((done, fail) => {
  const child = spawn(executable, args, {
    cwd: appDirectory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DEEPWRITE_SMOKE: "1",
      DEEPWRITE_SMOKE_SUITE: "otter",
      DEEPWRITE_OTTER_SMOKE_FIXTURE: fixturePath
    }
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const timeout = setTimeout(() => {
    child.kill();
    fail(new Error("Native Otter desktop smoke timed out; fixture preserved."));
  }, 120_000);
  child.on("error", (error) => {
    clearTimeout(timeout);
    fail(error);
  });
  child.on("close", (code) => {
    clearTimeout(timeout);
    done({ code, output });
  });
});
const log = join(
  reportDirectory,
  packaged ? "otter-packaged-smoke.log" : "otter-native-smoke.log"
);
await writeFile(log, result.output);
const line = result.output
  .split(/\r?\n/)
  .find((value) => value.startsWith("DEEPWRITE_SMOKE_OK "));
if (result.code !== 0 || !line) {
  console.error(result.output.slice(-12_000));
  console.error(
    JSON.stringify({ status: "FAIL", log, profile, code: result.code })
  );
  process.exitCode = 1;
} else {
  const summary = JSON.parse(line.slice("DEEPWRITE_SMOKE_OK ".length));
  if (summary.integration?.status !== "ok" || summary.health?.status !== "ok")
    throw new Error("Invalid native smoke summary.");
  await writeFile(
    join(
      reportDirectory,
      packaged ? "otter-packaged-smoke.json" : "otter-native-smoke.json"
    ),
    JSON.stringify({ ...summary, fixtureProfile: profile, log }, null, 2)
  );
  console.log(
    JSON.stringify({ status: "PASS", packaged, profile, log, summary }, null, 2)
  );
}
