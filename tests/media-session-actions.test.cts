const { sourceSlice }: import("./helpers/source-slice.cts").Contract = require("./helpers/source-slice.cts");
const { test }: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { readFileSync }: import("./helpers/module-syntax.cts").Contract = require("./helpers/module-syntax.cts");
const { join }: typeof import('node:path') = require('node:path');
const vm: typeof import('node:vm') = require('node:vm');

const source = readFileSync(join(__dirname, '../ui/appearance.ts'), 'utf8');
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
