import { fixture, responses, track } from "./tracks-fixture.ts";

async function playbackFixture() {
  const h = await fixture({ playback: true, lyrics: true });
  const audio = h.doc.querySelector<HTMLAudioElement>("#audio")!;
  const media = { currentTime: 0, duration: 100, paused: true, ended: false, playbackRate: 1 };
  for (const key of ["currentTime", "duration", "paused", "ended", "playbackRate"] as const) Object.defineProperty(audio, key, { configurable: true, get: () => media[key], ...(key === "currentTime" ? { set: (value: number) => { media.currentTime = value; } } : {}) });
  const node = <T extends HTMLElement = HTMLElement>(id: string) => h.doc.getElementById(id) as T;
  const scrolls: { top?: number; behavior?: ScrollBehavior }[] = [];
  const lines = node("lyrics-lines");
  Object.defineProperties(lines, { clientHeight: { get: () => node("immersive-player").hidden ? 0 : 200 }, scrollHeight: { get: () => 800 } });
  lines.scrollTo = options => { if (typeof options === "object") scrolls.push(options); };
  const descendants = h.window.HTMLElement.prototype;
  Object.defineProperties(descendants, { offsetTop: { configurable: true, get() { return Number((this as HTMLElement).dataset.index ?? 0) * 80; } }, offsetHeight: { configurable: true, get: () => 40 } });
  h.reply(async (command, args) => command === "resolve_lyrics" ? { status: "none", lyrics: null } : responses()(command));
  const dispatch = (target: EventTarget, type: string) => target.dispatchEvent(new h.window.Event(type, { bubbles: true, cancelable: true }));
  return { ...h, node, audio, media, scrolls, dispatch };
}
function playbackStructure(element: Element): unknown {
  return { tag: element.localName, attributes: Object.fromEntries([...element.attributes].filter(attribute => !["value", "checked"].includes(attribute.name)).map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b))),
    ...(element instanceof element.ownerDocument.defaultView!.HTMLInputElement ? { value: element.value, checked: element.checked } : {}),
    children: [...element.childNodes].flatMap(node => node.nodeType === 1 ? [playbackStructure(node as Element)] : node.nodeType === 3 && node.textContent?.trim() ? [node.textContent.trim().replace(/\s+/g, " ")] : []) };
}
export { playbackFixture, playbackStructure, track };
