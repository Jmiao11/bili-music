import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readFileSync } from "./helpers/module-syntax.ts";
import { relativeLuminance, imageMaskOpacity, regionForeground, sampleRegion } from "../ui/features/settings/dynamic-background.ts";

test("image regions measure luminance variance and retain foreground between strict thresholds", () => {
  const sample = sampleRegion(new Uint8ClampedArray([255,255,255,255,0,0,0,255]), 2, 1, [0,0,1,1]);
  assert.equal(sample.mean, .5); assert.equal(sample.variance, .25);
  assert.equal(relativeLuminance(0,0,0), 0); assert.equal(relativeLuminance(255,255,255), 1);
  assert.equal(regionForeground("light", .46, 0), "dark");
  assert.equal(regionForeground("dark", .37, 0), "light");
  for (const mean of [.38,.4,.45]) for (const previous of ["light","dark"] as const) assert.equal(regionForeground(previous, mean, 0), previous);
  assert.equal(regionForeground("dark", 1, imageMaskOpacity(70)), "light");
  for (const [value, expected] of [[0,0],[20,.275],[40,.55],[70,.55+30*.4/55],[95,.95]]) assert.ok(Math.abs(imageMaskOpacity(value)-expected)<1e-12);
});

function fixture() {
  let reads = 0, created = 0, refreshed = 0, brightness = 255;
  const pending: (() => void)[] = [];
  let projectPort: (state: unknown) => void = () => {};
  const context = vm.createContext({ Uint8ClampedArray, Math, JSON,
    installImageForegroundPort(port: typeof projectPort) { projectPort = port; },
    refreshPresentation() { refreshed++; },
    window: { innerWidth: 1280, innerHeight: 800, Image: class {
      src = ""; naturalWidth = 1; naturalHeight = 1;
      constructor() { created++; }
      decode() { return new Promise<void>(resolve => pending.push(resolve)); }
    } },
    document: {
      querySelector() { return { getBoundingClientRect: () => ({left:0,top:0,right:1280,bottom:800}) }; },
      createElement() { const canvas = { width:0, height:0, getContext() { return {
        fillStyle:"", fillRect() {}, drawImage() {}, getImageData() {
          reads++; const data = new Uint8ClampedArray(canvas.width*canvas.height*4); data.fill(brightness);
          return {data,width:canvas.width,height:canvas.height};
        }
      }; } }; return canvas; }
    }
  });
  const files = ["features/settings/dynamic-background.ts"];
  vm.runInContext(files.map(file => readFileSync(fileURLToPath(new URL("../ui/"+file, import.meta.url)), "utf8")).join("\n"), context);
  vm.runInContext("readImageForegroundPresentation()",context);
  const project = (dim: number, source = "bright", theme = "image") => {
    context.state = {theme,backgroundDim:dim,background:{dataUrl:source}};
    projectPort(context.state);
  };
  const read = () => JSON.parse(JSON.stringify(vm.runInContext("readImageForegroundPresentation()",context)));
  const finish = async (index = 0) => { pending[index](); for (let i=0;i<4;i++) await Promise.resolve(); };
  return { project, read, finish, dark() { brightness=0; }, counts: () => ({reads,created,refreshed}) };
}
test("real image projection caches pixels across slider changes and switches halo at 55 percent", async () => {
  const f=fixture(); f.project(0); await f.finish();
  for(const name of ["sidebar","content","bar","titlebar"]) assert.equal(f.read()[name],"dark");
  assert.equal(f.read().halo,true);
  for(const value of [20,40,70,95]) { f.project(value); assert.equal(f.read().halo,value<40); }
  assert.equal(f.read().content,"light"); assert.equal(f.counts().reads,1); assert.equal(f.counts().created,1);
  f.dark(); f.project(0,"black"); await f.finish(1);
  for(const name of ["sidebar","content","bar","titlebar"]) assert.equal(f.read()[name],"light");
  assert.equal(f.read().halo,true); assert.equal(f.counts().reads,2);
});
test("late image decode cannot replace a newer image or a different theme", async () => {
  const f=fixture(); f.project(0,"old"); f.project(0,"new"); await f.finish();
  assert.equal(f.read(),null); assert.equal(f.counts().reads,0);
  await f.finish(1); assert.equal(f.read().content,"dark");
  f.project(0,"pending"); f.project(0,"pending","dark"); await f.finish(2);
  assert.equal(f.read(),null); assert.equal(f.counts().reads,1);
});
