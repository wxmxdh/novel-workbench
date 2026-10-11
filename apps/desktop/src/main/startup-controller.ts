import type { StartupLog } from "./startup-log";

export type StartupPhase =
  | "runtime"
  | "services"
  | "workspace"
  | "appearance"
  | "settings"
  | "utilities"
  | "window";

export function createStartupController(
  log: StartupLog,
  onFailure: (phase: StartupPhase, error: unknown) => void
) {
  let phase: StartupPhase = "runtime";
  let failed = false;
  const fail = (error: unknown, failedPhase = phase): void => {
    if (failed) return;
    failed = true;
    log.write(`${failedPhase}.failed`, { error });
    onFailure(failedPhase, error);
  };
  return {
    log,
    fail,
    async step<T>(
      next: StartupPhase,
      action: () => T | Promise<T>
    ): Promise<T> {
      phase = next;
      log.write(`${phase}.begin`);
      const result = await action();
      log.write(`${next}.completed`);
      return result;
    },
    async run(action: () => Promise<void>): Promise<void> {
      try {
        await action();
      } catch (error) {
        fail(error);
      }
    }
  };
}
