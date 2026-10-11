import { describe, expect, it } from "vitest";
import {
  AppearanceFontCatalogSnapshotSchema,
  AppearanceFontInstallResultSchema,
  AppearanceFontRemoveResultSchema,
  AppearanceSettingsSchema,
  CommandEnvelopeSchema,
  appearanceCustomFontCssFamily,
  appearanceCustomFontSourceUrl,
  createDefaultAppearanceSettings,
  createEnvelope,
  resolveAppearanceEditorFontStack,
  resolveAppearanceUiFontStack
} from "./index";

const fontId = `font_${"a".repeat(64)}`;
const font = {
  id: fontId,
  displayName: "示例字体 W03",
  format: "ttf" as const,
  byteSize: 4096,
  installedAt: "2026-08-24T00:00:00.000Z"
};

describe("appearance custom font contracts", () => {
  it("accepts custom font selections without changing legacy defaults", () => {
    const defaults = createDefaultAppearanceSettings();
    expect(defaults.uiFontFamily).toBe("system");
    expect(defaults.editorFontFamily).toBe("song");
    expect(
      AppearanceSettingsSchema.parse({
        mode: defaults.mode,
        light: defaults.light,
        dark: defaults.dark
      })
    ).toMatchObject({ uiFontFamily: "system", editorFontFamily: "song" });
    expect(
      AppearanceSettingsSchema.parse({
        ...defaults,
        uiFontFamily: fontId,
        editorFontFamily: fontId
      })
    ).toMatchObject({ uiFontFamily: fontId, editorFontFamily: fontId });
    expect(
      AppearanceSettingsSchema.safeParse({
        ...defaults,
        uiFontFamily: "font_not-a-hash"
      }).success
    ).toBe(false);
  });

  it("builds stable internal CSS aliases and resource URLs", () => {
    expect(appearanceCustomFontCssFamily(fontId)).toBe(
      `DeepWriteCustom_${"a".repeat(64)}`
    );
    expect(appearanceCustomFontSourceUrl(fontId)).toBe(
      `deepwrite-font://asset/${fontId}`
    );
    expect(resolveAppearanceUiFontStack(fontId)).toContain("DeepWriteCustom_");
    expect(resolveAppearanceEditorFontStack(fontId)).toContain(
      "DeepWriteCustom_"
    );
  });

  it("validates font catalog and mutation results", () => {
    const catalog = AppearanceFontCatalogSnapshotSchema.parse({
      fonts: [font]
    });
    expect(
      AppearanceFontInstallResultSchema.parse({
        status: "completed",
        catalog,
        installedIds: [fontId],
        duplicateIds: [],
        rejected: []
      })
    ).toMatchObject({ status: "completed", installedIds: [fontId] });
    expect(
      AppearanceFontRemoveResultSchema.parse({
        removed: true,
        catalog: { fonts: [] },
        appearance: {
          persisted: true,
          settings: createDefaultAppearanceSettings()
        }
      })
    ).toMatchObject({ removed: true });
  });

  it("adds validated list, install and remove command envelopes", () => {
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope("appearance.fonts.list", {}, { id: "fonts-list" })
      ).type
    ).toBe("appearance.fonts.list");
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope("appearance.fonts.install", {}, { id: "fonts-install" })
      ).type
    ).toBe("appearance.fonts.install");
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "appearance.fonts.remove",
          { id: fontId },
          { id: "fonts-remove" }
        )
      ).type
    ).toBe("appearance.fonts.remove");
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "appearance.fonts.remove",
          { id: "font_invalid" },
          { id: "fonts-remove-invalid" }
        )
      ).success
    ).toBe(false);
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "appearance.fonts.install",
          { sourcePath: "/private/example.ttf" },
          { id: "fonts-install-invalid" }
        )
      ).success
    ).toBe(false);
  });
});
