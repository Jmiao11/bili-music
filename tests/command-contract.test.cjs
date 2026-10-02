const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { maskCommentsAndStrings } = require("./helpers/js-source.cjs");
const { readFileSync } = require("./helpers/module-syntax.cjs");
const { sourceSlice } = require("./helpers/source-slice.cjs");

const DEBUG_ONLY_COMMANDS = new Set(["debug_register_local_stream"]);
const root = path.resolve(__dirname, "..");

function registrations(source) {
  const start = source.indexOf("tauri::generate_handler![");
  assert.notEqual(start, -1, "Missing command registry");
  const end = source.indexOf("])", start);
  assert.notEqual(end, -1, "Unterminated command registry");
  const debug = new Set();
  const release = new Set();
  for (const entry of source.slice(start + "tauri::generate_handler![".length, end).split(",")) {
    const text = entry.trim();
    if (!text) continue;
    const match = /^(#\[cfg\(debug_assertions\)\]\s*)?((?:\w+::)*\w+)$/.exec(text);
    assert.ok(match, `Unsupported command registry entry: ${text}`);
    const name = match[2].split("::").at(-1);
    assert.ok(!debug.has(name), `Duplicate command: ${name}`);
    assert.equal(Boolean(match[1]), DEBUG_ONLY_COMMANDS.has(name), `Review debug-only command: ${name}`);
    debug.add(name);
    if (!match[1]) release.add(name);
  }
  return { debug, release };
}

function invokedCommands(source, file) {
  const code = maskCommentsAndStrings(source);
  const commands = new Set();
  for (const match of code.matchAll(/\b(invoke|invokeAppearance|invokeWithTimeout)\s*\(/g)) {
    if (/\bfunction\s*$/.test(code.slice(0, match.index))) continue;
    const offset = match.index + match[0].length;
    const literal = /^\s*(["'])([a-z][a-z0-9_]*)\1\s*(?=[,)])/.exec(source.slice(offset));
    if (literal) { commands.add(literal[2]); continue; }
    // A forwarding implementation is not a command-name call site. Validate
    // its exact forwarding expression; callers of the wrapper must be literal.
    assert.equal(file, "ui/home.js", `${file}: nonliteral command at offset ${match.index}`);
    const wrapper = sourceSlice(source, file, "function invokeWithTimeout(", "async function loadHomeRanking(");
    const wrapperStart = source.indexOf(wrapper);
    assert.ok(file === "ui/home.js" && match[1] === "invoke"
      && match.index >= wrapperStart && match.index < wrapperStart + wrapper.length
      && /^\s*command\s*,\s*args\s*\)/.test(source.slice(offset)),
    `${file}: nonliteral command at offset ${match.index}`);
  }
  return commands;
}

test("UI command literals are registered in release and debug-only registrations are explicit", () => {
  const { debug, release } = registrations(fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8"));
  assert.ok(debug.size > 0);
  assert.deepEqual([...debug].filter((name) => !release.has(name)), [...DEBUG_ONLY_COMMANDS]);
  const used = new Set();
  for (const name of fs.readdirSync(path.join(root, "ui")).filter((name) => name.endsWith(".js"))) {
    for (const command of invokedCommands(fs.readFileSync(path.join(root, "ui", name), "utf8"), `ui/${name}`)) {
      used.add(command);
      assert.ok(release.has(command), `${name}: unregistered release command ${command}`);
    }
  }
  assert.ok(used.size > 0);
});

test("command-name scanner rejects nonliteral calls and ignores comments and strings", () => {
  assert.deepEqual([...invokedCommands('invoke("get_ai_config"); // invoke(name)\nconst s = "invoke(name)";', "sample.js")], ["get_ai_config"]);
  assert.throws(() => invokedCommands("invoke(name)", "sample.js"));
  assert.throws(() => invokedCommands("invokeAppearance(name)", "sample.js"));
  assert.throws(() => invokedCommands("invokeWithTimeout(name, {}, 100)", "sample.js"));
});

test("playbackTrackSnapshot rounds fractional durations before saving playback state", () => {
  const source = readFileSync(path.join(root, "ui/track-utils.js"), "utf8");
  const context = vm.createContext({ displayThumbnailUrl: (value) => value });
  vm.runInContext(sourceSlice(source, "ui/track-utils.js", "function normalizeTrack(", "function normalizeVideoPage("), context);
  vm.runInContext(sourceSlice(source, "ui/track-utils.js", "function playbackTrackSnapshot(", "function formatDuration("), context);
  const snapshot = vm.runInContext("playbackTrackSnapshot", context);
  assert.equal(snapshot({ durationSeconds: 120.5 }).durationSeconds, 121);
});
