import {shortcutDisplayLabel as projectShortcutLabel} from "../ui/settings-controls.ts";
import { attachSettingsVm } from "./helpers/settings-vm.ts";
import { sourceSlice } from "./helpers/source-slice.ts";
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/module-syntax.ts";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(path.join(import.meta.dirname, "../ui/appearance.ts"), "utf8");
const formatterSource = sourceSlice(source, "ui/appearance.ts", "function isShortcutModifierCode(", "function shortcutButtonFor(");
const recorderSource = sourceSlice(source, "ui/appearance.ts", "function shortcutButtonFor(", "async function saveShortcutBinding(");
assert.ok(formatterSource.startsWith("function isShortcutModifierCode("));
assert.ok(recorderSource.startsWith("function shortcutButtonFor("));

const formatterContext = vm.createContext({
  Set,
  document: { documentElement: { dataset: { platform: "windows" } } },
});
vm.runInContext(readFileSync(path.join(import.meta.dirname, "../ui/settings-view.ts"), "utf8") + formatterSource, formatterContext);

formatterContext.shortcutDisplayLabel = (binding: string | null) => projectShortcutLabel(binding, formatterContext.document.documentElement.dataset.platform);

function format(event: Partial<KeyboardEvent>) {
  return formatterContext.shortcutFromKeyboardEvent({
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...event,
  });
}

test("formats one modifier with a letter from event.code", () => {
  assert.equal(format({ code: "KeyA", ctrlKey: true, key: "啊" }), "Ctrl+A");
});

test("formats multiple modifiers with an arrow key", () => {
  assert.equal(format({ code: "ArrowLeft", ctrlKey: true, altKey: true }), "Ctrl+Alt+Left");
});

test("rejects a modifier-only keydown", () => {
  assert.equal(format({ code: "ControlLeft", ctrlKey: true }), null);
});

test("rejects a main key without a modifier", () => {
  assert.equal(format({ code: "KeyA" }), null);
});

test("always orders modifiers as Ctrl Alt Shift Super", () => {
  assert.equal(format({
    code: "KeyP",
    metaKey: true,
    shiftKey: true,
    altKey: true,
    ctrlKey: true,
  }), "Ctrl+Alt+Shift+Super+P");
});

test("macOS displays Command without changing the canonical binding", () => {
  const binding = "Ctrl+Shift+Super+P";
  formatterContext.document.documentElement.dataset.platform = "macos";
  assert.equal(
    formatterContext.shortcutDisplayLabel(binding),
    "Ctrl+Shift+Command+P",
  );
  assert.equal(binding, "Ctrl+Shift+Super+P");
  assert.equal(formatterContext.shortcutDisplayLabel("CommandOrControl+P"), "Command+P");
  assert.equal(formatterContext.shortcutDisplayLabel(null), "未设置");
  formatterContext.document.documentElement.dataset.platform = "windows";
  assert.equal(formatterContext.shortcutDisplayLabel(binding), binding);
});

function fakeButton(action: string, binding: string) {
  const classes = new Set();
  return {
    dataset: { shortcutAction: action },
    textContent: binding,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
      toggle: (name: string, value: boolean) => value ? classes.add(name) : classes.delete(name),
    },
  };
}

test("only one action records and Escape cancels without saving", () => {
  const previous = fakeButton("previous", "Ctrl+A");
  const next = fakeButton("next", "Alt+N");
  const saved: unknown[][] = [];
  const context = vm.createContext({
    window: new EventTarget(),
    shortcutRecordButtons: [previous, next],
    shortcutBindings: { previous: "Ctrl+A", next: "Alt+N" },
    recordingShortcutAction: null,
    appearanceStatus: { textContent: "" },
    shortcutFromKeyboardEvent: formatterContext.shortcutFromKeyboardEvent,
    shortcutDisplayLabel: formatterContext.shortcutDisplayLabel,
    isShortcutModifierCode: formatterContext.isShortcutModifierCode,
    saveShortcutBinding: (...args: unknown[]) => saved.push(args),
  });
  attachSettingsVm(context);
  vm.runInContext(recorderSource, context);

  context.startShortcutRecording("previous");
  context.startShortcutRecording("next");
  assert.equal(previous.classList.contains("is-recording"), false);
  assert.equal(previous.textContent, "Ctrl+A");
  assert.equal(next.classList.contains("is-recording"), true);

  let prevented = false;
  let stopped = false;
  context.handleShortcutRecordingKeydown({
    code: "Escape",
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation: () => { stopped = true; },
  });

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(next.classList.contains("is-recording"), false);
  assert.equal(next.textContent, "Alt+N");
  assert.deepEqual(saved, []);
});
