import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../dist/wangda-assistant.user.js', import.meta.url), 'utf8').catch(() => '');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
test('单文件metadata仅声明本域和必要权限，无网络请求', () => {
  assert.ok(source.startsWith('// ==UserScript=='), '尚未构建userscript'); assert.equal(source.match(/@version\s+(\S+)/u)?.[1], version); assert.match(source, /@match\s+https:\/\/wangda\.chinamobile\.com\/\*/u);
  assert.match(source, /@noframes/u); assert.deepEqual([...source.matchAll(/@grant\s+(\w+)/gu)].map(x => x[1]), ['GM_getValue', 'GM_setValue', 'GM_registerMenuCommand', 'GM_notification']);
  assert.match(source, /@description[^\n]*多专区/u); assert.match(source, /function normalizeQueue\(/u); assert.ok(source.indexOf('function normalizeQueue(') < source.indexOf('function createController('));
  const updateAddress = 'https://raw.githubusercontent.com/ka1er/wangda-assistant/refs/heads/beta-channel/dist/wangda-assistant.user.js';
  assert.deepEqual([...source.matchAll(/^\/\/ @(updateURL|downloadURL)\s+(\S+)$/gmu)].map(x => [x[1], x[2]]), [['updateURL', updateAddress], ['downloadURL', updateAddress]]);
  assert.equal(source.match(/^\/\/ @name\s+(.+)$/mu)?.[1], '网大助手'); assert.equal(source.match(/^\/\/ @namespace\s+(\S+)$/mu)?.[1], 'wangda-assistant');
  assert.doesNotMatch(source, /@connect|\bfetch\s*\(|XMLHttpRequest/u); assert.doesNotThrow(() => new vm.Script(source));
});
function boot(url = 'https://wangda.chinamobile.com/#/home') {
  const dom = new JSDOM('<body></body>', { url, runScripts: 'outside-only' }); const w = dom.window;
  w.GM_getValue = () => undefined; w.GM_setValue = () => {}; w.GM_registerMenuCommand = () => {};
  w.eval(source); return w;
}
test('host/frame guard与重复执行只一个面板，标题安全渲染', async () => {
  assert.ok(source); const bad = boot('https://example.com/'); assert.equal(bad.document.querySelector('#wangda-assistant'), null); bad.close();
  const frame = { location: { protocol: 'https:', hostname: 'wangda.chinamobile.com' }, top: {} }; frame.self = frame;
  Object.defineProperty(frame, 'document', { get: () => assert.fail('iframe不应读取页面') }); assert.doesNotThrow(() => vm.runInNewContext(source, { window: frame }));
  const w = boot(); w.eval(source); assert.equal(w.document.querySelectorAll('#wangda-assistant').length, 1);
  const shadow = w.document.querySelector('#wangda-assistant').shadowRoot; assert.ok(shadow.querySelector('[name="target"]').labels.length); assert.ok(shadow.textContent.includes(version)); assert.equal(shadow.querySelector('textarea'), null);
  const { createPanel } = await import('../src/panel.js'); let cb; const state = { status: 'paused', message: '', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [{ id: 't', target: '测试', subject: { id: 's', title: '<svg onload="bad()">' }, scope: 'all', done: [], skipped: [], courses: [{ id: 'c', title: '<img src=x onerror="bad()">', status: 'unknown', required: true, selected: true }] }], activeTaskId: 't', currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
  const dynamic = new JSDOM('<body></body>'); const panel = createPanel(dynamic.window, { getState: () => state, subscribe: fn => { cb = fn; return () => {}; } }, version); cb(state); const dynamicRoot = dynamic.window.document.getElementById('wangda-assistant').shadowRoot; assert.equal(dynamicRoot.querySelector('img,svg'), null); assert.ok(dynamicRoot.textContent.includes('<img src=x')); assert.ok(dynamicRoot.textContent.includes('<svg onload=')); panel.destroy(); dynamic.window.close(); w.close();
});
