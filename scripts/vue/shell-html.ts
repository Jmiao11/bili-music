import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "./features.ts";

async function renderApplicationHtml(root: string): Promise<string> {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "bili-shell-html-"));
  const dom = new JSDOM(fs.readFileSync(path.join(root, "ui/index.html"), "utf8"), { url: "http://localhost/" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, SVGElement: dom.window.SVGElement, Node: dom.window.Node, __VUE__: undefined })) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    Object.defineProperty(dom.window, "__TAURI__", { value: { core: { invoke: () => new Promise(() => {}) } } });
    const entry = path.join(output, "entry.ts");
    fs.writeFileSync(entry, `import ${JSON.stringify(path.join(root, "ui/root-mount.ts"))};`);
    await build({ configFile: false, root, logLevel: "silent", plugins: [vue()], define: vueFeatureFlags,
      resolve: { alias: { vue: path.join(root, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } },
      build: { outDir: path.join(output, "compiled"), minify: false, lib: { entry, formats: ["es"], fileName: "shell" } },
    });
    await import(pathToFileURL(path.join(output, "compiled/shell.js")).href);
    return "<!doctype html>\n" + dom.window.document.documentElement.outerHTML.replace(/ (checked|selected|disabled|hidden|data-[\w-]+)=""/g, " $1");
  } finally {
    dom.window.close();
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    fs.rmSync(output, { recursive: true, force: true });
  }
}

export { renderApplicationHtml };
