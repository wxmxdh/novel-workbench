import { describe, expect, it } from "vitest";
import publicBundle from "./love-approved-voice-bundle";
import { bootstrapLoveApprovedMaterialLibrary } from "./love-approved-material-library-bootstrap";

describe.skip("private approved material package integration", () => {
  it.skip("installs and links the private package using native Core services");
  it.skip("preserves a conflicting native library title");
  it.skip("preserves a private package entry edited by its author");
});

describe("public repository approved material bootstrap", () => {
  it("skips before Core access when the private package is not distributed", async () => {
    let calls = 0;
    const result = await bootstrapLoveApprovedMaterialLibrary({
      workspaceDirectory: "unused-test-workspace",
      requestCore: async () => {
        calls += 1;
        throw new Error("Core must not be called without a private package");
      }
    });
    expect(publicBundle.files).toEqual([]);
    expect(result).toEqual({
      status: "skipped",
      reason: "package-not-included"
    });
    expect(calls).toBe(0);
  });
});
