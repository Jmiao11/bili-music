import * as fs from "./typescript-source.ts";
const { stripTypes } = fs;
import { maskCommentsAndStrings } from "./js-source.ts";

type Declaration = { names: string[]; start: number; end: number } & ({ kind: "import"; specifier: string } | { kind: "export"; specifier: null });

// Extract static declarations for VM tests; product ESM is checked by its compiler.
function moduleDeclarations(source: string, file = "source.js") {
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
    const pattern = keyword[0] === "import"
      ? /^import\s+(?:(?:\{\s*([^}]*?)\s*\}|([A-Za-z_$][\w$]*))\s+from\s+)?["']([^"'\r\n]+)["']\s*;/
      : new RegExp(String.raw`^export\s*\{\s*(${names})?\s*\}\s*;`);
    const raw = pattern.exec(text);
    const match = raw && keyword[0] === "import" ? [raw[0],raw[1] ?? raw[2],raw[3]] : raw;
    if (!match) throw new Error(`Unsupported module syntax: ${text.slice(0, 80)}`);
    declarations.push({ kind: keyword[0], names: match[1]?.split(",").map((name) => name.trim()).filter(Boolean) || [], specifier: keyword[0] === "import" ? match[2] : null, start: index, end: index + match[0].length } as Declaration);
    index += match[0].length - 1;
  }
  return declarations;
}

function stripModuleSyntax(source: string, file = "source.js") {
  source = stripTypes(source, file);
  let result = source;
  for (const declaration of moduleDeclarations(source, "source.js").reverse()) {
    result = result.slice(0, declaration.start)
      + source.slice(declaration.start, declaration.end).replace(/[^\r\n]/g, "")
      + result.slice(declaration.end);
  }
  return result;
}

function readFileSync(file: string, options: BufferEncoding) {
  const source = fs.readFileSync(file, options);
  return /\.(?:js|ts)$/.test(String(file)) ? stripModuleSyntax(source, "source.js") : source;
}

export { moduleDeclarations, stripModuleSyntax, readFileSync };

export type Contract = { moduleDeclarations: typeof moduleDeclarations; stripModuleSyntax: typeof stripModuleSyntax; readFileSync: typeof readFileSync };
