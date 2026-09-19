const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");
const functionSource = source.slice(
  source.indexOf("function unavailableTrackLocations("),
  source.indexOf("const playerState"),
);
assert.ok(functionSource.includes("function unavailableTrackLocations"));

const context = vm.createContext({});
vm.runInContext(
  `${functionSource}\nglobalThis.unavailableTrackLocations = unavailableTrackLocations;`,
  context,
);
const locationsFor = context.unavailableTrackLocations;
const unavailable = [{ bvid: "BV1GF4X6MEb1" }];

test("unavailable track location reports favorites case-insensitively", () => {
  const result = locationsFor(unavailable, [{ bvid: "bv1gf4x6meB1" }], []);
  assert.equal(result.get("bv1gf4x6meb1"), "收藏");
});

test("unavailable track location reports one playlist", () => {
  const result = locationsFor(unavailable, [], [
    { name: "夜行", items: [{ bvid: "BV1gf4x6mEb1" }] },
  ]);
  assert.equal(result.get("bv1gf4x6meb1"), "歌单《夜行》");
});

test("unavailable track location combines favorites and multiple playlists", () => {
  const result = locationsFor(unavailable, [{ bvid: "BV1GF4X6MEB1" }], [
    { name: "A", items: [{ bvid: "bv1gf4x6meb1" }] },
    { name: "B", items: [{ bvid: "BV1GF4X6MEb1" }] },
  ]);
  assert.equal(result.get("bv1gf4x6meb1"), "收藏、歌单《A》、歌单《B》");
});

test("unavailable track location reports when no library item exists", () => {
  const result = locationsFor(unavailable, [{ bvid: "BV0000000000" }], [
    { name: "其它", items: [{ bvid: "BV9999999999" }] },
  ]);
  assert.equal(result.get("bv1gf4x6meb1"), "不在收藏或歌单中");
});
