import assert from "node:assert/strict";
import { test } from "node:test";
import { controlsSettingsFixture, settingsReply } from "./controls-settings-fixture.ts";

type ProbeVNode = { props?: unknown; children?: unknown; component?: { props?: unknown; subTree?: ProbeVNode } | null };
function componentProps(root: HTMLElement): unknown[] {
  const values: unknown[] = [], seen = new Set<ProbeVNode>();
  const visit = (node?: ProbeVNode) => {
    if (!node || seen.has(node)) return; seen.add(node);
    values.push(node.props, node.component?.props); visit(node.component?.subTree);
    if (Array.isArray(node.children)) for (const child of node.children) if (typeof child === "object" && child) visit(child as ProbeVNode);
  };
  visit((root as HTMLElement & { _vnode?: ProbeVNode })._vnode); return values;
}
function serialize(value: unknown): string {
  return JSON.stringify(value, (_name, item: unknown) => item instanceof Map ? [...item] : item instanceof Set ? [...item] : item instanceof Error ? item.message : item) ?? "";
}

for (const mode of ["save", "test"] as const) test(`settings ${mode} keeps a temporary key out of snapshots props diagnostics errors mini and startup IPC`, async t => {
  const h = await controlsSettingsFixture({privacy:true});
  const savedConsole = { log:console.log, info:console.info, warn:console.warn, error:console.error, debug:console.debug };
  const consoleOutput: unknown[] = [], snapshots: string[] = [], props: string[] = [];
  t.after(() => { h.dispose(); Object.assign(console, savedConsole); });
  for (const key of ["log","info","warn","error","debug"] as const) console[key] = (...args: unknown[]) => { consoleOutput.push(args); };
  const unsubscribe = h.store.subscribe(snapshot => { snapshots.push(serialize(snapshot)); props.push(serialize(componentProps(h.node("app")))); }); t.after(unsubscribe);
  await h.fire(h.doc,"DOMContentLoaded");
  assert.equal(h.window.onerror,null);
  await h.open();
  h.ipcListeners.get("mini-player-ready")?.({}); await h.microtasks();
  const secret = "F4-test-only-key-priv-7a8b9c";
  h.node<HTMLInputElement>("ai-api-key-input").value = secret;
  h.reply(async (command,args) => command === "test_ai_connection" ? {ok:true,message:"ok"} : settingsReply(command,args));
  await h.fire(h.node(mode === "save" ? "save-ai-config-button" : "test-ai-connection-button"),"click");
  const calls = h.calls.filter(call => call.command === "test_ai_connection" || call.command === "set_ai_config");
  assert.equal(calls.filter(call => call.command === "set_ai_config").length,mode === "save" ? 1 : 0);
  assert.ok(calls.every(call => call.args.apiKey === secret));
  assert.equal(h.node<HTMLInputElement>("ai-api-key-input").value,mode === "save" ? "" : secret);
  h.node<HTMLInputElement>("ai-api-key-input").value = secret;
  h.reply(async command => { if(command === "test_ai_connection") throw Error("rejected " + secret); return settingsReply(command); });
  await h.fire(h.node("test-ai-connection-button"),"click");
  const errorText=h.node("ai-config-status").textContent;
  assert.ok(errorText?.includes("[已隐藏]"));
  h.window.dispatchEvent(new h.window.Event("bilibili-music-notice-change")); await h.microtasks();
  assert.ok(snapshots.length > 0 && props.length > 0 && h.emissions.length > 0);
  for(const [name,value] of Object.entries({snapshots,props,consoleOutput,errorText,mini:h.emissions,startup:h.calls.filter(call=>call.command === "main_window_ready")})) assert.equal(serialize(value).includes(secret),false,name);
  assert.equal(h.window.onerror,null);
});

test("settings input and repeated slider commits skip every list and playback component", async t => {
  const h=await controlsSettingsFixture({displayCounters:true}); t.after(h.dispose);
  h.home.setHomeMode("ranking"); await h.microtasks();
  for(const name of ["PlaybackBar","PlaybackNotice","ImmersivePlayer","LyricsDisplay","SettingsPanel","TrackList","TrackRow"]) assert.ok(h.renderCounts[name]>0,name);
  for(const name of Object.keys(h.renderCounts)) h.renderCounts[name]=0;
  await h.input("search-keyword","中文草稿"); await h.input("home-hint-input","提示草稿"); await h.input("ai-api-key-input","temporary-draft");
  for(let index=0;index<20;index++) for(const [id,value] of [["glass-blur-slider",String(index)],["panel-alpha-slider",String(40+index)],["background-dim-slider",String(50+index)]]) await h.input(id,value);
  for(const name of ["TrackList","TrackRow","PlaylistList","PlaybackBar","PlaybackNotice","ImmersivePlayer","LyricsDisplay"]) assert.equal(h.renderCounts[name],0,name);
  assert.ok(h.renderCounts.SettingsPanel>0);
  assert.equal(h.node<HTMLInputElement>("search-keyword").value,"中文草稿"); assert.equal(h.node<HTMLInputElement>("ai-api-key-input").value,"temporary-draft");
});

test("settings field versions preserve drafts and force requested writes before actions return", async t => {
  const h=await controlsSettingsFixture(); t.after(h.dispose); await h.open();
  const source=h.node<HTMLSelectElement>("stream-source-select"); source.value="auto";
  h.store.actions.settings.setNotice("只更新提示"); assert.equal(source.value,"auto");
  await h.store.actions.settings.restoreSource(); assert.equal(source.value,"guest");
  const order=h.node<HTMLSelectElement>("shuffle-collection-order"); order.value="sequential";
  h.store.actions.settings.restoreCollection("random","all"); assert.equal(order.value,"random");
  const normalization=h.node<HTMLInputElement>("loudness-normalization-toggle"); normalization.checked=true;
  h.store.actions.playbackSettings.setNormalizationEnabled(false); assert.equal(normalization.checked,false);
});

for (const outcome of ["success", "failure"] as const) test(`shortcut buttons are inert before loading and preserve ${outcome} completion behavior`, async t => {
  let resolve!: (value: unknown) => void, reject!: (reason: Error) => void;
  const pending = new Promise<unknown>((yes,no) => { resolve=yes; reject=no; });
  const h=await controlsSettingsFixture({shortcutReply:pending}); t.after(h.dispose);
  const buttons=[...h.doc.querySelectorAll<HTMLButtonElement>("[data-shortcut-action], [data-shortcut-clear]")];
  assert.equal(buttons.length,10);
  const before=h.store.getState().settings, storage=JSON.stringify(h.window.localStorage);
  const calls=h.calls.length;
  for(const button of buttons) await h.fire(button,"click");
  assert.equal(h.store.getState().settings,before);
  assert.equal(h.store.getState().settings.recordingShortcutAction,null);
  assert.equal(h.calls.length,calls);
  assert.equal(JSON.stringify(h.window.localStorage),storage);
  if(outcome === "success") resolve({version:1,bindings:{previous:"Ctrl+Left"}}); else reject(Error("shortcut load test failure"));
  await h.microtasks();
  assert.equal(h.store.getState().settings.shortcutBindings.previous,outcome === "success" ? "Ctrl+Left" : null);
  if(outcome === "failure") assert.ok(h.warnings.some(args=>String(args[0]).includes("cannot load settings")));
  h.reply(async(command,args)=> command === "set_shortcuts" ? null : settingsReply(command,args));
  for(const action of ["previous","playPause","next","volumeUp","volumeDown"] as const) {
    await h.fire(h.doc.querySelector(`[data-shortcut-action="${action}"]`)!,"click");
    assert.equal(h.store.getState().settings.recordingShortcutAction,action);
    await h.fire(h.doc.querySelector(`[data-shortcut-clear="${action}"]`)!,"click");
    assert.equal(h.store.getState().settings.recordingShortcutAction,null);
    assert.equal(h.store.getState().settings.shortcutBindings[action],null);
  }
  assert.equal(h.calls.filter(call=>call.command === "set_shortcuts").length,5);
});

test("normalization reports the first handler failure and still runs its second handler", async t => {
  const h=await controlsSettingsFixture({normalizationFailure:true}); t.after(h.dispose);
  const errors: unknown[]=[];
  const saved=console.error; console.error=(...args:unknown[])=>{errors.push(args);}; t.after(()=>{console.error=saved;});
  h.window.addEventListener("error",event=>{errors.push(event.error);event.preventDefault();});
  const checkbox=h.node<HTMLInputElement>("loudness-normalization-toggle"); checkbox.checked=true;
  await h.fire(checkbox,"change");
  assert.equal(h.node("library-modal").hidden,false);
  assert.equal(h.node("library-modal-title").textContent,"响度归一化");
  assert.ok(errors.some(error=>String(error).includes("normalization test failure")));
});
