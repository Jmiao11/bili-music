import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";

function isTypeScript(file: string) {
  return /\.(?:ts|cts|mts)$/.test(String(file));
}

function eraseTypes(source: string, file: string) {
  if (!isTypeScript(file)) return source;
  const erased = stripTypeScriptTypes(source, { mode: "strip" });
  assert.equal(erased.split("\n").length, source.split("\n").length, `${file}: type erasure changed line count`);
  return erased;
}

function stripTypes(source: string, file: string) {
  const erased = eraseTypes(source, file);
  if (!isTypeScript(file)) return erased;
  const { maskCommentsAndStrings }: import("./js-source.ts").Contract = createRequire(import.meta.url)("./js-source.ts");
  const code = maskCommentsAndStrings(source);
  if (/\bany\b/.test(code)) throw new Error(`${file}: explicit any is forbidden`);
  if (/@[A-Za-z_$]/.test(code)) throw new Error(`${file}: decorators are forbidden`);
  return erased;
}

function readFileSync(file: string, options: BufferEncoding) {
  return stripTypes(fs.readFileSync(file, options), file);
}

export { isTypeScript, eraseTypes, stripTypes, readFileSync };

export type Contract = { isTypeScript: typeof isTypeScript; eraseTypes: typeof eraseTypes; stripTypes: typeof stripTypes; readFileSync: typeof readFileSync };
