import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

function checkMessageWriter(source: string, file: string): void {
  if (file === "features/playback/playback-messages-projection.ts") return;
  const code = maskCommentsAndStrings(source);
  assert.doesNotMatch(code, /\b(?:status|playbackStatus|playbackNotice)\s*\.\s*textContent\s*=/, file + ": messages have a single renderer");
  assert.doesNotMatch(code, /\bplaybackNotice\s*\.\s*(?:dataset\s*\.\s*kind\s*=|classList\s*\.\s*(?:add|remove|toggle)\s*\()/, file + ": notice presentation belongs to renderer");
}
function checkMessageRenderer(source: string): void {
  assert.doesNotMatch(maskCommentsAndStrings(source), /\.\s*actions\b|\b(?:invoke|getApplicationStore|setPlaybackStatus|getPlaybackMessagesActions)\s*\(/, "message renderer is readonly");
}
test("playback message DOM ownership and readonly renderer are enforced", () => {
  const ui = path.join(import.meta.dirname, "../ui");
  for (const file of fs.readdirSync(ui, { recursive: true }).map(name => String(name).replace(/\\/g, "/")).filter(file => file.endsWith(".ts"))) checkMessageWriter(fs.readFileSync(path.join(ui, file), "utf8"), file);
  checkMessageRenderer(fs.readFileSync(path.join(ui, "features/playback/playback-messages-projection.ts"), "utf8"));
});
test("playback message guard rejects other writers and renderer actions", () => {
  for (const code of ['status.textContent = "旧写法";', 'playbackNotice.dataset.kind = "error";', 'playbackNotice.classList.add("is-visible");']) assert.throws(() => checkMessageWriter(code, "counterexample.ts"));
  for (const code of ['store.actions.playbackMessages.setStatus("错误");', 'getPlaybackMessagesActions().clearNotice();']) assert.throws(() => checkMessageRenderer(code));
});
