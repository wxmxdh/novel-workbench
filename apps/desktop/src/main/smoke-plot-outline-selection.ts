import { app, type BrowserWindow } from "electron";
import { resolve } from "node:path";

/** Real-renderer click smoke for an explicitly disposable profile and test book. */
export async function runPlotOutlineSelectionSmoke(
  window: BrowserWindow,
  input: { bookId: string; chapterCardId: string; version: string }
) {
  const fixture = process.env.DEEPWRITE_PLOT_OUTLINE_SMOKE_ROOT;
  if (
    process.env.DEEPWRITE_SMOKE !== "1" ||
    !fixture ||
    resolve(fixture) !== resolve(app.getPath("userData"))
  ) {
    throw new Error(
      "Plot outline smoke requires its explicit disposable profile."
    );
  }
  if (
    !/^longbook_[a-zA-Z0-9_-]+$/u.test(input.bookId) ||
    !/^chapter_[a-zA-Z0-9_-]+$/u.test(input.chapterCardId) ||
    !input.version.trim()
  ) {
    throw new Error("Invalid plot outline smoke target.");
  }
  return await window.webContents.executeJavaScript(
    `(async ({ bookId, chapterCardId, version }) => {
      const ensure = (value, message) => { if (!value) throw new Error(message); };
      const wait = async (get, message) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) { const value = await get(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
        throw new Error(message);
      };
      const api = window.deepwrite?.long;
      ensure(api, 'Long workspace API is unavailable');
      const before = await api.getWorkspaceIndex({ bookId });
      const chapter = before.workspaceIndex.plot.chapterCards.find(item => item.id === chapterCardId);
      ensure(chapter, 'Smoke chapter is missing');
      ensure(!chapter.outlineSelection, 'Smoke chapter must start without an explicit outline selection');
      const board = await wait(() => document.querySelector('[data-testid="plot-planning-board"]'), 'Plot planning board is not open');
      const row = [...board.querySelectorAll('li')].find(item => item.textContent.includes(chapter.title));
      ensure(row, 'Target chapter row is not visible');
      const choose = [...row.querySelectorAll('button')].find(button => /Select outline for this chapter|标为本章选用大纲/u.test(button.textContent || ''));
      ensure(choose, 'Outline selection button is missing');
      choose.click();
      const form = await wait(() => row.querySelector('form.outline-selection-form'), 'Version form did not open');
      const versionInput = form.querySelector('input');
      ensure(versionInput, 'Version input is missing');
      const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      ensure(setInputValue, 'Input value setter is unavailable');
      setInputValue.call(versionInput, version);
      versionInput.dispatchEvent(new Event('input', { bubbles: true }));
      versionInput.dispatchEvent(new Event('change', { bubbles: true }));
      const submit = form.querySelector('button[type="submit"]');
      ensure(submit, 'Outline selection submit button is missing');
      await wait(() => !submit.disabled, 'Version form did not enable its save button');
      submit.click();
      await wait(async () => {
        const refreshed = await api.getWorkspaceIndex({ bookId });
        return refreshed.workspaceIndex.plot.chapterCards.find(item => item.id === chapterCardId)?.outlineSelection?.version === version;
      }, 'Explicit outline selection did not persist through Core');
      await wait(() => {
        const refreshedRow = [...document.querySelectorAll('[data-testid="plot-planning-board"] li')]
          .find(item => item.textContent.includes(chapter.title));
        return refreshedRow?.textContent.includes(version);
      }, 'Saved outline selection did not appear in the refreshed board');
      const after = await api.getWorkspaceIndex({ bookId });
      const saved = after.workspaceIndex.plot.chapterCards.find(item => item.id === chapterCardId)?.outlineSelection;
      ensure(saved?.version === version, 'Explicit outline selection did not persist after refresh');
      ensure(saved.sourceFileId === after.workspaceIndex.chapters.find(item => item.chapterCardId === chapterCardId)?.card.id, 'Selection source is not the native chapter card');
      ensure(/^[a-f0-9]{64}$/u.test(saved.sha256), 'Core did not save a SHA-256 source hash');
      return { status: 'ok', bookId, chapterCardId, version, sourceFileId: saved.sourceFileId, persistedAfterRefresh: true };
    })(${JSON.stringify(input)})`
  );
}
