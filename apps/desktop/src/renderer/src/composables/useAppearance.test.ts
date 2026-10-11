import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import themeRuntimeSource from "./appearanceThemeRuntime.ts?raw";
import source from "./useAppearance.ts?raw";

describe("useAppearance", () => {
  it("persists appearance through the desktop config API", () => {
    expect(source).toContain("window.deepwrite?.appearance");
    expect(source).toContain("api.save(");
    expect(source).toContain("api.list()");
    expect(source).toContain('LEGACY_STORAGE_KEY = "deepwrite.appearance.v1"');
    expect(source).toContain("clearLegacyStorage()");
  });

  it("migrates legacy localStorage settings when disk config is missing", () => {
    expect(source).toContain("if (!snapshot.persisted)");
    expect(source).toContain("await api.save(normalized)");
    expect(source).toContain("hydrateFromDesktop");
  });

  it("applies selected font families to document CSS variables", () => {
    expectSourceToContain(
      themeRuntimeSource,
      'root.style.setProperty("--ui-font"'
    );
    expect(themeRuntimeSource).toContain('"--editor-font"');
    expect(themeRuntimeSource).toContain("resolveAppearanceUiFontStack(");
    expect(themeRuntimeSource).toContain("resolveAppearanceEditorFontStack(");
    expect(source).toContain("applyAppearanceThemeToDocument({");
    expect(source).toContain("setUiFontFamily");
    expect(source).toContain("setEditorFontFamily");
    expect(source).toContain("++uiFontSelectionIntent");
    expect(source).toContain("++editorFontSelectionIntent");
  });
});
