import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaybackControlFixture } from "./helpers/playback-control-fixture.ts";

test("control fixture installs real navigation handlers and exposes actual invocation boundaries", async () => {
  const h = await createPlaybackControlFixture();
  h.node("#previous-button").click(); h.node("#next-button").click(); await h.flush();
  assert.deepEqual(h.navigation, ["previous", "next"]);
  assert.deepEqual(h.invocations, ["set_taskbar_playback_state"]);
});

test("control fixture follows native disabled click suppression without moving focus", async () => {
  const h = await createPlaybackControlFixture();
  const button = h.node("#play-pause-button"); button.disabled = true; button.click(); await h.flush();
  assert.deepEqual(h.audio.operations, []); assert.equal(h.context.resumes, 0);
  assert.equal(h.context.document.activeElement, h.focused);
});
