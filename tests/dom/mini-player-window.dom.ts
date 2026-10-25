import {loadMiniFactory} from "./mini-runtime.ts";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { readFileSync } from "../helpers/module-syntax.ts";
import path from "node:path";
import { test, afterEach } from "node:test";



const styles = readFileSync(path.join(import.meta.dirname, "../../ui/mini.css"), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

type MiniElement = EventTarget & {
  dataset: Record<string, string>; textContent: string; disabled: boolean; hidden: boolean;
  style: Record<string, unknown>; attributes: Record<string, string>;
  focus?: () => void; clientWidth?: number; scrollWidth?: number;
  classList: { add(name: string): unknown; contains(name: string): boolean; remove(name: string): unknown; toggle(name: string, force: boolean): unknown };
  setAttribute(name: string, value: unknown): void; removeAttribute(name: string): void; getAttribute(name: string): string | null;
};
const eventDom = new JSDOM();
const Event = eventDom.window.Event;
eventDom.window.close();
const closeWindows: (() => void)[] = [];
afterEach(() => { for (const close of closeWindows.splice(0)) close(); });
async function setup({ stored = null, failStorage = false, failSetPosition = false, initial, failReadyEvent=false }: { stored?: string | null; failStorage?: boolean; failSetPosition?: boolean; initial?: Partial<MiniPlayerStatePayload>; failReadyEvent?:boolean } = {}) {
  const dom = new JSDOM(readFileSync(path.join(import.meta.dirname, "../../ui/mini.html"), "utf8"), {url:"http://localhost/mini.html"});
  closeWindows.push(() => dom.window.close());
  const controls = Object.fromEntries([...dom.window.document.querySelectorAll<HTMLElement>("[id]")].map(node => ["#"+node.id, node])) as unknown as Record<string, MiniElement>;
  const root = dom.window.document.documentElement as unknown as MiniElement;
  const document = dom.window.document as unknown as EventTarget & {documentElement:MiniElement;querySelector(selector:string):MiniElement|null;getElementById(id:string):MiniElement|null;activeElement?:MiniElement};
  const active = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(dom.window.document), "activeElement")!;
  Object.defineProperty(document, "activeElement", {get:()=>active.get!.call(document),set:(node:HTMLElement)=>dom.window.HTMLElement.prototype.focus.call(node),configurable:true});
  const listeners = new Map();
  const emitted: { name: string; payload: unknown }[] = [];
  const readyNodes: (Element | null)[] = [];
  const startupOrder: string[] = [];
  const warnings: unknown[][] = [];
  const invoked: string[] = [];
  const writes: [string, string][] = [];
  const storage = {
    getItem() {
      if (failStorage) throw new Error("blocked");
      return stored;
    },
    setItem(name: string, value: string) {
      if (failStorage) throw new Error("blocked");
      writes.push([name, value]);
    },
  };
  const eventApi = {
    listen(name: string, handler: (...args: unknown[]) => unknown) {
      listeners.set(name, handler);
      startupOrder.push("listen:"+name);
      if(initial) handler({payload:initial});
      return Promise.resolve(() => listeners.delete(name));
    },
    emit(name: string, payload: unknown) {
      emitted.push({ name, payload });
      startupOrder.push("emit:"+name);
      if(name === "mini-player-ready") readyNodes.push(dom.window.document.getElementById("mini-title"));
      if(name === "mini-player-ready" && failReadyEvent) return Promise.reject(Error("event unavailable"));
      return Promise.resolve();
    },
  };
  type Position = { x: number; y: number };
  type WindowApi = { startDragging(): Promise<void>; moved?: (event?: unknown) => unknown; position?: Position;
    onMoved(handler: (event?: unknown) => unknown): Promise<() => void>; outerPosition(): Promise<Position>; outerSize(): Promise<{ width: number; height: number }>; setPosition(position: Position): Promise<void> };
  const windowApi: WindowApi = {
    startDragging: () => Promise.resolve(),
    onMoved(handler: (event?: unknown) => unknown) { this.moved = handler; return Promise.resolve(() => {}); },
    outerPosition: () => Promise.resolve({ x: 410, y: 220 }),
    outerSize: () => Promise.resolve({ width: 320, height: 92 }),
    setPosition(position: Position) {
      if (failSetPosition) return Promise.reject(new Error("blocked"));
      this.position = position;
      return Promise.resolve();
    },
  };
  const availableMonitors = () => Promise.resolve([{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }]);
  const dpi = { PhysicalPosition: class PhysicalPosition { declare x: number; declare y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } } };
  const window = dom.window;
  const runtime = await loadMiniFactory(dom.window.document);
  closeWindows.push(runtime.restore);
  const controller = runtime.create({
    eventApi,
    invoke: (command: string) => { invoked.push(command); startupOrder.push("invoke:"+command); if(command === "mini_player_ready") readyNodes.push(dom.window.document.getElementById("mini-title")); return Promise.resolve(); },
    windowApi,
    availableMonitors,
    dpi,
    document,
    storage,
    window,
    console: { warn(...args:unknown[]) {warnings.push(args);} },
  });
  for(const key of Object.keys(controls)) controls[key]=dom.window.document.querySelector(key) as unknown as MiniElement;
  for(const [node,names] of [[root,["--accent-r"]],[controls["#mini-title"],["--mini-title-distance","--mini-title-duration"]]] as const) for(const name of names) Object.defineProperty(node.style,name,{get:()=>((node.style as unknown as CSSStyleDeclaration).getPropertyValue(name)||undefined),set:(value:string)=>{if(value)(node.style as unknown as CSSStyleDeclaration).setProperty(name,value);},configurable:true});
  for(const [node,name] of [[controls["#mini-title-viewport"],"clientWidth"],[controls["#mini-title"],"scrollWidth"]] as const) Object.defineProperty(node,name,{value:0,writable:true,configurable:true});
  return {
    controls, root, document, window, listeners, emitted, invoked, writes, storage, windowApi, controller, readyNodes, startupOrder, warnings,
    fire: (name: string, payload: unknown) => listeners.get(name)?.({ payload }),
  };
}

test("mini displays and clears host notices without disabling navigation", async () => {
  const app = await setup();
  await app.controller.start();
  app.fire("mini-player-state", { notice: "暂无可播放的歌曲", canPrevious: true, canNext: true });
  assert.equal(app.controls["#mini-notice"].textContent, "暂无可播放的歌曲");
  assert.equal(app.controls["#mini-notice"].hidden, false);
  assert.equal(app.controls["#mini-next"].disabled, false);
  app.fire("mini-player-state", { notice: "" });
  assert.equal(app.controls["#mini-notice"].hidden, true);
});

test("long notices offer a full-text entry, sync updates, and clear together", async () => {
  const app = await setup();
  await app.controller.start();
  const long = "解析失败：上游返回 502，已重试 3 次仍未成功，队列中没有可继续播放的内容。";
  app.fire("mini-player-state", { notice: long });
  assert.equal(app.controls["#mini-notice"].textContent, long);
  assert.equal(app.controls["#mini-notice-more"].hidden, false);
  assert.equal(app.controls["#mini-notice-full"].hidden, true);
  // 点击「全文」展开完整内容
  app.controls["#mini-notice-more"].dispatchEvent(new Event("click"));
  assert.equal(app.controls["#mini-notice-full"].hidden, false);
  assert.equal(app.controls["#mini-notice-full"].textContent, long);
  assert.equal(app.controls["#mini-notice-more"].getAttribute("aria-expanded"), "true");
  // 展开期间收到新消息，全文同步为最新内容
  const next = "队列中多首无法播放，已停止。";
  app.fire("mini-player-state", { notice: next });
  assert.equal(app.controls["#mini-notice-full"].textContent, next);
  // 再次点击收起
  app.controls["#mini-notice-more"].dispatchEvent(new Event("click"));
  assert.equal(app.controls["#mini-notice-full"].hidden, true);
  assert.equal(app.controls["#mini-notice-full"].textContent, "");
  assert.equal(app.controls["#mini-notice-more"].getAttribute("aria-expanded"), "false");
  // 消息清除时三者联动隐藏
  app.controls["#mini-notice-more"].dispatchEvent(new Event("click"));
  assert.equal(app.controls["#mini-notice-full"].hidden, false);
  app.fire("mini-player-state", { notice: "" });
  assert.equal(app.controls["#mini-notice"].hidden, true);
  assert.equal(app.controls["#mini-notice-more"].hidden, true);
  assert.equal(app.controls["#mini-notice-full"].hidden, true);
  assert.equal(app.controls["#mini-notice-more"].getAttribute("aria-expanded"), "false");
});

test("full text pointer interaction does not drag; blank space still drags", async () => {
  const app = await setup();
  let drags = 0;
  app.windowApi.startDragging = () => { drags++; return Promise.resolve(); };
  await app.controller.start();
  for (const protectedTarget of ["button", "#mini-notice-full", null]) {
    const event = new Event("pointerdown", { cancelable: true });
    Object.defineProperty(event, "button", { value: 0 });
    Object.defineProperty(event, "target", { value: {
      closest: (selector => protectedTarget && selector.split(", ").includes(protectedTarget) ? {} : null) as (selector: string) => object | null,
    } });
    app.controls["#mini-drag-region"].dispatchEvent(event);
    assert.equal(event.defaultPrevented, protectedTarget === null);
  }
  assert.equal(drags, 1);
});

test("full text supports Escape and focus recovery when an open notice expires", async () => {
  const app = await setup();
  const more = app.controls["#mini-notice-more"];
  const full = app.controls["#mini-notice-full"];
  more.focus = () => { app.document.activeElement = more; };
  app.controls["#mini-restore"].focus = () => { app.document.activeElement = app.controls["#mini-restore"]; };
  await app.controller.start();
  app.fire("mini-player-state", { notice: "错误详情" });
  more.dispatchEvent(new Event("click"));
  app.document.activeElement = full;
  full.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  assert.equal(full.hidden, true);
  assert.equal(app.document.activeElement, more);
  more.dispatchEvent(new Event("click"));
  app.document.activeElement = full;
  app.fire("mini-player-state", { notice: "" });
  assert.equal(full.hidden, true);
  assert.equal(app.document.activeElement, app.controls["#mini-restore"]);
});

test("start restores a valid position, signals both handshake channels, and renders state", async () => {
  const app = await setup({ stored: JSON.stringify({ x: 2500, y: 1400 }) });
  await app.controller.start();
  await settle();
  const restoredPosition = app.windowApi.position;
  if (!restoredPosition) throw new Error("Restored position is missing");
  assert.deepEqual({ x: restoredPosition.x, y: restoredPosition.y }, { x: 1600, y: 988 });
  assert.deepEqual(app.emitted, [{ name: "mini-player-ready", payload: undefined }]);
  assert.deepEqual(app.invoked, ["mini_player_ready"]);

  app.fire("mini-player-state", {
    title: "正在播放", thumbnailUrl: "https://example.com/a.jpg",
    hasCurrent: true, canPrevious: false, canNext: true,
    isPlaying: true, isFavorited: true, theme: "light", accent: { r: 1, g: 2, b: 3 },
  });
  assert.equal(app.controls["#mini-title"].textContent, "正在播放");
  assert.equal(app.controls["#mini-cover"].getAttribute("src"), "https://example.com/a.jpg");
  assert.equal(app.controls["#mini-previous"].disabled, true);
  assert.equal(app.controls["#mini-next"].disabled, false);
  assert.equal(app.controls["#mini-play-pause"].dataset.playing, "true");
  assert.equal(app.controls["#mini-favorite"].classList.contains("is-favorited"), true);
  assert.equal(app.root.dataset.theme, "light");
  assert.equal(app.root.style["--accent-r"], "1");
});

test("long titles scroll by their measured overflow", async () => {
  const app = await setup();
  await app.controller.start();
  await settle();
  app.controls["#mini-title-viewport"].clientWidth = 100;
  app.controls["#mini-title"].scrollWidth = 180;
  app.fire("mini-player-state", { title: "一首非常长的歌曲标题", hasCurrent: true });
  assert.equal(app.controls["#mini-title"].classList.contains("is-scrolling"), true);
  assert.equal(app.controls["#mini-title-viewport"].classList.contains("has-scrolling-title"), true);
  assert.equal(app.controls["#mini-title"].style["--mini-title-distance"], "-80px");
  assert.match(app.controls["#mini-title"].style["--mini-title-duration"] as string, /^\d+(?:\.\d+)?s$/);
});

test("titles that fit do not scroll, including before the viewport has a width", async () => {
  const app = await setup();
  await app.controller.start();
  await settle();
  app.controls["#mini-title"].scrollWidth = 180;
  app.fire("mini-player-state", { title: "尚未完成布局", hasCurrent: true });
  assert.equal(app.controls["#mini-title"].classList.contains("is-scrolling"), false);

  app.controls["#mini-title-viewport"].clientWidth = 200;
  app.controls["#mini-title"].scrollWidth = 160;
  app.fire("mini-player-state", { title: "短标题", hasCurrent: true });
  assert.equal(app.controls["#mini-title"].classList.contains("is-scrolling"), false);
  assert.equal(app.controls["#mini-title-viewport"].classList.contains("has-scrolling-title"), false);
  assert.equal(app.controls["#mini-title"].style["--mini-title-distance"], undefined);
});

test("short titles are not covered by the scrolling edge mask", () => {
  const viewportRule = styles.match(/\.mini-title-viewport\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(viewportRule, /mask-image/);
  assert.match(styles, /\.mini-title-viewport\.has-scrolling-title\s*\{[^}]*mask-image/s);
});

test("controls emit commands, restore invokes the backend, and drag uses the native window", async () => {
  const app = await setup();
  await app.controller.start();
  await settle();
  for (const [selector, action] of [
    ["#mini-previous", "previous"],
    ["#mini-play-pause", "toggle_play"],
    ["#mini-next", "next"],
    ["#mini-favorite", "toggle_favorite"],
  ]) {
    app.controls[selector].dispatchEvent(new Event("click"));
  }
  await settle();
  assert.deepEqual(app.emitted.slice(1).map(({ payload }) => (payload as { action: string }).action), [
    "previous", "toggle_play", "next", "toggle_favorite",
  ]);
  app.controls["#mini-restore"].dispatchEvent(new Event("click"));
  await settle();
  assert.deepEqual(app.invoked, ["mini_player_ready", "exit_mini_player"]);

  app.controls["#mini-drag-region"].dispatchEvent(Object.assign(new Event("pointerdown"), { button: 0 }));
  await settle();
});

test("storage failures do not block the mini window handshake", async () => {
  const app = await setup({ failStorage: true });
  await app.controller.start();
  await settle();
  if (!app.windowApi.moved) throw new Error("Moved callback is missing");
  app.windowApi.moved();
  await settle();
  assert.deepEqual(app.invoked, ["mini_player_ready"]);
  assert.equal(app.emitted[0].name, "mini-player-ready");
});

test("moved payload is persisted synchronously and flushed before unload", async () => {
  const app = await setup();
  await app.controller.start();
  await settle();

  if (!app.windowApi.moved) throw new Error("Moved callback is missing");
  app.windowApi.moved({ payload: { x: 777, y: 333 } });
  const lastWrite1 = app.writes.at(-1);
  if (!lastWrite1) throw new Error("Position write is missing");
  assert.deepEqual(JSON.parse(lastWrite1[1]), { x: 777, y: 333 });

  app.window.dispatchEvent(new Event("beforeunload"));
  const lastWrite2 = app.writes.at(-1);
  if (!lastWrite2) throw new Error("Position write is missing");
  assert.deepEqual(JSON.parse(lastWrite2[1]), { x: 777, y: 333 });
});
test("position restore failures do not block the mini window handshake", async () => {
  const app = await setup({ stored: JSON.stringify({ x: 410, y: 220 }), failSetPosition: true });
  await app.controller.start();
  await settle();
  assert.deepEqual(app.invoked, ["mini_player_ready"]);
  assert.equal(app.emitted[0].name, "mini-player-ready");
});

test("mini real DOM is ready before either handshake channel and early snapshots are synchronous", async () => {
  const app = await setup({initial:{title:"握手前快照",notice:"握手前提示",hasCurrent:true,canNext:true}});
  await app.controller.start();
  assert.deepEqual(app.startupOrder,["listen:mini-player-state","emit:mini-player-ready","invoke:mini_player_ready"]);
  assert.equal(app.readyNodes.length,2);
  for(const node of app.readyNodes) assert.equal(node,app.document.getElementById("mini-title"));
  assert.equal(app.controls["#mini-title"].textContent,"握手前快照");
  assert.equal(app.controls["#mini-notice"].textContent,"握手前提示");
  assert.equal(app.controls["#mini-play-pause"].disabled,false);
  assert.equal(app.controls["#mini-drag-region"].getAttribute("aria-label"),"迷你播放器");
  assert.equal(app.controls["#mini-cover"].getAttribute("referrerpolicy"),"no-referrer");
  assert.equal(app.controls["#mini-notice"].getAttribute("aria-live"),"polite");
});

test("mini repeated snapshots retain real control identities and open notice state", async () => {
  const app=await setup(); await app.controller.start();
  const title=app.controls["#mini-title"],more=app.controls["#mini-notice-more"];
  app.fire("mini-player-state",{title:"同一标题",notice:"详细提示",hasCurrent:true});
  more.dispatchEvent(new Event("click"));
  for(let i=0;i<3;i++) app.fire("mini-player-state",{title:"同一标题",notice:"详细提示",hasCurrent:true});
  assert.equal(app.document.getElementById("mini-title"),title);
  assert.equal(app.document.getElementById("mini-notice-more"),more);
  assert.equal(app.controls["#mini-notice-full"].hidden,false);
  assert.equal(app.controls["#mini-notice-full"].textContent,"详细提示");
});

test("mini move listener failures and failed ready events still reach backend handshake", async () => {
  const app=await setup({failReadyEvent:true}); app.windowApi.onMoved=async()=>{throw Error("move unavailable");};
  await app.controller.start();
  assert.deepEqual(app.invoked,["mini_player_ready"]);
  assert.ok(app.warnings.some(args=>args[0]==="mini player move listener failed:"));
  assert.ok(app.warnings.some(args=>args[0]==="mini player ready event failed:"));
  app.window.dispatchEvent(new Event("beforeunload"));
  assert.equal(app.listeners.size,0);
});

test("mini root renders synchronously once mounted and keeps controls inert before binding", async () => {
  const app=await setup();
  assert.equal(app.window.document.querySelectorAll("main.mini-shell").length,1);
  app.controls["#mini-restore"].dispatchEvent(new Event("click"));
  assert.deepEqual(app.invoked,[]);
  await app.controller.start();
  for(const title of ["同步一","同步二"]) {
    app.fire("mini-player-state",{title,hasCurrent:true,isPlaying:true});
    assert.equal(app.controls["#mini-title"].textContent,title);
    assert.equal(app.controls["#mini-play-pause"].getAttribute("aria-label"),"暂停");
  }
});

import fs from "node:fs";
import { controlsSettingsFixture } from "./controls-settings-fixture.ts";

test("all three image sliders update stored values and their document CSS variables", async t => {
  const h = await controlsSettingsFixture(); t.after(h.dispose);
  await h.fire(h.doc.querySelector('[data-theme-option="image"]')!, "click");
  for (const [name, values, unit] of [["glass-blur", [0, 80], "px"], ["panel-alpha", [20, 100], ""], ["background-dim", [40, 95], ""]] as const) {
    for (const value of values) {
      await h.input(name + "-slider", String(value));
      assert.equal(h.window.localStorage.getItem("bilibili-music." + name), String(value));
      assert.equal(h.doc.documentElement.style.getPropertyValue("--" + name), unit ? value + unit : String(value / 100));
    }
  }
  const css = fs.readFileSync(new URL("../../ui/styles.css", import.meta.url), "utf8");
  assert.match(css, /:root\[data-theme="image"\] body::before \{ filter: blur\(var\(--glass-blur\)\)/);
  assert.match(css, /:is\(#sidebar, #result\) \{ background: rgba\(24, 25, 28, var\(--panel-alpha\)\)/);
});

test("mini receives image and palette variables synchronously and ignores late image loads", async t => {
  const dom = new JSDOM(fs.readFileSync(new URL("../../ui/mini.html", import.meta.url), "utf8"), { url: "http://localhost/mini.html" });
  const runtime = await loadMiniFactory(dom.window.document);
  t.after(() => { runtime.restore(); dom.window.close(); });
  type Image = { dataUrl: string };
  const pending = new Map<string, (image: Image) => void>();
  const controller = runtime.create({
    document: dom.window.document, window: dom.window, storage: { getItem: () => null, setItem() {} }, console: { warn() {} },
    eventApi: { listen: async () => () => {}, emit: async () => {} },
    invoke: (command: string, args: { path?: string } = {}) => command === "load_background_image" ? new Promise<Image>(resolve => pending.set(args.path!, resolve)) : Promise.resolve(null),
    windowApi: { onMoved: async () => () => {}, outerSize: async () => ({ width: 280, height: 90 }), outerPosition: async () => ({ x: 0, y: 0 }) },
    availableMonitors: async () => [], dpi: {},
  });
  await controller.start();
  const shell = () => dom.window.document.querySelector<HTMLElement>(".mini-shell")!;
  controller.render({ theme: "image", backgroundPath: "first.png", backgroundDim: 40 });
  assert.equal(dom.window.document.documentElement.dataset.theme, "image");
  assert.equal(shell().style.getPropertyValue("--background-dim"), "0.4");
  controller.render({ theme: "image", backgroundPath: "second.png", backgroundDim: 90 });
  pending.get("second.png")!({ dataUrl: "data:image/png;base64,second" }); await Promise.resolve();
  assert.ok(shell().style.getPropertyValue("--mini-background").includes("second"));
  pending.get("first.png")!({ dataUrl: "data:image/png;base64,first" }); await Promise.resolve();
  assert.ok(shell().style.getPropertyValue("--mini-background").includes("second"));
  controller.render({ theme: "image", backgroundPath: "second.png", backgroundVersion: 2, backgroundDim: 90 });
  assert.equal(shell().style.getPropertyValue("--mini-background"), "");
  const colors = ["rgb(20, 40, 60)", "rgb(50, 25, 35)", "rgb(35, 55, 25)"];
  controller.render({ theme: "dynamic", dynamicColors: colors });
  pending.get("second.png")!({ dataUrl: "data:image/png;base64,replacement" }); await Promise.resolve();
  assert.equal(dom.window.document.documentElement.dataset.theme, "dynamic");
  colors.forEach((color, index) => assert.equal(shell().style.getPropertyValue("--dynamic-color-" + (index + 1)), color));
  assert.equal(shell().style.getPropertyValue("--mini-background"), "");
});
