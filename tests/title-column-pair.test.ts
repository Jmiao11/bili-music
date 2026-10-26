import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readFileSync } from "./helpers/module-syntax.ts";
import { TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, TRACK_COLUMNS_KEY, parseTrackColumnWidths, resizeTrackColumn, trackColumnCapacities } from "../ui/features/tracks/track-column-state.ts";
function fixture(title=400,uploader=160,spacer=0,fitted=false,hidden=false) {
  const properties=new Map<string,string>(),listeners=new Map<string,(e:unknown)=>void>();let saved:string|null=null;
  class Node {dataset:Record<string,string>={};parentElement:Node|null=null;width=0;contains(){return true;}closest(){return this;}getBoundingClientRect(){return {width:this.width,left:0};}}
  const cells:Record<string,Node>={};for(const [name,width] of Object.entries({title,uploader,pages:fitted?66:72,play:hidden?0:fitted?74:80,duration:fitted?66:72,spacer})){const cell=new Node();cell.width=width;cells[".column-"+name]=cell;}
  class Header extends Node {querySelector(name:string){return cells[name];}setPointerCapture(){}hasPointerCapture(){return true;}releasePointerCapture(){}}
  const header=new Header(),handle=new Node();handle.dataset.trackColumn="title";handle.parentElement=cells[".column-title"];
  const context=vm.createContext({Element:Node,HTMLElement:Node,shallowReactive:(x:unknown)=>x,TRACK_COLUMN_DEFAULTS,TRACK_COLUMN_LIMITS,TRACK_COLUMNS_KEY,parseTrackColumnWidths,resizeTrackColumn,trackColumnCapacities,
    document:{documentElement:{style:{setProperty:(k:string,v:string)=>properties.set(k,v)}}},localStorage:{getItem:()=>saved,setItem:(_k:string,v:string)=>{saved=v;}},
    window:{addEventListener:(k:string,f:(e:unknown)=>void)=>listeners.set(k,f),removeEventListener:(k:string)=>listeners.delete(k)},console});
  vm.runInContext(readFileSync(fileURLToPath(new URL("../ui/app/track-columns.ts",import.meta.url)),"utf8"),context);
  const press=(time=1000)=>{context.event={target:handle,currentTarget:header,button:0,isPrimary:true,pointerId:1,clientX:500,clientY:0,timeStamp:time};vm.runInContext("trackColumnCallbacks.pointerdown(event)",context);};
  vm.runInContext("initializeTrackColumns()",context);
  return {properties,press,move:(delta:number)=>listeners.get("pointermove")?.({pointerId:1,clientX:500+delta,clientY:0}),finish:()=>listeners.get("pointerup")?.({pointerId:1}),saved:()=>JSON.parse(saved??"null"),listeners};
}
test("auto title with zero spacer trades width with uploader in both directions and clamps each boundary",()=>{
  const f=fixture();f.press();assert.equal(f.properties.get("--track-title-width"),"400px");
  f.move(-80);assert.equal(f.properties.get("--track-title-width"),"320px");assert.equal(f.properties.get("--track-uploader-width"),"240px");
  f.move(40);assert.equal(f.properties.get("--track-title-width"),"440px");assert.equal(f.properties.get("--track-uploader-width"),"120px");
  f.move(300);assert.equal(f.properties.get("--track-title-width"),"460px");assert.equal(f.properties.get("--track-uploader-width"),"100px");
  f.move(-300);assert.equal(f.properties.get("--track-title-width"),"240px");assert.equal(f.properties.get("--track-uploader-width"),"320px");
  for(const [name,width] of [["pages",72],["plays",80],["duration",72]])assert.equal(f.properties.get(`--track-${name}-width`),`${width}px`);
  f.finish();assert.equal(f.saved().title,240);assert.equal(f.saved().uploader,320);assert.equal(f.listeners.size,0);
});
test("title/uploader exchange stops when either column reaches its boundary and never uses spacer",()=>{
  const f=fixture(260,310);f.press();f.move(-100);assert.equal(f.properties.get("--track-title-width"),"250px");assert.equal(f.properties.get("--track-uploader-width"),"320px");f.finish();
  const g=fixture(400,100,64);g.press();g.move(50);assert.equal(g.properties.get("--track-title-width"),"400px");assert.equal(g.properties.get("--track-uploader-width"),"100px");g.finish();
});
test("double press on title still restores auto sizing",()=>{
  const f=fixture();f.press();f.finish();f.press(1100);assert.equal(f.properties.get("--track-title-width"),"100%");assert.equal(f.saved().title,"auto");
});

test("an explicit pair resize keeps fitted neighboring tracks on release; a stationary press leaves their preferences alone",()=>{
  const f=fixture(400,140,0,true);f.press();f.move(20);f.finish();
  assert.equal(f.properties.get("--track-pages-width"),"66px");assert.equal(f.saved().pages,66);assert.equal(f.saved().uploader,120);
  const g=fixture(400,140,0,true);g.press();g.finish();assert.equal(g.saved().pages,72);assert.equal(g.saved().uploader,160);
});

test("a hidden numeric column keeps its valid saved preference after pair resizing",()=>{
  const f=fixture(400,160,0,false,true);f.press();f.move(20);f.finish();assert.equal(f.saved().plays,80);assert.deepEqual(parseTrackColumnWidths(JSON.stringify(f.saved())),f.saved());
});
