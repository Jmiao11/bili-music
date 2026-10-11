import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import type { Component } from "vue";
import { vueFeatureFlags } from "../../scripts/vue/features.ts";
import type { createSyncRegion } from "../../ui/vue/sync-region.ts";

async function compilePagesRuntime(): Promise<{ PagesList: Component; createSyncRegion: typeof createSyncRegion }> {
  const project = path.resolve(import.meta.dirname, "../.."), output = fs.mkdtempSync(path.join(os.tmpdir(), "bili-pages-runtime-"));
  const entry = path.join(output, "entry.ts");
  const source = `import PagesList from ${JSON.stringify(path.join(project, "ui/components/PagesList.vue"))}; export { PagesList }; export { createSyncRegion } from ${JSON.stringify(path.join(project, "ui/vue/sync-region.ts"))};`;
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
