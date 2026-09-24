const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../ui/main.js'), 'utf8');

function setup() {
  const classes = new Set();
  const timers = new Map();
  const styles = new Map();
  let id = 0;
  const notice = { textContent: '', dataset: {}, style: { setProperty: (key, value) => styles.set(key, value) }, classList: {
    add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
  } };
  const events = [];
  const context = vm.createContext({
    playbackNotice: notice, playbackNoticeTimer: null, SKIP_NOTICE_DURATION_MS: 3200,
    resumePlayPauseButton: { getBoundingClientRect: () => ({ left: 970, width: 60 }) },
    result: {}, ResizeObserver: class { observe() {} },
    Event, clearTimeout: id => timers.delete(id),
    window: { dispatchEvent: e => events.push(e.type), setTimeout: (fn, delay) => {
      timers.set(++id, { fn, delay }); return id;
    } },
    playerState: { currentIndex: 0, queue: [{}], history: [], shuffle: false, loopMode: 'sequence' },
    status: { textContent: '在线播放中。' },
    takeSequentialNext: () => null, takeRandomNext: () => null,
    playQueueIndex: () => { throw Error('unexpected navigation'); },
  });
  vm.runInContext(source.slice(source.indexOf('function clearPlaybackNotice()'), source.indexOf('function shuffled(')), context);
  vm.runInContext(source.slice(source.indexOf('function playNext('), source.indexOf('function recordSearchHistoryFireAndForget(')), context);
  return { context, notice, timers, events, styles };
}

test('notice follows the play button center', () => {
  const { context: c, styles } = setup();
  assert.equal(styles.get('--playback-notice-x'), '1000px');
  c.resumePlayPauseButton.getBoundingClientRect = () => ({ left: 1120, width: 42 });
  c.showPlaybackNotice('已经是第一首了', { kind: 'info' });
  assert.equal(styles.get('--playback-notice-x'), '1141px');
});

test('manual boundaries explain failure without overwriting playback status', () => {
  const { context: c, notice } = setup();
  c.playPrevious(); assert.equal(notice.textContent, '已经是第一首了');
  c.playNext(); assert.equal(notice.textContent, '已经是最后一首了');
  assert.equal(c.status.textContent, '在线播放中。');
  c.playerState.currentIndex = -1;
  c.playNext(); assert.equal(notice.textContent, '暂无可播放的歌曲');
  c.playPrevious(); assert.equal(notice.textContent, '暂无可播放的歌曲');
});

test('automatic end is silent; random history has accurate wording', () => {
  const { context: c, notice } = setup();
  c.playNext({ automatic: true }); assert.equal(notice.textContent, '');
  c.playerState.shuffle = true;
  c.playPrevious(); assert.equal(notice.textContent, '暂无上一首播放记录');
  c.playNext(); assert.equal(notice.textContent, '本轮随机播放已结束');
});

test('repeated feedback refreshes one timer; errors take priority and expiration clears content', () => {
  const { context: c, notice, timers } = setup();
  c.playPrevious(); c.playPrevious();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 2000);
  [...timers.values()][0].fn(); assert.equal(notice.textContent, '');
  c.showPlaybackNotice('解析失败', { persistent: true });
  c.playNext(); assert.equal(notice.textContent, '解析失败');
  assert.equal(timers.size, 0);
});

test('list loop and history navigate without boundary notices', () => {
  const { context: c, notice } = setup();
  const visited = [];
  c.playQueueIndex = index => visited.push(index);
  c.playerState.loopMode = 'list';
  c.takeSequentialNext = () => 0;
  c.playNext(); c.playPrevious();
  c.playerState.history = [2]; c.playPrevious();
  assert.deepEqual(visited, [0, 0, 2]);
  assert.equal(notice.textContent, '');
});

test('notice removal notifies the mini window on both natural expiry and explicit clear', () => {
  const { context: c, events, timers } = setup();
  // 自然到期：先清空事件记录，再精确断言恰好多一条通知事件
  c.playPrevious();
  events.length = 0;
  [...timers.values()][0].fn();
  assert.deepEqual(events, ['bilibili-music-notice-change']);
  // 主动清除：persistent 错误被显式清除时同样必须通知
  c.showPlaybackNotice('解析失败', { persistent: true });
  events.length = 0;
  c.clearPlaybackNotice();
  assert.deepEqual(events, ['bilibili-music-notice-change']);
});

test('automatic next stays silent on an empty queue', () => {
  const { context: c, notice, timers, events } = setup();
  // 场景 A：严格空队列（无当前歌曲且队列为空）
  c.playerState.currentIndex = -1;
  c.playerState.queue = [];
  events.length = 0;
  c.playNext({ automatic: true });
  assert.equal(notice.textContent, '');
  assert.equal(notice.classList.contains('is-visible'), false);
  assert.equal(timers.size, 0);
  assert.deepEqual(events, []);
  // 场景 B：队列有歌但无当前歌曲（currentIndex = -1），分支相同，一并覆盖
  c.playerState.queue = [{}];
  c.playNext({ automatic: true });
  assert.equal(notice.textContent, '');
  assert.equal(timers.size, 0);
  assert.deepEqual(events, []);
  // 对照组：同样条件下手动调用必须弹提示，确保上面的静默断言不是空转
  c.playNext();
  assert.equal(notice.textContent, '暂无可播放的歌曲');
});

test('manual boundary preserves pending resume; successful page change clears stale feedback', () => {
  const { context: c, notice } = setup();
  const handlers = {};
  let pendingResume = { positionSeconds: 42 };
  c.clearPendingResume = () => { pendingResume = null; };
  c.previousButton = { addEventListener: (_, fn) => { handlers.previous = fn; } };
  c.nextButton = { addEventListener: (_, fn) => { handlers.next = fn; } };
  c.retreatPageWithinCurrentBv = () => false;
  c.advancePageWithinCurrentBv = () => false;
  vm.runInContext(source.slice(source.indexOf('previousButton.addEventListener("click"'),
    source.indexOf('resumePlayPauseButton?.addEventListener("click"')), c);
  handlers.previous(); handlers.next();
  assert.deepEqual(pendingResume, { positionSeconds: 42 });
  c.advancePageWithinCurrentBv = () => true;
  handlers.next();
  assert.equal(pendingResume, null);
  assert.equal(notice.textContent, '');
  c.showPlaybackNotice('已经是最后一首了', { kind: 'info' });
  c.retreatPageWithinCurrentBv = () => true;
  handlers.previous();
  assert.equal(notice.textContent, '');
});

test('real sequential, random and page selectors preserve navigation semantics', () => {
  const { context: c, notice } = setup();
  const visits = [];
  c.playQueueIndex = index => visits.push(index);
  c.resetRandomRemaining = () => { c.playerState.randomRemaining = []; };
  vm.runInContext(source.slice(source.indexOf('function takeRandomNext()'),
    source.indexOf('function playNext(')), c);
  c.playerState.queue = [{}, {}];
  c.playNext(); assert.deepEqual(visits, [1]);
  c.playerState.currentIndex = 1;
  c.playNext(); assert.equal(notice.textContent, '已经是最后一首了');
  c.clearPlaybackNotice(); c.playerState.loopMode = 'list';
  c.playNext(); assert.equal(visits.at(-1), 0);
  c.playerState.shuffle = true; c.playerState.randomRemaining = [0];
  c.playNext(); assert.equal(visits.at(-1), 0);
  c.playerState.loopMode = 'sequence';
  c.playNext(); assert.equal(notice.textContent, '本轮随机播放已结束');
  c.hasMultipleCurrentPages = () => true;
  c.playerState.currentPages = [{}, {}]; c.playerState.currentPageIndex = 0;
  c.updatePlayerPagesButton = () => {};
  let loads = 0;
  c.loadCurrentTrack = () => { loads++; };
  assert.equal(c.retreatPageWithinCurrentBv(), false);
  assert.equal(c.advancePageWithinCurrentBv(), true);
  assert.equal(c.advancePageWithinCurrentBv(), false);
  assert.equal(c.retreatPageWithinCurrentBv(), true);
  assert.equal(loads, 2);
});
