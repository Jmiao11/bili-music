import { fixture, unavailable } from "./library-modal-fixture.ts";

type Kind = "generic" | "name" | "delete" | "choose" | "favoriteImport" | "purge" | "loudness";
async function open(h: Awaited<ReturnType<typeof fixture>>, kind: Kind) {
  const selector = { generic: "#create-playlist-button", name: "#create-playlist-button", delete: "#delete-playlist-button", choose: '#favorites-list button[aria-label="加入歌单"]', favoriteImport: "#import-playlist-button", purge: "#purge-unavailable-tracks-button", loudness: "#loudness-normalization-toggle" }[kind];
  const trigger = h.doc.querySelector<HTMLElement>(selector)!; trigger.focus();
  if (kind === "generic") h.store.actions.library.openModal("generic", "通用浮层", "只读基线");
  else if (kind === "purge") { h.reply(async () => unavailable); await h.click(trigger); }
  else if (kind === "loudness") { (trigger as HTMLInputElement).checked = true; await h.fire(trigger, "change"); }
  else await h.click(trigger);
  return trigger;
}

export { open };
export type { Kind };
