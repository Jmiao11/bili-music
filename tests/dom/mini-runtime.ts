import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";

type MiniController = {start():Promise<void>;render(state?:Partial<MiniPlayerStatePayload>):void};
async function loadMiniFactory(document:Document) {
  const project=path.resolve(import.meta.dirname,"../.."),output=fs.mkdtempSync(path.join(os.tmpdir(),"bili-mini-dom-"));
  const descriptors=new Map<string,PropertyDescriptor|undefined>();
  const restore=()=>{for(const [name,value]of descriptors){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}};
  for(const [name,value]of Object.entries({document,window:document.defaultView,HTMLElement:document.defaultView?.HTMLElement,Element:document.defaultView?.Element,SVGElement:document.defaultView?.SVGElement,Node:document.defaultView?.Node,__VUE__:undefined})){
    descriptors.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  try {
    const entry=path.join(output,"entry.ts");fs.writeFileSync(entry,`export {createMiniPlayerController} from ${JSON.stringify(path.join(project,"ui/mini/window-controller.ts"))};`);
    await build({configFile:false,root:project,logLevel:"silent",plugins:[vue()],define:vueFeatureFlags,
      resolve:{alias:{vue:path.join(project,"node_modules/vue/dist/vue.runtime.esm-bundler.js")}},
      build:{outDir:path.join(output,"compiled"),minify:false,lib:{entry,formats:["es"],fileName:"mini"}},
    });
    const loaded=await import(pathToFileURL(path.join(output,"compiled/mini.js")).href) as {createMiniPlayerController(options:Record<string,unknown>):MiniController};
    return {create:loaded.createMiniPlayerController,restore};
  } catch(error) {restore();throw error;}
  finally {if(path.dirname(output)!==os.tmpdir())throw Error("Unsafe mini fixture cleanup");fs.rmSync(output,{recursive:true,force:true});}
}
export {loadMiniFactory};
