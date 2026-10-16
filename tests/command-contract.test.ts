import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";
import { readFileSync } from "./helpers/module-syntax.ts";
import { sourceSlice } from "./helpers/source-slice.ts";

const DEBUG_ONLY_COMMANDS = new Set(["debug_register_local_stream"]);
const root = path.resolve(import.meta.dirname, "..");

function registrations(source: string) {
  const start = source.indexOf("tauri::generate_handler![");
  assert.notEqual(start, -1, "Missing command registry");
  const end = source.indexOf("])", start);
  assert.notEqual(end, -1, "Unterminated command registry");
  const debug = new Set<string>();
  const release = new Set<string>();
  for (const entry of source.slice(start + "tauri::generate_handler![".length, end).split(",")) {
    const text = entry.trim();
    if (!text) continue;
    const match = /^(#\[cfg\(debug_assertions\)\]\s*)?((?:\w+::)*\w+)$/.exec(text);
    assert.ok(match, `Unsupported command registry entry: ${text}`);
    const parts = match[2].split("::");
    const name = parts[parts.length - 1];
    assert.ok(!debug.has(name), `Duplicate command: ${name}`);
    assert.equal(Boolean(match[1]), DEBUG_ONLY_COMMANDS.has(name), `Review debug-only command: ${name}`);
    debug.add(name);
    if (!match[1]) release.add(name);
  }
  return { debug, release };
}

function invokedCommands(source: string, file: string) {
  const code = maskCommentsAndStrings(source);
  const commands = new Set<string>();
  for (const match of code.matchAll(/\b(invoke|invokeAppearance|invokeWithTimeout)\s*\(/g)) {
    if (/\bfunction\s*$/.test(code.slice(0, match.index))) continue;
    const offset = match.index + match[0].length;
    const literal = /^\s*(["'])([a-z][a-z0-9_]*)\1\s*(?=[,)])/.exec(source.slice(offset));
    if (literal) { commands.add(literal[2]); continue; }
    // A forwarding implementation is not a command-name call site. Validate
    // its exact forwarding expression; callers of the wrapper must be literal.
    assert.equal(file, "ui/features/home/home.ts", `${file}: nonliteral command at offset ${match.index}`);
    const wrapper = sourceSlice(source, file, "function invokeWithTimeout                            (", "async function loadHomeRanking(");
    const wrapperStart = source.indexOf(wrapper);
    assert.ok(file === "ui/features/home/home.ts" && match[1] === "invoke"
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
  const used = new Set<string>();
  for (const name of fs.readdirSync(path.join(root, "ui"), { recursive: true }).map(name => String(name).replace(/\\/g, "/")).filter((name) => /\.(?:js|ts)$/.test(name))) {
    for (const command of invokedCommands(readFileSync(path.join(root, "ui", name), "utf8"), `ui/${name}`)) {
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
  const source = readFileSync(path.join(root, "ui/shared/track-utils.ts"), "utf8");
  const context = vm.createContext({ displayThumbnailUrl: (value: unknown) => value });
  vm.runInContext(sourceSlice(source, "ui/shared/track-utils.ts", "function normalizeTrack(", "function normalizeVideoPage("), context);
  vm.runInContext(sourceSlice(source, "ui/shared/track-utils.ts", "function playbackTrackSnapshot(", "function formatDuration("), context);
  const snapshot = vm.runInContext("playbackTrackSnapshot", context);
  assert.equal(snapshot({ durationSeconds: 120.5 }).durationSeconds, 121);
});

test("CommandMap covers debug and release registrations without exposing debug calls to UI", () => {
  const { debug, release } = registrations(fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8"));
  const source = fs.readFileSync(path.join(root, "types/command-contract.d.ts"), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("interface CommandMap {");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1);
  const keys = new Set<string>();
  for (const entry of source.slice(start + "interface CommandMap {".length, end).split(/\r?\n/).filter((line) => line.trim())) {
    const match = /^\s*([a-z][a-z0-9_]*): \{ args: .+; result: .+ \};$/.exec(entry);
    assert.ok(match, `Unsupported CommandMap entry: ${entry}`);
    assert.ok(!keys.has(match[1]), `Duplicate CommandMap key: ${match[1]}`);
    keys.add(match[1]);
  }
  assert.deepEqual([...keys].sort(), [...debug].sort());
  assert.deepEqual([...keys].filter((name) => !DEBUG_ONLY_COMMANDS.has(name)).sort(), [...release].sort());
});
function assertAudioResponseUrl(source: string): void {
  const response = /interface AudioResponse\s*\{([^}]*)\}/.exec(source);
  assert.ok(response, "AudioResponse contract must exist");
  assert.match(response[1], /\baudioUrl:\s*string\s*;/, "AudioResponse.audioUrl must remain a string");
}

test("audio response stream URL contract remains a string without compiler dependencies", () => {
  const source = fs.readFileSync(path.join(root, "types/command-contract.d.ts"), "utf8");
  assertAudioResponseUrl(source);
  assert.throws(() => assertAudioResponseUrl(source.replace(/(interface AudioResponse\s*\{\s*audioUrl:\s*)string/, "$1number")));
});
