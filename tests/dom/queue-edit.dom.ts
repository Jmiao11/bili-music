import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, fixture, responses, seed, track } from "./tracks-fixture.ts";
import { fixture as libraryFixture } from "./library-lists-fixture.ts";
import { collection, collectionEntry, collectionPage, videoEntry } from "../helpers/collections.ts";
import { libraryQueueEntries } from "../../ui/features/playback/playback-queue-state.ts";

const selector = 'button[aria-label="下一首播放"]';
test("普通行加入下一首、空队列起播、插入位置和抽屉同步", async t => {
  const h = await fixture({playback: true, queueCounters: true});
  t.after(h.dispose);
  const items = Array.from({length: 20}, (_, i) => track(i + 1));
  const home = await seed(h, "ranking", items);
  assert.equal(home.querySelectorAll(selector).length, 20);
  const list = await seed(h, "search", items);
  const button = (i: number) => list.children[i].querySelector<HTMLButtonElement>(selector)!;
  const click = (i: number) => h.fire(button(i), "click", { detail: 1 });
  const state = h.store.getState;
  const base = responses(items);
  h.reply(async cmd => cmd === "get_video_pages" ? [] : base(cmd));
  await click(0); await h.microtasks();
  assert.deepEqual(state().playbackQueue.queue.map(t => t.bvid), [items[0].bvid]);
  assert.equal(state().playbackMessages.notice.visible, false);
  h.store.actions.playbackQueue.replaceQueue([items[3]]);
  await click(2); await h.microtasks();
  assert.deepEqual(state().playbackQueue.queue.map(t => t.bvid), [items[2].bvid,items[3].bvid]);
  assert.equal(state().playbackQueue.currentIndex, 0);
  assert.equal(state().playbackMessages.notice.visible, false);
  h.core.playSearchResult(0); await h.microtasks();
  assert.equal(list.querySelectorAll('[aria-current="true"]').length, 1);
  const audio = h.doc.querySelector("audio")!, src = audio.src;
  h.store.actions.playbackSession.setPendingResume({positionSeconds: 7, page: 1, cid: 11});
  const pending = state().playbackSession.pendingResume;
  await h.fire(h.doc.querySelector("#queue-position")!, "click"); h.raf();
  const requests = h.calls.filter(c => c.command === "prepare_audio").length;
  await click(4); await click(5); await h.fire(button(5), "dblclick", { detail: 2 });
  assert.deepEqual(state().playbackQueue.queue.slice(0,3).map(t => t.bvid), [items[0],items[5],items[4]].map(t => t.bvid));
  assert.equal(h.calls.filter(c => c.command === "prepare_audio").length, requests);
  assert.equal(state().playbackSession.pendingResume, pending);
  assert.equal(audio.src, src);
  assert.equal(state().playbackMessages.notice.text, "已加入下一首播放");
  assert.equal(list.querySelectorAll('[aria-current="true"]').length, 0);
  assert.equal(h.doc.querySelectorAll("[data-queue-index]").length, 22);
  h.reply(responses([track(21)])); await h.search.loadMoreSearchResults();
  assert.equal(list.children.length, 21); assert.equal(state().playbackQueue.queue.length, 22);
  h.renderCounts.QueueDrawer = h.renderCounts.QueueDrawerRow = 0;
  for (let i=0; i<100; i++) h.store.actions.playbackDisplay.observeProgress({currentTime:i,duration:120,paused:false,ended:false,playbackRate:1});
  assert.equal(h.renderCounts.QueueDrawer, 0); assert.equal(h.renderCounts.QueueDrawerRow, 0);
  h.notice.showPlaybackNotice("播放错误", {persistent:true});
  await click(5);
  assert.equal(state().playbackMessages.notice.text, "播放错误");
  assert.equal(state().playbackQueue.queue.length, 22);
});

test("资料库、最近播放与合集详情按父项类型提供入口", async t => {
  const h = await libraryFixture({playback:true}); t.after(h.dispose);
  const data = collection(2), entries = [videoEntry(track(1)), collectionEntry(data)];
  h.reply(async cmd => cmd === "list_unavailable_tracks" ? [{bvid:track(1).bvid,reason:"失效"}] : cmd === "list_favorites" ? entries : cmd === "list_playlists" ? [{id:"a",name:"歌单",createdAt:"1",items:entries}]
    : cmd === "get_play_history" ? [{...track(1),lastPlayedAt:"1",count:1}]
    : cmd === "get_collection_page" ? collectionPage(data) : cmd === "check_audio_cache" ? [false] : []);
  await h.library.loadLibrary();
  for (const list of [h.nodes.favoritesList,h.nodes.playlistTracks]) {
    assert.equal(list.children[0].querySelector<HTMLButtonElement>(selector)?.disabled, true);
    assert.equal(list.children[1].querySelector(selector), null);
  }
  h.store.actions.settings.navigate("recent"); await h.microtasks();
  assert.ok(h.doc.querySelector("#recent-list " + selector));
  h.store.actions.collection.open({kind:"collection",bvid:data.anchorBvid,id:data.collectionId},data.title,2,"home",0,data);
  await h.microtasks(); assert.equal(h.doc.querySelectorAll("#collection-results " + selector).length, 2);
});

test("随机父项栈、上一首与自动单曲循环沿用现有推进", async t => {
  const h = await fixture({playback:true}); t.after(h.dispose);
  h.reply(async cmd => cmd === "get_video_pages" ? [] : responses()(cmd));
  h.core.playListItem("ranking",[track(1),track(2)],0); await h.microtasks();
  const q = h.store.actions.playbackQueue;
  q.changeShuffle(true, () => 0);
  h.core.queueVideoNext(track(3));
  q.cycleLoop([{id:"sequence"},{id:"single"}]);
  h.core.playNext({automatic:true}); await h.microtasks();
  assert.equal(h.core.getQueueSnapshot().currentIndex,0);
  h.core.playNext(); await h.microtasks(); assert.equal(h.core.getQueueSnapshot().currentIndex,1);
  const remaining=h.core.getQueueSnapshot().randomRemaining;
  h.core.playPrevious(); await h.microtasks();
  assert.equal(h.core.getQueueSnapshot().currentIndex,0);
  assert.deepEqual(h.core.getQueueSnapshot().randomRemaining,remaining);
});

for (const wait of ["get_collection_page","get_video_pages","prepare_audio"]) test("在途插入保持原回填目标 " + wait, async t => {
  const h = await fixture({playback:true}); t.after(h.dispose);
  const data=collection(2), gate=deferred(), group=wait==="get_collection_page";
  const base=responses();
  const metadata={audioUrl:"http://127.0.0.1/audio/fixture",title:"新标题",uploader:"作者",thumbnailUrl:"",durationSeconds:60};
  h.reply(async cmd => cmd===wait ? gate.promise : cmd==="get_video_pages" ? [] : cmd==="prepare_audio" ? metadata : base(cmd));
  h.core.playListItem("favorites",group ? libraryQueueEntries([collectionEntry(data)]) : [track(1)],0);
  await h.microtasks();
  assert.ok(h.calls.some(c=>c.command===wait));
  h.core.queueVideoNext(track(8));
  if (group) assert.equal(h.store.getState().playbackMessages.notice.text,"已加入，将在当前合集播完后播放");
  gate.resolve(group ? collectionPage(data) : wait==="get_video_pages" ? [] : metadata);
  await h.microtasks();
  const q=h.core.getQueueSnapshot();
  assert.equal(q.currentIndex,0); assert.equal(q.queue[1].title,track(8).title);
  assert.equal(q.queue[0].bvid,track(1).bvid);
  const owner = group ? q.queue[0].collection?.data.snapshot.items[0] : q.queue[0];
  assert.equal(owner?.title,metadata.title);
  if (group) {
    h.core.playNext(); await h.microtasks();
    assert.equal(h.core.getQueueSnapshot().queue[0].collection?.memberIndex,1);
  }
});

test("多分P提示持续两秒，继续播放当前视频下一P", async t => {
  const h=await fixture({playback:true}); t.after(h.dispose);
  h.reply(responses()); h.core.playListItem("ranking",[track(1)],0); await h.microtasks();
  h.core.queueVideoNext(track(2));
  assert.equal(h.store.getState().playbackMessages.notice.text,"已加入，将在当前视频播完后播放");
  await h.advance(1999); assert.equal(h.store.getState().playbackMessages.notice.visible,true);
  await h.advance(1); assert.equal(h.store.getState().playbackMessages.notice.visible,false);
  assert.equal(h.core.advancePageWithinCurrentBv({automatic:true}),true);
  assert.equal(h.core.getQueueSnapshot().currentPageIndex,1);
  assert.equal(h.core.getQueueSnapshot().currentIndex,0);
});

for (const wait of ["get_collection_page","get_video_pages","get_cached_video_pages","prepare_audio"]) test("移出前项时在途元数据只回填当前出现 " + wait, async t => {
  const h=await fixture({playback:true});t.after(h.dispose);
  const data=collection(2), gate=deferred(), group=wait==="get_collection_page", a=track(1), sibling={...a,title:"同 BV 后继"};
  const metadata={audioUrl:"http://127.0.0.1/audio/q4c",title:"当前出现的元数据",uploader:"作者",thumbnailUrl:"",durationSeconds:60};
  h.reply(async cmd=>{if(cmd===wait)return gate.promise;if(cmd==="get_video_pages"){if(wait==="get_cached_video_pages")throw Error("offline");return [];}return cmd==="prepare_audio"?metadata:responses()(cmd);});
  h.core.playListItem("favorites",[a,group?libraryQueueEntries([collectionEntry(data)])[0]:a,sibling],1);await h.microtasks();
  assert.ok(h.calls.some(c=>c.command===wait));h.core.removeQueueEntry(0);
  gate.resolve(group?collectionPage(data):wait==="prepare_audio"?metadata:wait==="get_cached_video_pages"?{[a.bvid]:{pages:[{cid:11,page:1,part:"片段",duration:60}]}}:[]);await h.microtasks();
  const state=h.core.getQueueSnapshot();assert.equal(state.currentIndex,0);assert.equal(state.queue[1].title,sibling.title);
  assert.equal((group?state.queue[0].collection?.data.snapshot.items[0]:state.queue[0])?.title,metadata.title);
});

test("千项抽屉的出现身份与同列表重选",async t=>{
  const h=await fixture({playback:true,queueCounters:true,queueLifecycle:true});t.after(h.dispose);
  const items=Array.from({length:1000},(_,i)=>track(i+1)),q=h.store.actions.playbackQueue;
  const counts=()=>[h.renderCounts.mount,h.renderCounts.unmount];
  const installed=h.listeners.length;q.replaceQueue(items);assert.equal(h.listeners.length,installed);assert.equal(h.renderCounts.QueueDrawerRow,0);
  await h.fire(h.doc.querySelector("#queue-position")!,"click");h.raf();assert.equal(h.doc.querySelector(".queue-remove"),null);assert.deepEqual(counts(),[1000,0]);
  q.selectIndex(0,false,null);assert.equal(h.doc.querySelector('.is-current .queue-remove'),null);
  h.core.queueVideoNext(track(1002));assert.deepEqual(counts(),[1001,0]);h.core.removeQueueEntry(1);assert.deepEqual(counts(),[1001,1]);
  h.renderCounts.QueueDrawerRow=0;
  const withoutCurrent: number[]=[];
  const off=h.store.subscribe(state=>{
    if(state.playbackQueue.currentIndex<0)withoutCurrent.push(h.doc.querySelectorAll(".queue-remove").length);
  });
  h.reply(async cmd=>cmd==="get_video_pages"?[]:responses()(cmd));h.core.playListItem("direct",items,1);
  off();assert.ok(withoutCurrent.length>0);assert.ok(withoutCurrent.every(n=>n===0));
  assert.equal(h.renderCounts.QueueDrawerRow,2);assert.equal(h.doc.querySelectorAll(".queue-remove").length,999);
  await h.microtasks();assert.deepEqual(counts(),[1001,1]);
  q.replaceQueue([track(1100)]);assert.deepEqual(counts(),[1002,1001]);
});

test("合集手动收起跨回填与成员推进保持，编辑邻项保留展开",async t=>{
  const h=await fixture({playback:true,queueCounters:true,queueLifecycle:true});t.after(h.dispose);const q=h.store.actions.playbackQueue;
  q.replaceQueue([...libraryQueueEntries([collectionEntry(collection(3))]),track(7)]);q.selectIndex(0,false,null,false);
  await h.fire(h.doc.querySelector("#queue-position")!,"click");h.raf();const expand=h.doc.querySelector<HTMLButtonElement>(".queue-expand")!;
  await h.fire(expand,"click");q.fillTrackMetadata(0,{...track(1),title:"新成员标题"});q.advanceCollection([],new Map(),()=>0,{order:"sequence",limit:10},null,false);
  assert.equal(q.activeTrack()?.bvid,track(2).bvid);assert.equal(expand.getAttribute("aria-expanded"),"false");assert.deepEqual([h.renderCounts.mount,h.renderCounts.unmount],[2,0]);
  await h.fire(expand,"click");q.selectIndex(1,false,null);h.core.queueVideoNext(track(8));h.core.removeQueueEntry(2);
  assert.equal(h.doc.querySelector(".queue-expand"),expand);assert.equal(expand.getAttribute("aria-expanded"),"true");
});

test("移出焦点后继、前驱和关闭回退；外部焦点、播放与恢复不动",async t=>{
  const h=await fixture({playback:true,queueCounters:true});t.after(h.dispose);const q=h.store.actions.playbackQueue;
  const group=libraryQueueEntries([collectionEntry(collection(2))])[0];h.reply(responses());
  h.core.playListItem("favorites",[track(4),group,track(3),track(7),track(8)],2);await h.microtasks();await h.fire(h.doc.querySelector("#queue-position")!,"click");h.raf();
  const row=(i:number)=>h.doc.querySelector(`[data-queue-index="${i}"]`)!.parentElement!,remove=(i:number)=>row(i).querySelector<HTMLButtonElement>(".queue-remove")!;
  const audio=h.doc.querySelector("audio")!.src;h.store.actions.playbackSession.setPendingResume({cid:11,page:1,positionSeconds:7});const pending=h.core.getSessionSnapshot().pendingResume, page=h.core.getQueueSnapshot().currentPageIndex;
  const scrolls=()=>h.platform.filter(e=>e.operation==="scrollIntoView").length,baseline=scrolls();
  remove(0).focus();await h.fire(remove(0),"click");assert.equal(h.doc.activeElement,remove(0));
  const saved=h.calls.filter(c=>c.command==="save_playback_state").length;await h.fire(remove(0),"click");assert.equal(h.doc.activeElement,row(0).querySelector(".queue-track"));
  const saves=h.calls.filter(c=>c.command==="save_playback_state");assert.equal(saves.length,saved+1);assert.equal((saves.at(-1)!.args.state as {version:number}).version,1);
  assert.equal(scrolls(),baseline);assert.equal(h.doc.querySelector("audio")!.src,audio);assert.equal(h.core.getQueueSnapshot().currentPageIndex,page);assert.equal(h.core.getSessionSnapshot().pendingResume,pending);
  remove(2).focus();await h.fire(remove(2),"click");assert.equal(h.doc.activeElement,remove(1));
  const close=h.doc.querySelector<HTMLButtonElement>("#queue-drawer header button")!;close.focus();await h.fire(remove(1),"click");assert.equal(h.doc.activeElement,close);
  q.insertNextVideo(track(9));remove(1).focus();const off=h.store.subscribe(s=>{if(s.playbackQueue.queue.length===1)q.replaceQueue([]);});await h.fire(remove(1),"click");off();assert.equal(h.doc.activeElement,close);
});

test("同一请求冻结合集后回填成员；多分P只更新当前分P显示，不覆盖父标题",async t=>{
  const h=await fixture({playback:true});t.after(h.dispose);const data=collection(2),meta={audioUrl:"http://127.0.0.1/audio/q4c",title:"解析标题",uploader:"解析作者",thumbnailUrl:"",durationSeconds:60};
  const pages=[{cid:11,page:1,part:"第一部分",durationSeconds:21},{cid:22,page:2,part:"第二部分",durationSeconds:39}];
  const base=responses();let multi=false;
  h.reply(async cmd=>cmd==="get_collection_page"?collectionPage(data):cmd==="get_video_pages"?(multi?pages:[]):cmd==="prepare_audio"?meta:base(cmd));
  h.core.playListItem("favorites",libraryQueueEntries([collectionEntry(data)]),0);await h.microtasks();
  const group=h.core.getQueueSnapshot().queue[0].collection!;
  assert.equal(group.data.snapshot.items[group.memberIndex].title,meta.title);
  assert.equal(group.data.snapshot.items[1].title,data.snapshot.items[1].title);
  multi=true;h.core.playListItem("direct",[track(7)],0);await h.microtasks();
  const state=h.core.getQueueSnapshot();
  assert.equal(state.queue[0].title,track(7).title);assert.equal(state.currentDisplayTrack?.title,pages[0].part);
  assert.equal(state.currentDisplayTrack?.uploader,meta.uploader);assert.equal(state.currentDisplayTrack?.durationSeconds,pages[0].durationSeconds);
});
