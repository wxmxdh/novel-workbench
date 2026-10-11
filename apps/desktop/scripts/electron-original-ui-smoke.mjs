import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSmokeWorkspace } from "./smoke-workspace.mjs";
import { createOtterSmokeFixture } from "../../../scripts/otter-smoke-fixture.mjs";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(appDirectory, "../..");
const sourceWorkspace = resolve(repository, "../..");
const reportArgument = process.argv.indexOf("--report-directory");
const reportDirectory =
  reportArgument >= 0
    ? resolve(process.argv[reportArgument + 1])
    : resolve(
        sourceWorkspace,
        "06_脚本工具/桌面融合_20261001/audit-env/experience-fix-20261002"
      );
await mkdir(reportDirectory, { recursive: true });

const profile = await mkdtemp(join(tmpdir(), "deepwrite-original-ui-fixture-"));
await prepareSmokeWorkspace(profile);
const fixture = await createOtterSmokeFixture({ sourceWorkspace, profile });
fixture.screenshotDirectory = reportDirectory;
const fixturePath = join(profile, "original-ui-fixture.json");
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
const childResult = await new Promise((done, fail) => {
  const child = spawn(executable, args, {
    cwd: appDirectory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DEEPWRITE_SMOKE: "1",
      DEEPWRITE_SMOKE_SUITE: "original-ui",
      DEEPWRITE_ORIGINAL_UI_FIXTURE: fixturePath
    }
  });
  let output = "";
  let timedOut = false;
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  const timeout = setTimeout(() => {
    timedOut = true;
    console.error(
      JSON.stringify({
        status: "WAITING_AFTER_TIMEOUT",
        message:
          "Smoke child was not terminated; retaining profile and waiting for its normal close.",
        profile,
        log: join(reportDirectory, "original-ui-native-smoke.log")
      })
    );
  }, 120_000);
  child.on("error", (error) => {
    clearTimeout(timeout);
    fail(error);
  });
  child.on("close", (code, signal) => {
    clearTimeout(timeout);
    done({ code, signal, output, timedOut });
  });
});

const log = join(reportDirectory, "original-ui-native-smoke.log");
await writeFile(log, childResult.output);
const line = childResult.output
  .split(/\r?\n/)
  .find((value) => value.startsWith("DEEPWRITE_SMOKE_OK "));
if (
  childResult.code !== 0 ||
  !line ||
  childResult.output.includes("DEEPWRITE_SMOKE_FAIL")
) {
  console.error(childResult.output.slice(-12_000));
  console.error(
    JSON.stringify({
      status: "FAIL",
      code: childResult.code,
      signal: childResult.signal,
      timedOut: childResult.timedOut,
      profile,
      fixtureWorkspace: fixture.workspaceRoot,
      log
    })
  );
  process.exitCode = 1;
} else {
  const summary = JSON.parse(line.slice("DEEPWRITE_SMOKE_OK ".length));
  if (summary.health?.status !== "ok" || summary.integration?.status !== "ok")
    throw new Error("Invalid original UI smoke summary.");
  const report = {
    ...summary,
    isolatedProfile: profile,
    fixtureWorkspace: fixture.workspaceRoot,
    log
  };
  await writeFile(
    join(reportDirectory, "original-ui-native-smoke.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(JSON.stringify({ status: "PASS", packaged, ...report }, null, 2));
}
