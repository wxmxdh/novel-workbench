import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import menuBarSource from "./WindowMenuBar.vue?raw";

const activationScript = menuBarSource.match(
  /<script lang="ts">([\s\S]*?)<\/script>/
)?.[1];
if (!activationScript) throw new Error("Menu activation helper is missing");
const activationModule = await import(
  `data:text/javascript;base64,${btoa(
    ts.transpileModule(activationScript, {
      compilerOptions: { module: ts.ModuleKind.ESNext }
    }).outputText
  )}`
);
const consumeInitialMenuActivation =
  activationModule.consumeInitialMenuActivation as (
    pending: boolean,
    consume: () => void,
    activate: () => void
  ) => boolean;

describe("WindowMenuBar initial activation", () => {
  it("consumes the queued activation once so a fullscreen remount stays closed", () => {
    let pending = true;
    const activate = vi.fn((index: number, open: boolean) => ({ index, open }));
    const mount = () =>
      consumeInitialMenuActivation(
        pending,
        () => {
          pending = false;
        },
        () => activate(0, true)
      );

    expect(mount()).toBe(true);
    expect(pending).toBe(false);
    expect(mount()).toBe(false);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(0, true);
    expect(menuBarSource).toContain("props.initialActivationPending");
    expect(menuBarSource).toContain('() => emit("initialActivationConsumed")');
  });

  it("keeps the requested focus-only activation on first mount", () => {
    let pending = true;
    const activate = vi.fn((index: number, open: boolean) => ({ index, open }));

    consumeInitialMenuActivation(
      pending,
      () => {
        pending = false;
      },
      () => activate(1, false)
    );

    expect(pending).toBe(false);
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(1, false);
  });

  it("does not consume or activate when no initial request is queued", () => {
    const consume = vi.fn();
    const activate = vi.fn();

    expect(consumeInitialMenuActivation(false, consume, activate)).toBe(false);
    expect(consume).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });
});
