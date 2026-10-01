const { readFileSync } = require("node:fs");
const path = require("node:path");
const { moduleDeclarations } = require("./module-syntax.cjs");

function collectModuleGraph(root, entries) {
  const modules = new Set();
  function visit(name) {
    const file = path.resolve(root, name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (modules.has(relative)) return;
    modules.add(relative);
    const source = readFileSync(file, "utf8");
    for (const declaration of moduleDeclarations(source)) {
      if (declaration.kind === "import") visit(path.relative(root, path.resolve(path.dirname(file), declaration.specifier)));
    }
  }
  for (const entry of entries) visit(entry);
  return [...modules];
}

function collectBusinessScripts(root) {
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const tags = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)];
  const scripts = [];
  for (const tag of tags) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[1]);
    if (!src) continue;
    scripts.push({ file: src[1].replace(/^\.\//, ""), module: /\btype\s*=\s*["']module["']/i.test(tag[1]) });
  }
  const ordinary = scripts.filter((script) => !script.module).map((script) => script.file);
  const entries = scripts.filter((script) => script.module).map((script) => script.file);
  const modules = collectModuleGraph(root, entries);
  const files = [];
  for (const script of scripts) {
    const names = script.module ? collectModuleGraph(root, [script.file]) : [script.file];
    for (const name of names) {
      if (!files.includes(name)) files.push(name);
      readFileSync(path.join(root, name), "utf8");
    }
  }
  return { ordinary, entries, modules, files };
}

module.exports = { collectModuleGraph, collectBusinessScripts };
