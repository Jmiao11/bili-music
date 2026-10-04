const fs = require("node:fs");
const assert = require("node:assert/strict");
const { stripTypeScriptTypes } = require("node:module");

function stripTypes(source, file) {
  if (!String(file).endsWith(".ts")) return source;
  const { maskCommentsAndStrings } = require("./js-source.cjs");
  const code = maskCommentsAndStrings(source);
  if (/\bany\b/.test(code)) throw new Error(`${file}: explicit any is forbidden`);
  if (/@[A-Za-z_$]/.test(code)) throw new Error(`${file}: decorators are forbidden`);
  const erased = stripTypeScriptTypes(source, { mode: "strip" });
  assert.equal(erased.split("\n").length, source.split("\n").length, `${file}: type erasure changed line count`);
  return erased;
}

function readFileSync(file, options) {
  return stripTypes(fs.readFileSync(file, options), file);
}

module.exports = { stripTypes, readFileSync };
