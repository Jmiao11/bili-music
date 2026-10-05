const DYNAMIC_DEFAULT_PALETTE = ["rgb(28, 32, 40)", "rgb(38, 32, 42)", "rgb(28, 39, 39)"];

// H 为角度，S / L 为 0–1；只在一次取色任务中转换，不参与逐帧动画。
/** @param {number[]} rgb */
function rgbToHsl(rgb) {
  const [r, g, b] = rgb.map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness];
  const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
}

/** @param {number[]} hsl */
function hslToRgb([hue, saturation, lightness]) {
  const sector = ((hue % 360) + 360) % 360 / 60;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(sector % 2 - 1));
  const offset = lightness - chroma / 2;
  const rgb = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0]
    : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma]
      : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return rgb.map((value) => Math.round((value + offset) * 255));
}

/** @param {number} a @param {number} b */
function hueDistance(a, b) {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

/** @param {Uint8ClampedArray | Uint8Array} pixels */
function extractDynamicPalette(pixels) {
  // 32×32 样本，RGB 每通道量化为 8 档；最多 512 个桶，无需聚类库。
  /** @type {Map<number, number[]>} */
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, alpha] = pixels.subarray(i, i + 4);
    if (alpha < 128 || Math.max(r, g, b) < 12 || Math.min(r, g, b) > 243) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) || [0, 0, 0, 0];
    bucket[0] += r;
    bucket[1] += g;
    bucket[2] += b;
    bucket[3]++;
    buckets.set(key, bucket);
  }
  if (!buckets.size) return DYNAMIC_DEFAULT_PALETTE;
  /** @type {number[][]} */
  const selected = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b[3] - a[3])) {
    const color = bucket.slice(0, 3).map((value) => value / bucket[3]);
    const hsl = rgbToHsl(color);
    // 排除近灰噪声；环形色相距离超过 35° 才能占用一个主色位置。
    if (hsl[1] < 0.12 || Math.max(...color) - Math.min(...color) < 12) continue;
    if (selected.some((other) => hueDistance(hsl[0], other[0]) <= 35)) continue;
    selected.push(hsl);
    if (selected.length === 3) break;
  }
  // 主色 / 暗部 / 亮部：保留封面色相；缺色复用已有色相，全灰则保持无彩色。
  // 适度提升 S，最高 80%；再限制 HSL 色度，使通道差 ≤80、通道落在 8–101。
  // 最亮通道低于旧方案的 110，维持低透明度下的全局最坏对比度下界。
  return [0.20, 0.16, 0.24].map((lightness, index) => {
    const [hue, saturation] = selected.length ? selected[index % selected.length] : [0, 0];
    const tonedSaturation = saturation === 0 ? 0 : Math.min(saturation * 1.15 + 0.08, 0.8, 80 / (510 * lightness));
    return `rgb(${hslToRgb([hue, tonedSaturation, lightness]).join(", ")})`;
  });
}

function initializeDynamicBackground() {
  const root = document.documentElement;
  const backdrop = document.querySelector(".dynamic-background");
  if (!backdrop) return;
  const layers = /** @type {HTMLElement[]} */ ([...backdrop.children]);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let source = "";
  /** @type {string | null} */
  let cachedSource = null;
  let cachedPalette = DYNAMIC_DEFAULT_PALETTE;
  let active = false;
  let version = 0;
  /** @type {HTMLImageElement | null} */
  let loadingImage = null;
  /** @type {number | null} */
  let loadTimer = null;
  /** @type {number | null} */
  let idleTask = null;
  /** @type {number | null} */
  let fadeTimer = null;
  /** @type {string[] | null} */
  let queuedPalette = null;
  let front = 0;

  /** @param {HTMLElement} layer @param {string[]} palette */
  function paint(layer, palette) {
    palette.forEach((color, index) => layer.style.setProperty(`--dynamic-color-${index + 1}`, color));
  }

  function finishFade() {
    if (fadeTimer !== null) clearTimeout(fadeTimer);
    fadeTimer = null;
    if (queuedPalette) {
      const palette = queuedPalette;
      queuedPalette = null;
      show(palette);
    }
  }

  /** @param {string[]} palette */
  function show(palette) {
    if (reducedMotion.matches) {
      queuedPalette = null;
      finishFade();
      paint(layers[front], palette);
      return;
    }
    if (fadeTimer !== null) {
      queuedPalette = palette;
      return;
    }
    const next = 1 - front;
    paint(layers[next], palette);
    layers[next].classList.add("is-visible");
    layers[front].classList.remove("is-visible");
    front = next;
    // 双层只交叉淡化 opacity；连续切歌时只保留最新待显示配色。
    fadeTimer = setTimeout(finishFade, 2500);
  }

  function cancelSampling() {
    version++;
    if (loadTimer !== null) clearTimeout(loadTimer);
    loadTimer = null;
    if (idleTask !== null) {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idleTask);
      else clearTimeout(idleTask);
      idleTask = null;
    }
    if (loadingImage) {
      loadingImage.onload = loadingImage.onerror = null;
      loadingImage.src = "";
      loadingImage = null;
    }
    queuedPalette = null;
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
    /** @param {string[]} palette */
    function finish(palette) {
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
      finish(DYNAMIC_DEFAULT_PALETTE);
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
    if (backdrop) backdrop.classList.toggle("is-paused", !next);
    if (next === active) return;
    active = next;
    refresh();
    if (!active) finishFade();
  }

  window.addEventListener("bilibili-music-trackchange", (event) => {
    const next = event.detail?.hasCurrent ? event.detail.thumbnailUrl || "" : "";
    if (next === source) return;
    source = next;
    refresh();
  });
  new MutationObserver(updateAvailability).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  document.addEventListener("visibilitychange", updateAvailability);
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) finishFade();
  });
  updateAvailability();
}

initializeDynamicBackground();
