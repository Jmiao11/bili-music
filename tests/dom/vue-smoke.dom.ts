import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "vite";
import { JSDOM } from "jsdom";
import type { Component } from "vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";
import { nextDomEventTurn } from "./event-turn.ts";

test("Vite compiles the SFC fixture; Vue renders, handles click and unmounts in jsdom", async context => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "bili-vue-smoke-"));
  const dom = new JSDOM("<html><body></body></html>");
  const globals = { window: dom.window, document: dom.window.document, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let unmount: (() => void) | undefined;
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const { default: vue } = await import("@vitejs/plugin-vue");
    await build({
      configFile: false,
      root: path.resolve(import.meta.dirname, "../.."),
      plugins: [vue()],
      define: vueFeatureFlags,
      logLevel: "silent",
      build: {
        outDir: output,
        lib: { entry: "tests/fixtures/vue/ToolchainSmoke.vue", formats: ["es"], fileName: "fixture" },
        rolldownOptions: { external: ["vue"], output: { paths: { vue: import.meta.resolve("vue") } } },
      },
    });
    const { mount } = await import("@vue/test-utils");
    // Resolve the runtime directly; no directory link may point back into the project.
    const { default: component } = await import(pathToFileURL(path.join(output, "fixture.js")).href) as { default: Component };
    const selected: number[] = [];
    const wrapper = mount(component, { attachTo: dom.window.document.body, props: { snapshot: Object.freeze({ count: 4 }), onChoose: (count: number) => selected.push(count) } });
    unmount = () => wrapper.unmount();
    assert.equal(wrapper.get("button").text(), "4");
    await wrapper.get("button").trigger("click");
    assert.deepEqual(selected, [5]);
    wrapper.unmount();
    unmount = undefined;
    assert.equal(dom.window.document.querySelector("button"), null);
    await context.test("later synthetic input reaches its target without bypassing Vue timestamp protection", async () => {
      const { h, render } = await import("vue");
      const root = dom.window.document.createElement("div");
      dom.window.document.body.append(root);
      let captures = 0, clicks = 0, bubbles = 0, lateClicks = 0;
      const nativeNow = Date.now, mountedAt = nativeNow();
      const bubble = () => bubbles++;
      dom.window.addEventListener("click", bubble);
      try {
        Date.now = () => mountedAt;
        render(h("div", { onClickCapture: () => captures++ }, [h("button", { onClick: (event: MouseEvent) => { clicks++; event.stopPropagation(); } })]), root);
        root.querySelector("button")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
        assert.deepEqual([captures, clicks, bubbles], [1, 0, 1], "same-millisecond synthetic dispatch reproduces both old failures");
        Date.now = nativeNow;
        await nextDomEventTurn();
        root.querySelector("button")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
        assert.deepEqual([captures, clicks, bubbles], [2, 1, 1]);
        render(null, root);
        const child = () => h("button", {}, "child");
        render(h("div", { onClickCapture: () => render(h("div", { onClick: () => lateClicks++ }, [child()]), root) }, [child()]), root);
        await nextDomEventTurn();
        root.querySelector("button")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
        assert.equal(lateClicks, 0, "a listener attached during this event is still protected");
      } finally {
        Date.now = nativeNow;
        render(null, root); root.remove();
        dom.window.removeEventListener("click", bubble);
      }
    });
  } finally {
    unmount?.();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    assert.equal(path.dirname(output), os.tmpdir());
    fs.rmSync(output, { recursive: true, force: true });
  }
});
