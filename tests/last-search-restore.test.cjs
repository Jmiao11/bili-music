const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/main.js"), "utf8");

// 切片：关键词持久化助手 + 恢复搜索状态与提示（runSearch + currentSearchRequest）。
const helpers = source.slice(
  source.indexOf("const LAST_SEARCH_KEY"),
  source.indexOf("const homeState"),
);
const requestFns = source.slice(
  source.indexOf("function currentSearchRequest("),
  source.indexOf("async function runSearch("),
);
const runSearchFn = source.slice(
  source.indexOf("async function runSearch("),
  source.indexOf("searchForm.addEventListener("),
);
assert.ok(helpers.includes("function saveLastSearchKeyword"));
assert.ok(runSearchFn.includes("restored"));

function setup({ keyword = "", results = [] } = {}) {
  const storage = new Map();
  if (keyword) {
    storage.set("bilibili-music.last-search", keyword);
  }
  const context = vm.createContext({
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    SEARCH_PAGE_SIZE: 20,
    MUSIC_HOT_KEYWORD: "音乐",
    searchKeyword: { value: keyword },
    searchButton: { disabled: false },
    searchStatus: { textContent: "" },
    result: { hidden: true },
    searchState: {
      results,
      userKeyword: "",
      requestKeyword: "",
      tids: 3,
      order: null,
      rerank: true,
      sortMode: "all",
      page: 0,
      isLoadingMore: false,
      hasMore: false,
      requestVersion: 0,
    },
    recordSearchHistoryFireAndForget() {},
    setSearchResults(videos) {
      context.searchState.results = videos;
    },
    updateQueueUi() {},
    invoke: async () => {
      throw new Error("unexpected invoke");
    },
    console: { warn() {} },
  });
  vm.runInContext(
    helpers + "\n" + requestFns + "\n" + runSearchFn + "\nglobalThis.__api = { runSearch, readLastSearchKeyword, saveLastSearchKeyword };",
    context,
  );
  return { context, storage };
}

test("restored search announces the reused keyword while loading and after success", async () => {
  const { context, storage } = setup({ keyword: "周杰伦" });
  let calls = 0;
  context.__api.runSearch;
  const ctx = context;
  ctx.invoke = async (command, payload) => {
    calls += 1;
    assert.equal(command, "search_videos");
    assert.equal(payload.keyword, "周杰伦");
    return [{ bvid: "BV0000000001" }, { bvid: "BV0000000002" }];
  };
  const p = ctx.__api.runSearch({ userKeyword: "周杰伦", restored: true });
  assert.match(ctx.searchStatus.textContent, /已复用上次搜索关键词「周杰伦」，正在搜索…/);
  await p;
  assert.match(ctx.searchStatus.textContent, /已复用上次搜索关键词「周杰伦」刷新完成，找到 2 个普通视频/);
  assert.equal(calls, 1);
  assert.equal(storage.get("bilibili-music.last-search"), "周杰伦");
});

test("restored search failure keeps the reuse notice in the error message", async () => {
  const { context } = setup();
  context.invoke = async () => Promise.reject("网络中断");
  await context.__api.runSearch({ userKeyword: "洛天依", restored: true });
  assert.match(context.searchStatus.textContent, /复用上次搜索关键词「洛天依」搜索失败：网络中断/);
});

test("successful keyword search persists the keyword; empty tab search does not", async () => {
  const { context, storage } = setup();
  context.invoke = async () => [{ bvid: "BV0000000001" }];
  await context.__api.runSearch({ userKeyword: "林俊杰" });
  assert.equal(storage.get("bilibili-music.last-search"), "林俊杰");

  // 无关键词的分区热门不覆盖已存关键词。
  context.invoke = async () => [{ bvid: "BV0000000002" }];
  await context.__api.runSearch({ userKeyword: "" });
  assert.equal(storage.get("bilibili-music.last-search"), "林俊杰");
});

test("failed keyword search does not persist the keyword", async () => {
  const { context, storage } = setup();
  context.invoke = async () => {
    throw new Error("超时");
  };
  await context.__api.runSearch({ userKeyword: "坏关键词" });
  assert.ok(!storage.has("bilibili-music.last-search"));
});

test("corrupted or oversized stored keyword is clamped by readLastSearchKeyword", () => {
  const { context } = setup({ keyword: "   ".padEnd(120, "a") });
  const value = context.__api.readLastSearchKeyword();
  assert.ok(value.length <= 100);
  assert.equal(value, value.trim());
});
