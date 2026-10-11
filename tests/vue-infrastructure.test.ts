import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkVueInfrastructure, checkVueInfrastructureFiles, vueInfrastructure } from "../scripts/vue/infra-guard.ts";
import { collectBusinessScripts } from "./helpers/module-graph.ts";

test("Vue infrastructure is precisely registered and absent from the product entry graph", () => {
  const root = path.resolve(import.meta.dirname, "..");
  checkVueInfrastructureFiles(root);
  const main = JSON.parse(fs.readFileSync(path.join(root, "scripts/typecheck/tsconfig.main.json"), "utf8"));
  const graph = collectBusinessScripts(path.join(root, "ui"));
  for (const file of vueInfrastructure) {
    assert.ok(main.files.includes(`../../ui/${file}`));
    assert.ok(!graph.files.includes(file), `${file}: not mounted in the product`);
  }
});

test("Vue infrastructure guard rejects evaluation effects, private APIs and non-reader access", () => {
  const file = "vue/use-app-state.ts";
  const source = fs.readFileSync(path.join(import.meta.dirname, "../ui", file), "utf8");
  for (const bad of ["render(h(Component), host);", "const renderer = createRenderer({});", "globalThis.__VUE__ = true;", "createApp(Component);", "queueJob(job);", "reader.actions.update();", "invoke('x');"]) {
    assert.throws(() => checkVueInfrastructure(source + "\n" + bad, file));
  }
  assert.throws(() => checkVueInfrastructure(source.replace("if (!Object.is(selected.value, next)) ", ""), file), /Object.is/);
});
