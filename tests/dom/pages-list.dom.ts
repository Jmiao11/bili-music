import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { fixture, track } from "./pages-fixture.ts";
import { compilePagesRuntime } from "./pages-runtime.ts";
import type { PagesSnapshot } from "../../ui/features/pages/pages-state.ts";

type Scenario = {
  name: string; modal: NonNullable<PagesSnapshot["modal"]>; disabled: number[]; pending: (number | null)[];
  currentBvid: string | null; currentCid: number | null; innerHTML: string;
};
const scenarios: Scenario[] = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../fixtures/vue/pages-list-baseline.json"), "utf8"));

test("Vue pages list matches the old renderer HTML matrix and adds only two empty fragment anchors", async t => {
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const dom = new JSDOM("<ul></ul>"), host = dom.window.document.querySelector("ul")!;
    const globals = { window: dom.window, document: dom.window.document, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement };
    const descriptors = new Map([...Object.keys(globals), "__VUE__"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    let unmount: (() => void) | undefined;
    try {
      for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
      const runtime = await compilePagesRuntime(); unmount = () => runtime.render(null,host);
      const key = scenario.modal.video.bvid.toLowerCase();
      const toggles: unknown[][] = [];
      runtime.render(runtime.h(runtime.PagesList, { modal: scenario.modal, disabledPages: new Map([[key, new Set(scenario.disabled)]]), pending: new Map(scenario.pending.length ? [[key, scenario.pending[0]]] : []),
        currentBvid: scenario.currentBvid, currentCid: scenario.currentCid, onPlay() {}, onToggle: async (...args: unknown[]) => { toggles.push(args); } }),host);
      assert.equal(host.innerHTML, scenario.innerHTML);
      const nonElements = [...host.childNodes].filter(node => node.nodeType !== 1);
      assert.deepEqual(nonElements.map(node => ({ type: node.nodeType, text: node.textContent })), [{ type: 3, text: "" }, { type: 3, text: "" }]);
      assert.equal(host.firstChild, nonElements[0]); assert.equal(host.lastChild, nonElements[1]);
      assert.equal(host.querySelectorAll("li").length, scenario.modal.pages.length);
      host.querySelector<HTMLButtonElement>(".pages-disable-button")?.click();
      const first = scenario.modal.pages[0];
      assert.deepEqual(toggles, first && !scenario.pending.length ? [[scenario.modal.video.bvid, first.cid, !scenario.disabled.includes(first.cid)]] : []);
    } finally {
      unmount?.(); dom.window.close();
      for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    }
  });
});

test("pages open disable restore and playback close produce no Vue warnings", async () => {
  const h = await fixture(); try {
    h.pages.openCurrentPagesModal(); h.raf(); h.reply(async () => []);
    h.nodes.pagesModalList.querySelector<HTMLButtonElement>(".pages-disable-button")!.click(); await h.microtasks();
    assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), true);
    h.nodes.pagesModalRestoreAll.click(); await h.microtasks();
    assert.equal(h.nodes.pagesModalList.children[0].classList.contains("is-disabled"), false);
    h.nodes.pagesModalList.querySelector<HTMLButtonElement>(".pages-list-button")!.click();
    assert.equal(h.bridge.played.length, 1);
    assert.equal(h.pages.getPagesSnapshot().modal, null);
    assert.deepEqual(h.warnings.filter(args => args.some(value => String(value).includes("[Vue warn]"))), []);
  } finally { h.dispose(); }
});

test("pages projection in the application tree renders inside the action before return", async () => {
  const h = await fixture(); try {
    h.pages.closePagesModal();
    let returned = false;
    const observations: { returned: boolean; text: string | null; buttons: number }[] = [];
    const stop = h.store.subscribe(state => { if (state.pages.modal) observations.push({ returned, text: h.nodes.pagesModalList.textContent, buttons: h.nodes.pagesModalList.querySelectorAll("button").length }); });
    try {
      h.store.actions.pages.open(track(1), 2, h.bridge.pages); returned = true;
      assert.deepEqual(observations, [{ returned: false, text: "1 · 一 · 1:00 · 当前2 · 二 · 1:30", buttons: 4 }]);
      h.pages.closePagesModal(); h.store.actions.pages.open(track(2), 2, h.bridge.pages);
      assert.equal(h.nodes.pagesModalList.querySelectorAll("li").length, 2);
    } finally { stop(); }
  } finally { h.dispose(); }
});
