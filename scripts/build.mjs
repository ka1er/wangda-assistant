import { readFile, mkdir, writeFile } from 'node:fs/promises';
const wdBuildRoot = new URL('../', import.meta.url);
const wdBuildPackage = JSON.parse(await readFile(new URL('package.json', wdBuildRoot), 'utf8'));
const wdBuildFiles = ['core', 'adapter', 'queue', 'controller', 'panel', 'main'];
const wdBuildSources = await Promise.all(wdBuildFiles.map(async name => {
  const source = await readFile(new URL(`src/${name}.js`, wdBuildRoot), 'utf8');
  return source.replace(/^import\s+[^\r\n]+;\r?$/gmu, '').replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gmu, '')
    .replace("const wdMainVersion = '__WD_VERSION__';", `const wdMainVersion = ${JSON.stringify(wdBuildPackage.version)};`);
}));
const wdBuildMetadata = `// ==UserScript==
// @name         网大助手
// @namespace    wangda-assistant
// @version      ${wdBuildPackage.version}
// @updateURL    https://raw.githubusercontent.com/ka1er/wangda-assistant/refs/heads/beta-channel/dist/wangda-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/ka1er/wangda-assistant/refs/heads/beta-channel/dist/wangda-assistant.user.js
// @description  手动勾选课程、管理多专区任务队列，按平台完成状态连续学习
// @match        https://wangda.chinamobile.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// ==/UserScript==
`;
await mkdir(new URL('dist/', wdBuildRoot), { recursive: true });
await writeFile(new URL('dist/wangda-assistant.user.js', wdBuildRoot), `${wdBuildMetadata}\n(function () {\n'use strict';\n${wdBuildSources.join('\n')}\n})();\n`, 'utf8');
console.log(`已构建 dist/wangda-assistant.user.js (${wdBuildPackage.version})`);
