import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { test } from "node:test";
import { attachSettingsVm } from "./helpers/settings-vm.ts";
const root = path.join(import.meta.dirname, ".."), html = fs.readFileSync(path.join(root, "ui/index.html"), "utf8");
function options(id: string): string[] {
  const select = html.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
  if (!select) throw Error("Missing select: " + id);
  return [...select[1].matchAll(/<option\b[^>]*value="([^"]*)"/g)].map(m => m[1]);
}
function setup(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> = async () => ({})) {
  const context = vm.createContext({ invokeAppearance: invoke }); attachSettingsVm(context); return context;
}

test("settings restore all actual Rust AI formats and their unchanged HTML placeholder mapping", async () => {
  // ai.rs:54-59 ApiFormat::as_str; :182-191 AiConfig::view clones String fields unchanged.
  const rust = fs.readFileSync(path.join(root, "src-tauri/src/ai.rs"), "utf8");
  const formats = [...rust.matchAll(/ApiFormat::\w+ => "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(options("ai-api-format-select"), formats);
  for (const apiFormat of formats) for (const text of ["", " 带空格的值 ", "甲😀乙🎵"]) {
    const config = { apiFormat, baseUrl: text, model: text, hasKey: true, keyHint: "••••1234" }; // key_hint, ai.rs:878-886.
    const h = setup(async () => config); await h.getSettingsActions().restoreAi();
    assert.equal(h.aiApiFormatSelect.value, apiFormat); assert.equal(h.aiBaseUrlInput.value, text); assert.equal(h.aiModelInput.value, text);
    assert.equal(h.aiBaseUrlInput.placeholder, apiFormat === "anthropic-messages" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1");
    assert.equal(h.aiConfigStatus.textContent, "API Key 已配置（••••1234）");
  }
});

test("settings accept every real Rust stream source and availability with legacy fallback", async () => {
  // state.rs:24-48 emits exactly auto/yt-dlp/guest. commands/runtime.rs:13-24 emits bool and display path.
  const rust = fs.readFileSync(path.join(root, "src-tauri/src/state.rs"), "utf8");
  const sources = [...rust.matchAll(/Self::(?:Auto|YtDlp|Guest) => "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(options("stream-source-select"), ["guest", "auto"]);
  for (const source of sources) for (const available of [false, true]) {
    const calls: string[] = [];
    const h = setup(async (command, args) => { calls.push(command); return command === "get_yt_dlp_availability" ? { available, path: path.join(os.tmpdir(), "tools", "yt-dlp.exe") } : command === "get_stream_source" ? source : args!.source; });
    await h.getSettingsActions().restoreSource();
    const fallback = source === "yt-dlp" || source === "auto" && !available;
    assert.equal(h.streamSourceSelect.value, source === "auto" && available ? "auto" : "guest");
    assert.equal(calls.includes("set_stream_source"), fallback);
    assert.equal(h.streamSourceStatus.textContent, source === "auto" && available ? "当前：自动（游客优先，yt-dlp 兜底）" : "当前：游客直连" + (available ? "" : "；自动模式需在程序目录放置 yt-dlp.exe 后启用"));
  }
});

test("settings cache accepts all Rust capacity options without additional filtering", async () => {
  // audio_cache.rs:18-25 CAPACITY_OPTIONS and :333-350 settings_at/set_settings_at.
  const capacities = [512, 1024, 2 * 1024, 5 * 1024, 10 * 1024].map(mb => mb * 1024 * 1024);
  assert.deepEqual(options("audio-cache-capacity").map(Number), capacities);
  for (const maxBytes of capacities) for (const enabled of [false, true]) {
    const h = setup(async () => ({ enabled, maxBytes })); await h.getSettingsActions().restoreCache();
    assert.equal(h.audioCacheEnabled.checked, enabled); assert.equal(h.audioCacheCapacity.value, String(maxBytes));
  }
});

test("settings legacy collection storage values preserve normalized reads and raw writes", () => {
  // ui/index.html:504-519 writes select.value as-is; page-selection.ts:31-36 is the pre-migration normalizer.
  const stored = new Map<string, string>(), h = setup(); h.localStorage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) };
  for (const order of [...options("shuffle-collection-order"), "SEQUENTIAL", "", " random "]) for (const limit of [...options("shuffle-collection-limit"), "03", "0", "", " 3 "]) {
    h.getSettingsActions().saveCollection("order", order); h.getSettingsActions().saveCollection("limit", limit);
    assert.equal(stored.get("bilibili-music.shuffle-collection-order"), order); assert.equal(stored.get("bilibili-music.shuffle-collection-limit"), limit);
    const actual = h.readSettingsCollectionPrefs(); assert.equal(actual.order, order === "sequential" ? "sequential" : "random"); assert.equal(actual.limit, ["1", "3", "5", "10"].includes(limit) ? Number(limit) : 0);
  }
});

test("settings background preserves Rust JPEG data URL metadata and Unicode path unchanged", () => {
  // appearance.rs:16-23 BackgroundImage; :83-100 constructs name/path/JPEG data URL/u32 dimensions.
  const image = { path: path.join(os.tmpdir(), "背景 图片.jpg"), displayName: "背景 图片.jpg", dataUrl: "data:image/jpeg;base64,/9j/2Q==", width: 2, height: 3 };
  const css = new Map<string, string>(), h = setup(); h.root.style.setProperty = (name: string, value: string) => css.set(name, value);
  h.getSettingsActions().applyImage(image);
  assert.equal(css.get("--app-background"), `url("${image.dataUrl}")`); assert.equal(h.backgroundName.title, image.path); assert.equal(h.backgroundName.textContent, "背景 图片.jpg · 2×3");
});
