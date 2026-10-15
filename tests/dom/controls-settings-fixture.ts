import { fixture, responses } from "./tracks-fixture.ts";
import { playbackStructure } from "./playback-ui-fixture.ts";

const aiConfig = { apiFormat: "openai-chat-completions", baseUrl: "https://example.test/v1", model: "test-model", hasKey: true, keyHint: "••••1234" };
// ai.rs:182-191; audio_cache.rs:60-67; appearance.rs:16-23; shortcut_config.rs:31.
async function settingsReply(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (["list_favorites", "list_playlists", "list_unavailable_tracks"].includes(command)) return [];
  if (command === "get_ai_config" || command === "set_ai_config") return aiConfig;
  if (command === "test_ai_connection") return { ok: true, message: "ok" };
  if (command === "get_audio_cache_settings") return { enabled: true, maxBytes: 2147483648 };
  if (command === "set_audio_cache_settings") return args;
  if (command === "get_audio_cache_usage") return { bytes: 1048576, items: 2 };
  if (command === "get_stream_source") return "guest";
  if (command === "set_stream_source") return args.source;
  if (command === "get_yt_dlp_availability") return { available: true };
  if (command === "choose_background_image") return { path: "X:/test/背景.jpg", displayName: "背景.jpg", dataUrl: "data:image/jpeg;base64,/9j/2Q==", width: 2, height: 3 };
  return responses()(command);
}
async function controlsSettingsFixture() {
  const h = await fixture({ playback: true });
  const node = <T extends HTMLElement = HTMLElement>(id: string) => h.doc.getElementById(id) as T;
  h.reply(settingsReply);
  const input = async (id: string, value: string, event = "input") => { node<HTMLInputElement>(id).value = value; await h.fire(node(id), event); };
  const open = async () => { await h.fire(node("open-settings-button"), "click"); h.raf(); await h.microtasks(); };
  return { ...h, node, input, open };
}
const controlsStructure = playbackStructure;
export { aiConfig, controlsSettingsFixture, controlsStructure, settingsReply };
