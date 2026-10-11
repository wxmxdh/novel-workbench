import { describe, expect, it, vi } from "vitest";
import { createStartupController } from "./startup-controller";

describe("desktop startup controller", () => {
  it("handles a configuration read rejection before creating any window", async () => {
    const log = { path: "/test/startup.log", write: vi.fn() };
    const failure = vi.fn();
    const createWindow = vi.fn();
    const startup = createStartupController(log, failure);
    const error = Object.assign(new Error("test configuration read failure"), {
      code: "EISDIR"
    });
    await expect(
      startup.run(async () => {
        await startup.step("workspace", async () => {
          throw error;
        });
        await startup.step("window", createWindow);
      })
    ).resolves.toBeUndefined();
    expect(createWindow).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledExactlyOnceWith("workspace", error);
    expect(log.write).toHaveBeenCalledWith("workspace.failed", { error });
  });

  it("also handles synchronous construction errors and readiness failures", async () => {
    for (const phase of ["runtime", "services"] as const) {
      const failure = vi.fn();
      const startup = createStartupController(
        { path: "/test/startup.log", write: vi.fn() },
        failure
      );
      const error = new Error("test startup failure");
      await startup.run(async () => {
        if (phase === "runtime") throw error;
        await startup.step(phase, () => {
          throw error;
        });
      });
      expect(failure).toHaveBeenCalledWith(phase, error);
    }
  });

  it("does not duplicate failure UI when multiple startup events fail", () => {
    const failure = vi.fn();
    const startup = createStartupController(
      { path: "/test/startup.log", write: vi.fn() },
      failure
    );
    startup.fail(new Error("test preload failure"), "window");
    startup.fail(new Error("test load failure"), "window");
    expect(failure).toHaveBeenCalledOnce();
  });
});
