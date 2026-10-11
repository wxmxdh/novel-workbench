const SVG_NS = "http://www.w3.org/2000/svg";
const FILTER_ROOT_ID = "otter-warm-glass-defs";
const MAX_FILTER_BUCKETS = 40;
const SIZE_BUCKET = 32;

type GlassKind = "panel" | "strong" | "pill";

interface GlassParams {
  radius: number;
  borderWidth: number;
  brightness: number;
  opacity: number;
  blur: number;
  scale: number;
  red: number;
  green: number;
  blue: number;
}

interface FilterBucket {
  key: string;
  filterId: string;
  image: SVGFEImageElement;
  refs: number;
  usedAt: number;
}

const paramsByKind: Record<GlassKind, GlassParams> = {
  panel: {
    radius: 16,
    borderWidth: 0.038,
    brightness: 72,
    opacity: 0.77,
    blur: 9,
    scale: -5.5,
    red: 0,
    green: 0.11,
    blue: 0.22
  },
  strong: {
    radius: 18,
    borderWidth: 0.032,
    brightness: 70,
    opacity: 0.7,
    blur: 11,
    scale: -8,
    red: 0,
    green: 0.18,
    blue: 0.36
  },
  pill: {
    radius: 999,
    borderWidth: 0.05,
    brightness: 74,
    opacity: 0.82,
    blur: 5,
    scale: -4,
    red: 0,
    green: 0.12,
    blue: 0.24
  }
};

const filterBuckets = new Map<string, FilterBucket>();
let nextUse = 0;
let nextFilterId = 0;
let supportMemo: boolean | undefined;

function supportsSvgGlass(): boolean {
  if (supportMemo !== undefined) return supportMemo;
  if (!window.CSS?.supports || typeof ResizeObserver === "undefined") {
    supportMemo = false;
    return supportMemo;
  }

  const agent = navigator.userAgent || "";
  if (/Firefox|Safari/.test(agent) && !/Chrome|Chromium|Edg/.test(agent)) {
    supportMemo = false;
    return supportMemo;
  }

  supportMemo =
    CSS.supports(
      "backdrop-filter",
      'blur(1px) url("#otter-warm-glass-test")'
    ) ||
    CSS.supports(
      "-webkit-backdrop-filter",
      'blur(1px) url("#otter-warm-glass-test")'
    );
  return supportMemo;
}

function installFilterRoot(): SVGSVGElement {
  const existing = document.getElementById(FILTER_ROOT_ID);
  if (existing instanceof SVGSVGElement) return existing;

  const root = document.createElementNS(SVG_NS, "svg");
  root.id = FILTER_ROOT_ID;
  root.setAttribute("width", "0");
  root.setAttribute("height", "0");
  root.setAttribute("aria-hidden", "true");
  root.classList.add("otter-glass-filter-defs");
  const defs = document.createElementNS(SVG_NS, "defs");
  root.append(defs);
  document.body.prepend(root);
  return root;
}

function quantize(value: number): number {
  return Math.max(SIZE_BUCKET, Math.round(value / SIZE_BUCKET) * SIZE_BUCKET);
}

function mapDataUrl(
  width: number,
  height: number,
  params: GlassParams
): string {
  const edge = Math.max(1, Math.min(width, height) * params.borderWidth * 0.5);
  const innerWidth = Math.max(1, width - edge * 2);
  const innerHeight = Math.max(1, height - edge * 2);
  const radius = Math.min(params.radius, Math.min(width, height) / 2);
  const markup = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="r" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="#f00"/></linearGradient>
      <linearGradient id="b" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="#00f"/></linearGradient>
    </defs>
    <rect width="${width}" height="${height}" rx="${radius}" fill="#000"/>
    <rect width="${width}" height="${height}" rx="${radius}" fill="url(#r)"/>
    <rect width="${width}" height="${height}" rx="${radius}" fill="url(#b)" style="mix-blend-mode:screen"/>
    <rect x="${edge}" y="${edge}" width="${innerWidth}" height="${innerHeight}" rx="${Math.max(0, radius - edge)}" fill="hsl(0 0% ${params.brightness}% / ${params.opacity})" style="filter:blur(${params.blur}px)"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(markup)}`;
}

function createBucket(
  kind: GlassKind,
  width: number,
  height: number,
  radius: number
): FilterBucket | undefined {
  const bucketWidth = quantize(width);
  const bucketHeight = quantize(height);
  const radiusBucket = Math.max(0, Math.round(radius / 2) * 2);
  const key = `${kind}:${bucketWidth}x${bucketHeight}:r${radiusBucket}`;
  const cached = filterBuckets.get(key);
  if (cached) {
    cached.usedAt = ++nextUse;
    return cached;
  }

  if (filterBuckets.size >= MAX_FILTER_BUCKETS) {
    const inactive = [...filterBuckets.values()]
      .filter((bucket) => bucket.refs === 0)
      .sort((left, right) => left.usedAt - right.usedAt)[0];
    if (!inactive) return undefined;
    document.getElementById(inactive.filterId)?.remove();
    filterBuckets.delete(inactive.key);
  }

  const params = { ...paramsByKind[kind], radius: radiusBucket };
  const filterId = `otter-warm-glass-${++nextFilterId}`;
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.id = filterId;
  filter.setAttribute("x", "-10%");
  filter.setAttribute("y", "-10%");
  filter.setAttribute("width", "120%");
  filter.setAttribute("height", "120%");
  filter.setAttribute("color-interpolation-filters", "sRGB");

  const image = document.createElementNS(SVG_NS, "feImage");
  image.setAttribute("width", "100%");
  image.setAttribute("height", "100%");
  image.setAttribute("preserveAspectRatio", "none");
  image.setAttribute("result", "map");
  const href = mapDataUrl(bucketWidth, bucketHeight, params);
  image.setAttribute("href", href);
  image.setAttributeNS("http://www.w3.org/1999/xlink", "href", href);
  filter.append(image);

  const channels = [
    {
      name: "red",
      scale: params.scale + params.red,
      matrix: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
    },
    {
      name: "green",
      scale: params.scale + params.green,
      matrix: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
    },
    {
      name: "blue",
      scale: params.scale + params.blue,
      matrix: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
    }
  ];
  const colorResults: string[] = [];
  for (const channel of channels) {
    const displacement = document.createElementNS(SVG_NS, "feDisplacementMap");
    displacement.setAttribute("in", "SourceGraphic");
    displacement.setAttribute("in2", "map");
    displacement.setAttribute("scale", String(channel.scale));
    displacement.setAttribute("xChannelSelector", "R");
    displacement.setAttribute("yChannelSelector", "G");
    displacement.setAttribute("result", `disp-${channel.name}`);
    const matrix = document.createElementNS(SVG_NS, "feColorMatrix");
    matrix.setAttribute("in", `disp-${channel.name}`);
    matrix.setAttribute("type", "matrix");
    matrix.setAttribute("values", channel.matrix);
    matrix.setAttribute("result", channel.name);
    filter.append(displacement, matrix);
    colorResults.push(channel.name);
  }

  const firstBlend = document.createElementNS(SVG_NS, "feBlend");
  firstBlend.setAttribute("in", colorResults[0]!);
  firstBlend.setAttribute("in2", colorResults[1]!);
  firstBlend.setAttribute("mode", "screen");
  firstBlend.setAttribute("result", "warm-rg");
  const secondBlend = document.createElementNS(SVG_NS, "feBlend");
  secondBlend.setAttribute("in", "warm-rg");
  secondBlend.setAttribute("in2", colorResults[2]!);
  secondBlend.setAttribute("mode", "screen");
  secondBlend.setAttribute("result", "warm-output");
  const blur = document.createElementNS(SVG_NS, "feGaussianBlur");
  blur.setAttribute("in", "warm-output");
  blur.setAttribute("stdDeviation", ".2");
  filter.append(firstBlend, secondBlend, blur);

  installFilterRoot().querySelector("defs")?.append(filter);
  const bucket: FilterBucket = {
    key,
    filterId,
    image,
    refs: 0,
    usedAt: ++nextUse
  };
  filterBuckets.set(key, bucket);
  return bucket;
}

/**
 * Add subtle refraction to a functional surface. Identical size/radius buckets
 * share one SVG filter and displacement map; inactive buckets are LRU-evicted.
 */
export function attachWarmGlass(
  surface: HTMLElement,
  kind: GlassKind = "panel"
): () => void {
  if (!supportsSvgGlass()) {
    surface.classList.add("glass-fallback");
    return () => surface.classList.remove("glass-fallback");
  }

  surface.classList.remove("glass-fallback");
  let currentBucket: FilterBucket | undefined;
  let frame = 0;
  let stopped = false;

  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (stopped || !surface.isConnected || surface.hidden) return;
      const bounds = surface.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return;
      const style = getComputedStyle(surface);
      const parsedRadius =
        Number.parseFloat(style.borderRadius) || paramsByKind[kind].radius;
      const radius = Math.min(parsedRadius, bounds.height / 2);
      const nextBucket = createBucket(
        kind,
        Math.round(bounds.width),
        Math.round(bounds.height),
        radius
      );
      if (!nextBucket) {
        surface.classList.add("glass-fallback");
        surface.style.removeProperty("--otter-glass-filter");
        return;
      }
      surface.classList.remove("glass-fallback");
      if (nextBucket !== currentBucket) {
        if (currentBucket)
          currentBucket.refs = Math.max(0, currentBucket.refs - 1);
        currentBucket = nextBucket;
        currentBucket.refs += 1;
      }
      surface.style.setProperty(
        "--otter-glass-filter",
        `url(#${nextBucket.filterId})`
      );
    });
  };

  const observer = new ResizeObserver(update);
  observer.observe(surface);
  update();

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    if (currentBucket) currentBucket.refs = Math.max(0, currentBucket.refs - 1);
    surface.style.removeProperty("--otter-glass-filter");
    surface.classList.remove("glass-fallback");
  };
}
