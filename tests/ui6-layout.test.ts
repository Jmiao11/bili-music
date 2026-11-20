import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readFileSync } from "./helpers/module-syntax.ts";
import { TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, TRACK_COLUMNS_KEY, parseTrackColumnWidths, resizeTrackColumn, trackColumnCapacities } from "../ui/features/tracks/track-column-state.ts";
import { effectiveImageMask } from "../ui/features/settings/dynamic-background.ts";

test("long lists skip offscreen row painting without containing focus rings or insertion lines", () => {
  const css=readFileSync(fileURLToPath(new URL("../ui/styles.css",import.meta.url)),"utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*\bcontent-visibility\s*:[^{}]*)\}/g)];
  assert.deepEqual(rules.map(([,selector])=>selector.trim()), [
    "#app :is(#home-ranking-list, #search-results, #favorites-list, #playlist-tracks, #recent-list, #collection-results) > .track-row:not(:focus-within, .is-drop-before, .is-drop-after)",
    ".queue-drawer-list > li:not(.queue-group)",
  ]);
  assert.match(css, /@supports \(overflow-clip-margin: 4px\)\s*\{\s*#app :is\(#home-ranking-list,/);
  assert.match(rules[0][2], /\bcontent-visibility:\s*auto;/);
  assert.match(rules[0][2], /\bcontain-intrinsic-size:\s*auto var\(--track-height\);/);
  assert.match(rules[0][2], /\boverflow-clip-margin:\s*4px;/);
});

test("image mode drops outlines and raises only the dark uniform mask for readability", () => {
  const css=readFileSync(fileURLToPath(new URL("../ui/styles.css",import.meta.url)),"utf8");
  assert.equal(css.includes("data-image-halo"),false);
  assert.equal(css.includes("compact-outline"),false);
  assert.equal(css.includes("imageForegroundHalos"),false);
  assert.equal(effectiveImageMask(0,"light"),0);
  assert.equal(effectiveImageMask(20,"dark"),.275);
  assert.equal(effectiveImageMask(40,"light"),.55);
  assert.equal(effectiveImageMask(40,"dark"),.65);
  assert.ok(Math.abs(effectiveImageMask(95,"dark")-.95)<1e-12);
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

test("抽屉透明贴边，主区同步裁剪，其他浮层保留独立表面",()=>{
  const css=readFileSync(fileURLToPath(new URL("../ui/styles.css",import.meta.url)),"utf8");
  const drawer=css.match(/#queue-drawer \{([^}]*)\}/g)?.find(rule=>rule.includes("position: fixed")) ?? "";
  assert.match(drawer,/top: var\(--titlebar-height\); bottom: var\(--player-height\); right: 0/);
  assert.match(drawer,/background: transparent; border: 0; border-radius: 0; border-left: 1px solid var\(--line\); box-shadow: none/);
  assert.match(drawer,/width: var\(--queue-drawer-width\)/);
  assert.match(drawer,/transition: transform var\(--queue-drawer-motion\)/);
  assert.match(css,/\.main-panel\.queue-drawer-sliding \{ clip-path: inset\(0\); transition: clip-path var\(--queue-drawer-motion\)/);
  assert.match(css,/\.main-panel\.queue-drawer-open \{ clip-path: inset\(0 var\(--queue-drawer-width\) 0 0\)/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{ :is\(#queue-drawer, \.main-panel\.queue-drawer-sliding\) \{ transition: none/);
  assert.match(css,/:is\(\.settings-panel,\.ai-help-bubble\):has\(> \.floating-backdrop\) \{[^}]*isolation: isolate;[^}]*background: var\(--floating-surface\)/);
  assert.match(css,/\.settings-panel:has\(> \.floating-backdrop\) :is\(\.settings-header,\.modal-actions,\.library-modal-actions\) \{ background: transparent/);
  assert.match(css,/\.playback-notice \.floating-backdrop \{[^}]*--floating-left[^}]*--floating-top[^}]*width: 100vw; height: 100vh/);
});

test("抽屉让位只由主区容器门槛和让位阶段控制",()=>{
  const css=readFileSync(fileURLToPath(new URL("../ui/styles.css",import.meta.url)),"utf8");
  assert.match(css,/\.main-panel \{ container: queue-main \/ inline-size; \}/);
  assert.match(css,/@container queue-main \(min-width: 904px\) \{\s*\.main-panel\.queue-drawer-reserved > \.view \{ width: calc\(100% - var\(--queue-drawer-width\)\); \}\s*\}/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{\s*\.main-panel > \.view \{ transition-property: none; \}\s*\}/);
});

test("抽屉低档用同一份像素判定区域前景，互不改变原四区，高档不输出",async()=>{
  let project: (state: unknown)=>void=()=>{};
  let reads=0;
  const context=vm.createContext({
    window:{innerWidth:1200,innerHeight:800,Image:class {naturalWidth=1200;naturalHeight=800;async decode() {} }},
    document:{
      querySelector(selector:string) {
        return { getBoundingClientRect: () => selector==="#queue-drawer"
          ? {left:1200,top:34,right:1560,bottom:730,width:360}
          : {left:0,top:0,right:800,bottom:800} };
      },
      createElement() {return {width:0,height:0,getContext() {return {
        fillRect(){},drawImage(){},getImageData(_x:number,_y:number,width:number,height:number){
          reads++;const data=new Uint8ClampedArray(width*height*4);
          for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
            const i=(y*width+x)*4; data.fill(x<width*.7 ? 255 : 0,i,i+3); data[i+3]=255;
          }
          return {data,width,height};
        }
      };}};}
    },
    installImageForegroundPort(port: typeof project) {project=port;},refreshPresentation(){}
  });
  vm.runInContext(readFileSync(fileURLToPath(new URL("../ui/features/settings/dynamic-background.ts",import.meta.url)),"utf8"),context);
  const read=(open=false)=>JSON.parse(vm.runInContext("JSON.stringify(readImageForegroundPresentation("+open+").regions)",context));
  vm.runInContext("readImageForegroundPresentation()",context);
  const state={theme:"image",backgroundDim:0,background:{dataUrl:"synthetic"}};
  project(state);
  for(let i=0;i<4;i++) await Promise.resolve();
  const original=read();assert.deepEqual(original,{sidebar:"light",content:"light",bar:"light",titlebar:"light"});
  assert.deepEqual(read(true),{...original,queue:"dark"});assert.deepEqual(read(),original);
  project({...state,backgroundDim:60});
  assert.deepEqual(read(true),{});assert.equal(reads,1);
});
