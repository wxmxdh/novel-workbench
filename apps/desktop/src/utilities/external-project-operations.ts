import { resolve } from "node:path";

const projectQueues = new Map<string, Promise<void>>();

function pathKey(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/u, "");
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

/** Serialize Core-side candidate publication with external-book retirement. */
export async function withExternalProjectLock<Result>(
  projectDirectory: string,
  task: () => Promise<Result>
): Promise<Result> {
  const key = pathKey(projectDirectory);
  const previous = projectQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });
  projectQueues.set(key, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (projectQueues.get(key) === current) projectQueues.delete(key);
  }
}
