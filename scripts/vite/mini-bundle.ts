import assert from "node:assert/strict";
import path from "node:path";
import { build, type Plugin, type ResolvedConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { preserveHtmlScripts } from "./preserve-html.ts";
import { vueFeatureFlags } from "../vue/features.ts";

export function miniWindowBundle(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "isolated-mini-window",
    apply: "build",
    configResolved(value) { config = value; },
    async generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) if (item.type === "chunk") {
        assert.equal(item.imports.length + item.dynamicImports.length, 0, "Main bundle must be self-contained");
      }
      const built = await build({ configFile: false, root: config.root, base: config.base, publicDir: false,
        logLevel: "silent", plugins: [preserveHtmlScripts(), vue()], define: vueFeatureFlags,
        build: { write: false, modulePreload: false, minify: config.build.minify, target: config.build.target, sourcemap: false,
          rolldownOptions: { input: { mini: path.join(config.root, "mini.html") }, output: { codeSplitting: false } } },
      });
      assert.ok(!Array.isArray(built) && "output" in built, "Unexpected mini build output");
      for (const item of built.output) {
        if (item.type === "chunk") {
          assert.equal(item.imports.length + item.dynamicImports.length, 0, "Mini bundle must be self-contained");
          this.emitFile({ type: "asset", fileName: item.fileName, source: item.code });
        } else this.emitFile({ type: "asset", fileName: item.fileName, source: item.source });
      }
    },
  };
}
