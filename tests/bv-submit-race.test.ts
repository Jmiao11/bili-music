import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { readFileSync } from "./helpers/module-syntax.ts";
import { sourceSlice } from "./helpers/source-slice.ts";

const core = readFileSync(path.join(import.meta.dirname, "../ui/playback-core.ts"), "utf8");
const tracks = readFileSync(path.join(import.meta.dirname, "../ui/track-utils.ts"), "utf8");
const code = sourceSlice(tracks, "ui/track-utils.ts", "function isBvId(", "function shouldOpenPastedBvPages(")
  + sourceSlice(core, "ui/playback-core.ts", "function initPlaybackSearch(", "function initPastedBvPages(");

function deferred() {
  let resolve: ((value: void | PromiseLike<void>) => void) | undefined;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  if (resolve === undefined) throw new Error("Deferred resolver is missing");
  return { promise, resolve };
}

test("reverse cancellation completion plays only the latest submitted BV", async () => {
  const cancellations: ReturnType<typeof deferred>[] = [], played: string[] = [];
  let submit: ((event: { preventDefault(): void }) => Promise<void>) | undefined;
  const searchKeyword = { value: "BV0000000001" };
  const searchStatus = { textContent: "" };
  const context = vm.createContext({
    searchForm: { addEventListener(type: string, handler: (event: { preventDefault(): void }) => Promise<void>) { assert.equal(type, "submit"); submit = handler; } },
    searchKeyword, searchStatus, searchState: { requestVersion: 0 }, playerState: { requestVersion: 10 },
    pendingPastedBvPages: null, setSearchResults() {}, runSearch() { assert.fail("BV submit must not search"); },
    cancelCurrentPlayback() { const gate = deferred(); cancellations.push(gate); return gate.promise; },
    playBvId: (bvid: string) => played.push(bvid),
  });
  vm.runInContext(code + "\ninitPlaybackSearch();", context);
  if (submit === undefined) throw new Error("Submit handler is missing");
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
