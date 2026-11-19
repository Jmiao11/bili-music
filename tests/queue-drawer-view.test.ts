import assert from "node:assert/strict";
import { test } from "node:test";
import { createQueueDrawerProjection } from "../ui/features/playback/queue-drawer-view.ts";
import { createPlaybackQueueActions, initialPlaybackQueueState } from "../ui/features/playback/playback-queue-state.ts";
import { createStateStore } from "../ui/store/state-store.ts";

test("queue drawer retains models across unrelated commits and only replaces old/new current rows", () => {
  const store = createStateStore(initialPlaybackQueueState(), createPlaybackQueueActions, { freeze: true });
  const project = createQueueDrawerProjection(), stage = { hidden: false, open: true };
  store.actions.replaceQueue(Array.from({length:1000}, (_, i) => ({ bvid:`BV${String(i).padStart(10,'0')}`, title:`曲目${i}`, uploader:"作者", thumbnailUrl:"", durationSeconds:60 })));
  store.actions.selectIndex(0, false, null);
  const first = project(store.getState(),stage);
  for (let i=0;i<100;i++) assert.equal(project({...store.getState()},stage),first);
  store.actions.selectIndex(7, true, null);
  const next = project(store.getState(),stage);
  assert.deepEqual(next.rows.flatMap((row,i)=>row !== first.rows[i] ? [i] : []),[0,7]);
  assert.equal(next.count,1000);
  assert.equal(project(store.getState(),{hidden:true,open:false}).rows[3],next.rows[3]);
});

test("投影先认领存活出现，再按位置继承，身份只留在投影",()=>{
  const s=createStateStore(initialPlaybackQueueState(),createPlaybackQueueActions),q=s.actions, project=createQueueDrawerProjection(),stage={hidden:false,open:true};
  const read=()=>project(s.getState(),stage).rows;
  const fields={title:"a",uploader:"",thumbnailUrl:"",durationSeconds:60};
  const a={...fields,bvid:"BV1",entryId:"A"},b={...fields,bvid:"BV2",entryId:"B"};q.replaceQueue([a,b]);q.selectIndex(0,false,null);
  const first=read();q.insertNextVideo({...b,bvid:"BV1"});const next=read();
  assert.equal(next[2],first[1]);assert.notEqual(next[1].id,first[1].id);
  q.removeNonCurrentEntry(1);assert.equal(read()[1],first[1]);
  q.replaceQueue([a,b]);assert.deepEqual(read().map(r=>r.id),first.map(r=>r.id));
  q.fillTrackMetadata(1,{...fields,title:"new"});assert.equal(read()[1].id,first[1].id);
  q.replaceQueue([{...a,entryId:"different"},{...fields,bvid:"bv2"}]);const changed=read();assert.notEqual(changed[0].id,first[0].id);assert.equal(changed[1].id,first[1].id);
  const st=s.getState(),entry=st.queue[0];const duplicated=project({...st,queue:[entry,entry]},stage).rows;
  assert.notEqual(duplicated[0].id,duplicated[1].id);assert.ok(st.queue.every(e=>!("id" in e)));
});

test("同内容重建复用显示模型，后续按实际出现引用匹配而非旧显示对象",()=>{
  const s=createStateStore(initialPlaybackQueueState(),createPlaybackQueueActions),q=s.actions;
  const view=createQueueDrawerProjection(),stage={hidden:false,open:true},rows=()=>view(s.getState(),stage).rows;
  const tracks=Array.from({length:4},(_,i)=>({bvid:"BV"+i,title:"曲"+i,uploader:"UP",thumbnailUrl:"",durationSeconds:60}));
  q.replaceQueue(tracks);q.selectIndex(0,false,null);const before=rows();
  q.replaceQueue(tracks);const none=rows();
  assert.deepEqual(none.flatMap((r,i)=>r!==before[i]?[i]:[]),[0]);
  assert.equal(view(s.getState(),stage).hasCurrent,false);
  q.selectIndex(1,false,null);const selected=rows();
  assert.deepEqual(selected.flatMap((r,i)=>r!==none[i]?[i]:[]),[1]);
  q.removeNonCurrentEntry(0);const shifted=rows();
  shifted.forEach((r,i)=>assert.equal(r,selected[i+1]));
  for(const field of ["title","uploader","thumbnailUrl","durationSeconds"] as const){
    const old=rows()[0];q.fillTrackMetadata(0,{...old.entry,[field]:field==="durationSeconds"?90:"changed"});
    assert.notEqual(rows()[0],old);assert.equal(rows()[0].id,old.id);
  }
});
