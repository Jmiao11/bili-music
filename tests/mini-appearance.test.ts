import assert from "node:assert/strict";
import { test } from "node:test";
import { createMiniHostFixture } from "./helpers/mini-host-fixture.ts";

test("mini image appearance uses the existing coalesced channel and publishes current path and dim", async t => {
  const h = await createMiniHostFixture();
  t.after(() => h.publishEvent("beforeunload"));
  // This native mock needs the title-removal port used when resetting the image.
  const backgroundName = h.node("#background-name");
  Object.assign(backgroundName, { removeAttribute: (name: string) => { backgroundName.attributes.delete(name); } });
  await h.fire("mini-player-ready");
  h.store.actions.settings.setTheme("image", false);
  h.store.actions.settings.applyImage({ path: "X:/synthetic/background.png", displayName: "background.png", dataUrl: "data:image/png;base64,AA==", width: 1, height: 1 });
  h.store.actions.settings.setSlider("dim", 40, false);
  h.store.actions.settings.setSlider("dim", 70, false);
  assert.equal(h.frameCount(), 1);
  await h.flushFrame();
  const payload = h.emissions.at(-1)!.payload;
  assert.equal(payload.backgroundPath, "X:/synthetic/background.png");
  assert.equal(payload.backgroundDim, 70);
  assert.equal(JSON.stringify(payload).includes("data:image"), false);
  h.store.actions.settings.applyImage({ path: "X:/synthetic/background.png", displayName: "replacement.png", dataUrl: "data:image/png;base64,AQ==", width: 1, height: 1 });
  await h.flushFrame();
  assert.ok(h.emissions.at(-1)!.payload.backgroundVersion! > payload.backgroundVersion!);
  const count = h.emissions.length;
  h.store.actions.settings.setSlider("dim", 70, false);
  await h.flush();
  assert.equal(h.emissions.length, count);
  h.store.actions.settings.resetBackground();
  await h.flushFrame();
  assert.equal(h.emissions.at(-1)!.payload.backgroundPath, null);
});

test("mini dynamic appearance sends the main palette and removes image-only fields", async t => {
  const h = await createMiniHostFixture();
  t.after(() => h.publishEvent("beforeunload"));
  await h.fire("mini-player-ready");
  h.store.actions.settings.setTheme("dynamic", false);
  await h.flushFrame();
  const payload = h.emissions.at(-1)!.payload;
  assert.deepEqual(payload.dynamicColors, ["rgb(48, 54, 64)", "color-mix(in srgb, var(--accent) 30%, #303640)", "rgb(58, 62, 70)"]);
  assert.equal(payload.backgroundPath, undefined);
  assert.equal(payload.backgroundDim, undefined);
});
