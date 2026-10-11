import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Keep smoke-created projects inside the disposable profile, away from Documents. */
export async function prepareSmokeWorkspace(profile) {
  const workspace = join(profile, "workspace");
  await mkdir(workspace, { recursive: true });
  await mkdir(join(profile, "config"), { recursive: true });
  await writeFile(
    join(profile, "config", "workspace-directory.json"),
    JSON.stringify({ version: 1, path: workspace })
  );
}
