import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { readFileSync } from "./helpers/module-syntax.ts";

const ui = path.resolve(import.meta.dirname, "../ui");
const inline = readFileSync(path.join(ui, "startup-platform.ts"), "utf8") + "\ninitializeStartupPlatform();";

function startup({ failure = "", platform = "Windows" } = {}) {
  type Handler = { callback: () => void; once: boolean };
  const handlers = new Map<string, Handler[]>(), phases: string[] = [], calls: string[] = [], errors: unknown[][] = [];
  const root = { dataset: {} as Record<string, string> };
  const window = { onerror: null as (() => void) | null, addEventListener(type: string, callback: () => void, options?: { once?: boolean }) {
    const list = handlers.get(type) ?? []; list.push({ callback, once: options?.once === true }); handlers.set(type, list);
  } };
  const context = vm.createContext({ window, document: { documentElement: root }, navigator: { userAgent: platform },
    // src-tauri/src/main_window.rs:37: main_window_ready takes no frontend arguments and returns unit => null.
    invoke(command: string, ...args: unknown[]) { assert.equal(args.length, 0); calls.push(command); return Promise.resolve(null); },
    console: { error: (...args: unknown[]) => errors.push(args) },
  });
  const fire = (type: string) => {
    if (type === "error") window.onerror?.();
    for (const handler of [...handlers.get(type) ?? []]) {
      if (handler.once) handlers.set(type, (handlers.get(type) ?? []).filter(item => item !== handler));
      try { handler.callback(); } catch { if (type !== "error") fire("error"); }
    }
  };
  context.initializeSidebar = () => {};
  vm.runInContext(inline, context);
  vm.runInContext(readFileSync(path.join(ui, "main-window-ready.ts"), "utf8"), context);
  for (const name of ["initializeWindowControls", "initializeDynamicBackground", "startAppearance", "initializeLyrics", "initializeMascot", "startMiniPlayerHost"]) {
    context[name] = () => { phases.push(name); if (failure === name) throw Error("startup failed"); };
  }
  const run = () => {
    vm.runInContext(readFileSync(path.join(ui, "startup-before-main.ts"), "utf8"), context);
    vm.runInContext(readFileSync(path.join(ui, "app.ts"), "utf8"), context);
  };
  return { root, window, context, phases, calls, errors, fire, run };
}

test("main window readiness waits for startup and DOMContentLoaded then invokes once", () => {
  const h = startup(); h.run();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.phases, ["initializeWindowControls", "initializeDynamicBackground", "startAppearance", "initializeLyrics", "initializeMascot", "startMiniPlayerHost"]);
  h.fire("DOMContentLoaded");
  assert.deepEqual(h.calls, ["main_window_ready"]);
  assert.equal(h.root.dataset.startupComplete, "true");
  h.fire("DOMContentLoaded");
  assert.deepEqual(h.calls, ["main_window_ready"]);
});

test("any synchronous startup initializer failure prevents readiness", () => {
  for (const failure of ["initializeWindowControls", "initializeDynamicBackground", "startAppearance", "initializeLyrics", "initializeMascot", "startMiniPlayerHost"]) {
    const h = startup({ failure });
    assert.throws(h.run, /startup failed/);
    h.fire("DOMContentLoaded");
    assert.deepEqual(h.calls, []);
  }
});

test("a failed sidebar or earlier DOMContentLoaded handler prevents readiness", () => {
  const h = startup();
  vm.runInContext('window.addEventListener("DOMContentLoaded", () => { throw new Error("sidebar failed"); });', h.context);
  h.run(); h.fire("DOMContentLoaded");
  assert.equal(h.root.dataset.startupFailed, "true");
  assert.deepEqual(h.calls, []);
});

test("head startup failure is latched while errors after startup do not reopen the gate", () => {
  const failed = startup(); failed.fire("error"); failed.run(); failed.fire("DOMContentLoaded");
  assert.deepEqual(failed.calls, []);
  const healthy = startup(); healthy.run(); healthy.fire("DOMContentLoaded"); healthy.fire("error");
  assert.equal(healthy.window.onerror, null);
  assert.equal(healthy.root.dataset.startupFailed, undefined);
  assert.deepEqual(healthy.calls, ["main_window_ready"]);
});

test("head startup errors retain only a failure flag without reading or forwarding sensitive event fields", () => {
  const h = startup();
  vm.runInContext(`window.onerror({
    get message() { throw new Error("must not read URL, cookie, buvid3, b_nut or API Key"); },
    get error() { throw new Error("must not serialize the error object"); },
    get filename() { throw new Error("must not retain a script URL"); }
  });`, h.context);
  assert.deepEqual(h.root.dataset, { platform: "windows", startupFailed: "true" });
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.errors, []);
});

test("existing platform selection remains Windows or macOS with the startup latch", () => {
  assert.equal(startup().root.dataset.platform, "windows");
  assert.equal(startup({ platform: "Macintosh" }).root.dataset.platform, "macos");
});

test("readiness contract and registry expose unit without window show capability", () => {
  const root = path.join(ui, "..");
  const main = fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
  const contract = fs.readFileSync(path.join(root, "types/command-contract.d.ts"), "utf8");
  const capabilities = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/capabilities/default.json"), "utf8"));
  assert.match(main, /main_window::main_window_ready,/);
  assert.match(contract, /main_window_ready: \{ args: undefined; result: null \};/);
  assert.ok(!capabilities.permissions.includes("core:window:allow-show"));
});

test("readiness does not wait for startup asynchronous work", () => {
  const h = startup();
  h.context.startAppearance = () => new Promise(() => {});
  h.run(); h.fire("DOMContentLoaded");
  assert.deepEqual(h.calls, ["main_window_ready"]);
});
