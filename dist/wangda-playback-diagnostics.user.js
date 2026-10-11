// ==UserScript==
// @name         网大播放暂停诊断
// @namespace    wangda-assistant-playback-diagnostics
// @version      0.1.0-test.1
// @description  手动复现两门课程冲突，记录暂停和平台通知的时间线
// @match        https://wangda.chinamobile.com/*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==

(function () {
'use strict';
const wdDiagnosticCodes = new Set([1002, 1003, 1004]);
const wdDiagnosticNames = {
  1002: '多客户端学习通知', 1003: '打开新课程通知', 1004: '观看人数上限通知',
  start: '开始记录', stop: '停止记录', sample: '播放状态', 'pause-call': '调用暂停',
  play: '开始播放', playing: '正在播放', pause: '暂停事件', ended: '播放结束',
  waiting: '等待缓冲', stalled: '缓冲停滞', error: '媒体错误', seeking: '定位播放位置',
  seeked: '定位结束', ratechange: '播放速率变化', visibility: '页面可见性变化',
  route: '页面类型变化', 'manual-mark': '手动标记', 'role-change': '更改 A/B 标签',
  'wrapper-close-notice': '收到跨窗口关闭通知', 'page-notice': '页面显示平台提示',
  'study-notice': '收到平台学习通知',
};

function parseStudyMessage(data) {
  if (typeof data !== 'string' || data.length > 16384) return null;
  try {
    const packet = /^42(?:\/[^,]{1,128},)?(\[.*)$/su.exec(data);
    if (!packet) return null;
    const value = JSON.parse(packet[1]);
    const payload = Array.isArray(value) && value[0] === 'message' ? value[1] : null;
    return payload && wdDiagnosticCodes.has(payload.type) ? payload.type : null;
  } catch { return null; }
}

function wdDiagnosticFrames(stack) {
  // Keep only known script basenames and coordinates, never whole URLs or stack lines.
  const result = [];
  for (const match of String(stack || '').matchAll(/\b((?:study|main|wangda-playback-diagnostics)[A-Za-z0-9_.-]*\.js):(\d+):(\d+)/gu)) {
    if (match[1].startsWith('wangda-playback-diagnostics')) continue;
    result.push({ file: match[1], line: Number(match[2]), column: Number(match[3]) });
    if (result.length === 8) break;
  }
  return result;
}

function createPlaybackDiagnostics(win, options = {}) {
  const doc = win.document;
  const limit = Number.isInteger(options.limit) ? Math.max(10, Math.min(600, options.limit)) : 600;
  let recording = false, destroyed = false, role = 'A', dropped = 0, seq = 0, mediaSeq = 0;
  let events = [], lastRoute = '', shownNotices = new Set();
  const mediaIds = new WeakMap(), subscriptions = new Set(), cleanups = [], socketCleanups = new Set();
  const capabilities = { pauseObserver: false, socketObserver: false, broadcastObserver: false, studySocketsObserved: 0 };
  const createdAt = new Date().toISOString();
  const notify = () => { for (const fn of subscriptions) { try { fn(); } catch { /* UI must not affect playback. */ } } };
  const record = (kind, fields = {}) => {
    if (!recording || destroyed) return;
    events.push({ sequence: ++seq, at: new Date().toISOString(), elapsedMs: Math.round(win.performance.now()), role, kind, ...fields });
    if (events.length > limit) { dropped += events.length - limit; events.splice(0, events.length - limit); }
    notify();
  };
  const number = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  const mediaState = media => {
    if (!mediaIds.has(media)) mediaIds.set(media, ++mediaSeq);
    return { id: mediaIds.get(media), type: media.tagName === 'AUDIO' ? 'audio' : 'video',
      currentTime: number(media.currentTime), duration: number(media.duration), paused: Boolean(media.paused),
      ended: Boolean(media.ended), muted: Boolean(media.muted), rate: number(media.playbackRate),
      readyState: Number(media.readyState), errorCode: media.error?.code || null };
  };
  const routeKind = () => {
    const hash = win.location.hash;
    if (hash.startsWith('#/study/course/detail/')) return 'course';
    if (hash.startsWith('#/study/subject/detail/')) return 'subject';
    if (hash.startsWith('#/study/errors/')) return 'study-error';
    return 'other';
  };
  const sample = () => {
    if (!recording || destroyed) return;
    const route = routeKind();
    if (route !== lastRoute) { record('route', { page: route }); lastRoute = route; }
    const sections = { notStarted: 0, learning: 0, completed: 0, unknown: 0 };
    for (const element of doc.querySelectorAll('.chapter-list.chapter-all ul li dl[id*="show-sections"]')) {
      const status = element.querySelector('dd .item.start.pointer > span, dd .item.continue.pointer > span')?.textContent?.trim();
      sections[({ '未开始': 'notStarted', '学习中': 'learning', '已完成': 'completed' })[status] || 'unknown']++;
    }
    record('sample', { page: route, visible: !doc.hidden, iframeCount: doc.querySelectorAll('iframe').length,
      media: [...doc.querySelectorAll('video,audio')].map(mediaState), sections });
    const text = [...doc.querySelectorAll('#alertify, .alertify-log, .alertify-logs, .alertify-dialog, [role="alert"], .el-message, .message-box')].map(el => el.textContent || '').join('\n');
    const notices = new Set();
    if (text.includes('您已打开新的课程页面进行学习') || text.includes('旧页面将为您暂停播放')) notices.add(1003);
    if (text.includes('当前正在观看课件人数已达上限')) notices.add(1004);
    for (const code of notices) if (!shownNotices.has(code)) record('page-notice', { code });
    shownNotices = notices;
  };

  // Observe incoming messages only. Constructors, parameters and platform listeners pass through.
  const observeConstructor = (name, onConstruct) => {
    const Original = win[name];
    if (typeof Original !== 'function') return false;
    const Wrapped = new Proxy(Original, { construct(target, args, newTarget) {
      const instance = Reflect.construct(target, args, newTarget);
      try { onConstruct(instance, args); } catch { /* Diagnostic failure must not break construction. */ }
      return instance;
    } });
    try {
      win[name] = Wrapped;
      if (win[name] !== Wrapped) return false;
      cleanups.push(() => { if (win[name] === Wrapped) win[name] = Original; });
      return true;
    } catch { return false; }
  };
  const listenSocket = (instance, callback) => {
    instance.addEventListener('message', callback);
    let closed = null, closeObserver = null, closeDescriptor = null;
    const cleanup = () => {
      instance.removeEventListener('message', callback);
      if (closed) instance.removeEventListener('close', closed);
      if (closeObserver && instance.close === closeObserver) {
        if (closeDescriptor) Object.defineProperty(instance, 'close', closeDescriptor);
        else delete instance.close;
      }
      socketCleanups.delete(cleanup);
    };
    socketCleanups.add(cleanup);
    if (typeof instance.close === 'function' && 'readyState' in instance) {
      closed = cleanup;
      instance.addEventListener('close', closed, { once: true });
    } else if (typeof instance.close === 'function') {
      const originalClose = instance.close;
      closeDescriptor = Object.getOwnPropertyDescriptor(instance, 'close');
      closeObserver = function (...args) {
        const result = Reflect.apply(originalClose, this, args);
        if (this === instance) { try { cleanup(); } catch { /* Keep native close result. */ } }
        return result;
      };
      try { Object.defineProperty(instance, 'close', { configurable: true, writable: true, value: closeObserver }); }
      catch { /* Nonconfigurable channels are released when the diagnostic is destroyed. */ }
    }
  };
  capabilities.socketObserver = observeConstructor('WebSocket', (instance, args) => {
    const url = new URL(args[0], win.location.href);
    if (url.pathname.replace(/\/$/u, '') !== '/api/v1/ws') return;
    capabilities.studySocketsObserved++;
    listenSocket(instance, event => {
      if (!recording) return;
      const code = parseStudyMessage(event.data);
      if (code !== null) record('study-notice', { code });
    });
  });
  capabilities.broadcastObserver = observeConstructor('BroadcastChannel', (instance, args) => {
    if (args[0] !== 'wrapper-detail') return;
    listenSocket(instance, event => {
      if (event.data && event.data.closeWrapperDetail === true) record('wrapper-close-notice');
    });
  });
  const proto = win.HTMLMediaElement?.prototype;
  const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'pause');
  if (descriptor && typeof descriptor.value === 'function') {
    const originalPause = descriptor.value;
    function observedPause(...args) {
      try { if (recording) record('pause-call', { media: mediaState(this), frames: wdDiagnosticFrames(new Error().stack) }); } catch { /* Preserve native errors below. */ }
      return Reflect.apply(originalPause, this, args);
    }
    try {
      Object.defineProperty(proto, 'pause', { ...descriptor, value: observedPause });
      capabilities.pauseObserver = true;
      cleanups.push(() => { if (proto.pause === observedPause) Object.defineProperty(proto, 'pause', descriptor); });
    } catch { /* Events still work if this browser does not allow a method observer. */ }
  }
  const mediaEvents = ['play', 'playing', 'pause', 'ended', 'waiting', 'stalled', 'error', 'seeking', 'seeked', 'ratechange'];
  const onMedia = event => {
    if (recording && /^(VIDEO|AUDIO)$/u.test(event.target?.tagName || '')) record(event.type, { media: mediaState(event.target) });
  };
  for (const type of mediaEvents) doc.addEventListener(type, onMedia, true);
  const visibility = () => record('visibility', { visible: !doc.hidden });
  const routeChanged = () => sample();
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('hashchange', routeChanged);
  const timer = win.setInterval(sample, 5000);
  let pending = null;
  const observer = new win.MutationObserver(records => {
    if (!recording || pending !== null || records.every(item => item.target.nodeType === 1 && item.target.id === 'wangda-playback-diagnostics')) return;
    pending = win.setTimeout(() => { pending = null; sample(); }, 300);
  });
  observer.observe(doc, { subtree: true, childList: true, characterData: true });

  return {
    start() { if (recording || destroyed) return; recording = true; record('start', { capabilities: { ...capabilities } }); sample(); },
    stop() { if (!recording) return; record('stop'); recording = false; notify(); },
    setRole(value) { if (!['A', 'B'].includes(value) || role === value) return; role = value; record('role-change'); notify(); },
    mark() { record('manual-mark'); },
    clear() { events = []; dropped = 0; seq = 0; shownNotices = new Set(); notify(); },
    sample,
    isRecording: () => recording,
    exportData: () => JSON.parse(JSON.stringify({ schemaVersion: 1, toolVersion: '0.1.0-test.1', createdAt, role,
      recording, capabilities: { ...capabilities }, scope: 'top-document-native-media', limit, dropped, events })),
    subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn); },
    destroy() {
      if (destroyed) return;
      recording = false; destroyed = true; observer.disconnect(); win.clearInterval(timer);
      if (pending !== null) win.clearTimeout(pending);
      for (const type of mediaEvents) doc.removeEventListener(type, onMedia, true);
      doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('hashchange', routeChanged);
      for (const cleanup of [...socketCleanups, ...cleanups.reverse()]) { try { cleanup(); } catch { /* A removed object needs no cleanup. */ } }
      subscriptions.clear();
    },
  };
}

function mountPlaybackDiagnostics(win, diag, version) {
  const doc = win.document;
  const host = doc.createElement('div'); host.id = 'wangda-playback-diagnostics';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483646;color:#25364a;font:13px/1.6 system-ui,sans-serif}
    section{width:320px;background:#fff;border:1px solid #b9c9db;border-radius:10px;box-shadow:0 3px 18px #0002;overflow:hidden}
    header{padding:9px 12px;background:#edf4fc;display:flex;align-items:center;justify-content:space-between}strong{font-size:14px}
    main{padding:10px 12px;max-height:50vh;overflow:auto}p{margin:6px 0}button,select{font:inherit;padding:4px 8px;border:1px solid #b9c9db;border-radius:5px;background:#fff;color:#234c7a;cursor:pointer}button:disabled{opacity:.5;cursor:default}
    .buttons{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}pre{white-space:pre-wrap;font:12px/1.5 system-ui;margin:8px 0;background:#f4f7fa;padding:8px;border-radius:6px}small{display:block;color:#586b7e}
  </style><section><header><strong>播放暂停诊断</strong><button data-action="toggle">收起</button></header><main>
    <small data-version></small><p>暂停其他自动学习脚本，手动播放课程。</p>
    <label>此标签页 <select aria-label="此标签页标记"><option>A</option><option>B</option></select></label>
    <p data-status></p><div class="buttons"><button data-action="start">开始记录</button><button data-action="stop">停止记录</button><button data-action="mark">标记此刻</button><button data-action="export">导出日志</button><button data-action="clear">清空</button></div>
    <small data-capabilities></small><pre data-events></pre><small>只观察当前页面原生媒体。iframe、页面隔离或未知消息格式可能造成漏记。刷新前先导出；测试后禁用此脚本并刷新。</small>
  </main></section>`;
  root.querySelector('[data-version]').textContent = `${version} · 临时测试脚本`;
  const render = () => {
    const data = diag.exportData();
    root.querySelector('[data-status]').textContent = `${data.recording ? '记录中' : '已停止'} · ${data.events.length} 条${data.dropped ? ` · 已裁剪 ${data.dropped} 条` : ''}`;
    root.querySelector('[data-action="start"]').disabled = data.recording;
    root.querySelector('[data-action="stop"]').disabled = !data.recording;
    root.querySelector('[data-action="mark"]').disabled = !data.recording;
    root.querySelector('select').value = data.role;
    root.querySelector('[data-capabilities]').textContent = `暂停调用观察：${data.capabilities.pauseObserver ? '已布置' : '不可用'}；已观察学习连接：${data.capabilities.studySocketsObserved} 个（为 0 时不能排除平台通知）。`;
    root.querySelector('[data-events]').textContent = data.events.slice(-7).map(event => {
      const time = new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) + '.' + event.at.slice(20, 23);
      if (event.kind === 'sample') return `${time} ${event.role} 播放器 ${event.media.length} 个 · ${event.media.map(media => `${media.id}: ${media.paused ? '暂停' : '播放'} ${media.currentTime}s`).join('，') || '未找到'}`;
      return `${time} ${event.role} ${wdDiagnosticNames[event.kind] || event.kind}${event.code ? `：${wdDiagnosticNames[event.code]}` : ''}`;
    }).join('\n') || '点击“开始记录”后正常操作课程。';
  };
  const unsubscribe = diag.subscribe(render);
  root.querySelector('select').addEventListener('change', event => diag.setRole(event.target.value));
  root.addEventListener('click', event => {
    const action = event.target?.dataset?.action;
    if (action === 'start') diag.start();
    if (action === 'stop') diag.stop();
    if (action === 'mark') diag.mark();
    if (action === 'clear') diag.clear();
    if (action === 'toggle') {
      const main = root.querySelector('main'); main.hidden = !main.hidden; event.target.textContent = main.hidden ? '展开' : '收起';
    }
    if (action === 'export') {
      const data = diag.exportData();
      const blob = new win.Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = win.URL.createObjectURL(blob), anchor = doc.createElement('a');
      anchor.href = url; anchor.download = `wangda-playback-${data.role}-${Date.now()}.json`;
      anchor.click(); win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
    }
  });
  doc.body.appendChild(host); render();
  return { destroy() { unsubscribe(); host.remove(); } };
}


if (window.location.protocol !== 'https:' || window.location.hostname !== 'wangda.chinamobile.com' || window.self !== window.top) return;
if (window.__wangdaPlaybackDiagnosticsInstalled) return;
Object.defineProperty(window, '__wangdaPlaybackDiagnosticsInstalled', { value: true, configurable: true });
const diagnostics = createPlaybackDiagnostics(window);
const mount = () => mountPlaybackDiagnostics(window, diagnostics, "0.1.0-test.1");
if (window.document.body) mount();
else window.document.addEventListener('DOMContentLoaded', mount, { once: true });

})();
