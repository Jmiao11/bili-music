const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../ui/appearance.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function shouldForwardMediaSessionAction('), source.indexOf('function registerMediaSessionActionHandlers(')), context);

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
