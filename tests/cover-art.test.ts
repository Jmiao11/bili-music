import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeTrack } from "../ui/shared/track-utils.ts";
import { coverCandidates as requests, coverSlots as selectSlots, coverWindow, coverTier, playlistTone } from "../ui/features/library/cover-art.ts";

test("cover slots keep request parameters, source order and the ten-track boundary", () => {
  const src = "i0.hdslb.com/bfs/archive/a.jpg";
  const entry = (url: string) => ({ key: url, url });
  const coverCandidates = (urls: string[]) => requests(coverWindow(urls, 0, entry), 320).map(track => track.url);
  const coverSlots = (urls: string[], failed: Set<string>) => selectSlots(urls.map(entry), failed).map(track => track.url);
  const signed = "https://" + src + "@320w_320h_1c.webp?token=a@b&time=1";
  const urls = [" ", "//" + src + "@120w.webp?token=a@b&time=1", "http://" + src + "?other=2",
    "b", "c", "d", "e", "f", "g", "h", "outside"];
  const stored = normalizeTrack({ thumbnailUrl: urls[1] });
  assert.deepEqual(coverCandidates([stored.thumbnailUrl]), [signed]);
  const pool = coverCandidates(urls);
  assert.deepEqual(pool, [signed, "b", "c", "d", "e", "f", "g", "h"]);
  assert.deepEqual(coverSlots(pool, new Set()), [signed, "b", "c"]);
  assert.deepEqual(coverSlots(pool, new Set([signed, "c"])), ["b", "d", "e"]);
  assert.deepEqual(coverSlots(pool, new Set(pool)), []);
});

test("playlist tones are stable by id and span all four hues", () => {
  const ids = ["a", "b", "c", "d"];
  assert.equal(new Set(ids.map(playlistTone)).size, 4);
  const tones = new Map(ids.map(id => [id, playlistTone(id)]));
  for (const id of [...ids].reverse()) assert.equal(playlistTone(id), tones.get(id));
});

test("a single cover fills its square", () => {
  const css = readFileSync(new URL("../ui/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.stacked-cover\[data-count="1"\] \.stacked-tile\s*\{[^}]*\bwidth:\s*100%\s*;/);
});

test("cover window starts at the highlight, wraps once and examines at most ten tracks", () => {
  const result = (urls: string[], p: number, failed: string[] = []) => {
    const visited: string[] = [];
    const window = coverWindow(urls, p, url => { visited.push(url); return { key: url, url }; });
    assert.equal(visited.length, Math.min(urls.length, 10));
    return selectSlots(requests(window, 480), new Set(failed)).map(track => track.url);
  };
  assert.deepEqual(result(["a", "b", "c"], 0), ["a", "b", "c"]);
  assert.deepEqual(result(["a", "b", "c"], 1), ["b", "c", "a"]);
  assert.deepEqual(result(["a", "b", "c"], 2), ["c", "a", "b"]);
  assert.deepEqual(result(["a", "", "b", "b", "c"], 1, ["b"]), ["c", "a"]);
  assert.deepEqual(result(["a", "b", "a"], 2), ["a", "b"]);
  assert.deepEqual(result(["a", ...Array<string>(10).fill("")], 1), []);
  assert.deepEqual(result([], 0), []);
});

test("cover tiers round up device pixels and respect the short side of known artwork", () => {
  for (const [pixels, size] of [[319,320],[320,320],[321,480],[479,480],[480,480],[481,720],[719,720],[720,720],[721,720]]) {
    assert.equal(coverTier(pixels / 2, 2), size);
  }
  const url = "https://i0.hdslb.com/album.jpg?sign=a@b";
  for (const [width, height] of [[1280,240],[240,1280]]) {
    assert.equal(requests([{ key:"id", url, width, height }], 480)[0].url,
      "https://i0.hdslb.com/album.jpg@240w_240h_1c.webp?sign=a@b");
  }
});
