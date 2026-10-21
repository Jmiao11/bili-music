import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { readFileSync } from "./helpers/module-syntax.ts";
import { sourceSlice } from "./helpers/source-slice.ts";
import { attachSettingsVm } from "./helpers/settings-vm.ts";
const appearance = readFileSync(path.join(import.meta.dirname, "../ui/features/settings/appearance.ts"), "utf8");
const controller = sourceSlice(appearance, "ui/features/settings/appearance.ts", "function openSettings(", "async function restoreAudioCacheSettings(")
  + sourceSlice(appearance, "ui/features/settings/appearance.ts", "function closeSettings(", "function setActiveView(")
  + sourceSlice(appearance, "ui/features/settings/appearance.ts", "async function restoreAiConfig(", "async function saveAiConfig(");

test("settings reopening preserves Rust key_hint output including short and Unicode keys", async () => {
  // src-tauri/src/ai.rs:878-886: nonempty -> four bullets + last min(4, char count) Rust chars.
  // AiConfig::view at ai.rs:182-191 passes this hint unchanged and derives hasKey from !is_empty.
  for (const input of ["a", "ab", "abc", "abcd", "prefix-1234", "prefix-甲乙丙丁", "prefix-甲😀乙🎵"]) {
    const keyHint = "••••" + [...input].slice(-4).join("");
    let reads = 0;
    const context = vm.createContext({
      invokeAppearance: async (command: string) => { if (command !== "get_ai_config") throw Error("Unexpected command"); reads++; return { apiFormat: "openai-chat-completions", baseUrl: "", model: "", hasKey: true, keyHint }; },
      restoreStreamSource() {}, restoreAudioCacheSettings() {}, refreshAudioCacheUsage() {},  readShuffleCollectionPrefs: () => ({ order: "random", limit: 0 }),
    });
    attachSettingsVm(context); vm.runInContext(controller, context);
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    context.openSettings(); await flush();
    const expected = `API Key 已配置（${keyHint}）`;
    assert.equal(context.aiConfigStatus.textContent, expected);
    assert.equal(context.getSettingsSnapshot().view.ai.text, expected);
    context.closeSettings(); context.aiConfigStatus.textContent = "";
    context.openSettings(); await flush();
    assert.equal(context.aiConfigStatus.textContent, expected); assert.equal(reads, 2);
  }
});
