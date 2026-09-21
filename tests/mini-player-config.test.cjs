const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("main titlebar exposes the mini player without changing the minimize control", () => {
  const html = read("ui/index.html");
  assert.match(html, /id="mini-player-button"/);
  assert.match(html, /id="window-minimize-button"/);
  const utilityIndex = html.indexOf('class="window-utility-controls"');
  const miniIndex = html.indexOf('id="mini-player-button"');
  const controlsIndex = html.indexOf('class="window-controls"');
  assert.ok(utilityIndex < miniIndex && miniIndex < controlsIndex);
  assert.ok(miniIndex < html.indexOf('id="window-minimize-button"'));
  assert.match(html, /src="\.\/mini-player-host\.js"/);
  assert.ok(existsSync(path.join(root, "ui/mini.html")));
  assert.ok(existsSync(path.join(root, "ui/mini.js")));
  assert.ok(existsSync(path.join(root, "ui/mini.css")));
});

test("mini capability is scoped to the mini window and only grants required window APIs", () => {
  const capability = JSON.parse(read("src-tauri/capabilities/mini.json"));
  assert.deepEqual(capability.windows, ["mini"]);
  assert.deepEqual(capability.permissions, [
    "core:event:default",
    "core:window:allow-start-dragging",
    "core:window:allow-close",
    "core:window:allow-outer-position",
    "core:window:allow-outer-size",
    "core:window:allow-set-position",
    "core:window:allow-available-monitors",
  ]);
});

test("backend registers the three mini window commands and close recovery hook", () => {
  const backend = read("src-tauri/src/main.rs");
  const miniBackend = read("src-tauri/src/mini_player.rs");
  assert.match(backend, /mod mini_player;/);
  assert.match(backend, /mini_player::open_mini_player/);
  assert.match(backend, /mini_player::mini_player_ready/);
  assert.match(backend, /mini_player::exit_mini_player/);
  assert.match(backend, /on_window_event/);
  assert.match(miniBackend, /#\[cfg\(target_os = "windows"\)\]/);
  assert.doesNotMatch(miniBackend, /cfg!\(windows\)/);
  assert.match(miniBackend, /pub\s+async\s+fn\s+open_mini_player/);
});

test("mini page controls start disabled and favorite changes are published after real results", () => {
  const miniHtml = read("ui/mini.html");
  assert.doesNotMatch(miniHtml, /id="mini-uploader"/);
  assert.doesNotMatch(miniHtml, /id="mini-status"/);
  assert.match(miniHtml, /id="mini-title-viewport"/);
  for (const id of ["mini-previous", "mini-play-pause", "mini-next", "mini-favorite"]) {
    assert.match(miniHtml, new RegExp(`id="${id}"[^>]*disabled`), id);
  }

  const main = read("ui/main.js");
  assert.ok((main.match(/bilibili-music-favorite-change/g) ?? []).length >= 2);
});
