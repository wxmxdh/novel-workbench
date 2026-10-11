import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32")
  throw new Error("This native window close regression requires Windows.");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDir, "..");
const repository = resolve(appDirectory, "../..");
const sourceWorkspace = resolve(repository, "../..");
const reportDirectory = resolve(
  sourceWorkspace,
  "06_脚本工具/桌面融合_20261001/audit-env"
);
const executableArg = process.argv.indexOf("--executable");
const packaged = executableArg >= 0;
const defaultProfile = process.argv.includes("--default-profile");
if (defaultProfile && !packaged)
  throw new Error("--default-profile requires --executable.");
const executable = packaged
  ? resolve(process.argv[executableArg + 1] ?? "")
  : resolve(repository, "node_modules/electron/dist/electron.exe");
const timeoutMs = Number(
  process.env.DEEPWRITE_NATIVE_CLOSE_TIMEOUT_MS ?? 90_000
);
const profile = defaultProfile
  ? join(process.env.APPDATA ?? "", "Otter Novel Workbench")
  : await mkdtemp(join(tmpdir(), "otter-native-window-close-"));
if (defaultProfile) {
  if (!process.env.APPDATA)
    throw new Error(
      "APPDATA is unavailable; cannot verify the default profile."
    );
  try {
    await stat(profile);
    throw new Error(
      `Default profile already exists; refusing to touch it: ${profile}`
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  await mkdir(profile, { recursive: true });
}
const workspace = join(profile, "workspace");
const configDirectory = join(profile, "config");
await mkdir(workspace, { recursive: true });
await mkdir(configDirectory, { recursive: true });
await writeFile(
  join(configDirectory, "workspace-directory.json"),
  JSON.stringify({ version: 1, path: workspace })
);
await writeFile(
  join(configDirectory, "general-settings.json"),
  JSON.stringify(
    {
      version: 2,
      permissionMode: "auto-approve",
      autoApproveCrossStageOperations: true,
      autoSave: true,
      language: "zh-CN",
      showInMenuBar: true,
      showContextUsage: true,
      useNetworkProxy: false,
      workspacePaneLayout: "agent-editor",
      defaultTextViewMode: "edit",
      bodyTextFormats: {
        body: { fontFamily: "system", fontSize: 16, lineHeight: 1.8 },
        heading: { fontFamily: "system", fontSize: 24, lineHeight: 1.4 }
      }
    },
    null,
    2
  )
);
const nativeWindowApiPath = join(profile, "otter-window-api.cs");
await writeFile(
  nativeWindowApiPath,
  `using System;\nusing System.Text;\nusing System.Runtime.InteropServices;\npublic static class OtterNativeWindowApi {\n  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);\n  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);\n  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);\n  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);\n  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);\n  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);\n}\n`
);
await access(executable);
await mkdir(reportDirectory, { recursive: true });

const powershell = promisify(execFile);
const closeOwnedMainWindow = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$pidToClose = [int]$env:OTTER_CLOSE_TARGET_PID
Add-Type -Path $env:OTTER_NATIVE_WINDOW_API_PATH
$windows = [System.Collections.Generic.List[long]]::new()
[OtterNativeWindowApi]::EnumWindows({ param($hwnd, $lParam)
  [uint32]$owner = 0
  [void][OtterNativeWindowApi]::GetWindowThreadProcessId($hwnd, [ref]$owner)
  $className = [System.Text.StringBuilder]::new(256)
  [void][OtterNativeWindowApi]::GetClassName($hwnd, $className, $className.Capacity)
  if ($owner -eq $pidToClose -and [OtterNativeWindowApi]::IsWindowVisible($hwnd) -and $className.ToString() -eq 'Chrome_WidgetWin_1') {
    $windows.Add($hwnd.ToInt64())
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($windows.Count -ne 1) {
  [pscustomobject]@{ count = $windows.Count; handles = @($windows) } | ConvertTo-Json -Compress
  exit 21
}
$posted = [OtterNativeWindowApi]::PostMessage([IntPtr]$windows[0], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
[pscustomobject]@{ count = $windows.Count; handle = $windows[0]; posted = $posted; targetPid = $pidToClose } | ConvertTo-Json -Compress
if (-not $posted) { exit 22 }
`;

function childArguments() {
  return [
    ...(packaged ? [] : ["."]),
    ...(defaultProfile ? [] : [`--user-data-dir=${profile}`])
  ];
}

function spawnApp(label) {
  const environment = { ...process.env };
  delete environment.DEEPWRITE_SMOKE;
  delete environment.DEEPWRITE_SMOKE_SUITE;
  const child = spawn(executable, childArguments(), {
    cwd: appDirectory,
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: environment
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  return { child, exited, getOutput: () => output, label };
}

async function listOwnedWindows(child) {
  if (!child.pid) return [];
  const source = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$pidToFind = [int]$env:OTTER_CLOSE_TARGET_PID
Add-Type -Path $env:OTTER_NATIVE_WINDOW_API_PATH
$windows = [System.Collections.Generic.List[object]]::new()
[OtterNativeWindowApi]::EnumWindows({ param($hwnd, $lParam)
  [uint32]$owner = 0
  [void][OtterNativeWindowApi]::GetWindowThreadProcessId($hwnd, [ref]$owner)
  $className = [System.Text.StringBuilder]::new(256)
  [void][OtterNativeWindowApi]::GetClassName($hwnd, $className, $className.Capacity)
  if ($owner -eq $pidToFind -and [OtterNativeWindowApi]::IsWindowVisible($hwnd) -and $className.ToString() -eq 'Chrome_WidgetWin_1') {
    $windows.Add([pscustomobject]@{ pid = $owner; handle = $hwnd.ToInt64(); className = $className.ToString() })
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
ConvertTo-Json -InputObject @($windows) -Compress
`;
  const { stdout } = await powershell(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(source, "utf16le").toString("base64")
    ],
    {
      windowsHide: true,
      timeout: 10_000,
      env: {
        ...process.env,
        OTTER_CLOSE_TARGET_PID: String(child.pid),
        OTTER_NATIVE_WINDOW_API_PATH: nativeWindowApiPath
      }
    }
  );
  const parsed = JSON.parse(stdout.trim());
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

async function waitForWindows(child, expected, label) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `${label} exited before window was ready: ${child.exitCode}`
      );
    last = await listOwnedWindows(child);
    if (last.length === expected) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error(
    `${label} did not reach ${expected} visible main window(s); found ${last.length}.`
  );
}

async function postNativeClose(child) {
  const { stdout } = await powershell(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(closeOwnedMainWindow, "utf16le").toString("base64")
    ],
    {
      windowsHide: true,
      timeout: 15_000,
      env: {
        ...process.env,
        OTTER_CLOSE_TARGET_PID: String(child.pid),
        OTTER_NATIVE_WINDOW_API_PATH: nativeWindowApiPath
      }
    }
  );
  return JSON.parse(stdout.trim());
}

function waitForExit(processHandle, timeout = timeoutMs) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(
      () =>
        rejectExit(new Error(`${processHandle.label} did not exit naturally.`)),
      timeout
    );
    processHandle.exited.then(
      (result) => {
        clearTimeout(timer);
        resolveExit(result);
      },
      (error) => {
        clearTimeout(timer);
        rejectExit(error);
      }
    );
  });
}

const first = spawnApp("first instance");
let second;
let preservedFailure = false;
try {
  const firstWindows = await waitForWindows(first.child, 1, "First instance");
  second = spawnApp("second instance");
  const secondExit = await waitForExit(second);
  assert.equal(
    secondExit.code,
    0,
    "Second same-profile launch should hand off and exit cleanly."
  );
  assert.equal(
    first.child.exitCode,
    null,
    "The first instance must remain alive after handoff."
  );
  const afterSecond = await listOwnedWindows(first.child);
  assert.equal(
    afterSecond.length,
    1,
    "Second launch must not create another main window."
  );
  assert.equal(afterSecond[0].handle, firstWindows[0].handle);

  const closeResult = await postNativeClose(first.child);
  assert.equal(closeResult.targetPid, first.child.pid);
  assert.equal(closeResult.count, 1);
  assert.equal(closeResult.posted, true);
  const firstExit = await waitForExit(first);
  assert.equal(
    firstExit.code,
    0,
    "WM_CLOSE must complete a normal saved shutdown."
  );
  assert.equal(
    first.child.signalCode,
    null,
    "The first instance must exit without a signal."
  );

  const result = {
    status: "PASS",
    packaged,
    defaultProfile,
    profile,
    settings: { showInMenuBar: true, autoSave: true },
    secondLaunch: {
      exitCode: secondExit.code,
      firstWindowCount: afterSecond.length
    },
    nativeClose: {
      method: "user32.PostMessage(WM_CLOSE)",
      ...closeResult,
      exitCode: firstExit.code
    },
    firstInstanceOutput: first.getOutput().slice(-3000),
    secondInstanceOutput: second.getOutput().slice(-1500)
  };
  const logPath = join(
    reportDirectory,
    defaultProfile
      ? "otter-packaged-default-profile-close.log"
      : packaged
        ? "otter-packaged-window-close.log"
        : "otter-native-window-close.log"
  );
  await writeFile(logPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        ...result,
        firstInstanceOutput: undefined,
        secondInstanceOutput: undefined,
        logPath
      },
      null,
      2
    )
  );
} catch (error) {
  preservedFailure = true;
  const result = {
    status: "FAIL",
    packaged,
    defaultProfile,
    profile,
    firstPid: first.child.pid,
    firstExitCode: first.child.exitCode,
    secondPid: second?.child.pid,
    secondExitCode: second?.child.exitCode,
    error: error instanceof Error ? error.message : String(error),
    firstInstanceOutput: first.getOutput().slice(-5000),
    secondInstanceOutput: second?.getOutput().slice(-2500)
  };
  const logPath = join(
    reportDirectory,
    defaultProfile
      ? "otter-packaged-default-profile-close.log"
      : packaged
        ? "otter-packaged-window-close.log"
        : "otter-native-window-close.log"
  );
  await writeFile(logPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(
    JSON.stringify(
      {
        ...result,
        firstInstanceOutput: undefined,
        secondInstanceOutput: undefined,
        logPath
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  // A failed scenario retains its profile and leaves any still-running test
  // process untouched so the failure can be inspected without forced exit.
  if (
    !preservedFailure &&
    first.child.exitCode !== null &&
    (!second || second.child.exitCode !== null)
  ) {
    // Keep logs useful while removing only this run's disposable profile.
    const resolvedProfile = await realpath(profile);
    const expectedProfile = resolve(profile);
    assert.equal(
      resolvedProfile.toLowerCase(),
      expectedProfile.toLowerCase(),
      "Refusing cleanup of a redirected test profile."
    );
    await rm(profile, { recursive: true, force: true });
  }
}
