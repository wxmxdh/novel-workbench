import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  copyFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Snapshot only the explicitly installed workspace skill. This script has no
// network access and never executes files from a skill package.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = process.argv[2];
if (!skillsRoot)
  throw new Error(
    "Usage: node tools/sync-review-skills.mjs <workspace-skills-root>"
  );
const archive = resolve(repo, "../../我的小说工作台/审核技能/来源");
const sourceId = "shuorenhua";
const sourceRevision = "e7c2b8670bd3e1988bfec199e861cebd87fc5e9c";
const sourceUrl = `https://github.com/MrGeDiao/shuorenhua/tree/${sourceRevision}`;
const retiredIds = ["humanizer-zh", "human-writing", "sepia"];
const runtimeFiles = [
  "LICENSE",
  "SKILL.md",
  "references/editing-guide.md",
  "references/examples.md"
];
async function collectMarkdown(root, prefix = "references") {
  let files = [];
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = `${prefix}/${item.name}`;
    if (item.isDirectory()) files = files.concat(await collectMarkdown(root, relative));
    else if (item.isFile() && relative.endsWith(".md")) files.push(relative);
  }
  return files.sort();
}
const source = resolve(skillsRoot, sourceId);
const previousBundlePath = join(
  repo,
  "packages/pi-runtime-adapter/src/review-skills/bundle.json"
);
const previousBundle = JSON.parse(await readFile(previousBundlePath, "utf8"));
const bundle = {};
for (const id of retiredIds) {
  if (!previousBundle[id]) throw new Error(`Missing preserved archived snapshot: ${id}`);
  bundle[id] = previousBundle[id];
}
const files = {};
const hashes = {};
for (const relative of runtimeFiles) {
  const bytes = await readFile(join(source, relative));
  files[relative] = bytes.toString("utf8");
  hashes[relative] = createHash("sha256").update(bytes).digest("hex");
  const destination = join(archive, sourceId, relative);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(source, relative), destination);
}
for (const relative of await collectMarkdown(source)) {
  if (files[relative]) continue;
  const bytes = await readFile(join(source, relative));
  files[relative] = bytes.toString("utf8");
  hashes[relative] = createHash("sha256").update(bytes).digest("hex");
  const destination = join(archive, sourceId, relative);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(source, relative), destination);
}
if (!files["SKILL.md"]) throw new Error(`Missing SKILL.md: ${sourceId}`);
bundle[sourceId] = {
  revision: sourceRevision,
  source: sourceUrl,
  hashes,
  files
};
await writeFile(previousBundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
await writeFile(
  join(repo, "apps/desktop/src/main/shuorenhua-skill-snapshot.json"),
  `${JSON.stringify(bundle[sourceId], null, 2)}\n`
);

const manifestPath = join(archive, "manifest.json");
const previousManifest = JSON.parse(await readFile(manifestPath, "utf8"));
previousManifest[sourceId] = {
  revision: sourceRevision,
  source: sourceUrl,
  license: "MIT",
  defaultEnabled: true,
  hashes
};
for (const id of retiredIds) {
  if (previousManifest[id]) previousManifest[id].defaultEnabled = false;
}
await writeFile(manifestPath, `${JSON.stringify(previousManifest, null, 2)}\n`);
await writeFile(
  join(archive, "runtime-policy.json"),
  `${JSON.stringify(
    {
      defaultEnabledIds: [sourceId],
      archivedIds: retiredIds,
      note: "旧技能来源档案保留；只有显式选择时才进入审核运行请求。"
    },
    null,
    2
  )}\n`
);
console.log(
  JSON.stringify({
    archive,
    bundle: previousBundlePath,
    activeDefault: sourceId,
    archived: retiredIds,
    files: Object.keys(files)
  })
);
