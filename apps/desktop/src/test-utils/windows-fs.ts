import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function directorySymlinkType(): "dir" | "junction" {
  return process.platform === "win32" ? "junction" : "dir";
}

/** Windows file symlinks require Developer Mode or an extra privilege. */
export async function canCreateFileSymlink(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const root = await mkdtemp(join(tmpdir(), "deepwrite-symlink-capability-"));
  const target = join(root, "target.txt");
  const link = join(root, "link.txt");
  try {
    await writeFile(target, "fixture", "utf8");
    await symlink(target, link, "file");
    return true;
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS")
      return false;
    throw error;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Apply a reversible read denial to one regular file in the OS temp directory. */
export async function denyCurrentUserReadAccess(
  path: string
): Promise<() => Promise<void>> {
  const absolutePath = resolve(path);
  const tempRoot = resolve(tmpdir());
  const offset = relative(tempRoot, absolutePath);
  const details = await lstat(absolutePath);
  if (
    !isAbsolute(absolutePath) ||
    offset === ".." ||
    offset.startsWith(`..${sep}`) ||
    details.isSymbolicLink() ||
    !details.isFile()
  ) {
    throw new Error(
      "Permission test fixtures must be regular files in tmpdir."
    );
  }

  if (process.platform !== "win32") {
    await chmod(absolutePath, 0);
    return async () => chmod(absolutePath, 0o600);
  }

  await execFileAsync(
    "icacls.exe",
    [absolutePath, "/deny", "*S-1-5-11:(RD)", "/q"],
    { windowsHide: true, encoding: "utf8" }
  );
  return async () => {
    await execFileAsync(
      "icacls.exe",
      [absolutePath, "/remove:d", "*S-1-5-11", "/q"],
      { windowsHide: true, encoding: "utf8" }
    );
  };
}
