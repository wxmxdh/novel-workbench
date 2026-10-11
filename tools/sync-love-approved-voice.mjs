import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL(
  "../../../00_创作项目/项目/LOVE/文风认可资料/v1.0/",
  import.meta.url
);
const manifestText = await readFile(new URL("manifest.json", root), "utf8");
const manifest = JSON.parse(manifestText);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const files = [
  {
    title: manifest.workbench_binding.manifest.title,
    sourcePath: manifest.workbench_binding.manifest.source_path,
    content: manifestText,
    sha256: hash(manifestText)
  }
];
for (const source of manifest.sources) {
  const content = await readFile(new URL(source.path, root), "utf8");
  if (hash(content) !== source.sha256.toLowerCase())
    throw new Error("认可资料hash不符 " + source.path);
  const binding = manifest.workbench_binding.documents.find(
    (doc) => doc.path === source.path
  );
  files.push({
    title: binding.title,
    sourcePath: binding.source_path,
    content,
    sha256: hash(content)
  });
}
await writeFile(
  new URL(
    "../apps/desktop/src/main/love-approved-voice-bundle.json",
    import.meta.url
  ),
  JSON.stringify(
    {
      bookId: manifest.workbench_binding.book_id,
      packageId: manifest.package_id,
      files
    },
    null,
    2
  ) + "\n"
);
console.log(
  JSON.stringify({
    packageId: manifest.package_id,
    files: files.map(({ title, sha256 }) => ({ title, sha256 }))
  })
);
