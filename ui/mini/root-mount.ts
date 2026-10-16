import {h,render} from "vue";
import MiniApp from "./components/MiniApp.vue";
import type {MiniView,MiniCallbacks} from "./view-model.ts";
function createMiniRenderer(host:HTMLElement) { host.replaceChildren(); return (view:MiniView,callbacks:MiniCallbacks):void => { render(h(MiniApp,{view,callbacks}),host); }; }
export {createMiniRenderer};
