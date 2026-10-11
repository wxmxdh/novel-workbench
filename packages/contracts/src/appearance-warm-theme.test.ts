import { describe, expect, it } from "vitest";
import { createDefaultAppearanceSettings } from "./appearance";
import {
  DEFAULT_WARM_VISUAL_TOKENS,
  createWarmVisualThemeTokens
} from "./appearance-warm-theme";

describe("warm visual appearance tokens", () => {
  it("uses the author-specified warm paper palette for the default light theme", () => {
    const settings = createDefaultAppearanceSettings();
    expect(createWarmVisualThemeTokens("light", settings.light)).toEqual(
      DEFAULT_WARM_VISUAL_TOKENS
    );
    expect(settings.light).toMatchObject({
      preset: "claude",
      accent: "#B85B44",
      background: "#F2EEE7",
      foreground: "#2D2924"
    });
  });

  it("derives semantic tokens from user-selected colors in light and dark modes", () => {
    const settings = createDefaultAppearanceSettings();
    const customLight = {
      ...settings.light,
      preset: "custom",
      accent: "#267C85",
      background: "#F5FAFA",
      foreground: "#1E3436"
    };
    const customDark = {
      ...settings.dark,
      preset: "custom",
      accent: "#E49B66",
      background: "#201C19",
      foreground: "#F7EFE5"
    };

    expect(createWarmVisualThemeTokens("light", customLight)).toMatchObject({
      paper: "#F5FAFA",
      ink: "#1E3436",
      coral: "#267C85"
    });
    expect(createWarmVisualThemeTokens("dark", customDark)).toMatchObject({
      paper: "#201C19",
      ink: "#F7EFE5",
      coral: "#E49B66"
    });
  });
});
