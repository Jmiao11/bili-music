import { stripTypes } from "./typescript-source.ts";
import vm from "node:vm";

function maskCommentsAndStrings(source: string) {
  const masked = [...source];
  const hide = (index: number) => { if (source[index] !== "\n" && source[index] !== "\r") masked[index] = " "; };
  const startsRegex = (index: number) => {
    const before = source.slice(0, index).trimEnd();
    return !before || /[=([{,:;!?&|]$/.test(before) || /\b(?:return|throw|case|yield|await)\s*$/.test(before) || /=>\s*$/.test(before);
  };
  const stack: { mode: string; interpolationDepth: number | null }[] = [];
  let mode = "code";
  let interpolationDepth: number | null = null;

  for (let index = 0; index < source.length;) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "template") {
      if (char === "\\") { hide(index++); if (index < source.length) hide(index++); }
      else if (char === "`") {
        hide(index++);
        const previous = stack.pop();
        if (previous === undefined) throw new Error("Template scanner stack is empty");
        ({ mode, interpolationDepth } = previous);
      } else if (char === "$" && next === "{") {
        hide(index++); hide(index++);
        mode = "code";
        interpolationDepth = 0;
      } else hide(index++);
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") hide(index++);
    } else if (char === "/" && next === "*") {
      hide(index++); hide(index++);
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) hide(index++);
      if (index < source.length) { hide(index++); hide(index++); }
    } else if (char === "\"" || char === "'") {
      const quote = char;
      hide(index++);
      while (index < source.length) {
        const current = source[index];
        hide(index++);
        if (current === "\\" && index < source.length) hide(index++);
        else if (current === quote) break;
      }
    } else if (char === "/" && startsRegex(index)) {
      hide(index++);
      let inClass = false;
      while (index < source.length) {
        const current = source[index];
        hide(index++);
        if (current === "\\" && index < source.length) hide(index++);
        else if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
      }
      while (/[a-z]/i.test(source[index] ?? "")) hide(index++);
    } else if (char === "`") {
      stack.push({ mode, interpolationDepth });
      hide(index++);
      mode = "template";
    } else if (interpolationDepth !== null && char === "{") {
      interpolationDepth++;
      index++;
    } else if (interpolationDepth !== null && char === "}") {
      if (interpolationDepth === 0) { hide(index++); mode = "template"; }
      else { interpolationDepth--; index++; }
    } else index++;
  }
  return masked.join("");
}

// Small fixture scanner; TypeScript and Vue compilers validate product modules.
function topLevelStatements(source: string, file = "source.js") {
  source = stripTypes(source, file);
  const code = maskCommentsAndStrings(source);
  const statements = [];
  let start = 0;
  let braces = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < code.length; index++) {
    if (start === index && /\s/.test(code[index])) { start++; continue; }
    const char = code[index];
    if (char === "{") braces++;
    if (char === "}") braces--;
    if (char === "(") parentheses++;
    if (char === ")") parentheses--;
    if (char === "[") brackets++;
    if (char === "]") brackets--;
    if (braces || parentheses || brackets || ![";", "}"].includes(char)) continue;
    const declaration = /^(?:const|let|var)\b/.test(code.slice(start));
    if (declaration && char !== ";") continue;
    if (/^\s*(?:else|catch|finally)\b/.test(code.slice(index + 1))) continue;
    const text = source.slice(start, index + 1);
    try { new vm.Script(text); } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    statements.push({ text, start, end: index + 1, code: code.slice(start, index + 1) });
    start = index + 1;
  }
  if (code.slice(start).trim()) throw new Error("Incomplete top-level statement");
  return statements;
}

export { maskCommentsAndStrings, topLevelStatements };

export type Contract = { maskCommentsAndStrings: typeof maskCommentsAndStrings; topLevelStatements: typeof topLevelStatements };
