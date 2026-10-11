import { readFile, mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const source = (await readFile(new URL('src/playback-diagnostics.js', root), 'utf8'))
  .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gmu, '');
const version = '0.1.0-test.1';
const metadata = `// ==UserScript==
// @name         网大播放暂停诊断
// @namespace    wangda-assistant-playback-diagnostics
// @version      ${version}
// @description  手动复现两门课程冲突，记录暂停和平台通知的时间线
// @match        https://wangda.chinamobile.com/*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==
`;
const boot = `
if (window.location.protocol !== 'https:' || window.location.hostname !== 'wangda.chinamobile.com' || window.self !== window.top) return;
if (window.__wangdaPlaybackDiagnosticsInstalled) return;
Object.defineProperty(window, '__wangdaPlaybackDiagnosticsInstalled', { value: true, configurable: true });
const diagnostics = createPlaybackDiagnostics(window);
const mount = () => mountPlaybackDiagnostics(window, diagnostics, ${JSON.stringify(version)});
if (window.document.body) mount();
else window.document.addEventListener('DOMContentLoaded', mount, { once: true });
`;
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/wangda-playback-diagnostics.user.js', root), `${metadata}\n(function () {\n'use strict';\n${source}\n${boot}\n})();\n`, 'utf8');
console.log(`已构建 dist/wangda-playback-diagnostics.user.js (${version})`);
