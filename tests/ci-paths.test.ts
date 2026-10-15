import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

function repositoryPaths(command: string): string[] {
  return Array.from(command.matchAll(/(?:^|[\s"'`(=])((?:\.\/|scripts\/|tests\/|ui\/)[^\s"'`()\[\]{}$;,&|<>]+)/g), match => match[1]);
}

function assertRepositoryPaths(root: string, source: string, command: string): void {
  for (const file of repositoryPaths(command)) {
    assert.ok(fs.existsSync(path.resolve(root, file)), `${source}: missing repository path ${file}`);
  }
}

test("workflow and package script repository paths exist", () => {
  const root = path.join(import.meta.dirname, "..");
  const workflows = path.join(root, ".github/workflows");
  for (const file of fs.readdirSync(workflows).filter(name => name.endsWith(".yml"))) {
    assertRepositoryPaths(root, `.github/workflows/${file}`, fs.readFileSync(path.join(workflows, file), "utf8"));
  }
  const manifest: { scripts: Record<string, string> } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const [name, command] of Object.entries(manifest.scripts)) {
    assertRepositoryPaths(root, `package.json scripts.${name}`, command);
  }
});

test("CI path guard finds inline and block paths and rejects missing cjs references", () => {
  const root = path.join(import.meta.dirname, "..");
  const workflow = `run: node scripts/check-ui-syntax.ts
run: |
  node -e 'require("./tests/helpers/typescript-source.ts")'
  node tests/ci-paths.test.ts
  node --check ui/app.ts\r\n`;
  assert.deepEqual(repositoryPaths(workflow), ["scripts/check-ui-syntax.ts", "./tests/helpers/typescript-source.ts", "tests/ci-paths.test.ts", "ui/app.ts"]);
  assert.doesNotThrow(() => assertRepositoryPaths(root, "workflow", workflow));
  for (const command of [
    `run: |\n  node -e 'require("./tests/helpers/typescript-source.cjs")'`,
    "node scripts/nonexistent.cjs",
    "node tests/nonexistent.cjs",
    "node ui/nonexistent.cjs",
    "node ./nonexistent.cjs",
  ]) {
    assert.throws(() => assertRepositoryPaths(root, "missing-path counterexample", command), /missing repository path .*\.cjs/);
  }
});

test("CI runs every branch and cancels superseded runs only for the same workflow and ref", () => {
  const workflow = fs.readFileSync(path.join(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /push:\r?\n\s+branches: \["\*\*"\]/);
  assert.match(workflow, /  pull_request:/);
  assert.match(workflow, /concurrency:\r?\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\r?\n  cancel-in-progress: true/);
});
