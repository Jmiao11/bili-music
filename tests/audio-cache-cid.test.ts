import { createControllerContext as createQueueContext } from "./helpers/controller-context.ts";
import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../ui/playback-core.ts"), "utf8");
const helpers = sourceSlice(source, "ui/playback-core.ts", "function hasMultipleCurrentPages()", "async function loadPagesForCurrentVideo(");
assert.ok(helpers.includes("function currentAudioCacheCid()"));

function cacheCid(currentPages: { cid: number }[], currentPageIndex = 0) {
  const context = createQueueContext({ playerState: { currentPages, currentPageIndex } });
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
