import * as fs from "./typescript-source.ts";
const { stripTypes } = fs;
import { maskCommentsAndStrings } from "./js-source.ts";
import { vueRendererImports } from "./vue-renderer-boundary.ts";

type Declaration = { names: string[]; start: number; end: number } & ({ kind: "import"; specifier: string } | { kind: "export"; specifier: null });

// This accepts only this batch's static import/export grammar, not arbitrary ESM.
function moduleDeclarations(source: string, file = "source.js", grammarFile = file) {
  source = stripTypes(source, file);
  const code = maskCommentsAndStrings(source);
  const declarations: Declaration[] = [];
  let depth = 0;
  for (let index = 0; index < code.length; index++) {
    if ("{([".includes(code[index])) depth++;
    if ("})]".includes(code[index])) depth--;
    const keyword = /^(import|export)\b/.exec(code.slice(index));
    if (!keyword || /[\w$.]/.test(code[index - 1] || "") || /^\s*:/.test(code.slice(index + keyword[0].length))) continue;
    if (depth !== 0) throw new Error("Module declaration must be top-level");
    const text = source.slice(index);
    const names = String.raw`[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*,?`;
    const relative = String.raw`["'](\./[^"'\r\n]+\.(?:js|ts))["']`;
    const pattern = keyword[0] === "import"
      ? new RegExp(String.raw`^import\s+(?:\{\s*(${names})\s*\}\s+from\s+)?${relative}\s*;`)
      : new RegExp(String.raw`^export\s*\{\s*(${names})?\s*\}\s*;`);
    const registered = vueRendererImports.find(entry => grammarFile.replace(/\\/g, "/").endsWith("ui/" + entry.file) && text.startsWith(entry.declaration));
    const match = registered ? [registered.declaration, registered.name, registered.specifier] : pattern.exec(text);
    if (!match) throw new Error(`Unsupported module syntax: ${text.slice(0, 80)}`);
    declarations.push({ kind: keyword[0], names: match[1]?.split(",").map((name) => name.trim()).filter(Boolean) || [], specifier: keyword[0] === "import" ? match[2] : null, start: index, end: index + match[0].length } as Declaration);
    index += match[0].length - 1;
  }
  return declarations;
}

function stripModuleSyntax(source: string, file = "source.js", grammarFile = file) {
  source = stripTypes(source, file);
  let result = source;
  for (const declaration of moduleDeclarations(source, "source.js", grammarFile).reverse()) {
    result = result.slice(0, declaration.start)
      + source.slice(declaration.start, declaration.end).replace(/[^\r\n]/g, "")
      + result.slice(declaration.end);
  }
  return result;
}

function readFileSync(file: string, options: BufferEncoding) {
  const source = fs.readFileSync(file, options);
  return /\.(?:js|ts)$/.test(String(file)) ? stripModuleSyntax(source, "source.js", String(file)) : source;
}

export { moduleDeclarations, stripModuleSyntax, readFileSync };

export type Contract = { moduleDeclarations: typeof moduleDeclarations; stripModuleSyntax: typeof stripModuleSyntax; readFileSync: typeof readFileSync };
