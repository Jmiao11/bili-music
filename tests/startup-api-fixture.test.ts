import assert from "node:assert/strict";
import { test } from "node:test";
import { createMascotFixture } from "./helpers/startup-api-fixture.ts";

test("startup API fixture isolates real mascot instances and records persistence without real timers", () => {
  const first = createMascotFixture("none"), second = createMascotFixture();
  assert.equal(first.api.getActive(), "none"); assert.equal(second.api.getActive(), "kuro");
  assert.equal(first.api.setActive("nuomi"), "nuomi");
  assert.deepEqual(first.writes, [["bili-music-mascot", "nuomi"]]);
  assert.deepEqual(second.writes, []); assert.equal(second.api.getActive(), "kuro");
});
