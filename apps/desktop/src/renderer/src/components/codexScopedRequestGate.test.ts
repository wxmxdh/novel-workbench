import { describe, expect, it } from "vitest";
import { CodexScopedRequestGate } from "./codexScopedRequestGate";

describe("CodexScopedRequestGate", () => {
  it("allows only one pending session creation at a time", () => {
    const gate = new CodexScopedRequestGate();
    const first = gate.begin("book-a:prepared-a");
    expect(first).toBeDefined();
    expect(gate.begin("book-a:prepared-a")).toBeUndefined();
    gate.finish(first!);
    expect(gate.begin("book-a:prepared-a")).toBeDefined();
  });

  it("invalidates late async results when work scope changes", () => {
    const gate = new CodexScopedRequestGate();
    const token = gate.begin("book-a:prepared-a")!;
    expect(gate.isCurrent(token, "book-a:prepared-a")).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(token, "book-a:prepared-a")).toBe(false);
    expect(gate.isCurrent(token, "book-b:prepared-b")).toBe(false);
  });
});
