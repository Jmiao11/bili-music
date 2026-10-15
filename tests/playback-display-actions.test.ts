import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createApplicationStore } from "../ui/app-state.ts";
import { createPlaybackDisplayActions, initialPlaybackDisplayState } from "../ui/playback-display-state.ts";
import { createStateStore } from "../ui/state-store.ts";
import { createMediaAdapter, createMediaSessionAdapter } from "../ui/media-adapter.ts";
import { renderPlaybackDisplaySnapshot } from "./helpers/playback-display-fixture.ts";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

const media = { currentTime: 12.5, duration: 100, paused: false, ended: false, playbackRate: 1 };
test("playback display actions preserve observations preview phases and immutable snapshots without DOM", () => {
  const store = createStateStore(initialPlaybackDisplayState(), createPlaybackDisplayActions, { freeze: true }), initial = store.getState();
  store.actions.observeProgress(media); const progress = store.getState(); assert.equal(progress.currentTime, 12.5); assert.equal(progress.progress.position, 12.5); assert.equal(progress.isPlaying, true);
  store.actions.setSeeking(true); store.actions.observeProgress(media, "40"); const preview = store.getState(); store.actions.observeMedia({ ...media, currentTime: 13 });
  assert.equal(store.getState().currentTime, 13); assert.equal(store.getState().progress.position, 40); assert.equal(store.getState().view.progressVersion, preview.view.progressVersion); assert.equal(store.getState().isSeeking, true);
  store.actions.observePlaying({ ...media, ended: true }); assert.equal(store.getState().isPlaying, false); assert.equal(store.getState().view.progressVersion, preview.view.progressVersion);
  store.actions.observeProgress({ ...media, duration: NaN }); assert.deepEqual(store.getState().progress, { position: 0, duration: 0 }); assert.equal(initial.currentTime, 0); assert.equal(progress.progress.position, 12.5);
  assert.throws(() => { (store.getState().progress as { position: number }).position = 99; });
});

test("playback display actions isolate other domains and retain Media Session position and metadata semantics", () => {
  const store = createApplicationStore({ invoke: async () => null, setTimeout: () => 0, clearTimeout() {}, report() {} }, { freeze: true }), initial = store.getState();
  const track = { hasCurrent: true, title: "曲目", uploader: "作者", thumbnailUrl: "" }; store.actions.playbackDisplay.setTrack(track); track.title = "later"; assert.equal(store.getState().playbackDisplay.track?.title, "曲目");
  store.actions.playbackDisplay.observePosition({ ...media, currentTime: 120, playbackRate: 0 }); const position = store.getState().playbackDisplay;
  assert.deepEqual(position.position, { duration: 100, position: 100, playbackRate: 1 }); store.actions.playbackDisplay.observePosition({ ...media, duration: Infinity }); assert.equal(store.getState().playbackDisplay.view.positionVersion, position.view.positionVersion);
  store.actions.playbackDisplay.setSessionState("none"); store.actions.playbackDisplay.setTrack(null); assert.equal(store.getState().playbackDisplay.track, null);
  for (const domain of ["home", "search", "library", "settings", "pages", "playbackSettings"] as const) assert.equal(store.getState()[domain], initial[domain]);
});

test("media observation and Media Session adapters delegate live values and propagate platform errors", () => {
  const target = { ...media, src: "", volume: 1, load() {}, pause() {}, play: async () => {}, addEventListener() {}, removeEventListener() {} }, adapter = createMediaAdapter(target);
  assert.deepEqual(adapter.getObservation(), media); target.currentTime = 15; assert.equal(adapter.getObservation().currentTime, 15);
  const positions: unknown[] = [], handlers: unknown[] = [];
  const session = { metadata: null, playbackState: "none", setPositionState: (value: unknown) => positions.push(value), setActionHandler: (...args: unknown[]) => handlers.push(args) } as unknown as MediaSession;
  const controls = createMediaSessionAdapter(session, value => value as MediaMetadata);
  controls.setTrack({ title: "曲目", uploader: "作者", thumbnailUrl: "cover" }); assert.deepEqual(session.metadata, { title: "曲目", artist: "作者", artwork: [{ src: "cover", sizes: "512x512", type: "image/jpeg" }] });
  controls.setTrack(null); assert.equal(session.metadata, null); controls.setPlaybackState("playing"); assert.equal(session.playbackState, "playing");
  const handler = () => {}; controls.setActionHandler("play", handler); assert.deepEqual(handlers, [["play", handler]]); controls.setPosition({ duration: 100, position: 15 }); assert.deepEqual(positions, [{ duration: 100, position: 15 }]);
  const error = Error("unsupported"); session.setPositionState = () => { throw error; }; assert.throws(() => controls.setPosition({ duration: 100 }), value => value === error);
});

test("playback display renderer is readonly and its projection cannot access lists", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "../ui/playback-display-view.ts"), "utf8"), code = maskCommentsAndStrings(source);
  assert.doesNotMatch(code, /\b(?:invoke|document|window|getApplicationStore|getPlaybackDisplayActions)\b|\.\s*actions\b|\bstate\s*\.\s*\w+\s*=(?!=|>)/);
  assert.doesNotMatch(code, /\b(?:innerHTML|replaceChildren|createElement|renderSearch|renderHome|renderFavorites|renderPlaylists)\b/);
});

test("playback display progress commits repaint only progress controls", () => {
  const store = createStateStore(initialPlaybackDisplayState(), createPlaybackDisplayActions), writes: string[] = [];
  const slider = () => ({ set max(_value: string) { writes.push("max"); }, set value(_value: string) { writes.push("value"); }, style: { setProperty() { writes.push("progress"); } } });
  const label = () => ({ set textContent(_value: string) { writes.push("time"); } });
  const button = { dataset: {}, setAttribute() { writes.push("button"); } };
  const dom = { progressSlider: slider(), immersiveProgressSlider: slider(), currentTimeLabel: label(), durationLabel: label(), immersiveCurrentTimeLabel: label(), immersiveDurationLabel: label(), playPauseButton: button, immersivePlayPauseButton: button } as unknown as Parameters<typeof renderPlaybackDisplaySnapshot>[2];
  const bindings = { formatTime: String, setTrack() { writes.push("track"); }, setPlaybackState() { writes.push("session"); }, setPosition() { writes.push("position"); } };
  let previous = store.getState(); store.subscribe(state => { renderPlaybackDisplaySnapshot(state, previous, dom, bindings); previous = state; });
  store.actions.observeProgress(media); assert.deepEqual(writes, ["max", "value", "progress", "max", "value", "progress", "time", "time", "time", "time"]);
  writes.length = 0; store.actions.setSeeking(true); store.actions.observeMedia({ ...media, currentTime: 13 }); assert.deepEqual(writes, []);
});

test("playback display DOM assignments belong to the readonly renderer", () => {
  const check = (source: string) => assert.doesNotMatch(maskCommentsAndStrings(source), /\b(?:progressSlider|immersiveProgressSlider)\s*\.\s*(?:value|max)\s*=|\b(?:currentTimeLabel|durationLabel|immersiveCurrentTimeLabel|immersiveDurationLabel)\s*\.\s*textContent\s*=/);
  check(fs.readFileSync(path.join(import.meta.dirname, "../ui/appearance.ts"), "utf8"));
  for (const invalid of ["progressSlider.value = '1';", "immersiveDurationLabel.textContent = '0:00';"]) assert.throws(() => check(invalid));
});
