const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const functionSource = source.slice(
  source.indexOf("function playbackFailureMessage("),
  source.indexOf("const playerState"),
);
assert.ok(functionSource.includes("function playbackFailureMessage"));

const context = vm.createContext({});
vm.runInContext(
  `${functionSource}\nglobalThis.playbackFailureMessage = playbackFailureMessage;`,
  context,
);
const classify = context.playbackFailureMessage;

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
