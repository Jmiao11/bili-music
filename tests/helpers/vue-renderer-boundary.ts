import path from "node:path";
import os from "node:os";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { afterEach } from "node:test";

const vueRendererImports = [
  { file: "root-mount.ts", specifier: "./components/App.vue", name: "App", declaration: 'import App from "./components/App.vue";' },
  { file: "root-mount.ts", specifier: "vue", name: "h, render", declaration: 'import { h, render } from "vue";' },
  { file: "track-list-view.ts", specifier: "./components/PlaylistList.vue", name: "PlaylistList", declaration: 'import PlaylistList from "./components/PlaylistList.vue";' },
  {"file":"components/TrackList.vue","specifier":"./TrackRow.vue","name":"TrackRow","declaration":"import TrackRow from \"./TrackRow.vue\";"},
  { file: "track-list-view.ts", specifier: "./components/TrackList.vue", name: "TrackList", declaration: 'import TrackList from "./components/TrackList.vue";' },
  { file: "track-list-view.ts", specifier: "./vue/sync-region.ts", name: "createSyncRegion", declaration: 'import { createSyncRegion } from "./vue/sync-region.ts";' },
  { file: "pages-view.ts", specifier: "./components/PagesList.vue", name: "PagesList", declaration: 'import PagesList from "./components/PagesList.vue";' },
  { file: "pages-view.ts", specifier: "./vue/sync-region.ts", name: "createSyncRegion", declaration: 'import { createSyncRegion } from "./vue/sync-region.ts";' },
  { file: "library-view.ts", specifier: "./components/LibraryModalBody.vue", name: "LibraryModalBody", declaration: 'import LibraryModalBody from "./components/LibraryModalBody.vue";' },
  { file: "library-view.ts", specifier: "./vue/sync-region.ts", name: "createSyncRegion", declaration: 'import { createSyncRegion } from "./vue/sync-region.ts";' },
];
let hooks: ReturnType<typeof registerHooks> | null = null;
let coldBoundaryResolved = false;
let counterBefore: PropertyDescriptor | undefined;
function takeColdRendererAttempts(): number {
  const attempts: unknown = Reflect.get(globalThis, "__coldVueRegionAttempts");
  Reflect.deleteProperty(globalThis, "__coldVueRegionAttempts");
  return typeof attempts === "number" ? attempts : 0;
}
afterEach(() => {
  if (!coldBoundaryResolved) return;
  coldBoundaryResolved = false;
  const attempts = takeColdRendererAttempts();
  if (counterBefore) Object.defineProperty(globalThis, "__coldVueRegionAttempts", counterBefore);
  disposeColdRendererBoundary();
  assert.equal(attempts, 0, "Cold entry attempted a Vue region, even if a store subscriber isolated the exception");
});
function disposeColdRendererBoundary(): void { hooks?.deregister(); hooks = null; }
function installColdRendererBoundary(): void {
  if (hooks) return;
  const resolved = new Set<string>();
  // Installation-free cold-entry tests must fail if this renderer boundary is crossed.
  hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.startsWith("file:")) {
        const file = fileURLToPath(context.parentURL);
        const temporary = path.relative(os.tmpdir(), file);
        if (!temporary.startsWith("..") && !path.isAbsolute(temporary) && /^(?:bili-native-esm-|bili-library-characterization-|bili-search-characterization-|bili-settings-characterization-)/.test(temporary) && vueRendererImports.some(entry => entry.file === path.basename(file))) {
          const entry = vueRendererImports.find(entry => entry.file === path.basename(file) && entry.specifier === specifier);
          if (entry) {
            if (!coldBoundaryResolved) counterBefore = Object.getOwnPropertyDescriptor(globalThis, "__coldVueRegionAttempts");
            coldBoundaryResolved = true;
            resolved.add(entry.file + ":" + entry.specifier);
            if (resolved.size === vueRendererImports.length) disposeColdRendererBoundary();
            const source = entry.name !== "createSyncRegion" ? "export default {};" : 'export function createSyncRegion() { globalThis.__coldVueRegionAttempts = (globalThis.__coldVueRegionAttempts ?? 0) + 1; throw new Error("Cold test attempted to create a Vue region; use test:dom"); }';
            return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
          }
        }
      }
      return next(specifier, context);
    },
  });
}

export { vueRendererImports, installColdRendererBoundary, disposeColdRendererBoundary, takeColdRendererAttempts };
