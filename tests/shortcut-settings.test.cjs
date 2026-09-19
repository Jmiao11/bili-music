const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/appearance.js"), "utf8");
const formatterSource = source.slice(
  source.indexOf("function isShortcutModifierCode("),
  source.indexOf("function shortcutButtonFor("),
);
const recorderSource = source.slice(
  source.indexOf("function shortcutButtonFor("),
  source.indexOf("async function saveShortcutBinding("),
);
assert.ok(formatterSource.startsWith("function isShortcutModifierCode("));
assert.ok(recorderSource.startsWith("function shortcutButtonFor("));

const formatterContext = vm.createContext({ Set });
vm.runInContext(formatterSource, formatterContext);

function format(event) {
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

function fakeButton(action, binding) {
  const classes = new Set();
  return {
    dataset: { shortcutAction: action },
    textContent: binding,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
  };
}

test("only one action records and Escape cancels without saving", () => {
  const previous = fakeButton("previous", "Ctrl+A");
  const next = fakeButton("next", "Alt+N");
  const saved = [];
  const context = vm.createContext({
    window: new EventTarget(),
    shortcutRecordButtons: [previous, next],
    shortcutBindings: { previous: "Ctrl+A", next: "Alt+N" },
    recordingShortcutAction: null,
    appearanceStatus: { textContent: "" },
    shortcutFromKeyboardEvent: formatterContext.shortcutFromKeyboardEvent,
    isShortcutModifierCode: formatterContext.isShortcutModifierCode,
    saveShortcutBinding: (...args) => saved.push(args),
  });
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
