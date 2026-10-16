import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";
const ui = path.join(import.meta.dirname, "../ui");
function assertSettingsRenderer(source: string): void {
  const code = maskCommentsAndStrings(source);
  assert.doesNotMatch(code, /\b(?:invoke|getSettingsActions|createApplicationStore)\b|\.\s*actions\b/);
  assert.doesNotMatch(code, /\b(?:state|previous)\s*(?:\.\s*\w+|\s*\[[^\]]+\])+\s*(?:=(?!=|>)|\+=|-=|\+\+|--)/);
  for (const match of source.matchAll(/\bimport\b[^;]*?["']([^"']+)["']/g)) assert.ok(["./settings-state.ts", "./appearance.ts"].includes(match[1]));
}
test("settings renderer is readonly and owns migrated settings and page session output", () => {
  assertSettingsRenderer(fs.readFileSync(path.join(ui, "features/settings/settings-view.ts"), "utf8"));
  for (const bad of ["store.actions.setTheme('dark');", "invoke('get_ai_config');", "state.ai.model = 'x';"]) assert.throws(() => assertSettingsRenderer(bad));
  const appearance = maskCommentsAndStrings(fs.readFileSync(path.join(ui, "features/settings/appearance.ts"), "utf8"));
  assert.doesNotMatch(appearance, /\b(?:appearanceStatus|audioCacheStatus|audioCacheUsage|streamSourceStatus|aiConfigStatus|backgroundName|placeholderTitle)\s*\.\s*textContent\s*=/);
  assert.doesNotMatch(appearance, /\b(?:glassBlurSlider|panelAlphaSlider|backgroundDimSlider|streamSourceSelect|shuffleCollectionOrder|shuffleCollectionLimit|aiApiKeyInput)\s*\.\s*value\s*=/);
  assert.doesNotMatch(appearance, /\broot\s*\.\s*(?:dataset\s*\.\s*theme\s*=|style\s*\.\s*(?:setProperty|removeProperty)\s*\()/);
});
test("settings snapshot guard rejects direct and aliased writes in controllers", () => {
  function check(source: string): void {
    const code = maskCommentsAndStrings(source), aliases = new Set<string>();
    let changed = true;
    while (changed) { changed = false; const bases = "getSettingsSnapshot\\s*\\(\\s*\\)" + (aliases.size ? "|\\b(?:" + [...aliases].join("|") + ")\\b" : "");
      for (const m of code.matchAll(new RegExp("\\b(?:const|let)\\s+(\\w+)\\s*=\\s*(?:" + bases + ")(?:\\s*\\.\\s*\\w+|\\s*\\[[^\\]]+\\])*\\s*[;,]", "g"))) if (!aliases.has(m[1])) { aliases.add(m[1]); changed = true; }
    }
    const base = "(?:getSettingsSnapshot\\s*\\(\\s*\\)" + (aliases.size ? "|\\b(?:" + [...aliases].join("|") + ")\\b" : "") + ")", target = base + "(?:\\s*\\.\\s*\\w+|\\s*\\[[^\\]]+\\])+";
    assert.doesNotMatch(code, new RegExp(target + "\\s*(?:=(?!=|>)|\\+=|-=|\\+\\+|--)"));
    assert.doesNotMatch(code, new RegExp("\\b(?:Object\\.assign|Reflect\\.set)\\s*\\(\\s*" + base));
  }
  check(fs.readFileSync(path.join(ui, "features/settings/appearance.ts"), "utf8"));
  for (const bad of ["getSettingsSnapshot().theme = 'light';", "const config = getSettingsSnapshot().ai; config.model = 'bad';", "const config = getSettingsSnapshot().ai; Object.assign(config, input);"]) assert.throws(() => check(bad));
});
