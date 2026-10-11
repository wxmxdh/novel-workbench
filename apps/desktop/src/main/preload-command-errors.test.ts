import { afterEach, describe, expect, it, vi } from "vitest";
import { ipcRenderer } from "electron";
import { createEnvelope } from "@deepwrite/contracts";
import { invokeCommand } from "../preload/invoke";

vi.mock("electron", () => ({ ipcRenderer: { invoke: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe("validated preload command failures", () => {
  it.each(["request_1", "unknown"])(
    "preserves structured rejection data with result ID %s",
    async (requestId) => {
      const error = {
        code: "catalog.conflict",
        message: "original diagnostic",
        details: { expectedRevision: "before", actualRevision: "after" }
      };
      vi.mocked(ipcRenderer.invoke).mockResolvedValue({
        status: "rejected",
        requestId,
        error
      });
      await expect(
        invokeCommand(createEnvelope("system.health", {}, { id: "request_1" }))
      ).rejects.toEqual(error);
    }
  );

  it("still rejects a successful response with the wrong request ID", async () => {
    vi.mocked(ipcRenderer.invoke).mockResolvedValue({
      status: "accepted",
      requestId: "other_request",
      payload: {}
    });
    await expect(
      invokeCommand(createEnvelope("system.health", {}, { id: "request_1" }))
    ).rejects.toThrow("requestId does not match");
  });

  it("logs only command and boundary metadata for clone errors, then rethrows", async () => {
    const error = new DOMException(
      "An object could not be cloned.",
      "DataCloneError"
    );
    vi.mocked(ipcRenderer.invoke).mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      invokeCommand(createEnvelope("system.health", {}, { id: "request_1" }))
    ).rejects.toBe(error);

    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "DEEPWRITE_SERIALIZATION_FAILURE boundary=preload.ipcRenderer.invoke command=system.health error=DataCloneError"
    );
  });
});
