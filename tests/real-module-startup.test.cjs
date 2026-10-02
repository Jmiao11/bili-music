const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { collectBusinessScripts } = require("./helpers/module-graph.cjs");
const { loadNativeModules } = require("./helpers/native-module-loader.cjs");

test("real module graph dispatches once during main before appearance starts once", async () => {
  const ui = path.join(__dirname, "../ui");
  const { modules } = collectBusinessScripts(ui);
  assert.equal(modules.length, 14);
  const loaded = await loadNativeModules(ui, modules, "app.js");
  const changes = loaded.events.filter((event) => event.type === "bilibili-music-trackchange");
  const dispatches = changes.filter((event) => event.action === "dispatch");
  assert.equal(dispatches.length, 1);
  assert.match(dispatches[0].stack, /emitCurrentTrackChanged .*main\.js/);
  assert.match(dispatches[0].stack, /at file:.*\/main\.js:\d+:\d+/);
  const mainListener = changes.find((event) => event.action === "listen" && /\/main\.js:/.test(event.stack));
  const appearanceListener = changes.find((event) => event.action === "listen" && /startAppearance .*appearance\.js/.test(event.stack));
  assert.ok(mainListener);
  assert.ok(appearanceListener);
  assert.ok(loaded.events.indexOf(mainListener) < loaded.events.indexOf(dispatches[0]));
  assert.ok(loaded.events.indexOf(appearanceListener) > loaded.events.indexOf(dispatches[0]));
  const appearanceEvents = loaded.events.filter((event) => /startAppearance .*appearance\.js/.test(event.stack));
  assert.ok(appearanceEvents.length > 0);
  assert.ok(appearanceEvents.every((event) => loaded.events.indexOf(event) > loaded.events.indexOf(dispatches[0])));
  const functions = loaded.coverage.filter((script) => /\/appearance\.js$/.test(script.url)).flatMap((script) => script.functions);
  assert.equal(functions.find((fn) => fn.functionName === "startAppearance").ranges[0].count, 1);
});
