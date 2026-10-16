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

test("native writes baseline: mascot SVG fallback hide persistence bubbles and playback stages", async t => {
  const h = await fixture({ playback:true,nativeWrites:true }); t.after(h.dispose);
  const api=h.mascot.getMascotApi()!, stage=h.doc.getElementById("mascot-stage")!, slot=h.doc.getElementById("mascot-slot")!, bubble=h.doc.getElementById("mascot-bubble")!;
  assert.equal(api.getActive(),"kuro"); assert.ok(slot.querySelector("svg")); assert.equal(bubble.hidden,false);
  for(const id of ["nuomi","juzi","kuro"]) {
    assert.equal(api.setActive(id),id); assert.equal(stage.dataset.mascotId,id);
    assert.equal(h.window.localStorage.getItem("bili-music-mascot"),id); assert.equal(bubble.textContent,""); assert.equal(bubble.hidden,true);
  }
  assert.equal(api.setActive("unknown"),"kuro");
  await h.fire(stage,"click"); assert.equal(stage.classList.contains("is-poked"),true); assert.equal(bubble.hidden,false); assert.ok(bubble.textContent);
  await h.advance(4000); assert.equal(bubble.hidden,true); assert.equal(bubble.textContent,"");
  api.setActive("none"); assert.equal(slot.innerHTML,""); assert.equal(stage.classList.contains("is-hidden"),true);
  api.setActive("juzi"); assert.equal(stage.classList.contains("is-hidden"),false);
  await h.fire(h.doc.getElementById("audio")!,"play"); assert.equal(stage.dataset.state,"playing"); assert.equal(stage.classList.contains("is-playing"),true);
  await h.fire(stage,"mouseenter"); assert.equal(stage.classList.contains("is-hovered"),true);
  await h.fire(stage,"mouseleave"); assert.equal(stage.classList.contains("is-hovered"),false);
  h.doc.documentElement.dataset.sidebarCollapsed="true";
  assert.equal(stage.dataset.mascotId,"juzi"); assert.equal(h.doc.getElementById("mascot-stage"),stage);
});
