const { sourceSlice } = require("./helpers/source-slice.cjs");
const assert = require("node:assert/strict");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/playback-core.js"), "utf8");
const trackUtilsSource = readFileSync(path.join(__dirname, "../ui/track-utils.js"), "utf8");
const functionSource = sourceSlice(trackUtilsSource, "ui/track-utils.js", "function playbackFailureMessage(", "function isBvId(");
assert.ok(functionSource.includes("function playbackFailureMessage"));

const context = vm.createContext({});
vm.runInContext(
  `${functionSource}\nglobalThis.playbackFailureMessage = playbackFailureMessage;\nglobalThis.unavailableTrackReason = unavailableTrackReason;`,
  context,
);
const classify = context.playbackFailureMessage;
const unavailableReason = context.unavailableTrackReason;
const contract = JSON.parse(readFileSync(path.join(__dirname, "playback-error-contract.json"), "utf8"));

test("shared error contract covers every frontend keyword and classification", () => {
  const frontendKeywords = [...functionSource.matchAll(/message\.includes\("([^"]+)"\)/g)]
    .map((match) => match[1]);
  frontendKeywords.push("audio resolution was cancelled");
  assert.ok(source.includes('String(error).includes("audio resolution was cancelled")'));
  assert.deepEqual(
    [...new Set(frontendKeywords)].sort(),
    contract.map((entry) => entry.keyword).sort(),
  );
  for (const entry of contract) {
    const actual = classify(entry.sampleError);
    assert.equal(actual, entry.playbackMessage, entry.keyword);
    assert.equal(Boolean(unavailableReason(entry.sampleError)), entry.unavailable, entry.keyword);
    assert.ok((entry.matchTarget === "playbackMessage" ? actual : entry.sampleError).includes(entry.keyword));
  }
});

test("all-disabled pages use the chosen message without marking the video unavailable", () => {
  const error = new Error("all pages disabled by user");
  assert.equal(classify(error), "该视频的分P都已设为不想听");
  assert.equal(unavailableReason(error), "");
});

test("deleted, private, and permission business codes share the unavailable message", () => {
  const errors = [
    new Error("Bilibili view failed with code 62002: 稿件不可见"),
    "Bilibili view failed with code -404: 啥都木有",
    "Bilibili playurl failed with code -403: 访问权限不足",
  ];
  for (const error of errors) {
    assert.equal(classify(error), "该视频已被删除或设为私密");
    assert.equal(classify(error, true), "该分P已被删除或设为私密");
  }
});

test("missing or unsupported audio responses report no playable audio", () => {
  const errors = [
    "Bilibili playurl response has no data.dash.audio",
    "Bilibili playurl response data.dash.audio is empty",
    "no browser-playable AAC audio stream found in data.dash.audio; ids: 30216, 30232",
    "Bilibili playurl response has no data.dash.audio; durl fallback unavailable: Bilibili playurl response has no data.durl",
    "all durl URLs failed probe: durl stream is not MP4 (unsupported container)",
  ];
  for (const error of errors) {
    assert.equal(classify(error), "该视频没有可播放的音频");
    assert.equal(classify(error, true), "该分P没有可播放的音频");
  }
});

test("probe, request, and HTTP 412 failures report a temporary source outage", () => {
  const errors = [
    "all audio URLs for id 30232 failed probe: audio URL probe request failed: error sending request for url (https://...)",
    "audio URL probe returned HTTP 502 Bad Gateway",
    "Bilibili view returned HTTP 412",
    "Bilibili view request failed: connection closed",
  ];
  for (const error of errors) {
    assert.equal(classify(error), "音频源暂时连不上");
    assert.equal(classify(error, true), "音频源暂时连不上");
  }
});

test("unmatched errors keep the generic video or page subject", () => {
  const errors = [
    "audio CDN host is not allowed: mbf909o.edge.mountaintoys.cn",
    "yt-dlp returned invalid audio metadata: stream result line is missing",
  ];
  for (const error of errors) {
    assert.equal(classify(error), "该视频无法播放");
    assert.equal(classify(error, true), "该分P无法播放");
  }
});

test("Error, string, null, undefined, and hostile objects never break classification", () => {
  const inputs = [
    new Error("Bilibili view returned HTTP 412"),
    "Bilibili playurl response has no data.dash.audio",
    null,
    undefined,
    { toString() { throw new Error("broken toString"); } },
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => classify(input));
  }
  assert.equal(classify(null), "该视频无法播放");
  assert.equal(classify(undefined, true), "该分P无法播放");
});

test("only permanent playback failures produce an unavailable-track reason", () => {
  assert.equal(
    unavailableReason("Bilibili view failed with code 62002: 稿件不可见"),
    "该视频已被删除或设为私密",
  );
  assert.equal(
    unavailableReason("Bilibili playurl response has no data.dash.audio"),
    "该视频没有可播放的音频",
  );
  assert.equal(unavailableReason("Bilibili view returned HTTP 412"), "");
  assert.equal(unavailableReason("audio CDN host is not allowed: example.com"), "");
});
