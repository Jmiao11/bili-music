import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture as realFixture } from "./library-modal-fixture.ts";
import { collectModuleGraph } from "../helpers/module-graph.ts";

type Fired = { fire(type: string): Promise<Event> };
type LibraryApi = { loadLibrary(): Promise<void>; createPlaylist(): void; renameSelectedPlaylist(): void; deleteSelectedPlaylist(): void; choosePlaylistAndAdd(video?: CommandContract.TrackSnapshotInput): void; closeLibraryModal(): void; importFavoritePlaylist(): void; openLoudnessModal(): void };
async function fixture() {
  const source = path.resolve(import.meta.dirname, "../../ui");
  const names = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, "player-dom.ts"), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(names);
  for (const name of ["video-pages.ts", "appearance.ts", "playback-notice.ts", "playback-diagnostics.ts"]) {
    const exports = /export\s*\{([^}]+)\};/.exec(fs.readFileSync(path.join(source, name), "utf8"))?.[1].split(",").map(x => x.trim()).filter(Boolean); assert.ok(exports);
  }
  collectModuleGraph(source, ["main.ts"]);
  const h = await realFixture();
  const requests: Promise<unknown>[] = [];
  const fire = async (element: HTMLElement, type: string) => {
    const start = requests.length, event = await h.fire(element, type);
    await Promise.allSettled(requests.slice(start)); await h.microtasks(); return event;
  };
  Object.defineProperty(h.window.HTMLElement.prototype, "fire", { configurable: true, value(this: HTMLElement, type: string) { return fire(this, type); } });
  const library = h.library as LibraryApi;
  return { library, core: { showLoudnessNormalizationDialog: library.openLoudnessModal },
    nodes: { ...h.nodes, libraryModal: h.nodes.libraryModal as HTMLDivElement & Fired,
      libraryModalBody: h.nodes.libraryModalBody as Omit<HTMLDivElement, "querySelectorAll"> & { querySelectorAll(selector: string): NodeListOf<HTMLButtonElement & Fired> } },
    doc: h.doc as Omit<Document, "activeElement"> & { readonly activeElement: HTMLElement & Fired },
    calls: h.calls, dispose: h.dispose, state: h.state,
    reply(next: (command: string, args: Record<string, unknown>) => Promise<unknown>) {
      h.reply((command, args) => { const pending = next(command, args); requests.push(pending); return pending; });
    },
    async flush() { await h.microtasks(); h.raf(); await h.microtasks(); },
    input: h.input, primary: () => h.primary() as HTMLButtonElement & Fired,
  };
}
export { fixture };
