const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../ui/main.js'), 'utf8');

function setup() {
  const classes = new Set();
  const timers = new Map();
  let id = 0;
  const notice = { textContent: '', dataset: {}, classList: {
    add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
  } };
  const events = [];
  const context = vm.createContext({
    playbackNotice: notice, playbackNoticeTimer: null, SKIP_NOTICE_DURATION_MS: 3200,
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
  return { context, notice, timers, events };
}

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
