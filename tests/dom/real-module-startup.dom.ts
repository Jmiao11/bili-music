import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";
import { collectBusinessScripts } from "../helpers/module-graph.ts";
import { loadMountedApplication as loadNativeModules } from "../../scripts/vue/startup-probe.ts";

test("real module graph dispatches once during main before appearance starts once", async () => {
  const ui = path.join(import.meta.dirname, "../../ui");
  const { modules } = collectBusinessScripts(ui);
  assert.equal(modules.length, 69); // C1 adds the pure library-entry module; startup assertions below stay intact.
  const loaded = await loadNativeModules(ui, modules, "app.ts");
  const changes = loaded.events.filter((event) => event.type === "bilibili-music-trackchange");
  const dispatches = changes.filter((event) => event.action === "dispatch");
  assert.equal(dispatches.length, 1);
  const from = (event: typeof changes[number], file: string, name?: string) => loaded.origins.get(event)?.some(frame => frame.file === fs.realpathSync(path.join(ui, file)) && (name === undefined || frame.functionName === name));
  assert.ok(from(dispatches[0], "features/playback/playback-core.ts", "emitCurrentTrackChanged"));
  assert.ok(from(dispatches[0], "app/main.ts"));
  const mainListener = changes.find((event) => event.action === "listen" && from(event, "features/playback/playback-core.ts"));
  const appearanceListener = changes.find((event) => event.action === "listen" && from(event, "features/settings/appearance.ts", "startAppearance"));
  assert.ok(mainListener);
  assert.ok(appearanceListener);
  assert.ok(loaded.events.indexOf(mainListener) < loaded.events.indexOf(dispatches[0]));
  assert.ok(loaded.events.indexOf(appearanceListener) > loaded.events.indexOf(dispatches[0]));
  const appearanceEvents = loaded.events.filter(event => from(event, "features/settings/appearance.ts", "startAppearance"));
  assert.ok(appearanceEvents.length > 0);
  assert.ok(appearanceEvents.every((event) => loaded.events.indexOf(event) > loaded.events.indexOf(dispatches[0])));
  const functions = loaded.coverage.filter((script) => /\/appearance\.ts$/.test(script.url)).flatMap((script) => script.functions);
  const appearance = functions.find((fn) => fn.functionName === "startAppearance");
  if (appearance === undefined) throw new Error("Appearance coverage is missing");
  assert.equal(appearance.ranges[0].count, 1);
});

test("startup probe identifies sources through project and temporary directory aliases", async () => {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, "bili-startup-alias-"));
  const project = path.join(root, "project"), temporary = path.join(root, "temporary");
  const keys = ["TEMP", "TMP", "TMPDIR"] as const;
  const saved = keys.map(key => process.env[key]);
  try {
    fs.symlinkSync(path.resolve(import.meta.dirname, "../.."), project, process.platform === "win32" ? "junction" : "dir");
    fs.symlinkSync(parent, temporary, process.platform === "win32" ? "junction" : "dir");
    for (const key of keys) process.env[key] = temporary;
    const loaded = await loadNativeModules(path.join(project, "ui"));
    const dispatch = loaded.events.find(event => event.action === "dispatch" && event.type === "bilibili-music-trackchange");
    assert.ok(dispatch);
    assert.ok(loaded.origins.get(dispatch)?.some(frame => frame.file === fs.realpathSync(path.join(project, "ui/app/main.ts"))));
    const appearance = loaded.coverage.filter(script => /\/appearance\.ts$/.test(script.url)).flatMap(script => script.functions).find(fn => fn.functionName === "startAppearance");
    assert.equal(appearance?.ranges[0].count, 1);
  } finally {
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
    for (const link of [project, temporary]) if (fs.existsSync(link)) fs.unlinkSync(link);
    if (path.dirname(root) !== parent) throw new Error("Unsafe alias fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
