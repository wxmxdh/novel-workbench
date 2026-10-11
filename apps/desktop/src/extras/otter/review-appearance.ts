import type { OtterReviewTheme } from "@deepwrite/contracts";

export const OTTER_REVIEW_EXIT_FULLSCREEN_URL =
  "otter-review://app/__desktop_exit_fullscreen__";

// The standalone review page has fixed paper colors. Override only color and
// material inside the desktop view; preserve its layout and typography controls.
export const DESKTOP_REVIEW_THEME_CSS = `
html[data-desktop-theme] .manuscript {
  background: var(--paper-light); color: var(--ink); border-color: var(--line);
  box-shadow: inset 0 1px 0 var(--line), 0 4px 16px var(--shadow);
}
html[data-desktop-theme] :is(.document, .document h1, .document h2, .document h3) { color: var(--ink); }
html[data-desktop-theme] :is(.source-meta, .model-tools button, .document-footer, .delivery-status, .history-toggle, .line-number) { color: var(--muted); }
html[data-desktop-theme] :is(select, textarea, input:not([type=range]):not([type=checkbox])) {
  color: var(--ink); background: var(--paper-deep); border-color: var(--line);
}
html[data-desktop-theme] .model-select { background: transparent; }
html[data-desktop-theme] :is(.topbar, .reading-menu, .reading-setting-panel, .typography-popover, .comparison-card, .comparison-heading, .annotation-editor, .ai-settings-dialog) {
  color: var(--ink);
  border-color: var(--line); box-shadow: 0 8px 24px var(--shadow-md);
}
html[data-desktop-theme] :is(.annotation-editor, .ai-settings-dialog) {
  background: color-mix(in srgb, var(--paper-light) 94%, transparent);
}
html[data-desktop-theme] .warm-glass[data-glass-area] {
  --glass-surface: color-mix(in srgb, var(--paper-light) var(--glass-opacity-percent, 88%), transparent);
}
html[data-desktop-theme] :is(.reading-setting-panel, .comparison-card) {
  background: color-mix(in srgb, var(--paper-light) clamp(35%, calc(var(--glass-opacity-percent, 88%) + 10%), 100%), transparent);
}
html[data-desktop-theme] :is(.quiet-button, .notes-button, .outline-button) { color: var(--muted); background: transparent; border-color: var(--line); }
html[data-desktop-theme] :is(.primary-button, .source-meta button, .notes-button span) { color: var(--coral); background: var(--coral-light); }
html[data-desktop-theme] .model-header { border-color: var(--line); }
`;

/** Trusted application code, data restricted by the color-only IPC schema. */
export function reviewAppearanceScript(
  theme: OtterReviewTheme | undefined,
  fullscreen: boolean
): string {
  return `((theme, fullscreen, exitUrl) => {
    const root = document.documentElement;
    root.dataset.desktopFullscreen = String(fullscreen);
    if (theme) {
      root.dataset.desktopTheme = 'true';
      root.dataset.theme = theme.scheme;
      root.style.colorScheme = theme.scheme;
      for (const [key, value] of Object.entries(theme.colors)) {
        root.style.setProperty('--' + key, value);
      }
      const aliases = { background: 'paper',
        muted: 'muted', accent: 'coral', line: 'line' };
      for (const [key, token] of Object.entries(aliases)) {
        root.style.setProperty('--' + key, theme.colors[token]);
      }
      window.__OTTER_THEME__ = theme.colors;
      window.dispatchEvent(new CustomEvent('otter-theme-change', {detail: theme.colors}));
    }
    let button = document.getElementById('otter-desktop-exit-fullscreen');
    if (!button && document.querySelector('.top-actions')) {
      button = document.createElement('button');
      button.id = 'otter-desktop-exit-fullscreen';
      button.type = 'button';
      button.className = 'quiet-button';
      button.textContent = '退出全屏';
      button.title = '退出全屏 · F11 / Esc';
      button.addEventListener('click', () => { window.location.href = exitUrl; });
      document.querySelector('.top-actions').append(button);
    }
    if (button) button.hidden = !fullscreen;
  })(${JSON.stringify(theme ?? null)}, ${JSON.stringify(fullscreen)}, ${JSON.stringify(OTTER_REVIEW_EXIT_FULLSCREEN_URL)})`;
}
