import { readFileSync } from "./typescript-source.ts";
import path from "node:path";
import { existsSync } from "node:fs";
import { moduleDeclarations } from "./module-syntax.ts";
import { vueRendererImports, installColdRendererBoundary } from "./vue-renderer-boundary.ts";

function collectModuleGraph(root: string, entries: string[]) {
  const modules = new Set<string>();
  function visit(name: string) {
    const file = path.resolve(root, name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (modules.has(relative)) return;
    modules.add(relative);
    const source = readFileSync(file, "utf8");
    for (const declaration of moduleDeclarations(source, "source.js", "ui/" + relative)) {
      if (declaration.kind !== "import") continue;
      if (vueRendererImports.some(entry => entry.file === relative && entry.specifier === declaration.specifier)) {
        installColdRendererBoundary();
        continue;
      }
      visit(path.relative(root, path.resolve(path.dirname(file), declaration.specifier)));
    }
  }
  for (const entry of entries) visit(entry);
  return [...modules];
}

function collectBusinessScripts(root: string) {
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const tags = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)];
  const scripts = [];
  for (const tag of tags) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[1]);
    if (!src) continue;
    const name = src[1].replace(/^\.\//, "");
    const module = /\btype\s*=\s*["']module["']/i.test(tag[1]);
    const file = !module && !existsSync(path.join(root, name)) ? name.replace(/\.js$/, ".ts") : name;
    scripts.push({ file, module });
  }
  const ordinary = scripts.filter((script) => !script.module).map((script) => script.file);
  const entries = scripts.filter((script) => script.module).map((script) => script.file);
  const modules = collectModuleGraph(root, entries);
  const files: string[] = [];
  for (const script of scripts) {
    const names = script.module ? collectModuleGraph(root, [script.file]) : [script.file];
    for (const name of names) {
      if (!files.includes(name)) files.push(name);
      readFileSync(path.join(root, name), "utf8");
    }
  }
  const rendererFiles = [...new Set(vueRendererImports.filter(entry => modules.includes(entry.file)).map(entry => path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), entry.specifier))))];
  return rendererFiles.length ? { ordinary, entries, modules, files, rendererFiles } : { ordinary, entries, modules, files };
}

export { collectModuleGraph, collectBusinessScripts };

export type Contract = { collectModuleGraph: typeof collectModuleGraph; collectBusinessScripts: typeof collectBusinessScripts };
