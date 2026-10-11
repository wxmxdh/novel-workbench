import { writeFile } from "node:fs/promises";
import {
  BrowserWindow,
  WebContentsView,
  type BrowserWindow as Window
} from "electron";
import type { OtterDesktopService } from "../extras/otter/desktop-service";
import { clickReviewControl } from "./smoke-review-controls";

/** Exercise the real host menu while its popup overlaps the native review view. */
export async function runReviewOverlaySmoke(
  window: Window,
  service: OtterDesktopService,
  outputDirectory: string
) {
  const review = service.reviewContentsForSmoke();
  if (
    !review ||
    review.getURL() !== "otter-review://app/" ||
    BrowserWindow.fromWebContents(review) !== window
  )
    throw new Error(
      "Review contents does not belong to the isolated smoke window."
    );
  const host = window.webContents;
  const child = window.contentView.children.find(
    (view): view is WebContentsView =>
      view instanceof WebContentsView && view.webContents === review
  );
  if (!child) throw new Error("Native review child view missing.");
  const evaluate = async (code: string) => {
    const result = await host.executeJavaScript(
      `(async()=>{
      const ensure=(value,reason)=>{if(!value)throw new Error(reason);};
      const waitFor=async(select,reason)=>{const end=Date.now()+8000;let found;while(!(found=select())&&Date.now()<end)await new Promise(r=>setTimeout(r,40));ensure(found,reason);return found;};
      try { ${code} } catch(error) { return {smokeFailure:error?.message||String(error)}; }
    })()`,
      true
    );
    if (result?.smokeFailure) throw new Error(result.smokeFailure);
    return result;
  };
  const waitReview = async (code: string) => {
    const result = await review.executeJavaScript(`(async()=>{
      const ensure=(value,reason)=>{if(!value)throw new Error(reason);};
      const waitFor=async(select,reason)=>{const end=Date.now()+8000;let found;while(!(found=select())&&Date.now()<end)await new Promise(r=>setTimeout(r,40));ensure(found,reason);return found;};
      try { ${code} } catch(error) { return {smokeFailure:error?.message||String(error)}; }
    })()`);
    if (result?.smokeFailure) throw new Error(result.smokeFailure);
    return result;
  };

  // The test is inserted before the existing explicit-collapse checks. Start from
  // the author's normal expanded preference and make the real menu restore it.
  await evaluate(`
    await waitFor(()=>document.querySelector('.otter-review-panel'),'Review panel missing');
    const shell=document.querySelector('[data-testid="desktop-shell"]');
    ensure(shell&&!shell.classList.contains('is-left-collapsed'),'Smoke must begin with the directory expanded');
    const view=[...document.querySelectorAll('.window-menus button')].find(button=>button.textContent.trim()==='视图');
    ensure(view,'Host View menu trigger missing');view.click();
    const menu=await waitFor(()=>document.querySelector('.popup-select-menu'),'Host View menu did not open');
    const option=[...menu.querySelectorAll('.popup-select-option')].find(button=>button.textContent.includes('隐藏目录侧栏'));
    ensure(option,'Hide directory option missing');
    const popup=menu.getBoundingClientRect(), target=option.getBoundingClientRect(), reviewHost=document.querySelector('.otter-review-host').getBoundingClientRect();
    const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    return {overlaps:overlaps(target,reviewHost),target:target.toJSON(),popup:popup.toJSON(),reviewHost:reviewHost.toJSON()};
  `);

  const overlayReady = await evaluate(`
    const image=await waitFor(()=>document.querySelector('.otter-review-overlay-preview'),'Overlay snapshot missing while menu is open');
    await waitFor(()=>image.complete&&image.naturalWidth>0,'Overlay snapshot did not load');
    const menu=document.querySelector('.popup-select-menu');
    ensure(menu,'Host menu closed before pointer test');
    await waitFor(()=>Number(getComputedStyle(menu).opacity)===1,'Host menu transition did not settle');
    return {loaded:true,width:image.naturalWidth,height:image.naturalHeight};
  `);
  await writeFile(
    `${outputDirectory}/review-overlay-menu.png`,
    (await host.capturePage()).toPNG()
  );

  // Native input goes to the host renderer at a point that the child view used to cover.
  const clickHostOption = async (label: string, requireOverlap = false) => {
    if (child.getVisible())
      throw new Error(
        "Native child still covers the host menu pointer target."
      );
    const point = (await host.executeJavaScript(`(() => {
      const option=[...document.querySelectorAll('.popup-select-menu .popup-select-option')].find(button=>button.textContent.includes(${JSON.stringify(label)}));
      if(!option)throw new Error('Host menu option missing: '+${JSON.stringify(label)});
      const rect=option.getBoundingClientRect();
      const review=document.querySelector('.otter-review-host').getBoundingClientRect();
      const overlap=rect.left<review.right&&rect.right>review.left&&rect.top<review.bottom&&rect.bottom>review.top;
      const x=overlap?Math.min(rect.right-8,Math.max(review.left+8,rect.left+rect.width/2)):rect.left+rect.width/2;
      const y=Math.min(rect.bottom-3,Math.max(review.top+3,rect.top+rect.height/2));
      if(${requireOverlap}&&!(x>=review.left&&x<=review.right&&y>=review.top&&y<=review.bottom))throw new Error('Pointer target no longer overlaps the native view region');
      return {x,y};
    })()`)) as { x: number; y: number };
    const zoom = host.getZoomFactor();
    const position = {
      x: Math.round(point.x * zoom),
      y: Math.round(point.y * zoom)
    };
    host.sendInputEvent({ type: "mouseMove", ...position });
    host.sendInputEvent({
      type: "mouseDown",
      ...position,
      button: "left",
      clickCount: 1
    });
    host.sendInputEvent({
      type: "mouseUp",
      ...position,
      button: "left",
      clickCount: 1
    });
  };
  await clickHostOption("隐藏目录侧栏");
  await evaluate(`
    await waitFor(()=>!document.querySelector('.popup-select-menu'),'Hide option did not close menu');
    await waitFor(()=>document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Hide option did not collapse directory');
    await waitFor(()=>!document.querySelector('.otter-review-overlay-preview'),'Snapshot overlay did not clear after menu close');
  `);
  await evaluate(`
    const view=[...document.querySelectorAll('.window-menus button')].find(button=>button.textContent.trim()==='视图');view.click();
    await waitFor(()=>[...document.querySelectorAll('.popup-select-menu .popup-select-option')].some(button=>button.textContent.includes('显示目录侧栏')),'Show directory option missing');
    const image=await waitFor(()=>document.querySelector('.otter-review-overlay-preview'),'Overlay snapshot missing for show option');
    await waitFor(()=>image.complete&&image.naturalWidth>0,'Overlay snapshot did not load for show option');
  `);
  await clickHostOption("显示目录侧栏", true);
  await evaluate(`
    await waitFor(()=>!document.querySelector('.popup-select-menu'),'Show option did not close menu');
    await waitFor(()=>!document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Show option did not restore directory');
    await waitFor(()=>!document.querySelector('.otter-review-overlay-preview'),'Snapshot overlay remained after menu close');
    const sidebar=document.querySelector('.left-sidebar').getBoundingClientRect();ensure(sidebar.width>100,'Directory did not return to normal layout');
  `);
  const restoreEnd = Date.now() + 3000;
  while (!child.getVisible() && Date.now() < restoreEnd)
    await new Promise((resolve) => setTimeout(resolve, 25));
  if (!child.getVisible())
    throw new Error("Native reading view did not return after menu close.");

  const cycleResults: Array<Record<string, unknown>> = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const entered = await host.executeJavaScript(
      `window.deepwrite.windowFrame.command('toggleFullscreen')`,
      true
    );
    if (!entered.fullscreen || !window.isFullScreen())
      throw new Error(`Fullscreen cycle ${cycle + 1} failed to enter.`);
    const full = await evaluate(`
      await waitFor(()=>document.querySelector('.window-frame.is-fullscreen'),'Fullscreen class missing');
      await waitFor(()=>document.querySelector('.otter-review-panel[data-fullscreen="true"]'),'Review fullscreen state missing');
      const shell=document.querySelector('[data-testid="desktop-shell"]');
      ensure(!shell.classList.contains('is-left-collapsed'),'Fullscreen mutated the directory preference');
      const sidebar=document.querySelector('.left-sidebar');ensure(getComputedStyle(sidebar).display==='none','Fullscreen did not visually hide directory');
      return {preferenceCollapsed:false,sidebarHidden:true};
    `);
    const exited = await host.executeJavaScript(
      `window.deepwrite.windowFrame.command('toggleFullscreen')`,
      true
    );
    if (exited.fullscreen || window.isFullScreen())
      throw new Error(`Fullscreen cycle ${cycle + 1} failed to exit.`);
    const normal = await evaluate(`
      await waitFor(()=>!document.querySelector('.window-frame.is-fullscreen'),'Fullscreen class remained after exit');
      await waitFor(()=>document.querySelector('.otter-review-panel[data-fullscreen="false"]'),'Review windowed state missing');
      const shell=document.querySelector('[data-testid="desktop-shell"]'),sidebar=document.querySelector('.left-sidebar');
      ensure(!shell.classList.contains('is-left-collapsed'),'Fullscreen exit changed the directory preference');
      const layout=()=>{const current=document.querySelector('.left-sidebar'),rect=current?.getBoundingClientRect();return {
        frame:document.querySelector('.window-frame')?.className??null,
        reviewFullscreen:document.querySelector('.otter-review-panel')?.getAttribute('data-fullscreen')??null,
        directoryCollapsed:shell?.classList.contains('is-left-collapsed')??null,
        sidebarDisplay:current?getComputedStyle(current).display:null,
        sidebarWidth:rect?.width??null,
        sidebarHeight:rect?.height??null,
        viewport:{width:innerWidth,height:innerHeight}
      };};
      try {
        await waitFor(()=>{const current=document.querySelector('.left-sidebar');return current&&getComputedStyle(current).display!=='none'&&current.getBoundingClientRect().width>100;},'Directory did not reappear after fullscreen');
      } catch(error) {
        throw new Error((error instanceof Error?error.message:String(error))+' layout='+JSON.stringify(layout()));
      }
      ensure(!document.querySelector('.popup-select-menu'),'Fullscreen exit reopened the host menu');
      return {preferenceCollapsed:false,sidebarVisible:true,menuClosed:true};
    `);
    cycleResults.push({ full, normal });
  }

  const beforeNavigation = await waitReview(`
    await waitFor(()=>window.__OTTER_THEME__&&document.querySelector('.manuscript'),'Review theme or manuscript missing');
    const card=document.querySelector('.manuscript'),style=getComputedStyle(card);
    ensure(document.documentElement.dataset.desktopTheme==='true','Desktop theme marker missing before navigation');
    ensure(style.backgroundImage==='none','Review fixed manuscript CSS not active before navigation');
    return {theme:{...window.__OTTER_THEME__},background:style.backgroundColor,backgroundImage:style.backgroundImage};
  `);
  const libraryCollapsed = await review.executeJavaScript(
    "document.querySelector('.workspace').classList.contains('library-collapsed')"
  );
  if (libraryCollapsed) await clickReviewControl(review, "#toggle-library");
  await waitReview(`
    await waitFor(()=>!document.querySelector('.workspace').classList.contains('library-collapsed'),'Inner library did not expand');
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    return true;
  `);
  const navigated = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      review.removeListener("did-finish-load", finish);
      reject(new Error("Brand navigation did not finish."));
    }, 8000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    review.once("did-finish-load", finish);
  });
  await clickReviewControl(review, ".brand[href='/']");
  await navigated;
  let afterNavigation: Record<string, unknown>;
  try {
    afterNavigation = (await waitReview(`
    await waitFor(()=>window.__OTTER_THEME__&&document.querySelector('.manuscript'),'Review did not return after brand navigation');
    const card=document.querySelector('.manuscript'),style=getComputedStyle(card);
    ensure(document.documentElement.dataset.desktopTheme==='true','Desktop theme was not reinstalled after navigation');
    ensure(style.backgroundImage==='none','Fixed manuscript CSS was not reinstalled after navigation');
    ensure(JSON.stringify(window.__OTTER_THEME__)===${JSON.stringify(JSON.stringify(beforeNavigation.theme))},'Review theme variables changed after navigation');
    return {theme:{...window.__OTTER_THEME__},background:style.backgroundColor,backgroundImage:style.backgroundImage};
  `)) as Record<string, unknown>;
  } catch (error) {
    const diagnostic = await review
      .executeJavaScript(
        `(() => {
        let route = null;
        try { route = JSON.parse(localStorage.getItem('novel-workbench.route') || 'null'); } catch {}
        return {
          url: location.href,
          readyState: document.readyState,
          title: document.title,
          bodyText: document.body?.innerText?.slice(0, 1000) ?? '',
          themeInstalled: Boolean(window.__OTTER_THEME__),
          desktopTheme: document.documentElement.dataset.desktopTheme ?? null,
          manuscriptCount: document.querySelectorAll('.manuscript').length,
          columnsPresent: Boolean(document.querySelector('#columns')),
          route
        };
      })()`
      )
      .catch((diagnosticError: unknown) => ({
        inspectionError:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError)
      }));
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; review-after-navigation=${JSON.stringify(diagnostic)}`
    );
  }
  const enter = await host.executeJavaScript(
    `window.deepwrite.windowFrame.command('toggleFullscreen')`,
    true
  );
  if (!enter.fullscreen || !window.isFullScreen())
    throw new Error("Fullscreen failed after review brand navigation.");
  const exitInstalled = await waitReview(`
    const button=await waitFor(()=>document.getElementById('otter-desktop-exit-fullscreen'),'Fullscreen exit button was not reinstalled after navigation');
    ensure(!button.hidden,'Fullscreen exit button is hidden in fullscreen');
    return {installed:true,visible:true};
  `);
  await clickReviewControl(review, "#otter-desktop-exit-fullscreen");
  await evaluate(
    `await waitFor(()=>!document.querySelector('.window-frame.is-fullscreen'),'Review exit button failed after navigation');return true;`
  );
  if (window.isFullScreen())
    throw new Error("Review exit button left the window fullscreen.");
  return {
    overlayReady,
    directoryMenuClicks: 2,
    nativeChildHiddenForMenuAndRestored: true,
    fullscreenCycles: cycleResults,
    beforeNavigation,
    afterNavigation,
    exitInstalled
  };
}
