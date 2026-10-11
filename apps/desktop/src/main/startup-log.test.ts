import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStartupLog } from "./startup-log";

const directories: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), "deepwrite-startup-log-"));
  directories.push(path);
  return path;
}
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }))
);

describe("local startup diagnostics", () => {
  it("records safe error codes without copying exception messages, stacks or arbitrary fields", () => {
    const log = createStartupLog(directory());
    const error = Object.assign(
      new Error("https://example.test/?key=INVALID_TEST_CREDENTIAL"),
      { code: "EACCES", path: "/test/private-document" }
    );
    log.write("workspace.failed", { error });
    log.write("window.failed", {
      error: {
        code: "https://example.test/INVALID_TEST_CREDENTIAL",
        message: "test manuscript"
      }
    });
    log.write("renderer.gone", { reason: "crashed", exitCode: 3 });
    const text = readFileSync(log.path, "utf8");
    expect(text).toContain('"errorCode":"EACCES"');
    expect(text).not.toContain("https://");
    expect(text).not.toContain("INVALID_TEST_CREDENTIAL");
    expect(text).not.toContain("private-document");
    expect(text).not.toContain("test manuscript");
    expect(text).not.toContain('"stack"');
    expect(text).toContain('"reason":"crashed"');
  });

  it("records only stable serialization boundary metadata", () => {
    const log = createStartupLog(directory());
    log.write("serialization.clone_failed", {
      serializationFailure: {
        boundary: "main.utility.command.postMessage",
        worker: "agent",
        commandType: "session.prompt",
        errorName: "DataCloneError"
      }
    });
    const [entry] = readFileSync(log.path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(entry?.serializationFailure).toEqual({
      boundary: "main.utility.command.postMessage",
      worker: "agent",
      commandType: "session.prompt",
      errorName: "DataCloneError"
    });
  });

  it("rotates a large log while retaining one previous file", () => {
    const log = createStartupLog(directory());
    writeFileSync(log.path, "x".repeat(513 * 1024));
    writeFileSync(`${log.path}.previous`, "older test log");
    log.write("start");
    expect(readFileSync(`${log.path}.previous`, "utf8")).toHaveLength(
      513 * 1024
    );
    expect(readFileSync(log.path, "utf8")).toContain('"event":"start"');
  });

  it("never throws when the log directory is unusable", () => {
    const path = join(directory(), "file-not-directory");
    writeFileSync(path, "test");
    expect(() => createStartupLog(path).write("start")).not.toThrow();
  });
});
