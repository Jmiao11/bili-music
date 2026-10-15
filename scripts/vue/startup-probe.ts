import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { stripTypeScriptTypes, findSourceMap } from "node:module";
import { Session } from "node:inspector";
import { JSDOM } from "jsdom";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "./features.ts";

type RecordedEvent = { action: string; stack?: string; [key: string]: unknown };

async function loadMountedApplication(sourceRoot: string, _files: string[] = [], entry = "app.ts", scripts = [{ file: entry, module: true }], options: { completeStartup?: boolean; recordIpc?: boolean } = {}) {
  const project = path.resolve(import.meta.dirname, "../.."), root = fs.mkdtempSync(path.join(os.tmpdir(), "bili-mounted-startup-"));
  const html = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/" });
  const events: RecordedEvent[] = [], descriptors = new Map<string, PropertyDescriptor | undefined>();
  const session = new Session();
  const oldSourceMaps = process.sourceMapsEnabled;
  process.setSourceMapsEnabled(true);
  const post = <T>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result as T));
  });
  const labels = new WeakMap<object, string>();
  const ipcHandlers = new Map<string, (event: { payload: null }) => void>();
  let initialTrackEvent: Event | null = null;
  const label = (target: object): string => {
    if (target === dom.window) return "window";
    if (target === dom.window.document) return "document";
    if (target instanceof dom.window.Element && target.id) return "#" + target.id;
    return labels.get(target) ?? (target instanceof dom.window.Element ? target.tagName.toLowerCase() : "unknown");
  };
  const pending = (): Promise<never> => new Promise<never>(() => {});
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const record = (event: RecordedEvent) => {
    const stack = new Error().stack?.replace(/([A-Za-z]:\\[^\n()]+?\.ts:\d+:\d+)/g, value => "file:///" + value.replaceAll("\\", "/")).replace(/at Object\.<anonymous> \(file:(.*?)\)/g, "at file:$1");
    events.push({ ...event, stack });
  };
  let observerId = 0;
  const observer = (name: string) => class {
    id: number;
    constructor(_callback: unknown, options?: unknown) { this.id = ++observerId; record({ action: "observer", name, id: this.id, options: options ?? null }); }
    observe(target: object, options?: unknown) { record({ action: "observe", id: this.id, target: label(target), options: options ?? null }); }
    unobserve() {} disconnect() {}
  };
  try {
    let bundle = path.join(sourceRoot, entry);
    if (entry.endsWith(".ts")) {
      await build({ configFile: false, root: sourceRoot, logLevel: "silent", plugins: [vue()], define: vueFeatureFlags,
        resolve: { alias: { vue: path.join(project, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } },
        build: { outDir: path.join(root, "compiled"), minify: false, sourcemap: true, lib: { entry: bundle, formats: ["es"], fileName: "startup" } },
      });
      bundle = path.join(root, "compiled/startup.js");
    }
    const win = dom.window as typeof dom.window & { Document: typeof Document; CustomEvent: typeof CustomEvent; Image: typeof Image };
    const query = win.Document.prototype.querySelector;
    win.Document.prototype.querySelector = function(this: Document, selector: string) { const result = query.call(this, selector); if (result) labels.set(result, selector); return result; } as typeof query;
    const nativeAdd = win.EventTarget.prototype.addEventListener;
    win.EventTarget.prototype.addEventListener = function(type, callback, options) {
      record({ action: "listen", target: label(this), type, options: options ?? null });
      nativeAdd.call(this, type, callback, options);
    };
    const nativeDispatch = win.EventTarget.prototype.dispatchEvent;
    win.EventTarget.prototype.dispatchEvent = function(event) {
      record({ action: "dispatch", target: label(this), type: event.type });
      if (event.type === "bilibili-music-trackchange" && initialTrackEvent === null) initialTrackEvent = event;
      return nativeDispatch.call(this, event);
    };
    const proxy = new Proxy(win, { set(target, key, value) { record({ action: "window-set", property: String(key), valueType: typeof value }); return Reflect.set(target, key, value); } });
    labels.set(proxy, "window");
    Object.defineProperty(win, "__TAURI__", { value: { core: { invoke: (command: string, args: unknown) => {
      if (options.recordIpc) record({ action: "invoke", command, args: args ?? null });
      return command === "main_window_ready" ? Promise.resolve(null) : pending();
    } }, event: {
      listen: (type: string, handler: (event: { payload: null }) => void) => {
        if (!options.recordIpc) return pending();
        record({ action: "ipc-listen", type }); ipcHandlers.set(type, handler); return Promise.resolve(() => {});
      }, emit: pending, emitTo: (target: string, type: string, payload: unknown) => {
        if (options.recordIpc) record({ action: "ipc-emitTo", target, type, payload });
        return pending();
      },
    } } });
    Object.defineProperty(win, "matchMedia", { value: (query: string) => ({ matches: false, addEventListener: (type: string, _handler: unknown, options?: unknown) => record({ action: "listen", target: "matchMedia:" + query, type, options: options ?? null }), removeEventListener() {} }) });
    win.HTMLElement.prototype.scrollIntoView = () => {};
    for (const method of ["play", "pause", "load"] as const) Object.defineProperty(win.HTMLMediaElement.prototype, method, { value: method === "play" ? async () => {} : () => {} });
    for (const [name, value] of Object.entries({ window: proxy, self: proxy, document: win.document, navigator: win.navigator, location: win.location, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
      HTMLElement: win.HTMLElement, Element: win.Element, SVGElement: win.SVGElement, Node: win.Node, Event: win.Event, CustomEvent: win.CustomEvent, Image: win.Image, __VUE__: undefined,
      MutationObserver: observer("MutationObserver"), IntersectionObserver: observer("IntersectionObserver"), ResizeObserver: observer("ResizeObserver"),
      requestAnimationFrame: (): number => 0, cancelAnimationFrame() {}, setTimeout: (): number => 0, clearTimeout() {}, setInterval: (): number => 0, clearInterval() {}, fetch: pending,
    })) install(name, value);
    win.setTimeout = () => 0; win.clearTimeout = () => {}; win.requestAnimationFrame = () => 0;
    session.connect(); await post("Profiler.enable"); await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    let namespace: unknown;
    for (const script of scripts) {
      if (script.module) namespace = await import(pathToFileURL(bundle).href);
      else {
        let file = path.join(sourceRoot, script.file);
        if (!fs.existsSync(file)) file = file.replace(/\.js$/, ".ts");
        const source = fs.readFileSync(file, "utf8");
        vm.runInThisContext(file.endsWith(".ts") ? stripTypeScriptTypes(source) : source, { filename: file });
      }
    }
    if (options.completeStartup) {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      win.document.dispatchEvent(new win.Event("DOMContentLoaded", { bubbles: true }));
      ipcHandlers.get("mini-player-ready")?.({ payload: null });
      for (let i = 0; i < 8; i++) await Promise.resolve();
      if (initialTrackEvent) win.dispatchEvent(initialTrackEvent);
    }
    const { result } = await post<import("node:inspector").Profiler.TakePreciseCoverageReturnType>("Profiler.takePreciseCoverage");
    const coverage = result.filter(script => script.url === pathToFileURL(bundle).href);
    const mapped = findSourceMap(bundle);
    if (mapped) {
      const code = fs.readFileSync(bundle, "utf8");
      for (const script of [...coverage]) for (const fn of script.functions.filter(fn => fn.functionName === "startAppearance")) {
        const prefix = code.slice(0, fn.ranges[0].startOffset), lines = prefix.split("\n");
        const original = mapped.findEntry(lines.length - 1, lines.at(-1)!.length);
        if ("originalSource" in original && original.originalSource) coverage.push({ ...script, url: original.originalSource, functions: [fn] });
      }
    }
    return { namespace, events, coverage };
  } finally {
    session.disconnect();
    dom.window.close();
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    process.setSourceMapsEnabled(oldSourceMaps);
    if (path.dirname(root) !== os.tmpdir()) throw new Error("Unsafe temporary runtime cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export { loadMountedApplication };
