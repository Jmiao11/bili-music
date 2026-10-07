import { sourceSlice } from "./helpers/source-slice.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import { join } from "node:path";
import vm from "node:vm";

const source = readFileSync(join(import.meta.dirname, '../ui/appearance.ts'), 'utf8');
const context = vm.createContext({});
vm.runInContext(sourceSlice(source, "ui/appearance.ts", "function shouldForwardMediaSessionAction(", "function registerMediaSessionActionHandlers("), context);

test('Media Session play forwards while paused', () => {
  assert.equal(context.shouldForwardMediaSessionAction('play', true), true);
});

test('Media Session play ignores while playing', () => {
  assert.equal(context.shouldForwardMediaSessionAction('play', false), false);
});

test('Media Session pause forwards while playing', () => {
  assert.equal(context.shouldForwardMediaSessionAction('pause', false), true);
});

test('Media Session pause ignores while paused', () => {
  assert.equal(context.shouldForwardMediaSessionAction('pause', true), false);
});
