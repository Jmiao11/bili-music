import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture as realFixture, deferred } from "./tracks-fixture.ts";
const track = { bvid: "BV1234567890", title: "曲目甲", uploader: "作者", thumbnailUrl: "", durationSeconds: 60, playCount: 0, pubdate: 0, addedAt: "" };

type HomeRow = HTMLElement & { activate?: (index: number, selection?: unknown) => void };
async function loadHomeFixture() {
  const h = await realFixture({ homeSpy: true });
  const nodes = { ...h.nodes, homeRankingList: h.nodes.homeRankingList as HTMLUListElement & { children: HTMLCollectionOf<HomeRow> } };
  const states = { searchState: h.store.getState().search as unknown as { userKeyword: string; requestVersion: number; results: unknown[] }, playerState: { queue: [...h.store.getState().playbackQueue.queue] } };
  return { ...h, nodes, states, module: h.home, setResponse: h.reply, flush: h.microtasks };
}

test("home ranking caches nonempty results and force refresh preserves its request and busy UI", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async command => command === "get_ai_config" ? { hasKey: false } : [track]);
    await h.module.refreshAiKeyState();
    assert.equal(h.nodes.homeRankingList.children.length, 1);
    const requests = h.calls.length;
    await h.module.loadHomeRanking();
    assert.equal(h.calls.length, requests);
    const next = deferred(); h.setResponse(() => next.promise);
    await h.advance(60000);
    const pending = h.module.loadHomeRanking({ forceRefresh: true });
    assert.deepEqual(h.calls.slice(-2).map(call=>[call.command,call.args.source,call.args.mode]), [["get_music_ranking","ranking","refresh"],["get_music_ranking","newSongs","refresh"]]);
    assert.equal(h.nodes.refreshRankingButton.disabled, true);
    assert.equal(h.nodes.homeRankingStatus.textContent, "正在刷新音乐热门…");
    assert.equal(h.nodes.homeRankingList.children.length, 1);
    assert.ok(h.nodes.homeRankingList.querySelector("button.track"));
    next.resolve([]); await pending;
    assert.equal(h.nodes.refreshRankingButton.disabled, true);
    assert.equal(h.nodes.refreshRankingButton.title,"刚刚更新，请稍后再试");
    assert.equal(h.nodes.homeRankingList.children.length, 0);
    assert.equal(h.nodes.homeRankingStatus.textContent, "已加载 0 首音乐区热门视频。");
    await h.advance(59000); assert.equal(h.nodes.refreshRankingButton.disabled,true);
    await h.advance(1000); assert.equal(h.nodes.refreshRankingButton.disabled,false);
    h.setResponse(async () => [track]); await h.module.loadHomeRanking();
    assert.equal(h.calls.length, requests + 4, "empty ranking is not a cache hit");
  } finally { h.dispose(); }
});

test("home ranking failure leaves retry copy and no search fallback", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async () => { throw new Error("ranking failed"); });
    await h.module.loadHomeRanking();
    assert.equal(h.nodes.homeRankingError.textContent, "拉取失败，点击重试");
    assert.equal(h.doc.querySelector<HTMLButtonElement>("button.home-error")?.disabled,false);
    assert.equal(h.nodes.homeRankingStatus.textContent, "音乐热门拉取失败。");
    assert.equal(h.nodes.homeRankingList.children.length, 0);
    assert.equal(h.nodes.refreshRankingButton.disabled, true);
    assert.equal(h.nodes.refreshRankingButton.title,"刚刚更新，请稍后再试");
    assert.deepEqual(h.calls.map(call => call.command), ["get_music_ranking", "get_music_ranking"]);
  } finally { h.dispose(); }
});

test("home without API key keeps rows and timestamps after a failed manual update", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async command => command === "get_ai_config" ? { hasKey: false } : [track]);
    await h.module.refreshAiKeyState();
    assert.deepEqual(h.calls.map(call => call.command), ["get_ai_config", "get_music_ranking", "get_music_ranking"]);
    assert.equal(h.nodes.homeTitle.textContent, "发现音乐");
    assert.equal(h.nodes.homePanel?.getAttribute("data-home-mode"), "popular");
    assert.equal(h.nodes.homeHintRow.hidden, true);
    assert.equal(h.nodes.homeSetupTitle.textContent, "配置 API Key 后可生成专属推荐");
    assert.equal(h.nodes.homeSetupHint.classList.contains("is-inline"), true);
    const stamp=h.store.getState().home.feed.ranking.timestamp;
    await h.advance(60000);
    h.setResponse(async () => { throw new Error("ranking failed"); });
    await h.module.loadHomeRanking({ forceRefresh: true });
    const retry=h.doc.querySelector<HTMLButtonElement>(".home-ranking-bar button")!;
    assert.equal(retry.textContent,"更新失败，点击重试");
    assert.equal(retry.disabled,false);
    assert.equal(h.store.getState().home.feed.ranking.timestamp,stamp);
    assert.equal(h.nodes.homeRankingList.children[0].querySelector(".track-title")?.textContent,track.title);
    assert.equal(h.nodes.homeRankingStatus.textContent, "");
  } finally { h.dispose(); }
});

test("home reads saved recommendations once and does not generate them automatically", async () => {
  const h = await loadHomeFixture();
  try {
    const saved = deferred();
    h.setResponse(async command => command === "get_ai_config" ? { hasKey: true } : saved.promise);
    const pending = h.module.refreshAiKeyState(); await h.flush();
    assert.equal(h.nodes.homeRankingStatus.textContent, "正在读取上次推荐…");
    assert.equal(h.nodes.homeHintApply.disabled, true);
    assert.equal(h.nodes.homeRankingList.children.length, 8);
    saved.resolve([track]); await pending;
    assert.equal(h.nodes.homeRankingStatus.textContent, "已加载 1 首上次推荐。");
    assert.equal(h.nodes.homeHintApply.disabled, false);
    await h.module.loadRecommendationHome();
    assert.deepEqual(h.calls.map(call => call.command), ["get_ai_config", "get_saved_recommendations"]);
  } finally { h.dispose(); }
});

test("home saved recommendation errors become an empty completed read", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async () => { throw new Error("saved failed"); });
    await h.module.loadRecommendationHome();
    assert.equal(h.nodes.homeRankingStatus.textContent, "");
    assert.equal(h.nodes.homeRankingError.textContent, "");
    assert.equal(h.nodes.homeSetupHint.hidden, true);
    await h.module.loadRecommendationHome();
    assert.equal(h.calls.length, 1);
  } finally { h.dispose(); }
});

test("home generation trims the hint caches success and times out after 95000ms", async () => {
  const h = await loadHomeFixture();
  try {
    h.nodes.homeHintInput.value = "  安静一点  ";
    h.setResponse(async () => [track]);
    await h.module.loadRecommendations();
    assert.deepEqual(h.calls[0], { command: "get_recommendations", args: { userHint: "安静一点" } });
    assert.equal(h.nodes.homeRankingStatus.textContent, "已生成 1 首推荐。");
    assert.equal(h.timers.size, 0);
    await h.module.loadRecommendations(); assert.equal(h.calls.length, 1);
    h.setResponse(() => new Promise(() => {}));
    const pending = h.module.loadRecommendations({ forceRefresh: true });
    assert.equal(h.nodes.homeHintApply.textContent, "生成中…");
    assert.equal(h.nodes.homeRankingList.children.length, 8);
    const timeout = [...h.timers.values()].find(timer => timer.delay === 95000);
    assert.ok(timeout); timeout.callback(); await pending;
    assert.equal(h.nodes.homeSetupTitle.textContent, "推荐生成失败");
    assert.equal(h.nodes.homeSetupSub.textContent, "推荐耗时较长，请稍后重试。");
    assert.equal(h.nodes.homeSetupSettings.hidden, true);
    assert.equal(h.nodes.homeRankingList.children.length, 1, "a failed regeneration restores the last successful list");
    assert.equal(h.nodes.homeHintApply.textContent, "生成推荐");
    assert.equal(h.nodes.homeHintApply.disabled, false);
    assert.equal(h.nodes.refreshRankingButton.disabled, false);
    assert.equal(h.timers.size, 0);
  } finally { h.dispose(); }
});

test("home Key changes keep late ranking results from replacing recommendation rows", async () => {
  const h = await loadHomeFixture();
  try {
    const ranking = deferred();
    let hasKey = false;
    h.setResponse(async command => command === "get_ai_config" ? { hasKey } : command === "get_music_ranking" ? ranking.promise : [track]);
    const pendingRanking = h.module.refreshAiKeyState(); await h.flush();
    assert.equal(h.nodes.homeTitle.textContent, "发现音乐");
    hasKey = true;
    await h.module.refreshAiKeyState();
    assert.equal(h.nodes.homeTitle.textContent, "为你推荐");
    assert.equal(h.nodes.homeRankingList.children.length, 1);
    const row = h.nodes.homeRankingList.children[0];
    ranking.resolve([]); await pendingRanking;
    assert.equal(h.nodes.homeRankingList.children[0], row);
    assert.equal(h.nodes.homeRankingStatus.textContent, "已加载 0 首音乐区热门视频。", "shared status retains the existing completion order");
  } finally { h.dispose(); }
});

test("home only offers settings for configuration errors and restores controls after a retry", async () => {
  const h = await loadHomeFixture();
  try {
    h.setResponse(async () => { throw new Error("HTTP 401：推荐模型请求失败，请稍后重试。"); });
    await h.module.loadRecommendations({ forceRefresh: true });
    assert.equal(h.nodes.homeSetupHint.hidden, false);
    assert.equal(h.nodes.homeSetupSettings.hidden, false);
    assert.match(h.nodes.homeSetupSub.textContent, /API Key/);
    h.setResponse(async () => { throw new Error("推荐关键词生成超时，请稍后重试。"); });
    await h.module.loadRecommendations({ forceRefresh: true });
    assert.equal(h.nodes.homeSetupSettings.hidden, true);
    assert.doesNotMatch(h.nodes.homeSetupSub.textContent, /API Key/);
    h.setResponse(async () => [track]);
    await h.module.loadRecommendations({ forceRefresh: true });
    assert.equal(h.nodes.homeSetupHint.hidden, true);
    assert.equal(h.nodes.homeRankingList.children.length, 1);
    assert.equal(h.nodes.homeHintApply.disabled, false);
  } finally { h.dispose(); }
});

test("home and search states stay isolated while ranking and recommendation clicks use existing playback entry", async () => {
  const h = await loadHomeFixture();
  try {
    h.states.searchState.userKeyword = "搜索原值";
    h.states.searchState.requestVersion = 9;
    h.states.searchState.results = [track];
    const before = JSON.stringify(h.states.searchState);
    let hasKey = false;
    h.setResponse(async command => command === "get_ai_config" ? { hasKey } : [track]);
    await h.module.refreshAiKeyState();
    const row = h.nodes.homeRankingList.children[0];
    row.activate?.(0, { startPage: { cid: 1 } });
    assert.equal(h.played[0][0], "ranking");
    assert.equal(h.played[0][2], 0);
    assert.deepEqual(h.played[0][3], { startPage: { cid: 1 } });
    assert.equal(JSON.stringify(h.states.searchState), before);
    assert.equal(h.states.playerState.queue.length, 0, "rendering does not start playback");
    hasKey = true;
    await h.module.refreshAiKeyState();
    h.nodes.homeRankingList.children[0].activate?.(0);
    assert.equal(h.played[1][0], "recommendation");
    h.states.searchState.requestVersion++;
    const calls = h.calls.length;
    await h.module.loadRecommendationHome();
    assert.equal(h.calls.length, calls);
    assert.equal(h.nodes.homeRankingList.children.length, 1);
    assert.ok(h.queueUpdates() > 0);
  } finally { h.dispose(); }
});

test("homepage update stays absent until available, opens on click and restores after failure", async () => {
  const update = deferred();
  const h = await realFixture({ updateReply: update.promise });
  try {
    const button = () => h.doc.querySelector<HTMLButtonElement>("#home-update-button");
    const status = () => h.doc.querySelector<HTMLElement>("#home-update-status")!;
    assert.equal(button(), null);
    update.resolve({ version: "0.9.0" }); await h.microtasks();
    assert.match(button()!.textContent!, /发现新版本 v0\.9\.0/);
    assert.equal(status().getAttribute("aria-live"), "polite");
    assert.match(status().textContent!, /GitHub/);
    const opening = deferred();
    h.reply(() => opening.promise);
    await h.fire(button()!, "click");
    assert.equal(button()!.disabled, true);
    assert.match(button()!.textContent!, /正在打开/);
    assert.equal(status().textContent, "");
    assert.deepEqual(h.calls.map(call => call.command), ["open_update_download"]);
    opening.reject(Error("browser unavailable")); await h.microtasks();
    assert.equal(button()!.disabled, false);
    assert.match(button()!.textContent!, /打开失败，点击重试/);
    assert.match(status().textContent!, /无法打开 GitHub/);
    h.reply(async () => null);
    await h.fire(button()!, "click");
    assert.match(button()!.textContent!, /发现新版本 v0\.9\.0/);
    assert.doesNotMatch(status().textContent!, /无法打开/);
  } finally { h.dispose(); }
});

test("homepage no-update response has no button and leaves polite status empty", async () => {
  const h = await realFixture({ updateReply: Promise.resolve(null) });
  try {
    assert.equal(h.doc.querySelector("#home-update-button"), null);
    assert.equal(h.doc.querySelector("#home-update-status")!.textContent, "");
  } finally { h.dispose(); }
});

test("discovery sections render timestamps and start isolated real queues", async t => {
  const h = await realFixture(); t.after(h.dispose);
  const ranking=Array.from({length:12},(_,i)=>({...track,bvid:"BV"+String(i).padStart(10,"0")}));
  const newSongs=Array.from({length:8},(_,i)=>({...track,bvid:"BV"+String(i+20).padStart(10,"0"),durationSeconds:0}));
  const now=h.clock();
  h.reply(async (cmd,args)=>{
    if(cmd==="get_ai_config") return {hasKey:false};
    if(cmd==="get_music_ranking") return {section:{items:args.source==="ranking"?ranking:newSongs,date:args.today,fetchedAt:now},newSongs,sequence:1,requestAt:now,error:null,restricted:false};
    if(cmd==="prepare_audio") return {audioUrl:"http://127.0.0.1/audio/fixture",title:"合成歌曲",durationSeconds:60};
    return null;
  });
  await h.home.refreshAiKeyState();
  const [popular,fresh]=["#home-ranking-list","#home-new-songs"].map(id=>h.doc.querySelector<HTMLUListElement>(id)!);
  assert.equal(popular.children.length,12); assert.equal(fresh.children.length,8);
  assert.equal(h.doc.querySelectorAll(".home-ranking-bar").length,2);
  for(const bar of h.doc.querySelectorAll(".home-ranking-bar")) assert.match(bar.textContent,/更新于 \d\d:\d\d/);
  for(const [list,source,items,other] of [[popular,"ranking",ranking,fresh],[fresh,"newSongs",newSongs,popular]] as const) {
    await h.fire(list.children[2].querySelector("button.track")!,"click",{detail:0});
    assert.equal(h.store.getState().playbackQueue.queueSource,source);
    assert.deepEqual(h.store.getState().playbackQueue.queue.map(row=>row.bvid),items.map(row=>row.bvid));
    assert.equal(list.children[2].querySelector("button.track")?.getAttribute("aria-current"),"true");
    assert.equal(other.querySelectorAll('[aria-current="true"]').length,0);
  }
});
test("empty, stale automatic and manual failures use independent retry controls", async t => {
  const h=await realFixture(); t.after(h.dispose);
  const old=h.clock()-86400000, stamp=new Date(old);
  const date=[stamp.getFullYear(),String(stamp.getMonth()+1).padStart(2,"0"),String(stamp.getDate()).padStart(2,"0")].join("-");
  let sequence=0, risk=false;
  const wait=deferred();let hold=false;
  h.reply(async(cmd,args)=>{
    if(cmd==="get_ai_config") return {hasKey:false};
    if(cmd!=="get_music_ranking") return null;
    if(hold && args.source==="newSongs") await wait.promise;
    return {section:{date,fetchedAt:args.source==="ranking"?old:0,items:args.source==="ranking"?[track]:[]},newSongs:[],sequence:++sequence,requestAt:h.clock(),error:"更新失败",restricted:risk && args.source==="newSongs"};
  });
  await h.home.refreshAiKeyState();
  const panels=h.doc.querySelectorAll<HTMLElement>(".home-ranking-panel");
  assert.match(panels[0].textContent,new RegExp("更新于 "+date));
  assert.equal(panels[0].querySelector(".home-ranking-bar button"),null);
  assert.doesNotMatch(panels[0].textContent,/更新失败|拉取失败/);
  const retry=()=>panels[1].querySelector<HTMLButtonElement>("button.home-error")!;
  assert.equal(retry().textContent,"拉取失败，点击重试");assert.equal(retry().disabled,false);
  hold=true;const pending=h.store.actions.retryHomeSection("newSongs");
  const n=h.calls.length;await h.store.actions.retryHomeSection("newSongs");assert.equal(h.calls.length,n);
  wait.resolve(null);await pending;
  await h.advance(60000);risk=true;
  await h.home.loadHomeRanking({forceRefresh:true});
  assert.equal(panels[0].querySelector<HTMLButtonElement>(".home-ranking-bar button")?.disabled,false);
  assert.equal(panels[0].querySelector(".home-ranking-bar button")?.textContent,"更新失败，点击重试");
  assert.match(panels[0].textContent,new RegExp("更新于 "+date));
  assert.equal(panels[0].querySelectorAll("button.track").length,1);
  assert.equal(retry().disabled,true);await h.advance(59000);assert.equal(retry().disabled,true);
  await h.advance(1000);assert.equal(retry().disabled,false);
});
