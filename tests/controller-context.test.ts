import assert from "node:assert/strict";
import { test } from "node:test";
import { createControllerContext } from "./helpers/controller-context.ts";

test("controller contexts use frozen stores and readonly assertion aliases without boundary synchronization", () => {
  const playerState = {queue:[{bvid:"BV1"}],currentIndex:0,requestVersion:7,currentPages:[]};
  const context = createControllerContext({playerState,randomPageRound:{bvid:"BV1",remaining:[1]}});
  const before = context.getQueueSnapshot(), round = context.randomPageRound;
  assert.equal(Object.isFrozen(before.queue),true);
  assert.throws(()=>{playerState.currentIndex=2;},TypeError);
  context.seedQueue({currentIndex:1});
  assert.equal(playerState.currentIndex,1);
  assert.equal(before.currentIndex,0);
  assert.equal(context.randomPageRound,round);
  context.getRequestActions().beginRequest();
  assert.equal(playerState.requestVersion,8);
  context.getSessionActions().setCurrentPages([{page:1,cid:11,part:"P1",durationSeconds:60}]);
  assert.equal(playerState.currentPages,context.getSessionSnapshot().currentPages);
  const pending = Promise.resolve("done");
  context.invoke=()=>pending;
  assert.equal(context.invoke(),pending);
});
