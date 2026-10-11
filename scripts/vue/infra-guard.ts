import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stripTypes } from "../../tests/helpers/typescript-source.ts";
import { maskCommentsAndStrings, topLevelStatements } from "../../tests/helpers/js-source.ts";
import { sourceImports } from "../tests/groups.ts";

const vueInfrastructure = ["vue/use-app-state.ts", "vue/sync-region.ts"];

function checkVueInfrastructure(source: string, file: string): void {
  const runtime = stripTypes(source, file).replace(/^import\b[^;]*;/gm, "").replace(/^export\s*\{[^}]*\};/gm, "");
  const code = maskCommentsAndStrings(runtime);
  assert.doesNotMatch(code, /\b(?:createApp|createRenderer|createHydrationRenderer|flushSync|queueJob|queueFlush|invoke|actions|window|document|__VUE__)\b/, `${file}: forbidden Vue infrastructure access`);
  const imports = sourceImports(source);
  assert.deepEqual(imports, file.endsWith("use-app-state.ts") ? ["vue", "vue", "../app-state.ts"] : ["vue", "vue"], `${file}: exact infrastructure imports`);
  for (const statement of topLevelStatements(runtime)) {
    assert.ok(/^function\b/.test(statement.code) || (file.endsWith("sync-region.ts") && /^const hosts\s*=\s*new WeakSet\s*\(\s*\)\s*;$/.test(statement.code)), `${file}: module evaluation must only declare infrastructure`);
  }
  if (file.endsWith("use-app-state.ts")) assert.match(code, /if\s*\(\s*!Object\.is\(selected\.value, next\)\s*\)\s*selected\.value\s*=\s*next/, "selector updates must explicitly compare Object.is");
}

function checkVueInfrastructureFiles(root: string): void {
  assert.deepEqual(fs.readdirSync(path.join(root, "ui/vue")).sort(), vueInfrastructure.map(file => path.basename(file)).sort(), "exact Vue infrastructure module inventory");
  for (const file of vueInfrastructure) checkVueInfrastructure(fs.readFileSync(path.join(root, "ui", file), "utf8"), file);
}

export { checkVueInfrastructure, checkVueInfrastructureFiles, vueInfrastructure };
