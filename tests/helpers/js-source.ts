import { stripTypes } from "./typescript-source.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { sourceSlice } from "./source-slice.ts";

// Reuse the existing scanner verbatim; do not execute the architecture tests.
const scannerSource = readFileSync(path.join(import.meta.dirname, "../architecture-guards.test.ts"), "utf8");
const maskCommentsAndStrings: (source: string) => string = vm.runInNewContext(
  sourceSlice(scannerSource, "architecture-guards.test.ts", "function maskCommentsAndStrings(", "function findStateWrites(", { stripModules: false })
    + "\nmaskCommentsAndStrings",
);

// Ratchet for the current classic scripts, not a complete JavaScript AST parser.
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
