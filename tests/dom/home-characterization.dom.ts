import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture as realFixture, deferred, responses, videoMeta } from "./tracks-fixture.ts";
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
    h.store.actions.openHomeSection("ranking");
    const list = h.doc.querySelector("#home-ranking-list")!;
    const status = h.doc.querySelector("#home-ranking-status")!;
    assert.equal(list.children.length, 1);
    const requests = h.calls.length;
    await h.module.loadHomeRanking();
    assert.equal(h.calls.length, requests);
    const next = deferred(); h.setResponse(() => next.promise);
    await h.advance(60000);
    const pending = h.module.loadHomeRanking({ forceRefresh: true });
    assert.deepEqual(h.calls.slice(-3).map(call=>[call.command,call.args.source,call.args.mode]), [["get_music_ranking","ranking","refresh"],["get_music_ranking","newSongs","refresh"],["get_music_ranking","forYou","refresh"]]);
    assert.equal(h.nodes.refreshRankingButton.disabled, true);
    assert.equal(status.textContent, "正在刷新音乐热门…");
    assert.equal(list.children.length, 1);
    assert.ok(list.querySelector("button.track"));
    next.resolve([]); await pending;
    assert.equal(h.nodes.refreshRankingButton.disabled, true);
    assert.equal(h.nodes.refreshRankingButton.title,"刚刚更新，请稍后再试");
    assert.equal(list.children.length, 0);
    assert.equal(status.textContent, "已加载 0 首音乐区热门视频。");
    await h.advance(59000); assert.equal(h.nodes.refreshRankingButton.disabled,true);
    await h.advance(1000); assert.equal(h.nodes.refreshRankingButton.disabled,false);
    h.setResponse(async () => [track]); await h.module.loadHomeRanking();
    assert.equal(h.calls.length, requests + 5, "empty ranking is not a cache hit");
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
    assert.deepEqual(h.calls.map(call => call.command), ["get_ai_config", "get_music_ranking", "get_music_ranking", "get_music_ranking"]);
    assert.equal(h.nodes.homeTitle.textContent, "发现音乐");
    assert.equal(h.nodes.homePanel?.getAttribute("data-home-mode"), "popular");
    assert.equal(h.nodes.homeHintRow.hidden, true);
    assert.equal(h.doc.querySelector(".home-discovery-setup")?.textContent, "配置 API Key 后，这里还会出现 AI 生成的专属推荐 · 去设置");
    assert.equal(h.doc.querySelector(".home-discovery")?.lastElementChild?.classList.contains("home-discovery-setup"), true);
    const stamp=h.store.getState().home.feed.ranking.timestamp;
    await h.advance(60000);
    h.setResponse(async () => { throw new Error("ranking failed"); });
    await h.module.loadHomeRanking({ forceRefresh: true });
    h.store.actions.openHomeSection("ranking");
    const retry=h.doc.querySelector<HTMLButtonElement>(".home-feed-feedback button")!;
    assert.equal(retry.textContent,"更新失败，点击重试");
    assert.equal(retry.disabled,false);
    assert.equal(h.store.getState().home.feed.ranking.timestamp,stamp);
    assert.equal(h.doc.querySelector("#home-ranking-list .track-title")?.textContent,track.title);
    assert.equal(h.doc.querySelector("#home-ranking-status")?.textContent, "");
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
    assert.equal(h.nodes.homeTitle.textContent, "为你推荐");
    assert.equal(h.doc.querySelector(".home-discovery"), null);
    assert.equal(h.doc.querySelector(".home-feed-detail"), null);
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
    const list = h.doc.querySelector("#home-ranking-list")!;
    assert.equal(list.children.length, 1);
    const row = list.children[0];
    ranking.resolve([]); await pendingRanking;
    assert.equal(list.children[0], row);
    assert.equal(h.doc.querySelector("#home-ranking-status")?.textContent, "已加载 0 首音乐区热门视频。", "shared status retains the existing completion order");
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
    h.store.actions.openHomeSection("ranking");
    const row = h.doc.querySelector<HomeRow>("#home-ranking-list .track-row")!;
    row.activate?.(0, { startPage: { cid: 1 } });
    assert.equal(h.played[0][0], "ranking");
    assert.equal(h.played[0][2], 0);
    assert.deepEqual(h.played[0][3], { startPage: { cid: 1 } });
    assert.equal(JSON.stringify(h.states.searchState), before);
    assert.equal(h.states.playerState.queue.length, 0, "rendering does not start playback");
    hasKey = true;
    await h.module.refreshAiKeyState();
    const recommendation = h.doc.querySelector("#home-ranking-list") as typeof h.nodes.homeRankingList;
    recommendation.children[0].activate?.(0);
    assert.equal(h.played[1][0], "recommendation");
    h.states.searchState.requestVersion++;
    const calls = h.calls.length;
    await h.module.loadRecommendationHome();
    assert.equal(h.calls.length, calls);
    assert.equal(recommendation.children.length, 1);
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
  const h = await realFixture({ playback: true }); t.after(h.dispose);
  const thumbnail = "https://i0.hdslb.com/bfs/archive/synthetic.jpg";
  const ranking=Array.from({length:12},(_,i)=>({...track,bvid:"BV"+String(i).padStart(10,"0"),thumbnailUrl:i===0 ? thumbnail : ""}));
  const newSongs=Array.from({length:8},(_,i)=>({...track,bvid:"BV"+String(i+20).padStart(10,"0"),durationSeconds:0,playCount:null}));
  const now=h.clock();
  const old=new Date(now); old.setDate(old.getDate()-3);
  const oldDay=`${old.getFullYear()}-${String(old.getMonth()+1).padStart(2,"0")}-${String(old.getDate()).padStart(2,"0")}`;
  h.reply(async (cmd,args)=>{
    if(cmd==="get_ai_config") return {hasKey:false};
    if(cmd==="get_music_ranking") return {section:args.source==="ranking" ? {items:ranking,date:args.today,fetchedAt:now} : {items:newSongs,date:oldDay,fetchedAt:old.getTime()},newSongs,sequence:1,requestAt:now,error:null,restricted:false};
    if(cmd==="prepare_audio") return {audioUrl:"http://127.0.0.1/audio/fixture",title:"合成歌曲",durationSeconds:60};
    return null;
  });
  await h.home.refreshAiKeyState();
  const currentLabel = () => h.doc.querySelector(".home-feed-detail .home-feed-copy p:nth-of-type(2)")?.textContent;
  const date = new Date(now);
  assert.equal(h.doc.querySelector(".home-subtitle")?.textContent,`${date.getMonth()+1} 月 ${date.getDate()} 日 · 每天自动更新`);
  assert.equal(h.doc.querySelectorAll(".home-feed-card").length,2);
  assert.equal(h.doc.querySelector("#home-ranking-list, #home-new-songs"),null);
  assert.match(h.doc.querySelector('[data-feed="ranking"] .home-feed-label')?.textContent ?? "",/12 首 · 更新于 \d\d:\d\d/);
  const cardThumbnail = h.doc.querySelector('[data-feed="ranking"] img')?.getAttribute("src");
  assert.equal(cardThumbnail,thumbnail+"@64w_64h_1c.webp");
  const oldLabel = `8 首 · 更新于 ${old.getMonth()+1} 月 ${old.getDate()} 日 ${old.toTimeString().slice(0,5)}`;
  assert.equal(h.doc.querySelector('[data-feed="newSongs"] .home-feed-label span')?.textContent,oldLabel);
  for(const [id,source,items,otherId,otherSource] of [["#home-ranking-list","ranking",ranking,"#home-new-songs","newSongs"],["#home-new-songs","newSongs",newSongs,"#home-ranking-list","ranking"]] as const) {
    const before = h.store.getState().playbackQueue;
    await h.fire(h.doc.querySelector(`[data-feed="${source}"] .home-feed-open`)!, "click", { detail: 0 });
    assert.equal(h.store.getState().playbackQueue,before);
    assert.equal(h.doc.activeElement?.textContent,"‹ 发现音乐");
    const list=h.doc.querySelector<HTMLUListElement>(id)!;
    assert.equal(list.children.length, items.length);
    if (source === "ranking") assert.equal(list.querySelector("img")?.getAttribute("src"),cardThumbnail);
    if (source === "newSongs") {
      assert.equal(currentLabel(), oldLabel);
      assert.equal(list.querySelector(".track-duration")?.textContent,"—");
      assert.equal(list.querySelector(".track-play")?.textContent,"—");
      assert.equal(list.parentElement?.classList.contains("home-feed-no-pages"),true);
      h.store.actions.pages.remember(items[0].bvid,videoMeta);
      assert.equal(list.parentElement?.classList.contains("home-feed-no-pages"),false);
      assert.equal(list.querySelector(".page-count-badge")?.textContent,"2P");
    }
    await h.fire(list.children[2].querySelector("button.track")!,"click",{detail:0});
    assert.equal(h.store.getState().playbackQueue.queueSource,source);
    assert.deepEqual(h.store.getState().playbackQueue.queue.map(row=>row.bvid),items.map(row=>row.bvid));
    assert.equal(list.children[2].querySelector("button.track")?.getAttribute("aria-current"),"true");
    await h.fire(h.doc.querySelector(source === "ranking" ? ".home-feed-back" : '#sidebar [data-view="home"]')!, "click", { detail: 0 });
    assert.equal(h.doc.querySelector(".home-feed-detail"),null);
    assert.equal(h.doc.querySelectorAll(".home-feed-card").length,2);
    await h.fire(h.doc.querySelector(`[data-feed="${otherSource}"] .home-feed-open`)!, "click", { detail: 0 });
    const other=h.doc.querySelector<HTMLUListElement>(otherId)!;
    assert.equal(other.querySelectorAll('[aria-current="true"]').length,0);
    await h.fire(h.doc.querySelector(".home-feed-back")!, "click", { detail: 0 });
  }
});
test("empty, stale automatic and manual failures use independent retry controls", async t => {
  const h=await realFixture(); t.after(h.dispose);
  const stamp=new Date(h.clock()); stamp.setDate(stamp.getDate()-1);
  const old=stamp.getTime(), label="昨天 "+stamp.toTimeString().slice(0,5);
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
  const card = (source: string) => h.doc.querySelector<HTMLElement>(`.home-feed-card[data-feed="${source}"]`)!;
  assert.match(card("ranking").textContent,new RegExp("更新于 "+label));
  assert.doesNotMatch(card("ranking").textContent,/更新失败|拉取失败/);
  assert.equal(card("newSongs").querySelector(".home-feed-label span")?.textContent,"暂无内容 · 点击查看");
  await h.fire(card("ranking").querySelector("button")!, "click");
  assert.equal(h.doc.querySelector(".home-feed-feedback button"),null);
  await h.fire(h.doc.querySelector(".home-feed-back")!, "click");
  await h.fire(card("newSongs").querySelector("button")!, "click");
  const retry=()=>h.doc.querySelector<HTMLButtonElement>(".home-feed-feedback button")!;
  assert.equal(retry().textContent,"拉取失败，点击重试");assert.equal(retry().disabled,false);
  hold=true;const pending=h.store.actions.retryHomeSection("newSongs");
  const n=h.calls.length;await h.store.actions.retryHomeSection("newSongs");assert.equal(h.calls.length,n);
  wait.resolve(null);await pending;
  await h.advance(60000);risk=true;
  await h.home.loadHomeRanking({forceRefresh:true});
  assert.equal(retry().disabled,true);await h.advance(59000);assert.equal(retry().disabled,true);
  await h.advance(1000);assert.equal(retry().disabled,false);
  await h.fire(h.doc.querySelector(".home-feed-back")!, "click");
  assert.equal(card("ranking").querySelector(".home-feed-label span")?.textContent,"更新失败 · 更新于 "+label);
  await h.fire(card("ranking").querySelector("button")!, "click");
  assert.equal(retry().disabled,false);
  assert.equal(retry().textContent,"更新失败，点击重试");
  assert.match(h.doc.querySelector(".home-feed-head")!.textContent,new RegExp("更新于 "+label));
  assert.equal(h.doc.querySelectorAll(".home-feed-detail button.track").length,1);
  const refresh=h.doc.querySelector<HTMLButtonElement>(".home-feed-actions .secondary-button")!;
  const requestStart=h.calls.length;
  await h.fire(refresh, "click");
  assert.deepEqual(h.calls.slice(requestStart).filter(call=>call.command==="get_music_ranking").map(call=>[call.args.source,call.args.mode]),[["ranking","retry"]]);
  assert.equal(refresh.disabled,true);
  await h.advance(59000);assert.equal(refresh.disabled,true);
  await h.advance(1000);assert.equal(refresh.disabled,false);
});

test("discovery card play starts the first track without opening the list", async t => {
  const h = await realFixture(); t.after(h.dispose);
  const base = responses([track, { ...track, bvid: "BV1234567891" }]);
  h.reply(async cmd => cmd === "get_ai_config" ? { hasKey: false } : cmd === "get_play_history" ? [] : base(cmd));
  await h.home.refreshAiKeyState();
  const open = h.doc.querySelector<HTMLButtonElement>('[aria-label="打开音乐热门"]')!;
  const play = h.doc.querySelector<HTMLButtonElement>('[aria-label="播放音乐热门"]')!;
  assert.equal(open.parentElement,play.parentElement);
  open.focus(); assert.equal(h.doc.activeElement,open);
  play.focus(); assert.equal(h.doc.activeElement,play);
  await h.fire(play.querySelector("svg")!, "click", { detail: 1 });
  assert.equal(h.doc.querySelector(".home-feed-detail"),null,"点击播放键不进入列表页");
  assert.equal(h.store.getState().playbackQueue.queueSource,"ranking");
  assert.equal(h.store.getState().playbackQueue.currentIndex,0);
  assert.deepEqual(h.store.getState().playbackQueue.queue.map(row=>row.bvid),["BV1234567890","BV1234567891"]);
  await h.fire(open,"click",{detail:0});
  const rows = h.doc.querySelectorAll("#home-ranking-list .track");
  await h.fire(rows[1],"click",{detail:0});
  assert.equal(h.store.getState().playbackQueue.currentIndex,1);
  await h.fire(h.doc.querySelector(".home-feed-actions .primary-cta")!,"click");
  assert.equal(h.store.getState().playbackQueue.currentIndex,0);
  assert.equal(rows[0].getAttribute("aria-current"),"true");
});

test("legacy listening records show For You first and use an independent twenty-track queue", async t => {
  const h = await realFixture(); t.after(h.dispose);
  const items = Array.from({length:20}, (_, i) => ({ ...track, bvid: "BV" + String(i + 100).padStart(10,"0"), title: `合成推荐 ${i}` }));
  const history = [101, 102].map(i => ({ ...track, bvid: "BV" + String(i + 200).padStart(10,"0"), title: `合成种子 ${i}`, lastPlayedAt: String(h.clock() - i), count: 1, lastPage: 1 }));
  const seeds = history.map(({bvid,title}) => ({bvid,title}));
  const newSongs = [items[1]];
  let key = false, sequence = 0;
  h.reply(async (command,args) => {
    if (command === "get_ai_config") return {hasKey:key};
    if (command === "get_play_history") return history;
    if (command === "get_music_ranking") {
      const forYou = args.source === "forYou";
      return { section: {date:args.today,fetchedAt:h.clock(),items:forYou ? items : newSongs, ...(forYou ? {seeds} : {})}, newSongs, sequence:++sequence, requestAt:h.clock(), error:null, restricted:false, available:forYou };
    }
    if (command === "get_cached_video_pages") return {};
    return responses(newSongs)(command);
  });
  await h.home.refreshAiKeyState();
  assert.deepEqual([...h.doc.querySelectorAll(".home-feed-card")].map(card=>card.getAttribute("data-feed")), ["forYou","ranking","newSongs"]);
  assert.equal(h.doc.querySelector('[data-feed="forYou"] .home-feed-badge')?.textContent,"根据你的收听");
  assert.match(h.doc.querySelector('[data-feed="forYou"] .home-feed-label > span')?.textContent ?? "", /^20 首 · 更新于 \d\d:\d\d$/);
  const open = async (name: string) => { await h.fire(h.doc.querySelector(`[data-feed="${name}"] .home-feed-open`)!, "click", {detail:0}); };
  const back = async () => { await h.fire(h.doc.querySelector(".home-feed-back")!, "click"); };
  await open("forYou");
  const title = h.doc.querySelector(".home-feed-seeds")!;
  assert.equal(title.textContent, "根据《合成种子 101》《合成种子 102》推荐");
  assert.equal(title.getAttribute("title"), title.textContent);
  assert.equal(h.doc.querySelector(".home-feed-copy > p")?.textContent,"栏目 · 根据你最近的收听");
  const rows = h.doc.querySelectorAll("#home-for-you button.track");
  assert.equal(rows.length,20);
  await h.fire(rows[1],"click",{detail:0});
  assert.equal(h.store.getState().playbackQueue.queueSource,"forYou");
  assert.deepEqual(h.store.getState().playbackQueue.queue.map(row=>row.bvid),items.map(row=>row.bvid));
  assert.equal(rows[1].getAttribute("aria-current"),"true");
  for (const source of ["ranking","newSongs"]) {
    await back(); await open(source);
    assert.equal(h.doc.querySelector(".home-feed-detail button.track[aria-current=true]"),null);
  }
  await back(); await open("forYou");
  assert.equal(h.doc.querySelectorAll("#home-for-you button.track")[1].getAttribute("aria-current"),"true");
  const at = h.calls.length;
  await h.home.loadHomeRanking();
  assert.equal(h.calls.length, at, "当天收听记录变化无需自动拉取");
  key = true;
  await h.home.refreshAiKeyState();
  assert.equal(h.doc.querySelector(".home-discovery, #home-for-you"),null);
  assert.equal(h.nodes.homeTitle.textContent,"为你推荐");
  assert.deepEqual(h.calls.slice(at).map(call=>call.command),["get_ai_config","get_saved_recommendations"]);
});

test("For You failure hints preserve stale tracks and share the request-based cooldown", async t => {
  const h = await realFixture(); t.after(h.dispose);
  const yesterday = new Date(h.clock()); yesterday.setDate(yesterday.getDate() - 1);
  const old = yesterday.getTime();
  const oldDate = [yesterday.getFullYear(),String(yesterday.getMonth()+1).padStart(2,"0"),String(yesterday.getDate()).padStart(2,"0")].join("-");
  const seeds = [{ bvid:"BV0000000001", title:"合成种子" }];
  let sequence = 0, available = false, stale = false, error = "更新失败", risk = false;
  let delay: ReturnType<typeof deferred> | null = null;
  h.reply(async (command,args) => {
    if(command === "get_ai_config") return {hasKey:false};
    if(command !== "get_music_ranking") return null;
    const issued = h.clock();
    if(args.source !== "forYou") return {section:{date:args.today,fetchedAt:issued,items:[track]},newSongs:[track],sequence:++sequence,requestAt:issued,error:null,restricted:false};
    if(delay) await delay.promise;
    return {
      section:{date:stale ? oldDate : "",fetchedAt:stale ? old : 0,items:stale ? [track] : [],seeds:stale ? seeds : []},
      newSongs:[track],sequence:++sequence,requestAt:available ? issued : null,error:available ? error || null : null,restricted:risk,available,
    };
  });
  await h.home.refreshAiKeyState();
  assert.deepEqual([...h.doc.querySelectorAll(".home-feed-card")].map(card=>card.getAttribute("data-feed")), ["ranking","newSongs"]);
  available = true;
  await h.home.loadHomeRanking();
  await h.fire(h.doc.querySelector('[data-feed="forYou"] .home-feed-open')!,"click");
  const retry = () => h.doc.querySelector<HTMLButtonElement>(".home-feed-feedback button");
  const refresh = () => h.doc.querySelector<HTMLButtonElement>(".home-feed-actions .secondary-button")!;
  assert.equal(retry()?.textContent,"拉取失败，点击重试");
  assert.equal(retry()?.disabled,false);
  stale = true;
  error = "";
  await h.fire(retry()!,"click");
  const label = () => h.doc.querySelector(".home-feed-copy > p:nth-of-type(2)")?.textContent;
  const timestamp = label();
  assert.match(timestamp ?? "", /更新于 昨天 \d\d:\d\d/);
  error = "更新失败";
  await h.home.loadHomeRanking();
  assert.equal(retry(),null);
  assert.equal(label(),timestamp);
  assert.equal(h.doc.querySelector("#home-for-you .track-title")?.textContent,track.title);
  await h.advance(60000);
  const at = h.calls.length;
  delay = deferred();
  await h.fire(refresh(),"click");
  assert.equal(refresh().disabled,true);
  assert.deepEqual(h.calls.slice(at).filter(call=>call.command==="get_music_ranking").map(call=>[call.args.source,call.args.mode]),[["forYou","retry"]]);
  await h.advance(20000);
  const request = delay; delay = null; request.resolve(null);
  await h.microtasks();
  assert.equal(retry()?.textContent,"更新失败，点击重试");
  assert.equal(retry()?.disabled,false);
  assert.equal(label(),timestamp);
  assert.equal(h.doc.querySelector("#home-for-you .track-title")?.textContent,track.title);
  await h.advance(39000);
  assert.equal(refresh().disabled,true);
  await h.advance(1000);
  assert.equal(refresh().disabled,false);
  risk = true;
  await h.fire(refresh(),"click");
  assert.equal(retry()?.disabled,true);
  await h.advance(59000); assert.equal(retry()?.disabled,true);
  await h.advance(1000); assert.equal(retry()?.disabled,false);
});

test("discovery recent preview hides when empty and plays through the full history queue", async t => {
  const h = await realFixture({ playback:true }); t.after(h.dispose);
  const history=Array.from({length:12},(_,i)=>({...track,bvid:"BV"+String(i+40).padStart(10,"0"),title:`历史 ${i}`,lastPlayedAt:String(h.clock()-i*10000),count:1,lastCid:22,lastPage:2,lastPartName:"二"}));
  let items: typeof history = [];
  const base = responses();
  h.reply(async cmd => cmd === "get_ai_config" ? { hasKey:false } : cmd === "get_play_history" ? items : cmd === "check_audio_cache" ? [] : base(cmd));
  await h.home.refreshAiKeyState();
  assert.equal(h.doc.querySelector(".home-recent"),null);
  items=history;
  await h.fire(h.doc.querySelector(".home-feed-open")!,"click");
  await h.fire(h.doc.querySelector(".home-feed-back")!,"click");
  const recent = h.doc.querySelector(".home-recent")!;
  assert.equal(recent.querySelector("h2")?.textContent,"最近播放");
  assert.equal(recent.querySelectorAll(".home-recent-item").length,10);
  const preview=recent.querySelectorAll(".home-recent-item")[1];
  assert.equal(preview.querySelector(".recent-play-hint")?.getAttribute("aria-hidden"), "true");
  assert.equal(preview.querySelector(".home-recent-track")?.textContent,"历史 1");
  assert.equal(preview.querySelector(".home-recent-uploader")?.textContent,"作者");
  await h.fire(preview,"click");
  assert.equal(h.store.getState().playbackQueue.queueSource,"recent");
  assert.equal(h.store.getState().playbackQueue.currentIndex,1);
  assert.deepEqual(h.store.getState().playbackQueue.queue.map(row=>row.bvid),history.map(row=>row.bvid));
  assert.equal(h.calls.filter(call=>call.command==="prepare_audio").at(-1)?.args.cacheCid,22);
  await h.fire(recent.querySelector(".home-text-button")!,"click");
  assert.equal(h.doc.querySelector<HTMLElement>("#view-recent")?.hidden,false);
  assert.equal(h.doc.querySelectorAll("#recent-list .track").length,12);
});
