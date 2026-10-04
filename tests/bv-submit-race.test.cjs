const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const { sourceSlice } = require("./helpers/source-slice.cjs");

const core = readFileSync(path.join(__dirname, "../ui/playback-core.js"), "utf8");
const tracks = readFileSync(path.join(__dirname, "../ui/track-utils.ts"), "utf8");
const code = sourceSlice(tracks, "ui/track-utils.ts", "function isBvId(", "function shouldOpenPastedBvPages(")
  + sourceSlice(core, "ui/playback-core.js", "function initPlaybackSearch(", "function initPastedBvPages(");

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

test("reverse cancellation completion plays only the latest submitted BV", async () => {
  const cancellations = [], played = [];
  let submit;
  const searchKeyword = { value: "BV0000000001" };
  const searchStatus = { textContent: "" };
  const context = vm.createContext({
    searchForm: { addEventListener(type, handler) { assert.equal(type, "submit"); submit = handler; } },
    searchKeyword, searchStatus, searchState: { requestVersion: 0 }, playerState: { requestVersion: 10 },
    pendingPastedBvPages: null, setSearchResults() {}, runSearch() { assert.fail("BV submit must not search"); },
    cancelCurrentPlayback() { const gate = deferred(); cancellations.push(gate); return gate.promise; },
    playBvId: (bvid) => played.push(bvid),
  });
  vm.runInContext(code + "\ninitPlaybackSearch();", context);
  const event = { preventDefault() {} };
  const oldSubmit = submit(event);
  searchKeyword.value = "BV0000000002";
  const newSubmit = submit(event);
  assert.equal(cancellations.length, 2);
  cancellations[1].resolve();
  await newSubmit;
  assert.deepEqual(played, ["BV0000000002"]);
  cancellations[0].resolve();
  await oldSubmit;
  assert.deepEqual(played, ["BV0000000002"]);
  assert.equal(context.pendingPastedBvPages.bvid, "BV0000000002");
  assert.equal(searchStatus.textContent, "已识别 BV 号：BV0000000002");
});
