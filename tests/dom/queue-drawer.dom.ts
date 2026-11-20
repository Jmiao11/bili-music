import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, responses, track, deferred } from "./tracks-fixture.ts";
import { nextDomEventTurn } from "./event-turn.ts";
import { libraryQueueEntries } from "../../ui/features/playback/playback-queue-state.ts";
import { collection, collectionEntry } from "../helpers/collections.ts";

async function setup() {
  const h = await fixture({ playback: true, queueCounters: true, rootRenderProbe: {depth:0,maxDepth:0,calls:0} });
  const node = <T extends HTMLElement = HTMLElement>(id:string) => h.doc.getElementById(id) as T;
  const click = async (element:Element) => { await nextDomEventTurn(); element.dispatchEvent(new h.window.MouseEvent("click",{bubbles:true})); };
  const open = async () => { await click(node("queue-position")); h.raf(); await nextDomEventTurn(); };
  return {...h,node,click,open};
}

test("queue drawer phases focus three close paths modal Esc and listener pairing", async t => {
  const h=await setup();t.after(h.dispose);
  const button=h.node<HTMLButtonElement>("queue-position"),drawer=h.node("queue-drawer");
  assert.equal(button.disabled,true);assert.equal(drawer.hidden,true);
  h.store.actions.playbackQueue.replaceQueue([track(1),track(2)]);h.store.actions.playbackQueue.selectIndex(0,false,null);
  assert.equal(button.disabled,false);
  const adds=h.listeners.length,removes=h.platform.length;
  await h.click(button);assert.equal(drawer.hidden,false);assert.equal(drawer.classList.contains("is-open"),false);assert.equal(drawer.getAttribute("aria-hidden"),"true");
  h.raf();assert.equal(button.getAttribute("aria-expanded"),"true");assert.equal(h.doc.activeElement,h.node("queue-drawer").querySelector("header button"));
  assert.ok(h.platform.some(e=>e.operation==='scrollIntoView' && (e.detail as ScrollIntoViewOptions).block==='center'));
  for(const method of ['entry','close','escape']) {
    if(method!=='entry') await h.open();
    if(method==='entry') await h.click(button);
    else if(method==='close') await h.click(drawer.querySelector('header button')!);
    else {
      h.stages!.setModalStage('settings',{hidden:false,open:true});
      h.doc.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(button.getAttribute('aria-expanded'),'true');
      h.stages!.setModalStage('settings',{hidden:true,open:false});
      h.doc.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    }
    assert.equal(drawer.getAttribute('aria-hidden'),'true');assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(h.doc.activeElement,button);
    const end=new h.window.Event('transitionend',{bubbles:true});Object.defineProperty(end,'propertyName',{value:'transform'});drawer.dispatchEvent(end);assert.equal(drawer.hidden,true);
  }
  const added=h.listeners.slice(adds).filter(e=>e.target===h.doc&&e.type==='keydown'&&e.options===true);
  const removed=h.platform.slice(removes).filter(e=>e.operation==='removeEventListener'&&e.target===h.doc&&(e.detail as {type:string}).type==='keydown');
  assert.equal(added.length,3);assert.equal(removed.length,3);
  assert.deepEqual(removed.map(e=>(e.detail as {callback:unknown}).callback),added.map(e=>e.callback));
});

test("queue drawer reserves layout at the start of opening and restores it at the start of closing", async t => {
  const h = await setup(); t.after(h.dispose);
  const button = h.node<HTMLButtonElement>("queue-position"), drawer = h.node("queue-drawer");
  const main = h.doc.querySelector(".main-panel")!;
  const key = "bilibili-music.track-columns";
  const preferences = JSON.stringify({ title: 420, uploader: 180, pages: 72, plays: 80, duration: 72 });
  h.window.localStorage.setItem(key, preferences);
  h.store.actions.playbackQueue.replaceQueue([track(1), track(2)]);
  const reserved = () => main.classList.contains("queue-drawer-reserved");
  assert.equal(reserved(), false);
  await h.click(button);
  assert.equal(reserved(), true);
  assert.equal(drawer.hidden, false);
  assert.equal(main.classList.contains("queue-drawer-open"), false);
  h.raf();
  assert.equal(reserved(), true);
  assert.equal(main.classList.contains("queue-drawer-open"), true);
  assert.equal(h.window.localStorage.getItem(key), preferences);
  await h.click(button);
  assert.equal(reserved(), false);
  assert.equal(main.classList.contains("queue-drawer-sliding"), true);
  assert.equal(drawer.hidden, false);
  assert.equal(h.window.localStorage.getItem(key), preferences);
  const end = new h.window.Event("transitionend", { bubbles: true });
  Object.defineProperty(end, "propertyName", { value: "transform" });
  drawer.dispatchEvent(end);
  assert.equal(reserved(), false);
  assert.equal(drawer.hidden, true);
});

test("queue drawer real jumps retain random history and reject late playback results", async t => {
  const h=await setup();t.after(h.dispose);
  const base=responses([track(1),track(2),track(3)]);
  h.reply(base);h.core.playListItem('search',[track(1),track(2),track(3)],0);await h.microtasks();
  h.store.actions.playbackQueue.changeShuffle(true,()=>0);
  const before=[...h.store.getState().playbackQueue.randomRemaining];await h.open();
  const row=(index:number)=>h.doc.querySelector(`[data-queue-index='${index}']`)!;
  await h.click(row(2));await h.microtasks();
  assert.equal((h.platform.filter(e=>e.operation==='scrollIntoView').at(-1)?.detail as ScrollIntoViewOptions).block,'nearest');
  assert.equal(h.store.getState().playbackQueue.currentIndex,2);assert.equal(h.store.getState().playbackQueue.history.at(-1)?.index,0);
  assert.deepEqual(h.store.getState().playbackQueue.randomRemaining,before.filter(i=>i!==2));
  h.core.playPrevious();await h.microtasks();assert.equal(h.store.getState().playbackQueue.currentIndex,0);assert.deepEqual(h.store.getState().playbackQueue.randomRemaining,before.filter(i=>i!==2));
  const calls=h.calls.length;await h.click(row(0));assert.equal(h.calls.length,calls);
  const old=deferred(),latest=deferred();
  h.reply(async(command,args)=>command==='prepare_audio' ? args.bvId===track(2).bvid?old.promise:latest.promise : base(command));
  await h.click(row(1));await h.microtasks();await h.click(row(2));await h.microtasks();
  latest.resolve({audioUrl:'http://127.0.0.1/new',title:'新',uploader:'作者',thumbnailUrl:'',durationSeconds:60});await h.microtasks();
  const source=h.doc.querySelector<HTMLAudioElement>('audio')!.src;
  old.resolve({audioUrl:'http://127.0.0.1/old',title:'旧',uploader:'作者',thumbnailUrl:'',durationSeconds:60});await h.microtasks();
  assert.equal(h.store.getState().playbackQueue.currentIndex,2);assert.equal(h.doc.querySelector<HTMLAudioElement>('audio')!.src,source);assert.ok(source.endsWith('/new'));
});

test("queue drawer collections use parent entry freezing and local read-only expansion", async t => {
  const h=await setup();t.after(h.dispose);const data=collection(3);
  const base=responses();h.reply(async(command,args)=>command==='get_collection_page'?{items:data.snapshot.items,total:3,hasMore:false,snapshot:data}:base(command));
  const entries=libraryQueueEntries([collectionEntry(data),{kind:'video',entryId:'v',video:track(8)}]);
  h.core.playListItem('favorites',entries,1);await h.microtasks();await h.open();
  const expand=h.doc.querySelector<HTMLButtonElement>('.queue-expand')!;assert.equal(expand.getAttribute('aria-expanded'),'false');
  const state=h.store.getState().playbackQueue;await h.click(expand);await h.microtasks();assert.equal(expand.getAttribute('aria-expanded'),'true');assert.equal(h.store.getState().playbackQueue,state);
  assert.equal(h.doc.querySelectorAll('.queue-members button, .queue-members [tabindex]').length,0);
  await h.click(h.doc.querySelector('[data-queue-index="0"]')!);await h.microtasks();
  assert.equal(h.store.getState().playbackQueue.currentIndex,0);assert.equal(h.store.getState().playbackQueue.collectionNeedsRefresh,false);assert.equal(h.doc.querySelectorAll('.queue-members .is-current').length,1);
  assert.equal(h.doc.querySelector('[data-queue-index="0"]')!.getAttribute('aria-current'),'true');
});

test("queue drawer skips 100 progress renders and updates exactly two current rows", async t => {
  const h=await setup();t.after(h.dispose);
  h.store.actions.playbackQueue.replaceQueue(Array.from({length:1000},(_,i)=>track(i+1)));
  assert.equal(h.renderCounts.QueueDrawerRow,0);assert.equal(h.doc.querySelectorAll('[data-queue-index]').length,0);
  h.store.actions.playbackQueue.selectIndex(0,false,null);await h.open();
  assert.equal(h.doc.querySelectorAll('[data-queue-index]').length,1000);
  const counts=h.renderCounts;counts.QueueDrawer=0;counts.QueueDrawerRow=0;
  const scrolls=h.platform.filter(e=>e.operation==='scrollIntoView').length;
  for(let i=0;i<100;i++)h.store.actions.playbackDisplay.observeProgress({currentTime:i/10,duration:100,paused:false,ended:false,playbackRate:1});
  assert.equal(counts.QueueDrawer,0);assert.equal(counts.QueueDrawerRow,0);assert.equal(h.platform.filter(e=>e.operation==='scrollIntoView').length,scrolls);
  h.store.actions.playbackQueue.selectIndex(9,true,null);assert.equal(counts.QueueDrawerRow,2);
  assert.equal((h.platform.filter(e=>e.operation==='scrollIntoView').at(-1)?.detail as ScrollIntoViewOptions).block,'nearest');
  await h.click(h.node('queue-drawer').querySelector('header button')!);
  assert.equal(h.doc.querySelectorAll('[data-queue-index]').length,1000);
  const end=new h.window.Event('transitionend',{bubbles:true});Object.defineProperty(end,'propertyName',{value:'transform'});h.node('queue-drawer').dispatchEvent(end);
  assert.equal(h.doc.querySelectorAll('[data-queue-index]').length,0);
});

test("queue drawer yields Escape to immersive including its closing transition", async t => {
  const h=await setup();t.after(h.dispose);
  h.reply(responses());h.core.playListItem('search',[track(1)],0);await h.microtasks();await h.open();
  await h.click(h.node('open-immersive-button'));h.raf();h.node('close-immersive-button').focus();
  const escape=()=>h.fire(h.doc.activeElement!,'keydown',{key:'Escape'});
  await escape();
  assert.equal(h.store.getState().playbackDisplay.presentation.immersiveOpen,false);
  assert.equal(h.store.getState().playbackDisplay.presentation.immersiveHidden,false);
  assert.equal(h.node('queue-position').getAttribute('aria-expanded'),'true');
  assert.equal(h.doc.activeElement,h.node('open-immersive-button'));
  const closing=await escape();assert.equal(closing.defaultPrevented,false);
  assert.equal(h.node('queue-position').getAttribute('aria-expanded'),'true');
  assert.equal(h.doc.activeElement,h.node('open-immersive-button'));
  h.node('immersive-player').dispatchEvent(new h.window.Event('transitionend',{bubbles:true}));
  assert.equal(h.store.getState().playbackDisplay.presentation.immersiveHidden,true);
  await escape();assert.equal(h.node('queue-position').getAttribute('aria-expanded'),'false');assert.equal(h.doc.activeElement,h.node('queue-position'));
});

test("queue drawer yields Escape to the quality menu and preserves its return focus", async t => {
  const h=await setup();t.after(h.dispose);
  h.reply(responses());h.core.playListItem('search',[track(1)],0);await h.microtasks();await h.open();
  await h.click(h.node('player-audio-quality'));assert.ok(h.store.getState().playbackDisplay.audioQualityMenu);
  await h.fire(h.doc.activeElement!,'keydown',{key:'Escape'});
  assert.equal(h.store.getState().playbackDisplay.audioQualityMenu,null);
  assert.equal(h.node('queue-position').getAttribute('aria-expanded'),'true');assert.equal(h.doc.activeElement,h.node('player-audio-quality'));
  await h.fire(h.doc.activeElement!,'keydown',{key:'Escape'});
  assert.equal(h.node('queue-position').getAttribute('aria-expanded'),'false');assert.equal(h.doc.activeElement,h.node('queue-position'));
});

for(const present of [true,false])test(`queue drawer history member ${present?'matches frozen BV without an extra row':'is appended only when absent'}`,async t=>{
  const h=await setup();t.after(h.dispose);
  const entries=libraryQueueEntries([collectionEntry(collection(3))]);
  const entry=entries[0],historyTrack={...track(present?2:9),title:'历史成员'};
  assert.ok(entry.collection);
  h.store.actions.playbackQueue.replaceQueue([{...entry,collection:{...entry.collection,memberIndex:0,historyTrack}}]);
  h.store.actions.playbackQueue.selectIndex(0,false,null,false);await h.open();
  const members=h.doc.querySelectorAll('.queue-members > li');
  assert.equal(members.length,present?3:4);assert.equal(h.doc.querySelectorAll('.queue-members .is-current').length,1);
  assert.equal(members[present?1:3].classList.contains('is-current'),true);
  assert.equal(members[present?1:3].textContent,present?'曲目2':'历史成员');
});

test("queue drawer receives matching search pages and recent jumps retain known CID hints", async t => {
  const h=await setup();t.after(h.dispose);const base=responses();
  h.reply(async(command,args)=>command==='search_videos' ? Number(args.page)===1?Array.from({length:20},(_,i)=>track(i+1)):[track(21)] : base(command));
  await h.search.runSearch({userKeyword:'分页'});h.core.playSearchResult(0);await h.microtasks();await h.open();
  h.node<HTMLInputElement>('search-keyword').value='分页';
  await h.search.loadMoreSearchResults();assert.equal(h.doc.querySelectorAll('[data-queue-index]').length,21);
  const recent=[{...track(1),lastPlayedAt:'2',count:1,lastCid:11,lastPage:1,lastPartName:'P1'},{...track(2),lastPlayedAt:'1',count:1,lastCid:22,lastPage:2,lastPartName:'P2'}];
  h.reply(async(command)=>command==='get_play_history'?recent:command==='check_audio_cache'?[false,false]:command==='get_video_pages'?[{cid:11,page:1,part:'P1',durationSeconds:60},{cid:22,page:2,part:'P2',durationSeconds:60}]:base(command));
  await h.store.actions.recent.load(()=>'highest',1);h.core.playListItem('recent',h.store.getState().recent.items,0);await h.microtasks();
  await h.click(h.doc.querySelector('[data-queue-index="1"]')!);await h.microtasks();
  assert.equal(h.calls.filter(c=>c.command==='prepare_audio').at(-1)?.args.cid,22);
  assert.equal(h.store.getState().playbackQueue.queueSource,'recent');
});

test("queue drawer reduced motion closes immediately without mounting an image surface", async t => {
  const h=await setup();t.after(h.dispose);
  Object.defineProperty(h.window,'matchMedia',{configurable:true,value:()=>({matches:true,addEventListener(){},removeEventListener(){}})});
  h.store.actions.playbackQueue.replaceQueue([track(1)]);h.store.actions.playbackQueue.selectIndex(0,false,null);
  h.store.actions.settings.setTheme('image');await h.open();
  assert.equal(h.node('queue-drawer').querySelector('.floating-backdrop'),null);
  assert.equal((h.platform.filter(e=>e.operation==='scrollIntoView').at(-1)?.detail as ScrollIntoViewOptions).behavior,'auto');
  const start=h.platform.length;await h.click(h.node('queue-drawer').querySelector('header button')!);
  assert.equal(h.node('queue-drawer').hidden,true);assert.equal(h.node('queue-drawer').querySelector('.floating-backdrop'),null);
  assert.ok(!h.platform.slice(start).some(e=>e.operation==='disconnect'));
});

test("抽屉打开裁剪主区，关闭动画结束解除裁剪，未安装 resize 或浮层观察",async t=>{
  const h=await setup();t.after(h.dispose);
  h.store.actions.playbackQueue.replaceQueue([track(1)]);h.store.actions.settings.setTheme("dynamic");
  const drawer=h.node("queue-drawer"), main=h.doc.querySelector(".main-panel")!;
  const adds=()=>h.listeners.filter(e=>e.target===h.window&&e.type==="resize");
  const deletes=()=>h.platform.filter(e=>e.target===h.window&&e.operation==="removeEventListener"&&(e.detail as {type:string}).type==="resize");
  const start=adds().length,removed=deletes().length,observed=h.observed.size;
  for(let i=0;i<2;i++){
    await h.open();assert.equal(adds().length,start);assert.equal(h.observed.size,observed);
    assert.ok(main.classList.contains("queue-drawer-open"));
    const end=new h.window.Event("transitionend",{bubbles:true});Object.defineProperty(end,"propertyName",{value:"transform"});drawer.dispatchEvent(end);
    assert.ok(drawer.classList.contains("is-open"));assert.ok(main.classList.contains("queue-drawer-sliding"));
    h.window.dispatchEvent(new h.window.Event("resize"));assert.ok(main.classList.contains("queue-drawer-open"));
    await h.click(drawer.querySelector("header button")!);
    assert.equal(deletes().length,removed);
    assert.equal(main.classList.contains("queue-drawer-open"),false);
    assert.ok(main.classList.contains("queue-drawer-sliding"));assert.equal(drawer.hidden,false);
    drawer.dispatchEvent(end);
    assert.equal(main.classList.contains("queue-drawer-sliding"),false);assert.equal(drawer.hidden,true);
  }
});

test("减少动效时抽屉打开同步采用最终位置，不等待观察器或过渡事件",async t=>{
  const h=await setup();t.after(h.dispose);
  Object.defineProperty(h.window,"matchMedia",{configurable:true,value:()=>({matches:true,addEventListener(){},removeEventListener(){}})});
  const drawer=h.node("queue-drawer");
  const main=h.doc.querySelector(".main-panel")!;
  h.store.actions.playbackQueue.replaceQueue([track(1)]);h.store.actions.settings.setTheme("image");
  await h.click(h.node("queue-position"));h.raf();
  assert.ok(main.classList.contains("queue-drawer-open"));
  assert.equal(drawer.querySelector(".floating-backdrop"),null);
  await h.click(drawer.querySelector("header button")!);
  assert.equal(main.classList.contains("queue-drawer-sliding"),false);
  assert.equal(main.classList.contains("queue-drawer-open"),false);
});
