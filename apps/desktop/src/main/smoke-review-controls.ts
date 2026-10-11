import { writeFile } from "node:fs/promises";
import type { BrowserWindow, WebContents } from "electron";

/** Pointer events target only the isolated review contents supplied by smoke. */
export async function clickReviewControl(
  contents: WebContents,
  selector: string
) {
  const point = (await contents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.hidden) throw new Error('Review control is missing: ' + ${JSON.stringify(selector)});
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    if (!element.contains(document.elementFromPoint(x, y))) throw new Error('Review control is covered: ' + ${JSON.stringify(selector)});
    return {x, y};
  })()`)) as { x: number; y: number };
  const zoom = contents.getZoomFactor();
  const position = {
    x: Math.round(point.x * zoom),
    y: Math.round(point.y * zoom)
  };
  contents.focus();
  contents.sendInputEvent({ type: "mouseMove", ...position });
  contents.sendInputEvent({
    type: "mouseDown",
    ...position,
    button: "left",
    clickCount: 1
  });
  contents.sendInputEvent({
    type: "mouseUp",
    ...position,
    button: "left",
    clickCount: 1
  });
}

export async function runReviewGlassControlsSmoke(
  contents: WebContents,
  outputDirectory: string
) {
  await clickReviewControl(contents, "#toggle-reading-menu");
  await clickReviewControl(contents, "#reading-tab-glass");
  const previous = await contents.executeJavaScript(`(() => {
    const key='novel-workbench.glass-surfaces';
    return {key, value:localStorage.getItem(key)};
  })()`);
  const samples: Record<string, unknown> = {};
  for (const area of ["nav", "menu", "comparison", "auxiliary"]) {
    const sample = await contents.executeJavaScript(`(() => {
      const section=document.querySelector('[data-surface=${area}]');
      if(!section)throw new Error('Glass controls missing: ${area}');
      const ranges=[...section.querySelectorAll('input[type=range]')];
      const target=document.querySelector('[data-glass-area=${area}]');
      if(!target)throw new Error('Glass target missing: ${area}');
      const read=()=>{const s=getComputedStyle(target);return {value:ranges[0].value,
        background:s.backgroundColor,image:s.backgroundImage,surface:s.getPropertyValue('--glass-surface').trim(),
        blur:s.backdropFilter,opacity:s.getPropertyValue('--glass-opacity-percent').trim()};};
      const mutate=(opacity,blur)=>{ranges[0].value=opacity;ranges[0].dispatchEvent(new Event('input',{bubbles:true}));
        ranges[1].value=blur;ranges[1].dispatchEvent(new Event('input',{bubbles:true}));return read();};
      const low=mutate('20','0'),high=mutate('100','20');
      if(low.background===high.background&&low.image===high.image)throw new Error('Glass opacity remains fixed: ${area} '+JSON.stringify({low,high}));
      if(!matchMedia('(prefers-reduced-transparency: reduce)').matches&&low.blur===high.blur)throw new Error('Glass blur remains fixed: ${area}');
      return {low,high};
    })()`);
    samples[area] = sample;
  }
  // Test actual pointer input as well as the deterministic handler endpoints.
  const point = (await contents.executeJavaScript(`(() => {
    const input=document.querySelector('[data-surface=nav] input[type=range]');
    input.scrollIntoView({block:'nearest'});
    const rect=input.getBoundingClientRect();return {x:rect.left+rect.width*.3,y:rect.top+rect.height/2};
  })()`)) as { x: number; y: number };
  const zoom = contents.getZoomFactor();
  const position = {
    x: Math.round(point.x * zoom),
    y: Math.round(point.y * zoom)
  };
  contents.sendInputEvent({ type: "mouseMove", ...position });
  contents.sendInputEvent({
    type: "mouseDown",
    ...position,
    button: "left",
    clickCount: 1
  });
  contents.sendInputEvent({
    type: "mouseMove",
    x: position.x + 16,
    y: position.y
  });
  contents.sendInputEvent({
    type: "mouseUp",
    x: position.x + 16,
    y: position.y,
    button: "left",
    clickCount: 1
  });
  const pointer = await contents.executeJavaScript(`(async () => {
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const input=document.querySelector('[data-surface=nav] input[type=range]');
    const value=Number(input.value);
    if(value<=20||value>=100)throw new Error('Pointer did not adjust the glass slider: '+value);
    const persisted=JSON.parse(localStorage.getItem('novel-workbench.glass-surfaces'));
    if(persisted.nav.opacity!==value)throw new Error('Glass slider preference was not persisted');
    return {value,persisted:true,background:getComputedStyle(document.querySelector('.topbar')).backgroundColor};
  })()`);
  for (const opacity of [20, 100]) {
    await contents.executeJavaScript(`(async () => {
      const input=document.querySelector('[data-surface=menu] input[type=range]');
      input.value=${JSON.stringify(String(opacity))};input.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    })()`);
    await writeFile(
      `${outputDirectory}/review-glass-${opacity}.png`,
      (await contents.capturePage()).toPNG()
    );
  }
  // Restore fixture defaults; leave the menu open for the real pointer exit.
  await contents.executeJavaScript(`(() => {
    document.querySelector('#reading-panel-glass .unify-font-button').click();
  })()`);
  return { samples, pointer, previous };
}

export async function verifyReviewWindowRestored(
  window: BrowserWindow,
  contents: WebContents,
  outputDirectory: string
) {
  const parent = await window.webContents.executeJavaScript(`(async()=>{
    const deadline=Date.now()+8000;
    const ready=()=>!document.querySelector('.window-frame.is-fullscreen')&&
      document.querySelector('.window-titlebar')&&document.querySelector('.otter-review-heading')&&
      !document.querySelector('[data-testid=desktop-shell]')?.classList.contains('is-left-collapsed');
    while(!ready()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,40));
    if(!ready())throw new Error('Windowed workspace UI did not return');
    let previous='',stableSince=Date.now();
    while(Date.now()<deadline){
      const rect=document.querySelector('.otter-review-host').getBoundingClientRect();
      const value=JSON.stringify([rect.x,rect.y,rect.width,rect.height].map(n=>Math.round(n*2)/2));
      if(value!==previous){previous=value;stableSince=Date.now();}
      if(Date.now()-stableSince>=250)break;
      await new Promise(r=>setTimeout(r,25));
    }
    if(Date.now()-stableSince<250)throw new Error('Restored workspace geometry never settled');
    const host=document.querySelector('.otter-review-host').getBoundingClientRect();
    const sidebar=document.querySelector('.left-sidebar').getBoundingClientRect();
    const heading=document.querySelector('.otter-review-heading').getBoundingClientRect();
    if(host.x<sidebar.right-2||host.x<=0||host.y<heading.bottom-2||host.width>=innerWidth)
      throw new Error('Review view still covers workspace controls: '+JSON.stringify({host,sidebar,heading}));
    return {host:host.toJSON(),sidebar:sidebar.toJSON(),heading:heading.toJSON(),width:innerWidth,height:innerHeight};
  })()`);
  const child = await contents.executeJavaScript(`(async()=>{
    const deadline=Date.now()+8000;
    const ready=()=>document.documentElement.dataset.desktopFullscreen==='false'&&
      document.getElementById('otter-desktop-exit-fullscreen')?.hidden&&
      Math.abs(innerWidth-${parent.host.width})<=2&&Math.abs(innerHeight-${parent.host.height})<=2;
    while(!ready()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,40));
    if(!ready())throw new Error('Review contents or bounds stayed in fullscreen state: '+JSON.stringify({width:innerWidth,height:innerHeight,fullscreen:document.documentElement.dataset.desktopFullscreen}));
    return {fullscreen:document.documentElement.dataset.desktopFullscreen,exitHidden:true,width:innerWidth,height:innerHeight};
  })()`);
  if (window.isFullScreen())
    throw new Error("Native window remained fullscreen");
  if (
    Math.abs(parent.host.width - child.width) > 2 ||
    Math.abs(parent.host.height - child.height) > 2
  )
    throw new Error(
      "Restored review view does not fit its host: " +
        JSON.stringify({ parent, child })
    );
  await writeFile(
    `${outputDirectory}/review-restored-workspace.png`,
    (await window.webContents.capturePage()).toPNG()
  );
  await writeFile(
    `${outputDirectory}/review-restored-content.png`,
    (await contents.capturePage()).toPNG()
  );
  return { parent, child, nativeFullscreen: false };
}
