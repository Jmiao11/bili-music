import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

const queueFields = ["queue", "queueSource", "queueSearchVersion", "queuePlaylistId", "currentIndex", "loopMode", "shuffle", "randomRemaining", "history", "currentPageIndex", "currentDisplayTrack"];
function assertQueueSnapshotReads(source: string): void {
  const code = maskCommentsAndStrings(source), origins = new Set<string>();
  const root = String.raw`(?:getQueueSnapshot\s*\(\s*\)|\w+\.getState\s*\(\s*\)\.playbackQueue)`;
  let changed = true;
  while (changed) {
    changed = false;
    const known = origins.size ? `|(?:${[...origins].join("|")})\\b` : "";
    const aliases = new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*(?:${root}${known})(?:\s*\.[\w$]+|\s*\[[^\]]+\])*\s*[;,]`, "g");
    for (const match of code.matchAll(aliases)) if (!origins.has(match[1])) { origins.add(match[1]); changed = true; }
  }
  const bases = `(?:${root}${origins.size ? "|\\b(?:" + [...origins].join("|") + ")\\b" : ""})`;
  const paths = String.raw`(?:\s*\.[\w$]+|\s*\[[^\]]+\])`, targets = `${bases}${paths}*`;
  assert.doesNotMatch(code, new RegExp(String.raw`${bases}${paths}+\s*(?:=(?!=|>)|\+=|-=|\+\+|--)`));
  assert.doesNotMatch(code, new RegExp(String.raw`\b(?:Object\.assign|Reflect\.set)\s*\(\s*${targets}\s*,`));
  assert.doesNotMatch(code, new RegExp(String.raw`${targets}\s*\.\s*(?:push|pop|splice|shift|unshift|sort|reverse|set|add|delete|clear)\s*\(`));
}

test("queue ownership removes migrated request-state fields and rejects direct and aliased snapshot writes", () => {
  const root = path.join(import.meta.dirname, "../ui"), request = fs.readFileSync(path.join(root, "player-state.ts"), "utf8");
  for (const field of queueFields) assert.doesNotMatch(request, new RegExp(String.raw`\b${field}\s*:`));
  for (const file of ["playback-core.ts", "main.ts", "library-ui.ts"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8"); assertQueueSnapshotReads(source);
    assert.doesNotMatch(maskCommentsAndStrings(source), new RegExp(String.raw`\bplayerState\.(?:${queueFields.join("|")})\b`));
  }
  for (const source of ["getQueueSnapshot().currentIndex = 1;", "getQueueSnapshot().queue.push(track);", "const row = getQueueSnapshot().queue[index]; Object.assign(row, metadata);", "const queue = store.getState().playbackQueue; const rows = queue.queue; Reflect.set(rows[0], 'title', title);"]) assert.throws(() => assertQueueSnapshotReads(source));
  assert.doesNotThrow(() => assertQueueSnapshotReads("const queue = getQueueSnapshot(); const copy = { ...queue.queue[0], title };"));
});

test("queue state obtains randomness and preferences from arguments and queue renderer remains readonly", () => {
  const root = path.join(import.meta.dirname, "../ui"), state = maskCommentsAndStrings(fs.readFileSync(path.join(root, "playback-queue-state.ts"), "utf8"));
  assert.doesNotMatch(state, /\bMath\s*\.\s*random\b|\bDate\b|\bperformance\b|\blocalStorage\b/);
  const core = fs.readFileSync(path.join(root, "playback-core.ts"), "utf8"), render = core.slice(core.indexOf("function updateQueueUi()"), core.indexOf("function isFavorited("));
  assert.doesNotMatch(maskCommentsAndStrings(render), /\b(?:getQueueActions|invoke)\b|\.actions\b/);
  assertQueueSnapshotReads(render);
});
