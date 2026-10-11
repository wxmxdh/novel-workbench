import { writeFile } from "node:fs/promises";
import { BrowserWindow, type BrowserWindow as Window } from "electron";
import {
  createWarmVisualThemeTokens,
  type AppearanceSettings
} from "@deepwrite/contracts";
import type { OtterDesktopService } from "../extras/otter/desktop-service";
import { runReviewOverlaySmoke } from "./smoke-review-overlay";
import {
  clickReviewControl,
  runReviewGlassControlsSmoke,
  verifyReviewWindowRestored
} from "./smoke-review-controls";

/** Verify the author's actual symptom: the content fills the window, not just a flag. */
export async function runReviewExperienceSmoke(
  window: Window,
  service: OtterDesktopService,
  outputDirectory: string
) {
  const evaluate = (code: string) =>
    window.webContents.executeJavaScript(
      `(async()=>{
    const ensure=(value,reason)=>{if(!value)throw new Error(reason);};
    const waitFor=async(select,reason)=>{const end=Date.now()+10000;let found;while(!(found=select())&&Date.now()<end)await new Promise(r=>setTimeout(r,50));ensure(found,reason);return found;};
    ${code}
  })()`,
      true
    );
  const reviewUi = await evaluate(`
    const back=[...document.querySelectorAll('button')].find(b=>/返回应用|return to app/i.test(b.textContent||''));
    ensure(back,'Settings return control missing');back.click();
    const entry=await waitFor(()=>document.querySelector('[data-testid="otter-tab-review"]'),'Review entry missing');entry.click();
    const panel=await waitFor(()=>document.querySelector('.otter-review-panel'),'Review did not mount');
    const focus=[...panel.querySelectorAll('button')].find(b=>b.textContent?.includes('专注阅读'));
    ensure(focus,'Focus control missing');focus.click();
    await waitFor(()=>document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Focus did not collapse sidebar');
    [...panel.querySelectorAll('button')].find(b=>b.textContent?.includes('退出专注'))?.click();
    await waitFor(()=>!document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Focus did not restore sidebar');
    const fullscreen=[...panel.querySelectorAll('button')].find(b=>b.textContent?.includes('全屏 · F11'));
    ensure(fullscreen,'Fullscreen button missing');fullscreen.click();
    try { await waitFor(()=>document.querySelector('.window-frame.is-fullscreen'),'Native fullscreen state not reflected'); }
    catch(error) { throw new Error(error.message+' '+JSON.stringify({state:await window.deepwrite.windowFrame.command('state'),frame:document.querySelector('.window-frame')?.className,buttons:[...document.querySelectorAll('.otter-review-panel button')].map(b=>b.textContent),body:document.body.innerText.slice(-600)})); }
    await waitFor(()=>!document.querySelector('.otter-review-heading')&&!document.querySelector('.window-titlebar'),'Fullscreen chrome remains visible');
    return {entryOpened:true,focusEntered:true,fullscreenChromeHidden:true};
  `);
  if (!window.isFullScreen()) throw new Error("Native fullscreen not entered.");
  const review = service.reviewContentsForSmoke();
  if (
    !review ||
    review.getURL() !== "otter-review://app/" ||
    BrowserWindow.fromWebContents(review) !== window
  )
    throw new Error(
      "Review contents does not belong to the isolated smoke window."
    );
  review.setBackgroundThrottling(false);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const fullscreenGeometry = await evaluate(`
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const host=document.querySelector('.otter-review-host').getBoundingClientRect();
    ensure(Math.abs(host.x)<2&&Math.abs(host.y)<2&&Math.abs(host.width-innerWidth)<2&&Math.abs(host.height-innerHeight)<2,
      'Fullscreen content does not fill viewport: '+JSON.stringify({host:host.toJSON(),width:innerWidth,height:innerHeight}));
    return {host:host.toJSON(),width:innerWidth,height:innerHeight,paper:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()};
  `);
  const embedded = await review.executeJavaScript(`(async()=>{
    const end=Date.now()+10000;while(!window.__OTTER_THEME__&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
    const exit=document.getElementById('otter-desktop-exit-fullscreen');
    if(!exit||exit.hidden)throw new Error('Embedded fullscreen exit is not discoverable');
    return {width:innerWidth,height:innerHeight,paper:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),exitVisible:!exit.hidden};
  })()`);
  if (
    embedded.width !== fullscreenGeometry.width ||
    embedded.height !== fullscreenGeometry.height ||
    embedded.paper !== fullscreenGeometry.paper
  )
    throw new Error(
      "Embedded bounds or palette differs from parent: " +
        JSON.stringify({ embedded, fullscreenGeometry })
    );
  await writeFile(
    `${outputDirectory}/original-ui-review.png`,
    (await window.webContents.capturePage()).toPNG()
  );
  await writeFile(
    `${outputDirectory}/original-ui-review-content.png`,
    (await review.capturePage()).toPNG()
  );
  const glassControls = await runReviewGlassControlsSmoke(
    review,
    outputDirectory
  );

  // The original UI applies its palette before saving; save alone emits no renderer event.
  // Supply that resolved palette to exercise the observer/IPC/view bridge in this fixture.
  const previousAppearance = (await evaluate(
    "return (await window.deepwrite.appearance.list()).settings;"
  )) as AppearanceSettings;
  const applyResolvedPalette = async (
    scheme: "light" | "dark",
    settings: AppearanceSettings
  ) => {
    const colors = createWarmVisualThemeTokens(scheme, settings[scheme]);
    await evaluate(`const root=document.documentElement;root.dataset.theme=${JSON.stringify(scheme)};
      for(const [key,value] of Object.entries(${JSON.stringify(colors)}))root.style.setProperty('--'+key,value);return true;`);
  };
  const customAppearance = {
    ...previousAppearance,
    mode: "light" as const,
    light: {
      ...previousAppearance.light,
      preset: "custom",
      background: "#EFE1CF",
      accent: "#8B5B3E"
    }
  };
  await evaluate(`const settings=${JSON.stringify(previousAppearance)};
    await window.deepwrite.appearance.save({...settings,mode:'light',light:{...settings.light,preset:'custom',background:'#EFE1CF',accent:'#8B5B3E'}});return true;`);
  await applyResolvedPalette("light", customAppearance);
  const themeLiveUpdate = await review.executeJavaScript(`(async()=>{
    const end=Date.now()+8000;while(window.__OTTER_THEME__?.paper?.toLowerCase()!=='#efe1cf'&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
    if(window.__OTTER_THEME__?.paper?.toLowerCase()!=='#efe1cf'||window.__OTTER_THEME__?.coral?.toLowerCase()!=='#8b5b3e')throw new Error('Custom palette did not reach the embedded view');return true;
  })()`);
  await evaluate(
    `await window.deepwrite.appearance.save({...${JSON.stringify(previousAppearance)},mode:'dark'});return true;`
  );
  await applyResolvedPalette("dark", previousAppearance);
  const darkThemeSynced = await review.executeJavaScript(`(async()=>{
    const expected=${JSON.stringify(previousAppearance.dark.background.toLowerCase())};
    const ready=()=>document.documentElement.dataset.theme==='dark'&&window.__OTTER_THEME__?.paper?.toLowerCase()===expected&&getComputedStyle(document.documentElement).getPropertyValue('--paper').trim().toLowerCase()===expected;
    const end=Date.now()+8000;while(!ready()&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
    if(!ready())throw new Error('Dark palette did not reach embedded view');
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await new Promise(r=>setTimeout(r,220));
    const card=document.querySelector('.manuscript');const background=getComputedStyle(card).backgroundColor;
    const channels=background.match(/\\d+/g)?.map(Number)||[];
    if(channels.length<3||channels.slice(0,3).some(value=>value>80)||background==='rgba(0, 0, 0, 0)'||getComputedStyle(card).backgroundImage!=='none')throw new Error('Dark manuscript card remains light or transparent: '+background);
    return {scheme:document.documentElement.dataset.theme,paper:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),cardBackground:background};
  })()`);
  await writeFile(
    `${outputDirectory}/review-dark-theme.png`,
    (await review.capturePage()).toPNG()
  );
  await evaluate(
    `await window.deepwrite.appearance.save(${JSON.stringify(previousAppearance)});return true;`
  );
  await applyResolvedPalette("light", previousAppearance);
  const exitWhileReadingMenuOpen = await review.executeJavaScript(
    "document.querySelector('#reading-menu').matches(':popover-open')"
  );
  if (!exitWhileReadingMenuOpen)
    throw new Error("Reading menu closed before pointer exit check.");
  await clickReviewControl(review, "#otter-desktop-exit-fullscreen");
  await evaluate(`
    await waitFor(()=>!document.querySelector('.window-frame.is-fullscreen'),'Embedded exit did not leave fullscreen');
    await waitFor(()=>document.querySelector('.otter-review-heading')&&document.querySelector('.window-titlebar'),'Windowed chrome was not restored');
    await waitFor(()=>!document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Sidebar state was not restored');return true;
  `);
  if (window.isFullScreen())
    throw new Error("Embedded exit did not restore windowed state.");
  const restoredWorkspace = await verifyReviewWindowRestored(
    window,
    review,
    outputDirectory
  );
  const overlayInteractions = await runReviewOverlaySmoke(
    window,
    service,
    outputDirectory
  );
  review.focus();
  review.sendInputEvent({ type: "keyDown", keyCode: "F11" });
  review.sendInputEvent({ type: "keyUp", keyCode: "F11" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!window.isFullScreen())
    throw new Error("F11 from manuscript view failed.");
  await evaluate(`
    await waitFor(()=>!document.querySelector('.otter-review-heading')&&!document.querySelector('.window-titlebar'),'F11 did not hide chrome');
    await waitFor(()=>document.querySelector('.left-sidebar')&&getComputedStyle(document.querySelector('.left-sidebar')).display==='none','F11 did not hide sidebar');
    ensure(!document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Fullscreen changed sidebar preference');return true;
  `);
  review.sendInputEvent({ type: "keyDown", keyCode: "ESC" });
  review.sendInputEvent({ type: "keyUp", keyCode: "ESC" });
  await evaluate(`
    await waitFor(()=>!document.querySelector('.window-frame.is-fullscreen'),'Escape did not leave fullscreen');
    await waitFor(()=>!document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Escape did not restore sidebar');return true;
  `);
  // A sidebar that was already collapsed must remain collapsed after fullscreen.
  await evaluate(
    `const button=[...document.querySelectorAll('.left-sidebar button')].find(b=>/收起.*侧栏|收起目录|collapse sidebar/i.test((b.getAttribute('aria-label')||'')+' '+(b.title||'')));ensure(button,'Sidebar collapse control missing');button.click();await waitFor(()=>document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Explicit sidebar collapse failed');return true;`
  );
  const wasCollapsed = await evaluate(
    `return document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed');`
  );
  if (wasCollapsed) {
    review.sendInputEvent({ type: "keyDown", keyCode: "F11" });
    review.sendInputEvent({ type: "keyUp", keyCode: "F11" });
    await evaluate(
      `await waitFor(()=>document.querySelector('.window-frame.is-fullscreen'),'Collapsed sidebar fullscreen failed');return true;`
    );
    review.sendInputEvent({ type: "keyDown", keyCode: "ESC" });
    review.sendInputEvent({ type: "keyUp", keyCode: "ESC" });
    await evaluate(
      `await waitFor(()=>!document.querySelector('.window-frame.is-fullscreen'),'Collapsed sidebar fullscreen exit failed');ensure(document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Previously collapsed sidebar was expanded unexpectedly');return true;`
    );
  }
  return {
    reviewUi,
    glassControls,
    exitWhileReadingMenuOpen,
    restoredWorkspace,
    overlayInteractions,
    fullscreenGeometry,
    themeLiveUpdate,
    darkThemeSynced,
    embedded,
    nativeFullscreen: {
      entered: true,
      exited: true,
      reviewUrl: review.getURL(),
      keyboardF11FromReviewContentsEntered: true,
      keyboardEscapeExited: true,
      alreadyCollapsedStatePreserved: wasCollapsed
    }
  };
}
