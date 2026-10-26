import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveImageMask, relativeLuminance, regionForeground } from "../ui/features/settings/dynamic-background.ts";
import { createApplicationStore } from "../ui/store/app-state.ts";
import { selectMiniPlayerSnapshot } from "../ui/mini/mini-player-projection.ts";

test("image-only ink maintains contrast on both worst-case pixels and active overlays", () => {
  const css=readFileSync(new URL("../ui/styles.css",import.meta.url),"utf8");
  const contrast=(a:number,b:number)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  for(const scheme of ["light","dark"] as const) {
    const start=css.indexOf(`:root[data-theme="image"][data-image-scheme="${scheme}"]`);
    const palette=css.slice(start,css.indexOf("}",start));
    const tokens=["text","text2","text3"].map(name=>{
      const hex=new RegExp(`--${name}: #([a-f0-9]+);`).exec(palette)?.[1];assert.ok(hex);
      const value=hex.length===3 ? [...hex].map(x=>x+x).join("") : hex;
      return relativeLuminance(...[0,2,4].map(i=>parseInt(value.slice(i,i+2),16)) as [number,number,number]);
    });
    const mix=/--accent-text: color-mix\(in srgb, var\(--accent\) ([0-9]+)%,/.exec(palette);assert.ok(mix);
    const weight=Number(mix[1])/100, worstAccent=scheme==="light" ? 255*weight : 255*(1-weight);
    tokens.push(relativeLuminance(worstAccent,worstAccent,worstAccent));
    for(const dim of [40,70,90,95]) for(const pixel of [0,255]) for(const overlay of [0,scheme==="light"?.08:.09]) {
      const alpha=effectiveImageMask(dim,scheme), mask=scheme==="light"?[250,250,251]:[10,12,16];
      const background=mask.map(n=>(n*alpha+pixel*(1-alpha))*(1-overlay)+(scheme==="light"?0:255)*overlay);
      for(const ink of tokens) assert.ok(contrast(ink,relativeLuminance(...background as [number,number,number]))>=4.5,`${scheme}/${dim}/${pixel}/${overlay}`);
    }
  }
});

test("mini snapshots extend only the image payload with the main scheme", () => {
  const store=createApplicationStore({invoke:async()=>{throw Error("unexpected command");},setTimeout:()=>0,clearTimeout(){},report(){}});
  store.actions.settings.setTheme("image",false);
  const light=selectMiniPlayerSnapshot(store.getState(),undefined,"light"),dark=selectMiniPlayerSnapshot(store.getState(),undefined,"dark");
  assert.equal(light.imageScheme,"light");assert.equal(dark.imageScheme,"dark");
  assert.deepEqual({...light,imageScheme:undefined},{...dark,imageScheme:undefined});
  store.actions.settings.setTheme("dynamic",false);
  assert.equal("imageScheme" in selectMiniPlayerSnapshot(store.getState(),undefined,"light"),false);
});

test("low-mask regional adaptation keeps its hysteresis and follows the chosen mask color", () => {
  assert.equal(regionForeground("dark",.6,0,"light"),"light");
  assert.equal(regionForeground("light",.1,0,"dark"),"dark");
  assert.equal(regionForeground("light",.4,0,"dark"),"light");
  assert.equal(regionForeground("dark",.4,0,"light"),"dark");
  assert.equal(regionForeground("dark",.4,.275,"light"),"light");
  assert.equal(regionForeground("light",.4,.275,"dark"),"dark");
});
