import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./tracks-fixture.ts";

test("native writes baseline: appearance and purge status preserve last actual writer", async t => {
  const h = await fixture({ playback:true }); t.after(h.dispose);
  const status = h.doc.getElementById("appearance-status")!;
  h.store.actions.settings.setNotice("外观一"); assert.equal(status.textContent,"外观一");
  h.reply(async command => { if(command === "list_unavailable_tracks") throw "合成失败一"; return null; });
  await h.store.actions.library.showPurge(); assert.equal(status.textContent,"读取失效曲目失败：合成失败一");
  h.store.actions.settings.setNotice("外观二"); assert.equal(status.textContent,"外观二");
  h.reply(async command => { if(command === "list_unavailable_tracks") throw "合成失败二"; return null; });
  await h.store.actions.library.showPurge(); assert.equal(status.textContent,"读取失效曲目失败：合成失败二");
  h.store.actions.settings.setSlider("blur",13,false);
  assert.equal(status.textContent,"读取失效曲目失败：合成失败二");
  h.store.actions.settings.setNotice(""); assert.equal(status.textContent,"");
});


test("native writes baseline: unchanged appearance text does not overwrite a later purge write", async t => {
  const h=await fixture({playback:true});t.after(h.dispose);
  const status=h.doc.getElementById("appearance-status")!;
  h.store.actions.settings.setNotice("外观");
  h.reply(async command=>{if(command === "list_unavailable_tracks")throw "合成失败";return null;});
  await h.store.actions.library.showPurge();
  assert.equal(status.textContent,"读取失效曲目失败：合成失败");
  h.store.actions.settings.setNotice("外观");
  assert.equal(status.textContent,"读取失效曲目失败：合成失败");
});

test("dynamic background component paints both layers and preserves pause without rebuilding nodes", async t => {
  const h=await fixture({playback:true,nativeWrites:true});t.after(h.dispose);
  Object.defineProperty(h.doc,"hidden",{configurable:true,value:false});
  const backdrop=h.doc.querySelector(".dynamic-background")!,layers=[...backdrop.children];
  h.doc.documentElement.dataset.theme="dynamic";await h.microtasks();
  assert.equal(backdrop.classList.contains("is-paused"),false);
  assert.equal(layers.filter(layer=>layer.classList.contains("is-visible")).length,1);
  const visible=layers.find(layer=>layer.classList.contains("is-visible")) as HTMLElement;
  assert.equal(visible.style.getPropertyValue("--dynamic-color-1"),"rgb(28, 32, 40)");
  h.doc.documentElement.dataset.theme="dark";await h.microtasks();
  assert.equal(backdrop.classList.contains("is-paused"),true);
  assert.deepEqual([...backdrop.children],layers);
});
