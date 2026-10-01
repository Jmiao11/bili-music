const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/sidebar.js"), "utf8");
const logic = vm.createContext({});
vm.runInContext(source, logic);
const plain = (value) => JSON.parse(JSON.stringify(value));
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
function element() {
  return {
    listeners: {}, attributes: {}, dataset: {}, textContent: "",
    addEventListener(type, fn) { this.listeners[type] = fn; },
    emit(type, extra = {}) { this.listeners[type]?.({ preventDefault() {}, ...extra }); },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function setup(saved, faults = {}) {
  const stored = new Map(saved === undefined ? [] : [[key, saved]]);
  const writes = [];
  const warnings = [];
  const root = element();
  root.style = { setProperty(name, value) { this[name] = value; } };
  const toggle = element();
  const text = element();
  toggle.querySelector = () => text;
  const handle = element();
  handle.setPointerCapture = (id) => { handle.capture = id; };
  handle.hasPointerCapture = (id) => handle.capture === id;
  handle.releasePointerCapture = () => { handle.capture = null; handle.emit("lostpointercapture"); };
  const sidebar = {
    getBoundingClientRect: () => ({ width: parseFloat(root.style["--sidebar-width"]) }),
    querySelectorAll: () => [],
  };
  const document = Object.assign(element(), {
    documentElement: root,
    querySelector: (selector) => ({ "#sidebar": sidebar, "#sidebar-toggle": toggle, "#sidebar-resize": handle })[selector],
  });
  const window = element();
  Object.defineProperty(window, "localStorage", { get() {
    if (faults.access) throw Error("blocked");
    return {
      getItem(name) { if (faults.read) throw Error("blocked"); return stored.get(name) ?? null; },
      setItem(name, value) {
        if (faults.write) throw Error("full");
        stored.set(name, value);
        writes.push([name, value]);
      },
    };
  } });
  vm.runInNewContext(source, { document, window, console: { warn: (...args) => warnings.push(args) } });
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
  assert.deepEqual(JSON.parse(app.stored.get(key)), { width: 287.125, collapsed: true });
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

test("unchanged mascot API and bubble cleanup work while the sidebar is collapsed", () => {
  const stage = element();
  stage.style = {};
  const classes = new Set();
  stage.classList = {
    add: (name) => classes.add(name), remove: (name) => classes.delete(name),
    contains: (name) => classes.has(name),
    toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
  };
  const slot = element();
  const bubble = element();
  const document = Object.assign(element(), {
    documentElement: { dataset: { sidebarCollapsed: "true" } }, hidden: false,
    querySelector: (selector) => ({ "#mascot-stage": stage, "#mascot-slot": slot, "#mascot-bubble": bubble })[selector] ?? null,
  });
  const timers = new Map();
  let timerId = 0;
  const window = Object.assign(element(), {
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInNewContext(readFileSync(path.join(__dirname, "../ui/mascot.js"), "utf8"), {
    document, window, localStorage: { getItem: () => null, setItem() {} },
  });
  const api = window.BiliMascot;
  assert.deepEqual(Object.keys(api), ["list", "getActive", "setActive"]);
  assert.ok(bubble.textContent); // Greeting still has its normal lifetime, even when CSS hides it.
  [...timers.values()].find(({ ms }) => ms === 4000).fn();
  assert.equal(bubble.hidden, true);
  assert.equal(bubble.textContent, "");
  for (const mascot of api.list()) {
    assert.equal(api.setActive(mascot.id), mascot.id);
    assert.equal(api.getActive(), mascot.id);
    assert.equal(bubble.hidden, true);
    assert.equal(bubble.textContent, "");
  }
  assert.equal(api.setActive("none"), "none");
  assert.equal(api.getActive(), "none");
  assert.equal(slot.innerHTML, "");
  assert.ok(classes.has("is-hidden"));
});
