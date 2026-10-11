import type {
  AppearanceColorScheme,
  AppearanceThemeConfig
} from "./appearance";

export const DEFAULT_WARM_VISUAL_TOKENS = {
  paper: "#F2EEE7",
  "paper-deep": "#EBE3D8",
  "paper-light": "#FAF7F1",
  ink: "#2D2924",
  "ink-light": "#4A453E",
  muted: "#756D63",
  "muted-light": "#9E958B",
  line: "rgb(98 81 63 / 0.13)",
  "line-strong": "rgb(98 81 63 / 0.22)",
  coral: "#B85B44",
  "coral-hover": "#A04E3A",
  "coral-light": "rgb(184 91 68 / 0.10)",
  success: "#5A8A5E",
  "success-light": "rgb(90 138 94 / 0.10)",
  shadow: "rgb(67 51 35 / 0.08)",
  "shadow-md": "rgb(67 51 35 / 0.12)"
} as const;

export type WarmVisualThemeTokens = Record<string, string>;

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ];
}

function mix(background: string, foreground: string, ratio: number): string {
  const bg = rgb(background);
  const fg = rgb(foreground);
  return `#${bg
    .map((channel, index) =>
      Math.round(channel * (1 - ratio) + fg[index]! * ratio)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`.toUpperCase();
}

function rgba(hex: string, alpha: number): string {
  const [red, green, blue] = rgb(hex);
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
}

/** Build semantic warm visual tokens while respecting the active user palette. */
export function createWarmVisualThemeTokens(
  scheme: AppearanceColorScheme,
  theme: AppearanceThemeConfig
): WarmVisualThemeTokens {
  const isDefaultWarmLight =
    scheme === "light" &&
    theme.accent.toUpperCase() === "#B85B44" &&
    theme.background.toUpperCase() === "#F2EEE7" &&
    theme.foreground.toUpperCase() === "#2D2924";
  if (isDefaultWarmLight) return { ...DEFAULT_WARM_VISUAL_TOKENS };

  const dark = scheme === "dark";
  const paper = theme.background.toUpperCase();
  const ink = theme.foreground.toUpperCase();
  const coral = theme.accent.toUpperCase();
  return {
    paper,
    "paper-deep": mix(paper, ink, dark ? 0.09 : 0.045),
    "paper-light": mix(paper, "#FFFFFF", dark ? 0.06 : 0.52),
    ink,
    "ink-light": mix(ink, paper, dark ? 0.2 : 0.16),
    muted: mix(ink, paper, dark ? 0.42 : 0.35),
    "muted-light": mix(ink, paper, dark ? 0.58 : 0.55),
    line: rgba(ink, dark ? 0.24 : 0.14),
    "line-strong": rgba(ink, dark ? 0.34 : 0.22),
    coral,
    "coral-hover": mix(coral, dark ? "#FFFFFF" : "#6F3428", 0.16),
    "coral-light": rgba(coral, dark ? 0.2 : 0.1),
    success: dark ? "#81B886" : "#5A8A5E",
    "success-light": dark ? "rgb(129 184 134 / 0.16)" : "rgb(90 138 94 / 0.10)",
    shadow: dark ? "rgb(0 0 0 / 0.22)" : "rgb(67 51 35 / 0.08)",
    "shadow-md": dark ? "rgb(0 0 0 / 0.32)" : "rgb(67 51 35 / 0.12)"
  };
}
