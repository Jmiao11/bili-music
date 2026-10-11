import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueFeatureFlags } from "./scripts/vue/features.ts";
import { preserveHtmlScripts, ordinaryTypeScriptScripts } from "./scripts/vite/preserve-html.ts";

const ui = fileURLToPath(new URL("./ui/", import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "ui",
  base: "./",
  publicDir: false,
  clearScreen: false,
  plugins: [preserveHtmlScripts(), ordinaryTypeScriptScripts(), vue()],
  define: vueFeatureFlags,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    modulePreload: false,
    minify: false,
    target: "esnext",
    sourcemap: false,
    rolldownOptions: {
      input: { main: `${ui}index.html`, mini: `${ui}mini.html` },
    },
  },
});
