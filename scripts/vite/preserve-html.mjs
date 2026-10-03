import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

export function attribute(attributes, name) {
  return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attributes)?.[2];
}

export function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => ({
    tag: match[0], attributes: match[1], body: match[2],
    src: attribute(match[1], "src"),
    module: attribute(match[1], "type") === "module",
  }));
}

export function stylesheets(html) {
  return [...html.matchAll(/<link\b([^>]*)>/gi)]
    .filter((match) => attribute(match[1], "rel") === "stylesheet")
    .map((match) => ({ tag: match[0], href: attribute(match[1], "href") }));
}

export function replaceAttribute(tag, name, value) {
  return tag.replace(new RegExp(`(\\b${name}\\s*=\\s*)(["'])(.*?)\\2`, "i"),
    (_, prefix, quote) => `${prefix}${quote}${value}${quote}`);
}

export function preserveHtmlScripts() {
  let root;
  const ordinary = new Map();
  return {
    name: "preserve-html-scripts",
    apply: "build",
    configResolved(config) { root = config.root; },
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const source = readFileSync(context.filename, "utf8");
        const sourceScripts = scripts(source);
        for (const script of sourceScripts.filter((item) => item.src && !item.module)) {
          const fileName = path.relative(root, path.resolve(path.dirname(context.filename), script.src)).split(path.sep).join("/");
          assert.ok(!fileName.startsWith("../") && !path.isAbsolute(fileName), `Script outside ui: ${script.src}`);
          ordinary.set(fileName, readFileSync(path.join(root, fileName)));
        }
        const modules = sourceScripts.filter((item) => item.module);
        const builtModules = scripts(html).filter((item) => item.module);
        assert.equal(builtModules.length, modules.length, "Module entry count changed");
        const links = stylesheets(source);
        const builtLinks = stylesheets(html);
        assert.equal(builtLinks.length, links.length, "Stylesheet count changed");
        // ponytail: these two pages only reference local scripts/CSS; extend this mapping if HTML gains other build assets.
        let result = source;
        modules.forEach((script, index) => {
          result = result.replace(script.tag, replaceAttribute(script.tag, "src", builtModules[index].src));
        });
        links.forEach((link, index) => {
          result = result.replace(link.tag, replaceAttribute(link.tag, "href", builtLinks[index].href));
        });
        return result;
      },
    },
    generateBundle: {
      order: "post",
      handler() {
        for (const [fileName, source] of ordinary) this.emitFile({ type: "asset", fileName, source });
      },
    },
  };
}
