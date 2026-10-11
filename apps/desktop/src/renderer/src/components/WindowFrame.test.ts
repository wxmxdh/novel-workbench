import { describe, expect, it } from "vitest";
import ts from "typescript";
import windowFrameSource from "./WindowFrame.vue?raw";

const frameScript = windowFrameSource.match(
  /<script lang="ts">([\s\S]*?)<\/script>/
)?.[1];
if (!frameScript) throw new Error("Window frame revision guard is missing");
const frameModule = await import(
  `data:text/javascript;base64,${btoa(
    ts.transpileModule(frameScript, {
      compilerOptions: { module: ts.ModuleKind.ESNext }
    }).outputText
  )}`
);
const canApplyWindowFrameCommandResult =
  frameModule.canApplyWindowFrameCommandResult as (
    requestRevision: number,
    currentRevision: number,
    disposed: boolean
  ) => boolean;

describe("WindowFrame state result ordering", () => {
  it("allows a command result until a newer subscribed state arrives", () => {
    let stateRevision = 0;
    const requestRevision = stateRevision;

    expect(
      canApplyWindowFrameCommandResult(requestRevision, stateRevision, false)
    ).toBe(true);

    stateRevision += 1;

    expect(
      canApplyWindowFrameCommandResult(requestRevision, stateRevision, false)
    ).toBe(false);
  });

  it("rejects a response after the frame has been unmounted", () => {
    expect(canApplyWindowFrameCommandResult(2, 2, true)).toBe(false);
  });

  it("uses the revision guard for command replies and increments on state events", () => {
    expect(windowFrameSource).toMatch(
      /canApplyWindowFrameCommandResult\(\s*requestRevision,\s*stateRevision,\s*disposed\s*\)/
    );
    expect(windowFrameSource).toContain("stateRevision += 1;");
    expect(windowFrameSource).toContain("disposed = true;");
  });
});
