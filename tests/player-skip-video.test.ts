import { createSessionContext as createQueueContext } from "./helpers/playback-session-fixture.ts";
import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../ui/main.ts"), "utf8");
const core = readFileSync(path.join(import.meta.dirname, "../ui/playback-core.ts"), "utf8");
const html = readFileSync(path.join(import.meta.dirname, "../ui/index.html"), "utf8");

test("the skip button follows the unchanged page badge inside one hidden group", () => {
  const group = html.match(/<span class="player-pages-group" hidden>([\s\S]*?)<\/span>/)?.[1];
  assert.ok(group);
  assert.match(group, /<button id="player-pages-button" class="page-count-badge player-pages-button"[^>]*hidden><\/button>/);
  assert.match(group, /<button id="skip-video-button"[^>]*aria-label="跳过本次合集，播放下一首"/);
  assert.ok(group.indexOf('id="player-pages-button"') < group.indexOf('id="skip-video-button"'));
});

test("page group is visible only with a current multi-page track", () => {
  const playerPagesButton: { hidden: boolean; textContent?: string; setAttribute(name: string, value: unknown): void } = { hidden: true, setAttribute(this: Record<string, unknown>, name: string, value: unknown) { this[name] = value; } };
  const playerPagesGroup = { hidden: true };
  const state = { queue: [{}], currentIndex: -1, currentPages: [{}, {}], currentPageIndex: 1 };
  const context = createQueueContext({ playerState: state, playerPagesButton, playerPagesGroup });
  vm.runInContext(sourceSlice(core, "ui/playback-core.ts", "function updatePlayerPagesButton(", "async function loadPagesForCurrentVideo("), context);
  context.updatePlayerPagesButton();
  assert.equal(playerPagesGroup.hidden, true);

  state.currentIndex = 0;
  state.currentPages = [{}];
  context.updatePlayerPagesButton();
  assert.equal(playerPagesGroup.hidden, true);

  state.currentPages = [{}, {}];
  context.updatePlayerPagesButton();
  assert.equal(playerPagesButton.hidden, false);
  assert.equal(playerPagesGroup.hidden, false);
  assert.equal(playerPagesButton.textContent, "P2/2");
});

test("skip video calls playNext directly and clears state only on a successful switch", () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const calls: unknown[][] = [];
  let nextSucceeds = true;
  const context = createQueueContext({
    playerPagesButton: { addEventListener() {} },
    openCurrentPagesModal() {},
    skipVideoButton: { addEventListener: (_: unknown, handler: (...args: unknown[]) => unknown) => { handlers.skip = handler; } },
    previousButton: { addEventListener() {} },
    nextButton: { addEventListener() {} },
    playNext: (...args: unknown[]) => { calls.push(["playNext", args]); return nextSucceeds; },
    advancePageWithinCurrentBv: () => { throw Error("must not advance a page"); },
    clearPendingResume: () => calls.push(["clearPendingResume"]),
    clearPlaybackNotice: () => calls.push(["clearPlaybackNotice"]),
  });
  vm.runInContext(sourceSlice(source, "ui/main.ts", "playerPagesButton?.addEventListener(\"click\"", "initPlaybackResume();"), context);
  handlers.skip();
  assert.deepEqual(calls, [
    ["playNext", []], ["clearPendingResume"], ["clearPlaybackNotice"],
  ]);

  nextSucceeds = false;
  calls.length = 0;
  handlers.skip();
  assert.deepEqual(calls, [["playNext", []]]);
});
