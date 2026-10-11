import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../dist/wangda-playback-diagnostics.user.js', import.meta.url), 'utf8').catch(() => '');

test('独立诊断包仅本域顶层运行、页面加载前布置、无网络和存储权限', () => {
  assert.ok(source.startsWith('// ==UserScript=='), '尚未构建独立诊断脚本');
  assert.match(source, /@name\s+网大播放暂停诊断/u); assert.match(source, /@version\s+0\.1\.0-test\.1/u);
  assert.match(source, /@run-at\s+document-start/u); assert.match(source, /@noframes/u); assert.match(source, /@grant\s+none/u);
  assert.doesNotMatch(source, /@(?:connect|updateURL|downloadURL)|\bfetch\s*\(|XMLHttpRequest|document\.cookie|localStorage|sessionStorage|\.send\s*\(|\.postMessage\s*\(/u);
  assert.doesNotThrow(() => new vm.Script(source));
});

test('构建入口防重复、非本域和 iframe 不读取页面', () => {
  assert.ok(source, '尚未构建独立诊断脚本');
  const bad = new JSDOM('<body></body>', { url: 'https://example.com/', runScripts: 'outside-only' });
  bad.window.eval(source); assert.equal(bad.window.document.getElementById('wangda-playback-diagnostics'), null); bad.window.close();
  const frame = { location: { protocol: 'https:', hostname: 'wangda.chinamobile.com' }, top: {} }; frame.self = frame;
  Object.defineProperty(frame, 'document', { get: () => assert.fail('iframe 不应读取页面') });
  assert.doesNotThrow(() => vm.runInNewContext(source, { window: frame }));
  const dom = new JSDOM('<body><video></video></body>', { url: 'https://wangda.chinamobile.com/#/study/course/detail/private/6/private', runScripts: 'outside-only' });
  const w = dom.window; w.HTMLMediaElement.prototype.pause = () => {};
  const OriginalError = w.Error;
  w.Error = class extends OriginalError { constructor() { super(); this.stack = 'at x (https://wangda.chinamobile.com/scripts/study-123.js:123:45)\nat SECRET (https://evil.com/token.js?token=SECRET:1:2)'; } };
  let downloaded, filename;
  w.Blob = class { constructor(parts) { downloaded = JSON.parse(parts.join('')); } };
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  w.eval(source); w.eval(source); assert.equal(w.document.querySelectorAll('#wangda-playback-diagnostics').length, 1);
  const root = w.document.getElementById('wangda-playback-diagnostics').shadowRoot;
  root.querySelector('[data-action="start"]').click(); w.document.querySelector('video').pause();
  root.querySelector('[data-action="stop"]').click(); root.querySelector('[data-action="export"]').click();
  assert.match(filename, /^wangda-playback-A-\d+\.json$/u);
  assert.deepEqual(downloaded.events.find(e => e.kind === 'pause-call').frames, [{ file: 'study-123.js', line: 123, column: 45 }]);
  assert.doesNotMatch(JSON.stringify(downloaded), /SECRET|private|https:|token/u); w.close();
});
