const fs = require("./typescript-source.cjs");
const { stripTypes } = fs;
const { maskCommentsAndStrings } = require("./js-source.cjs");

// This accepts only this batch's static import/export grammar, not arbitrary ESM.
function moduleDeclarations(source, file = "source.js") {
  source = stripTypes(source, file);
  const code = maskCommentsAndStrings(source);
  const declarations = [];
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
    const match = pattern.exec(text);
    if (!match) throw new Error(`Unsupported module syntax: ${text.slice(0, 80)}`);
    declarations.push({ kind: keyword[0], names: match[1]?.split(",").map((name) => name.trim()).filter(Boolean) || [], specifier: keyword[0] === "import" ? match[2] : null, start: index, end: index + match[0].length });
    index += match[0].length - 1;
  }
  return declarations;
}

function stripModuleSyntax(source, file = "source.js") {
  source = stripTypes(source, file);
  let result = source;
  for (const declaration of moduleDeclarations(source).reverse()) {
    result = result.slice(0, declaration.start)
      + source.slice(declaration.start, declaration.end).replace(/[^\r\n]/g, "")
      + result.slice(declaration.end);
  }
  return result;
}

function readFileSync(file, options) {
  const source = fs.readFileSync(file, options);
  return /\.(?:js|ts)$/.test(String(file)) ? stripModuleSyntax(source) : source;
}

module.exports = { moduleDeclarations, stripModuleSyntax, readFileSync };
