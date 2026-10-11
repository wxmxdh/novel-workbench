import { describe, expect, it, vi } from "vitest";
import type {
  AppearanceCustomFont,
  AppearanceCustomFontId
} from "@deepwrite/contracts/renderer";
import {
  AppearanceFontRuntime,
  type AppearanceFontRuntimeDependencies
} from "./appearanceFontRuntime";

function font(hex = "a"): AppearanceCustomFont {
  return {
    id: `font_${hex.repeat(64)}` as AppearanceCustomFontId,
    displayName: `测试字体 ${hex}`,
    format: "ttf",
    byteSize: 1_024,
    installedAt: "2026-08-24T00:00:00.000Z"
  };
}

function createHarness(
  loadFace: () => Promise<unknown> = vi.fn(async () => undefined)
) {
  const face = { load: loadFace };
  const dependencies: AppearanceFontRuntimeDependencies = {
    createFontFace: vi.fn(() => face),
    addFontFace: vi.fn(),
    deleteFontFace: vi.fn(),
    loadFontFamily: vi.fn(async () => undefined)
  };
  return {
    face,
    dependencies,
    runtime: new AppearanceFontRuntime(dependencies)
  };
}

describe("AppearanceFontRuntime", () => {
  it("registers catalog fonts under an internal family and protocol URL", () => {
    const harness = createHarness();
    const customFont = font();

    harness.runtime.synchronize([customFont]);

    expect(harness.dependencies.createFontFace).toHaveBeenCalledWith(
      `DeepWriteCustom_${"a".repeat(64)}`,
      `url("deepwrite-font://asset/${customFont.id}") format("truetype")`
    );
    expect(harness.dependencies.addFontFace).toHaveBeenCalledWith(harness.face);
    expect(harness.runtime.isRegistered(customFont.id)).toBe(true);
  });

  it("single-flights FontFace and document.fonts loading", async () => {
    let resolveLoad: (() => void) | undefined;
    const loadFace = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const harness = createHarness(loadFace);
    const customFont = font("b");
    harness.runtime.synchronize([customFont]);

    const first = harness.runtime.load(customFont.id);
    const second = harness.runtime.load(customFont.id);
    expect(loadFace).toHaveBeenCalledOnce();

    resolveLoad?.();
    await Promise.all([first, second]);

    expect(harness.dependencies.loadFontFamily).toHaveBeenCalledOnce();
    expect(harness.dependencies.loadFontFamily).toHaveBeenCalledWith(
      `1em "DeepWriteCustom_${"b".repeat(64)}"`,
      "DeepWrite 深度写作"
    );
    expect(harness.runtime.isLoaded(customFont.id)).toBe(true);
    await harness.runtime.load(customFont.id);
    expect(loadFace).toHaveBeenCalledOnce();
  });

  it("unregisters faces that disappear from the persisted catalog", async () => {
    const harness = createHarness();
    const customFont = font("c");
    harness.runtime.synchronize([customFont]);
    await harness.runtime.load(customFont.id);

    harness.runtime.synchronize([]);

    expect(harness.dependencies.deleteFontFace).toHaveBeenCalledWith(
      harness.face
    );
    expect(harness.runtime.isRegistered(customFont.id)).toBe(false);
    expect(harness.runtime.isLoaded(customFont.id)).toBe(false);
    await expect(harness.runtime.load(customFont.id)).rejects.toThrow(
      "Custom font is not registered"
    );
  });

  it("does not mark a rejected FontFace as loaded", async () => {
    const harness = createHarness(
      vi.fn(async () => {
        throw new Error("invalid font");
      })
    );
    const customFont = font("d");
    harness.runtime.synchronize([customFont]);

    await expect(harness.runtime.load(customFont.id)).rejects.toThrow(
      "invalid font"
    );
    expect(harness.runtime.isLoaded(customFont.id)).toBe(false);
    expect(harness.dependencies.loadFontFamily).not.toHaveBeenCalled();
  });

  it("does not let an obsolete pending load mark a re-registered font loaded", async () => {
    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    const firstFace = {
      load: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          })
      )
    };
    const secondFace = {
      load: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = resolve;
          })
      )
    };
    const dependencies: AppearanceFontRuntimeDependencies = {
      createFontFace: vi
        .fn()
        .mockReturnValueOnce(firstFace)
        .mockReturnValueOnce(secondFace),
      addFontFace: vi.fn(),
      deleteFontFace: vi.fn(),
      loadFontFamily: vi.fn(async () => undefined)
    };
    const runtime = new AppearanceFontRuntime(dependencies);
    const customFont = font("e");
    runtime.synchronize([customFont]);
    const obsoleteLoad = runtime.load(customFont.id);

    runtime.synchronize([]);
    runtime.synchronize([customFont]);
    const currentLoad = runtime.load(customFont.id);
    const duplicateCurrentLoad = runtime.load(customFont.id);

    resolveFirst?.();
    await expect(obsoleteLoad).rejects.toThrow("registration changed");
    expect(runtime.isLoaded(customFont.id)).toBe(false);
    expect(secondFace.load).toHaveBeenCalledOnce();

    resolveSecond?.();
    await Promise.all([currentLoad, duplicateCurrentLoad]);
    expect(runtime.isLoaded(customFont.id)).toBe(true);
    expect(secondFace.load).toHaveBeenCalledOnce();
  });
});
