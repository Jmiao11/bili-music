import assert from "node:assert/strict";
import { test } from "node:test";
import { createMiniHostFixture } from "./helpers/mini-host-fixture.ts";

test("mini fixture initializes real queue and pages through actions without publishing before ready", async () => {
  const h = await createMiniHostFixture(), track = h.setTrack(2);
  assert.equal(h.store.getState().playbackQueue.queue[0].bvid, track.bvid);
  assert.equal(h.store.getState().playbackQueue.currentIndex, 0);
  assert.equal(h.store.getState().playbackSession.currentPages.length, 2);
  assert.equal(h.emissions.length, 0);
});

test("mini fixture invokes real favorite actions and uses actual play capture interception", async () => {
  const h = await createMiniHostFixture(); h.setTrack();
  await h.fire("mini-player-command", "toggle_favorite");
  assert.equal(h.library.getState().library.favorites.length, 1);
  assert.equal(h.library.getState().library.favorites[0].addedAt, "1700000000000");
  h.context.getSessionActions().setPendingResume(true); await h.fire("mini-player-command", "toggle_play");
  assert.equal(h.store.getState().playbackSession.pendingResume !== null, true);
  assert.equal(h.context.resumes, 1); assert.deepEqual(h.audio.operations, []);
});
