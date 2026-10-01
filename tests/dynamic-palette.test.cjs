const { sourceSlice } = require("./helpers/source-slice.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/dynamic-background.js"), "utf8");
const colors = vm.createContext({});
vm.runInContext(sourceSlice(source, "ui/dynamic-background.js", null, "function initializeDynamicBackground"), colors);
const plain = (value) => JSON.parse(JSON.stringify(value));
const artwork = (...areas) => new Uint8ClampedArray(areas.flatMap(([rgb, count]) =>
  Array.from({ length: count }, () => [...rgb, 255]).flat()));
const palette = (...areas) => plain(colors.extractDynamicPalette(artwork(...areas)))
  .map((color) => color.match(/\d+/g).map(Number));
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test("RGB to HSL converts primaries, secondary colors and achromatic endpoints", () => {
  for (const [rgb, hsl] of [
    [[255, 0, 0], [0, 1, 0.5]], [[0, 255, 0], [120, 1, 0.5]], [[0, 0, 255], [240, 1, 0.5]],
    [[255, 255, 0], [60, 1, 0.5]], [[0, 255, 255], [180, 1, 0.5]], [[255, 0, 255], [300, 1, 0.5]],
    [[0, 0, 0], [0, 0, 0]], [[255, 255, 255], [0, 0, 1]], [[128, 128, 128], [0, 0, 128 / 255]],
  ]) colors.rgbToHsl(rgb).forEach((value, index) => close(value, hsl[index]));
});

test("HSL to RGB converts known colors and wraps hue at both ends", () => {
  for (const [hsl, rgb] of [
    [[0, 1, 0.5], [255, 0, 0]], [[120, 1, 0.5], [0, 255, 0]], [[240, 1, 0.5], [0, 0, 255]],
    [[420, 1, 0.5], [255, 255, 0]], [[-60, 1, 0.5], [255, 0, 255]],
    [[180, 0, 0.5], [128, 128, 128]], [[60, 1, 0], [0, 0, 0]], [[60, 1, 1], [255, 255, 255]],
  ]) assert.deepEqual(plain(colors.hslToRgb(hsl)), rgb);
});

test("RGB HSL round trip preserves a color cube to within one channel step", () => {
  for (let r = 0; r <= 255; r += 17) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 17) {
        const rgb = [r, g, b];
        colors.hslToRgb(colors.rgbToHsl(rgb)).forEach((value, index) => close(value, rgb[index], 1));
      }
    }
  }
});

test("hue distance follows the short arc across the red seam", () => {
  assert.equal(colors.hueDistance(359, 1), 2);
  assert.equal(colors.hueDistance(10, 350), 20);
  assert.equal(colors.hueDistance(0, 180), 180);
  assert.equal(colors.hueDistance(0, 360), 0);
});

test("hue diversity skips populous related shades in favor of real secondary hues", () => {
  const result = palette([[210, 25, 25], 400], [[110, 12, 12], 300], [[180, 48, 20], 200],
    [[20, 180, 20], 60], [[20, 20, 180], 40]);
  const hues = result.map((rgb) => colors.rgbToHsl(rgb)[0]);
  hues.forEach((hue, index) => close(colors.hueDistance(hue, [0, 120, 240][index]), 0, 1));
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) assert.ok(colors.hueDistance(hues[i], hues[j]) > 35);
  }
});

test("one or two hues repeat existing hues with distinct lightness, without inventing colors", () => {
  for (const areas of [[[[230, 40, 40], 100]], [[[230, 40, 40], 100], [[30, 30, 200], 50]]]) {
    const result = palette(...areas);
    assert.equal(new Set(result.map(String)).size, 3);
    result.forEach((rgb, index) => {
      const [hue, , lightness] = colors.rgbToHsl(rgb);
      const expectedHue = areas.length === 2 && index === 1 ? 240 : 0;
      close(colors.hueDistance(hue, expectedHue), 0, 1);
      close(lightness, [0.20, 0.16, 0.24][index], 0.002);
    });
  }
});

test("gray and near-gray covers stay neutral; black-white and empty samples retain the existing fallback", () => {
  const gray = palette([[110, 110, 110], 900], [[112, 111, 110], 100]);
  assert.equal(new Set(gray.map(String)).size, 3);
  for (const rgb of gray) assert.equal(new Set(rgb).size, 1);
  assert.deepEqual(palette([[0, 0, 0], 512], [[255, 255, 255], 512]), palette());
});

test("muted chromatic covers gain saturation while preserving their original hue", () => {
  const original = colors.rgbToHsl([170, 110, 90]);
  for (const rgb of palette([[170, 110, 90], 1024])) {
    const toned = colors.rgbToHsl(rgb);
    close(colors.hueDistance(toned[0], original[0]), 0, 2);
    assert.ok(toned[1] > original[1]);
  }
});

test("toned colors keep the channel envelope below the previous worst-case contrast bound", () => {
  for (let r = 0; r <= 255; r += 51) {
    for (let g = 0; g <= 255; g += 51) {
      for (let b = 0; b <= 255; b += 51) {
        for (const rgb of palette([[r, g, b], 1])) assert.ok(rgb.every((value) => value >= 8 && value <= 101));
      }
    }
  }
  const mix = (front, back, alpha) => front.map((value, i) => value * alpha + back[i] * (1 - alpha));
  const luminance = (rgb) => rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (text, background) => (luminance(text) + 0.05) / (luminance(background) + 0.05);
  const surfaces = (ceiling) => {
    const panel = mix([22, 24, 28], [ceiling, ceiling, ceiling], 0.2);
    const selected = mix([251, 114, 153], panel, 0.14);
    return [panel, mix([255, 255, 255], panel, 0.04), mix([251, 114, 153], selected, 0.14)];
  };
  const before = surfaces(110);
  const after = surfaces(101);
  for (const text of [[245, 245, 247], [199, 199, 205], [168, 168, 176], [251, 114, 153]]) {
    after.forEach((background, i) => assert.ok(contrast(text, background) >= contrast(text, before[i])));
  }
});
