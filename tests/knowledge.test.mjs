import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  parseWebVtt,
  cleanAndSegmentCues,
  formatTimestamp,
  parseTimestampToSeconds,
  estimateKnowledgeTokens,
  buildZeroAiGuide,
  buildKnowledgeMarkdown,
  parseSeekHref,
  selectCaptionTrack,
  collectCourseSubtitles,
  seekCourseTime,
} from '../src/knowledge-vtt.js';
import {
  WD_AI_STORAGE_KEYS,
  WD_AI_PRIVACY_NOTICE,
  loadAiSettings,
  saveAiSettings,
  clearAiApiKey,
  buildKnowledgeCacheKey,
  loadKnowledgeCache,
  saveKnowledgeCache,
  buildChatCompletionsUrl,
  parseStrictJsonContent,
  normalizeSectionStudyPayload,
  summarizeCourseWithAi,
  createKnowledgeService,
} from '../src/knowledge-ai.js';
import { parseMarkdownOutline, renderKnowledgeMindmap } from '../src/knowledge-map.js';
import {
  selectRelevantSectionContext,
  askSectionQuestion,
  loadSectionChat,
  generateSectionQuiz,
  gradeSectionQuiz,
  loadSectionQuiz,
  evaluateSectionStudyStatus,
  shouldShowSectionGuide,
  readSectionDomStudyStatus,
  mountSectionGuideButtons,
} from '../src/knowledge-tutor.js';
import { readPage } from '../src/adapter.js';
import { createPanel } from '../src/panel.js';

const sampleVtt = `\uFEFFWEBVTT

NOTE 这是注释块，应被忽略

STYLE
::cue { color: white; }

1
00:00:01.000 --> 00:00:03.200 align:start position:0%
<v 讲师>大家好，今天我们学习</v>

2
00:00:03.400 --> 00:00:06.000
<c>生产安全风险识别基础。</c> ♪ [音乐]

3
00:00:06.100 --> 00:00:08.000
首先介绍第一类危险源

4
00:00:08.500 --> 00:00:11.000
首先介绍第一类危险源和第二类危险源的区别。

00:13.500 --> 00:16.000
接下来我们看作业前 JSA 分析步骤。
`;

test('VTT 解析处理 BOM、NOTE/STYLE、标签噪声与 MM:SS / HH:MM:SS 毫秒时间戳', () => {
  const cues = parseWebVtt(sampleVtt);
  assert.equal(cues.length, 5);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3200);
  assert.equal(cues[0].text, '大家好，今天我们学习');
  assert.equal(cues[1].text, '生产安全风险识别基础。');
  assert.equal(cues[4].startMs, 13500);
  assert.equal(cues[4].text, '接下来我们看作业前 JSA 分析步骤。');
  assert.equal(formatTimestamp(3665), '01:01:05');
  assert.equal(formatTimestamp(75), '01:15');
  assert.equal(parseTimestampToSeconds('02:35'), 155);
  assert.equal(parseTimestampToSeconds('01:02:03.500'), 3723.5);
});

test('VTT 合并去重与分段：滚动包含去重、短间隙同句合并、停顿与话语标记切段', () => {
  const cues = parseWebVtt(sampleVtt);
  const { cues: deduped, merged, segments } = cleanAndSegmentCues(cues, { minSegmentChars: 18, maxSegmentChars: 80, pauseBreakMs: 1500 });
  // cue 4 starts with cue 3 -> deduped from 5 to 4
  assert.equal(deduped.length, 4);
  assert.ok(deduped.some(c => c.text.includes('第一类危险源和第二类危险源的区别')));
  assert.equal(deduped.some(c => c.text === '首先介绍第一类危险源'), false);
  // cue 1 + cue 2 gap is 200ms and cue 1 has no ending punctuation -> merged
  assert.ok(merged.some(c => c.text.includes('大家好，今天我们学习生产安全风险识别基础。')));
  // pause > 1500ms and discourse marker "接下来" break into >= 2 segments with timestamps
  assert.ok(segments.length >= 2);
  assert.equal(segments[0].timestamp, '00:01');
  assert.equal(segments.at(-1).timestamp, '00:13');
});

test('字幕采集区分 metadata 轨与 captions 轨，支持 Video.js 内存与 app._modules captionVtt 整课拉取', async () => {
  const dom = new JSDOM(`
    <div class="course-side-title-row"><span class="text-overflow" title="AI安全与治理">AI安全</span></div>
    <div class="chapter-list chapter-all"><ul><li>
      <div class="list-title">第一章 基础</div>
      <dl class="focus" id="D1show-sectionssec-uuid-1" data-courseId="c1" data-resourceId="att-1"><dt><span class="qcontent" title="第1节 风险演变">1</span></dt></dl>
      <dl id="D1show-sectionssec-uuid-2" data-courseId="c1" data-resourceId="att-2"><dt><span class="qcontent" title="第2节 合规要求">2</span></dt></dl>
    </li></ul></div>
    <div class="video-js" id="livePlayer"><video></video></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/subject-course/c1/6/s1' });
  try {
    const win = dom.window;
    const liveEl = win.document.getElementById('livePlayer');
    const staleEl = win.document.createElement('div'); // detached from DOM
    const pageWin = {
      videojs: {
        getPlayers: () => ({
          stale: { isDisposed: () => false, el: () => staleEl, textTracks: () => [{ kind: 'captions', cues: [{ startTime: 1, endTime: 2, text: '旧播放器残留' }] }] },
          live: {
            isDisposed: () => false,
            el: () => liveEl,
            textTracks: () => [
              { kind: 'metadata', label: 'segment-metadata', cues: [{ startTime: 0, endTime: 1, text: '{"uri":"seg1.ts","bandwidth":1000}' }] },
              { kind: 'captions', label: '开启', mode: 'showing', cues: [{ startTime: 3.8, endTime: 8, text: 'AI 风险从内容层扩展到业务执行层。' }] },
            ],
          },
        }),
      },
      app: {
        _modules: {
          'study/course/detail--old': { store: { models: { course: { data: { id: 'other-course', name: '旧课' } }, trackList: { data: [] } } } },
          'study/course/detail--c1': {
            store: {
              models: {
                course: {
                  data: {
                    id: 'c1',
                    name: 'AI安全与治理',
                    courseChapters: [{
                      name: '第一章 基础',
                      courseChapterSections: [
                        { id: 'sec-uuid-1', name: '第1节 风险演变', attachmentId: 'att-1' },
                        { id: 'sec-uuid-2', name: '第2节 合规要求', attachmentId: 'att-2' },
                      ],
                    }],
                  },
                },
                trackList: {
                  data: [
                    // sec-uuid-1 故意不提供 captionVtt，验证路径 1 缺失后回退路径 2 (Video.js live captions)
                    { attachmentId: 'att-2', captionVtt: 'https://wangda.chinamobile.com/default/M00/s2.vtt' },
                  ],
                },
              },
            },
          },
        },
      },
    };
    const fetchedUrls = [];
    const data = await collectCourseSubtitles({
      win,
      pageWin,
      scope: 'course',
      httpGet: async url => {
        fetchedUrls.push(url);
        return 'WEBVTT\n\n00:00:12.000 --> 00:00:18.000\n新版网络安全法将 AI 风险纳入法律规制。';
      },
    });
    // Section 1 has no captionVtt -> falls back to live Video.js cues; Section 2 fetched via Path 1 captionVtt
    assert.deepEqual(fetchedUrls, ['https://wangda.chinamobile.com/default/M00/s2.vtt']);
    assert.equal(data.sections.length, 2);
    assert.equal(data.sections[0].source, 'vjs-cues');
    assert.equal(data.sections[0].hasSubtitle, true);
    assert.equal(data.sections[0].cues[0].text, 'AI 风险从内容层扩展到业务执行层。');
    assert.equal(data.sections[1].source, 'vtt-url');
    assert.equal(data.sections[1].hasSubtitle, true);
    assert.equal(data.sections[1].cues[0].text, '新版网络安全法将 AI 风险纳入法律规制。');
    // Confirm selectCaptionTrack rejects metadata JSON even if kind is blank
    const picked = selectCaptionTrack([{ kind: '', label: 'x', cues: [{ text: '{"uri":"a.ts","timeline":1}' }] }]);
    assert.equal(picked, null);
  } finally {
    dom.window.close();
  }
});

test('零 AI 导览与 ATX Markdown 树生成、token 粗略预估、UUID 跳播链接解析及 XSS 转义', () => {
  const courseData = {
    courseId: 'c1',
    title: '安全<script>课程',
    activeSectionId: 'sec-uuid-1',
    sections: [
      {
        sectionId: 'sec-uuid-1',
        sectionIndex: 1,
        chapterTitle: '第一章',
        title: '风险识别',
        active: true,
        cues: parseWebVtt(sampleVtt),
      },
      {
        sectionId: 'sec-uuid-2',
        sectionIndex: 2,
        chapterTitle: '第一章',
        title: '无字幕图文节',
        active: false,
        cues: [],
      },
    ],
    highlights: [],
  };
  const estSec = estimateKnowledgeTokens(courseData, 'section');
  const estAll = estimateKnowledgeTokens(courseData, 'course');
  assert.equal(estSec.sectionCount, 1);
  assert.equal(estAll.sectionCount, 2);
  assert.equal(estAll.captionedSections, 1);
  assert.ok(estAll.totalTokens > 0);
  assert.match(estAll.summaryText, /tokens/u);

  const guide = buildZeroAiGuide(courseData, { scope: 'course' });
  assert.equal(guide.tree.mode, 'zero-ai');
  assert.equal(guide.tree.sections.length, 2);
  assert.equal(guide.tree.sections[0].mode, 'zero-ai');
  assert.equal(guide.tree.sections[1].mode, 'placeholder');
  assert.match(guide.markdown, /^# 安全＜script＞课程/u);
  assert.doesNotMatch(guide.markdown, /<script>/u);
  assert.match(guide.markdown, /\[00:01\]\(#wd-seek-sec-uuid-1-1\)/u);
  assert.match(guide.markdown, /课节目录占位/u);
  assert.deepEqual(parseSeekHref('#wd-seek-sec-uuid-1-125'), { sectionId: 'sec-uuid-1', seconds: 125 });
});

test('AI Key 与配置仅存 localStorage，不碰 GM_setValue，一键清空与 URL 校验正常', () => {
  const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/home' });
  try {
    const win = dom.window;
    let gmWrites = 0;
    win.GM_setValue = () => { gmWrites += 1; };

    const init = loadAiSettings(win);
    assert.equal(init.apiKey, '');
    assert.equal(init.provider, 'deepseek');

    const saved = saveAiSettings(win, {
      provider: 'custom',
      baseUrl: 'https://relay.example.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-local-secret-123',
      transport: 'fetch',
    });
    assert.equal(saved.ok, true);
    assert.equal(gmWrites, 0);
    assert.equal(win.localStorage.getItem(WD_AI_STORAGE_KEYS.apiKey), 'sk-local-secret-123');
    assert.equal(loadAiSettings(win).apiKey, 'sk-local-secret-123');
    assert.equal(loadAiSettings(win).baseUrl, 'https://relay.example.com/v1');

    // Clear key
    const cleared = clearAiApiKey(win);
    assert.equal(cleared.ok, true);
    assert.equal(win.localStorage.getItem(WD_AI_STORAGE_KEYS.apiKey), null);
    assert.equal(loadAiSettings(win).apiKey, '');
    // Non-key config preserved
    assert.equal(loadAiSettings(win).baseUrl, 'https://relay.example.com/v1');

    // URL normalization & scheme safety
    assert.equal(buildChatCompletionsUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(buildChatCompletionsUrl('https://relay.example.com/v1/chat/completions/'), 'https://relay.example.com/v1/chat/completions');
    assert.equal(buildChatCompletionsUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/chat/completions');
    assert.throws(() => buildChatCompletionsUrl('http://remote-insecure.example.com/v1'), /仅支持 https/u);
    assert.throws(() => buildChatCompletionsUrl('javascript:alert(1)'), /仅支持 https/u);
  } finally {
    dom.window.close();
  }
});

test('按课节分段请求 AI（绝不整课一次塞入）并聚合成课程级知识点树', async () => {
  const courseData = {
    courseId: 'c1',
    title: '网络运维实战',
    activeSectionId: 's1',
    sections: [
      { sectionId: 's1', sectionIndex: 1, chapterTitle: '一', title: '故障排查', active: true, cues: [{ startMs: 10000, endMs: 15000, text: '排查先看告警收敛与拓扑定位。' }] },
      { sectionId: 's2', sectionIndex: 2, chapterTitle: '二', title: '应急恢复', active: false, cues: [{ startMs: 65000, endMs: 70000, text: '核心链路中断需立即切换主备。' }] },
    ],
  };
  const calls = [];
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, userMsg: body.messages[1].content });
    if (calls.length === 1) {
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ topics: [{ name: '排查流程', points: [{ text: '告警收敛与拓扑定位', time: '00:10' }] }] }) } }] }) };
    }
    if (calls.length === 2) {
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ topics: [{ name: '倒换策略', points: [{ text: '核心链路主备切换', time: '01:05' }] }] }) } }] }) };
    }
    // 3rd call: course-level aggregation
    return {
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              overview: '覆盖故障定位到应急主备恢复全链路',
              sections: [
                { sectionId: 's1', topics: [{ name: '排查流程', points: [{ text: '告警收敛与定位', time: '00:10' }] }] },
                { sectionId: 's2', topics: [{ name: '应急倒换', points: [{ text: '核心链路主备切换', time: '01:05' }] }] },
              ],
            }),
          },
        }],
      }),
    };
  };
  const settings = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-test', transport: 'fetch' };
  const result = await summarizeCourseWithAi(courseData, settings, { scope: 'course', fetchFn: fakeFetch });

  // 2 per-section calls + 1 course aggregation call = 3 calls
  assert.equal(calls.length, 3);
  assert.match(calls[0].userMsg, /故障排查/u);
  assert.doesNotMatch(calls[0].userMsg, /应急恢复/u);
  assert.match(calls[1].userMsg, /应急恢复/u);
  assert.doesNotMatch(calls[1].userMsg, /故障排查/u);
  assert.equal(result.usedAi, true);
  assert.equal(result.fallback, false);
  assert.equal(result.tree.overview, '覆盖故障定位到应急主备恢复全链路');
  assert.match(result.markdown, /告警收敛与定位 \[00:10\]\(#wd-seek-s1-10\)/u);
  assert.match(result.markdown, /核心链路主备切换 \[01:05\]\(#wd-seek-s2-65\)/u);
});

test('失败回退全覆盖：Key 无效 / 额度耗尽 / 超时 / 非合法 JSON / provider 不通 均自动回退到零 AI 导览', async () => {
  const courseData = {
    courseId: 'c1',
    title: '安全基础课',
    activeSectionId: 's1',
    sections: [
      { sectionId: 's1', sectionIndex: 1, title: '核心制度', active: true, cues: parseWebVtt(sampleVtt) },
    ],
  };
  const baseSettings = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-bad', transport: 'fetch' };

  const failureCases = [
    {
      name: 'Key 无效 (HTTP 401)',
      fetchFn: async () => ({ status: 401, text: async () => '{"error":{"message":"invalid key"}}' }),
      expectPattern: /API Key 无效|HTTP 401/u,
    },
    {
      name: '额度耗尽 (HTTP 429)',
      fetchFn: async () => ({ status: 429, text: async () => '{"error":{"message":"insufficient_quota"}}' }),
      expectPattern: /额度耗尽|HTTP 429/u,
    },
    {
      name: '请求超时',
      fetchFn: async (_url, { signal }) => new Promise((_res, rej) => {
        signal.addEventListener('abort', () => rej(new Error('Aborted')));
      }),
      timeoutMs: 30,
      expectPattern: /超时/u,
    },
    {
      name: '响应体非合法 JSON（如网关 HTML 错误页）',
      fetchFn: async () => ({ status: 200, text: async () => '<html>502 Bad Gateway</html>' }),
      expectPattern: /不是合法 JSON/u,
    },
    {
      name: '模型输出非合法 JSON 文本',
      fetchFn: async () => ({ status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '抱歉我不是 JSON 格式' } }] }) }),
      expectPattern: /不是合法 JSON/u,
    },
    {
      name: 'provider 网络/CORS 不通',
      fetchFn: async () => { throw new TypeError('Failed to fetch'); },
      expectPattern: /CORS|不可达|Failed to fetch/u,
    },
  ];

  for (const tc of failureCases) {
    const res = await summarizeCourseWithAi(courseData, baseSettings, {
      scope: 'section',
      fetchFn: tc.fetchFn,
      timeoutMs: tc.timeoutMs || 5000,
    });
    assert.equal(res.usedAi, false, `${tc.name} 应标记 usedAi=false`);
    assert.equal(res.fallback, true, `${tc.name} 应标记 fallback=true`);
    assert.equal(res.tree.mode, 'zero-ai', `${tc.name} 应回退 zero-ai 树`);
    assert.match(res.tree.fallbackReason, tc.expectPattern, `${tc.name} 应携带明确失败原因`);
    assert.match(res.markdown, /^# 安全基础课/u, `${tc.name} 回退后仍产出有效 Markdown 导图`);
    assert.match(res.markdown, /#wd-seek-s1-/u, `${tc.name} 回退后仍保留时间轴跳播锚点`);
  }

  // Empty key defaults directly to zero-AI mode without making network calls
  let called = 0;
  const zeroRes = await summarizeCourseWithAi(courseData, { ...baseSettings, apiKey: '' }, {
    scope: 'section',
    fetchFn: async () => { called += 1; throw new Error('should not call'); },
  });
  assert.equal(called, 0);
  assert.equal(zeroRes.usedAi, false);
  assert.equal(zeroRes.tree.mode, 'zero-ai');
});

test('导图渲染支持 markmap 与离线内置 SVG 降级，支持节点折叠与时间戳点击跳播', async () => {
  const dom = new JSDOM('<body><svg id="m1"></svg><svg id="m2"></svg></body>');
  try {
    const doc = dom.window.document;
    const md = buildKnowledgeMarkdown({
      courseTitle: '测试导图',
      sections: [{
        sectionId: 'sec-1',
        title: '第一节',
        mode: 'ai',
        topics: [{ name: '基础概念', points: [{ text: '核心定义', seconds: 95 }] }],
      }],
    });
    const outline = parseMarkdownOutline(md);
    assert.equal(outline.label, '测试导图');
    assert.equal(outline.children[0].children[0].children[0].seek.seconds, 95);

    // 1. Mocked markmap engine path
    let markmapSeek = null;
    const m1 = doc.getElementById('m1');
    const h1 = await renderKnowledgeMindmap({
      svg: m1,
      markdown: md,
      onSeek: s => { markmapSeek = s; },
      importer: async url => {
        if (url.includes('markmap-lib')) return { Transformer: class { transform(s) { return { root: { content: s } }; } } };
        return {
          Markmap: {
            create(svg) {
              const a = doc.createElementNS('http://www.w3.org/2000/svg', 'a');
              a.setAttribute('href', '#wd-seek-sec-1-95');
              a.textContent = '01:35';
              svg.append(a);
              return { fit() {}, destroy() {} };
            },
          },
        };
      },
    });
    assert.equal(h1.engine, 'markmap');
    m1.querySelector('a').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(markmapSeek, { sectionId: 'sec-1', seconds: 95 });
    h1.destroy();

    // 2. Fallback built-in SVG path (skipCdn: true)
    let fallbackSeek = null;
    const m2 = doc.getElementById('m2');
    const h2 = await renderKnowledgeMindmap({ svg: m2, markdown: md, onSeek: s => { fallbackSeek = s; }, skipCdn: true });
    assert.equal(h2.engine, 'fallback-svg');
    const beforeNodes = m2.querySelectorAll('.wd-fallback-node').length;
    assert.ok(beforeNodes >= 4);
    m2.querySelector('a[data-seek-time="01:35"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(fallbackSeek, { sectionId: 'sec-1', seconds: 95 });
    // Collapse root node -> fewer nodes rendered
    m2.querySelector('[data-toggle-node="0"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(m2.querySelectorAll('.wd-fallback-node').length, 1);
    h2.destroy();
  } finally {
    dom.window.close();
  }
});

test('时间戳跳播优先走 askbar，其次 Video.js/原生媒体，运行队列中保护跨节，无播放器如实降级', () => {
  const dom = new JSDOM('<body><video></video></body>', { url: 'https://wangda.chinamobile.com/#/study/course/detail/c1/6' });
  try {
    const win = dom.window;
    // 1. askbar seek
    let askbarVal = null;
    const r1 = seekCourseTime({
      win,
      pageWin: { app: { askbar: { trigger: (ev, val) => { if (ev === 'study.player.seek') askbarVal = val; } } } },
      sectionId: 's1',
      seconds: 42,
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.method, 'askbar');
    assert.equal(askbarVal, 42);

    // 2. queue running protects cross-section switch
    const r2 = seekCourseTime({
      win,
      pageWin: {},
      adapter: { read: () => ({ activeSectionId: 's1' }), selectSection: () => assert.fail('运行中不应自动切节') },
      sectionId: 's2',
      seconds: 80,
      queueRunning: true,
    });
    assert.equal(r2.ok, false);
    assert.match(r2.message, /01:20/u);

    // 3. No player degrades honestly to text timestamp
    win.document.querySelector('video').remove();
    const r3 = seekCourseTime({ win, pageWin: {}, sectionId: 's1', seconds: 125 });
    assert.equal(r3.ok, false);
    assert.equal(r3.degraded, true);
    assert.match(r3.message, /02:05/u);
  } finally {
    dom.window.close();
  }
});

test('面板设置区展示本地 Key 告知文案与一键清空，导览弹窗默认零 AI 且按需挂载 SVG', async () => {
  const dom = new JSDOM(`
    <div class="course-side-title-row"><span class="text-overflow" title="测试课程">测试课程</span></div>
    <div class="chapter-list chapter-all"><ul><li>
      <dl class="focus" id="D1show-sectionssec-1" data-courseId="c1"><dt><span class="qcontent" title="第一节 概述">第一节</span></dt></dl>
    </li></ul></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c1/6' });
  try {
    const win = dom.window;
    const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
    const controller = { getState: () => structuredClone(state), subscribe: () => () => {}, diagnose: () => ({ kind: 'course' }) };
    const pageWin = {
      videojs: {
        getPlayers: () => ({
          p1: { isDisposed: () => false, el: () => win.document.body, textTracks: () => [{ kind: 'captions', label: '开启', cues: [{ startTime: 5, endTime: 10, text: '测试字幕第一句要点。' }] }] },
        }),
      },
    };
    const knowledge = createKnowledgeService({ win, pageWin, controller, fetchFn: async () => ({ status: 401, text: async () => '{"error":{"message":"bad key"}}' }) });
    knowledge.mapOptions = { skipCdn: true };
    const panel = createPanel(win, controller, 'test-ver', knowledge);
    panel.open();
    const root = win.document.getElementById('wangda-assistant').shadowRoot;

    // Initial shadowRoot must contain NO svg and NO textarea
    assert.equal(root.querySelector('svg'), null);
    assert.equal(root.querySelector('textarea'), null);

    // Privacy notice and AI config inputs present in settings
    const privacy = root.querySelector('[data-ai-privacy]');
    assert.ok(privacy);
    assert.equal(privacy.textContent, WD_AI_PRIVACY_NOTICE);
    assert.match(privacy.textContent, /仅存本地.*不上传.*不经过任何我们自己的服务器/u);

    root.querySelector('[name="ai-base-url"]').value = 'https://relay.example.com/v1';
    root.querySelector('[name="ai-model"]').value = 'gpt-4o-mini';
    root.querySelector('[name="ai-api-key"]').value = 'sk-panel-key';
    root.querySelector('[data-action="ai-save"]').click();
    assert.equal(win.localStorage.getItem(WD_AI_STORAGE_KEYS.apiKey), 'sk-panel-key');

    // Open Knowledge Guide modal -> defaults to zero-AI Quick View + shows token estimates + hides full timeline
    root.querySelector('[data-action="knowledge-open"]').click();
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    const modal = root.querySelector('[data-knowledge-modal]');
    assert.ok(modal);
    assert.match(modal.querySelector('[data-kg-mode]').textContent, /零 AI 速览/u);
    assert.equal(modal.querySelector('[data-kg-pane="quick"]').hidden, false);
    assert.equal(modal.querySelector('[data-kg-pane="detail"]').hidden, true);
    assert.equal(modal.querySelector('[data-kg-pane="quick"] [data-kg-timeline]'), null);
    assert.ok(modal.querySelector('[data-kg-pane="detail"] [data-kg-timeline]'));
    assert.match(modal.querySelector('[data-kg-estimate]').textContent, /当前课节预估.*整门课程预估/su);
    assert.ok(modal.querySelector('svg[data-kg-svg] .wd-fallback-node'));

    // Trigger AI section analysis with invalid key -> falls back cleanly to zero-AI with banner
    modal.querySelector('[data-action="kg-ai-section"]').click();
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    assert.match(modal.querySelector('[data-kg-mode]').textContent, /已回退零 AI/u);
    assert.match(modal.querySelector('[data-kg-banner]').textContent, /API Key 无效|HTTP 401/u);

    // Close modal -> SVG removed
    modal.querySelector('[data-action="kg-close"]').click();
    assert.equal(root.querySelector('svg'), null);

    // One-click clear Key
    root.querySelector('[data-action="ai-clear-key"]').click();
    assert.equal(win.localStorage.getItem(WD_AI_STORAGE_KEYS.apiKey), null);
    assert.equal(root.querySelector('[name="ai-api-key"]').value, '');

    panel.destroy();
  } finally {
    dom.window.close();
  }
});

test('超长单课节二次切片、聚合失败保留每段一句话降级、多课节局部失败回退与 GM_xmlhttpRequest 通道', async () => {
  const longCues = Array.from({ length: 12 }, (_, idx) => ({
    startMs: idx * 10000,
    endMs: idx * 10000 + 8000,
    text: `第${idx + 1}段详细讲稿内容：生产作业风险分级管控与隐患排查治理双重预防机制说明。`,
  }));
  const courseData = {
    courseId: 'c2',
    title: '双重预防机制',
    activeSectionId: 's1',
    sections: [
      { sectionId: 's1', sectionIndex: 1, title: '超长第一节', active: true, cues: longCues },
      { sectionId: 's2', sectionIndex: 2, title: '第二节', active: false, cues: [{ startMs: 5000, endMs: 9000, text: '隐患排查清单化闭环管理。' }] },
    ],
  };

  let gmS1Chunks = 0;
  let gmS1Agg = 0;
  let gmS2Calls = 0;
  let fetchCalls = 0;
  const gmRequest = opts => {
    const payload = JSON.parse(opts.data);
    const userText = payload.messages[1].content;
    if (userText.includes('各分段结果')) {
      // Simulate section-level aggregation failure -> must retain per-chunk 1-line summaries
      gmS1Agg += 1;
      opts.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: 'not valid json at all' } }] }) });
      return { abort() {} };
    }
    if (userText.includes('超长第一节')) {
      gmS1Chunks += 1;
      opts.onload({
        status: 200,
        responseText: JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                summary: `第${gmS1Chunks}段核心结论`,
                keyPoints: [{ text: `要点${gmS1Chunks}`, time: gmS1Chunks === 1 ? '00:00' : '01:00' }],
                outline: [{ name: `子段${gmS1Chunks}`, points: [{ text: `要点${gmS1Chunks}`, time: gmS1Chunks === 1 ? '00:00' : '01:00' }] }],
              }),
            },
          }],
        }),
      });
      return { abort() {} };
    }
    gmS2Calls += 1;
    opts.onerror({ error: 'network_fail' });
    return { abort() {} };
  };
  const fetchFn = async () => {
    fetchCalls += 1;
    return { status: 429, text: async () => '{"error":{"message":"quota exceeded"}}' };
  };

  const settings = { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: 'sk-gm', transport: 'auto' };
  const result = await summarizeCourseWithAi(courseData, settings, {
    scope: 'course',
    maxSectionChars: 220, // force s1 to split into multiple chunks
    gmRequest,
    fetchFn,
  });

  assert.ok(gmS1Chunks >= 2, '超长单课节应自动二次切分为多个子段请求');
  assert.equal(gmS1Agg, 1, '多子段完成后应尝试课节级聚合');
  assert.equal(gmS2Calls, 1);
  assert.equal(fetchCalls, 1);
  assert.equal(result.usedAi, true);
  assert.equal(result.fallback, true);
  assert.equal(result.tree.mode, 'ai-partial');
  assert.equal(result.channel, 'gm');
  assert.equal(result.tree.sections[0].mode, 'ai');
  assert.equal(result.tree.sections[0].chunkSummaries.length, gmS1Chunks);
  assert.equal(result.tree.sections[0].topics.length, gmS1Chunks);
  assert.equal(result.tree.sections[1].mode, 'zero-ai');
  assert.equal(result.failedSections.length, 1);
  assert.match(result.tree.warnings.join('\n'), /每段一句话摘要/u);
  assert.match(result.markdown, /要点1 \[00:00\]\(#wd-seek-s1-0\)/u);
  assert.match(result.markdown, /要点2 \[01:00\]\(#wd-seek-s1-60\)/u);
});

test('宽松 JSON 解析容忍围栏、前后缀文字、尾随逗号及字段别名，并补全缺失字段', () => {
  const messy = `好的，以下是整理结果：
  \`\`\`json
  {
    "oneLineSummary": "掌握 AI 权限边界与四维防护落地",
    "key_points": [
      {"text": "智能体越权会把风险带入现实业务", "time": "00:45"},
      "算法备案与内容标识是上线硬门槛",
    ],
    "outline": [
      {"title": "风险演进", "items": [{"point": "提示词注入劫持", "timestamp": "01:10"},]},
    ],
    "qa": [{"q": "什么是提示词注入？", "a": "恶意输入诱导模型执行越权指令", "time": "01:10"}],
    "terms": [{"word": "JSA", "meaning": "作业前安全分析方法", "time": "02:00",}],
  }
  \`\`\`
  祝学习顺利！`;
  const parsed = parseStrictJsonContent(messy);
  const norm = normalizeSectionStudyPayload(parsed);
  assert.equal(norm.summary, '掌握 AI 权限边界与四维防护落地');
  assert.equal(norm.keyPoints.length, 2);
  assert.equal(norm.keyPoints[0].seconds, 45);
  assert.equal(norm.outline.length, 1);
  assert.equal(norm.outline[0].name, '风险演进');
  assert.equal(norm.quiz.length, 1);
  assert.equal(norm.quiz[0].question, '什么是提示词注入？');
  assert.equal(norm.glossary.length, 1);
  assert.equal(norm.glossary[0].term, 'JSA');

  // Partial JSON (only summary + keyPoints, no outline/quiz/glossary) still succeeds cleanly
  const minimal = normalizeSectionStudyPayload({ summary: '极简摘要', keyPoints: [{ text: '核心结论一', time: '00:10' }] });
  assert.equal(minimal.outline.length, 1);
  assert.equal(minimal.quiz.length, 0);
  assert.equal(minimal.glossary.length, 0);
});

test('速览/细读双档交互、三级默认折叠、自测答案隐藏切换、localStorage 秒开缓存与重新生成', async () => {
  const dom = new JSDOM(`
    <div class="course-side-title-row"><span class="text-overflow" title="AI安全实战">AI安全实战</span></div>
    <div class="chapter-list chapter-all"><ul><li>
      <div class="list-title">第一章</div>
      <dl class="focus" id="D1show-sectionssec-a" data-courseId="c-cache"><dt><span class="qcontent" title="第一节 风险识别">第一节 风险识别</span></dt></dl>
    </li></ul></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-cache/6' });
  try {
    const win = dom.window;
    const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
    const controller = { getState: () => structuredClone(state), subscribe: () => () => {}, diagnose: () => ({ kind: 'course' }) };
    const pageWin = {
      videojs: {
        getPlayers: () => ({
          p1: {
            isDisposed: () => false,
            el: () => win.document.body,
            textTracks: () => [{
              kind: 'captions',
              label: '开启',
              cues: [
                { startTime: 10, endTime: 20, text: 'AI 智能体权限边界扩张导致风险升级，需要全生命周期防护。' },
                { startTime: 70, endTime: 85, text: '接下来介绍 JSA 与算法备案四件套监管要求。' },
              ],
            }],
          },
        }),
      },
    };
    saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-valid-mock', transport: 'fetch' });

    let aiRequests = 0;
    const fakeFetch = async () => {
      aiRequests += 1;
      return {
        status: 200,
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                summary: `第${aiRequests}次生成：一分钟掌握 AI 权限风险与四件套合规`,
                keyPoints: [
                  { text: 'AI 权限扩大使风险进入真实业务系统', time: '00:10' },
                  { text: '上线前须落实算法备案与内容标识', time: '01:10' },
                  { text: '安全运营需建立全周期防护闭环', time: '01:15' },
                ],
                outline: [
                  { name: '风险升级脉络', points: [{ text: '问答助手到智能体演进', time: '00:10' }, { text: '提示词注入与越权执行', time: '00:15' }] },
                  { name: '合规与落地台账', points: [{ text: '算法备案与安全评估', time: '01:10' }] },
                ],
                quiz: [
                  { question: '为什么智能体比问答助手风险更高？', answer: '因为智能体拥有工具与系统执行权限，错误操作会直接影响业务。', time: '00:10' },
                ],
                glossary: [
                  { term: 'JSA', definition: '作业前安全分析，用来提前识别步骤风险。', time: '01:10' },
                ],
              }),
            },
          }],
        }),
      };
    };

    const knowledge = createKnowledgeService({ win, pageWin, controller, fetchFn: fakeFetch });
    knowledge.mapOptions = { skipCdn: true };
    const panel = createPanel(win, controller, 'test-ver', knowledge);
    panel.open();
    const root = win.document.getElementById('wangda-assistant').shadowRoot;

    // 1. Open modal first time -> no cache yet -> zero-AI quick view
    root.querySelector('[data-action="knowledge-open"]').click();
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    let modal = root.querySelector('[data-knowledge-modal]');
    assert.equal(aiRequests, 0);
    assert.equal(modal.querySelector('[data-kg-pane="quick"]').hidden, false);

    // 2. Run AI section analysis -> populates structured cards & caches to localStorage
    modal.querySelector('[data-action="kg-ai-section"]').click();
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    assert.equal(aiRequests, 1);
    assert.match(modal.querySelector('[data-kg-section-summary]').textContent, /第1次生成/u);
    assert.equal(modal.querySelectorAll('[data-kg-keypoints] li').length, 3);
    // 3rd level outline collapsed by default!
    const folds = [...modal.querySelectorAll('[data-kg-outline] details.kg-topic-fold')];
    assert.equal(folds.length, 2);
    assert.ok(folds.every(d => d.open === false));
    // Quiz answer hidden by default, revealed on click!
    const ans = modal.querySelector('[data-kg-quiz-answer]');
    assert.equal(ans.hidden, true);
    modal.querySelector('[data-action="kg-quiz-toggle-1-0"]').click();
    assert.equal(ans.hidden, false);
    // Glossary rendered
    assert.match(modal.querySelector('[data-kg-glossary]').textContent, /JSA/u);
    // Cache stored in localStorage
    const cacheKey = buildKnowledgeCacheKey('c-cache', 'section', 'sec-a');
    assert.ok(loadKnowledgeCache(win, cacheKey));

    // 3. Close and reopen -> instant cache hit with ZERO extra LLM calls!
    modal.querySelector('[data-action="kg-close"]').click();
    root.querySelector('[data-action="knowledge-open"]').click();
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    modal = root.querySelector('[data-knowledge-modal]');
    assert.equal(aiRequests, 1, '二次打开应命中 localStorage 缓存，不重复烧 token');
    assert.equal(modal.querySelector('[data-kg-cache]').hidden, false);
    assert.match(modal.querySelector('[data-kg-section-summary]').textContent, /第1次生成/u);

    // 4. Switch to Detail view -> full timeline visible
    modal.querySelector('[data-action="kg-tab-detail"]').click();
    assert.equal(modal.querySelector('[data-kg-pane="quick"]').hidden, true);
    assert.equal(modal.querySelector('[data-kg-pane="detail"]').hidden, false);
    assert.ok(modal.querySelector('[data-kg-pane="detail"] [data-kg-timeline]'));

    // 5. Click Regenerate -> bypasses cache and runs fresh AI request
    modal.querySelector('[data-action="kg-regenerate"]').click();
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    assert.equal(aiRequests, 2);
    assert.match(modal.querySelector('[data-kg-section-summary]').textContent, /第2次生成/u);
    assert.equal(modal.querySelector('[data-kg-cache]').hidden, true);

    // Confirm saveKnowledgeCache utility roundtrip
    assert.equal(saveKnowledgeCache(win, 'manual-key', { tree: { courseTitle: 't', sections: [] }, markdown: '# t', usedAi: true }), true);
    assert.ok(loadKnowledgeCache(win, 'manual-key'));

    panel.destroy();
  } finally {
    dom.window.close();
  }
});

test('问答上下文分段：超长课节按相关性与时间线索精选片段并按时间序输出，避免爆 token', () => {
  const segments = Array.from({ length: 30 }, (_, idx) => ({
    index: idx + 1,
    startSec: idx * 60,
    timestamp: formatTimestamp(idx * 60),
    text: idx === 18
      ? '在第19分钟我们重点讲解零信任架构与微服务鉴权链路的设计原则。'
      : `第${idx + 1}段常规背景介绍内容，包含大量重复铺垫文字用于模拟超长课程讲稿分段测试。`,
  }));
  const ctx = selectRelevantSectionContext({ title: '架构安全', segments }, '零信任架构鉴权设计', { maxContextChars: 900 });
  assert.equal(ctx.truncated, true);
  assert.ok(ctx.selectedSegments < ctx.totalSegments);
  assert.match(ctx.contextText, /零信任架构与微服务鉴权链路/u);
  assert.match(ctx.contextText, /18:00/u);
  // Chronological order preserved
  const matches = [...ctx.contextText.matchAll(/\[(\d{2}:\d{2}) ·/gu)].map(m => parseTimestampToSeconds(m[1]));
  for (let i = 1; i < matches.length; i += 1) {
    assert.ok(matches[i] >= matches[i - 1], '精选字幕片段应保持时间顺序');
  }
});

test('课节级多轮问答：按课节独立持久化上下文、带时间依据跳播、无 Key 显式提示需先配置 AI', async () => {
  const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-qa/6' });
  try {
    const win = dom.window;
    const sec1 = { sectionId: 's1', title: '第1节 风险演进', segments: [{ startSec: 75, timestamp: '01:15', text: '提示词注入会诱导模型越权执行操作。' }] };
    const sec2 = { sectionId: 's2', title: '第2节 合规台账', segments: [{ startSec: 125, timestamp: '02:05', text: '上线前必须完成算法备案与内容标识。' }] };

    // 1. No API key -> explicit prompt, zero network calls
    let calls = 0;
    const noKeyRes = await askSectionQuestion({
      win, courseTitle: 'AI安全', courseId: 'c-qa', section: sec1, question: '什么是提示词注入？',
      fetchFn: async () => { calls += 1; throw new Error('should not call'); },
    });
    assert.equal(noKeyRes.ok, false);
    assert.equal(noKeyRes.needsAiConfig, true);
    assert.match(noKeyRes.error, /需先配置 AI/u);
    assert.equal(calls, 0);

    // 2. Multi-turn Q&A in sec1 + isolated history in sec2
    saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-qa', transport: 'fetch' });
    const sentHistories = [];
    const fakeFetch = async (_url, init) => {
      const payload = JSON.parse(init.body);
      sentHistories.push(payload.messages);
      const q = payload.messages.at(-1).content;
      const reply = q.includes('备案')
        ? { answer: '约第 3 分钟 (02:05) 提到上线前须完成算法备案。', citations: [{ time: '02:05', note: '算法备案与内容标识' }] }
        : { answer: '约第 2 分钟 (01:15) 讲到提示词注入可诱导模型越权。', citations: [{ time: '01:15', note: '提示词注入风险' }] };
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }) };
    };

    const r1 = await askSectionQuestion({ win, courseTitle: 'AI安全', courseId: 'c-qa', section: sec1, question: '提示词注入有什么危害？', fetchFn: fakeFetch });
    assert.equal(r1.ok, true);
    assert.equal(r1.message.citations[0].seconds, 75);
    assert.equal(r1.message.citations[0].minuteLabel, '约第 2 分钟');

    // Follow-up in sec1 includes turn-1 history
    const r2 = await askSectionQuestion({ win, courseTitle: 'AI安全', courseId: 'c-qa', section: sec1, question: '那怎么预防？', fetchFn: fakeFetch });
    assert.equal(r2.ok, true);
    assert.ok(sentHistories[1].some(m => m.role === 'user' && m.content.includes('提示词注入有什么危害')));
    assert.equal(loadSectionChat(win, 'c-qa', 's1').messages.length, 4);

    // Switch to sec2 -> independent empty history, never leaks sec1 messages
    const r3 = await askSectionQuestion({ win, courseTitle: 'AI安全', courseId: 'c-qa', section: sec2, question: '需要做什么备案？', fetchFn: fakeFetch });
    assert.equal(r3.ok, true);
    assert.equal(sentHistories[2].some(m => m.content.includes('提示词注入有什么危害')), false);
    assert.equal(loadSectionChat(win, 'c-qa', 's2').messages.length, 2);
    assert.equal(loadSectionChat(win, 'c-qa', 's1').messages.length, 4);
  } finally {
    dom.window.close();
  }
});

test('混合题型 AI 出题：选择题判分、简答题不自动判分、解析带时间点、localStorage 缓存与无 Key 提示', async () => {
  const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-quiz/6' });
  try {
    const win = dom.window;
    const sec = { sectionId: 's1', title: '第1节 四维防护', segments: [{ startSec: 25, timestamp: '00:25', text: '模型安全防范提示注入，数据安全防投毒。' }] };

    // No Key -> explicit prompt
    const noKey = await generateSectionQuiz({ win, courseTitle: 'AI安全', courseId: 'c-quiz', section: sec });
    assert.equal(noKey.ok, false);
    assert.equal(noKey.needsAiConfig, true);
    assert.match(noKey.error, /需先配置 AI/u);

    saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-quiz', transport: 'fetch' });
    let reqCount = 0;
    const fakeFetch = async () => {
      reqCount += 1;
      return {
        status: 200,
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                questions: [
                  { type: 'choice', question: '模型安全重点防范？', options: ['A. 提示词注入', 'B. 电源故障', 'C. 屏幕闪烁', 'D. 键盘损坏'], correctIndex: 0, explanation: '约第1分钟 00:25 强调模型层防提示注入。', time: '00:25' },
                  { type: 'choice', question: '数据安全重点防范？', options: ['A. 音量过大', 'B. 训练投毒', 'C. 字体过小', 'D. 网线松动'], correctIndex: 1, explanation: '00:25 提到防数据投毒。', time: '00:25' },
                  { type: 'short', question: '简述四维防护包含哪两个重点？', referenceAnswer: '模型层防提示注入、数据层防泄露与投毒。', explanation: '参见 00:25。', time: '00:25' },
                ],
              }),
            },
          }],
        }),
      };
    };

    const g1 = await generateSectionQuiz({ win, courseTitle: 'AI安全', courseId: 'c-quiz', section: sec, fetchFn: fakeFetch });
    assert.equal(g1.ok, true);
    assert.equal(g1.fromCache, false);
    assert.equal(reqCount, 1);
    assert.equal(g1.quiz.questions.length, 3);
    assert.equal(g1.quiz.questions[0].type, 'choice');
    assert.equal(g1.quiz.questions[2].type, 'short');

    // Second call hits localStorage cache with 0 network calls
    const g2 = await generateSectionQuiz({ win, courseTitle: 'AI安全', courseId: 'c-quiz', section: sec, fetchFn: fakeFetch });
    assert.equal(g2.ok, true);
    assert.equal(g2.fromCache, true);
    assert.equal(reqCount, 1);

    // Grade choice questions accurately; short answer is NOT auto-graded
    const graded = gradeSectionQuiz(g1.quiz.questions, { 'q-1': 0, 'q-2': 0, 'q-3': '我的简答内容' });
    assert.equal(graded.choiceTotal, 2);
    assert.equal(graded.choiceCorrect, 1);
    assert.equal(graded.percent, 50);
    assert.equal(graded.shortTotal, 1);
    assert.equal(graded.details['q-3'].autoGraded, false);
    assert.ok(loadSectionQuiz(win, 'c-quiz', 's1'));
  } finally {
    dom.window.close();
  }
});

test('每课节旁嵌入「AI 导览」按钮：仅对有字幕且学习中/已完成课节显示、点击不触发平台默认切节/折叠、缺失目录时优雅降级', async () => {
  const dom = new JSDOM(`
    <div class="course-side-title-row"><span class="text-overflow" title="AI安全实战">AI安全实战</span></div>
    <div class="chapter-list chapter-all"><ul>
      <li id="chap-1">
        <div class="list-title" id="D1list-item-1">第一章</div>
        <dl class="focus" id="D1show-sectionssec-1" data-sectionType="6" data-courseId="c-inline" data-resourceId="att-1">
          <dt><span class="qcontent" title="第1节 风险演进">第1节 风险演进</span></dt>
          <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>学习中</span></div></dd>
        </dl>
        <dl id="D1show-sectionssec-2" data-sectionType="6" data-courseId="c-inline" data-resourceId="att-2">
          <dt><span class="qcontent" title="第2节 合规台账">第2节 合规台账</span></dt>
          <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>已完成</span></div></dd>
        </dl>
        <dl id="D1show-sectionssec-3" data-sectionType="6" data-courseId="c-inline" data-resourceId="att-3">
          <dt><span class="qcontent" title="第3节 未学课节">第3节 未学课节</span></dt>
          <dd><div class="item sub-text">视频</div><div class="item start pointer"><span>未开始</span></div></dd>
        </dl>
      </li>
    </ul></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-inline/6' });
  try {
    const win = dom.window;
    const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
    const controller = { getState: () => structuredClone(state), subscribe: () => () => {}, diagnose: () => ({ kind: 'course' }) };
    const pageWin = {
      location: win.location,
      app: {
        _modules: {
          'study/course/detail--c-inline': {
            store: {
              models: {
                course: {
                  data: {
                    id: 'c-inline',
                    name: 'AI安全实战',
                    courseChapters: [{
                      name: '第一章',
                      courseChapterSections: [
                        { id: 'sec-1', name: '第1节 风险演进', attachmentId: 'att-1' },
                        { id: 'sec-2', name: '第2节 合规台账', attachmentId: 'att-2' },
                        { id: 'sec-3', name: '第3节 未学课节', attachmentId: 'att-3' },
                      ],
                    }],
                  },
                },
                trackList: {
                  data: [
                    { attachmentId: 'att-1', captionVtt: 'https://wangda.chinamobile.com/default/M00/s1.vtt' },
                    { attachmentId: 'att-2', captionVtt: 'https://wangda.chinamobile.com/default/M00/s2.vtt' },
                    { attachmentId: 'att-3', captionVtt: 'https://wangda.chinamobile.com/default/M00/s3.vtt' },
                  ],
                },
              },
            },
          },
        },
      },
    };
    const knowledge = createKnowledgeService({
      win,
      pageWin,
      controller,
      fetchFn: async () => ({ status: 200, text: async () => 'WEBVTT\n\n00:00:05.000 --> 00:00:10.000\n合规台账与算法备案是核心要求。' }),
    });
    knowledge.mapOptions = { skipCdn: true };
    const panel = createPanel(win, controller, 'test-ver', knowledge);
    const root = win.document.getElementById('wangda-assistant').shadowRoot;
    for (let i = 0; i < 40; i += 1) await Promise.resolve();

    // 1. Buttons injected ONLY on learning/completed captioned sections (sec-1, sec-2), NOT on unstarted sec-3; adapter.readPage() unaffected!
    const btns = [...win.document.querySelectorAll('button[data-wd-section-guide]')];
    assert.deepEqual(btns.map(b => b.dataset.wdSectionGuide), ['sec-1', 'sec-2']);
    assert.equal(btns[0].textContent, '💡 AI 导览');
    assert.equal(win.document.querySelector('button[data-wd-section-guide="sec-3"]'), null);
    const parsedPage = readPage(win.document, '#/study/course/detail/c-inline/6');
    assert.equal(parsedPage.sections.length, 3);
    assert.equal(parsedPage.sections[0].status, 'learning');
    assert.equal(parsedPage.sections[1].status, 'completed');
    assert.equal(parsedPage.sections[2].status, 'not-started');
    assert.equal(parsedPage.sections[1].title, '第2节 合规台账');

    // 2. Clicking section-2 inline button must NOT bubble to platform <dl> or <li> handlers
    let dlClicks = 0;
    let liClicks = 0;
    win.document.getElementById('D1show-sectionssec-2').addEventListener('click', () => { dlClicks += 1; });
    win.document.getElementById('chap-1').addEventListener('click', () => { liClicks += 1; });

    const sec2Btn = win.document.querySelector('button[data-wd-section-guide="sec-2"]');
    sec2Btn.click();
    for (let i = 0; i < 40; i += 1) await Promise.resolve();

    assert.equal(dlClicks, 0, '点击课节旁导览按钮不应触发平台 dl 切节监听');
    assert.equal(liClicks, 0, '点击课节旁导览按钮不应冒泡到章节容器');

    const modal = root.querySelector('[data-knowledge-modal]');
    assert.ok(modal, '应直接打开导览弹窗');
    assert.equal(modal.querySelector('[data-kg-section-picker]').value, 'sec-2');
    assert.match(modal.querySelector('[data-kg-scope]').textContent, /第2节 合规台账/u);
    assert.match(modal.querySelector('[data-kg-qa-title]').textContent, /第2节 合规台账/u);
    // Without API Key, Q&A dock shows explicit "需先配置 AI" warning
    assert.equal(modal.querySelector('[data-kg-qa-noai]').hidden, false);
    assert.match(modal.querySelector('[data-kg-qa-noai]').textContent, /需先配置 AI/u);
    // Switching to Quiz tab without Key also shows explicit "需先配置 AI"
    modal.querySelector('[data-action="kg-tab-quiz"]').click();
    assert.match(modal.querySelector('[data-kg-quiz-noai]').textContent, /需先配置 AI/u);

    panel.destroy();
    assert.equal(win.document.querySelectorAll('button[data-wd-section-guide]').length, 0);

    // 3. Graceful fallback when section list container does not exist
    const domNoList = new JSDOM('<body><p>未知页面结构</p></body>', { url: 'https://wangda.chinamobile.com/#/home' });
    const mounted = mountSectionGuideButtons({ win: domNoList.window, onOpenSection: () => {} });
    assert.equal(mounted.refresh(), 0);
    mounted.destroy();
    domNoList.window.close();
  } finally {
    dom.window.close();
  }
});

test('无字幕容错场景 1（字幕缺失）：不崩溃不卡加载，完整记录多路诊断日志，UI 显示「本课无字幕」并禁用问答/出题/AI 分析按钮', async () => {
  const dom = new JSDOM(`
    <div class="course-side-title-row"><span class="text-overflow" title="传统老课无字幕">传统老课无字幕</span></div>
    <div class="chapter-list chapter-all"><ul><li>
      <div class="list-title">第一章</div>
      <dl class="focus" id="D1show-sectionssec-nosub" data-courseId="c-nosub" data-resourceId="att-none">
        <dt><span class="qcontent" title="第1节 无字幕实录">第1节 无字幕实录</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>学习中</span></div></dd>
      </dl>
    </li></ul></div>
    <div class="video-js" id="pNoSub"><video></video></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-nosub/6' });
  try {
    const win = dom.window;
    const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
    const controller = { getState: () => structuredClone(state), subscribe: () => () => {}, diagnose: () => ({ kind: 'course' }) };
    const pageWin = {
      location: win.location,
      videojs: {
        getPlayers: () => ({
          p1: {
            isDisposed: () => false,
            el: () => win.document.getElementById('pNoSub'),
            textTracks: () => [
              { kind: 'metadata', label: 'segment-metadata', cues: [{ startTime: 0, endTime: 1, text: '{"uri":"seg.ts","bandwidth":1000}' }] },
            ],
          },
        }),
      },
      app: {
        _modules: {
          'study/course/detail--c-nosub': {
            store: {
              models: {
                course: { data: { id: 'c-nosub', name: '传统老课无字幕', courseChapters: [{ name: '第一章', courseChapterSections: [{ id: 'sec-nosub', name: '第1节 无字幕实录', attachmentId: 'att-none' }] }] } },
                trackList: { data: [] },
              },
            },
          },
        },
      },
    };
    saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-nosub-test', transport: 'fetch' });

    let llmCalls = 0;
    const fakeFetch = async url => {
      if (url.includes('/course-study/caption/')) {
        return { status: 200, text: async () => '[]' };
      }
      llmCalls += 1;
      throw new Error('无字幕课程不应发起 LLM 请求');
    };

    const knowledge = createKnowledgeService({ win, pageWin, controller, fetchFn: fakeFetch });
    knowledge.mapOptions = { skipCdn: true };
    const panel = createPanel(win, controller, 'test-ver', knowledge);
    panel.open();
    const root = win.document.getElementById('wangda-assistant').shadowRoot;

    root.querySelector('[data-action="knowledge-open"]').click();
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    const modal = root.querySelector('[data-knowledge-modal]');
    assert.ok(modal);
    // Not stuck on loading; explicitly classified as 本课无字幕
    assert.equal(modal.querySelector('[data-kg-mode]').textContent, '本课无字幕');
    assert.equal(modal.querySelector('[data-kg-mode]').dataset.tone, 'nosub');
    assert.match(modal.querySelector('[data-kg-no-subtitle]').textContent, /本课无字幕.*无可用 AI 字幕/su);
    assert.match(modal.querySelector('[data-kg-banner]').textContent, /本课无字幕/u);

    // Dependent buttons & Q&A input disabled / greyed out
    assert.equal(modal.querySelector('[data-action="kg-ai-section"]').disabled, true);
    assert.equal(modal.querySelector('[data-action="kg-ai-course"]').disabled, true);
    assert.equal(modal.querySelector('[data-action="kg-ai-quiz"]').disabled, true);
    assert.equal(modal.querySelector('[data-kg-qa-input]').disabled, true);
    assert.equal(modal.querySelector('[data-action="kg-qa-send"]').disabled, true);
    assert.equal(modal.querySelector('[data-kg-qa-nosub]').hidden, false);

    // Quiz tab also disables generate button & explains 本课无字幕
    modal.querySelector('[data-action="kg-tab-quiz"]').click();
    assert.equal(modal.querySelector('[data-action="kg-quiz-generate"]').disabled, true);
    assert.match(modal.querySelector('[data-kg-quiz-nosub]').textContent, /本课无字幕/u);

    // Diagnostic log fold captures every failed path (Path 1 -> Path 2 -> Path 3)
    const diagLogText = modal.querySelector('[data-kg-sub-diag-log]').textContent;
    assert.match(diagLogText, /1\. 课节 captionVtt 直链/u);
    assert.match(diagLogText, /2\. Video\.js textTracks/u);
    assert.match(diagLogText, /3a\. 课程字幕接口/u);
    assert.match(diagLogText, /3b\. 原生 video\.textTracks/u);

    // Section list DOM must NOT show any "AI 导览" button, greyed placeholder, or "无字幕" tag for captionless section
    assert.equal(win.document.querySelector('button[data-wd-section-guide="sec-nosub"]'), null, '无字幕课节旁不应显示 AI 导览按钮或置灰占位');
    assert.equal(win.document.querySelector('span[data-wd-section-nocap="sec-nosub"]'), null, '无字幕课节旁不应显示无字幕提示标签');

    // Direct API calls to summarize / QA / quiz also guard with 0 LLM requests
    const lastData = knowledge.getLastCourseData();
    assert.equal(lastData.sections[0].hasSubtitle, false);
    assert.equal(lastData.sections[0].subtitleStatus, 'no-subtitle');
    const sumRes = await summarizeCourseWithAi(lastData, loadAiSettings(win), { scope: 'section', fetchFn: fakeFetch });
    assert.equal(sumRes.noSubtitle, true);
    assert.equal(sumRes.usedAi, false);
    const qaRes = await askSectionQuestion({ win, courseTitle: '传统老课', courseId: 'c-nosub', section: lastData.sections[0], question: '讲了什么？', fetchFn: fakeFetch });
    assert.equal(qaRes.ok, false);
    assert.equal(qaRes.noSubtitle, true);
    const quizRes = await generateSectionQuiz({ win, courseTitle: '传统老课', courseId: 'c-nosub', section: lastData.sections[0], fetchFn: fakeFetch });
    assert.equal(quizRes.ok, false);
    assert.equal(quizRes.noSubtitle, true);
    assert.equal(llmCalls, 0);

    // Panel "页面诊断" also exposes subtitleDiagnostics
    modal.querySelector('[data-action="kg-close"]').click();
    root.querySelector('[data-action="diagnose"]').click();
    const diagJson = JSON.parse(root.querySelector('[data-diagnostic-box] pre').textContent);
    assert.equal(diagJson.subtitleDiagnostics.captionedSections, 0);
    assert.ok(diagJson.subtitleDiagnostics.logs.length >= 4);

    panel.destroy();
  } finally {
    dom.window.close();
  }
});

test('无字幕容错场景 2（HTTP 404）与场景 3（空内容 / 解析出 0 条 cue）：记录状态码与脱敏 URL 并干净降级为本课无字幕', async () => {
  const dom = new JSDOM(`
    <div class="chapter-list chapter-all"><ul><li>
      <dl class="focus" id="D1show-sectionssec-404" data-courseId="c-err" data-resourceId="att-404"><dt><span class="qcontent" title="404课节">404课节</span></dt></dl>
      <dl id="D1show-sectionssec-empty" data-courseId="c-err" data-resourceId="att-empty"><dt><span class="qcontent" title="空内容课节">空内容课节</span></dt></dl>
      <dl id="D1show-sectionssec-zero" data-courseId="c-err" data-resourceId="att-zero"><dt><span class="qcontent" title="零Cue课节">零Cue课节</span></dt></dl>
    </li></ul></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-err/6' });
  try {
    const win = dom.window;
    const pageWin = {
      location: win.location,
      app: {
        _modules: {
          'study/course/detail--c-err': {
            store: {
              models: {
                course: {
                  data: {
                    id: 'c-err',
                    name: '字幕异常样本课',
                    courseChapters: [{
                      name: '异常测试章',
                      courseChapterSections: [
                        { id: 'sec-404', name: '404课节', attachmentId: 'att-404' },
                        { id: 'sec-empty', name: '空内容课节', attachmentId: 'att-empty' },
                        { id: 'sec-zero', name: '零Cue课节', attachmentId: 'att-zero' },
                      ],
                    }],
                  },
                },
                trackList: {
                  data: [
                    { attachmentId: 'att-404', captionVtt: 'https://wangda.chinamobile.com/default/M00/missing.vtt?token=secret123' },
                    { attachmentId: 'att-empty', captionVtt: 'https://wangda.chinamobile.com/default/M00/empty.vtt' },
                    { attachmentId: 'att-zero', captionVtt: 'https://wangda.chinamobile.com/default/M00/only-note.vtt' },
                  ],
                },
              },
            },
          },
        },
      },
    };

    const httpGet = async url => {
      if (url.includes('missing.vtt')) {
        const err = new Error('HTTP 404');
        err.status = 404;
        throw err;
      }
      if (url.includes('empty.vtt')) return { status: 200, text: '   \n\t  ' };
      if (url.includes('only-note.vtt')) return { status: 200, text: 'WEBVTT\n\nNOTE 只有注释，没有字幕条目\n\nSTYLE\n::cue { color: #fff; }' };
      if (url.includes('/course-study/caption/')) {
        const err = new Error('HTTP 404');
        err.status = 404;
        throw err;
      }
      throw new Error('unexpected url: ' + url);
    };

    const data = await collectCourseSubtitles({ win, pageWin, scope: 'course', httpGet, toggleWaitMs: 0 });
    assert.equal(data.captionedSections, 0);
    assert.equal(data.hasAnySubtitle, false);
    assert.equal(data.skippedNoSubtitleSections.length, 3);

    // 1. 404 section: status=404 recorded, token redacted in diagnostic URL
    const s404 = data.sections.find(s => s.sectionId === 'sec-404');
    assert.equal(s404.hasSubtitle, false);
    assert.equal(s404.subtitleStatus, 'fetch-404');
    const log404 = s404.subtitleLogs.find(l => l.path === 'captionVtt');
    assert.equal(log404.ok, false);
    assert.equal(log404.status, 404);
    assert.match(log404.reason, /404/u);
    assert.ok(log404.url.includes('missing.vtt'));
    assert.equal(log404.url.includes('secret123'), false, '诊断日志 URL 应脱敏 token 参数');

    // 2. Empty VTT section
    const sEmpty = data.sections.find(s => s.sectionId === 'sec-empty');
    assert.equal(sEmpty.hasSubtitle, false);
    assert.equal(sEmpty.subtitleStatus, 'empty-vtt');
    const logEmpty = sEmpty.subtitleLogs.find(l => l.path === 'captionVtt');
    assert.equal(logEmpty.status, 200);
    assert.equal(logEmpty.cueCount, 0);
    assert.match(logEmpty.reason, /空内容/u);

    // 3. Zero-cue VTT section
    const sZero = data.sections.find(s => s.sectionId === 'sec-zero');
    assert.equal(sZero.hasSubtitle, false);
    assert.equal(sZero.subtitleStatus, 'zero-cues');
    const logZero = sZero.subtitleLogs.find(l => l.path === 'captionVtt');
    assert.equal(logZero.status, 200);
    assert.equal(logZero.cueCount, 0);
    assert.match(logZero.reason, /0 条有效 cue/u);
  } finally {
    dom.window.close();
  }
});

test('多路回退验证：路径 1 404 → 路径 2 切换 Video.js AI 字幕开关后读出 cues；以及路径 3 课程字幕接口兜底补拉', async () => {
  // Case A: Path 1 returns 404 -> Path 2a cues empty (mode disabled) -> Path 2b toggling mode loads cues
  const domA = new JSDOM(`
    <div class="chapter-list chapter-all"><ul><li>
      <dl class="focus" id="D1show-sectionssec-tog" data-courseId="c-tog" data-resourceId="att-tog"><dt><span class="qcontent" title="需开字幕开关课节">需开字幕开关课节</span></dt></dl>
    </li></ul></div>
    <div class="video-js" id="pTog"><video></video><div class="vjs-captions-button"><div class="vjs-menu-item">开启</div></div></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-tog/6' });
  try {
    const win = domA.window;
    let modeVal = 'disabled';
    let cuesArr = [];
    const mockTrack = {
      kind: 'captions',
      label: '开启',
      get mode() { return modeVal; },
      set mode(v) {
        modeVal = v;
        if (v === 'hidden' || v === 'showing') {
          cuesArr = [{ startTime: 6, endTime: 11, text: '打开 AI 字幕开关后加载出的字幕内容。' }];
        }
      },
      get cues() { return cuesArr; },
    };
    const pageWin = {
      location: win.location,
      videojs: {
        getPlayers: () => ({
          p1: { isDisposed: () => false, el: () => win.document.getElementById('pTog'), textTracks: () => [mockTrack] },
        }),
      },
      app: {
        _modules: {
          'study/course/detail--c-tog': {
            store: {
              models: {
                course: { data: { id: 'c-tog', name: '切换开关测试课', courseChapters: [{ name: '一', courseChapterSections: [{ id: 'sec-tog', name: '需开字幕开关课节', attachmentId: 'att-tog' }] }] } },
                trackList: { data: [{ attachmentId: 'att-tog', captionVtt: 'https://wangda.chinamobile.com/default/M00/gone.vtt' }] },
              },
            },
          },
        },
      },
    };
    const dataA = await collectCourseSubtitles({
      win,
      pageWin,
      scope: 'section',
      httpGet: async () => { const e = new Error('HTTP 404'); e.status = 404; throw e; },
      toggleWaitMs: 0,
    });
    assert.equal(dataA.sections[0].hasSubtitle, true);
    assert.equal(dataA.sections[0].source, 'vjs-cues-after-toggle');
    assert.equal(dataA.sections[0].cues[0].text, '打开 AI 字幕开关后加载出的字幕内容。');
    assert.equal(dataA.subtitleDiagnostics[0].path, 'captionVtt');
    assert.equal(dataA.subtitleDiagnostics[0].status, 404);
    assert.equal(dataA.subtitleDiagnostics[1].path, 'videojs-textTracks');
    assert.equal(dataA.subtitleDiagnostics[1].ok, false);
    assert.equal(dataA.subtitleDiagnostics[2].path, 'videojs-toggle-captions');
    assert.equal(dataA.subtitleDiagnostics[2].ok, true);
  } finally {
    domA.window.close();
  }

  // Case B: Path 1 missing + Path 2 no player -> Path 3a caption API discovers captionVtt and fetches cues
  const domB = new JSDOM(`
    <div class="chapter-list chapter-all"><ul><li>
      <dl class="focus" id="D1show-sectionssec-api" data-courseId="c-api" data-resourceId="att-api"><dt><span class="qcontent" title="接口兜底课节">接口兜底课节</span></dt></dl>
    </li></ul></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-api/6' });
  try {
    const dataB = await collectCourseSubtitles({
      win: domB.window,
      pageWin: domB.window,
      scope: 'section',
      toggleWaitMs: 0,
      httpGet: async url => {
        if (url.includes('/api/v1/course-study/caption/c-api')) {
          return { status: 200, text: JSON.stringify([{ attachmentId: 'att-api', captionVtt: 'https://wangda.chinamobile.com/default/M00/from-api.vtt' }]) };
        }
        if (url.includes('from-api.vtt')) {
          return { status: 200, text: 'WEBVTT\n\n00:00:15.000 --> 00:00:20.000\n通过课程字幕接口补拉到的字幕原文。' };
        }
        throw new Error('unexpected ' + url);
      },
    });
    assert.equal(dataB.sections[0].hasSubtitle, true);
    assert.equal(dataB.sections[0].source, 'caption-api-vtt');
    assert.equal(dataB.sections[0].cues[0].text, '通过课程字幕接口补拉到的字幕原文。');
  } finally {
    domB.window.close();
  }
});

test('部分课节有字幕、部分无字幕：目录打「无字幕」角标，整课批量跳过并列出跳过课节名且不整体失败，有字幕节照常导览与问答', async () => {
  const dom = new JSDOM(`
    <div class="course-side-title-row"><span class="text-overflow" title="混合字幕实战课">混合字幕实战课</span></div>
    <div class="chapter-list chapter-all"><ul><li>
      <div class="list-title">第一章</div>
      <dl class="focus" id="D1show-sectionssec-ok" data-sectionType="6" data-courseId="c-mix" data-resourceId="att-ok">
        <dt><span class="qcontent" title="第1节 有字幕精讲">第1节 有字幕精讲</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>学习中</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-miss" data-sectionType="6" data-courseId="c-mix" data-resourceId="att-miss">
        <dt><span class="qcontent" title="第2节 实操无字幕">第2节 实操无字幕</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item start pointer"><span>未开始</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-404" data-sectionType="6" data-courseId="c-mix" data-resourceId="att-404">
        <dt><span class="qcontent" title="第3节 失效404课节">第3节 失效404课节</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item start pointer"><span>未开始</span></div></dd>
      </dl>
    </li></ul></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-mix/6' });
  try {
    const win = dom.window;
    const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
    const controller = { getState: () => structuredClone(state), subscribe: () => () => {}, diagnose: () => ({ kind: 'course' }) };
    const pageWin = {
      location: win.location,
      app: {
        _modules: {
          'study/course/detail--c-mix': {
            store: {
              models: {
                course: {
                  data: {
                    id: 'c-mix',
                    name: '混合字幕实战课',
                    courseChapters: [{
                      name: '第一章',
                      courseChapterSections: [
                        { id: 'sec-ok', name: '第1节 有字幕精讲', attachmentId: 'att-ok' },
                        { id: 'sec-miss', name: '第2节 实操无字幕', attachmentId: 'att-miss' },
                        { id: 'sec-404', name: '第3节 失效404课节', attachmentId: 'att-404' },
                      ],
                    }],
                  },
                },
                trackList: {
                  data: [
                    { attachmentId: 'att-ok', captionVtt: 'https://wangda.chinamobile.com/default/M00/ok.vtt' },
                    { attachmentId: 'att-404', captionVtt: 'https://wangda.chinamobile.com/default/M00/err404.vtt' },
                  ],
                },
              },
            },
          },
        },
      },
    };
    saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-mix', transport: 'fetch' });

    const llmSectionsCalled = [];
    const fakeFetch = async (url, init) => {
      if (url.includes('ok.vtt')) {
        return { status: 200, text: async () => 'WEBVTT\n\n00:00:10.000 --> 00:00:16.000\n本节讲解微服务熔断与降级隔离策略。' };
      }
      if (url.includes('err404.vtt') || url.includes('/course-study/caption/')) {
        return { status: 404, text: async () => 'Not Found' };
      }
      // LLM chat completions
      const body = JSON.parse(init.body);
      const userContent = body.messages.at(-1).content;
      llmSectionsCalled.push(userContent);
      if (body.messages[0].content.includes('学习问答助教')) {
        return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: '约第 1 分钟 (00:10) 讲到微服务熔断与降级隔离。', citations: [{ time: '00:10', note: '熔断隔离' }] }) } }] }) };
      }
      return {
        status: 200,
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                summary: '掌握微服务熔断与降级隔离策略',
                keyPoints: [{ text: '通过熔断与降级防止级联雪崩', time: '00:10' }],
                outline: [{ name: '高可用隔离', points: [{ text: '微服务熔断降级机制', time: '00:10' }] }],
              }),
            },
          }],
        }),
      };
    };

    const knowledge = createKnowledgeService({ win, pageWin, controller, fetchFn: fakeFetch });
    knowledge.mapOptions = { skipCdn: true };
    const panel = createPanel(win, controller, 'test-ver', knowledge);
    panel.open();
    const root = win.document.getElementById('wangda-assistant').shadowRoot;

    // 1. Only captioned + learning/completed section gets "💡 AI 导览" in page list; captionless sections get NO button and NO "无字幕" tag!
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    assert.ok(win.document.querySelector('button[data-wd-section-guide="sec-ok"]'), '有字幕且学习中的 sec-ok 应显示 AI 导览入口');
    assert.equal(win.document.querySelector('button[data-wd-section-guide="sec-miss"]'), null, '无字幕的 sec-miss 旁不应显示 AI 导览');
    assert.equal(win.document.querySelector('button[data-wd-section-guide="sec-404"]'), null, '404 无字幕的 sec-404 旁不应显示 AI 导览');
    assert.equal(win.document.querySelector('span[data-wd-section-nocap]'), null, '课节列表旁不显示无字幕占位标签');
    const parsedPage = readPage(win.document, '#/study/course/detail/c-mix/6');
    assert.equal(parsedPage.sections.length, 3);
    assert.equal(parsedPage.sections[1].title, '第2节 实操无字幕');

    // 2. Open modal -> collects all 3 sections; picker still notes [无字幕] for clarity while page list keeps zero clutter!
    root.querySelector('[data-action="knowledge-open"]').click();
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    const modal = root.querySelector('[data-knowledge-modal]');
    assert.ok(win.document.querySelector('button[data-wd-section-guide="sec-ok"]'));
    assert.equal(win.document.querySelector('button[data-wd-section-guide="sec-miss"]'), null);
    assert.equal(win.document.querySelector('button[data-wd-section-guide="sec-404"]'), null);
    assert.equal(win.document.querySelector('span[data-wd-section-nocap]'), null);
    const pickerTexts = [...modal.querySelectorAll('[data-kg-section-picker] option')].map(o => o.textContent);
    assert.match(pickerTexts[0], /第1节 有字幕精讲$/u);
    assert.match(pickerTexts[1], /第2节 实操无字幕 \[无字幕\]/u);
    assert.match(pickerTexts[2], /第3节 失效404课节 \[无字幕\]/u);

    // 3. Batch AI analysis for whole course -> skips sec-miss & sec-404, succeeds on sec-ok, lists skipped names!
    modal.querySelector('[data-action="kg-ai-course"]').click();
    for (let i = 0; i < 80; i += 1) await Promise.resolve();
    assert.equal(llmSectionsCalled.length, 1, '只应对有字幕的 sec-ok 发起 LLM 请求');
    assert.match(llmSectionsCalled[0], /第1节 有字幕精讲/u);
    assert.equal(modal.querySelector('[data-kg-mode]').textContent, 'AI 速览');
    const skippedBox = modal.querySelector('[data-kg-skipped-list]');
    assert.ok(skippedBox, '整课总览卡片应列出被跳过的无字幕课节名');
    assert.match(skippedBox.textContent, /第2节 实操无字幕/u);
    assert.match(skippedBox.textContent, /第3节 失效404课节/u);
    assert.match(modal.querySelector('[data-kg-banner]').textContent, /第2节 实操无字幕/u);
    assert.match(modal.querySelector('[data-kg-banner]').textContent, /第3节 失效404课节/u);

    // 4. Captioned section sec-ok still supports Q&A normally!
    assert.equal(modal.querySelector('[data-kg-qa-input]').disabled, false);
    modal.querySelector('[data-kg-qa-input]').value = '熔断有什么作用？';
    modal.querySelector('[data-action="kg-qa-send"]').click();
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    assert.match(modal.querySelector('[data-kg-qa-thread]').textContent, /微服务熔断与降级隔离/u);

    // 5. Switch to captionless sec-miss -> section AI/Quiz/QA buttons disabled, while course AI button stays ENABLED!
    modal.querySelector('[data-kg-section-picker]').value = 'sec-miss';
    modal.querySelector('[data-kg-section-picker]').dispatchEvent(new win.Event('change', { bubbles: true }));
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    assert.equal(modal.querySelector('[data-kg-mode]').textContent, '本课无字幕');
    assert.equal(modal.querySelector('[data-action="kg-ai-section"]').disabled, true);
    assert.equal(modal.querySelector('[data-action="kg-ai-quiz"]').disabled, true);
    assert.equal(modal.querySelector('[data-kg-qa-input]').disabled, true);
    assert.equal(modal.querySelector('[data-action="kg-qa-send"]').disabled, true);
    assert.equal(modal.querySelector('[data-action="kg-ai-course"]').disabled, false, '同课程存在其他有字幕课节时，整门课分析按钮应保持可用');

    panel.destroy();
  } finally {
    dom.window.close();
  }
});

test('AI 导览入口显示条件全组合矩阵：字幕可用/不可用 × 学习中/已学完/未开始 + 判不清保守不显示', async () => {
  // 1. Pure truth-table unit assertions
  const pureCases = [
    { name: '有字幕 × 学习中', hasSubtitle: true, input: { domStatus: 'learning' }, expected: true },
    { name: '有字幕 × 已学完', hasSubtitle: true, input: { domStatus: 'completed' }, expected: true },
    { name: '有字幕 × 未开始', hasSubtitle: true, input: { domStatus: 'not-started', active: false, isPlaying: false }, expected: false },
    { name: '有字幕 × 未开始(选中但未播放)', hasSubtitle: true, input: { domStatus: 'not-started', active: true, isPlaying: false }, expected: false },
    { name: '有字幕 × 当前正在播放', hasSubtitle: true, input: { domStatus: 'not-started', active: true, isPlaying: true }, expected: true },
    { name: '无字幕 × 学习中', hasSubtitle: false, input: { domStatus: 'learning' }, expected: false },
    { name: '无字幕 × 已学完', hasSubtitle: false, input: { domStatus: 'completed' }, expected: false },
    { name: '无字幕 × 未开始', hasSubtitle: false, input: { domStatus: 'not-started' }, expected: false },
    { name: '有字幕 × 判不清(unknown)', hasSubtitle: true, input: { domStatus: 'unknown', active: false }, expected: false },
    { name: '有字幕 × 判不清(未知文案且focus未播)', hasSubtitle: true, input: { domStatus: '待审核', active: true, isPlaying: false }, expected: false },
    { name: '有字幕 × 模型进度>0(DOM缺失)', hasSubtitle: true, input: { domStatus: 'unknown', progress: 35 }, expected: true },
    { name: '有字幕 × 模型进度100%(DOM缺失)', hasSubtitle: true, input: { domStatus: 'unknown', progress: 100 }, expected: true },
    { name: '有字幕 × 模型进度0%(DOM缺失)', hasSubtitle: true, input: { domStatus: 'unknown', progress: 0 }, expected: false },
  ];
  for (const tc of pureCases) {
    const studyStatus = evaluateSectionStudyStatus(tc.input);
    const actual = shouldShowSectionGuide({ hasSubtitle: tc.hasSubtitle, studyStatus });
    assert.equal(actual, tc.expected, `组合「${tc.name}」预期=${tc.expected}，实际=${actual}`);
  }

  // 2. Full DOM + Video.js captions + captionVtt probe matrix
  const dom = new JSDOM(`
    <div class="chapter-list chapter-all"><ul><li>
      <div class="list-title">全组合矩阵测试</div>
      <dl id="D1show-sectionssec-vtt-learning" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-vtt-l">
        <dt><span class="qcontent" title="VTT学习中">VTT学习中</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>学习中</span></div></dd>
      </dl>
      <dl class="focus" id="D1show-sectionssec-vjs-learning" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-vjs-l">
        <dt><span class="qcontent" title="VJS学习中">VJS学习中</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>学习中</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-vtt-done" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-vtt-d">
        <dt><span class="qcontent" title="VTT已完成">VTT已完成</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>已完成</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-vtt-unstarted" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-vtt-u">
        <dt><span class="qcontent" title="VTT未开始">VTT未开始</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item start pointer"><span>未开始</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-nosub-learning" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-no-l">
        <dt><span class="qcontent" title="无字幕学习中">无字幕学习中</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>学习中</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-404-done" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-404-d">
        <dt><span class="qcontent" title="404已完成">404已完成</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>已完成</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-0cue-done" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-0cue-d">
        <dt><span class="qcontent" title="空VTT已完成">空VTT已完成</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>已完成</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-nosub-unstarted" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-no-u">
        <dt><span class="qcontent" title="无字幕未开始">无字幕未开始</span></dt>
        <dd><div class="item sub-text">视频</div><div class="item start pointer"><span>未开始</span></div></dd>
      </dl>
      <dl id="D1show-sectionssec-unknown-missing" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-unk-1">
        <dt><span class="qcontent" title="有字幕但无状态节点">有字幕但无状态节点</span></dt>
        <dd><div class="item sub-text">视频</div></dd>
      </dl>
      <dl id="D1show-sectionssec-unknown-conflict" data-sectionType="6" data-courseId="c-mat" data-resourceId="att-unk-2">
        <dt><span class="qcontent" title="有字幕但状态冲突">有字幕但状态冲突</span></dt>
        <dd><div class="item start pointer"><span>未开始</span></div><div class="item continue pointer"><span>已完成</span></div></dd>
      </dl>
    </li></ul></div>
    <div class="video-js" id="liveMatPlayer"><video></video></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-mat/6' });
  try {
    const win = dom.window;
    const pageWin = {
      location: win.location,
      videojs: {
        getPlayers: () => ({
          live: {
            isDisposed: () => false,
            el: () => win.document.getElementById('liveMatPlayer'),
            textTracks: () => [
              { kind: 'metadata', label: 'segment-metadata', cues: [{ startTime: 0, endTime: 1, text: '{"uri":"s.ts"}' }] },
              { kind: 'captions', label: '开启', mode: 'showing', cues: [{ startTime: 2, endTime: 6, text: '通过 Video.js captions 轨拿到的实时字幕。' }] },
            ],
          },
        }),
      },
      app: {
        _modules: {
          'study/course/detail--c-mat': {
            store: {
              models: {
                course: {
                  data: {
                    id: 'c-mat',
                    name: '组合矩阵课程',
                    courseChapters: [{
                      name: '第一章',
                      courseChapterSections: [
                        { id: 'sec-vtt-learning', attachmentId: 'att-vtt-l' },
                        { id: 'sec-vjs-learning', attachmentId: 'att-vjs-l' },
                        { id: 'sec-vtt-done', attachmentId: 'att-vtt-d' },
                        { id: 'sec-vtt-unstarted', attachmentId: 'att-vtt-u' },
                        { id: 'sec-nosub-learning', attachmentId: 'att-no-l' },
                        { id: 'sec-404-done', attachmentId: 'att-404-d' },
                        { id: 'sec-0cue-done', attachmentId: 'att-0cue-d' },
                        { id: 'sec-nosub-unstarted', attachmentId: 'att-no-u' },
                        { id: 'sec-unknown-missing', attachmentId: 'att-unk-1' },
                        { id: 'sec-unknown-conflict', attachmentId: 'att-unk-2' },
                      ],
                    }],
                  },
                },
                trackList: {
                  data: [
                    { attachmentId: 'att-vtt-l', captionVtt: 'https://wangda.chinamobile.com/default/M00/vtt-l.vtt' },
                    { attachmentId: 'att-vtt-d', captionVtt: 'https://wangda.chinamobile.com/default/M00/vtt-d.vtt' },
                    { attachmentId: 'att-vtt-u', captionVtt: 'https://wangda.chinamobile.com/default/M00/vtt-u.vtt' },
                    { attachmentId: 'att-404-d', captionVtt: 'https://wangda.chinamobile.com/default/M00/404.vtt' },
                    { attachmentId: 'att-0cue-d', captionVtt: 'https://wangda.chinamobile.com/default/M00/0cue.vtt' },
                    { attachmentId: 'att-unk-1', captionVtt: 'https://wangda.chinamobile.com/default/M00/unk1.vtt' },
                    { attachmentId: 'att-unk-2', captionVtt: 'https://wangda.chinamobile.com/default/M00/unk2.vtt' },
                  ],
                },
              },
            },
          },
        },
      },
    };

    const probedUrls = [];
    const httpGet = async url => {
      probedUrls.push(url);
      if (url.includes('404.vtt')) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
      if (url.includes('0cue.vtt')) return { status: 200, text: 'WEBVTT\n\nNOTE no cues' };
      return { status: 200, text: 'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n有效 AI 字幕正文。' };
    };

    const mounted = mountSectionGuideButtons({ win, pageWin, httpGet, onOpenSection: () => {} });
    await mounted.flushProbes();

    const shownIds = [...win.document.querySelectorAll('button[data-wd-section-guide]')].map(b => b.dataset.wdSectionGuide);
    assert.deepEqual(shownIds, ['sec-vtt-learning', 'sec-vjs-learning', 'sec-vtt-done']);
    // No placeholder buttons or "无字幕" tags anywhere in section list
    assert.equal(win.document.querySelectorAll('span[data-wd-section-nocap]').length, 0);
    // Unstarted and unknown sections were NEVER probed over network!
    assert.equal(probedUrls.some(u => u.includes('vtt-u.vtt') || u.includes('unk1.vtt') || u.includes('unk2.vtt')), false);

    // Also verify readSectionDomStudyStatus conservative behavior on unknown DOM
    const unkStudy = readSectionDomStudyStatus(win.document.getElementById('D1show-sectionssec-unknown-missing'));
    assert.equal(unkStudy.eligible, false);
    assert.equal(unkStudy.state, 'unknown');

    mounted.destroy();
  } finally {
    dom.window.close();
  }
});

test('AI 导览入口惰性限流并发、缓存、失败不重试轰炸与异步出现/消失', async () => {
  const dom = new JSDOM(`
    <div class="chapter-list chapter-all"><ul><li>
      <div class="list-title">并发与缓存验证</div>
      ${['s1', 's2', 's3', 's4', 's5'].map(id => `
        <dl id="D1show-sections${id}" data-sectionType="6" data-courseId="c-rate" data-resourceId="att-${id}">
          <dt><span class="qcontent" title="已完成${id}">已完成${id}</span></dt>
          <dd><div class="item sub-text">视频</div><div class="item continue pointer"><span>已完成</span></div></dd>
        </dl>
      `).join('')}
      ${['u1', 'u2', 'u3'].map(id => `
        <dl id="D1show-sections${id}" data-sectionType="6" data-courseId="c-rate" data-resourceId="att-${id}">
          <dt><span class="qcontent" title="未开始${id}">未开始${id}</span></dt>
          <dd><div class="item sub-text">视频</div><div class="item start pointer"><span>未开始</span></div></dd>
        </dl>
      `).join('')}
    </li></ul></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-rate/6' });
  try {
    const win = dom.window;
    const allIds = ['s1', 's2', 's3', 's4', 's5', 'u1', 'u2', 'u3'];
    const pageWin = {
      location: win.location,
      app: {
        _modules: {
          'study/course/detail--c-rate': {
            store: {
              models: {
                course: { data: { id: 'c-rate', name: '限流缓存测试课', courseChapters: [{ name: '一', courseChapterSections: allIds.map(id => ({ id, attachmentId: `att-${id}` })) }] } },
                trackList: { data: allIds.map(id => ({ attachmentId: `att-${id}`, captionVtt: `https://wangda.chinamobile.com/default/M00/${id}.vtt` })) },
              },
            },
          },
        },
      },
    };

    let inFlight = 0;
    let maxInFlight = 0;
    const calls = [];
    const httpGet = async url => {
      calls.push(url);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 10));
      inFlight -= 1;
      if (url.includes('/s5.vtt')) {
        const err = new Error('HTTP 404');
        err.status = 404;
        throw err;
      }
      return { status: 200, text: 'WEBVTT\n\n00:00:02.000 --> 00:00:06.000\n有效字幕条目。' };
    };

    const mounted = mountSectionGuideButtons({ win, pageWin, httpGet, maxConcurrency: 2, onOpenSection: () => {} });
    // Before async probes finish, NO greyed placeholders are injected (non-blocking)
    assert.equal(win.document.querySelectorAll('button[data-wd-section-guide]').length, 0);

    await mounted.flushProbes();
    assert.ok(maxInFlight <= 2, `最大并发应受限于 2，实际为 ${maxInFlight}`);
    assert.equal(calls.length, 5, '仅对 5 个已完成课节探测，3 个未开始课节 0 请求');
    assert.equal(calls.some(u => /\/u\d\.vtt$/u.test(u)), false);
    assert.deepEqual(
      [...win.document.querySelectorAll('button[data-wd-section-guide]')].map(b => b.dataset.wdSectionGuide),
      ['s1', 's2', 's3', 's4'],
    );

    // Repeated refresh() calls hit success/failure cache -> ZERO duplicate requests or 404 retry storms!
    mounted.refresh();
    mounted.refresh();
    mounted.refresh();
    await mounted.flushProbes();
    assert.equal(calls.length, 5, '重复刷新必须命中成功与失败缓存，不重试轰炸 404 课节');

    // Dynamic disappear: when s1 turns back to 未开始 or confirmed no-subtitle, its button disappears cleanly
    win.document.querySelector('#D1show-sectionss1 dd .item.continue span').textContent = '未开始';
    mounted.refresh();
    assert.equal(win.document.querySelector('button[data-wd-section-guide="s1"]'), null, '状态变为未开始后标识应消失');

    // Dynamic appear: when u1 changes from 未开始 to 学习中, lazy probe runs once and button appears asynchronously
    win.document.querySelector('#D1show-sectionsu1 dd .item.start span').textContent = '学习中';
    mounted.refresh();
    await mounted.flushProbes();
    assert.equal(calls.length, 6);
    assert.ok(win.document.querySelector('button[data-wd-section-guide="u1"]'), '开始学习后有字幕课节应异步出现 AI 导览标识');

    // Also verify Video.js metadata-only track does NOT satisfy kind==='captions'
    const domMeta = new JSDOM(`
      <div class="chapter-list chapter-all"><ul><li>
        <dl class="focus" id="D1show-sectionssec-meta" data-sectionType="6" data-courseId="c-meta" data-resourceId="att-meta">
          <dt><span class="qcontent" title="仅metadata轨">仅metadata轨</span></dt>
          <dd><div class="item continue pointer"><span>学习中</span></div></dd>
        </dl>
      </li></ul></div>
      <div class="video-js" id="metaPlayer"><video></video></div>
    `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-meta/6' });
    const metaMounted = mountSectionGuideButtons({
      win: domMeta.window,
      pageWin: {
        location: domMeta.window.location,
        videojs: {
          getPlayers: () => ({
            m1: {
              isDisposed: () => false,
              el: () => domMeta.window.document.getElementById('metaPlayer'),
              textTracks: () => [
                { kind: 'metadata', label: 'segment-metadata', cues: [{ startTime: 0, endTime: 1, text: '{"uri":"x.ts"}' }] },
              ],
            },
          }),
        },
      },
      onOpenSection: () => {},
    });
    await metaMounted.flushProbes();
    assert.equal(domMeta.window.document.querySelector('button[data-wd-section-guide="sec-meta"]'), null);
    metaMounted.destroy();
    domMeta.window.close();

    mounted.destroy();
  } finally {
    dom.window.close();
  }
});

test('UI 精简与设置收拢：首屏隐藏版本/诊断/AI配置，设置分 4 组支持恢复默认与浅深色主题，跨课确认缓存互不污染', async () => {
  const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/home' });
  try {
    const win = dom.window;
    const calls = [];
    const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '10:00', end: '22:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
    const controller = {
      getState: () => structuredClone(state),
      subscribe: () => () => {},
      diagnose: () => ({ kind: 'home' }),
      setWindow: async w => { calls.push(['setWindow', w]); state.window = w; return true; },
    };
    const panel = createPanel(win, controller, '0.1.0-beta.16');
    panel.open();
    const host = win.document.getElementById('wangda-assistant');
    const root = host.shadowRoot;

    // 1. Header does NOT leak version string; version & diagnose are tucked inside collapsed <details data-settings>
    assert.equal(root.querySelector('header').textContent.includes('0.1.0-beta.16'), false, '主标题不应直接暴露版本号');
    const settingsBox = root.querySelector('[data-settings]');
    assert.equal(settingsBox.open, false, '设置二级区默认收起');
    assert.ok(settingsBox.querySelector('[data-version-info]').textContent.includes('0.1.0-beta.16'));
    assert.ok(settingsBox.querySelector('[data-action="diagnose"]'), '页面诊断应收入设置分组内');
    assert.deepEqual(
      [...settingsBox.querySelectorAll('[data-settings-group]')].map(el => el.dataset.settingsGroup),
      ['study', 'appearance', 'ai', 'diagnostics'],
    );
    // Privacy notice inside AI settings preserved verbatim
    assert.equal(settingsBox.querySelector('[data-ai-privacy]').textContent, WD_AI_PRIVACY_NOTICE);

    // 2. Single settings entry (no duplicate settings button in quick-bar); expanding reveals all 4 groups
    assert.equal(root.querySelector('[data-action="open-settings"]'), null, '首屏不应有重复的设置按钮');
    settingsBox.open = true;
    assert.equal(settingsBox.open, true);

    // 3. Theme switch persists to localStorage & updates host[data-theme]
    const themeSel = root.querySelector('[name="ui-theme"]');
    themeSel.value = 'dark';
    themeSel.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(host.dataset.theme, 'dark');
    assert.equal(win.localStorage.getItem('wangda-assistant.ui.theme'), 'dark');

    // 4. Study window "恢复默认" resets to 09:00-24:00
    root.querySelector('[data-action="reset-window"]').click();
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    assert.deepEqual(calls.at(-1), ['setWindow', { start: '09:00', end: '24:00' }]);
    assert.equal(root.querySelector('[name="start"]').value, '09:00');
    assert.equal(root.querySelector('[name="end"]').value, '24:00');

    // 5. AI settings "恢复默认" resets provider/baseUrl/model while keeping API key intact; "清空 Key" clears it
    root.querySelector('[name="ai-provider"]').value = 'custom';
    root.querySelector('[name="ai-base-url"]').value = 'https://relay.example.com/v1';
    root.querySelector('[name="ai-model"]').value = 'custom-model';
    root.querySelector('[name="ai-api-key"]').value = 'sk-keep-me';
    root.querySelector('[data-action="ai-save"]').click();
    assert.equal(loadAiSettings(win).model, 'custom-model');

    root.querySelector('[data-action="ai-reset"]').click();
    const afterReset = loadAiSettings(win);
    assert.equal(afterReset.provider, 'deepseek');
    assert.equal(afterReset.model, 'deepseek-chat');
    assert.equal(afterReset.apiKey, 'sk-keep-me', '恢复默认模型配置不应误删已存 Key');

    root.querySelector('[data-action="ai-clear-key"]').click();
    assert.equal(loadAiSettings(win).apiKey, '');

    panel.destroy();
  } finally {
    dom.window.close();
  }
});

test('跨课程确认缓存隔离：课程 A 的有字幕结果不会污染课程 B 同 ID 无字幕课节', async () => {
  const { createSubtitleAvailabilityProber } = await import('../src/knowledge-vtt.js');
  const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/study/course/detail/course-B/6' });
  try {
    const prober = createSubtitleAvailabilityProber({
      win: dom.window,
      pageWin: {
        location: dom.window.location,
        app: {
          _modules: {
            'study/course/detail--course-B': {
              store: {
                models: {
                  course: { data: { id: 'course-B', courseChapters: [{ courseChapterSections: [{ id: 'shared-sec', attachmentId: 'att-b' }] }] } },
                  trackList: { data: [{ attachmentId: 'att-other', captionVtt: 'https://wangda.chinamobile.com/default/M00/other.vtt' }] },
                },
              },
            },
          },
        },
      },
    });
    // Course A had confirmed subtitle for 'shared-sec'
    prober.setConfirmed('shared-sec', true, 'course-A');
    // Course B's 'shared-sec' has NO captionVtt -> must NOT inherit Course A's true!
    const resB = prober.getCached({ courseId: 'course-B', sectionId: 'shared-sec', resourceId: 'att-b', active: false });
    assert.equal(resB?.available, false, '不同课程间相同 sectionId 的确认缓存不能互相污染');
    assert.equal(prober.getCached({ courseId: 'course-A', sectionId: 'shared-sec', resourceId: 'att-a', active: false })?.available, true);
    prober.destroy();
  } finally {
    dom.window.close();
  }
});

test('混合课程回退采集与批量 AI 导学：首节无字幕不误禁整课分析，路径 1 与路径 3a 有字幕节全部入导学与导图，路径 3a 并发仅请求一次', async () => {
  const dom = new JSDOM(`
    <div class="course-side-title-row"><span class="text-overflow" title="多路径回退混合课">多路径回退混合课</span></div>
    <div class="chapter-list chapter-all"><ul><li>
      <dl class="focus" id="D1show-sectionssec-1-nosub" data-sectionType="6" data-courseId="c-fbmix" data-resourceId="att-1">
        <dt><span class="qcontent" title="第1节 无字幕开场">第1节 无字幕开场</span></dt>
        <dd><span class="status">学习中</span></dd>
      </dl>
      <dl id="D1show-sectionssec-2-vtt" data-sectionType="6" data-courseId="c-fbmix" data-resourceId="att-2">
        <dt><span class="qcontent" title="第2节 直链字幕核心原理">第2节 直链字幕核心原理</span></dt>
        <dd><span class="status">已完成</span></dd>
      </dl>
      <dl id="D1show-sectionssec-3-404" data-sectionType="6" data-courseId="c-fbmix" data-resourceId="att-3">
        <dt><span class="qcontent" title="第3节 失效404录屏">第3节 失效404录屏</span></dt>
        <dd><span class="status">已完成</span></dd>
      </dl>
      <dl id="D1show-sectionssec-4-api" data-sectionType="6" data-courseId="c-fbmix" data-resourceId="att-4">
        <dt><span class="qcontent" title="第4节 接口回退字幕实战">第4节 接口回退字幕实战</span></dt>
        <dd><span class="status">学习中</span></dd>
      </dl>
    </li></ul></div>
  `, { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-fbmix/6' });
  try {
    const win = dom.window;
    const pageWin = {
      location: win.location,
      app: {
        options: { urlRoot: '/api/v1' },
        _modules: {
          'study/course/detail--c-fbmix': {
            store: {
              models: {
                course: {
                  data: {
                    id: 'c-fbmix',
                    name: '多路径回退混合课',
                    courseChapters: [{
                      name: '第一章',
                      courseChapterSections: [
                        { id: 'sec-1-nosub', name: '第1节 无字幕开场', attachmentId: 'att-1', finishStatus: 1 },
                        { id: 'sec-2-vtt', name: '第2节 直链字幕核心原理', attachmentId: 'att-2', finishStatus: 2 },
                        { id: 'sec-3-404', name: '第3节 失效404录屏', attachmentId: 'att-3', finishStatus: 2 },
                        { id: 'sec-4-api', name: '第4节 接口回退字幕实战', attachmentId: 'att-4', finishStatus: 1 },
                      ],
                    }],
                  },
                },
                // Only sec-2 has valid captionVtt; sec-3 has 404 captionVtt; sec-1 & sec-4 have NO captionVtt in trackList (sec-4 recovers via Path 3a!)
                trackList: {
                  data: [
                    { attachmentId: 'att-2', captionVtt: 'https://wangda.chinamobile.com/default/M00/sec2.vtt' },
                    { attachmentId: 'att-3', captionVtt: 'https://wangda.chinamobile.com/default/M00/sec3-404.vtt' },
                  ],
                },
              },
            },
          },
        },
      },
    };
    saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-fbmix', transport: 'fetch' });

    const vttSec2 = `WEBVTT\n\n00:00:10.000 --> 00:00:35.000\n直链字幕讲解服务网格流量治理与零信任双向认证机制。\n`;
    const vttSec4 = `WEBVTT\n\n00:01:05.000 --> 00:01:40.000\n接口回退字幕讲解灰度发布回滚阈值与全链路可观测告警。\n`;
    let captionApiHits = 0;
    const llmPrompts = [];
    const fakeFetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('/course-study/caption/c-fbmix')) {
        captionApiHits += 1;
        await Promise.resolve();
        return {
          status: 200,
          text: async () => JSON.stringify({
            data: [
              { attachmentId: 'att-4', sectionId: 'sec-4-api', captionVtt: 'https://wangda.chinamobile.com/default/M00/sec4-api.vtt' },
            ],
          }),
        };
      }
      if (u.includes('sec2.vtt')) return { status: 200, text: async () => vttSec2 };
      if (u.includes('sec4-api.vtt')) return { status: 200, text: async () => vttSec4 };
      if (u.includes('sec3-404.vtt')) return { status: 404, text: async () => 'Not Found' };
      const body = JSON.parse(init.body || '{}');
      const userMsg = body.messages?.find(m => m.role === 'user')?.content || '';
      llmPrompts.push(userMsg);
      if (userMsg.includes('直链字幕核心原理')) {
        return {
          status: 200,
          text: async () => JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: '掌握服务网格流量治理与零信任双向认证。',
                  keyPoints: [{ text: '服务网格实施零信任双向认证', timestamp: '00:10' }],
                  outline: [{ name: '服务网格治理', points: [{ text: '零信任双向认证', timestamp: '00:10' }] }],
                }),
              },
            }],
          }),
        };
      }
      if (userMsg.includes('接口回退字幕实战')) {
        return {
          status: 200,
          text: async () => JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: '掌握灰度发布回滚阈值与全链路可观测告警。',
                  keyPoints: [{ text: '灰度回滚阈值与全链路告警联动', timestamp: '01:05' }],
                  outline: [{ name: '灰度可观测实践', points: [{ text: '回滚阈值与告警', timestamp: '01:05' }] }],
                }),
              },
            }],
          }),
        };
      }
      // Course-level aggregation
      return {
        status: 200,
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                overview: '本课程涵盖服务网格零信任治理与灰度可观测告警两条主线。',
                keyPoints: [
                  { text: '服务网格实施零信任双向认证', timestamp: '00:10' },
                  { text: '灰度回滚阈值与全链路告警联动', timestamp: '01:05' },
                ],
              }),
            },
          }],
        }),
      };
    };

    const controller = {
      getState: () => ({ status: 'paused', message: '', unavailable: false, window: { start: '09:00', end: '24:00' }, automation: { enabled: false, resumeOnReload: false, mute: true }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null }),
      subscribe: () => () => {},
      diagnose: () => ({ kind: 'course' }),
    };

    // 1. Direct collectCourseSubtitles concurrency dedup check for Path 3a
    const collected = await collectCourseSubtitles({
      win,
      pageWin,
      scope: 'course',
      httpGet: async u => {
        const r = await fakeFetch(u);
        return { status: r.status, text: await r.text() };
      },
    });
    assert.equal(captionApiHits, 1, '并发采集下路径 3a 课程字幕接口应去重并仅请求一次');
    assert.equal(collected.captionedSections, 2);
    assert.equal(collected.hasAnySubtitle, true);
    assert.equal(collected.sections.find(s => s.sectionId === 'sec-2-vtt')?.source, 'vtt-url');
    assert.equal(collected.sections.find(s => s.sectionId === 'sec-4-api')?.source, 'caption-api-vtt');
    assert.deepEqual(collected.skippedNoSubtitleSections.map(s => s.sectionId).sort(), ['sec-1-nosub', 'sec-3-404']);

    // 2. Panel flow: open directly on captionless section (scope='section') -> AI 全课 MUST remain enabled!
    const knowledge = createKnowledgeService({ win, pageWin, controller, fetchFn: fakeFetch });
    knowledge.mapOptions = { skipCdn: true };
    const panel = createPanel(win, controller, '0.1.0-beta.20', knowledge);
    panel.open();
    const root = win.document.getElementById('wangda-assistant').shadowRoot;
    root.querySelector('[data-action="knowledge-open"]').click();
    for (let i = 0; i < 80; i += 1) await Promise.resolve();
    const modal = root.querySelector('[data-knowledge-modal]');
    // Switch picker to captionless active section sec-1-nosub
    modal.querySelector('[data-kg-section-picker]').value = 'sec-1-nosub';
    modal.querySelector('[data-kg-section-picker]').dispatchEvent(new win.Event('change', { bubbles: true }));
    for (let i = 0; i < 60; i += 1) await Promise.resolve();
    assert.equal(modal.querySelector('[data-kg-mode]').textContent, '本课无字幕');
    assert.equal(modal.querySelector('[data-action="kg-ai-section"]').disabled, true);
    assert.equal(modal.querySelector('[data-action="kg-ai-course"]').disabled, false, '聚焦无字幕首节时 AI 全课按钮不得被误禁');

    // 3. Click AI 全课 -> BOTH sec-2 (Path 1) and sec-4 (Path 3a) enter AI guide & mindmap; sec-1 & sec-3 skipped and named!
    modal.querySelector('[data-action="kg-ai-course"]').click();
    for (let i = 0; i < 120; i += 1) await Promise.resolve();
    assert.equal(modal.querySelector('[data-kg-mode]').textContent, 'AI 速览');
    assert.equal(llmPrompts.some(p => p.includes('无字幕开场')), false, '不得为无字幕课节 1 发起 LLM 请求');
    assert.equal(llmPrompts.some(p => p.includes('失效404录屏')), false, '不得为 404 无字幕课节 3 发起 LLM 请求');
    assert.ok(llmPrompts.some(p => p.includes('直链字幕核心原理')), '路径 1 有字幕课节必须进入 AI 分析');
    assert.ok(llmPrompts.some(p => p.includes('接口回退字幕实战')), '路径 3a 回退字幕课节必须进入 AI 分析');

    const mdText = modal.querySelector('[data-kg-md]').textContent;
    assert.match(mdText, /服务网格实施零信任双向认证 \[00:10\]\(#wd-seek-sec-2-vtt-10\)/u, '路径 1 有字幕节必须进入导学/导图并带时间跳播');
    assert.match(mdText, /灰度回滚阈值与全链路告警联动 \[01:05\]\(#wd-seek-sec-4-api-65\)/u, '路径 3a 回退有字幕节必须进入导学/导图并带时间跳播');
    const skippedBox = modal.querySelector('[data-kg-skipped-list]');
    assert.ok(skippedBox);
    assert.match(skippedBox.textContent, /第1节 无字幕开场/u);
    assert.match(skippedBox.textContent, /第3节 失效404录屏/u);

    panel.destroy();
  } finally {
    dom.window.close();
  }
});
