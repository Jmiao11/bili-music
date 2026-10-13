import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fixture, seed, track, playlist, transfer, videoMeta } from "./library-lists-fixture.ts";

type Harness = Awaited<ReturnType<typeof fixture>>;
async function run(body: (h: Harness) => Promise<void>) { const h = await fixture(); try { await body(h); assert.equal(h.warnings.filter(args => String(args[0]).includes("Vue")).length, 0); } finally { h.dispose(); } }
const matrix: { kind: "favorites" | "playlistItems" | "playlists"; state: string; html: string }[] = JSON.parse(fs.readFileSync(new URL("../fixtures/vue/library-lists-baseline.json", import.meta.url), "utf8")).matrix;
for (const entry of matrix) test(`Vue library list matches old ${entry.kind} ${entry.state} HTML`, () => run(async h => {
  const items = entry.state === "empty" ? [] : [{ ...track(1), ...(entry.state === "cover" ? { thumbnailUrl: "https://example.invalid/cover.jpg" } : {}) }];
  const ps = entry.state === "empty" ? [] : [{ ...playlist("a", items), ...(entry.state === "escaped" ? { name: '歌单<&>"' } : {}) }, playlist("b", [])];
  if (entry.state === "unavailable") h.store.actions.library.markUnavailable(track(1).bvid, "不可用");
  if (entry.state === "badge") h.store.actions.pages.remember(track(1).bvid, videoMeta);
  await seed(h, items, ps);
  if (entry.state === "playing") { h.store.actions.playbackQueue.replaceQueue(items, entry.kind === "favorites" ? "favorites" : "playlist", null, "a"); h.core.updateQueueUi(); }
  const host = entry.kind === "favorites" ? h.nodes.favoritesList : entry.kind === "playlistItems" ? h.nodes.playlistTracks : h.nodes.playlistsList;
  assert.equal(host.innerHTML, entry.html); const anchors = [...host.childNodes].filter(node => node.nodeType === 3);
  assert.equal(anchors.length, entry.state === "empty" ? 0 : 2); assert.ok(anchors.every(node => node.textContent === ""));
}));
test("Vue library list projections skip fifty unrelated commits in all three regions", () => run(async h => {
  await seed(h); h.regions.length = 0; let commits = 0; const stop = h.store.subscribe(() => commits++);
  for (let i = 0; i < 50; i++) h.store.actions.library.setModalName("无关" + i); stop();
  assert.equal(commits, 50); assert.equal(h.regions.filter(record => record.operation === "update").length, 0);
}));
for (const kind of ["favorites", "playlistItems", "playlists"] as const) test(`Vue library ${kind} reorder moves keyed nodes and changes current indexes`, () => run(async h => {
  await seed(h); const host = kind === "favorites" ? h.nodes.favoritesList : kind === "playlistItems" ? h.nodes.playlistTracks : h.nodes.playlistsList, nodes = [...host.children];
  const data = transfer(); await h.fire(nodes[0], "dragstart", { dataTransfer: data }); await h.fire(nodes[1], "dragover", { dataTransfer: data });
  h.reply(async () => kind === "favorites" ? [track(2), track(1)] : kind === "playlistItems" ? [playlist("a", [track(2), track(1)]), playlist("b")] : [playlist("b"), playlist("a")]);
  await h.fire(nodes[1], "drop", { dataTransfer: data }); await h.microtasks();
  assert.deepEqual([...host.children], [nodes[1], nodes[0]]);
  if (kind !== "playlists") assert.equal(nodes[1].querySelector("button.track")?.getAttribute("data-library-index"), "0");
  assert.equal(host.querySelectorAll(".is-dragging,.is-drop-before,.is-drop-after").length, 0);
}));
test("Vue playlist tracks key includes playlist id while directory card nodes remain stable", () => run(async h => {
  await seed(h, [], [playlist("a", [track(1)]), playlist("b", [track(1)])]);
  const row = h.nodes.playlistTracks.children[0], cards = [...h.nodes.playlistsList.children];
  await h.fire(cards[1].querySelector("button")!, "click", { detail: 0 });
  assert.notEqual(h.nodes.playlistTracks.children[0], row); assert.deepEqual([...h.nodes.playlistsList.children], cards); assert.equal(h.state().selectedPlaylistId, "b");
}));
test("Vue library row observation and dataset survive metadata highlights and badge patches", () => run(async h => {
  await seed(h); await h.advance(0); const row = h.nodes.favoritesList.children[0]; assert.ok(h.observed.has(row));
  h.store.actions.playbackQueue.replaceQueue([track(1)], "favorites"); h.core.updateQueueUi(); h.store.actions.pages.remember(track(1).bvid, videoMeta);
  assert.equal(h.nodes.favoritesList.children[0], row); assert.equal((row as HTMLElement).dataset.pageCountBvid, track(1).bvid); assert.equal(row.querySelector(".page-count-badge")?.textContent, "2P");
}));
test("Vue library lists create only on content and unload all empty hosts", () => run(async h => {
  assert.equal(h.regions.length, 0); await seed(h, [], []); assert.equal(h.regions.length, 0); await seed(h);
  assert.equal(h.regions.filter(record => record.operation === "create").length, 3); await seed(h, [], []);
  assert.equal(h.regions.filter(record => record.operation === "unmount").length, 3);
  for (const host of [h.nodes.favoritesList, h.nodes.playlistTracks, h.nodes.playlistsList]) { assert.equal(host.innerHTML, ""); assert.equal(host.matches(":empty"), true); }
}));
test("Vue library drag survives unrelated patches and ends on existing row refresh boundary", () => run(async h => {
  await seed(h); const row = h.nodes.favoritesList.children[0], target = h.nodes.favoritesList.children[1], data = transfer();
  await h.fire(row, "dragstart", { dataTransfer: data }); await h.fire(target, "dragover", { dataTransfer: data });
  h.store.actions.pages.remember(track(1).bvid, videoMeta); h.store.actions.playbackQueue.replaceQueue([track(1)], "favorites");
  assert.equal(h.nodes.favoritesList.children[0], row); assert.equal(row.classList.contains("is-dragging"), true); assert.equal(target.classList.contains("is-drop-after"), true);
  h.store.actions.library.refreshViews(); assert.equal(h.state().drags.favorites.drag, null); assert.equal(h.nodes.favoritesList.querySelectorAll(".is-dragging,.is-drop-after").length, 0);
  assert.equal((await h.fire(row.querySelector("button")!, "click", { detail: 0 })).defaultPrevented, true);
}));
test("Vue library component and compatibility registrations keep public boundaries", () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/vue/check.ts"], { cwd: new URL("../..", import.meta.url), stdio: "pipe" }));
});
