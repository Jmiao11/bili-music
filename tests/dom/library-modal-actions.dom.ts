import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, fixture, playlist, track, importPage } from "./library-modal-fixture.ts";
import { open } from "./library-modal-open.ts";

for (const mode of ["create", "rename"] as const) {
  test("library " + mode + " validates empty and duplicate names before invoking", async () => {
    const h = await fixture(); try {
      await h.seed([playlist("a", "Alpha"), playlist("b", "Beta", [])]);
      if (mode === "rename") { h.nodes.renamePlaylistButton.focus(); await h.click(h.nodes.renamePlaylistButton); }
      else await open(h, "name");
      assert.equal(h.nodes.libraryModalTitle.textContent, mode === "rename" ? "重命名歌单" : "新建歌单");
      assert.equal(h.primary().textContent, mode === "rename" ? "保存" : "创建");
      const input = h.input(); assert.equal(input.value, mode === "rename" ? "Alpha" : "");
      if (mode === "rename") assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 5]);
      for (const [name, error] of [["  ", "歌单名不能为空。"], [" bETA ", "已存在同名歌单，请换个名字。"]]) {
        input.value = name; await h.fire(input, "input"); await h.click(h.primary());
        assert.equal(h.nodes.libraryModalStatus.textContent, error); assert.equal(h.state().session.open, true);
        assert.equal(h.state().session.busy, false); assert.equal(h.calls.length, 0); assert.equal(h.doc.activeElement, input);
      }
    } finally { h.dispose(); }
  });
  for (const success of [true, false]) test("library " + mode + (success ? " succeeds" : " fails without closing") + " and native disabled prevents duplicate submit", async () => {
    const h = await fixture(); try {
      await h.seed(); if (mode === "rename") await h.click(h.nodes.renamePlaylistButton); else await open(h, "name"); h.raf();
      const input = h.input(); input.value = mode === "rename" ? " 歌单a " : " 新歌单 "; await h.fire(input, "input");
      const gate = deferred(); h.reply(() => gate.promise); const command = mode === "rename" ? "rename_playlist" : "create_playlist";
      const enter = await h.fire(input, "keydown", { key: "Enter" }); assert.equal(enter.defaultPrevented, true);
      assert.equal(h.primary().disabled, true); assert.equal(h.state().session.busy, true);
      assert.equal(h.nodes.libraryModalStatus.textContent, mode === "rename" ? "正在保存…" : "正在创建…");
      await h.click(h.primary()); await h.fire(input, "keydown", { key: "Enter" });
      assert.deepEqual(h.calls, [{ command, args: mode === "rename" ? { id: "a", name: "歌单a" } : { name: "新歌单" } }]);
      if (success) gate.resolve([playlist("a"), playlist("b", "歌单b", []), playlist("new", "新歌单", [])]); else gate.reject(Error("磁盘写入失败"));
      await h.microtasks(); assert.equal(h.state().session.open, !success); assert.equal(h.state().session.busy, false); assert.equal(h.primary().disabled, false);
      if (success) { assert.equal(h.nodes.libraryModal.classList.contains("is-open"), false); assert.equal(h.state().selectedPlaylistId, mode === "rename" ? "a" : "new"); }
      else assert.equal(h.nodes.libraryModalStatus.textContent, (mode === "rename" ? "改名" : "新建") + "失败：Error: 磁盘写入失败");
    } finally { h.dispose(); }
  });
}

for (const success of [true, false]) test("library delete asks for confirmation then " + (success ? "succeeds" : "keeps failure open") + " with one pending command", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "delete"); h.raf(); assert.equal(h.calls.length, 0); assert.equal(h.state().session.open, true);
    const gate = deferred(); h.reply(() => gate.promise); await h.click(h.primary()); await h.click(h.primary());
    assert.deepEqual(h.calls, [{ command: "delete_playlist", args: { id: "a" } }]); assert.equal(h.primary().disabled, true);
    assert.equal(h.nodes.libraryModalStatus.textContent, "正在删除…");
    if (success) gate.resolve([playlist("b", "歌单b", [])]); else gate.reject(Error("删除错误")); await h.microtasks();
    assert.equal(h.state().session.open, !success); assert.equal(h.state().session.busy, false);
    if (success) assert.equal(h.state().selectedPlaylistId, "b"); else assert.equal(h.nodes.libraryModalStatus.textContent, "删除失败：Error: 删除错误");
  } finally { h.dispose(); }
});

test("library choose duplicate is aria-disabled only and warns without a command", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "choose"); const button = h.nodes.libraryModalBody.querySelector<HTMLButtonElement>(".playlist-choice")!;
    assert.equal(button.disabled, false); assert.equal(button.getAttribute("aria-disabled"), "true"); await h.click(button);
    assert.equal(h.calls.length, 0); assert.equal(h.state().session.open, true);
    assert.equal(h.nodes.libraryModalStatus.textContent, "该歌曲已在歌单“歌单a”中，无需重复加入。");
  } finally { h.dispose(); }
});

for (const success of [true, false]) test("library choose existing playlist " + (success ? "succeeds" : "fails open") + " without a busy lock 按现状", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "choose"); h.raf(); const button = h.nodes.libraryModalBody.querySelectorAll<HTMLButtonElement>(".playlist-choice")[1];
    const gate = deferred(); h.reply(() => gate.promise); await h.click(button);
    assert.equal(h.state().session.busy, false); assert.equal(button.disabled, false);
    assert.equal(h.nodes.libraryModalStatus.textContent, "正在加入“歌单b”…");
    assert.deepEqual(h.calls, [{ command: "add_to_playlist", args: { id: "b", track: { bvid: track(1).bvid, title: "曲目1", uploader: "作者", thumbnailUrl: "", durationSeconds: 60 } } }]);
    if (success) gate.resolve([playlist("a"), playlist("b")]); else gate.reject(Error("加入错误")); await h.microtasks();
    assert.equal(h.state().session.open, !success);
    if (success) { assert.equal(h.state().selectedPlaylistId, "b"); assert.equal(h.state().view.playbackStatus, "已加入歌单“歌单b”。"); }
    else assert.equal(h.nodes.libraryModalStatus.textContent, "加入歌单失败：Error: 加入错误");
  } finally { h.dispose(); }
});

for (const success of [true, false]) test("library choose creates then adds via Enter " + (success ? "success" : "failure"), async () => {
  const h = await fixture(); try {
    await h.seed([], [track(1)]); await open(h, "choose");
    assert.equal(h.nodes.libraryModalBody.querySelector(".library-empty-copy")?.textContent, "还没有歌单。先在下方新建一个，再把这首歌放进去。");
    const input = h.input(); input.value = "新歌单"; await h.fire(input, "input");
    h.reply(async command => { if (command === "create_playlist") return [playlist("new", "新歌单", [])]; if (success) return [playlist("new", "新歌单")]; throw Error("加入错误"); });
    const event = await h.fire(input, "keydown", { key: "Enter" }); assert.equal(event.defaultPrevented, true);
    assert.deepEqual(h.calls.map(call => call.command), ["create_playlist", "add_to_playlist"]);
    assert.equal(h.state().session.open, !success); assert.equal(h.state().session.busy, false);
    if (success) assert.equal(h.state().selectedPlaylistId, "new"); else assert.equal(h.nodes.libraryModalStatus.textContent, "加入歌单失败：Error: 加入错误");
  } finally { h.dispose(); }
});

for (const success of [true, false]) test("library import reads then saves " + (success ? "success" : "failure stays open") + " and preserves input nodes", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "favoriteImport"); h.raf();
    const inputs = [...h.nodes.libraryModalBody.querySelectorAll<HTMLInputElement>("input")], [link, name] = inputs;
    link.value = "https://space.bilibili.com/123/favlist?fid=123"; await h.fire(link, "input");
    const read = deferred(); h.reply(() => read.promise); const enter = await h.fire(link, "keydown", { key: "Enter" });
    assert.equal(enter.defaultPrevented, true); assert.equal(link.disabled, true); assert.equal(h.primary().disabled, true);
    await h.click(h.primary()); assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0], { command: "read_public_favorite_page", args: { link: link.value, page: 1, existing: [] } });
    read.resolve(importPage); await h.microtasks();
    assert.deepEqual([...h.nodes.libraryModalBody.querySelectorAll("input")], inputs);
    assert.equal(name.closest("label")?.hidden, false); assert.equal(name.value, "公开收藏夹"); assert.equal(h.doc.activeElement, name);
    assert.deepEqual([name.selectionStart, name.selectionEnd], [0, 5]); assert.equal(h.state().session.data.focusName, 1);
    assert.equal(link.disabled, true); assert.equal(name.disabled, false); assert.equal(h.primary().textContent, "开始导入");
    assert.equal(h.nodes.libraryModalStatus.textContent, "收藏夹共 1 条，可修改歌单名称后导入。");
    const save = deferred(); h.reply(() => save.promise); await h.fire(name, "keydown", { key: "Enter" });
    assert.equal(name.disabled, true); assert.equal(h.primary().disabled, true); await h.click(h.primary());
    assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1], { command: "create_imported_playlist", args: { name: "公开收藏夹", tracks: importPage.items } });
    if (success) save.resolve(playlist("imported", "公开收藏夹", [track(2)])); else save.reject(Error("保存错误")); await h.microtasks();
    assert.equal(h.state().session.open, !success); assert.equal(h.state().session.busy, false);
    if (success) { assert.equal(h.state().selectedPlaylistId, "imported"); assert.equal(h.nodes.playlistsStatus.textContent, "已创建“公开收藏夹”，导入 1 条，跳过失效或无法导入 0 条。"); }
    else { assert.equal(h.nodes.libraryModalStatus.textContent, "导入失败：Error: 保存错误。未创建歌单，可重试。"); assert.equal(link.disabled, true); assert.equal(name.disabled, false); }
  } finally { h.dispose(); }
});

test("library import first-page failure unlocks link and late response cannot reopen another session", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "favoriteImport"); h.reply(async () => { throw Error("读取错误"); }); await h.click(h.primary());
    assert.equal(h.state().session.open, true); assert.equal(h.input().disabled, false);
    assert.equal(h.nodes.libraryModalStatus.textContent, "导入失败：Error: 读取错误。未创建歌单，可重试。");
    const gate = deferred(); h.reply(() => gate.promise); await h.click(h.primary()); h.library.closeLibraryModal(); h.library.createPlaylist();
    gate.resolve(importPage); await h.microtasks(); assert.equal(h.state().session.kind, "name"); assert.equal(h.input().value, "");
    assert.equal(h.state().session.data.firstPage, undefined); assert.equal(h.state().session.busy, false);
  } finally { h.dispose(); }
});

test("library import empty result keeps dialog open and never creates a playlist", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "favoriteImport"); h.reply(async () => ({ ...importPage, items: [], skipped: 1 }));
    await h.click(h.primary()); await h.click(h.primary()); assert.equal(h.calls.length, 1);
    assert.equal(h.state().session.open, true); assert.equal(h.state().session.busy, false);
    assert.equal(h.nodes.libraryModalStatus.textContent, "没有可导入的视频，已跳过 1 条，未创建歌单。");
  } finally { h.dispose(); }
});

for (const success of [true, false]) test("library purge " + (success ? "reloads on success" : "keeps error open") + " and prevents repeated native submit", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "purge"); h.raf(); h.calls.length = 0; const gate = deferred();
    h.reply(command => command === "purge_unavailable_tracks" ? gate.promise : Promise.resolve(command === "list_disabled_pages" ? {} : []));
    await h.click(h.primary()); await h.click(h.primary()); assert.deepEqual(h.calls, [{ command: "purge_unavailable_tracks", args: {} }]);
    assert.equal(h.primary().disabled, true); assert.equal(h.nodes.libraryModalStatus.textContent, "正在清理…");
    if (success) gate.resolve({ removedFavorites: 1, removedPlaylistItems: 1, clearedMarks: 1 }); else gate.reject(Error("清理错误")); await h.microtasks();
    assert.equal(h.state().session.open, !success); assert.equal(h.state().session.busy, false);
    if (success) { assert.deepEqual(h.calls.slice(1).map(call => call.command), ["list_favorites", "list_playlists", "list_unavailable_tracks", "list_disabled_pages"]); assert.equal(h.nodes.purgeAppearanceStatus.textContent, "已清理 1 首失效曲目。"); assert.equal(h.state().favorites.length, 0); }
    else assert.equal(h.nodes.libraryModalStatus.textContent, "清理失效曲目失败：Error: 清理错误");
  } finally { h.dispose(); }
});

test("library purge empty and read failure are distinct from confirmation", async () => {
  const h = await fixture(); try {
    await h.seed(); h.reply(async () => []); await h.click(h.nodes.purgeUnavailableTracksButton);
    assert.equal(h.nodes.libraryModalBody.innerHTML, '<p class="library-empty-copy">没有失效曲目。</p>');
    assert.equal(h.state().session.open, true); assert.equal(h.nodes.libraryModalBody.querySelector("button"), null);
    h.library.closeLibraryModal(); h.reply(async () => { throw Error("读取错误"); }); await h.click(h.nodes.purgeUnavailableTracksButton);
    assert.equal(h.state().session.open, false); assert.equal(h.nodes.purgeUnavailableTracksButton.disabled, false);
    assert.equal(h.nodes.purgeAppearanceStatus.textContent, "读取失效曲目失败：Error: 读取错误");
  } finally { h.dispose(); }
});

test("library loudness acknowledgment is local and closes without an IPC command", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "loudness"); h.raf(); assert.equal(h.calls.length, 0);
    assert.equal(h.doc.activeElement, h.primary()); await h.click(h.primary());
    assert.equal(h.state().session.open, false); assert.equal(h.calls.length, 0);
    assert.equal(h.doc.activeElement, h.primary());
  } finally { h.dispose(); }
});

for (const success of [true, false]) test("library import pagination " + (success ? "accumulates counts and upper-limit summary" : "keeps first page for retry"), async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "favoriteImport"); h.input().value = "公开链接"; await h.fire(h.input(), "input");
    h.reply(async () => ({ ...importPage, title: "长".repeat(41), total: 5, hasMore: true, skipped: 1, duplicates: 1 })); await h.click(h.primary());
    const name = h.nodes.libraryModalBody.querySelectorAll<HTMLInputElement>("input")[1];
    assert.equal(name.value, "长".repeat(40)); assert.equal(h.nodes.libraryModalStatus.textContent, "收藏夹共 5 条，可修改歌单名称后导入。标题较长，请确认缩短后的名称。");
    h.reply(async command => { if (command === "read_public_favorite_page") { if (!success) throw Error("第二页错误"); return { ...importPage, items: [track(3)], skipped: 1, duplicates: 0, scanned: 3, truncated: true }; } return playlist("new", name.value, [track(2), track(3)]); });
    await h.click(h.primary()); assert.deepEqual(h.calls[1], { command: "read_public_favorite_page", args: { link: "公开链接", page: 2, existing: [track(2).bvid] } });
    assert.equal(h.state().session.open, !success);
    if (success) { assert.equal(h.calls.length, 3); assert.equal(h.nodes.playlistsStatus.textContent, "已创建“" + "长".repeat(40) + "”，导入 2 条，跳过失效或无法导入 2 条，去重 1 条。已达到 200 条上限，剩余内容未导入。"); }
    else { assert.equal(h.calls.length, 2); assert.equal(h.input().disabled, true); assert.equal(name.disabled, false); assert.equal(h.nodes.libraryModalStatus.textContent, "导入失败：Error: 第二页错误。未创建歌单，可重试。"); assert.equal(h.state().session.data.firstPage?.hasMore, true); }
  } finally { h.dispose(); }
});

test("library choose allows repeated pending clicks 按现状", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "choose"); const button = h.nodes.libraryModalBody.querySelectorAll<HTMLButtonElement>(".playlist-choice")[1];
    const gate = deferred(); h.reply(() => gate.promise); await h.click(button); await h.click(button);
    assert.equal(h.calls.length, 2); assert.equal(h.calls.every(call => call.command === "add_to_playlist"), true);
    assert.equal(h.state().session.busy, false); assert.equal(button.disabled, false);
    gate.resolve([playlist("a"), playlist("b")]); await h.microtasks(); assert.equal(h.state().session.open, false);
  } finally { h.dispose(); }
});
