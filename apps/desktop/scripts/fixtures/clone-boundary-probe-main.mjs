import assert from "node:assert/strict";
import { app, BrowserWindow, ipcMain } from "electron";

const [, , url] = process.argv;
app.setPath("userData", process.env.DEEPWRITE_CLONE_PROBE_PROFILE);

async function main() {
  let window;
  try {
    await app.whenReady();
    let requests = 0;
    ipcMain.handle("deepwrite:command", (_event, command) => {
      requests += 1;
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          sessionId: command.payload.sessionId,
          runId: `synthetic-run-${requests}`,
          acceptedAt: new Date().toISOString(),
          runtime: {
            provider: "synthetic-provider",
            model: "synthetic-model",
            mode: "local-faux"
          }
        }
      };
    });
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: process.env.DEEPWRITE_CLONE_PROBE_PRELOAD
      }
    });
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error(event.message);
    });
    await window.loadURL(url);
    await window.webContents.executeJavaScript(
      "new Promise((resolve, reject) => { const deadline = Date.now() + 15000; const timer = setInterval(() => { if (window.runCloneBoundaryProbe) { clearInterval(timer); resolve(); } else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Fixture load timeout')); } }, 10); })"
    );
    const result = await window.webContents.executeJavaScript(
      "runCloneBoundaryProbe()"
    );
    assert.deepEqual(result, {
      restoreCheckpointIsPlain: true,
      submitCheckpointIsProxy: true,
      chatSessionId: "synthetic-session",
      workspaceSessionId: "synthetic-session"
    });
    assert.equal(requests, 2);
    console.log("DEEPWRITE_CLONE_BOUNDARY_PROBE_OK");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    app.exit(process.exitCode ?? 0);
  }
}

void main();
