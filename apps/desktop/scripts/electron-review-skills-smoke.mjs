import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { prepareSmokeWorkspace } from "./smoke-workspace.mjs";

const [executableArg, profileArg, reportArg] = process.argv.slice(2);
if (!executableArg || !profileArg || !reportArg)
  throw new Error(
    "Provide executable, disposable profile and report directory."
  );
const executable = resolve(executableArg);
const profile = resolve(profileArg);
const reports = resolve(reportArg);
const suite = process.argv[5] ?? "review-skills";
if (!["review-skills", "accumulation"].includes(suite))
  throw new Error("Unknown smoke suite");
await mkdir(reports, { recursive: true });
await prepareSmokeWorkspace(profile);
const summaries = [];
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const executableSha256 = await hash(executable);
const archivePath = join(resolve(executable, ".."), "resources", "app.asar");
const archiveSha256 = await hash(archivePath);
for (const stage of ["first", "reopened"]) {
  let output = "";
  const result = await new Promise((done, fail) => {
    const env = {
      ...process.env,
      DEEPWRITE_SMOKE: "1",
      DEEPWRITE_SMOKE_SUITE: suite,
      DEEPWRITE_REVIEW_SKILLS_SMOKE_ROOT: profile,
      DEEPWRITE_ACCUMULATION_SMOKE_ROOT: profile,
      DEEPWRITE_PLOT_OUTLINE_SMOKE_ROOT: profile
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      executable,
      [`--user-data-dir=${profile}`, "--password-store=basic"],
      {
        cwd: resolve(executable, ".."),
        windowsHide: true,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    // The timeout only terminates this explicitly created disposable child.
    const timeout = setTimeout(() => {
      child.kill();
    }, 90000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      fail(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      done({ code, signal });
    });
  });
  await writeFile(join(reports, `desktop-${stage}.log`), output);
  const marker = output
    .split(/\r?\n/u)
    .find((line) => line.startsWith("DEEPWRITE_SMOKE_OK "));
  if (result.code !== 0 || !marker)
    throw new Error(`Review skill desktop smoke failed (${stage}): ${output}`);
  const summary = JSON.parse(marker.slice("DEEPWRITE_SMOKE_OK ".length));
  if (
    (suite === "review-skills" &&
      (summary.reviewSkills?.status !== "ok" ||
        summary.reviewSkills.reopened !== (stage === "reopened"))) ||
    (suite === "accumulation" && summary.accumulation?.status !== "ok")
  )
    throw new Error("Unexpected desktop smoke summary");
  summaries.push({ stage, ...summary });
}
if (
  (await hash(executable)) !== executableSha256 ||
  (await hash(archivePath)) !== archiveSha256
)
  throw new Error("Executable package changed during acceptance");
await writeFile(
  join(reports, "desktop-smoke.json"),
  `${JSON.stringify({ executable, executableSha256, archiveSha256, suite, profile, summaries }, null, 2)}\n`
);
console.log(JSON.stringify({ status: "ok", runs: summaries.length, profile }));
