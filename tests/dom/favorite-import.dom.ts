import { sourceSlice } from "../helpers/source-slice.ts";
import assert from "node:assert/strict";
import { stripModuleSyntax, readFileSync } from "../helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import { fixture } from "./library-modal-fixture.ts";

const source = readFileSync(path.join(import.meta.dirname, "../../ui/library-ui.ts"), "utf8");
const code = sourceSlice(source, "ui/library-ui.ts", "function importFavoritePlaylist()       {", "function openPurgeUnavailableTracksModal()")
  .replace("function importFavoritePlaylist()       {", "function importFavoritePlaylist() {");
assert.ok(code.startsWith("function importFavoritePlaylist() {"));

async function setup(invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>, t: import("node:test").TestContext) {
  // 保留原接线的模块语法验证，DOM 仍由 Vite 编译真实模块。
  for (const name of ["track-utils.ts", "library-state.ts", "library-view.ts", "library-ui.ts"]) stripModuleSyntax(readFileSync(path.resolve(import.meta.dirname, "../../ui", name), "utf8"), "ui/" + name);
  const h = await fixture(); t.after(h.dispose);
  const library = h.library as typeof h.library & { importFavoritePlaylist(): void };
  library.importFavoritePlaylist();
  const inputs = h.nodes.libraryModalBody.querySelectorAll<HTMLInputElement>("input");
  const fields = [...inputs].map(input => ({ input, field: input.closest("label")! }));
  fields[0].input.value = "https://www.bilibili.com/list/ml123";
  h.reply(invoke);
  const context = { libraryModalStatus: h.nodes.libraryModalStatus, playlistsStatus: h.nodes.playlistsStatus,
    closeLibraryModal: h.library.closeLibraryModal, get libraryState() { return h.state(); } };
  return { context, fields, button: h.primary(), submit: () => h.store.actions.library.submitImport(fields[0].input.value, fields[1].input.value) };
}
const page = (items: { bvid: string; title: string }[], hasMore = false) => ({ title: "收藏夹标题", total: 30, items,
  skipped: 1, duplicates: 0, scanned: items.length + 1, hasMore, truncated: false });
const track = (bvid: string) => ({ bvid, title: "歌名" });

test("preview allows rename; sequential pages update progress and save once then select", async t => {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  let app: Awaited<ReturnType<typeof setup>>;
  app = await setup(async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "read_public_favorite_page") {
      if (args.page === 1) return page([track("BV0000000001")], true);
      assert.match(app.context.libraryModalStatus.textContent, /第 1 页.*有效 1\/200/);
      assert.deepEqual(Array.from(args.existing as string[]), ["BV0000000001"]);
      return { ...page([track("BV0000000002")]), truncated: true };
    }
    assert.equal(command, "create_imported_playlist");
    assert.equal(args.name, "我的名字");
    assert.equal((args.tracks as unknown[]).length, 2);
    return { id: "new", name: args.name, items: args.tracks };
  }, t);
  await app.submit();
  assert.equal(calls.length, 1);
  assert.equal(app.fields[1].input.value, "收藏夹标题");
  assert.equal(app.fields[1].field.hidden, false);
  app.fields[1].input.value = "我的名字";
  await app.submit();
  assert.equal(calls.length, 3);
  assert.equal(app.context.libraryState.selectedPlaylistId, "new");
  assert.match(app.context.playlistsStatus.textContent, /跳过失效或无法导入 2 条.*200 条上限/);
});

test("page failure does not save a partial playlist and permits retry", async t => {
  let saves = 0;
  const app = await setup(async (command: string, args: Record<string, unknown>) => {
    if (command === "create_imported_playlist") { saves++; throw Error("unexpected"); }
    if (args.page === 1) return page([track("BV0000000001")], true);
    throw Error("网络失败");
  }, t);
  await app.submit();
  await app.submit();
  assert.equal(saves, 0);
  assert.match(app.context.libraryModalStatus.textContent, /网络失败.*未创建歌单/);
  assert.equal(app.button.disabled, false);
});

test("closing during pagination ignores late response and never saves", async t => {
  let resolvePage: ((value: unknown) => void) | undefined;
  let saves = 0;
  const app = await setup((command: string, args: Record<string, unknown>) => {
    if (command === "create_imported_playlist") { saves++; return Promise.resolve({}); }
    if (args.page === 1) return Promise.resolve(page([track("BV0000000001")], true));
    return new Promise((resolve) => { resolvePage = resolve; });
  }, t);
  await app.submit();
  const pending = app.submit();
  app.context.closeLibraryModal();
  app.context.libraryModalStatus.textContent = "其他操作";
  if (resolvePage === undefined) throw new Error("Favorite page resolver is missing");
  resolvePage(page([track("BV0000000002")]));
  await pending;
  assert.equal(saves, 0);
  assert.equal(app.context.libraryModalStatus.textContent, "其他操作");
});

test("empty/all-invalid collection creates no playlist", async t => {
  let calls = 0;
  const app = await setup(async () => { calls++; return page([]); }, t);
  await app.submit();
  await app.submit();
  assert.equal(calls, 1);
  assert.match(app.context.libraryModalStatus.textContent, /没有可导入的视频.*跳过 1 条/);
});

test("rapid submit cannot start parallel requests or duplicate saves", async t => {
  let finish: ((value: unknown) => void) | undefined;
  let calls = 0;
  const app = await setup(() => { calls++; return new Promise((resolve) => { finish = resolve; }); }, t);
  const pending = app.submit();
  await app.submit();
  assert.equal(calls, 1);
  if (finish === undefined) throw new Error("Favorite preview resolver is missing");
  finish(page([]));
  await pending;
});
