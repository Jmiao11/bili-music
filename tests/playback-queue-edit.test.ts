import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaybackQueueActions, initialPlaybackQueueState, libraryQueueEntries } from "../ui/features/playback/playback-queue-state.ts";
import { createStateStore } from "../ui/store/state-store.ts";
import { collection, collectionEntry } from "./helpers/collections.ts";

test("插入只移动父索引，当前播放身份与冻结轮次保持", () => {
  const group = collection(4), [first, second, third, added] = group.snapshot.items;
  const store = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions, { freeze: true });
  const actions = store.actions;
  actions.replaceQueue([first, second, ...libraryQueueEntries([collectionEntry(group)]), third], "playlist", null, "list");
  actions.selectIndex(2, false, null);
  actions.changeShuffle(true, () => 0);
  actions.selectIndex(0, true, 22);
  actions.markPlayed(0);
  actions.setDisplayTrack({ ...first, hasCurrent: true });
  const before = store.getState();
  const notifications: string[] = [];
  store.subscribe(state => notifications.push(state.queueSource));
  assert.equal(actions.insertNextVideo(added), true);
  const after = store.getState();
  assert.deepEqual(notifications, ["direct"]);
  assert.equal(after.queue[after.currentIndex], before.queue[before.currentIndex]);
  assert.equal(after.currentDisplayTrack, before.currentDisplayTrack);
  assert.equal(after.queue[3], before.queue[2]);
  assert.equal(after.queue[3].collection, before.queue[2].collection);
  assert.equal(after.queue[2], before.queue[1]);
  assert.equal(after.queue[4], before.queue[3]);
  assert.deepEqual(after.history, [{ ...before.history[0], index: 3 }]);
  assert.equal(after.history[0].track, before.history[0].track);
  assert.deepEqual(after.randomRemaining, [...before.randomRemaining.map(i => i + 1), 1]);
  assert.deepEqual([after.queueSource, after.queueSearchVersion, after.playlistId], ["direct", null, null]);
  assert.equal(actions.insertNextVideo(added), false);
  assert.equal(store.getState(), after);
  assert.equal(notifications.length, 1);
  actions.insertNextVideo(second);
  assert.deepEqual(store.getState().queue.map(t => t.bvid), [first,second,added,second,first,third].map(t => t.bvid));
});

test("紧邻合集的锚点不参与视频去重，搜索版本随结构编辑清除", () => {
  const data = collection(3), [first, second] = data.snapshot.items;
  const store = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions);
  store.actions.replaceQueue([second, ...libraryQueueEntries([collectionEntry(data)])], "search", 5);
  store.actions.selectIndex(0, false, null);
  store.actions.insertNextVideo(first);
  assert.equal(store.getState().queue[1].collection, undefined);
  assert.ok(store.getState().queue[2].collection);
  assert.equal(store.getState().queueSearchVersion, null);
});

test("移出非当前出现：索引、历史与冻结引用在一次提交通知内一致", () => {
  const data = collection(4), [a,b,c] = data.snapshot.items;
  const group = libraryQueueEntries([collectionEntry(data)])[0];
  for (const position of [0,2,3,4]) {
    const s = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions, {freeze:true}), q=s.actions;
    q.replaceQueue([group,a,group,a,c],"playlist",null,"p"); q.selectIndex(1,false,null);
    const history=s.getState().queue.flatMap((item,index)=>[true,false].map(pageLevel=>({index,cid:index+1,pageLevel,entryId:item.entryId,bvid:item.bvid,track:b})));
    q.restoreTraversal({loopMode:"sequence",shuffle:true,randomRemaining:[4,0,2],history,randomPageRound:null});
    const old=s.getState();let commits=0;s.subscribe(()=>commits++);
    for(const invalid of [1,-1,5,1.5]) assert.equal(q.removeNonCurrentEntry(invalid),false);
    assert.equal(s.getState(),old);assert.equal(commits,0);
    assert.equal(q.removeNonCurrentEntry(position),true);assert.equal(commits,1);
    const after=s.getState(),shift=(i:number)=>i>position?i-1:i;
    assert.equal(after.queue[after.currentIndex],old.queue[1]);
    old.queue.forEach((entry,i)=>{if(i!==position)assert.equal(after.queue[shift(i)],entry);});
    assert.deepEqual(after.randomRemaining,old.randomRemaining.filter(i=>i!==position).map(shift));
    const kept=old.history.filter(h=>h.index!==position);
    assert.deepEqual(after.history,kept.map(h=>({...h,index:shift(h.index)})));
    after.history.forEach((h,i)=>assert.equal(h.track,kept[i].track));
    assert.deepEqual([after.queueSource,after.playlistId,after.queueSearchVersion],["direct",null,null]);
  }
});

test("移出当前父项按顺序、随机及列表循环一次选定后继", () => {
  const data = collection(4), [a, b, c] = data.snapshot.items;
  const group = libraryQueueEntries([collectionEntry(data)])[0];
  const scenarios = [
    { index: 1, mode: "sequence", shuffle: false, remaining: [], target: b.bvid, stack: [] },
    { index: 1, mode: "single", shuffle: false, remaining: [], target: b.bvid, stack: [] },
    { index: 3, mode: "sequence", shuffle: false, remaining: [], target: undefined, stack: [] },
    { index: 3, mode: "list", shuffle: false, remaining: [], target: a.bvid, stack: [] },
    { index: 1, mode: "sequence", shuffle: true, remaining: [2, 3, 0], target: a.bvid, stack: [1, 2] },
    { index: 1, mode: "sequence", shuffle: true, remaining: [], target: undefined, stack: [] },
    { index: 1, mode: "list", shuffle: true, remaining: [], target: a.bvid, stack: [1, 2] },
  ];
  for (const { index, mode, shuffle, remaining, target, stack } of scenarios) {
    const s = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions, { freeze: true }), q = s.actions;
    q.replaceQueue([a, group, b, c], "search", 10);
    q.selectIndex(index, false, null);
    q.restoreTraversal({ loopMode: mode, shuffle, randomRemaining: remaining, history: [{ index, cid: 11 }, { index: 2, cid: 22 }],
      randomPageRound: { bvid: a.bvid, playedCount: 1, remaining: [1] } });
    let commits = 0; s.subscribe(() => commits++);
    q.removeCurrentEntry(() => 0);
    const state = s.getState();
    assert.equal(commits, 1);
    assert.equal(q.activeTrack()?.bvid, target);
    assert.deepEqual(state.randomRemaining, stack);
    assert.deepEqual(state.history, [{ index: index < 2 ? 1 : 2, cid: 22 }]);
    assert.deepEqual([state.currentPageIndex, state.currentDisplayTrack, state.randomPageRound, state.queueSearchVersion], [0, null, null, null]);
  }
});

test("唯一项移出与全清保留循环和随机偏好", () => {
  const [a] = collection(2).snapshot.items;
  const s = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions), q = s.actions;
  q.replaceQueue([a], "search", 5); q.selectIndex(0, false, null);
  q.restoreTraversal({ loopMode: "list", shuffle: true, randomRemaining: [], history: [{ index: 0, cid: 1 }], randomPageRound: null });
  q.removeCurrentEntry(() => 0);
  const empty = { ...initialPlaybackQueueState(), loopMode: "list", shuffle: true };
  assert.deepEqual(s.getState(), empty);
  q.replaceQueue([a]); q.selectIndex(0, false, null); q.clearQueue();
  assert.deepEqual(s.getState(), empty);
});

test("插入后移出恢复原队列与遍历",()=>{
  const [a,b,c]=collection(3).snapshot.items,s=createStateStore(initialPlaybackQueueState(),createPlaybackQueueActions),q=s.actions;
  q.replaceQueue([a,b],"search",4);assert.equal(q.removeNonCurrentEntry(0),false);q.selectIndex(0,false,null);q.changeShuffle(true,()=>0);
  const before=s.getState();q.insertNextVideo(c);q.removeNonCurrentEntry(1);
  assert.deepEqual(s.getState(),{...before,queueSource:"direct",queueSearchVersion:null});
});
