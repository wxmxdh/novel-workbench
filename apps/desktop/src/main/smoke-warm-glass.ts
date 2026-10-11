import { nativeImage, type BrowserWindow as BrowserWindowType } from "electron";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface GlassSetup {
  rect: { x: number; y: number; width: number; height: number };
  backdropFilter: string;
  webkitBackdropFilter: string;
  filterReference: string;
  channelScales: Record<string, string | null>;
  imageHrefPresent: boolean;
}

/** Smoke-only pixel probe for the renderer's SVG backdrop filter. */
export async function runWarmGlassSmoke(
  window: BrowserWindowType,
  outputDirectory: string
) {
  const setup = (await window.webContents.executeJavaScript(
    `(()=>{
      const sidebar=document.querySelector('.left-sidebar');
      if(!sidebar)throw new Error('Warm-glass probe requires the native left sidebar');
      const rect=sidebar.getBoundingClientRect();
      if(rect.width<1||rect.height<1)throw new Error('Native sidebar is not visible for warm-glass probe: '+JSON.stringify(rect.toJSON()));
      const html=document.documentElement;
      const oldTheme=html.getAttribute('data-translucent-sidebar');
      const oldProbe=document.getElementById('warm-glass-smoke-stripes');
      if(oldProbe)throw new Error('Warm-glass smoke probe element already exists');
      const oldBackdrop=sidebar.style.getPropertyValue('backdrop-filter');
      const oldBackdropPriority=sidebar.style.getPropertyPriority('backdrop-filter');
      const oldWebkitBackdrop=sidebar.style.getPropertyValue('-webkit-backdrop-filter');
      const oldWebkitBackdropPriority=sidebar.style.getPropertyPriority('-webkit-backdrop-filter');
      const oldPosition=sidebar.style.getPropertyValue('position');
      const oldPositionPriority=sidebar.style.getPropertyPriority('position');
      const oldZIndex=sidebar.style.getPropertyValue('z-index');
      const oldZIndexPriority=sidebar.style.getPropertyPriority('z-index');
      html.setAttribute('data-translucent-sidebar','true');
      const stripes=document.createElement('div');stripes.id='warm-glass-smoke-stripes';
      Object.assign(stripes.style,{position:'fixed',left:'0',top:'0',width:Math.ceil(rect.right)+'px',height:'100vh',zIndex:'0',pointerEvents:'none',background:'repeating-linear-gradient(90deg,#152bff 0px,#152bff 9px,#f8f5ed 9px,#f8f5ed 18px,#ef2352 18px,#ef2352 27px,#111 27px,#111 36px)'});
      document.body.append(stripes);
      sidebar.style.setProperty('position','relative','important');sidebar.style.setProperty('z-index','1','important');
      const style=getComputedStyle(sidebar);
      const filterReference=style.getPropertyValue('--otter-glass-filter').trim();
      const id=filterReference.match(/#([\\w-]+)/)?.[1];
      const filter=id?document.getElementById(id):null;
      const channelScales=Object.fromEntries(['red','green','blue'].map(name=>[name,filter?.querySelector('feDisplacementMap[result="disp-'+name+'"]')?.getAttribute('scale')||null]));
      const href=filter?.querySelector('feImage')?.getAttribute('href')||filter?.querySelector('feImage')?.getAttributeNS('http://www.w3.org/1999/xlink','href')||'';
      window.__warmGlassSmokeCleanup=()=>{stripes.remove();if(oldTheme===null)html.removeAttribute('data-translucent-sidebar');else html.setAttribute('data-translucent-sidebar',oldTheme);for(const [property,value,priority] of [['backdrop-filter',oldBackdrop,oldBackdropPriority],['-webkit-backdrop-filter',oldWebkitBackdrop,oldWebkitBackdropPriority],['position',oldPosition,oldPositionPriority],['z-index',oldZIndex,oldZIndexPriority]]){if(value)sidebar.style.setProperty(property,value,priority);else sidebar.style.removeProperty(property);}delete window.__warmGlassSmokeCleanup;};
      return {rect:{x:Math.max(0,Math.floor(rect.left)),y:Math.max(0,Math.floor(rect.top)),width:Math.min(innerWidth-Math.max(0,Math.floor(rect.left)),Math.ceil(rect.width)),height:Math.min(innerHeight-Math.max(0,Math.floor(rect.top)),Math.ceil(rect.height))},backdropFilter:style.backdropFilter,webkitBackdropFilter:style.webkitBackdropFilter,filterReference,channelScales,imageHrefPresent:href.startsWith('data:image/svg+xml')};
    })()`,
    true
  )) as GlassSetup;
  if (setup.rect.width < 1 || setup.rect.height < 1)
    throw new Error("Warm-glass probe has an empty screenshot crop.");

  const capture = async () => {
    await window.webContents.executeJavaScript(
      "new Promise(requestAnimationFrame).then(()=>new Promise(requestAnimationFrame))",
      true
    );
    return window.webContents.capturePage(setup.rect);
  };
  let withSvg;
  let blurOnly;
  try {
    if (!setup.backdropFilter.includes("url(") || !setup.imageHrefPresent)
      throw new Error(
        "SVG backdrop filter was not applied: " + JSON.stringify(setup)
      );
    withSvg = await capture();
    await window.webContents.executeJavaScript(
      `(()=>{const node=document.querySelector('.left-sidebar');if(!node)throw new Error('Sidebar disappeared during warm-glass probe');node.style.setProperty('backdrop-filter','blur(5px) saturate(1.03)','important');node.style.setProperty('-webkit-backdrop-filter','blur(5px) saturate(1.03)','important');})()`,
      true
    );
    blurOnly = await capture();
  } finally {
    await window.webContents.executeJavaScript(
      `(()=>{window.__warmGlassSmokeCleanup?.();})()`,
      true
    );
  }

  const svgPng = withSvg.toPNG();
  const blurPng = blurOnly.toPNG();
  await Promise.all([
    writeFile(resolve(outputDirectory, "warm-glass-with-svg.png"), svgPng),
    writeFile(resolve(outputDirectory, "warm-glass-blur-only.png"), blurPng)
  ]);
  const left = nativeImage.createFromBuffer(svgPng);
  const right = nativeImage.createFromBuffer(blurPng);
  const leftBitmap = left.toBitmap();
  const rightBitmap = right.toBitmap();
  if (
    left.getSize().width !== right.getSize().width ||
    left.getSize().height !== right.getSize().height
  )
    throw new Error(
      "Warm-glass screenshot crops have different bitmap dimensions."
    );
  let changedPixels = 0;
  let absoluteChannelDelta = 0;
  const pixelCount = left.getSize().width * left.getSize().height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(
        leftBitmap[offset + channel]! - rightBitmap[offset + channel]!
      );
      pixelDelta += delta;
      absoluteChannelDelta += delta;
    }
    if (pixelDelta > 3) changedPixels += 1;
  }
  const meanAbsoluteChannelDelta = absoluteChannelDelta / (pixelCount * 4);
  return {
    backdropFilter: setup.backdropFilter,
    webkitBackdropFilter: setup.webkitBackdropFilter,
    filterReference: setup.filterReference,
    channelScales: setup.channelScales,
    imageHrefPresent: setup.imageHrefPresent,
    crop: { width: left.getSize().width, height: left.getSize().height },
    changedPixels,
    pixelCount,
    meanAbsoluteChannelDelta,
    svgRenderedByPixelDiff:
      setup.backdropFilter.includes("url(") &&
      changedPixels > 0 &&
      meanAbsoluteChannelDelta > 0,
    screenshots: ["warm-glass-with-svg.png", "warm-glass-blur-only.png"]
  };
}
