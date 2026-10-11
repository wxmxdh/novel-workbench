import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMPORT_PATTERN = /@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/;

function defaultStylesEntry() {
  return resolve(
    fileURLToPath(
      new URL("../apps/desktop/src/renderer/src/styles.css", import.meta.url)
    )
  );
}

export function resolveRendererStyles(entryPath = defaultStylesEntry()) {
  const seen = new Set();
  const stack = [];

  function resolveFile(filePath) {
    const normalized = resolve(filePath);
    if (stack.includes(normalized)) {
      throw new Error(
        `Circular @import in renderer styles: ${[...stack, normalized].join(" -> ")}`
      );
    }
    if (seen.has(normalized)) return "";
    seen.add(normalized);
    stack.push(normalized);

    const source = readFileSync(normalized, "utf8");
    const lines = source.split(/\r?\n/);
    const chunks = [];
    for (const line of lines) {
      const match = line.match(IMPORT_PATTERN);
      if (!match) {
        chunks.push(line);
        continue;
      }
      const imported = resolve(dirname(normalized), match[1]);
      const importedCss = resolveFile(imported);
      if (importedCss.length > 0) chunks.push(importedCss);
    }
    stack.pop();
    return chunks.join("\n");
  }

  const resolved = resolveFile(entryPath);
  return resolved.endsWith("\n") ? resolved : `${resolved}\n`;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("resolve-renderer-styles.mjs")
) {
  process.stdout.write(resolveRendererStyles());
}
