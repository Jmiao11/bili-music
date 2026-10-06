const assert = require("node:assert/strict");
const { stripTypeScriptTypes } = require("node:module");
const vm = require("node:vm");
const { test } = require("node:test");
const { isTypeScript, eraseTypes, stripTypes } = require("./helpers/typescript-source.cjs");
const { sourceSlice } = require("./helpers/source-slice.cjs");

test("source erasure handles ts/cts/mts and preserves legacy JS, coordinates and CRLF", () => {
  const source = "function score(value: number): number { return value + 1; }\n// end runtime\n";
  const previous = "function score(value        )         { return value + 1; }\n// end runtime\n";
  for (const extension of ["ts", "cts", "mts"]) {
    for (const text of [source, source.replace(/\n/g, "\r\n")]) {
      const file = `sample.${extension}`;
      const erased = stripTypes(text, file);
      assert.equal(isTypeScript(file), true);
      assert.equal(erased, stripTypeScriptTypes(text, { mode: "strip" }));
      if (text === source) assert.equal(erased, previous);
      assert.equal(erased.length, text.length);
      for (const token of ["function", "return", "// end runtime"]) assert.equal(erased.indexOf(token), text.indexOf(token));
      assert.deepEqual([...erased.matchAll(/\r?\n/g)].map((match) => [match.index, match[0]]),
        [...text.matchAll(/\r?\n/g)].map((match) => [match.index, match[0]]));
      const slice = sourceSlice(text, file, "function score(", "// end runtime");
      assert.equal(slice, sourceSlice(erased, "sample.cjs", "function score(", "// end runtime"));
      assert.equal(vm.runInNewContext(slice + "\nscore(41)"), 42);
    }
  }
  for (const extension of ["js", "cjs", "mjs"]) {
    assert.equal(isTypeScript(`sample.${extension}`), false);
    assert.equal(eraseTypes(source, `sample.${extension}`), source);
    assert.equal(stripTypes(source, `sample.${extension}`), source);
  }
});

test("scanner bootstrap erases the whole CTS/MTS file without scanner dependencies and keeps syntax guards", () => {
  const source = 'interface Label { value: string; }\nfunction mask(value: string) { return value; }\n// end scanner\n';
  for (const file of ["sample.cts", "sample.mts"]) {
    const slice = sourceSlice(source, file, "function mask(", "// end scanner", { stripModules: false });
    assert.equal(vm.runInNewContext(slice + '\nmask("runtime")'), "runtime");
    assert.throws(() => sourceSlice("const value: any = 1;\n// end", file, null, "// end"), /explicit any/);
    assert.throws(() => eraseTypes("enum E { A }", file));
  }
});
