import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../ui/app/sidebar.ts"), "utf8");
const logic = vm.createContext({});
vm.runInContext(source, logic);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const defaults = { width: 220, collapsed: false };
const key = "bilibili-music.sidebar";

test("invalid or missing persisted sidebar settings restore 220px expanded", () => {
  const invalid = [null, undefined, "", "{", "null", "true", "260", "[]", "{}",
    '{"width":260}', '{"collapsed":true}', '{"width":"260","collapsed":false}',
    '{"width":260,"collapsed":"false"}', '{"width":72,"collapsed":true}',
    '{"width":199.9,"collapsed":false}', '{"width":320.1,"collapsed":false}',
    '{"width":1e999,"collapsed":false}', '{"width":null,"collapsed":false}'];
  for (const value of invalid) assert.deepEqual(plain(logic.parseSidebarState(value)), defaults);
  assert.deepEqual(plain(logic.readSidebarState({ getItem() { throw Error("blocked"); } })), defaults);
});

test("both states and fractional widths round-trip at the valid boundaries", () => {
  for (const width of [200, 224, 260, 287.125, 320]) {
    for (const collapsed of [false, true]) {
      const state = { width, collapsed };
      assert.deepEqual(plain(logic.parseSidebarState(JSON.stringify(state))), state);
      assert.equal(logic.sidebarVisibleWidth(state), collapsed ? 72 : width);
    }
  }
});

test("drag widths remain continuous, clamp at maximum, and reject non-finite candidates", () => {
  for (const width of [200, 200.001, 260.25, 319.999, 320, 9999]) {
    assert.deepEqual(plain(logic.resizeSidebarState(defaults, width)), { width: Math.min(width, 320), collapsed: false });
  }
  for (const width of [NaN, Infinity, -Infinity, undefined, "260"]) {
    assert.deepEqual(plain(logic.resizeSidebarState(defaults, width)), defaults);
  }
});

test("collapse below 200, expand at 224, and retain state throughout hysteresis band", () => {
  assert.equal(logic.resizeSidebarState(defaults, 200).collapsed, false);
  const collapsed = logic.resizeSidebarState(defaults, 199.999);
  assert.deepEqual(plain(collapsed), { width: 220, collapsed: true });
  for (const width of [-100, 72, 199.999, 200, 212, 223.999]) {
    assert.deepEqual(plain(logic.resizeSidebarState(collapsed, width)), { width: 220, collapsed: true });
  }
  const expanded = logic.resizeSidebarState(collapsed, 224);
  assert.deepEqual(plain(expanded), { width: 224, collapsed: false });
  for (const width of [223.999, 212, 200]) assert.equal(logic.resizeSidebarState(expanded, width).collapsed, false);
});

// Small event doubles exercise the real controller; no player or Tauri code is loaded.
type SidebarElement = {
  listeners: Record<string, (event?: Record<string, unknown>) => void>;
  attributes: Record<string, unknown>; dataset: Record<string, unknown>; textContent: string;
  style?: Record<string, unknown>; querySelector?: () => SidebarElement;
  title?:string;capture?: number | null; hidden?: boolean; innerHTML?: string;
  setPointerCapture?: (id: number) => void; hasPointerCapture?: (id: number) => boolean; releasePointerCapture?: () => void;
  classList?: { add(name: string): unknown; remove(name: string): unknown; contains(name: string): boolean; toggle(name: string, force: boolean): unknown };
  addEventListener(type: string, fn: (event?: Record<string, unknown>) => void): void;
  emit(type: string, extra?: Record<string, unknown>): void; setAttribute(name: string, value: unknown): void;
};
function element(): SidebarElement {
  return {
    listeners: {}, attributes: {}, dataset: {}, textContent: "",
    addEventListener(type: string, fn: (event?: Record<string, unknown>) => void) { this.listeners[type] = fn; },
    emit(type: string, extra = {}) { this.listeners[type]?.({ preventDefault() {}, ...extra }); },
    setAttribute(name: string, value: unknown) { this.attributes[name] = value; },
  };
}

type SidebarSetup = { root: SidebarElement & { style: Record<string, unknown> }; toggle: SidebarElement; handle: SidebarElement; window: SidebarElement;
  stored: Map<string, string | null>; writes: [string, string][]; warnings: unknown[][]; beforeMount: { width: unknown; collapsed: unknown } };
function setup(saved?: string | null, faults?: { access?: boolean; read?: boolean; write?: boolean }): SidebarSetup;
function setup(saved?: string | null, faults: { access?: boolean; read?: boolean; write?: boolean } = {}) {
  const stored = new Map<string, string | null>(saved === undefined ? [] : [[key, saved]]);
  const writes: [string, string][] = [];
  const warnings: unknown[][] = [];
  const root = element();
  root.style = { setProperty(this: Record<string, unknown>, name: string, value: string) { this[name] = value; } };
  const toggle = element();
  const text = element();
  toggle.querySelector = () => text;
  const handle = element();
  handle.setPointerCapture = (id: number) => { handle.capture = id; };
  handle.hasPointerCapture = (id: number) => handle.capture === id;
  handle.releasePointerCapture = () => { handle.capture = null; handle.emit("lostpointercapture"); };
  const sidebar = {
    getBoundingClientRect: () => {
      if (!root.style) throw new Error("Sidebar root style is missing");
      return ({ width: parseFloat(root.style["--sidebar-width"] as string) });
    },
    querySelectorAll: () => [],
  };
  const document = Object.assign(element(), {
    documentElement: root,
    querySelector: (selector: string) => ({ "#sidebar": sidebar, "#sidebar-toggle": toggle, "#sidebar-resize": handle } as Record<string, typeof sidebar | SidebarElement>)[selector],
  });
  const window = element();
  Object.defineProperty(window, "localStorage", { get() {
    if (faults.access) throw Error("blocked");
    return {
      getItem(name: string) { if (faults.read) throw Error("blocked"); return stored.get(name) ?? null; },
      setItem(name: string, value: string) {
        if (faults.write) throw Error("full");
        stored.set(name, value);
        writes.push([name, value]);
      },
    };
  } });
  vm.runInNewContext(source + "\ninitializeSidebar();", {setSidebarPresentation:(width:number,collapsed:boolean)=>{const label=collapsed ? "展开侧栏" : "收起侧栏";toggle.title=label;toggle.setAttribute("aria-label",label);toggle.setAttribute("aria-expanded",String(!collapsed));text.textContent=label;handle.setAttribute("aria-valuenow",String(width));handle.setAttribute("aria-valuetext",collapsed ? "已折叠，按右方向键展开" : `${width} 像素`);}, document, window, console: { warn: (...args: unknown[]) => warnings.push(args) } });
  const beforeMount = { width: root.style["--sidebar-width"], collapsed: root.dataset.sidebarCollapsed };
  document.emit("DOMContentLoaded");
  return { root, toggle, handle, window, stored, writes, warnings, beforeMount };
}

test("restore before shell mount, toggle remembers width, and persistence survives restart", () => {
  const app = setup('{"width":287.125,"collapsed":true}');
  assert.deepEqual(app.beforeMount, { width: "72px", collapsed: "true" });
  assert.equal(app.writes.length, 0);
  app.toggle.emit("click");
  assert.equal(app.root.style["--sidebar-width"], "287.125px");
  assert.equal(app.toggle.attributes["aria-expanded"], "true");
  app.toggle.emit("click");
  const savedSidebar = app.stored.get(key);
  if (savedSidebar == null) throw new Error("Saved sidebar state is missing");
  assert.deepEqual(JSON.parse(savedSidebar), { width: 287.125, collapsed: true });
  assert.deepEqual(setup(app.stored.get(key)).beforeMount, { width: "72px", collapsed: "true" });
  assert.ok(app.writes.every(([name]) => name === key));
});

test("a captured drag collapses and expands without rebasing or per-move storage writes", () => {
  const app = setup();
  const pointer = { pointerId: 1, isPrimary: true, button: 0 };
  app.handle.emit("pointerdown", { ...pointer, clientX: 234 });
  app.handle.emit("pointermove", { ...pointer, clientX: 213 });
  assert.equal(app.root.style["--sidebar-width"], "72px");
  app.handle.emit("pointermove", { ...pointer, clientX: 237.99 });
  assert.equal(app.root.style["--sidebar-width"], "72px");
  app.handle.emit("pointermove", { ...pointer, clientX: 238 });
  assert.equal(app.root.style["--sidebar-width"], "224px");
  app.handle.emit("pointermove", { ...pointer, pointerId: 2, clientX: 999 });
  assert.equal(app.root.style["--sidebar-width"], "224px");
  assert.equal(app.root.dataset.sidebarDragging, "true");
  assert.equal(app.writes.length, 0);
  app.handle.emit("pointerup", pointer);
  assert.equal(app.root.dataset.sidebarDragging, undefined);
  assert.equal(app.handle.capture, null);
  assert.equal(app.writes.length, 1);
});

test("a new drag from collapsed width reopens; cancel, capture loss and blur release drag state", () => {
  for (const ending of ["pointercancel", "lostpointercapture", "blur"]) {
    const app = setup('{"width":280,"collapsed":true}');
    const pointer = { pointerId: 1, isPrimary: true, button: 0 };
    app.handle.emit("pointerdown", { ...pointer, clientX: 86 });
    app.handle.emit("pointermove", { ...pointer, clientX: 238 });
    assert.equal(app.root.style["--sidebar-width"], "224px");
    (ending === "blur" ? app.window : app.handle).emit(ending, pointer);
    assert.equal(app.root.dataset.sidebarDragging, undefined);
    assert.equal(app.writes.length, 1);
    app.handle.emit("pointermove", { ...pointer, clientX: 500 });
    assert.equal(app.root.style["--sidebar-width"], "224px");
  }
});

test("keyboard controls cross both thresholds and expose the visible width", () => {
  const app = setup();
  for (const [key, width] of [["Home", 72], ["ArrowRight", 224], ["ArrowLeft", 216], ["End", 320], ["Enter", 72], [" ", 320]]) {
    app.handle.emit("keydown", { key });
    assert.equal(app.root.style["--sidebar-width"], `${width}px`);
    assert.equal(app.handle.attributes["aria-valuenow"], String(width));
  }
});

test("storage access, read and write failures preserve working session controls", () => {
  for (const faults of [{ access: true }, { read: true }, { write: true }]) {
    const app = setup(undefined, faults);
    assert.deepEqual(app.beforeMount, { width: "220px", collapsed: "false" });
    assert.doesNotThrow(() => app.toggle.emit("click"));
    assert.equal(app.root.style["--sidebar-width"], "72px");
    if (faults.access || faults.write) assert.equal(app.warnings.length, 1);
  }
});
