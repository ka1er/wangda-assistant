import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const mod = await import('../src/playback-diagnostics.js').catch(() => ({}));

function setup(limit = 600) {
  const dom = new JSDOM('<body><video></video></body>', { url: 'https://wangda.chinamobile.com/#/study/course/detail/secret/6/secret', runScripts: 'outside-only' });
  const w = dom.window;
  let pauses = 0;
  w.HTMLMediaElement.prototype.pause = function (...args) { pauses++; if (args[0] === 'throw') throw new RangeError('native-pause-error'); this.pauseArgs = args; return 'native-result'; };
  class Socket extends w.EventTarget {
    static OPEN = 1;
    constructor(url, protocols) { super(); if (url === 'invalid') throw new TypeError('native-error'); this.url = url; this.protocols = protocols; }
    send() { assert.fail('诊断不能发送消息'); }
  }
  class Channel extends w.EventTarget {
    constructor(name) { super(); this.name = name; }
    close(...args) { if (args[0] === 'throw') throw new RangeError('native-close-error'); this.closeArgs = args; return 'close-result'; }
  }
  w.WebSocket = Socket; w.BroadcastChannel = Channel;
  assert.equal(typeof mod.createPlaybackDiagnostics, 'function', '诊断模块尚未实现');
  const diag = mod.createPlaybackDiagnostics(w, { limit });
  return { dom, w, diag, Socket, Channel, pauses: () => pauses, close() { diag.destroy(); w.close(); } };
}

test('仅解析固定平台代码，Socket.IO 保留事件名称边界', () => {
  assert.equal(typeof mod.parseStudyMessage, 'function', '消息解析器尚未实现');
  for (const type of [1002, 1003, 1004]) {
    assert.equal(mod.parseStudyMessage(JSON.stringify({ type, token: 'secret' })), null);
    assert.equal(mod.parseStudyMessage(`42["message",{"type":${type},"token":"secret"}]`), type);
    assert.equal(mod.parseStudyMessage(`42/study,["message",{"type":${type}}]`), type);
  }
  for (const input of ['42["other",{"type":1003}]', '{"type":"1003"}', '{"type":9999}', 'not json', '2', 'x'.repeat(20000), { type: 1003 }, null]) assert.equal(mod.parseStudyMessage(input), null);
});

test('广播通道关闭即释放监听，原始关闭返回值和异常透传', t => {
  const env = setup(); t.after(() => env.close()); const { w, diag } = env;
  const proto = w.BroadcastChannel.prototype;
  const originalAdd = proto.addEventListener, originalRemove = proto.removeEventListener, originalClose = proto.close;
  let added = 0, removed = 0;
  proto.addEventListener = function (type, ...args) { if (type === 'message') added++; return originalAdd.call(this, type, ...args); };
  proto.removeEventListener = function (type, ...args) { if (type === 'message') removed++; return originalRemove.call(this, type, ...args); };
  for (let i = 0; i < 100; i++) {
    const ch = new w.BroadcastChannel('wrapper-detail');
    assert.equal(ch.close('test'), 'close-result'); assert.deepEqual(ch.closeArgs, ['test']); assert.equal(ch.close, originalClose);
  }
  assert.equal(added, 100); assert.equal(removed, 100);
  const ch = new w.BroadcastChannel('wrapper-detail');
  assert.throws(() => ch.close('throw'), /native-close-error/u);
  diag.start(); ch.dispatchEvent(new w.MessageEvent('message', { data: { closeWrapperDetail: true } }));
  assert.ok(diag.exportData().events.some(e => e.kind === 'wrapper-close-notice'));
  ch.close(); assert.equal(added, removed); env.close();
});

test('构造器和暂停透传，仅观察学习连接，导出不带原始数据', t => {
  const env = setup(); t.after(() => env.close()); const { w, diag, Socket, Channel } = env;
  const socket = new w.WebSocket('wss://example.com/api/v1/ws/?token=SECRET', ['custom']);
  assert.ok(socket instanceof Socket); assert.ok(socket instanceof w.WebSocket); assert.equal(w.WebSocket.OPEN, 1); assert.deepEqual(socket.protocols, ['custom']);
  let delivered; socket.addEventListener('message', e => { delivered = e.data; });
  socket.dispatchEvent(new w.MessageEvent('message', { data: '{"type":1003}' }));
  assert.equal(diag.exportData().events.length, 0);
  diag.start();
  const payload = '42["message",{"type":1003,"token":"SECRET","courseName":"PRIVATE"}]';
  socket.dispatchEvent(new w.MessageEvent('message', { data: payload })); assert.equal(delivered, payload);
  const other = new w.WebSocket('wss://example.com/chat'); other.dispatchEvent(new w.MessageEvent('message', { data: payload }));
  const ch = new w.BroadcastChannel('wrapper-detail'); assert.ok(ch instanceof Channel);
  ch.dispatchEvent(new w.MessageEvent('message', { data: { closeWrapperDetail: true, courseId: 'PRIVATE' } }));
  const video = w.document.querySelector('video'); assert.equal(video.pause('a'), 'native-result'); assert.equal(env.pauses(), 1); assert.deepEqual(video.pauseArgs, ['a']);
  const data = diag.exportData(); assert.equal(data.events.filter(e => e.kind === 'study-notice').length, 1);
  assert.equal(data.events.find(e => e.kind === 'study-notice').code, 1003); assert.ok(data.events.some(e => e.kind === 'wrapper-close-notice')); assert.ok(data.events.some(e => e.kind === 'pause-call'));
  assert.doesNotMatch(JSON.stringify(data), /SECRET|PRIVATE|token|courseId|courseName|wss:|secret\/6/u);
  assert.throws(() => new w.WebSocket('invalid'), /native-error/u);
  assert.throws(() => video.pause('throw'), /native-pause-error/u);
  env.close(); assert.equal(w.WebSocket, Socket); assert.equal(w.BroadcastChannel, Channel);
});

test('动态媒体、课节计数、固定提示和停止边界', t => {
  const env = setup(); t.after(() => env.close()); const { w, diag } = env; diag.start(); diag.setRole('B');
  w.document.body.insertAdjacentHTML('beforeend', '<audio></audio><div class="chapter-list chapter-all"><ul><li><dl id="xshow-sectionsprivate"><dd><div class="item continue pointer"><span>已完成</span></div></dd></dl></li></ul></div><div role="alert">您已打开新的课程页面进行学习，旧页面将为您暂停播放 PRIVATE</div><iframe></iframe>');
  const audio = w.document.querySelector('audio'); audio.dispatchEvent(new w.Event('playing')); diag.sample();
  let data = diag.exportData(); assert.ok(data.events.some(e => e.kind === 'playing' && e.role === 'B'));
  const snapshot = data.events.findLast(e => e.kind === 'sample'); assert.equal(snapshot.sections.completed, 1); assert.equal(snapshot.iframeCount, 1); assert.equal(snapshot.media.length, 2);
  assert.ok(data.events.some(e => e.kind === 'page-notice' && e.code === 1003)); assert.doesNotMatch(JSON.stringify(data), /PRIVATE|private/u);
  diag.stop(); const count = diag.exportData().events.length; audio.dispatchEvent(new w.Event('pause')); diag.sample(); w.document.querySelector('video').pause(); assert.equal(diag.exportData().events.length, count);
  diag.setRole('bad input'); assert.equal(diag.exportData().role, 'B'); env.close();
});

test('有限内存、清空和原生异常不被诊断吞掉', t => {
  const env = setup(12); t.after(() => env.close()); const { w, diag } = env; diag.start();
  for (let i = 0; i < 30; i++) w.document.querySelector('video').dispatchEvent(new w.Event('pause'));
  assert.equal(diag.exportData().events.length, 12); assert.ok(diag.exportData().dropped > 0);
  diag.clear(); assert.equal(diag.exportData().events.length, 0); assert.equal(diag.exportData().dropped, 0);
  const copy = diag.exportData(); copy.events.push({ kind: 'private' }); assert.equal(diag.exportData().events.length, 0); env.close();
});

test('小面板开始停止和标记按钮连通', t => {
  const env = setup(); t.after(() => env.close()); const { w, diag } = env;
  assert.equal(typeof mod.mountPlaybackDiagnostics, 'function', '诊断面板尚未实现');
  const panel = mod.mountPlaybackDiagnostics(w, diag, '0.1.0-test.1');
  const root = w.document.getElementById('wangda-playback-diagnostics').shadowRoot;
  root.querySelector('[data-action="start"]').click(); assert.equal(diag.isRecording(), true);
  const role = root.querySelector('select'); role.value = 'B'; role.dispatchEvent(new w.Event('change')); assert.equal(diag.exportData().role, 'B');
  root.querySelector('[data-action="mark"]').click(); assert.ok(diag.exportData().events.some(e => e.kind === 'manual-mark'));
  root.querySelector('[data-action="stop"]').click(); assert.equal(diag.isRecording(), false);
  assert.ok(root.textContent.includes('0.1.0-test.1')); panel.destroy(); assert.equal(w.document.getElementById('wangda-playback-diagnostics'), null); env.close();
});
