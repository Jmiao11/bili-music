import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readFileSync } from "./helpers/module-syntax.ts";
import { TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, TRACK_COLUMNS_KEY, parseTrackColumnWidths, resizeTrackColumn, trackColumnCapacities } from "../ui/features/tracks/track-column-state.ts";
import { imageForegroundHalos } from "../ui/features/settings/dynamic-background.ts";

test("regional outlines omit readable tokens and use the strict mask cutoff", () => {
  assert.equal(imageForegroundHalos("dark",1,0), "");
  assert.equal(imageForegroundHalos("light",0,0), "");
  const weak=imageForegroundHalos("dark",.35,0).split(" ");
  assert.ok(!weak.includes("text")); assert.ok(weak.includes("text3"));
  assert.equal(imageForegroundHalos("light",.4,.55), "");
  assert.ok(imageForegroundHalos("light",.4,.549).includes("text3"));
  assert.ok(imageForegroundHalos("dark",.35,0,[251,114,153],.12).split(" ").includes("text"));
  assert.ok(!imageForegroundHalos("dark",.35,0).split(" ").includes("control-text2"));
});
test("non-title drag freezes rendered title, consumes only spacer, then stops", () => {
  const properties=new Map<string,string>(),listeners=new Map<string,(event: unknown)=>void>();
  class Node {
    dataset: Record<string,string>={}; parentElement: Node | null=null;
    width=0; left=0; contains() {return true;}
    getBoundingClientRect(){return {width:this.width,left:this.left};}
    closest(){return this;}
  }
  const cells: Record<string,Node>={};
  for(const [name,width] of Object.entries({title:400,uploader:160,pages:72,play:80,duration:72,spacer:32})) {const cell=new Node();cell.width=width;cells[".column-"+name]=cell;}
  class Header extends Node {
    querySelector(name:string){return cells[name];}
    setPointerCapture(){} hasPointerCapture(){return true;} releasePointerCapture(){}
  }
  const header=new Header(),handle=new Node();handle.dataset.trackColumn="uploader";handle.parentElement=cells[".column-uploader"];
  const context=vm.createContext({Element:Node,HTMLElement:Node,shallowReactive:(x:unknown)=>x,TRACK_COLUMN_DEFAULTS,TRACK_COLUMN_LIMITS,TRACK_COLUMNS_KEY,parseTrackColumnWidths,resizeTrackColumn,trackColumnCapacities,
    document:{documentElement:{style:{setProperty:(k:string,v:string)=>properties.set(k,v)}}},localStorage:{getItem:()=>null,setItem(){}},
    window:{addEventListener:(k:string,f:(event:unknown)=>void)=>listeners.set(k,f),removeEventListener:(k:string)=>listeners.delete(k)},console});
  vm.runInContext(readFileSync(fileURLToPath(new URL("../ui/app/track-columns.ts",import.meta.url)),"utf8"),context);
  context.event={target:handle,currentTarget:header,button:0,isPrimary:true,pointerId:1,clientX:500,clientY:0,timeStamp:1000};
  vm.runInContext("initializeTrackColumns();trackColumnCallbacks.pointerdown(event)",context);
  assert.equal(properties.get("--track-title-width"),"400px");
  const move=listeners.get("pointermove");assert.ok(move);
  move({pointerId:1,clientX:520,clientY:0});
  assert.equal(properties.get("--track-uploader-width"),"180px");
  assert.equal(properties.get("--track-title-width"),"400px");
  move({pointerId:1,clientX:600,clientY:0});assert.equal(properties.get("--track-uploader-width"),"192px");
  for(const [name,value] of [["pages",72],["plays",80],["duration",72]])assert.equal(properties.get(`--track-${name}-width`),`${value}px`);
  move({pointerId:1,clientX:490,clientY:0});assert.equal(properties.get("--track-uploader-width"),"150px");
  listeners.get("pointerup")?.({pointerId:1});assert.equal(listeners.size,0);
});

test("floating geometry port owns and releases only its surface observer and scroll", () => {
  let observed: unknown, disconnected=0, renders=0, callback: (()=>void)|undefined;
  const listeners=new Map<string,()=>void>();
  const context=vm.createContext({
    ResizeObserver:class {constructor(cb:()=>void){callback=cb;}observe(node:unknown){observed=node;}disconnect(){disconnected++;}},
    refreshPresentation(){renders++;}
  });
  vm.runInContext(readFileSync(fileURLToPath(new URL("../ui/features/settings/dynamic-background.ts",import.meta.url)),"utf8"),context);
  const surface={matches:()=>true,addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};
  context.node={parentElement:surface};
  const dispose=vm.runInContext("observeFloatingSurface(node)",context) as ()=>void;
  assert.equal(observed,surface); callback?.();listeners.get("scroll")?.();assert.equal(renders,2);
  dispose();assert.equal(disconnected,1);assert.equal(listeners.size,0);
});
