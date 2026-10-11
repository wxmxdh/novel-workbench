import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultAppearanceSettings,
  type AppearanceCustomFont,
  type AppearanceCustomFontId,
  type AppearanceFontInstallResult,
  type AppearanceSettings,
  type DeepWriteApi
} from "@deepwrite/contracts/renderer";

const CUSTOM_FONT_ID = `font_${"a".repeat(64)}` as AppearanceCustomFontId;
const CUSTOM_FONT: AppearanceCustomFont = {
  id: CUSTOM_FONT_ID,
  displayName: "测试本地字体",
  format: "ttf",
  byteSize: 2_048,
  installedAt: "2026-08-24T00:00:00.000Z"
};

interface MockBrowserOptions {
  settings?: AppearanceSettings;
  catalog?: AppearanceCustomFont[];
  installResult?: AppearanceFontInstallResult;
  rejectFontLoad?: boolean;
  loadFontFace?: (family: string) => Promise<void>;
}

function installMockBrowser(options: MockBrowserOptions = {}) {
  const timeline: string[] = [];
  const settings = options.settings ?? createDefaultAppearanceSettings();
  const fallback = createDefaultAppearanceSettings();
  const save = vi.fn(async (next: AppearanceSettings) => ({
    persisted: true,
    settings: next
  }));
  const remove = vi.fn(async () => ({
    removed: true,
    catalog: { fonts: [] },
    appearance: { persisted: true, settings: fallback }
  }));
  const appearanceApi = {
    list: vi.fn(async () => {
      timeline.push("appearance.list");
      return { persisted: true, settings };
    }),
    save,
    fonts: {
      list: vi.fn(async () => {
        timeline.push("fonts.list");
        return { fonts: options.catalog ?? [CUSTOM_FONT] };
      }),
      install: vi.fn(
        async () => options.installResult ?? ({ status: "canceled" } as const)
      ),
      remove
    }
  };
  const localStorage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn()
  };
  const matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
  const styleValues = new Map<string, string>();
  const style = {
    colorScheme: "",
    setProperty: vi.fn((name: string, value: string) => {
      styleValues.set(name, value);
      if (name === "--ui-font" && value.includes("DeepWriteCustom_")) {
        timeline.push("css.custom-ui-font");
      }
    })
  };
  const fontSet = {
    add: vi.fn(() => {
      timeline.push("document.fonts.add");
    }),
    delete: vi.fn(() => true),
    load: vi.fn(async () => {
      timeline.push("document.fonts.load");
      return [];
    })
  };
  class MockFontFace {
    constructor(
      readonly family: string,
      readonly source: string
    ) {
      timeline.push("FontFace.create");
    }

    async load(): Promise<MockFontFace> {
      timeline.push("FontFace.load");
      if (options.rejectFontLoad) throw new Error("invalid font");
      await options.loadFontFace?.(this.family);
      return this;
    }
  }

  vi.stubGlobal("window", {
    deepwrite: { appearance: appearanceApi } as unknown as DeepWriteApi,
    localStorage,
    matchMedia
  });
  vi.stubGlobal("document", {
    documentElement: { dataset: {}, style },
    fonts: fontSet,
    createElement: vi.fn(() => ({})),
    querySelector: vi.fn(() => null)
  });
  vi.stubGlobal("FontFace", MockFontFace);
  return { appearanceApi, remove, save, styleValues, timeline };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("useAppearance custom fonts", () => {
  it("loads a persisted custom font before applying its CSS alias", async () => {
    const settings = {
      ...createDefaultAppearanceSettings(),
      uiFontFamily: CUSTOM_FONT_ID
    };
    const browser = installMockBrowser({ settings });
    const { useAppearance } = await import("./useAppearance");

    const appearance = useAppearance();
    await appearance.whenReady();

    expect(appearance.state.uiFontFamily).toBe(CUSTOM_FONT_ID);
    expect(browser.timeline.indexOf("appearance.list")).toBeGreaterThanOrEqual(
      0
    );
    expect(browser.timeline.indexOf("fonts.list")).toBeGreaterThanOrEqual(0);
    expect(browser.timeline.indexOf("FontFace.load")).toBeLessThan(
      browser.timeline.indexOf("document.fonts.load")
    );
    expect(browser.timeline.indexOf("document.fonts.load")).toBeLessThan(
      browser.timeline.indexOf("css.custom-ui-font")
    );
  });

  it("keeps the previous selection when a custom font cannot load", async () => {
    installMockBrowser({ rejectFontLoad: true });
    const { useAppearance } = await import("./useAppearance");
    const appearance = useAppearance();
    await appearance.whenReady();

    await expect(appearance.setUiFontFamily(CUSTOM_FONT_ID)).rejects.toThrow(
      "invalid font"
    );
    expect(appearance.state.uiFontFamily).toBe("system");
  });

  it("applies the fallback snapshot returned after removing an active font", async () => {
    const browser = installMockBrowser();
    const [{ useAppearance }, { useAppearanceFonts }] = await Promise.all([
      import("./useAppearance"),
      import("./useAppearanceFonts")
    ]);
    const appearance = useAppearance();
    const localFonts = useAppearanceFonts();
    await appearance.whenReady();
    await appearance.setUiFontFamily(CUSTOM_FONT_ID);
    await appearance.setEditorFontFamily(CUSTOM_FONT_ID);

    const result = await localFonts.remove(CUSTOM_FONT_ID);
    await appearance.applyDesktopSettings(result.appearance.settings);

    expect(browser.remove).toHaveBeenCalledWith(CUSTOM_FONT_ID);
    expect(appearance.state.uiFontFamily).toBe("system");
    expect(appearance.state.editorFontFamily).toBe("song");
  });

  it("does not let an older async selection overwrite the latest intent", async () => {
    let resolveLoad: (() => void) | undefined;
    installMockBrowser({
      loadFontFace: () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        })
    });
    const { useAppearance } = await import("./useAppearance");
    const appearance = useAppearance();
    await appearance.whenReady();

    const slowSelection = appearance.setUiFontFamily(CUSTOM_FONT_ID);
    await appearance.setUiFontFamily("system");
    resolveLoad?.();
    await slowSelection;

    expect(appearance.state.uiFontFamily).toBe("system");
  });

  it("keeps a newly installed font hidden until final loading succeeds", async () => {
    let resolveLoad: (() => void) | undefined;
    installMockBrowser({
      catalog: [],
      installResult: {
        status: "completed",
        catalog: { fonts: [CUSTOM_FONT] },
        installedIds: [CUSTOM_FONT_ID],
        duplicateIds: [],
        rejected: []
      },
      loadFontFace: () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        })
    });
    const { useAppearanceFonts } = await import("./useAppearanceFonts");
    const localFonts = useAppearanceFonts();
    await localFonts.whenReady();

    const installing = localFonts.install();
    for (let attempt = 0; attempt < 5 && !resolveLoad; attempt += 1) {
      await Promise.resolve();
    }
    expect(resolveLoad).toBeTypeOf("function");
    expect(localFonts.fonts.value).toEqual([]);

    resolveLoad?.();
    await installing;
    expect(localFonts.fonts.value.map((font) => font.id)).toEqual([
      CUSTOM_FONT_ID
    ]);
  });
});
