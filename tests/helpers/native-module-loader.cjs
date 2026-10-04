const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const { Session } = require("node:inspector");
const { stripTypes } = require("./typescript-source.cjs");

async function loadNativeModules(sourceRoot, files, entry, scripts = [{ file: entry, module: true }]) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bili-native-esm-")));
  const descriptors = new Map();
  const events = [];
  const listeners = new Map();
  const nodes = new Map();
  const session = new Session();
  const post = (method, params = {}) => new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
  function install(name, value) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  function add(target, type, handler, options) {
    events.push({ action: "listen", target, type, options: options ?? null, stack: new Error().stack });
    const key = `${target}:${type}`;
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push(handler);
  }
  function dispatch(target, event) {
    events.push({ action: "dispatch", target, type: event.type, stack: new Error().stack });
    for (const handler of listeners.get(`${target}:${event.type}`) || []) handler(event);
    return true;
  }
  function node(label) {
    if (nodes.has(label)) return nodes.get(label);
    const values = {
      value: "", textContent: "", innerHTML: "", dataset: {},
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      children: [], paused: true, currentTime: 0, duration: NaN, readyState: 0,
      addEventListener: (type, handler, options) => add(label, type, handler, options),
      getElementById: (id) => node(`#${id}`),
      removeEventListener() {}, dispatchEvent: (event) => dispatch(label, event),
      querySelector: (selector) => node(selector), querySelectorAll: () => [],
      getAttribute: () => null, closest: () => null, contains: () => false,
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      then: undefined,
      [Symbol.iterator]: function* () {}, [Symbol.toPrimitive]: () => label,
    };
    const proxy = new Proxy(function () { return proxy; }, {
      get: (_, key) => key in values ? values[key] : node(`${label}.${String(key)}`),
      set: (_, key, value) => { values[key] = value; return true; },
    });
    nodes.set(label, proxy);
    return proxy;
  }
  const pending = () => new Promise(() => {});
  let observerId = 0;
  const observer = (name) => class {
    constructor(callback, options) {
      this.id = ++observerId;
      events.push({ action: "observer", name, id: this.id, options: options ?? null });
    }
    observe(target, options) {
      events.push({ action: "observe", id: this.id, target: String(target), options: options ?? null });
    }
    unobserve() {} disconnect() {}
  };
  class StubEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() {} stopPropagation() {}
  }
  try {
    for (const name of files) {
      if (name.endsWith(".ts")) stripTypes(fs.readFileSync(path.join(sourceRoot, name), "utf8"), name);
      const target = path.resolve(root, name);
      assert.ok(!path.relative(root, target).startsWith(".."));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, name), target);
    }
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    const storage = new Map();
    const windowProxy = new Proxy(globalThis, {
      set(target, name, value) {
        if (!descriptors.has(name)) descriptors.set(name, Object.getOwnPropertyDescriptor(target, name));
        events.push({ action: "window-set", property: String(name), valueType: typeof value });
        return Reflect.set(target, name, value);
      },
    });
    install("window", windowProxy);
    install("self", windowProxy);
    install("document", node("document"));
    install("localStorage", {
      getItem: (key) => storage.get(String(key)) ?? null,
      setItem: (key, value) => storage.set(String(key), String(value)),
      removeItem: (key) => storage.delete(String(key)), clear: () => storage.clear(),
    });
    install("__TAURI__", { core: { invoke: pending }, event: { listen: pending, emit: pending, emitTo: pending } });
    install("addEventListener", (type, handler, options) => add("window", type, handler, options));
    install("removeEventListener", () => {});
    install("dispatchEvent", (event) => dispatch("window", event));
    for (const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"]) install(name, observer(name));
    for (const name of ["Event", "CustomEvent"]) install(name, StubEvent);
    for (const name of ["requestAnimationFrame", "requestIdleCallback", "setTimeout", "setInterval"]) install(name, () => 0);
    for (const name of ["cancelAnimationFrame", "cancelIdleCallback", "clearTimeout", "clearInterval"]) install(name, () => {});
    install("matchMedia", (query) => ({ matches: false, addEventListener: (type, handler, options) => add(`matchMedia:${query}`, type, handler, options), removeEventListener() {} }));
    install("navigator", { userAgent: "", mediaSession: { setActionHandler() {} } });
    install("location", { href: "http://localhost/", origin: "http://localhost" });
    install("fetch", pending);
    install("Image", function () { return node("image"); });
    session.connect();
    await post("Profiler.enable");
    await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    let namespace;
    for (const script of scripts) {
      const file = fs.realpathSync(path.join(root, script.file));
      if (script.module) namespace = await import(pathToFileURL(file).href);
      else vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
    }
    const { result } = await post("Profiler.takePreciseCoverage");
    const coverage = result.filter((script) => script.url.startsWith(pathToFileURL(root).href));
    return { namespace, events, coverage };
  } finally {
    session.disconnect();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { loadNativeModules };
