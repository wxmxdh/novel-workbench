import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DeviceSyncInitializationReceiptSchema,
  stableSyncJson
} from "@deepwrite/contracts";
import { syncRegistrations } from "./device-sync-inventory";
import { readDeviceSyncFiles } from "./device-sync-files";

export const INITIALIZATION_RECEIPT = "device-sync-initialization-receipt.json";
export const INITIALIZATION_REGISTRIES = [
  "catalog-registry.json",
  "catalog-registry.json.bak",
  "long-project-registry.json",
  "long-project-registry.json.bak"
] as const;

export async function optionalInitializationFile(
  path: string
): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}

/** Inspect bytes without requiring old project manifests to satisfy today's schema. */
export async function inspectDesktopInitialization(userDataPath: string) {
  const hash = createHash("sha256");
  for (const path of INITIALIZATION_REGISTRIES) {
    hash.update(
      stableSyncJson([
        path,
        await optionalInitializationFile(join(userDataPath, path))
      ])
    );
  }
  const entries = await syncRegistrations(userDataPath);
  for (const entry of entries.sort((a, b) => a.root.localeCompare(b.root))) {
    hash.update(stableSyncJson(entry));
    try {
      hash.update(stableSyncJson(await readDeviceSyncFiles(entry.root)));
    } catch (error) {
      // An inaccessible root is exactly the case this workflow repairs. It is
      // never removed or overwritten; retain a stable marker for rechecking.
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unreadable";
      hash.update(code);
      try {
        const stat = await lstat(entry.root);
        hash.update(stableSyncJson([stat.ino, stat.size, stat.mtimeMs]));
      } catch {
        hash.update("unavailable");
      }
    }
  }
  const receipt = await optionalInitializationFile(
    join(userDataPath, INITIALIZATION_RECEIPT)
  );
  return {
    fingerprint: hash.digest("hex"),
    itemCount: entries.length,
    lastToken: receipt
      ? DeviceSyncInitializationReceiptSchema.parse(JSON.parse(receipt)).token
      : null
  };
}
