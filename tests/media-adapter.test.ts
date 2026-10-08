import assert from "node:assert/strict";
import { test } from "node:test";
import { createMediaAdapter } from "../ui/media-adapter.ts";

function fixture() {
  const calls: string[] = [], listeners = new Map<string, Set<(event: Event) => void>>();
  let reject = false;
  const failure = Error("synthetic play failure");
  const media = { src: "", currentTime: 0, volume: 1,
    load() { assert.equal(this, media); calls.push("load"); },
    play() { assert.equal(this, media); calls.push("play"); return reject ? Promise.reject(failure) : Promise.resolve(); },
    pause() { assert.equal(this, media); calls.push("pause"); },
    addEventListener(type: string, listener: (event: Event) => void) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener(type: string, listener: (event: Event) => void) { listeners.get(type)?.delete(listener); },
  };
  return { media, adapter: createMediaAdapter(media), calls, listeners, failure, fail() { reject = true; } };
}
test("media adapter delegates operations without eager media changes or event registration", async () => {
  const h = fixture(); assert.deepEqual(h.calls, []); assert.equal(h.listeners.size, 0);
  h.adapter.setSource("synthetic-source"); assert.equal(h.media.src, "synthetic-source"); assert.equal(h.adapter.getSource(), "synthetic-source");
  h.adapter.load(); await h.adapter.play(); h.adapter.pause(); assert.deepEqual(h.calls, ["load", "play", "pause"]);
  h.adapter.setCurrentTime(12.5); assert.equal(h.adapter.getCurrentTime(), 12.5); assert.equal(h.media.currentTime, 12.5);
  h.adapter.setVolume(0.37); assert.equal(h.adapter.getVolume(), 0.37); assert.equal(h.media.volume, 0.37);
  h.media.volume = 0.2; assert.equal(h.adapter.getVolume(), 0.2);
});
test("media adapter preserves play rejection and synchronous media exceptions", async () => {
  const h = fixture(); h.fail(); await assert.rejects(h.adapter.play(), error => error === h.failure);
  h.media.load = () => { throw h.failure; }; assert.throws(() => h.adapter.load(), error => error === h.failure);
  Object.defineProperty(h.media, "volume", { set() { throw h.failure; } }); assert.throws(() => h.adapter.setVolume(2), error => error === h.failure);
});
test("media adapter subscribes exact media events and returns isolated cancellation", () => {
  const h = fixture(), received: Event[] = [], first = (event: Event) => received.push(event), second = (event: Event) => received.push(event);
  const off = h.adapter.subscribe("volumechange", first), otherOff = h.adapter.subscribe("volumechange", second), event = new Event("volumechange");
  for (const listener of h.listeners.get(event.type)!) listener(event); assert.deepEqual(received, [event, event]);
  off(); off(); assert.equal(h.listeners.get(event.type)!.has(first), false); assert.equal(h.listeners.get(event.type)!.has(second), true);
  otherOff(); assert.equal(h.listeners.get(event.type)!.size, 0);
});
