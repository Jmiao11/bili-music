import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

function assertMediaVolumeOwner(source: string, file: string): void {
  if (file === "platform/media-adapter.ts") return;
  const code = maskCommentsAndStrings(source);
  // Block all volume property writes: no new audio alias can bypass ownership.
  assert.doesNotMatch(code, /\.\s*volume\s*(?:=(?!=|>)|\+=|-=|\*=|\/=|\+\+|--)/, `${file}: media volume belongs to media-adapter`);
  for (const match of source.matchAll(/(?:\[\s*["']volume["']\s*\]\s*(?:=(?!=|>)|\+=|-=)|(?:Reflect\.set|Object\.defineProperty)\s*\([^,]+,\s*["']volume["'])/g)) if (code[match.index] === source[match.index]) assert.fail(`${file}: volume property mutation outside media-adapter: ${match[0]}`);
}
test("media volume writes belong exclusively to the media adapter", () => {
  const ui = path.join(import.meta.dirname, "../ui");
  for (const file of fs.readdirSync(ui, { recursive: true }).map(name => String(name).replace(/\\/g, "/")).filter(file => file.endsWith(".ts"))) assertMediaVolumeOwner(fs.readFileSync(path.join(ui, file), "utf8"), file);
});
test("media volume ownership rejects audio aliases compound and reflective writes", () => {
  for (const source of ["audio.volume = 0;", "playerAudio.volume *= 0.5;", "const target = audio; target.volume++;", "audio['volume'] = 1;", "Reflect.set(audio, 'volume', 1);", "Object.defineProperty(audio, 'volume', {});"]) assert.throws(() => assertMediaVolumeOwner(source, "bad.ts"));
  assert.doesNotThrow(() => assertMediaVolumeOwner("const volume = audio.volume; adapter.setVolume(volume);", "valid.ts"));
});

test("playback settings renderer reads snapshots without actions invoke or snapshot mutation", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "../ui/features/playback/playback-settings-view.ts"), "utf8");
  const check = (text: string) => assert.doesNotMatch(maskCommentsAndStrings(text), /\b(?:invoke|getPlaybackSettingsActions|createApplicationStore)\b|\.\s*actions\b|\bstate\s*\.\s*\w+\s*=(?!=|>)/);
  check(source);
  for (const invalid of ["store.actions.setGain(1);", "invoke('get_track_loudness');", "state.userVolume = 0;"]) assert.throws(() => check(invalid));
});
