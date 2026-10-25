import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { controlsSettingsFixture, controlsStructure, settingsReply } from "./controls-settings-fixture.ts";

const baseline = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../fixtures/controls-settings-baseline.json"), "utf8"));

test("controls real DOM preserves initial settings search hint and playlist markup", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  for (const id of Object.keys(baseline)) assert.deepEqual(controlsStructure(h.node(id)), baseline[id]);
  assert.equal(h.doc.querySelectorAll("[data-home-mode]:not(#view-home)").length, 0);
  assert.equal(h.doc.querySelectorAll("[data-tids]").length, 3);
  assert.equal(h.doc.querySelectorAll("[data-sort-mode]").length, 2);
});

test("controls real DOM keeps search draft through input composition submits divisions sorting and playback", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  const draft = h.node<HTMLInputElement>("search-keyword"); draft.value = "  中文草稿  ";
  await h.fire(draft, "compositionstart"); await h.fire(draft, "input", { isComposing: true });
  assert.equal(h.calls.filter(call => call.command === "search_videos").length, 0);
  await h.fire(draft, "compositionend"); await h.fire(h.node("search-form"), "submit");
  assert.equal(h.calls.find(call => call.command === "search_videos")?.args.keyword, "中文草稿");
  assert.equal(draft.value, "  中文草稿  ");
  await h.fire(h.doc.querySelector('[data-tids="28"]')!, "click");
  assert.equal(h.calls.filter(call => call.command === "search_videos").at(-1)?.args.tids, 28);
  await h.fire(h.doc.querySelector('[data-sort-mode="collection"]')!, "click");
  assert.equal(h.calls.filter(call => call.command === "search_videos").at(-1)?.args.sortMode, "collection");
  h.core.playListItem("ranking", h.store.getState().search.results, 0); await h.microtasks();
  assert.equal(draft.value, "  中文草稿  "); assert.equal(h.doc.getElementById("search-keyword"), draft);
});

test("controls real DOM settings keeps RAF transition hidden and focus stages", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  const panel = h.node("settings-modal"), opener = h.node("open-settings-button");
  opener.focus(); await h.fire(opener, "click");
  assert.equal(panel.hidden, false); assert.equal(panel.classList.contains("is-open"), false);
  h.raf(); assert.equal(panel.getAttribute("aria-hidden"), "false");
  h.node("close-settings-button").focus(); await h.fire(h.window, "keydown", { key: "Escape" });
  assert.equal(panel.hidden, false); assert.equal(panel.classList.contains("is-open"), false);
  assert.equal(panel.getAttribute("aria-hidden"), "true"); assert.equal(h.doc.activeElement, opener);
  await h.fire(panel, "transitionend"); assert.equal(panel.hidden, true);
});

test("controls real DOM home hint applies raw draft with trimmed request and opens AI setup", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  const hint = h.node<HTMLInputElement>("home-hint-input"); hint.value = "  想听纯音乐  ";
  await h.fire(hint, "keydown", { key: "Enter" });
  assert.equal(h.store.getState().home.userHint, "  想听纯音乐  ");
  assert.equal(h.calls.find(call => call.command === "get_recommendations")?.args.userHint, "想听纯音乐");
  assert.equal(hint.value, "  想听纯音乐  ");
  h.reply(async command => command === "get_ai_config" ? { apiFormat: "openai-chat-completions", baseUrl: "", model: "", hasKey: false, keyHint: null } : settingsReply(command));
  await h.home.refreshAiKeyState(); await h.home.loadHomeRanking();
  assert.equal(h.node("home-setup-hint").hidden, false);
  await h.fire(h.node("home-setup-settings"), "click");
  assert.equal(h.node("settings-modal").hidden, false);
  assert.equal(h.doc.querySelector(".ai-settings")?.hasAttribute("open"), true);
});

test("controls real DOM BV submit preserves draft and uses playback instead of keyword search", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  const draft = h.node<HTMLInputElement>("search-keyword"); draft.value = "  BV1xx411c7mD  ";
  await h.fire(h.node("search-form"), "submit");
  assert.equal(h.calls.filter(call => call.command === "search_videos").length, 0);
  assert.equal(h.calls.find(call => call.command === "prepare_audio")?.args.bvId, "BV1xx411c7mD");
  assert.equal(draft.value, "  BV1xx411c7mD  ");
});

test("controls real DOM sliders persist every input and project while settings stays hidden", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  for (const [id, key, values, output] of [["glass-blur", "glass-blur", [11, 12], "12px"], ["panel-alpha", "panel-alpha", [54, 55], "72%"], ["background-dim", "background-dim", [65, 66], "66%"]] as const) {
    for (const value of values) { await h.input(id + "-slider", String(value)); assert.equal(h.window.localStorage.getItem("bilibili-music." + key), key === "panel-alpha" ? null : String(value)); }
    assert.equal(h.node(id + "-value").textContent, output);
  }
  assert.equal(h.node("settings-modal").hidden, true);
  const normalization = h.node<HTMLInputElement>("loudness-normalization-toggle"); normalization.checked = true;
  await h.fire(normalization, "change"); assert.equal(h.store.getState().playbackSettings.normalizationEnabled, true);
});

test("controls real DOM AI restore test save and format preserve draft and key clearing timing", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose); await h.open();
  assert.equal(h.node("ai-config-status").textContent, "API Key 已配置（••••1234）");
  const key = h.node<HTMLInputElement>("ai-api-key-input"), url = h.node<HTMLInputElement>("ai-base-url-input");
  key.value = "test-only-draft"; url.value = "https://draft.test";
  await h.fire(h.node("test-ai-connection-button"), "click");
  assert.equal(key.value, "test-only-draft"); assert.equal(url.value, "https://draft.test");
  assert.equal(h.calls.filter(call => call.command === "set_ai_config").length, 0);
  assert.equal(h.calls.filter(call => call.command === "test_ai_connection").at(-1)?.args.apiKey, "test-only-draft");
  await h.input("ai-api-format-select", "anthropic-messages", "change");
  assert.equal(url.placeholder, "https://api.anthropic.com/v1"); assert.equal(url.value, "https://draft.test");
  await h.fire(h.node("save-ai-config-button"), "click");
  assert.equal(h.calls.filter(call => call.command === "set_ai_config").length, 1); assert.equal(key.value, "");
  assert.equal(h.node("ai-config-status").textContent, "连接正常，配置已保存。");
});

test("controls real DOM import cancel is confirmed while clearing search history is immediate", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  let confirms = 0; h.window.confirm = () => { confirms++; return false; };
  await h.fire(h.node("import-data-button"), "click"); assert.equal(confirms, 1);
  assert.equal(h.calls.filter(call => call.command === "import_data").length, 0);
  await h.fire(h.node("clear-search-history-button"), "click");
  assert.equal(confirms, 1); assert.equal(h.calls.filter(call => call.command === "clear_search_history").length, 1);
  assert.equal(h.node("appearance-status").textContent, "搜索历史已清空。");
  h.reply(async command => command === "export_data" ? null : settingsReply(command));
  await h.fire(h.node("export-data-button"), "click"); assert.equal(h.node("appearance-status").textContent, "");
  assert.equal(h.node<HTMLButtonElement>("export-data-button").disabled, false);
});

test("controls real DOM background and cache keep data URL and settings commands", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose); await h.open();
  await h.fire(h.node("choose-background-button"), "click");
  assert.equal(h.doc.documentElement.style.getPropertyValue("--app-background"), 'url("data:image/jpeg;base64,/9j/2Q==")');
  assert.equal(h.window.localStorage.getItem("bilibili-music.background-path"), "X:/test/背景.jpg");
  await h.input("audio-cache-capacity", "1073741824", "change");
  assert.equal(h.calls.filter(call => call.command === "set_audio_cache_settings").at(-1)?.args.maxBytes, 1073741824);
  assert.equal(h.node("audio-cache-usage").textContent, "1.0 MB · 2 首");
});

test("controls real DOM playlist toolbar dispatches unchanged library sessions", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  h.reply(async command => command === "list_playlists" ? [{ id: "one", name: "歌单", items: [] }] : settingsReply(command));
  await h.store.actions.library.loadLibrary();
  h.store.actions.library.choosePlaylist("one");
  for (const [id, kind] of [["create-playlist-button", "name"], ["rename-playlist-button", "name"], ["delete-playlist-button", "delete"], ["import-playlist-button", "favoriteImport"]]) {
    await h.fire(h.node(id), "click"); assert.equal(h.store.getState().library.session.kind, kind);
    h.raf();
    await h.fire(h.node("close-library-modal-button"), "click");
  }
});
