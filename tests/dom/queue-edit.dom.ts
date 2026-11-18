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
