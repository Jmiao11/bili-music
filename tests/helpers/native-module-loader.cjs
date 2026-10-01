const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Session } = require("node:inspector");

async function loadNativeModules(sourceRoot, files, entry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-native-esm-"));
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
  function add(target, type, handler) {
    events.push({ action: "listen", target, type, stack: new Error().stack });
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
      addEventListener: (type, handler) => add(label, type, handler),
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
  class Observer { observe() {} unobserve() {} disconnect() {} }
  class StubEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() {} stopPropagation() {}
  }
  try {
    for (const name of files) {
      const target = path.resolve(root, name);
      assert.ok(!path.relative(root, target).startsWith(".."));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, name), target);
    }
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    const storage = new Map();
    install("window", globalThis);
    install("self", globalThis);
    install("document", node("document"));
    install("localStorage", {
      getItem: (key) => storage.get(String(key)) ?? null,
      setItem: (key, value) => storage.set(String(key), String(value)),
      removeItem: (key) => storage.delete(String(key)), clear: () => storage.clear(),
    });
    install("__TAURI__", { core: { invoke: pending }, event: { listen: pending, emit: pending, emitTo: pending } });
    install("addEventListener", (type, handler) => add("window", type, handler));
    install("removeEventListener", () => {});
    install("dispatchEvent", (event) => dispatch("window", event));
    for (const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"]) install(name, Observer);
    for (const name of ["Event", "CustomEvent"]) install(name, StubEvent);
    for (const name of ["requestAnimationFrame", "requestIdleCallback", "setTimeout", "setInterval"]) install(name, () => 0);
    for (const name of ["cancelAnimationFrame", "cancelIdleCallback", "clearTimeout", "clearInterval"]) install(name, () => {});
    install("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    install("navigator", { userAgent: "", mediaSession: { setActionHandler() {} } });
    install("location", { href: "http://localhost/", origin: "http://localhost" });
    install("fetch", pending);
    install("Image", function () { return node("image"); });
    session.connect();
    await post("Profiler.enable");
    await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    const namespace = await import(pathToFileURL(path.join(root, entry)).href);
    const { result } = await post("Profiler.takePreciseCoverage");
    const coverage = result.filter((script) => script.url.startsWith(pathToFileURL(root).href));
    return { namespace, events, coverage };
  } finally {
    session.disconnect();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { loadNativeModules };
