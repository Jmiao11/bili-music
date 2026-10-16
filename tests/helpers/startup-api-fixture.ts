import {attachSettingsVm} from "./settings-vm.ts";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { stripModuleSyntax } from "./module-syntax.ts";

type MascotApi = { list(): { id: string; name: string; svg: string }[]; getActive(): string; setActive(id: string): string };
type FixtureElement = {
  dataset: Record<string, string>; style: Record<string, string>; innerHTML: string; textContent: string; hidden: boolean;
  children: FixtureElement[];
  classList: { add(name: string): Set<string>; remove(name: string): boolean; contains(name: string): boolean; toggle(name: string, force: boolean): Set<string> | boolean };
  addEventListener(name: string, callback: () => void): Map<string, () => void>;
  setAttribute(): void; replaceChildren(...children:FixtureElement[]):void; append(...children: FixtureElement[]): void; querySelectorAll(): FixtureElement[]; click(): void;
};
function createMascotFixture(saved: string | null = null) {
  function element(): FixtureElement {
    const classes = new Set<string>(), listeners = new Map<string, () => void>();
    return { dataset: {} as Record<string, string>, style: {} as Record<string, string>, innerHTML: "", textContent: "", hidden: false,
      children: [] as ReturnType<typeof element>[],
      classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), contains: (name: string) => classes.has(name),
        toggle: (name: string, force: boolean) => force ? classes.add(name) : classes.delete(name) },
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      setAttribute() {}, replaceChildren(...children:ReturnType<typeof element>[]) {this.children=children;}, append(...children: ReturnType<typeof element>[]) { this.children.push(...children); },
      querySelectorAll() { return this.children; }, click: () => listeners.get("click")?.() };
  }
  const stage = element(), slot = element(), bubble = element(), picker = element();
  const writes: [string, string][] = [], window = { addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, BiliMascot: undefined as MascotApi | undefined };
  const context = vm.createContext({ stageForTest:stage,refreshPresentation:()=>{const model=vm.runInContext("readMascotPresentation()",context);slot.innerHTML=model.svg;bubble.textContent=model.bubble;bubble.hidden=model.bubbleHidden;Object.assign(stage.dataset,{mascotId:model.id,mascotName:model.name,state:model.state});for(const [name,value] of Object.entries(model.classes))stage.classList.toggle(name,Boolean(value));},window, mascotPicker: picker, document: { hidden: false,
    createElement: element, querySelector: (selector: string) => ({ "#mascot-stage": stage, "#mascot-slot": slot, "#mascot-bubble": bubble } as Record<string, unknown>)[selector] ?? null },
    localStorage: { getItem: () => saved, setItem: (key: string, value: string) => writes.push([key, value]) } });
  const read = (name: string) => stripModuleSyntax(fs.readFileSync(path.join(import.meta.dirname, "../../ui", name), "utf8"), "ui/" + name);
  const api: MascotApi | undefined = vm.runInContext(read("app/mascot.ts") + "\ncaptureMascotStage(stageForTest);initializeMascot(); getMascotApi();", context);
  if (!api) throw Error("Mascot API is missing");
  attachSettingsVm(context);
  const appearance = read("features/settings/appearance.ts");
  vm.runInContext(appearance.slice(appearance.indexOf("function syncMascotPickerSelection("), appearance.indexOf("function openSettings(")), context);
  return { api, writes, stage, slot, picker, renderPicker: () => vm.runInContext("renderMascotPicker()", context) };
}
function wireMiniHostApi(context: vm.Context, library: { getState(): { library: unknown } }) {
  const app = context.getApplicationStore();
  context.getApplicationStore = () => ({ ...app, getState: () => ({ ...app.getState(), library: library.getState().library }) });
}
export { createMascotFixture, wireMiniHostApi };
