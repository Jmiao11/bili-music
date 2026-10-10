import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

const messageReadExceptions: { selector: string; function: string; reason: string }[] = [];
function checkHost(source: string) {
  const messages = source.slice(source.indexOf("function readMiniPlayerMessages("), source.indexOf("function createMiniPlayerHost("));
  assert.deepEqual([...messages.matchAll(/querySelector\("([^"]+)"\)/g)].map(match => match[1]), messageReadExceptions.map(item => item.selector));
  const rest = maskCommentsAndStrings(source.replace(messages, ""));
  assert.doesNotMatch(rest, /\.\s*(?:textContent(?!\s*=)|dataset|classList|getAttribute|getPropertyValue|disabled)\b/, "host synchronization must use snapshot inputs");
  assert.doesNotMatch(rest, /\.\s*click\s*\(/, "host commands cannot simulate clicks");
}
test("mini host DOM message exceptions exactly match approved state-9 debt", () => {
  assert.deepEqual(messageReadExceptions, []);
});
test("mini host publishes snapshots with only the two approved message reads", () => {
  checkHost(fs.readFileSync(path.join(import.meta.dirname, "../ui/mini-player-host.ts"), "utf8"));
});
test("mini host guard rejects DOM field regressions and simulated playback clicks", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "../ui/mini-player-host.ts"), "utf8");
  for (const bad of ['const title = document.querySelector("#title").textContent;', 'button.click();']) assert.throws(() => checkHost(source + bad));
});

function checkClassicBridgeReaders(ui: string) {
  for (const page of ["index.html", "mini.html"]) {
    const html = fs.readFileSync(path.join(ui, page), "utf8");
    for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\btype=["']module["']/.test(tag[1])) continue;
    const src = /\bsrc=["'](?:\.\/)?([^"']+)["']/.exec(tag[1]);
    if (!src) { assert.doesNotMatch(maskCommentsAndStrings(tag[2]), /\bbilibiliMusicMiniHost\b/, page + ": inline classic bridge reader is forbidden"); continue; }
    const file = src[1].replace(/\.js$/, ".ts"); if (file === "mini-player-host.ts") continue;
    assert.doesNotMatch(maskCommentsAndStrings(fs.readFileSync(path.join(ui, file), "utf8")), /\bbilibiliMusicMiniHost\b/, file + ": classic bridge reader is forbidden");
    }
  }
}
test("mini bridge is consumed only by the host among classic scripts", () => { checkClassicBridgeReaders(path.join(import.meta.dirname, "../ui")); });
