const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const { isTypeScript, stripTypes }: { isTypeScript(file: string): boolean; stripTypes(source: string, file: string): string } = require("../../tests/helpers/typescript-source.cjs");
const { maskCommentsAndStrings, topLevelStatements }: { maskCommentsAndStrings(source: string): string; topLevelStatements(source: string): { text: string; start: number; end: number; code: string }[] } = require("../../tests/helpers/js-source.cjs");

function* htmlTags(html: string) {
  const start = /<\/?([a-z][\w:-]*)(?=[\s/>])/gi;
  for (let match; (match = start.exec(html));) {
    let quote = "";
    let end = start.lastIndex;
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === html.length) break;
    yield { name: match[1].toLowerCase(), closing: html[match.index + 1] === "/", start: match.index,
      end: end + 1, attributes: html.slice(start.lastIndex, end) };
    start.lastIndex = end + 1;
  }
}

function htmlIds(html: string) {
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  for (const name of ["script", "style"]) {
    const ranges: number[][] = [];
    let skippedUntil = 0;
    for (const tag of htmlTags(html)) {
      if (tag.start < skippedUntil || tag.closing || tag.name !== name) continue;
      const close = new RegExp(`</${name}\\s*>`, "gi");
      close.lastIndex = tag.end;
      const match = close.exec(html);
      const end = match ? match.index : html.length;
      ranges.push([tag.end, end]);
      skippedUntil = match ? close.lastIndex : html.length;
    }
    for (const [start, end] of ranges.reverse()) html = html.slice(0, start) + html.slice(end);
  }
  const ranges: number[][] = [];
  let depth = 0;
  let contentStart = 0;
  for (const tag of htmlTags(html)) {
    if (tag.name !== "template") continue;
    if (!tag.closing) { if (depth++ === 0) contentStart = tag.end; }
    else if (depth && --depth === 0) ranges.push([contentStart, tag.start]);
  }
  if (depth) ranges.push([contentStart, html.length]);
  for (const [start, end] of ranges.reverse()) html = html.slice(0, start) + html.slice(end);
  const ids = new Set();
  for (const tag of htmlTags(html)) {
    if (tag.closing) continue;
    const attribute = /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
    for (let match; (match = attribute.exec(tag.attributes));) {
      if (match[1].toLowerCase() !== "id") continue;
      const id = match[2] ?? match[3] ?? match[4] ?? "";
      if (ids.has(id)) throw new Error(`Duplicate HTML id: ${id}`);
      ids.add(id);
    }
  }
  return ids;
}

function declarationPosition(source: string, start: number) {
  const code = maskCommentsAndStrings(source);
  const braces: { start: number; functionBody: boolean }[] = [];
  const parentheses: number[] & { lastClosed?: number } = [];
  for (let i = 0; i < start; i++) {
    if (code[i] === "(") parentheses.push(i);
    if (code[i] === ")") {
      const open = parentheses.pop();
      if (open !== undefined) parentheses.lastClosed = open;
    }
    if (code[i] === "{") {
      const before = code.slice(0, i).trimEnd();
      const functionBody = before.endsWith("=>") || (before.endsWith(")")
        && /\bfunction(?:\s+[\w$]+)?\s*$/.test(code.slice(0, parentheses.lastClosed).trimEnd()));
      braces.push({ start: i + 1, functionBody });
    }
    if (code[i] === "}") braces.pop();
  }
  if (!braces.length) return !parentheses.length;
  const scope = braces[braces.length - 1];
  if (!scope.functionBody) return false;
  try {
    return topLevelStatements(source.slice(scope.start, start)).every(({ text }) =>
      /^\s*(?:const|let|function)\b/.test(maskCommentsAndStrings(text))
      || text.trim() === ";");
  } catch (_) {
    return false;
  }
}

type Assertion = { file: string; line: number; id: string };
function checkDomAssertions(source: string, file: string, html: string) {
  const erased = stripTypes(source, file);
  const code = maskCommentsAndStrings(erased);
  const originalCode = maskCommentsAndStrings(source);
  const errors: string[] = [];
  const assertions: Assertion[] = [];
  let ids;
  try { ids = htmlIds(html); }
  catch (error) { return { assertions, errors: [`${file}: ${(error as { message?: unknown }).message}`] }; }
  const fail = (index: number, reason: string) => errors.push(`${file}:${source.slice(0, index).split("\n").length}: ${reason}`);
  const validate = (start: number, end: number, expression: string) => {
    const declaration = /\b(?:const|let)\s+[\w$]+\s*=\s*$/.exec(code.slice(0, start));
    const dom = /^document\s*\.\s*(getElementById|querySelector)\s*\(\s*(["'])([^"'\\\r\n]+)\2\s*\)$/.exec(expression.trim());
    if (!declaration || !declarationPosition(erased, declaration.index)
      || !/^\s*;/.test(code.slice(end)) || !dom
      || (dom[1] === "querySelector" && !/^#[\w-]+$/.test(dom[3]))) {
      fail(start, "DOM assertion must initialize a module/function-top const/let with a literal id");
      return;
    }
    const id = dom[1] === "querySelector" ? dom[3].slice(1) : dom[3];
    if (!ids.has(id)) { fail(start, `DOM assertion id does not exist in HTML: ${id}`); return; }
    assertions.push({ file, line: source.slice(0, start).split("\n").length, id });
  };
  if (isTypeScript(file)) {
    for (let i = 0; i < source.length; i++) {
      // Erasure distinguishes postfix/definite-assignment assertions from logical !, strings and comments.
      if (originalCode[i] !== "!" || erased[i] !== " ") continue;
      const prefix = erased.slice(0, i);
      const match = /document\s*\.\s*(?:getElementById|querySelector)\s*\([^;{}]*\)\s*$/.exec(prefix);
      if (!match) fail(i, "non-DOM non-null assertion is forbidden");
      else validate(match.index, i + 1, match[0]);
    }
  }
  if (isTypeScript(file)) {
    for (const match of originalCode.matchAll(/\bas\s+(?:HTMLElement|HTML\w+Element)\s*(?=\))/g)) {
      if (erased[match.index] !== " ") continue;
      const end = match.index + match[0].length;
      let depth = 0;
      let open = match.index - 1;
      for (; open >= 0; open--) {
        if (code[open] === ")") depth++;
        if (code[open] === "(" && depth-- === 0) break;
      }
      const expression = erased.slice(open + 1, match.index).trim();
      if (/\bdocument\s*\.\s*(?:getElementById|querySelector)\s*\(/.test(maskCommentsAndStrings(expression)))
        validate(open, end + 1, expression);
    }
  }
  // JSDoc casts are erased comments in JS, so inspect the original cast and its enclosing declaration.
  const casts = /\/\*\*\s*@type\s*\{\s*(?:HTMLElement|HTML\w+Element)\s*\}\s*\*\/\s*\(/g;
  for (const match of source.matchAll(casts)) {
    const open = match.index + match[0].length - 1;
    if (code[open] !== "(") continue;
    let depth = 1;
    let end = open + 1;
    for (; end < code.length && depth; end++) {
      if (code[end] === "(") depth++;
      if (code[end] === ")") depth--;
    }
    const expression = erased.slice(open + 1, end - 1);
    if (/\bdocument\s*\.\s*(?:getElementById|querySelector)\s*\(/.test(maskCommentsAndStrings(expression)))
      validate(match.index, end, expression);
  }
  return { assertions, errors };
}

function checkRepository(root: string) {
  const all: (Assertion & { html: string })[] = [];
  const errors: string[] = [];
  for (const name of fs.readdirSync(path.join(root, "ui")).filter((name) => /\.(?:js|ts)$/.test(name))) {
    const file = `ui/${name}`;
    const html = /^mini\.(?:js|ts)$/.test(name) ? "ui/mini.html" : "ui/index.html";
    const result = checkDomAssertions(fs.readFileSync(path.join(root, file), "utf8"), file, fs.readFileSync(path.join(root, html), "utf8"));
    all.push(...result.assertions.map((assertion) => ({ ...assertion, html })));
    errors.push(...result.errors);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`DOM assertion guard: ${all.length} declarations verified.`);
  return all;
}

module.exports = { htmlIds, checkDomAssertions, checkRepository };
if (require.main === module) {
  try { checkRepository(path.resolve(__dirname, "../..")); }
  catch (error) { console.error((error as { message?: unknown }).message); process.exitCode = 1; }
}
