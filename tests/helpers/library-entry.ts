import assert from "node:assert/strict";
import type { DeepReadonly } from "../../ui/store/state-store.ts";

function expectVideo(entry: DeepReadonly<CommandContract.LibraryEntry>) {
  assert.equal(entry.kind, "video");
  if (entry.kind !== "video") throw Error("Expected the original video fixture");
  return entry.video;
}
export { expectVideo };
