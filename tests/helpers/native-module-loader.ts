import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { Session } from "node:inspector";
import { isTypeScript, stripTypes } from "./typescript-source.ts";

type RecordedEvent = { action: string; stack?: string; [key: string]: unknown };
type StubEventShape = { type: string };
async function loadNativeModules(sourceRoot: string, files: string[], entry: string, scripts = [{ file: entry, module: true }]) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bili-native-esm-")));
  const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const events: RecordedEvent[] = [];
  const listeners = new Map<string, ((event: StubEventShape) => void)[]>();
  const nodes = new Map<string, unknown>();
  const session = new Session();
  const post = ((method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  })) as { (method: "Profiler.takePreciseCoverage", params?: Record<string, unknown>): Promise<import("node:inspector").Profiler.TakePreciseCoverageReturnType>; (method: string, params?: Record<string, unknown>): Promise<unknown> };
  function install(name: PropertyKey, value: unknown) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  function add(target: string, type: string, handler: (event: StubEventShape) => void, options?: unknown) {
    events.push({ action: "listen", target, type, options: options ?? null, stack: new Error().stack });
    const key = `${target}:${type}`;
    if (!listeners.has(key)) listeners.set(key, []);
    const handlers = listeners.get(key);
    if (handlers === undefined) throw new Error("Event listener registry entry is missing");
    handlers.push(handler);
  }
  function dispatch(target: string, event: StubEventShape) {
    events.push({ action: "dispatch", target, type: event.type, stack: new Error().stack });
    for (const handler of listeners.get(`${target}:${event.type}`) || []) handler(event);
    return true;
  }
  function node(label: string): unknown {
    if (nodes.has(label)) return nodes.get(label);
    const values: Record<PropertyKey, unknown> = {
      value: "", textContent: "", innerHTML: "", dataset: {},
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      children: [], paused: true, currentTime: 0, duration: NaN, readyState: 0,
      addEventListener: (type: string, handler: (event: StubEventShape) => void, options?: unknown) => add(label, type, handler, options),
      getElementById: (id: string) => node(`#${id}`),
      removeEventListener() {}, dispatchEvent: (event: StubEventShape) => dispatch(label, event),
      querySelector: (selector: string) => node(selector), querySelectorAll: () => [],
      getAttribute: () => null, closest: () => null, contains: () => false,
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      then: undefined,
      [Symbol.iterator]: function* () {}, [Symbol.toPrimitive]: () => label,
    };
    const proxy: () => unknown = new Proxy(function (): unknown { return proxy; }, {
      get: (_, key) => key in values ? values[key] : node(`${label}.${String(key)}`),
      set: (_, key, value) => { values[key] = value; return true; },
    });
    nodes.set(label, proxy);
    return proxy;
  }
  const pending = () => new Promise(() => {});
  let observerId = 0;
  const observer = (name: string) => class {
    declare id: number;
    constructor(callback: unknown, options?: unknown) {
      this.id = ++observerId;
      events.push({ action: "observer", name, id: this.id, options: options ?? null });
    }
    observe(target: unknown, options?: unknown) {
      events.push({ action: "observe", id: this.id, target: String(target), options: options ?? null });
    }
    unobserve() {} disconnect() {}
  };
  class StubEvent {
    declare type: string;
    constructor(type: string, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() {} stopPropagation() {}
  }
  try {
    for (const name of files) {
      if (isTypeScript(name)) stripTypes(fs.readFileSync(path.join(sourceRoot, name), "utf8"), name);
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
      getItem: (key: unknown) => storage.get(String(key)) ?? null,
      setItem: (key: unknown, value: unknown) => storage.set(String(key), String(value)),
      removeItem: (key: unknown) => storage.delete(String(key)), clear: () => storage.clear(),
    });
    install("__TAURI__", { core: { invoke: pending }, event: { listen: pending, emit: pending, emitTo: pending } });
    install("addEventListener", (type: string, handler: (event: StubEventShape) => void, options?: unknown) => add("window", type, handler, options));
    install("removeEventListener", () => {});
    install("dispatchEvent", (event: StubEventShape) => dispatch("window", event));
    for (const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"]) install(name, observer(name));
    for (const name of ["Event", "CustomEvent"]) install(name, StubEvent);
    for (const name of ["requestAnimationFrame", "requestIdleCallback", "setTimeout", "setInterval"]) install(name, () => 0);
    for (const name of ["cancelAnimationFrame", "cancelIdleCallback", "clearTimeout", "clearInterval"]) install(name, () => {});
    install("matchMedia", (query: string) => ({ matches: false, addEventListener: (type: string, handler: (event: StubEventShape) => void, options?: unknown) => add(`matchMedia:${query}`, type, handler, options), removeEventListener() {} }));
    install("navigator", { userAgent: "", mediaSession: { setActionHandler() {} } });
    install("location", { href: "http://localhost/", origin: "http://localhost" });
    install("fetch", pending);
    install("Image", function () { return node("image"); });
    session.connect();
    await post("Profiler.enable");
    await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    let namespace;
    for (const script of scripts) {
      const logical = path.join(root, script.file);
      const file = fs.realpathSync(!script.module && !fs.existsSync(logical) ? logical.replace(/\.js$/, ".ts") : logical);
      if (script.module) namespace = await import(pathToFileURL(file).href);
      else vm.runInThisContext(stripTypes(fs.readFileSync(file, "utf8"), file), { filename: file });
    }
    const { result } = await post("Profiler.takePreciseCoverage");
    const coverage = result.filter((script) => script.url.startsWith(pathToFileURL(root).href));
    return { namespace, events, coverage };
  } finally {

    session.disconnect();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<PropertyKey, unknown>)[name];
    }
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export { loadNativeModules };

export type Contract = { loadNativeModules: typeof loadNativeModules };
