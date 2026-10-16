import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import type { Component } from "vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";
import type { h, render } from "vue";
import type { createModalProjection, installModalBindings, pagesCallbacks } from "../../ui/root-modals.ts";

async function compilePagesRuntime(): Promise<{ PagesList: Component; h:typeof h; render:typeof render; createModalProjection:typeof createModalProjection; installModalBindings:typeof installModalBindings; pagesCallbacks:typeof pagesCallbacks }> {
  const project = path.resolve(import.meta.dirname, "../.."), output = fs.mkdtempSync(path.join(os.tmpdir(), "bili-pages-runtime-"));
  const entry = path.join(output, "entry.ts");
  const source = `import PagesList from ${JSON.stringify(path.join(project, "ui/components/PagesList.vue"))}; export { PagesList }; export { h, render } from "vue"; export {createModalProjection,installModalBindings,pagesCallbacks} from ${JSON.stringify(path.join(project,"ui/root-modals.ts"))};`;
  try {
    fs.writeFileSync(entry, source);
    await build({ configFile: false, root: project, logLevel: "silent", define: vueFeatureFlags,
      plugins: [vue()],
      resolve: { alias: { vue: path.join(project, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } },
      build: { outDir: path.join(output, "compiled"), minify: false, lib: { entry, formats: ["es"], fileName: "pages" } },
    });
    return await import(pathToFileURL(path.join(output, "compiled/pages.js")).href);
  } finally {
    if (path.dirname(output) !== os.tmpdir()) throw Error("Unsafe pages runtime cleanup");
    fs.rmSync(output, { recursive: true, force: true });
  }
}

export { compilePagesRuntime };
