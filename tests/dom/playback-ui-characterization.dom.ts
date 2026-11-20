import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { deferred, responses } from "./tracks-fixture.ts";
import { collection, collectionEntry, collectionPage } from "../helpers/collections.ts";
import { libraryQueueEntries } from "../../ui/features/playback/playback-queue-state.ts";
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

test("opened immersive root stays opaque independently of page surfaces in all themes", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const css = fs.readFileSync(path.join(import.meta.dirname, "../../ui/styles.css"), "utf8").split("/* Independent floating surfaces. */")[1]!;
  const style = h.doc.createElement("style"); h.doc.head.append(style);
  h.store.actions.playbackDisplay.showImmersive();
  h.store.actions.playbackDisplay.setImmersiveOpen(true);
  for (const theme of ["dark", "light", "image", "dynamic"]) {
    h.doc.documentElement.dataset.theme = theme;
    style.textContent = css;
    const surface = h.window.getComputedStyle(h.doc.documentElement).getPropertyValue("--floating-surface").trim();
    assert.notEqual(surface, "", theme);
    // jsdom does not resolve custom properties in background declarations.
    style.textContent = css.replaceAll("var(--floating-surface)", surface);
    h.doc.documentElement.style.setProperty("--panel", "transparent");
    const player = h.node("immersive-player");
    assert.equal(player.hidden, false, theme);
    assert.equal(player.classList.contains("is-open"), true, theme);
    const background = h.window.getComputedStyle(player).backgroundColor;
    assert.match(background, /^rgb\(\d+, \d+, \d+\)$/, theme + ": " + background);
  }
});

import { nextDomEventTurn } from "./event-turn.ts";

test("unchanged lyric visibility still cancels and resets the existing idle timer", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  h.reply(async command => command === "resolve_lyrics" ? { status: "auto", songName: "计时曲目", lyrics: { hasLyric: true, lrc: "[00:00]歌词" } } : null);
  await nextDomEventTurn();
  h.window.dispatchEvent(new h.window.CustomEvent("bili-track-changed", { detail: { bvid: "BV0000000001", cid: 11 } })); await h.microtasks();
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 3000).length, 1);
  let notifications = 0; h.store.subscribe(() => { notifications++; });
  const match = h.node("lyrics-match");
  await nextDomEventTurn(); await h.fire(match, "mouseenter");
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 3000).length, 0);
  assert.equal(notifications, 0);
  await nextDomEventTurn(); await h.fire(match, "mouseleave");
  const first = [...h.timers].find(([, timer]) => timer.delay === 1500)![0];
  await nextDomEventTurn(); await h.fire(match, "mouseleave");
  assert.equal(h.timers.has(first), false);
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 1500).length, 1);
  assert.equal(notifications, 0);
  await h.advance(1499); assert.equal(match.classList.contains("is-idle"), false);
  await h.advance(1); assert.equal(match.classList.contains("is-idle"), true); assert.equal(notifications, 1);
  await nextDomEventTurn(); await h.fire(match, "mouseenter");
  assert.equal(match.classList.contains("is-idle"), false); assert.equal(notifications, 2);
  await nextDomEventTurn(); await h.fire(match, "mouseenter"); assert.equal(notifications, 2);
});

test("both progress sliders commit on pointer release without requiring a native change event", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  for (const id of ["progress-slider", "immersive-progress-slider"]) for (const endEvent of ["pointerup", "pointercancel", "lostpointercapture"]) {
    h.media.currentTime = 15; h.dispatch(h.audio, "timeupdate");
    const slider = h.node<HTMLInputElement>(id);
    await h.fire(slider, "pointerdown");
    slider.value = "75"; await h.fire(slider, "input");
    assert.equal(h.audio.currentTime, 15);
    await h.fire(slider, endEvent);
    assert.equal(h.audio.currentTime, 75);
    assert.equal(h.store.getState().playbackDisplay.isSeeking, false);
    h.media.currentTime = 76;
    await h.fire(slider, "change");
    assert.equal(h.audio.currentTime, 76, "late change must not seek a second time");
    h.dispatch(h.audio, "timeupdate");
    assert.equal(slider.value, "76");
  }
});

function visibleTrackText(h: Awaited<ReturnType<typeof playbackFixture>>) {
  return [h.node("title").textContent, h.node("uploader").textContent, h.doc.querySelector(".player-video-title")?.textContent?.trim() ?? null];
}

const audioResult = (id: number) => ({
  audioUrl: "http://127.0.0.1/audio/" + id, title: "解析标题" + id,
  uploader: "UP" + id, thumbnailUrl: "", durationSeconds: 60,
});
const splitPages = (id: number) => [1, 2].map(page => ({
  cid: id * 100 + page, page, part: `分P ${id}-${page}`, durationSeconds: 60,
}));
const videoId = (args: Record<string, unknown>) => Number(String(args.bvId).slice(2));

test("播放栏标题与所属视频在普通曲目、合集及合集成员切换时同步", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const data = collection(2), gates = [deferred(), deferred(), deferred()];
  const queue = [track(7), track(8), ...libraryQueueEntries([collectionEntry(data)])];
  h.reply(async (cmd, args) => {
    if (cmd === "get_collection_page") return collectionPage(data);
    const id = videoId(args);
    if (cmd === "get_video_pages") return splitPages(id);
    if (cmd === "prepare_audio") return id === 7 ? audioResult(id) : gates[id === 8 ? 0 : id].promise;
    return responses()(cmd);
  });
  h.core.playListItem("favorites", queue, 0); await h.microtasks();
  let previous = ["分P 7-1", "UP7", "· 曲目7"];
  assert.deepEqual(visibleTrackText(h), previous);
  for (const [i, id] of [8, 1, 2].entries()) {
    if (i < 2) h.core.playQueueIndex(i + 1);
    else h.core.playNext();
    await h.microtasks();
    assert.equal(h.calls.filter(c => c.command === "prepare_audio").at(-1)?.args.bvId, track(id).bvid);
    assert.deepEqual(visibleTrackText(h), previous);
    gates[i].resolve(audioResult(id)); await h.microtasks();
    previous = [`分P ${id}-1`, `UP${id}`, `· 曲目${id}`];
    assert.deepEqual(visibleTrackText(h), previous);
  }
});

test("自动跳过解析失败项时保留上一首完整文字，下一首成功后一起更新", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const failed = deferred(), next = deferred();
  h.reply(async (cmd, args) => {
    const id = videoId(args);
    if (cmd === "get_video_pages") return id === 8 ? [] : splitPages(id);
    if (cmd === "prepare_audio") return id === 7 ? audioResult(id) : id === 8 ? failed.promise : next.promise;
    return responses()(cmd);
  });
  const old = ["分P 7-1", "UP7", "· 曲目7"];
  h.core.playListItem("direct", [track(7), track(8), track(9)], 0); await h.microtasks();
  h.core.playNext(); await h.microtasks(); assert.deepEqual(visibleTrackText(h), old);
  failed.reject(Error("synthetic audio failure")); await h.microtasks();
  assert.equal(h.core.getQueueSnapshot().currentIndex, 2);
  assert.equal(h.calls.filter(c => c.command === "prepare_audio").at(-1)?.args.bvId, track(9).bvid);
  assert.deepEqual(visibleTrackText(h), old);
  next.resolve(audioResult(9)); await h.microtasks();
  assert.deepEqual(visibleTrackText(h), ["分P 9-1", "UP9", "· 曲目9"]);
});

test("恢复冻结合集时所属视频来自保存的成员位置，续播后仍与分P标题对应", async t => {
  const h = await playbackFixture(); t.after(h.dispose);
  const data = collection(2), entry = libraryQueueEntries([collectionEntry(data)])[0], gate = deferred();
  const historyTrack = { ...track(3), title: "历史成员标题", uploader: "历史作者" };
  const mediaType = Object.getOwnPropertyDescriptor(globalThis, "HTMLMediaElement");
  Object.defineProperty(globalThis, "HTMLMediaElement", { configurable: true, value: h.window.HTMLMediaElement });
  t.after(() => {
    if (mediaType) Object.defineProperty(globalThis, "HTMLMediaElement", mediaType);
    else Reflect.deleteProperty(globalThis, "HTMLMediaElement");
  });
  Object.defineProperty(h.audio, "readyState", { configurable: true, value: h.window.HTMLMediaElement.HAVE_METADATA });
  h.reply(async (cmd, args) => {
    if (cmd === "get_playback_state") return {
      version: 2, queue: [{ ...entry, collection: { ...entry.collection, historyTrack } }],
      currentIndex: 0, positionSeconds: 12, page: 2, cid: 302, savedAt: 1,
      traversal: { randomRemaining: [], history: [], randomPageRound: null, shuffle: false, loopMode: "sequence" },
    };
    if (cmd === "get_video_pages") return splitPages(videoId(args));
    if (cmd === "prepare_audio") return gate.promise;
    return responses()(cmd);
  });
  await h.core.restorePlaybackState();
  assert.deepEqual(visibleTrackText(h), ["历史成员标题", "历史作者", "· 曲目1"]);
  await h.fire(h.node("play-pause-button"), "click"); await h.microtasks();
  assert.equal(h.calls.filter(c => c.command === "prepare_audio").at(-1)?.args.cid, 302);
  assert.deepEqual(visibleTrackText(h), ["历史成员标题", "历史作者", "· 曲目1"]);
  gate.resolve(audioResult(3)); await h.microtasks();
  assert.deepEqual(visibleTrackText(h), ["分P 3-2", "UP3", "· 曲目1"]);
  assert.equal(h.calls.filter(c => c.command === "prepare_audio").length, 1);
  assert.equal(h.audio.currentTime, 12);
});

async function actionFixture() {
  const h = await playbackFixture();
  const gates = new Map<number, ReturnType<typeof deferred>>();
  const favorites = new Map<string, CommandContract.TrackSnapshot>([[track(7).bvid, track(7)]]);
  const group = collection(2);
  h.reply(async (cmd, args) => {
    const id = videoId(args);
    if (cmd === "get_collection_page") return collectionPage(group);
    if (cmd === "get_video_pages") return id === 9 ? [] : splitPages(id);
    if (cmd === "prepare_audio") return gates.get(id)?.promise ?? audioResult(id);
    if (cmd === "list_favorites") return [...favorites.values()];
    if (cmd === "list_playlists" || cmd === "list_unavailable_tracks") return [];
    if (cmd === "toggle_favorite") {
      const selected = args.track as CommandContract.TrackSnapshotInput;
      const favorited = !favorites.delete(selected.bvid);
      if (favorited) favorites.set(selected.bvid, { ...selected, addedAt: "1" });
      return { favorited, items: [...favorites.values()] };
    }
    return responses()(cmd);
  });
  await h.store.actions.library.loadLibrary();
  const capture = (id: number) => {
    const gate = deferred();
    gates.set(id, gate);
    return gate;
  };
  const last = (cmd: string) => h.calls.filter(call => call.command === cmd).at(-1)?.args;
  const press = (buttonId: string) => h.fire(h.node(buttonId), "click");
  async function verifyFavorite(buttonId: string, id: number, before: boolean) {
    const button = h.node<HTMLButtonElement>(buttonId);
    assert.equal(button.classList.contains("is-favorited"), before);
    assert.equal(button.dataset.favoriteBvid, track(id).bvid);
    assert.equal(button.disabled, false);
    await press(buttonId); await h.microtasks();
    const selected = last("toggle_favorite")?.track as CommandContract.TrackSnapshotInput;
    assert.equal(selected.bvid, track(id).bvid);
    assert.equal(selected.title, track(id).title);
    assert.equal(button.classList.contains("is-favorited"), !before);
  }
  async function verifyPlaylist(buttonId: string, id: number) {
    await press(buttonId);
    assert.equal(h.store.getState().library.session.kind, "choose");
    assert.equal(h.store.getState().library.session.data.track?.bvid, track(id).bvid);
    assert.equal(h.store.getState().library.session.data.track?.title, track(id).title);
    assert.ok(h.node("library-modal").textContent?.includes(track(id).title));
    await press("close-library-modal-button");
  }
  async function verifyOpen(id: number) {
    await press("open-bilibili-bar-button");
    assert.deepEqual(last("open_bilibili_video"), { bvId: track(id).bvid });
  }
  return { ...h, group, capture, last, press, verifyFavorite, verifyPlaylist, verifyOpen };
}

test("播放栏和沉浸页在普通切歌等待解析时各自操作可见曲目", async t => {
  const h = await actionFixture(); t.after(h.dispose);
  const bar = ["favorite-current-button", "add-playlist-current-button", "open-bilibili-bar-button"];
  for (const id of [...bar, "immersive-favorite-button", "immersive-add-playlist-button"]) {
    assert.equal(h.node<HTMLButtonElement>(id).disabled, true);
  }
  const first = h.capture(7), second = h.capture(8);
  h.core.playListItem("direct", [track(7), track(8)], 0); await h.microtasks();
  assert.equal(h.last("prepare_audio")?.bvId, track(7).bvid);
  assert.equal(h.node("title").textContent, "尚未播放");
  for (const id of bar) assert.equal(h.node<HTMLButtonElement>(id).disabled, true);
  first.resolve(audioResult(7)); await h.microtasks();

  h.core.playNext(); await h.microtasks();
  assert.equal(h.last("prepare_audio")?.bvId, track(8).bvid);
  assert.equal(h.node("title").textContent, "分P 7-1");
  assert.equal(h.node("immersive-title").textContent, "曲目8");
  await h.verifyFavorite(bar[0], 7, true);
  await h.verifyFavorite(bar[0], 7, false);
  await h.verifyPlaylist(bar[1], 7);
  await h.verifyOpen(7);
  await h.verifyFavorite("immersive-favorite-button", 8, false);
  await h.verifyPlaylist("immersive-add-playlist-button", 8);

  second.resolve(audioResult(8)); await h.microtasks();
  assert.equal(h.node("title").textContent, "分P 8-1");
  await h.verifyFavorite(bar[0], 8, true);
  await h.verifyPlaylist(bar[1], 8);
  await h.verifyOpen(8);
});

test("普通切入合集和合集成员切换时，操作使用各界面的成员身份", async t => {
  const h = await actionFixture(); t.after(h.dispose);
  const first = h.capture(1), second = h.capture(2);
  h.core.playListItem("favorites", [track(7), ...libraryQueueEntries([collectionEntry(h.group)])], 0);
  await h.microtasks();

  h.core.playNext(); await h.microtasks();
  assert.equal(h.last("prepare_audio")?.bvId, track(1).bvid);
  assert.equal(h.node("title").textContent, "分P 7-1");
  assert.equal(h.node("immersive-title").textContent, "曲目1");
  await h.verifyOpen(7);
  await h.verifyFavorite("immersive-favorite-button", 1, false);
  first.resolve(audioResult(1)); await h.microtasks();
  assert.equal(h.node("title").textContent, "分P 1-1");
  await h.verifyPlaylist("add-playlist-current-button", 1);

  h.core.playNext(); await h.microtasks();
  assert.equal(h.last("prepare_audio")?.bvId, track(2).bvid);
  assert.equal(h.node("title").textContent, "分P 1-1");
  assert.equal(h.node("immersive-title").textContent, "分P 1-1");
  await h.verifyFavorite("favorite-current-button", 1, true);
  await h.verifyPlaylist("immersive-add-playlist-button", 1);
  second.resolve(audioResult(2)); await h.microtasks();
  assert.equal(h.node("title").textContent, "分P 2-1");
  assert.equal(h.node("immersive-title").textContent, "分P 2-1");
  await h.verifyFavorite("immersive-favorite-button", 2, false);
  await h.verifyOpen(2);
});

test("自动跳过解析失败项时播放栏操作仍针对上一首，解析成功后切换", async t => {
  const h = await actionFixture(); t.after(h.dispose);
  const failed = h.capture(9), next = h.capture(8);
  h.core.playListItem("direct", [track(7), track(9), track(8)], 0); await h.microtasks();
  h.core.playNext(); await h.microtasks();
  assert.equal(h.last("prepare_audio")?.bvId, track(9).bvid);
  failed.reject(Error("synthetic resolution failure")); await h.microtasks();
  assert.equal(h.last("prepare_audio")?.bvId, track(8).bvid);
  assert.equal(h.node("title").textContent, "分P 7-1");
  await h.verifyFavorite("favorite-current-button", 7, true);
  await h.verifyPlaylist("add-playlist-current-button", 7);
  await h.verifyOpen(7);
  next.resolve(audioResult(8)); await h.microtasks();
  assert.equal(h.node("title").textContent, "分P 8-1");
  await h.verifyOpen(8);
});
