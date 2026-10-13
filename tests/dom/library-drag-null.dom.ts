import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, track, playlist, seed } from "./library-lists-fixture.ts";

test("native list drag handlers preserve transfers and ignore unsupported null transfers", async () => {
  for (const kind of ["favorites", "playlistItems", "playlists"] as const) {
    const h = await fixture(); try {
      const items = Array.from({ length: 5 }, (_, i) => track(i + 1));
      await seed(h, items, [playlist("p", items), ...Array.from({ length: 4 }, (_, i) => playlist(String(i), items))]);
      const list = kind === "favorites" ? h.nodes.favoritesList : kind === "playlistItems" ? h.nodes.playlistTracks : h.nodes.playlistsList;
      const row = list.children[4];
      const handlers = { dragstart: (event: { dataTransfer: unknown }) => h.fire(row, "dragstart", event), dragover: (event: { dataTransfer: unknown; preventDefault(): void }) => h.fire(row, "dragover", event) };
      const state: { saving: boolean; drag: { index: number } | null } = { saving: false, drag: null };
      const unsubscribe = h.store.subscribe(snapshot => Object.assign(state, snapshot.library.drags[kind]));
    await handlers.dragstart({ dataTransfer: null });
    assert.equal(state.drag, null);
    let prevented = 0;
    await handlers.dragover({ dataTransfer: null, preventDefault: () => { prevented++; } });
    assert.equal(prevented, 0);
    const written: unknown[][] = [];
    const dataTransfer: { setData(...args: unknown[]): number; effectAllowed?: string; dropEffect?: string } = { setData: (...args) => written.push(args) };
    await handlers.dragstart({ dataTransfer });
    assert.equal(dataTransfer.effectAllowed, "move");
    assert.deepEqual(written, [["text/plain", "4"]]);
    const drag = (state as { drag: { index: number } | null }).drag;
    if (!drag) throw new Error("Drag state is missing");
    assert.equal(drag.index, 4);
    await handlers.dragover({ dataTransfer, preventDefault: () => { prevented++; } });
    assert.equal(dataTransfer.dropEffect, "move");
    assert.equal(prevented, 1);
      unsubscribe();
    } finally { h.dispose(); }
  }
});
