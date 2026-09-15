const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const appearance = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
const main = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const code = appearance.slice(appearance.indexOf("const VOLUME_KEY"), appearance.indexOf("const root ="))
  + appearance.slice(appearance.indexOf("function clampNumber("), appearance.indexOf("function streamSourceLabel("))
  + appearance.slice(appearance.indexOf("function applyVolume("), appearance.indexOf("for (const item of navItems)", appearance.indexOf("function applyVolume(")))
  + main.slice(main.indexOf("let loudnessQueryVersion"), main.indexOf("async function loadCurrentTrack("));
const settingKey = "bilibili-music.loudness-normalization";
const volumeKey = "bilibili-music.volume";

function setup(stored = new Map()) {
  const queries = [];
  const warnings = [];
  const progress = [];
  const state = { requestVersion: 1, queue: [{ bvid: "BV1GF4X6MEb1" }], currentIndex: 0, currentPages: [{ cid: 1 }] };
  const context = vm.createContext({
    playerAudio: { volume: 1 }, volumeSlider: { value: "1" }, loudnessNormalizationToggle: { checked: false },
    playerState: state, currentVideoPage: () => state.currentPages[0],
    updateRangeProgress: (_, value) => progress.push(value),
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    console: { warn: (...args) => warnings.push(args) },
    invoke: (command, args) => new Promise((resolve, reject) => queries.push({ command, args, resolve, reject })),
  });
  vm.runInContext(code, context);
  context.initializeLoudnessNormalization();
  return { app: context, queries, warnings, progress, stored, state };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test("LUFS formula matches Rust target, attenuation, floor and absent values", () => {
  const { app } = setup();
  const floor = 10 ** (-12 / 20);
  assert.equal(app.lufsToGain(-14), 1);
  assert.equal(app.lufsToGain(-12), 10 ** (-2 / 20));
  assert.equal(app.lufsToGain(-30), 1);
  assert.equal(app.lufsToGain(0), floor);
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) assert.equal(app.lufsToGain(value), 1);
  for (let lufs = -200; lufs <= 200; lufs += 0.5) {
    const gain = app.lufsToGain(lufs);
    assert.ok(gain >= floor && gain <= 1);
    // -12 dB 精确为 0.251188643…；四位小数才是 0.2512。
    assert.ok(Number(gain.toFixed(4)) >= 0.2512);
  }
});

test("effective volume multiplies gain without moving or persisting the slider", () => {
  const { app, stored, progress } = setup();
  app.applyVolume(0.8);
  app.applyLoudnessNormalization(true);
  const before = [...stored];
  const progressCount = progress.length;
  app.setNormalizationGain(0.5);
  assert.equal(app.playerAudio.volume, 0.4);
  assert.equal(app.volumeSlider.value, "0.8");
  assert.equal(stored.get(volumeKey), "0.8");
  assert.deepEqual([...stored], before);
  assert.equal(progress.length, progressCount);
  app.applyVolume(0.6);
  assert.equal(app.playerAudio.volume, 0.3);
  assert.equal(app.volumeSlider.value, "0.6");
  assert.equal(stored.get(volumeKey), "0.6");
});

test("normalization defaults off and disabled refresh never queries", () => {
  const { app, queries, stored } = setup();
  assert.equal(app.isLoudnessNormalizationEnabled(), false);
  assert.equal(stored.has(settingKey), false);
  app.applyVolume(0.7);
  app.setNormalizationGain(0.3);
  app.refreshTrackLoudness();
  assert.equal(app.playerAudio.volume, 0.7);
  assert.equal(queries.length, 0);
});

test("toggle applies current cached loudness and disabling restores user volume immediately", async () => {
  const { app, queries, stored } = setup();
  app.applyVolume(0.8);
  app.applyLoudnessNormalization(true);
  assert.equal(queries[0].command, "get_track_loudness");
  assert.equal(queries[0].args.key, "BV1GF4X6MEb1:1");
  queries[0].resolve(-8);
  await settle();
  assert.equal(app.playerAudio.volume, 0.8 * 10 ** (-6 / 20));
  app.applyLoudnessNormalization(false);
  assert.equal(app.playerAudio.volume, 0.8);
  assert.equal(app.volumeSlider.value, "0.8");
  assert.equal(stored.get(settingKey), "false");
});

test("rapid track changes discard late results, including while next track is resolving", async () => {
  const { app, queries, state } = setup();
  app.applyLoudnessNormalization(true);
  state.requestVersion++;
  state.currentPages = [{ cid: 2 }];
  app.refreshTrackLoudness();
  queries[1].resolve(-12);
  await settle();
  const current = app.playerAudio.volume;
  queries[0].resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, current);
  app.refreshTrackLoudness();
  state.requestVersion++;
  queries[2].resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, 1);
});

test("disabling invalidates pending queries even when enabled again", async () => {
  const { app, queries } = setup();
  app.applyLoudnessNormalization(true);
  app.applyLoudnessNormalization(false);
  queries[0].resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, 1);
  app.applyLoudnessNormalization(true);
  app.applyLoudnessNormalization(false);
  app.applyLoudnessNormalization(true);
  queries[2].resolve(-12);
  await settle();
  queries[1].resolve(0);
  await settle();
  assert.equal(app.playerAudio.volume, 10 ** (-2 / 20));
});

test("missing cid, absent measurement and query failure keep unity gain and warn", async () => {
  const { app, queries, state, warnings } = setup();
  state.currentPages = [];
  app.applyLoudnessNormalization(true);
  assert.equal(queries.length, 0);
  state.currentPages = [{ cid: 1 }];
  app.refreshTrackLoudness();
  queries[0].resolve(null);
  await settle();
  assert.equal(app.playerAudio.volume, 1);
  app.refreshTrackLoudness();
  queries[1].reject(Error("synthetic read failure"));
  await settle();
  assert.equal(app.playerAudio.volume, 1);
  assert.equal(warnings.length, 3);
});

test("only stored true enables normalization on initialization", () => {
  for (const value of ["false", "invalid", "1"]) {
    const { app, queries } = setup(new Map([[settingKey, value]]));
    assert.equal(app.isLoudnessNormalizationEnabled(), false);
    assert.equal(queries.length, 0);
  }
  const { app, queries } = setup(new Map([[settingKey, "true"]]));
  assert.equal(app.loudnessNormalizationToggle.checked, true);
  assert.equal(queries.length, 1);
});
