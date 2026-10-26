import { installImageForegroundPort } from "./settings-state.ts";
import type { SettingsSnapshot } from "./settings-state.ts";
import { refreshPresentation } from "../../app/presentation-refresh.ts";
type ImageAppearance = Pick<SettingsSnapshot, "theme" | "backgroundDim" | "background">;
const DYNAMIC_DEFAULT_PALETTE = ["rgb(48, 54, 64)", "color-mix(in srgb, var(--accent) 30%, #303640)", "rgb(58, 62, 70)"];
type DynamicBackgroundPresentation = Readonly<{ paused:boolean; front:number; palettes:readonly (readonly string[] | null)[]; surfaces?: Readonly<Record<string, Readonly<Record<string,string>>>> }>;
let backgroundPresentation:DynamicBackgroundPresentation={paused:false,front:0,palettes:[null,null]};
function readDynamicBackgroundPresentation():DynamicBackgroundPresentation { return projectFloatingSurfaceBackground(backgroundPresentation); }
let backgroundListeners: Set<() => void> | null = null;
function subscribeDynamicBackground(listener: () => void): () => void { (backgroundListeners ??= new Set()).add(listener); return () => { backgroundListeners?.delete(listener); }; }
function updateBackdrop(fields:Partial<DynamicBackgroundPresentation>):void { backgroundPresentation={...backgroundPresentation,...fields}; refreshPresentation(); for (const listener of backgroundListeners ?? []) listener(); }

// H 为角度，S / L 为 0–1；只在一次取色任务中转换，不参与逐帧动画。
function rgbToHsl(rgb: number[]) {
  const [r, g, b] = rgb.map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness];
  const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
}

function hslToRgb([hue, saturation, lightness]: number[]) {
  const sector = ((hue % 360) + 360) % 360 / 60;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(sector % 2 - 1));
  const offset = lightness - chroma / 2;
  const rgb = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0]
    : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma]
      : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return rgb.map((value) => Math.round((value + offset) * 255));
}

function hueDistance(a: number, b: number) {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function extractDynamicPalette(pixels: Uint8ClampedArray | Uint8Array) {
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, alpha] = pixels.subarray(i, i + 4);
    if (alpha < 128 || Math.max(r, g, b) - Math.min(r, g, b) < 12) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? [0, 0, 0, 0, key];
    bucket[0] += r; bucket[1] += g; bucket[2] += b; bucket[3]++;
    buckets.set(key, bucket);
  }
  const candidates = [...buckets.values()].sort((a, b) => b[3] - a[3] || a[4] - b[4])
    .map(bucket => ({ rgb: bucket.slice(0, 3).map(n => n / bucket[3]), count: bucket[3], key: bucket[4] }));
  if (!candidates.length) return DYNAMIC_DEFAULT_PALETTE;
  const dominant = candidates[0];
  const vivid = [...candidates].sort((a, b) => {
    const saturation = (rgb: number[]) => Math.max(...rgb) - Math.min(...rgb);
    return saturation(b.rgb) - saturation(a.rgb) || b.count - a.count || a.key - b.key;
  }).find(color => hueDistance(rgbToHsl(color.rgb)[0], rgbToHsl(dominant.rgb)[0]) > 25) ?? dominant;
  const secondary = candidates.find(color => [dominant, vivid].every(other => hueDistance(rgbToHsl(color.rgb)[0], rgbToHsl(other.rgb)[0]) > 30)) ?? dominant;
  return [dominant, vivid, secondary].map(({ rgb }, index) => {
    const [hue, saturation] = rgbToHsl(rgb);
    const toned = hslToRgb([hue, Math.min(0.88, saturation * 1.2 + 0.12), [0.28, 0.34, 0.26][index]]);
    const linear = toned.map(value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
    const luminance = linear.reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const scale = [.055, .08, .045][index] / Math.max(luminance, .0001);
    const channels = linear.map(n => { const v = Math.min(1, n * scale); return Math.round(255 * (v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055)); });
    return `rgb(${channels.join(", ")})`;
  });
}

function initializeDynamicBackground() {
  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let source = "";
  let cachedSource: string | null = null;
  let cachedPalette = DYNAMIC_DEFAULT_PALETTE;
  let active = false;
  let version = 0;
  let loadingImage: HTMLImageElement | null = null;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTask: number | ReturnType<typeof setTimeout> | null = null;
  let front = 0;

  function paint(layer: number, palette: string[]) {
    const palettes=[...backgroundPresentation.palettes]; palettes[layer]=palette; updateBackdrop({palettes});
  }

  function show(palette: string[]) {
    if (readDynamicPalette().every((color, index) => color === palette[index])) return;
    const next = reducedMotion.matches ? front : 1 - front;
    paint(next, palette);
    updateBackdrop({front:next});
    front = next;
  }

  function cancelSampling() {
    version++;
    if (loadTimer !== null) clearTimeout(loadTimer);
    loadTimer = null;
    if (idleTask !== null) {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idleTask as number);
      else clearTimeout(idleTask);
      idleTask = null;
    }
    if (loadingImage) {
      loadingImage.onload = loadingImage.onerror = null;
      loadingImage.src = "";
      loadingImage = null;
    }
  }

  function refresh() {
    cancelSampling();
    if (!active) return;
    if (source === cachedSource) {
      show(cachedPalette);
      return;
    }
    const ticket = version;
    const requestedSource = source;
    function finish(palette: string[]) {
      if (ticket !== version || !active) return;
      version++;
      if (loadTimer !== null) clearTimeout(loadTimer);
      loadTimer = null;
      if (loadingImage) loadingImage.onload = loadingImage.onerror = null;
      loadingImage = null;
      cachedSource = requestedSource;
      cachedPalette = palette;
      show(palette);
    }
    if (!source) {
      // 首次启用动态主题才初始化；空封面不覆盖已提取的颜色。
      if (!backgroundPresentation.palettes[front]) paint(front, DYNAMIC_DEFAULT_PALETTE);
      return;
    }
    // 独立图片不改播放器封面；CORS 不允许读像素时使用默认配色，不做代理兜底。
    const image = new Image();
    loadingImage = image;
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.onerror = () => finish(DYNAMIC_DEFAULT_PALETTE);
    image.onload = async () => {
      try {
        await image.decode();
      } catch {
        finish(DYNAMIC_DEFAULT_PALETTE);
        return;
      }
      if (ticket !== version || !active) return;
      if (loadTimer !== null) clearTimeout(loadTimer);
      const sample = () => {
        idleTask = null;
        if (ticket !== version || !active) return;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 32;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          context.drawImage(image, 0, 0, 32, 32);
          finish(extractDynamicPalette(context.getImageData(0, 0, 32, 32).data));
        } catch {
          finish(DYNAMIC_DEFAULT_PALETTE);
        }
      };
      idleTask = window.requestIdleCallback
        ? window.requestIdleCallback(sample, { timeout: 1000 })
        : setTimeout(sample, 16);
    };
    loadTimer = setTimeout(() => {
      image.onload = image.onerror = null;
      image.src = "";
      finish(DYNAMIC_DEFAULT_PALETTE);
    }, 8000);
    image.src = source;
  }

  function updateAvailability() {
    const next = root.dataset.theme === "dynamic" && !document.hidden;
    updateBackdrop({paused:!next});
    if (next === active) return;
    active = next;
    refresh();
  }

  window.addEventListener("bilibili-music-trackchange", (event) => {
    const detail = (event as CustomEvent<{ hasCurrent?: boolean; thumbnailUrl?: string }>).detail;
    const next = detail?.hasCurrent ? detail.thumbnailUrl || "" : "";
    if (next === source) return;
    source = next;
    refresh();
  });
  new MutationObserver(updateAvailability).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  document.addEventListener("visibilitychange", updateAvailability);
  reducedMotion.addEventListener("change", () => {
    updateAvailability();
  });
  updateAvailability();
}

function readDynamicPalette(): readonly string[] { return backgroundPresentation.palettes[backgroundPresentation.front] ?? DYNAMIC_DEFAULT_PALETTE; }
export { readDynamicBackgroundPresentation, readDynamicPalette, subscribeDynamicBackground, initializeDynamicBackground };
export type { DynamicBackgroundPresentation };

type ImageScheme = "light" | "dark";
type ImageRegion = "sidebar" | "content" | "bar" | "titlebar";
type RegionSample = Readonly<{ mean: number; variance: number }>;
type ImageForegroundPresentation = Readonly<{ scheme: ImageScheme; averageLuminance: number; regions: Partial<Record<ImageRegion, ImageScheme>> }>;
let lastImageScheme: ImageScheme | null = null;
function readImageScheme(): ImageScheme { return lastImageScheme ?? "dark"; }
function relativeLuminance(r: number, g: number, b: number): number {
  const linear = (value: number) => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
  return .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
}
function imageMaskOpacity(value: number): number {
  return value <= 40 ? value / 40 * .55 : .55 + (value - 40) * .4 / 55;
}
function imageScheme(previous: ImageScheme | null, mean: number): ImageScheme {
  return mean >= .50 ? "light" : mean <= .42 ? "dark" : previous ?? (mean >= .46 ? "light" : "dark");
}
function effectiveImageMask(value: number, scheme: ImageScheme): number {
  const alpha = imageMaskOpacity(value);
  // White patches plus the .09 active overlay need more than .55 with light ink.
  return scheme === "dark" && alpha >= .55 ? Math.max(.65, alpha) : alpha;
}
function regionForeground(previous: ImageScheme, mean: number, alpha: number, scheme: ImageScheme = "dark"): ImageScheme {
  const mask = scheme === "light" ? relativeLuminance(250,250,251) : relativeLuminance(10,12,16);
  const effective = mean * (1-alpha) + mask * alpha;
  return effective > .45 ? "light" : effective < .38 ? "dark" : previous;
}
function sampleRegion(pixels: Uint8ClampedArray, width: number, height: number, rect: readonly number[]): RegionSample {
  const [left, top, right, bottom] = rect;
  let sum = 0, squares = 0, count = 0;
  for (let y = Math.max(0, Math.floor(top * height)); y < Math.min(height, Math.ceil(bottom * height)); y++) {
    for (let x = Math.max(0, Math.floor(left * width)); x < Math.min(width, Math.ceil(right * width)); x++) {
      const index = (y * width + x) * 4, value = relativeLuminance(pixels[index], pixels[index + 1], pixels[index + 2]);
      sum += value; squares += value * value; count++;
    }
  }
  const mean = count ? sum / count : 0;
  return { mean, variance: count ? Math.max(0, squares / count - mean * mean) : 0 };
}
function createImageForeground() {
  const selectors = { sidebar: "#sidebar", content: ".main-panel", bar: "#result", titlebar: ".window-titlebar" };
  let source = "", version = 0, active = false, dim = 90;
  let image: HTMLImageElement | null = null, raster: ImageData | null = null;
  let aspect = 0, geometry = "", averageLuminance = 0;
  let samples: Partial<Record<ImageRegion, RegionSample>> = {};
  let regions: Partial<Record<ImageRegion, ImageScheme>> = {};
  let presentation: ImageForegroundPresentation | null = null;
  function projectScheme(): void {
    if (!document.documentElement) return;
    document.documentElement.dataset.imageScheme = readImageScheme();
    document.documentElement.dataset.imageMode = dim < 40 ? "adaptive" : "uniform";
  }
  function sampleImage(decoded: HTMLImageElement): ImageData | null {
    const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = Math.max(1, Math.round(96 * height / width));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = "#0f1418";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.max(canvas.width / decoded.naturalWidth, canvas.height / decoded.naturalHeight) * 1.08;
    const w = decoded.naturalWidth * scale, h = decoded.naturalHeight * scale;
    context.drawImage(decoded, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    raster = context.getImageData(0, 0, canvas.width, canvas.height);
    aspect = height / width; geometry = "";
    return raster;
  }
  async function updateImageForeground(state: ImageAppearance): Promise<void> {
    const changed = active !== (state.theme === "image") || dim !== state.backgroundDim;
    active = state.theme === "image"; dim = state.backgroundDim;
    projectScheme();
    const next = active ? state.background?.dataUrl ?? "" : "";
    if (next === source) { if (changed) refreshPresentation(); return; }
    source = next;
    const ticket = ++version;
    image = null; raster = null; samples = {}; regions = {}; presentation = null;
    refreshPresentation();
    if (!next) return;
    try {
      const decoded = new window.Image();
      decoded.src = next;
      await decoded.decode();
      if (ticket !== version) return;
      image = decoded; const sampled = sampleImage(decoded);
      if (!sampled) return;
      averageLuminance = sampleRegion(sampled.data,sampled.width,sampled.height,[0,0,1,1]).mean;
      lastImageScheme = imageScheme(lastImageScheme,averageLuminance);
      projectScheme(); refreshPresentation();
      for (const listener of backgroundListeners ?? []) listener();
    } catch { /* Keep the last scheme when the image cannot be read. */ }
  }
  function readImageForegroundPresentation(): ImageForegroundPresentation | null {
    if (!active || !raster) return null;
    const scheme = readImageScheme(), low = imageMaskOpacity(dim) < .55;
    let next: Partial<Record<ImageRegion, ImageScheme>> = {};
    if (low) {
      const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
      if (image && aspect !== height / width) sampleImage(image);
      const rects = Object.entries(selectors).map(([name,selector]) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return {name:name as ImageRegion, rect:rect ? [rect.left/width,rect.top/height,rect.right/width,rect.bottom/height] : [0,0,1,1]};
      });
      const key = JSON.stringify(rects);
      if (geometry !== key) {
        for (const {name,rect} of rects) samples[name] = sampleRegion(raster.data,raster.width,raster.height,rect);
        geometry = key;
      }
      next = {...regions};
      for (const {name} of rects) next[name] = regionForeground(regions[name] ?? scheme,samples[name]?.mean ?? averageLuminance,imageMaskOpacity(dim),scheme);
    }
    if (!presentation || presentation.scheme !== scheme || presentation.averageLuminance !== averageLuminance || JSON.stringify(presentation.regions) !== JSON.stringify(next)) {
      regions = next; presentation = {scheme,averageLuminance,regions};
    }
    return presentation;
  }
  installImageForegroundPort(state => { void updateImageForeground(state); });
  return readImageForegroundPresentation;
}
let readImageForegroundPort: (() => ImageForegroundPresentation | null) | undefined;
function readImageForegroundPresentation(): ImageForegroundPresentation | null { return (readImageForegroundPort ??= createImageForeground())(); }
export { relativeLuminance, imageMaskOpacity, effectiveImageMask, imageScheme, readImageScheme, regionForeground, sampleRegion, readImageForegroundPresentation };
export type { ImageScheme, ImageForegroundPresentation };

let floatingGeometryKey = "";
let floatingPresentation: DynamicBackgroundPresentation | undefined;
function projectFloatingSurfaceBackground(base: DynamicBackgroundPresentation): DynamicBackgroundPresentation {
  if (typeof document === "undefined" || !["image","dynamic"].includes(document.documentElement?.dataset.theme ?? "")) return base;
  const surfaces: Record<string,Record<string,string>> = {};
  for (const [name,selector] of Object.entries({settings:"#settings-modal > .settings-panel",library:"#library-modal > .settings-panel",pages:"#pages-modal > .settings-panel",help:"#ai-help-bubble",notice:"#playback-notice"})) {
    const rect = document.querySelector?.(selector)?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    surfaces[name] = { "--floating-clip": `inset(${Math.max(0,rect.top+1)}px ${Math.max(0,window.innerWidth-rect.right+1)}px ${Math.max(0,window.innerHeight-rect.bottom+1)}px ${Math.max(0,rect.left+1)}px round 7px)`, "--floating-left": `${rect.left}px`, "--floating-top": `${rect.top}px` };
  }
  const key = JSON.stringify(surfaces);
  if (!Object.keys(surfaces).length) return base;
  if (key !== floatingGeometryKey || floatingPresentation?.palettes !== base.palettes || floatingPresentation?.front !== base.front || floatingPresentation?.paused !== base.paused) {
    floatingGeometryKey = key; floatingPresentation = {...base,surfaces};
  }
  return floatingPresentation ?? base;
}

function observeFloatingSurface(element: HTMLElement): () => void {
  const surface = element.parentElement;
  if (!surface) return () => {};
  const observer = new ResizeObserver(refreshPresentation);
  observer.observe(surface);
  const scroll = surface.matches(".settings-panel") ? surface : null;
  scroll?.addEventListener("scroll", refreshPresentation, {passive:true,capture:true});
  return () => { observer.disconnect(); scroll?.removeEventListener("scroll", refreshPresentation, true); };
}
export { observeFloatingSurface };
