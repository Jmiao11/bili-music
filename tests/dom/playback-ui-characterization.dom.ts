import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { responses } from "./tracks-fixture.ts";
import { playbackFixture, playbackStructure, track } from "./playback-ui-fixture.ts";

const baseline = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../fixtures/playback-ui-baseline.json"), "utf8"));

test("playback real DOM preserves the complete initial controls structure and external audio identity", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  for (const id of ["result", "playback-notice", "immersive-player"]) assert.deepEqual(playbackStructure(h.node(id)), baseline[id]);
  const audio = h.audio, listeners = h.listeners.filter(listener => listener.target === audio).map(listener => listener.type);
  for (let i = 0; i < 40; i++) h.store.actions.playbackMessages.setStatus("状态" + i);
  assert.equal(h.doc.querySelectorAll("audio").length, 1); assert.equal(h.node("audio"), audio);
  assert.equal(h.node("app").contains(audio), false);
  assert.deepEqual(h.listeners.filter(listener => listener.target === audio).map(listener => listener.type), listeners);
});

test("playback real DOM progress and drag preview are synchronous and remain shared with the hidden immersive page", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  h.media.currentTime = 25; h.dispatch(h.audio, "timeupdate");
  const bar = h.node<HTMLInputElement>("progress-slider"), immersive = h.node<HTMLInputElement>("immersive-progress-slider");
  assert.equal(bar.value, "25"); assert.equal(immersive.value, "25"); assert.equal(bar.max, "100"); assert.equal(bar.style.getPropertyValue("--progress"), "25%");
  assert.equal(h.node("current-time").textContent, "0:25"); assert.equal(h.node("immersive-current-time").textContent, "0:25");
  h.dispatch(bar, "pointerdown"); bar.value = "60"; h.dispatch(bar, "input");
  assert.equal(immersive.value, "60"); assert.equal(h.audio.currentTime, 25);
  h.media.currentTime = 30; h.dispatch(h.audio, "timeupdate"); assert.equal(bar.value, "60");
  h.dispatch(bar, "change"); assert.equal(h.audio.currentTime, 60);
  h.media.duration = 3601; h.media.currentTime = 3601; h.dispatch(h.audio, "durationchange");
  assert.equal(h.node("duration").textContent, "1:00:01"); assert.equal(h.node("immersive-duration").textContent, "1:00:01");
});

test("playback real DOM playing state follows audio observations without recreating controls", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const button = h.node("play-pause-button");
  h.media.paused = false; h.dispatch(h.audio, "play"); assert.equal(button.dataset.playing, "true"); assert.equal(button.getAttribute("aria-label"), "暂停");
  assert.equal(h.node("immersive-play-pause-button").getAttribute("aria-label"), "暂停");
  h.media.paused = true; h.dispatch(h.audio, "pause"); assert.equal(button.dataset.playing, "false"); assert.equal(button.getAttribute("aria-label"), "播放");
  assert.equal(h.node("play-pause-button"), button);
});

test("playback real DOM notice priority positioning and timer retain synchronous publication", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  h.node("play-pause-button").getBoundingClientRect = () => ({ left: 180, width: 40 } as DOMRect);
  const texts: string[] = []; h.window.addEventListener("bilibili-music-notice-change", () => texts.push(h.node("playback-notice").textContent ?? ""));
  h.store.actions.playbackMessages.setStatus("状态输出"); assert.equal(h.node("status").textContent, "状态输出");
  h.notice.showPlaybackNotice("失败提示");
  assert.equal(h.node("playback-notice").style.getPropertyValue("--playback-notice-x"), "200px"); assert.equal(h.node("playback-notice").dataset.kind, "error");
  assert.equal(h.node("playback-notice").classList.contains("is-visible"), true); assert.deepEqual(texts, ["失败提示"]);
  h.notice.showPlaybackNotice("低优先级", { kind: "info" }); assert.deepEqual(texts, ["失败提示"]);
  await h.advance(3199); assert.equal(h.node("playback-notice").textContent, "失败提示");
  await h.advance(1); assert.equal(h.node("playback-notice").textContent, ""); assert.equal(h.node("playback-notice").classList.contains("is-visible"), false);
  assert.deepEqual(texts, ["失败提示", ""]);
});

test("playback real DOM volume and normalization keep user range independent of the 250ms media ramp", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const volume = h.node<HTMLInputElement>("volume-slider"), normalization = h.node<HTMLInputElement>("loudness-normalization-toggle");
  volume.value = "0.6"; h.dispatch(volume, "input"); assert.equal(h.audio.volume, 0.6); assert.equal(volume.style.getPropertyValue("--progress"), "60%");
  normalization.checked = true; h.dispatch(normalization, "change"); h.appearance.setNormalizationGain(0.5);
  h.raf(0); h.raf(125); assert.ok(Math.abs(h.audio.volume - 0.45) < 0.000001);
  h.raf(250); assert.ok(Math.abs(h.audio.volume - 0.3) < 0.000001); assert.equal(volume.value, "0.6"); assert.equal(normalization.checked, true);
});

test("playback real DOM immersive phases preserve hidden projection transition and return focus", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const immersive = h.node("immersive-player");
  h.window.dispatchEvent(new h.window.CustomEvent("bilibili-music-trackchange", { detail: { ...track(1), hasCurrent: true, thumbnailUrl: "cover.png" } }));
  assert.equal(immersive.hidden, true); assert.equal(h.node("immersive-title").textContent, "曲目1"); assert.equal(h.node("immersive-cover").getAttribute("src"), "cover.png");
  h.dispatch(h.node("open-immersive-button"), "click"); assert.equal(immersive.hidden, false); assert.equal(immersive.classList.contains("is-open"), false); assert.equal(immersive.getAttribute("aria-hidden"), "true");
  h.raf(); assert.equal(immersive.classList.contains("is-open"), true); assert.equal(immersive.getAttribute("aria-hidden"), "false");
  h.node("close-immersive-button").focus(); h.dispatch(h.node("close-immersive-button"), "click");
  assert.equal(h.doc.activeElement, h.node("open-immersive-button")); assert.equal(immersive.hidden, false); assert.equal(immersive.classList.contains("is-open"), false); assert.equal(immersive.getAttribute("aria-hidden"), "true");
  h.dispatch(immersive, "transitionend"); assert.equal(immersive.hidden, true);
});

test("lyrics real DOM preserves placeholder highlight geometry and the hidden-to-open first-highlight phase", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  h.reply(async command => command === "resolve_lyrics" ? { status: "auto", lyrics: { hasLyric: true, lrc: "[00:00]第一行\n[00:10]第二行\n[00:20]第三行" }, songName: "测试曲", offsetMs: 0 } : null);
  h.media.currentTime = 12;
  h.window.dispatchEvent(new h.window.CustomEvent("bili-track-changed", { detail: { bvid: "BV0000000001", cid: 11 } })); await h.microtasks();
  const lines = h.node("lyrics-lines"); assert.equal(lines.children.length, 3); assert.equal(lines.children[1].classList.contains("is-active"), true);
  assert.deepEqual(h.scrolls.at(-1), { top: 100, behavior: "smooth" });
  const count = h.scrolls.length; h.node("immersive-player").hidden = false; h.dispatch(h.audio, "timeupdate"); assert.equal(h.scrolls.length, count);
  h.media.currentTime = 22; h.dispatch(h.audio, "timeupdate"); assert.equal(lines.children[2].classList.contains("is-active"), true); assert.deepEqual(h.scrolls.at(-1), { top: 80, behavior: "smooth" });
  h.dispatch(h.node("lyrics-mode-toggle"), "click"); assert.equal(lines.classList.contains("mode-full"), true); assert.equal(lines.querySelectorAll(".is-active").length, 0);
});

test("playback real DOM queue modes page group metadata and favorites keep their native controls", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  assert.equal(h.node<HTMLButtonElement>("favorite-current-button").disabled, true);
  assert.equal(h.node("player-pages-button").hidden, true);
  h.reply(async (command, args) => command === "resolve_lyrics" ? { status: "none", lyrics: null } : responses([track(1), track(2)])(command));
  h.core.playListItem("ranking", [track(1), track(2)], 0); await h.microtasks();
  assert.equal(h.node("queue-position").textContent, "♪1/2"); assert.equal(h.node("player-pages-button").textContent, "P1/2");
  assert.equal(h.node("player-pages-button").hidden, false); assert.equal(h.node("player-pages-button").parentElement?.hidden, false);
  assert.equal(h.node<HTMLButtonElement>("favorite-current-button").disabled, false); assert.equal(h.node("favorite-current-button").dataset.favoriteBvid, track(1).bvid);
  assert.equal(h.node("title").textContent, "一"); assert.equal(h.node("uploader").textContent, "作者");
  h.dispatch(h.node("loop-mode-button"), "click"); assert.equal(h.node("loop-mode-button").dataset.loopMode, "list"); assert.equal(h.node("loop-mode-button").title, "列表循环");
  const shuffle = h.node<HTMLInputElement>("shuffle-toggle"); shuffle.checked = true; h.dispatch(shuffle, "change"); assert.equal(h.core.getQueueSnapshot().shuffle, true);
});

test("lyrics real DOM manual draft remains uncontrolled and candidate UI keeps exact messages", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const input = h.node<HTMLInputElement>("lyrics-manual-input"); input.value = "未提交草稿";
  for (let i = 0; i < 20; i++) h.store.actions.playbackDisplay.observeProgress({ currentTime: i, duration: 100, paused: true, ended: false, playbackRate: 1 });
  assert.equal(input.value, "未提交草稿"); assert.equal(h.node("lyrics-placeholder").textContent, "暂无歌词");
  h.reply(async command => command === "resolve_lyrics" ? { status: "candidates", candidates: [{ song_id: "1", name: "候选", singer: "作者" }], usedKeyword: "测试" } : []);
  h.window.dispatchEvent(new h.window.CustomEvent("bili-track-changed", { detail: { bvid: "BV0000000001", cid: 11 } })); await h.microtasks();
  assert.equal(h.node("lyrics-placeholder").textContent, "未自动匹配到歌词"); assert.equal(h.node("lyrics-match-hint").textContent, "“测试”有多个可能结果");
  assert.equal(h.node("lyrics-candidates").textContent, "候选 - 作者都不是"); assert.equal(h.node("lyrics-match").hidden, false);
  h.dispatch(h.node("lyrics-candidates").lastElementChild!, "click"); assert.equal(h.node("lyrics-candidates").hidden, true);
});


test("playback real DOM restored selection keeps pending resume status and the later media projection", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  h.reply(async command => command === "get_playback_state" ? { version: 1, queue: [track(1), track(2)], currentIndex: 1, positionSeconds: 12.5, page: 1, cid: 11, savedAt: 1700000000 } : null);
  await h.core.restorePlaybackState();
  assert.equal(h.node("title").textContent, "曲目2"); assert.equal(h.node("queue-position").textContent, "♪2/2");
  assert.equal(h.core.getSessionSnapshot().pendingResume?.positionSeconds, 12.5);
  assert.equal(h.node("status").textContent, "已恢复上次播放，点击播放继续。");
  assert.equal(h.node<HTMLInputElement>("progress-slider").value, "0"); assert.equal(h.node("duration").textContent, "1:40");
});

test("playback bar renders exactly one icon for each observed playback state", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const button = h.node("play-pause-button");
  assert.equal(button.querySelectorAll("svg").length, 1);
  assert.equal(button.querySelector("svg")?.classList.contains("icon-play"), true);
  assert.equal(button.getAttribute("aria-label"), "播放");
  h.media.paused = false; h.dispatch(h.audio, "play");
  assert.equal(h.node("play-pause-button"), button);
  assert.equal(button.querySelectorAll("svg").length, 1);
  assert.equal(button.querySelector("svg")?.classList.contains("icon-pause"), true);
  assert.equal(button.getAttribute("aria-label"), "暂停");
  h.media.paused = true; h.dispatch(h.audio, "pause");
  assert.equal(button.querySelectorAll("svg").length, 1);
  assert.equal(button.querySelector("svg")?.classList.contains("icon-play"), true);
  assert.equal(button.getAttribute("aria-label"), "播放");
});
