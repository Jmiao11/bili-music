const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const helpers = source.slice(
  source.indexOf("function hasMultipleCurrentPages()"),
  source.indexOf("function updatePlayerPagesButton()"),
);
assert.ok(helpers.includes("function currentAudioCacheCid()"));

function cacheCid(currentPages, currentPageIndex = 0) {
  const context = vm.createContext({ playerState: { currentPages, currentPageIndex } });
  vm.runInContext(helpers, context);
  return context.currentAudioCacheCid();
}

test("cache cid uses the selected page of a multi-page video", () => {
  assert.equal(cacheCid([{ cid: 11 }, { cid: 22 }], 1), 22);
});

test("cache cid uses the first page of a single-page video", () => {
  assert.equal(cacheCid([{ cid: 11 }]), 11);
});

test("cache cid is null when no pages are available", () => {
  assert.equal(cacheCid([]), null);
});
