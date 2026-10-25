import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {test} from "node:test";
import {trackColumnCapacities, TRACK_COLUMN_DEFAULTS} from "../ui/features/tracks/track-column-state.ts";
import type {TrackColumnWidths} from "../ui/features/tracks/track-column-state.ts";
const css=readFileSync(new URL("../ui/styles.css",import.meta.url),"utf8");
const fitBlock=css.slice(css.indexOf("/* UI-5 fit:"),css.indexOf("/* Thresholds include",css.indexOf("/* UI-5 fit:")));
// Evaluate the actual CSS arithmetic, not a second implementation of the fitting policy.
function arithmetic(expression:string,width=0):number{return vm.runInNewContext(expression.replaceAll("calc(","(").replaceAll("px","").replaceAll("100%",String(width)),{min:Math.min,max:Math.max,clamp:(lo:number,n:number,hi:number)=>Math.max(lo,Math.min(n,hi))}) as number;}
function fit(preferences:Readonly<TrackColumnWidths>,width:number){
  const base=fitBlock.slice(0,fitBlock.indexOf("\n:root #app .track-surface:has"));
  const vars=Object.fromEntries([...base.matchAll(/(--[\w-]+): ([^;]+);/g)].map(m=>[m[1],m[2]]));
  vars["--track-title-width"]=preferences.title==="auto"?"100%":preferences.title+"px";
  for(const [key,value] of Object.entries(trackColumnCapacities(preferences))){vars[`--track-${key}-capacity`]=String(value);vars[`--track-${key}-width`]=preferences[key as "uploader"|"pages"|"plays"|"duration"]+"px";}
  const resolve=(text:string):string=>text.replace(/var\((--[\w-]+)(?:, ([^()]+))?\)/g,(_,key:string,fallback:string)=>resolve(vars[key]??fallback));
  return Object.fromEntries(["title","up","pages","plays","duration"].map(key=>[key,arithmetic(resolve(vars["--fit-"+key]),width)]));
}
test("shared CSS shrinks title first then columns proportionally without changing preferences",()=>{
  const saved=Object.freeze({title:600,uploader:320,pages:120,plays:120,duration:100});
  const titleOnly=fit(saved,1200);assert.equal(titleOnly.title,352);assert.equal(titleOnly.up,320);assert.equal(titleOnly.pages,120);
  const narrow=fit(saved,900);assert.equal(narrow.title,240);
  assert.ok(Math.abs(Object.values(narrow).reduce((a,b)=>a+b,188)-900)<1e-6);
  const ratios=[[narrow.up,100,220],[narrow.pages,56,64],[narrow.plays,64,56],[narrow.duration,56,44]].map(([value,min,capacity])=>(value-min)/capacity);
  assert.ok(ratios.every(r=>r>=0&&r<=1&&Math.abs(r-ratios[0])<1e-6));
  assert.equal(fit(saved,1600).title,600);assert.equal(fit(saved,1600).up,320);
  assert.deepEqual(saved,{title:600,uploader:320,pages:120,plays:120,duration:100});
  assert.equal(fit({...TRACK_COLUMN_DEFAULTS,uploader:100,pages:56,plays:64,duration:56},704).title,240);
});
test("main and mini image masks share continuous zero-to-ninety-five mapping",()=>{
  const main=css.match(/\.window-background-overlay \{ display: block; background: rgba\(10, 12, 16, (.*)\); \}/)![1];
  const mini=readFileSync(new URL("../ui/mini.css",import.meta.url),"utf8").match(/background: rgba\(10,12,16,(min.*)\); pointer-events: none/)![1];
  for(const [value,expected] of [[0,0],[20,.275],[40,.55],[70,.55+30*.4/55],[95,.95]]){
    for(const expression of [main,mini])assert.ok(Math.abs(arithmetic(expression.replaceAll("var(--background-dim)",String(value/100)))-expected)<1e-9);
  }
  assert.ok(Math.abs(arithmetic(main.replaceAll("var(--background-dim)","0.399999"))-arithmetic(main.replaceAll("var(--background-dim)","0.400001")))<.00001);
});
