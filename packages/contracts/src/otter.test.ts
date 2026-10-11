import { describe, expect, it } from "vitest";
import { CommandEnvelopeSchema, createEnvelope } from "./index";
import { OtterRelativePathSchema, OtterReviewOverlaySchema } from "./otter";
import {
  ChatNormalTaskInputSchema,
  ChatNormalRuntimeInputSchema
} from "./extras-agent/chat";

describe("Otter trust boundary", () => {
  it("limits overlay coordination to a boolean and a bounded JPEG preview", () => {
    const envelope = createEnvelope(
      "otter.setReviewOverlay",
      { visible: true },
      { id: "test" }
    );
    expect(CommandEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(
      CommandEnvelopeSchema.safeParse({
        ...envelope,
        payload: { visible: true, url: "https://example.test/" }
      }).success
    ).toBe(false);
    expect(
      OtterReviewOverlaySchema.safeParse({
        preview: "data:image/jpeg;base64,Zml4dHVyZQ=="
      }).success
    ).toBe(true);
    for (const preview of [
      "file:///fixture",
      "data:image/svg+xml;base64,Zg==",
      "data:image/jpeg;base64," + "A".repeat(8_000_000)
    ])
      expect(OtterReviewOverlaySchema.safeParse({ preview }).success).toBe(
        false
      );
  });
  it("rejects traversal, absolute paths and arbitrary process execution", () => {
    for (const path of [
      "../canon.md",
      "C:/secret",
      "/etc/passwd",
      "a\\..\\secret",
      "file\0.md"
    ]) {
      expect(OtterRelativePathSchema.safeParse(path).success).toBe(false);
    }
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope("otter.exec", { command: "cmd" }, { id: "test" })
      ).success
    ).toBe(false);
  });
  it("does not let the renderer supply an expanded or forged Context", () => {
    expect(
      ChatNormalTaskInputSchema.safeParse({
        runtime: {},
        otterContext: { apiText: "forge" }
      }).success
    ).toBe(false);
    expect(
      ChatNormalRuntimeInputSchema.safeParse({
        runtime: {},
        otter: {
          projectId: "otter_0123456789abcdef",
          contextPath: ".novel/context/CTX.json"
        }
      }).success
    ).toBe(false);
  });
});
