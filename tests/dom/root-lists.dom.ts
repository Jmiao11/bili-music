import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, seed, track } from "./tracks-fixture.ts";

test("one hundred synchronous playback progress commits skip every list and row render", async () => {
  const h = await fixture();
  try {
    await seed(h, "ranking");
    await seed(h, "search");
    h.reply(async command => command === "list_favorites" ? [track(1)] : command === "list_playlists" ? [{ id: "root-list", name: "根歌单", items: [track(1)], createdAt: "1760000000000" }] : command === "list_disabled_pages" ? {} : []);
    await h.store.actions.library.loadLibrary();
    assert.ok(h.renderCounts.TrackList > 0 && h.renderCounts.TrackRow > 0 && h.renderCounts.PlaylistList > 0);
    const rows = [...h.nodes.homeRankingList!.children, ...h.nodes.searchResults.children];
    for (const key of Object.keys(h.renderCounts)) h.renderCounts[key] = 0;
    const media = { paused: false, ended: false, currentTime: 0, duration: 200, readyState: 4, playbackRate: 1 };
    for (let i = 0; i < 100; i++) h.store.actions.playbackDisplay.observeProgress({ ...media, currentTime: i });
    assert.deepEqual(h.renderCounts, { TrackList: 0, TrackRow: 0, PlaylistList: 0 });
    assert.deepEqual([...h.nodes.homeRankingList!.children, ...h.nodes.searchResults.children], rows);
    assert.equal(h.store.getState().playbackDisplay.currentTime, 99);
  } finally { h.dispose(); }
});
