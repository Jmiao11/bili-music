const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const html = readFileSync(path.join(__dirname, "../ui/index.html"), "utf8");

test("the skip button follows the unchanged page badge inside one hidden group", () => {
  const group = html.match(/<span class="player-pages-group" hidden>([\s\S]*?)<\/span>/)?.[1];
  assert.ok(group);
  assert.match(group, /<button id="player-pages-button" class="page-count-badge player-pages-button"[^>]*hidden><\/button>/);
  assert.match(group, /<button id="skip-video-button"[^>]*aria-label="跳过本视频，播放下一首"/);
  assert.ok(group.indexOf('id="player-pages-button"') < group.indexOf('id="skip-video-button"'));
});

test("page group is visible only with a current multi-page track", () => {
  const playerPagesButton = { hidden: true, setAttribute(name, value) { this[name] = value; } };
  const playerPagesGroup = { hidden: true };
  const state = { queue: [{}], currentIndex: -1, currentPages: [{}, {}], currentPageIndex: 1 };
  const context = vm.createContext({ playerState: state, playerPagesButton, playerPagesGroup });
  vm.runInContext(source.slice(
    source.indexOf("function updatePlayerPagesButton("),
    source.indexOf("function buildDisplayTrack("),
  ), context);
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
  const handlers = {};
  const calls = [];
  let nextSucceeds = true;
  const context = vm.createContext({
    playerPagesButton: { addEventListener() {} },
    openCurrentPagesModal() {},
    skipVideoButton: { addEventListener: (_, handler) => { handlers.skip = handler; } },
    previousButton: { addEventListener() {} },
    nextButton: { addEventListener() {} },
    playNext: (...args) => { calls.push(["playNext", args]); return nextSucceeds; },
    advancePageWithinCurrentBv: () => { throw Error("must not advance a page"); },
    clearPendingResume: () => calls.push(["clearPendingResume"]),
    clearPlaybackNotice: () => calls.push(["clearPlaybackNotice"]),
  });
  vm.runInContext(source.slice(
    source.indexOf('playerPagesButton?.addEventListener("click"'),
    source.indexOf('resumePlayPauseButton?.addEventListener("click"'),
  ), context);
  handlers.skip();
  assert.deepEqual(calls, [
    ["playNext", []], ["clearPendingResume"], ["clearPlaybackNotice"],
  ]);

  nextSucceeds = false;
  calls.length = 0;
  handlers.skip();
  assert.deepEqual(calls, [["playNext", []]]);
});
