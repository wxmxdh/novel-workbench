import { app, type BrowserWindow } from "electron";
import { resolve } from "node:path";
import { runPlotOutlineSelectionSmoke } from "./smoke-plot-outline-selection";
import { runNativeWritingSmoke } from "./smoke-native-writing";

/** Real native UI test, explicitly limited to the disposable profile. No model calls. */
export async function runAccumulationSmoke(window: BrowserWindow) {
  const profile = process.env.DEEPWRITE_ACCUMULATION_SMOKE_ROOT;
  if (
    process.env.DEEPWRITE_SMOKE !== "1" ||
    !profile ||
    resolve(profile) !== resolve(app.getPath("userData"))
  )
    throw new Error(
      "Accumulation smoke requires an explicit disposable profile."
    );
  const bookId = await window.webContents.executeJavaScript(`(async () => {
    const api = window.deepwrite.long;
    const previous = (await api.list()).books.find(book => book.title === '剧情板块隔离验收');
    if (previous) return previous.id;
    const created = await api.create({ title: '剧情板块隔离验收', genre: '其他' });
    if (!created) throw new Error('Disposable book creation canceled');
    return created.book.id;
  })()`);
  if (typeof bookId !== "string" || !/^longbook_[a-z0-9_-]+$/u.test(bookId))
    throw new Error("Invalid fixture book identity");
  const loaded = new Promise<void>((done) =>
    window.webContents.once("did-finish-load", () => done())
  );
  window.webContents.reload();
  await loaded;
  const result = await window.webContents.executeJavaScript(`(async bookId => {
    const wait = async (get, message) => { const until = Date.now()+15000; while(Date.now()<until) { const value=await get(); if(value)return value; await new Promise(done=>setTimeout(done,50)); } throw new Error(message+'; visible nodes: '+JSON.stringify([...document.querySelectorAll('[data-resource-id]')].map(node=>node.getAttribute('data-resource-id')))); };
    const book = await wait(() => document.querySelector('[data-resource-id="long-book:'+bookId+'"]'), 'Book not visible in native tree');
    if(book.getAttribute('aria-expanded')!=='true') book.click();
    const root = await wait(() => document.querySelector('[data-resource-id="long-book:'+bookId+':root:plot_design"]'), 'Plot planning root is missing');
    root.click();
    const board = await wait(() => document.querySelector('[data-testid="plot-planning-board"]'), 'Plot board did not mount');
    const index = (await window.deepwrite.long.getWorkspaceIndex({bookId})).workspaceIndex;
    if(!board.textContent.includes('剧情规划与记录')) throw new Error('Planning board label missing');
    const chapter=index.plot.chapterCards[0];
    if(!chapter) throw new Error('Fixture chapter missing');
    const buttons = [...board.querySelectorAll('button')];
    const plan = buttons.find(button=>button.textContent.trim()==='章计划');
    if(!plan) throw new Error('Initial chapter plan action missing');
    plan.click();
    await wait(() => {
      if (document.querySelector('[data-testid="plot-planning-board"]')) return false;
      const editor = document.querySelector('.long-workspace-editor');
      const title =
        editor?.querySelector('.long-document-title-input')?.value?.trim() ??
        editor?.querySelector('.long-document-title')?.textContent?.trim();
      const format = editor?.querySelector('.long-document-format')?.textContent?.trim();
      return title === chapter.title && format === '章卡内容';
    }, 'Chapter plan did not settle on the selected chapter-card document');
    return {status:'ok', bookId, nativePlotBoard:true, chapterPlanNavigation:true, chapterCardTitle:chapter.title, chapterCardDocument:true, volumeCount:index.plot.volumes.length, chapterCount:index.plot.chapterCards.length, noModelCalls:true};
  })(${JSON.stringify(bookId)})`);
  const selectionFixture = await window.webContents
    .executeJavaScript(`(async bookId => {
    const rootId='long-book:'+bookId+':root:plot_design';
    const root = document.querySelector('[data-resource-id="'+rootId+'"]');
    if (!root) throw new Error('Plot root disappeared after chapter navigation');
    root.click();
    const until=Date.now()+15000;
    while((!document.querySelector('[data-testid="plot-planning-board"]') || !document.querySelector('[data-resource-id="'+rootId+'"]')?.classList.contains('is-selected')) && Date.now()<until) await new Promise(done=>setTimeout(done,50));
    if(!document.querySelector('[data-testid="plot-planning-board"]')) throw new Error('Plot planning board did not reopen after selecting its root; selected resource: '+document.querySelector('.tree-row.is-selected')?.getAttribute('data-resource-id'));
    if(!document.querySelector('[data-resource-id="'+rootId+'"]')?.classList.contains('is-selected')) throw new Error('Plot root selection did not settle before the board reopened');
    const index=(await window.deepwrite.long.getWorkspaceIndex({bookId})).workspaceIndex;
    const chapter=index.plot.chapterCards[0];
    if(!chapter) throw new Error('Fixture chapter missing');
    if(chapter.outlineSelection && chapter.outlineSelection.version !== '隔离验收v1') throw new Error('Unexpected fixture outline version');
    return { chapterCardId:chapter.id, previouslySelected:Boolean(chapter.outlineSelection), selection:chapter.outlineSelection };
  })(${JSON.stringify(bookId)})`);
  const outlineSelection = selectionFixture.previouslySelected
    ? {
        ...selectionFixture.selection,
        status: "ok",
        sourceVersionStatus: selectionFixture.selection.status,
        persistedAfterReopen: true
      }
    : await runPlotOutlineSelectionSmoke(window, {
        bookId,
        chapterCardId: selectionFixture.chapterCardId,
        version: "隔离验收v1"
      });
  const nativeWriting = await runNativeWritingSmoke(window, {
    bookId,
    chapterCardId: selectionFixture.chapterCardId
  });
  return { ...result, outlineSelection, nativeWriting };
}
