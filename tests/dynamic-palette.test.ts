import { accentChannels } from "../ui/features/settings/settings-state.ts";
import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../ui/features/settings/dynamic-background.ts"), "utf8");
const colors = vm.createContext({});
vm.runInContext(sourceSlice(source, "ui/features/settings/dynamic-background.ts", null, "function initializeDynamicBackground"), colors);
const plain = (value: number) => JSON.parse(JSON.stringify(value));
type Area = [number[], number];
const artwork = (...areas: Area[]) => new Uint8ClampedArray(areas.flatMap(([rgb, count]) =>
  Array.from({ length: count }, () => [...rgb, 255]).flat()));
const palette = (...areas: Area[]): number[][] => plain(colors.extractDynamicPalette(artwork(...areas)))
  .map((color: string) => {
    if (color.includes("var(--accent)")) return [109, 72, 91];
    const channels = color.match(/\d+/g);
    if (channels === null) throw new Error("Palette color has no channels");
    return channels.map(Number);
  });
const close = (actual: number, expected: number, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test("RGB to HSL converts primaries, secondary colors and achromatic endpoints", () => {
  for (const [rgb, hsl] of [
    [[255, 0, 0], [0, 1, 0.5]], [[0, 255, 0], [120, 1, 0.5]], [[0, 0, 255], [240, 1, 0.5]],
    [[255, 255, 0], [60, 1, 0.5]], [[0, 255, 255], [180, 1, 0.5]], [[255, 0, 255], [300, 1, 0.5]],
    [[0, 0, 0], [0, 0, 0]], [[255, 255, 255], [0, 0, 1]], [[128, 128, 128], [0, 0, 128 / 255]],
  ]) colors.rgbToHsl(rgb).forEach((value: number, index: number) => close(value, hsl[index]));
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
        colors.hslToRgb(colors.rgbToHsl(rgb)).forEach((value: number, index: number) => close(value, rgb[index], 1));
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
  const hues = result.map((rgb: number[]) => colors.rgbToHsl(rgb)[0]);
  hues.forEach((hue: number, index: number) => close(colors.hueDistance(hue, [0, 120, 240][index]), 0, 1));
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) assert.ok(colors.hueDistance(hues[i], hues[j]) > 35);
  }
});

test("one or two hues repeat existing hues with distinct lightness, without inventing colors", () => {
  for (const areas of [[[[230, 40, 40], 100]], [[[230, 40, 40], 100], [[30, 30, 200], 50]]] as Area[][]) {
    const result = palette(...areas);
    assert.equal(new Set(result.map(String)).size, 3);
    result.forEach((rgb: number[], index: number) => {
      const [hue, , lightness] = colors.rgbToHsl(rgb);
      const expectedHue = areas.length === 2 && index === 1 ? 240 : 0;
      close(colors.hueDistance(hue, expectedHue), 0, 1);
      close(paletteLuminance(rgb), [0.055, 0.08, 0.045][index], 0.004);
    });
  }
});

test("gray and near-gray covers stay neutral; black-white and empty samples retain the existing fallback", () => {
  const gray = palette([[110, 110, 110], 900], [[112, 111, 110], 100]);
  assert.equal(new Set(gray.map(String)).size, 3);
  for (const rgb of gray) assert.equal(new Set(rgb).size, 3);
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
        for (const rgb of palette([[r, g, b], 1])) assert.ok(rgb.every((value: number) => value >= 0 && value <= 255) && paletteLuminance(rgb) <= 0.095);
      }
    }
  }
  const mix = (front: number[], back: number[], alpha: number) => front.map((value: number, i: number) => value * alpha + back[i] * (1 - alpha));
  const luminance = (rgb: number[]) => rgb.map((value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum: number, value: number, i: number) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (text: number[], background: number[]) => (luminance(text) + 0.05) / (luminance(background) + 0.05);
  const surfaces = (ceiling: number) => {
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

function paletteLuminance(rgb: number[]): number {
  return rgb.reduce((sum, value, index) => { const n = value / 255; return sum + (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index]; }, 0);
}


test("three-color extraction is deterministic including tied quantized populations", () => {
  const samples: Area[] = [[[216,30,75],200],[[22,150,210],200],[[190,170,30],200]];
  const first = palette(...samples);
  for(let i=0;i<5;i++) assert.deepEqual(palette(...samples), first);
  assert.equal(new Set(first.map(String)).size, 3);
  assert.deepEqual(plain(colors.extractDynamicPalette(new Uint8ClampedArray())), ["rgb(48, 54, 64)", "color-mix(in srgb, var(--accent) 30%, #303640)", "rgb(58, 62, 70)"]);
});


test("dynamic text tokens and all six accents meet contrast on palette and gray fallback extremes", () => {
  const css=readFileSync(path.join(import.meta.dirname,"../ui/styles/tokens.css"),"utf8");
  const rule=css.match(/:root\[data-theme="dynamic"\] \{([^}]+)\}/)![1];
  const text=["text","text2","text3","danger"].map(name=>{const hex=rule.match(new RegExp("--"+name+": #([0-9a-f]{6})"))![1];return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));});
  const weight=Number(rule.match(/--accent-text: color-mix\(in srgb, var\(--accent\) (\d+)%/)![1])/100;
  const covers:number[][]=[];
  for(let r=0;r<=255;r+=51)for(let g=0;g<=255;g+=51)for(let b=0;b<=255;b+=51)if(Math.max(r,g,b)-Math.min(r,g,b)>=12)covers.push(...palette([[r,g,b],1]));
  for(const accent of ["pink","blue","purple","green","orange","cyan"]){
    const rgb=accentChannels(accent,"dynamic");
    const foreground=[...text,rgb.map(v=>v*weight+255*(1-weight))];
    const fallback=rgb.map((v,i)=>v*.3+[48,54,64][i]*.7);
    for(const background of [...covers,[48,54,64],[58,62,70],fallback]){
      const surface=background.map((v,i)=>(v*.96+[10,10,11][i]*.04)*.955+255*.045);
      for(const color of foreground)assert.ok((paletteLuminance(color)+.05)/(paletteLuminance(surface)+.05)>=4.5,JSON.stringify({accent,color,surface}));
    }
  }
});
