import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";
import type { ApplicationStore } from "../../ui/store/application-store.ts";

test("root mounts before all player DOM queries and preserves controller writes through 1000 synchronous renders", async () => {
  const project = path.resolve(import.meta.dirname, "../.."), output = fs.mkdtempSync(path.join(os.tmpdir(), "bili-root-shell-"));
  const html = fs.readFileSync(path.join(project, "ui/index.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, SVGElement: dom.window.SVGElement, Node: dom.window.Node, __VUE__: undefined })) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    Object.defineProperty(dom.window, "__TAURI__", { value: { core: { invoke: () => new Promise(() => {}) } } });
    const entry = path.join(output, "entry.ts");
    fs.writeFileSync(entry, `import ${JSON.stringify(project + "/ui/app/root-mount.ts")}; export * as nodes from ${JSON.stringify(project + "/ui/platform/main-window-refs.ts")}; export { readApplicationStore } from ${JSON.stringify(project + "/ui/store/application-store.ts")}; export { setRootPlaylistList } from ${JSON.stringify(project + "/ui/features/tracks/root-lists.ts")};`);
    await build({ configFile: false, root: project, logLevel: "silent", plugins: [vue()], define: vueFeatureFlags,
      resolve: { alias: { vue: path.join(project, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } },
      build: { outDir: path.join(output, "compiled"), minify: false, lib: { entry, formats: ["es"], fileName: "root" } },
    });
    const loaded = await import(pathToFileURL(path.join(output, "compiled/root.js")).href) as { nodes: Record<string, Element | Element[] | NodeListOf<Element> | null>; readApplicationStore(): ApplicationStore; setRootPlaylistList(rows: readonly never[]): void };
    for (const [name, node] of Object.entries(loaded.nodes)) assert.ok(node !== null, "Missing early DOM handle: " + name);
    const doc = dom.window.document, title = doc.querySelector<HTMLElement>("#placeholder-title")!, input = doc.querySelector<HTMLInputElement>("#search-keyword")!, host = doc.querySelector<HTMLElement>("#mascot-slot")!;
    title.classList.add("controller-class"); title.setAttribute("data-controller", "kept"); title.textContent = "控制器内容";
    const child = doc.createElement("button"); child.textContent = "控制器子节点"; host.append(child); input.value = "搜索草稿未提交";
    const store = loaded.readApplicationStore();
    for (let i = 0; i < 1000; i++) {
      loaded.setRootPlaylistList([]);
      store.actions.library.setModalName("unrelated" + i);
      assert.equal(doc.querySelector("#placeholder-title"), title);
      assert.equal(title.textContent, "控制器内容");
      assert.equal(title.classList.contains("controller-class"), true);
      assert.equal(title.getAttribute("data-controller"), "kept");
      assert.equal(host.firstChild, child);
      assert.equal(doc.querySelector("#search-keyword"), input);
      assert.equal(input.value, "搜索草稿未提交");
    }
    assert.ok(!doc.querySelector("#app")!.contains(doc.querySelector("#audio")));
  } finally {
    dom.window.close();
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    if (path.dirname(output) !== os.tmpdir()) throw new Error("Unsafe temporary runtime cleanup");
    fs.rmSync(output, { recursive: true, force: true });
  }
});
