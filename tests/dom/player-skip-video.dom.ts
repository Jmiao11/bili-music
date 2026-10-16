import {fixture,track} from "./tracks-fixture.ts";
import { fileURLToPath } from "node:url";
import { renderApplicationHtml } from "../../scripts/vue/shell-html.ts";
const mountedApplicationHtml = await renderApplicationHtml(fileURLToPath(new URL("../..", import.meta.url)));
import { createControllerContext as createQueueContext } from "../helpers/controller-context.ts";
import { sourceSlice } from "../helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "../helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../../ui/app/main.ts"), "utf8");
const core = readFileSync(path.join(import.meta.dirname, "../../ui/features/playback/playback-core.ts"), "utf8");
const html = mountedApplicationHtml.replace(/<[^>]+>/g, tag => / hidden(?:="")?(?=\s|>)/.test(tag) ? tag.replace(/ hidden(?:="")?(?=\s|>)/, "").replace(/>$/, " hidden>") : tag);

test("the skip button follows the unchanged page badge inside one hidden group", () => {
  const group = html.match(/<span class="player-pages-group" hidden>([\s\S]*?)<\/span>/)?.[1];
  assert.ok(group);
  assert.match(group, /<button id="player-pages-button" class="page-count-badge player-pages-button"[^>]*hidden><\/button>/);
  assert.match(group, /<button id="skip-video-button"[^>]*aria-label="跳过本次合集，播放下一首"/);
  assert.ok(group.indexOf('id="player-pages-button"') < group.indexOf('id="skip-video-button"'));
});

test("page group is visible only with a current multi-page track", async t => {
  const h=await fixture({playback:true}); t.after(h.dispose);
  const playerPagesButton=h.doc.querySelector<HTMLButtonElement>("#player-pages-button")!, playerPagesGroup=h.doc.querySelector<HTMLElement>(".player-pages-group")!;
  const pages=[{page:1,cid:11,part:"P1",durationSeconds:60},{page:2,cid:22,part:"P2",durationSeconds:60}];
  h.store.actions.playbackSession.setCurrentPages(pages);
  assert.equal(playerPagesGroup.hidden, true);
  h.store.actions.playbackQueue.replaceQueue([track(1)]); h.store.actions.playbackQueue.selectIndex(0,false,null);
  h.store.actions.playbackSession.setCurrentPages(pages.slice(0,1));
  assert.equal(playerPagesGroup.hidden, true);
  h.store.actions.playbackSession.setCurrentPages(pages); h.store.actions.playbackQueue.selectPage(1);
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
  vm.runInContext(sourceSlice(source, "ui/app/main.ts", "installPlaybackCallbacks({", "initPlaybackResume();"), context);
  handlers.skip();
  assert.deepEqual(calls, [
    ["playNext", []], ["clearPendingResume"], ["clearPlaybackNotice"],
  ]);

  nextSucceeds = false;
  calls.length = 0;
  handlers.skip();
  assert.deepEqual(calls, [["playNext", []]]);
});
