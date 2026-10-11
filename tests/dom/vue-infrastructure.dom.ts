import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, after, test } from "node:test";
import { build } from "vite";
import { JSDOM } from "jsdom";
import { createApplicationStore } from "../../ui/app-state.ts";
import type { HomeAdapter } from "../../ui/app-state.ts";
import { createStateStore } from "../../ui/state-store.ts";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";
import { checkVueInfrastructureFiles } from "../../scripts/vue/infra-guard.ts";

type Runtime = typeof import("../fixtures/vue/infra.ts");
const root = path.resolve(import.meta.dirname, "../..");
let output: string, imports = 0;
before(async () => {
  output = fs.mkdtempSync(path.join(os.tmpdir(), "bili-vue-infra-"));
  for (const mode of ["development", "production"]) await build({
    configFile: false, root, logLevel: "silent",
    define: { ...vueFeatureFlags, "process.env.NODE_ENV": JSON.stringify(mode) },
    build: { outDir: path.join(output, mode), minify: false, lib: { entry: "tests/fixtures/vue/infra.ts", formats: ["es"], fileName: "infra" } },
  });
});
after(() => {
  assert.equal(path.dirname(output), os.tmpdir());
  fs.rmSync(output, { recursive: true, force: true });
});

async function fixture(t: import("node:test").TestContext, mode = "development") {
  const dom = new JSDOM("<html><body><div id='host'></div></body></html>");
  const host = dom.window.document.getElementById("host");
  if (!host) throw new Error("Missing test host");
  const globals = { window: dom.window, document: dom.window.document, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement };
  const previous = new Map([...Object.keys(globals), "__VUE__"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const warnings: unknown[][] = [], errors: unknown[][] = [], rendererSignals: unknown[] = [];
  const warn = console.warn, error = console.error;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  console.error = (...args: unknown[]) => { errors.push(args); };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  let signal: unknown;
  Object.defineProperty(globalThis, "__VUE__", { configurable: true, get: () => signal, set: value => { signal = value; rendererSignals.push(value); } });
  const cleanup: (() => void)[] = [];
  t.after(() => {
    try { for (const dispose of cleanup.reverse()) dispose(); }
    finally {
      dom.window.close(); console.warn = warn; console.error = error;
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  // A fresh bundled module binds Vue's document and region registry to this test's window.
  const v = await import(pathToFileURL(path.join(output, mode, "infra.js")).href + `?fixture=${++imports}`) as Runtime;
  return { v, host, window: dom.window, warnings, errors, rendererSignals, cleanup };
}

function application() {
  const adapter: HomeAdapter = {
    invoke: () => { throw new Error("This fixture must not issue commands"); },
    setTimeout: () => { throw new Error("This fixture must not schedule work"); },
    clearTimeout: () => {}, report: () => {},
  };
  return createApplicationStore(adapter, { freeze: true });
}

test("importing Vue infrastructure neither creates a renderer nor writes globalThis.__VUE__", async t => {
  const f = await fixture(t);
  assert.deepEqual(f.rendererSignals, []);
  assert.equal(f.host.childNodes.length, 0);
  checkVueInfrastructureFiles(root);
  const Component = () => f.v.h("span", "first render");
  f.host.appendChild(f.window.document.createElement("span"));
  assert.throws(() => f.v.createSyncRegion(f.host, Component), /host must be empty/);
  f.host.replaceChildren();
  const dormant = f.v.createSyncRegion(f.host, Component);
  dormant.unmount();
  assert.deepEqual(f.rendererSignals, []);
  assert.equal(f.host.childNodes.length, 0);
  const region = f.v.createSyncRegion(f.host, Component); f.cleanup.push(region.unmount);
  assert.deepEqual(f.rendererSignals, []);
  assert.equal(f.host.childNodes.length, 0);
  region.update({});
  assert.deepEqual(f.rendererSignals, [true]);
  assert.equal(f.host.textContent, "first render");
});

test("useAppState preserves snapshot identity, reads current state and unsubscribes on scope disposal", async t => {
  const f = await fixture(t), store = application();
  store.actions.pages.beginModalQuery("before mount");
  let subscriptions = 0, removals = 0;
  const reader = { getState: store.getState, subscribe(listener: Parameters<typeof store.subscribe>[0]) {
    subscriptions++; const remove = store.subscribe(listener);
    return () => { removals++; remove(); };
  } };
  let selected: ReturnType<typeof f.v.useAppState<ReturnType<typeof store.getState>["pages"]>> | undefined;
  const scope = f.v.effectScope(); f.cleanup.push(() => scope.stop());
  scope.run(() => { selected = f.v.useAppState(reader, state => state.pages); });
  if (!selected) throw new Error("No selected state");
  assert.equal(selected.value, store.getState().pages);
  assert.equal(selected.value.requestVersion, 1);
  assert.equal(f.v.isReadonly(selected), true);
  assert.equal(f.v.isProxy(selected.value), false);
  assert.deepEqual(Object.keys(reader).sort(), ["getState", "subscribe"]);
  assert.throws(() => { (selected!.value as unknown as { requestVersion: number }).requestVersion = 99; }, TypeError);
  const old = selected.value;
  store.actions.pages.beginModalQuery("change");
  assert.notEqual(selected.value, old);
  assert.equal(selected.value, store.getState().pages);
  scope.stop();
  const disposed = selected.value;
  store.actions.pages.beginModalQuery("after disposal");
  assert.equal(selected.value, disposed);
  assert.deepEqual([subscriptions, removals], [1, 1]);
});

test("useAppState updates its ref immediately but DOM waits for nextTick; unrelated slices never render", async t => {
  const f = await fixture(t), store = application();
  let renders = 0, removals = 0;
  const reader = { getState: store.getState, subscribe(listener: Parameters<typeof store.subscribe>[0]) {
    const remove = store.subscribe(listener); return () => { removals++; remove(); };
  } };
  const Display = displayComponent(f.v);
  const Component = f.v.defineComponent({ setup() {
    const version = f.v.useAppState(reader, state => state.pages.requestVersion);
    return () => { renders++; return f.v.h(Display, { rows: [{ id: "a", text: String(version.value) }], disabled: version.value > 0, onPress: () => {} }); };
  } });
  const region = f.v.createSyncRegion(f.host, Component); f.cleanup.push(region.unmount); region.update({});
  const button = f.host.querySelector<HTMLButtonElement>("button[data-action]"); if (!button) throw new Error("Missing button");
  assert.deepEqual([f.host.querySelector("span")?.textContent, button.disabled, renders], ["0", false, 1]);
  store.actions.setHomeHint("unrelated"); await f.v.nextTick();
  assert.equal(renders, 1);
  store.actions.pages.beginModalQuery("change");
  assert.deepEqual([f.host.querySelector("span")?.textContent, button.disabled, renders], ["0", false, 1]);
  await f.v.nextTick();
  assert.deepEqual([f.host.querySelector("span")?.textContent, button.disabled, renders], ["1", true, 2]);
  region.unmount(); assert.equal(removals, 1);
  store.actions.pages.beginModalQuery("after unmount"); await f.v.nextTick();
  assert.equal(renders, 2);
});

type Props = { rows: readonly { id: string; text: string }[]; disabled: boolean; onPress: () => void };
function displayComponent(v: Runtime) {
  return (props: Props) => v.h("div", [
    v.h("span", props.rows.map(row => row.text).join(",")),
    ...props.rows.map(row => v.h("button", { key: row.id, "data-id": row.id }, row.text)),
    v.h("button", { "data-action": "", disabled: props.disabled, onClick: props.onPress }, "action"),
  ]);
}
function projectionStore(inspect: () => void) {
  return createStateStore({ rows: [{ id: "a", text: "old A" }, { id: "b", text: "old B" }], disabled: false }, (read, commit) => ({
    change(rows: Props["rows"]) { commit({ ...read(), rows, disabled: true }); inspect(); },
  }), { freeze: true });
}

for (const replace of [false, true]) test(`explicit region projection is synchronous inside the action; ${replace ? "replaced node loses focus" : "keyed nodes retain focus"}`, async t => {
  const f = await fixture(t); let inspected = 0;
  const store = projectionStore(() => {
    inspected++;
    assert.equal(f.host.querySelector("span")?.textContent, "new B,new A");
    assert.equal(f.host.querySelector<HTMLButtonElement>("button[data-action]")?.disabled, true);
    assert.equal(f.window.document.activeElement, replace ? f.window.document.body : original);
  });
  const Component = displayComponent(f.v);
  const region = f.v.createSyncRegion(f.host, Component); f.cleanup.push(region.unmount);
  const project = () => region.update({ ...store.getState(), onPress: () => {} });
  f.cleanup.push(store.subscribe(project)); project();
  const original = f.host.querySelector<HTMLButtonElement>("button[data-id='a']"); if (!original) throw new Error("Missing row");
  original.focus(); assert.equal(f.window.document.activeElement, original);
  store.actions.change([{ id: "b", text: "new B" }, { id: replace ? "replacement" : "a", text: "new A" }]);
  assert.equal(inspected, 1);
  assert.equal(original.isConnected, !replace);
  assert.equal(f.host.querySelector("button[data-id='a']"), replace ? null : original);
  await f.v.nextTick();
  assert.equal(f.window.document.activeElement, replace ? f.window.document.body : original);
});

test("region lifecycle clears its host and scope listeners; detached Vue DOM listeners are characterized", async t => {
  const f = await fixture(t); let clicks = 0, external = 0, scopes = 0;
  const listener = () => { external++; };
  const Component = f.v.defineComponent({ setup() {
    scopes++; f.window.addEventListener("probe", listener);
    f.v.onUnmounted(() => { scopes--; f.window.removeEventListener("probe", listener); });
    return () => f.v.h("button", { onClick: () => { clicks++; } }, "click");
  } });
  const region = f.v.createSyncRegion(f.host, Component); f.cleanup.push(region.unmount);
  assert.throws(() => f.v.createSyncRegion(f.host, Component), /already owns/);
  region.update({}); const button = f.host.querySelector("button"); if (!button) throw new Error("Missing button");
  region.update({}); assert.equal(f.host.querySelector("button"), button); assert.equal(scopes, 1);
  button.click(); f.window.dispatchEvent(new f.window.Event("probe"));
  assert.deepEqual([clicks, external], [1, 1]);
  region.unmount(); region.unmount();
  assert.equal(f.host.childNodes.length, 0); assert.equal(scopes, 0);
  f.window.dispatchEvent(new f.window.Event("probe")); assert.equal(external, 1);
  button.click(); assert.equal(clicks, 2, "Vue retains its event invoker on a retained detached node");
  assert.throws(() => region.update({}), /unmounted/);
  const next = f.v.createSyncRegion(f.host, Component); f.cleanup.push(next.unmount); next.update({});
  assert.equal(scopes, 1);
});

test("development component exceptions propagate from render and are reported by the store subscriber boundary", async t => {
  const f = await fixture(t), failure = new Error("component render failure"), reported: unknown[] = [];
  const Component = (props: { fail: boolean }) => { if (props.fail) throw failure; return f.v.h("span", "healthy"); };
  const region = f.v.createSyncRegion(f.host, Component); f.cleanup.push(region.unmount); region.update({ fail: false });
  assert.throws(() => region.update({ fail: true }), error => error === failure);
  assert.ok(f.warnings.length > 0);
  const store = createStateStore({ fail: false }, (read, commit) => ({ fail() { commit({ ...read(), fail: true }); } }), { onSubscriberError: error => { reported.push(error); } });
  f.cleanup.push(store.subscribe(state => region.update(state)));
  store.actions.fail(); assert.deepEqual(reported, [failure]);
});

test("production component exceptions are logged by Vue rather than silently swallowed", async t => {
  const f = await fixture(t, "production"), failure = new Error("production render failure");
  const Component = () => { throw failure; };
  const region = f.v.createSyncRegion(f.host, Component); f.cleanup.push(region.unmount);
  assert.doesNotThrow(() => region.update({}));
  assert.ok(f.errors.some(args => args.includes(failure)));
  assert.equal(f.host.textContent, "");
});
