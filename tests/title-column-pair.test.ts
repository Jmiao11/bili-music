import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readFileSync } from "./helpers/module-syntax.ts";
import { TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, TRACK_COLUMNS_KEY, parseTrackColumnWidths, resizeTrackColumn } from "../ui/features/tracks/track-column-state.ts";

function fixture(limit = 320, preferences = { ...TRACK_COLUMN_DEFAULTS }) {
  const properties = new Map<string, string>();
  const listeners = new Map<string, (event: unknown) => void>();
  let saved = JSON.stringify(preferences);
  class Node {
    dataset = { trackColumn: "uploader" };
    parentElement: Node | null = null;
    getAttribute() { return "80"; }
    contains() { return true; }
    closest() { return this; }
    getBoundingClientRect() {
      return { width: Math.min(limit, parseFloat(properties.get("--track-uploader-width")!)) };
    }
    setPointerCapture() {}
    hasPointerCapture() { return true; }
    releasePointerCapture() {}
  }
  const header = new Node(), handle = new Node();
  handle.parentElement = new Node();
  const context = vm.createContext({
    Element: Node, HTMLElement: Node, shallowReactive: (value: unknown) => value,
    TRACK_COLUMN_DEFAULTS, TRACK_COLUMN_LIMITS, TRACK_COLUMNS_KEY, parseTrackColumnWidths, resizeTrackColumn,
    document: { documentElement: { style: { setProperty: (key: string, value: string) => properties.set(key, value) } } },
    localStorage: { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } },
    window: { addEventListener: (key: string, callback: (event: unknown) => void) => listeners.set(key, callback), removeEventListener: (key: string) => listeners.delete(key) },
    console,
  });
  vm.runInContext(readFileSync(fileURLToPath(new URL("../ui/app/track-columns.ts", import.meta.url)), "utf8"), context);
  vm.runInContext("initializeTrackColumns()", context);
  const press = (time = 1000) => {
    context.event = { target: handle, currentTarget: header, button: 0, isPrimary: true, pointerId: 1, clientX: 500, clientY: 0, timeStamp: time };
    vm.runInContext("trackColumnCallbacks.pointerdown(event)", context);
  };
  return {
    properties, listeners, press,
    move: (delta: number) => listeners.get("pointermove")?.({ pointerId: 1, clientX: 500 + delta, clientY: 0 }),
    finish: () => listeners.get("pointerup")?.({ pointerId: 1 }),
    saved: () => parseTrackColumnWidths(saved),
    visible: () => handle.parentElement!.getBoundingClientRect().width,
  };
}

test("the title boundary adjusts only the uploader preference in either direction", () => {
  const f = fixture();
  f.press();
  assert.equal(f.properties.has("--track-title-width"), false);
  for (const [delta, width] of [[-80, 240], [40, 120], [300, 80], [-300, 320]]) {
    f.move(delta);
    assert.equal(f.visible(), width);
    assert.equal(f.saved().uploader, 160);
  }
  f.finish();
  assert.deepEqual(f.saved(), { ...TRACK_COLUMN_DEFAULTS, uploader: 320 });
  assert.equal(f.listeners.size, 0);
});

test("the chosen width stops at the fitted limit and release saves that width", () => {
  const f = fixture(190);
  f.press(); f.move(-100);
  assert.equal(f.visible(), 190);
  f.move(-200);
  assert.equal(f.visible(), 190);
  f.finish();
  assert.equal(f.saved().uploader, 190);
  assert.equal(f.visible(), 190);
});

test("double press restores the fixed column to its default", () => {
  const f = fixture(320, { ...TRACK_COLUMN_DEFAULTS, title: 400, uploader: 120 });
  f.press(); f.finish(); f.press(1100);
  assert.equal(f.visible(), 160);
  assert.equal(f.saved().title, 400);
});

test("a stationary press and a change back to the start preserve the preference on a narrow list", () => {
  const f = fixture(140);
  f.press(); f.finish();
  assert.deepEqual(f.saved(), TRACK_COLUMN_DEFAULTS);
  f.press(1500); f.move(50); f.move(0); f.finish();
  assert.deepEqual(f.saved(), TRACK_COLUMN_DEFAULTS);
});

test("resizing a fitted column preserves all other saved preferences", () => {
  const f = fixture(140);
  f.press(); f.move(20); f.finish();
  assert.deepEqual(f.saved(), { ...TRACK_COLUMN_DEFAULTS, uploader: 120 });
  assert.equal(f.properties.get("--track-plays-width"), "80px");
});
