import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseWebVtt, cleanAndSegmentCues, seekCourseTime } from '../src/knowledge-vtt.js';
import {
  WD_CITATION_DEFAULTS,
  normalizeSegmentId,
  assignStableSegmentIds,
  buildSegmentIndex,
  buildCourseSegmentIndex,
  computeCitationLiteralOverlap,
  verifyCitation,
  extractSegmentIdsFromText,
  tokenizeTextWithCitations,
} from '../src/knowledge-citations.js';
import {
  WD_STORAGE_SCHEMA_VERSION,
  WD_LEGACY_STORAGE_KEYS,
  WD_GM_STORAGE_KEYS,
  WD_CACHE_STORAGE_KEYS,
  getStorageStatus,
  readAssetIndex,
  readCourseAssetShard,
  writeCourseAssetShard,
  listIndexedCourseIds,
  recordWrongQuestionAsset,
  loadCourseWrongQuestions,
  updateSectionMasteryAsset,
  loadCourseMastery,
  loadCourseReviewPlan,
  saveCourseReviewPlan,
  loadSectionNotes,
  saveSectionNote,
  readAssetShardFromIdb,
  listAllIdbShards,
  setLruCacheEntry,
  getLruCacheEntry,
  readLruCacheMap,
  migrateLegacyStorage,
} from '../src/knowledge-storage.js';
import {
  WD_AI_STORAGE_KEYS,
  loadAiSettings,
  saveAiSettings,
  loadKnowledgeCache,
  saveKnowledgeCache,
  buildSectionPrompt,
  buildSectionChunkAggregationPrompt,
  buildCourseAggregationPrompt,
  summarizeCourseWithAi,
  createKnowledgeService,
} from '../src/knowledge-ai.js';
import {
  loadSectionChat,
  saveSectionChat,
  createSectionChatSession,
  loadSectionQuiz,
  saveSectionQuiz,
  submitSectionQuizAttempt,
  buildSectionQaMessages,
  buildSectionQuizPrompt,
  askSectionQuestion,
  normalizeQuizPaper,
  buildWrongQuestionDeepDivePrompt,
} from '../src/knowledge-tutor.js';
import { createPanel } from '../src/panel.js';

function createMockGmWindow(url = 'https://wangda.chinamobile.com/#/study/course/detail/c-test/6', html = '<body></body>') {
  const dom = new JSDOM(html, { url });
  const win = dom.window;
  const gmStore = new Map();
  win.GM_getValue = (key, fallback = undefined) => (gmStore.has(key) ? gmStore.get(key) : fallback);
  win.GM_setValue = (key, value) => {
    if (value === undefined) gmStore.delete(key);
    else gmStore.set(key, structuredClone(value));
  };
  return { dom, win, gmStore };
}

function createFakeIndexedDb() {
  const storeMap = new Map();
  const indexedDB = {
    open() {
      const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() { return { createIndex() {} }; },
        transaction() {
          const tx = {
            oncomplete: null,
            onerror: null,
            objectStore() {
              return {
                put(record) {
                  storeMap.set(record.shardKey, structuredClone(record));
                  queueMicrotask(() => tx.oncomplete?.());
                },
                get(key) {
                  const gReq = { result: undefined, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    gReq.result = storeMap.has(key) ? structuredClone(storeMap.get(key)) : undefined;
                    gReq.onsuccess?.();
                  });
                  return gReq;
                },
                getAll() {
                  const aReq = { result: [], onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    aReq.result = [...storeMap.values()].map(v => structuredClone(v));
                    aReq.onsuccess?.();
                  });
                  return aReq;
                },
              };
            },
          };
          return tx;
        },
      };
      queueMicrotask(() => {
        req.result = db;
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { indexedDB, storeMap };
}

// ============================================================================
// 1. 字幕稳定 ID 确定性与跨课节防撞号
// ============================================================================

test('字幕分段稳定 ID：同一份 WebVTT 两次解析得到完全一致的 ID 序列，跨课节使用 课节ID#S01 避免撞号', () => {
  const sampleVtt = `WEBVTT

00:00:02.000 --> 00:00:09.000
人工智能安全治理首先要识别提示词注入与模型越权风险。

00:00:15.000 --> 00:00:26.000
接下来我们看数据合规要求，模型上线前必须完成算法备案与生成内容显式标识。

00:00:45.000 --> 00:00:58.000
最后强调算力网络通过高通量无损互联支撑万卡级智算集群训练。
`;
  const run1 = cleanAndSegmentCues(parseWebVtt(sampleVtt), { sectionId: 'sec-alpha', minSegmentChars: 15 });
  const run2 = cleanAndSegmentCues(parseWebVtt(sampleVtt.replace(/\n/gu, '\r\n')), { sectionId: 'sec-alpha', minSegmentChars: 15 });

  assert.ok(run1.segments.length >= 3);
  assert.deepEqual(
    run1.segments.map(s => ({ segId: s.segId, displayId: s.displayId, refKey: s.refKey, startMs: s.startMs, endMs: s.endMs, text: s.text })),
    run2.segments.map(s => ({ segId: s.segId, displayId: s.displayId, refKey: s.refKey, startMs: s.startMs, endMs: s.endMs, text: s.text })),
    '同一课同一份字幕两次解析必须得到完全相同的稳定 ID 序列与内容',
  );
  assert.deepEqual(run1.segments.map(s => s.segId), ['S01', 'S02', 'S03']);
  assert.deepEqual(run1.segments.map(s => s.displayId), ['[S01]', '[S02]', '[S03]']);
  assert.deepEqual(run1.segments.map(s => s.refKey), ['sec-alpha#S01', 'sec-alpha#S02', 'sec-alpha#S03']);

  // Cross-section collision isolation: sec-alpha vs sec-beta both display [S01] but have distinct refKeys
  const betaSegs = cleanAndSegmentCues(parseWebVtt(sampleVtt), { sectionId: 'sec-beta', minSegmentChars: 15 }).segments;
  const courseIdx = buildCourseSegmentIndex([
    { sectionId: 'sec-alpha', title: '第一节', segments: run1.segments },
    { sectionId: 'sec-beta', title: '第二节', segments: betaSegs },
  ]);
  assert.equal(courseIdx.resolveRefKey('sec-alpha#S01').sectionId, 'sec-alpha');
  assert.equal(courseIdx.resolveRefKey('sec-beta#S01').sectionId, 'sec-beta');
  assert.notEqual(courseIdx.resolveRefKey('sec-alpha#S01').refKey, courseIdx.resolveRefKey('sec-beta#S01').refKey);
  assert.equal(courseIdx.resolveRefKey('sec-beta#S01').displayId, '[S01]');
});

// ============================================================================
// 2. AI Prompt 契约改造与 ID 容错解析
// ============================================================================

test('AI 输出契约全面改为只引用分段 ID（单节/长节聚合/全课聚合/问答/出题）且解析层容错归一化', () => {
  const segs = assignStableSegmentIds([
    { startSec: 5, endSec: 25, text: '零信任架构要求每次微服务调用都做显式鉴权。' },
    { startSec: 30, endSec: 55, text: '算法备案与安全评估是生成式 AI 上线的硬门槛。' },
  ], 'sec-1');

  const pSec = buildSectionPrompt('安全课', { sectionIndex: 1, title: '零信任与合规' }, segs);
  assert.match(pSec.user, /\[S01\]/u);
  assert.match(pSec.user, /\[S02\]/u);
  assert.match(pSec.system, /segId/u);
  assert.match(pSec.system, /严禁.*编造.*时间戳/u);

  const pChunkAgg = buildSectionChunkAggregationPrompt('安全课', { title: '零信任' }, [{ summary: '摘要', keyPoints: [{ text: '要点', segId: 'S01' }], outline: [] }]);
  assert.match(pChunkAgg.user, /\[S01\]/u);
  assert.match(pChunkAgg.system, /segId/u);

  const pCourseAgg = buildCourseAggregationPrompt('安全课', [{ sectionId: 'sec-1', title: '第一节', summary: '摘要', keyPoints: [{ text: '要点', segId: 'S01' }], outline: [] }]);
  assert.match(pCourseAgg.user, /\[S01\]/u);
  assert.match(pCourseAgg.system, /segId/u);

  const pQa = buildSectionQaMessages({ courseTitle: '安全课', section: { title: '零信任' }, contextText: '[S01] 零信任...', question: '什么是零信任？' });
  assert.match(pQa[0].content, /\[S01\]/u);
  assert.match(pQa[0].content, /"segId":"S01"/u);

  const pQuiz = buildSectionQuizPrompt({ courseTitle: '安全课', section: { title: '零信任' }, contextText: '[S01] 零信任...' });
  assert.match(pQuiz[0].content, /"segId":"S01"/u);

  // Tolerant normalization for all model variants
  for (const variant of ['[S1]', '[S01]', '［S01］', '［Ｓ１］', '【S1】', '(S1)', '（S01）', 'S1', 's01', 'S-01', 'S_1', 'seg01', '#S1', 'sec-1#S01', 'sec-1#[S1]']) {
    const norm = normalizeSegmentId(variant);
    assert.ok(norm, `应容错解析 ${variant}`);
    assert.equal(norm.segId, 'S01', `${variant} 应归一化为 S01`);
    assert.equal(norm.displayId, '[S01]');
  }
  assert.equal(normalizeSegmentId('S0'), null);
  assert.equal(normalizeSegmentId('S-0'), null);
  assert.equal(normalizeSegmentId('invalid'), null);

  const extracted = extractSegmentIdsFromText('依据见 [S1]、［Ｓ０２］ 以及 【sec-1#S3】');
  assert.deepEqual(extracted.map(e => e.segId), ['S01', 'S02', 'S03']);

  const tokens = tokenizeTextWithCitations('详见 [S1] 与旧时间 01:20 和负时间 -00:05。');
  assert.ok(tokens.some(t => t.type === 'segRef' && t.refs[0].segId === 'S01'));
  assert.ok(tokens.some(t => t.type === 'timeRef' && t.raw === '01:20'));
  assert.ok(tokens.some(t => t.type === 'timeRef' && t.raw === '-00:05' && t.negative === true));
});

// ============================================================================
// 3. 防幻觉查表校验四大核心用例（正常命中 / ID 不存在 / 时间戳越界 / 原文不符）
// ============================================================================

test('引用查表校验四类核心用例：正常命中、ID 不存在、时间戳越界、原文不符（含可调阈值与旧时间格式不得绕过）', () => {
  const secIndex = buildSegmentIndex({
    sectionId: 'sec-verify',
    durationSec: 120,
    segments: [
      { startMs: 10000, endMs: 40000, text: '提示词注入会诱导大模型越权调用外部工具，必须实施严格输入校验与权限隔离。' },
      { startMs: 45000, endMs: 90000, text: '生成式人工智能服务上线前必须完成算法备案、安全评估与显式内容标识。' },
      { startMs: 95000, endMs: 118000, text: '运营阶段需建立持续监测告警和应急熔断回滚机制。' },
    ],
  });

  // Case 1: 正常命中（含容错写法 ［S2］）
  const hit = verifyCitation({ segId: '［S2］', quote: '完成算法备案、安全评估与显式内容标识' }, secIndex);
  assert.equal(hit.verified, true);
  assert.equal(hit.status, 'verified');
  assert.equal(hit.reasonCode, null);
  assert.equal(hit.segId, 'S02');
  assert.equal(hit.refKey, 'sec-verify#S02');
  assert.equal(hit.seconds, 45);
  assert.equal(hit.timestamp, '00:45');
  assert.equal(hit.prevSegment?.segId, 'S01');
  assert.equal(hit.nextSegment?.segId, 'S03');
  assert.ok(hit.similarity >= WD_CITATION_DEFAULTS.quoteSimilarityThreshold);

  // Case 2: ID 不存在
  const missingId = verifyCitation({ segId: '[S99]', quote: '不存在的段落引用' }, secIndex);
  assert.equal(missingId.verified, false);
  assert.equal(missingId.status, 'unverified');
  assert.equal(missingId.reasonCode, 'id_not_found');
  assert.equal(missingId.seconds, null);
  assert.equal(missingId.rawRef, '[S99]');
  assert.equal(missingId.rawQuote, '不存在的段落引用');
  assert.match(missingId.reason, /不存在/u);

  // Case 3a: 时间戳越界（超过课节总时长）
  const overDuration = verifyCitation({ time: '09:30', quote: '上线前完成算法备案' }, secIndex);
  assert.equal(overDuration.verified, false);
  assert.equal(overDuration.status, 'unverified');
  assert.equal(overDuration.reasonCode, 'time_out_of_bounds');
  assert.equal(overDuration.seconds, null);
  assert.match(overDuration.reason, /超出/u);

  // Case 3b: 时间戳越界（负值时间戳）
  const negativeTime = verifyCitation({ time: '-00:15' }, secIndex);
  assert.equal(negativeTime.verified, false);
  assert.equal(negativeTime.status, 'unverified');
  assert.equal(negativeTime.reasonCode, 'time_out_of_bounds');
  assert.equal(negativeTime.seconds, null);
  assert.match(negativeTime.reason, /负值/u);

  // Case 3c: 即使带合法 segId 但同时附带越界 time 也不得绕过
  const mixedBadTime = verifyCitation({ segId: 'S01', seconds: 999 }, secIndex);
  assert.equal(mixedBadTime.verified, false);
  assert.equal(mixedBadTime.reasonCode, 'time_out_of_bounds');

  // Case 4: 原文不符（AI 张冠李戴或编造引述）
  const mismatch = verifyCitation({ segId: 'S01', quote: '财务报销审批必须在三天内由部门主管签字' }, secIndex);
  assert.equal(mismatch.verified, false);
  assert.equal(mismatch.status, 'unverified');
  assert.equal(mismatch.reasonCode, 'text_mismatch');
  assert.equal(mismatch.seconds, null);
  assert.equal(mismatch.rawQuote, '财务报销审批必须在三天内由部门主管签字');
  assert.match(mismatch.excerpt, /提示词注入/u, '未核实引用应保留实际原字幕以便用户对照核查');
  assert.ok(mismatch.similarity < mismatch.threshold);

  // 可调阈值验证：同一段部分重合引述在低阈值通过、高阈值判不可信
  const overlap = computeCitationLiteralOverlap('大模型工具权限管控', secIndex.byId.get('S01').text);
  assert.ok(overlap.score > 0.1 && overlap.score < 0.8);
  assert.equal(verifyCitation({ segId: 'S01', quote: '大模型工具权限管控' }, secIndex, { similarityThreshold: 0.1 }).verified, true);
  assert.equal(verifyCitation({ segId: 'S01', quote: '大模型工具权限管控' }, secIndex, { similarityThreshold: 0.85 }).verified, false);

  // 旧格式 time（合法时间+匹配文本）走同一套查表校验可命中，旧格式 time + 不匹配文本仍被拦下
  const legacyValid = verifyCitation({ time: '00:50', quote: '必须完成算法备案' }, secIndex);
  assert.equal(legacyValid.verified, true);
  assert.equal(legacyValid.segId, 'S02');
  assert.equal(legacyValid.sourceKind, 'legacy-time');

  const legacyHallucinated = verifyCitation({ time: '00:50', quote: '量子计算机超导比特退相干' }, secIndex);
  assert.equal(legacyHallucinated.verified, false);
  assert.equal(legacyHallucinated.reasonCode, 'text_mismatch');
});

test('AI 总结、问答、出题全链路贯通查表校验：伪造 ID 与原文不符均标记为 unverified 且不给 verified seconds', async () => {
  const { dom, win } = createMockGmWindow();
  try {
    const sec = {
      sectionId: 'sec-e2e',
      sectionIndex: 1,
      title: '大模型安全',
      active: true,
      durationSec: 90,
      segments: assignStableSegmentIds([
        { startMs: 5000, endMs: 35000, text: '提示词注入攻击通过恶意上下文劫持模型指令。' },
        { startMs: 40000, endMs: 80000, text: '上线前必须完成算法备案并落实内容显式标识。' },
      ], 'sec-e2e'),
    };
    const settings = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-test', transport: 'fetch' };
    saveAiSettings(win, settings);

    // 1. summarizeCourseWithAi: 1 verified + 1 nonexistent ID + 1 mismatched quote
    const sumRes = await summarizeCourseWithAi(
      { courseId: 'c-e2e', title: '安全实务', activeSectionId: 'sec-e2e', sections: [sec] },
      settings,
      {
        scope: 'section',
        fetchFn: async () => ({
          status: 200,
          text: async () => JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: '本节讲清提示词注入攻击机理与算法备案合规要求。',
                  keyPoints: [
                    { text: '提示词注入通过恶意上下文劫持模型指令。', segId: '[S1]', quote: '恶意上下文劫持模型指令' },
                    { text: '不存在编号的幻觉要点。', segId: 'S88', quote: '随便编造的依据' },
                    { text: '张冠李戴的虚假财务制度结论。', segId: 'S02', quote: '差旅报销发票须粘贴整齐' },
                  ],
                  outline: [{ name: '核心要点', points: [{ text: '上线前必须完成算法备案并落实内容标识。', segId: '［S02］', quote: '完成算法备案' }] }],
                }),
              },
            }],
          }),
        }),
      },
    );
    assert.equal(sumRes.usedAi, true);
    const kps = sumRes.tree.sections[0].keyPoints;
    assert.equal(kps[0].citationStatus, 'verified');
    assert.equal(kps[0].segId, 'S01');
    assert.equal(kps[0].seconds, 5);
    assert.equal(kps[1].citationStatus, 'unverified');
    assert.equal(kps[1].citation.reasonCode, 'id_not_found');
    assert.equal(kps[1].seconds, null);
    assert.equal(kps[2].citationStatus, 'unverified');
    assert.equal(kps[2].citation.reasonCode, 'text_mismatch');
    assert.equal(kps[2].seconds, null);

    // 2. askSectionQuestion: mixed verified [S01] + hallucinated [S77] + out-of-bounds 55:00
    const qaRes = await askSectionQuestion({
      win,
      courseTitle: '安全实务',
      courseId: 'c-e2e',
      section: sec,
      question: '提示词注入是什么？',
      fetchFn: async () => ({
        status: 200,
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                answer: '提示词注入会劫持模型指令 [S01]，另外参见 [S77] 和 55:00。',
                citations: [
                  { segId: 'S01', quote: '恶意上下文劫持模型指令', note: '提示词注入机理' },
                  { segId: 'S77', quote: '编造内容', note: '幻觉编号' },
                ],
              }),
            },
          }],
        }),
      }),
    });
    assert.equal(qaRes.ok, true);
    const cites = qaRes.message.citations;
    assert.ok(cites.some(c => c.verified && c.segId === 'S01'));
    assert.ok(cites.some(c => !c.verified && c.reasonCode === 'id_not_found' && c.segId === 'S77'));
    assert.ok(cites.some(c => !c.verified && c.reasonCode === 'time_out_of_bounds'));

    // 3. normalizeQuizPaper: verifies citations on quiz questions
    const quizQs = normalizeQuizPaper({
      questions: [
        { type: 'choice', question: '上线前必须完成什么？', options: ['A. 算法备案', 'B. 装打印机', 'C. 买咖啡', 'D. 关机'], correctIndex: 0, explanation: '见 [S02] 明确说明算法备案。', segId: 'S02', quote: '完成算法备案' },
        { type: 'choice', question: '伪造引用题目？', options: ['A. 选项1', 'B. 选项2', 'C. 选项3', 'D. 选项4'], correctIndex: 1, explanation: '见 [S99]。', segId: 'S99', quote: '不存在' },
      ],
    }, { section: sec });
    assert.equal(quizQs[0].citationStatus, 'verified');
    assert.equal(quizQs[0].segId, 'S02');
    assert.equal(quizQs[0].seconds, 40);
    assert.equal(quizQs[1].citationStatus, 'unverified');
    assert.equal(quizQs[1].citation.reasonCode, 'id_not_found');
    assert.equal(quizQs[1].seconds, null);
  } finally {
    dom.window.close();
  }
});

// ============================================================================
// 4. 点引用原地标黄展开 + 分离跳播开声 + 静音挂课保护 + 跨节提示 + 错题深挖独立会话
// ============================================================================

test('点引用先原地标黄展开原文与前后邻段再分离跳播，未核实引用独立样式可展开对照；答错出「深挖这道题」建独立新会话预填', async () => {
  const html = `
    <div class="course-side-title-row"><span class="text-overflow" title="强引用实战课">强引用实战课</span></div>
    <div class="chapter-list chapter-all"><ul><li>
      <dl class="focus" id="D1show-sectionssec-ui1" data-courseId="c-ui"><dt><span class="qcontent" title="第一节 强引用核验">第一节 强引用核验</span></dt></dl>
    </li></ul></div>
  `;
  const { dom, win } = createMockGmWindow('https://wangda.chinamobile.com/#/study/course/detail/c-ui/6', html);
  try {
    const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
    const controller = { getState: () => structuredClone(state), subscribe: () => () => {}, diagnose: () => ({ kind: 'course' }) };
    const segs = assignStableSegmentIds([
      { startMs: 0, endMs: 25000, text: '开场回顾企业安全治理框架演进背景。' },
      { startMs: 30000, endMs: 65000, text: '提示词注入可诱导智能体越权执行高危业务操作。' },
      { startMs: 70000, endMs: 100000, text: '因此必须落实最小权限控制与人工二次确认机制。' },
    ], 'sec-ui1');
    const secIdx = buildSegmentIndex({ sectionId: 'sec-ui1', segments: segs, durationSec: 100 });

    const verifiedCite = verifyCitation({ segId: 'S02', quote: '提示词注入可诱导智能体越权' }, secIdx);
    const unverifiedCite = verifyCitation({ segId: 'S99', quote: 'AI 幻觉编造的段落' }, secIdx);
    const mismatchCite = verifyCitation({ segId: 'S02', quote: '完全不相干的财务审批流程' }, secIdx);

    const seekCalls = [];
    saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-ui', transport: 'fetch' });

    const fakeTree = {
      mode: 'ai',
      scope: 'section',
      scopeLabel: '当前课节（第一节 强引用核验）',
      courseId: 'c-ui',
      activeSectionId: 'sec-ui1',
      courseTitle: '强引用实战课',
      overview: '本节讲解提示词注入风险与最小权限防护。',
      courseKeyPoints: [],
      hasAnySubtitle: true,
      noSubtitle: false,
      sections: [{
        sectionId: 'sec-ui1',
        sectionIndex: 1,
        title: '第一节 强引用核验',
        mode: 'ai',
        hasSubtitle: true,
        durationSec: 100,
        summary: '本节讲解提示词注入风险与最小权限防护。',
        keyPoints: [
          { text: '提示词注入会诱导智能体越权操作。', segId: 'S02', refKey: 'sec-ui1#S02', seconds: 30, timestamp: '00:30', citationStatus: 'verified', citation: verifiedCite },
          { text: '幻觉引用测试要点。', segId: 'S99', seconds: null, timestamp: '', citationStatus: 'unverified', citation: unverifiedCite },
          { text: '原文不符引用测试要点。', segId: 'S02', seconds: null, timestamp: '', citationStatus: 'unverified', citation: mismatchCite },
        ],
        outline: [],
        quiz: [],
        glossary: [],
        timeline: segs,
        segments: segs,
      }],
    };

    const mockKnowledge = {
      providers: [],
      privacyNotice: '安全说明',
      getSettings: () => loadAiSettings(win),
      saveSettings: next => saveAiSettings(win, next),
      clearApiKey: () => ({ ok: true }),
      getStorageStatus: () => getStorageStatus(win),
      getTransportDeps: () => ({
        fetchFn: async (_url, init) => {
          const payload = JSON.parse(init.body);
          sentPayloads.push(payload);
          return {
            status: 200,
            text: async () => JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ answer: '深挖解析：见 [S02] 说明智能体越权风险。', citations: [{ segId: 'S02', quote: '诱导智能体越权执行高危业务操作', note: '核心依据' }] }) } }],
            }),
          };
        },
      }),
      abort() {},
      mapOptions: { skipCdn: true },
      analyze: async () => ({
        courseData: { courseId: 'c-ui', title: '强引用实战课', activeSectionId: 'sec-ui1', captionedSections: 1, hasAnySubtitle: true, sections: fakeTree.sections },
        estimates: {},
        tree: fakeTree,
        markdown: '# 强引用实战课',
        usedAi: true,
        fallback: false,
        noSubtitle: false,
      }),
      seek: payload => { seekCalls.push(payload); return { ok: true, unmuted: Boolean(payload.unmute), message: `已跳播至 ${payload.seconds}s` }; },
    };
    const sentPayloads = [];

    // Pre-populate an existing general Q&A session so we can prove wrong-question deep-dive creates a brand-new isolated session!
    saveSectionChat(win, 'c-ui', 'sec-ui1', [
      { id: 'u-old', role: 'user', content: '旧会话里的无关历史提问' },
      { id: 'a-old', role: 'assistant', content: '旧会话里的无关历史回复', citations: [] },
    ]);

    // Pre-populate a quiz for sec-ui1
    saveSectionQuiz(win, 'c-ui', 'sec-ui1', {
      cachedAt: Date.now(),
      sectionId: 'sec-ui1',
      sectionTitle: '第一节 强引用核验',
      questions: [
        {
          id: 'q-1',
          type: 'choice',
          question: '提示词注入会带来什么风险？',
          options: ['A. 诱导智能体越权执行高危操作', 'B. 自动提升网速', 'C. 降低屏幕亮度', 'D. 节省磁盘空间'],
          correctIndex: 0,
          answerLetter: 'A',
          explanation: '依据 [S02] 讲明提示词注入可诱导智能体越权执行。',
          segId: 'S02',
          refKey: 'sec-ui1#S02',
          seconds: 30,
          timestamp: '00:30',
          citationStatus: 'verified',
          citation: verifiedCite,
        },
        {
          id: 'q-2',
          type: 'choice',
          question: '防护策略强调什么？',
          options: ['A. 最小权限控制', 'B. 完全开放权限', 'C. 关闭日志', 'D. 忽略告警'],
          correctIndex: 0,
          answerLetter: 'A',
          explanation: '依据 [S03] 强调最小权限控制。',
          segId: 'S03',
          refKey: 'sec-ui1#S03',
          seconds: 70,
          timestamp: '01:10',
          citationStatus: 'verified',
          citation: verifyCitation({ segId: 'S03', quote: '落实最小权限控制' }, secIdx),
        },
      ],
      attempt: { answers: {}, submitted: false, submittedAt: null },
    });

    const panel = createPanel(win, controller, '0.1.0-beta.21', mockKnowledge);
    panel.open();
    const root = win.document.getElementById('wangda-assistant').shadowRoot;
    root.querySelector('[data-action="knowledge-open"]').click();
    for (let i = 0; i < 40; i += 1) await Promise.resolve();

    const modal = root.querySelector('[data-knowledge-modal]');
    const kpItems = [...modal.querySelectorAll('[data-kg-keypoints] li')];
    assert.equal(kpItems.length, 3);

    // 1. Clicking verified citation button highlights host + expands prev/current/next WITHOUT seeking!
    const verifiedBtn = kpItems[0].querySelector('[data-cite-status="verified"]');
    assert.ok(verifiedBtn);
    verifiedBtn.click();
    assert.equal(seekCalls.length, 0, '单击引用不得直接跳进度条');
    assert.equal(kpItems[0].dataset.citeHighlighted, 'true');
    assert.equal(verifiedBtn.dataset.citeActive, 'true');
    const evCard = kpItems[0].querySelector('[data-kg-evidence-card]');
    assert.ok(evCard, '应原地展开原字幕证据卡片');
    assert.match(evCard.querySelector('[data-ev-neighbor="prev"]').textContent, /开场回顾/u, '应展示上一段邻接字幕');
    assert.match(evCard.querySelector('[data-ev-current]').textContent, /提示词注入可诱导智能体越权/u, '应高亮展示命中段原字幕');
    assert.match(evCard.querySelector('[data-ev-neighbor="next"]').textContent, /最小权限控制/u, '应展示下一段邻接字幕');

    // Separate "跳播并开声" button triggers seek with unmute: true
    const seekUnmuteBtn = evCard.querySelector('[data-action="kg-evidence-seek-unmute"]');
    assert.ok(seekUnmuteBtn);
    seekUnmuteBtn.click();
    assert.equal(seekCalls.length, 1);
    assert.deepEqual(seekCalls[0], { sectionId: 'sec-ui1', seconds: 30, unmute: true });

    // 2. Unverified citations render with independent unverified style, NO data-seek-seconds, expandable to inspect AI output
    const unverifiedBtn = kpItems[1].querySelector('[data-cite-status="unverified"]');
    assert.ok(unverifiedBtn);
    assert.equal(unverifiedBtn.classList.contains('kg-cite-unverified'), true);
    assert.equal(unverifiedBtn.dataset.seekSeconds, undefined);
    unverifiedBtn.click();
    assert.equal(seekCalls.length, 1, '点击未核实引用绝不触发跳播');
    const unvCard = kpItems[1].querySelector('[data-kg-unverified-card]');
    assert.ok(unvCard);
    assert.equal(unvCard.querySelector('[data-action="kg-evidence-seek-unmute"]'), null, '未核实引用不得展示为已核对可跳播证据');
    assert.match(unvCard.textContent, /S99/u);
    assert.match(unvCard.textContent, /AI 幻觉编造的段落/u);

    // Mismatch unverified card also displays actual original subtitle for comparison
    kpItems[2].querySelector('[data-cite-status="unverified"]').click();
    const misCard = kpItems[2].querySelector('[data-kg-unverified-card]');
    assert.match(misCard.textContent, /完全不相干的财务审批流程/u);
    assert.match(misCard.textContent, /提示词注入可诱导智能体越权/u);

    // 3. Switch to Quiz tab -> answer q-1 WRONG, q-2 RIGHT -> submit -> "深挖这道题" appears ONLY on q-1!
    modal.querySelector('[data-action="kg-tab-quiz"]').click();
    const q1RadioWrong = modal.querySelector('input[name="wd-quiz-sec-ui1-q-1"][value="2"]');
    const q2RadioRight = modal.querySelector('input[name="wd-quiz-sec-ui1-q-2"][value="0"]');
    q1RadioWrong.checked = true; q1RadioWrong.dispatchEvent(new win.Event('change', { bubbles: true }));
    q2RadioRight.checked = true; q2RadioRight.dispatchEvent(new win.Event('change', { bubbles: true }));
    modal.querySelector('[data-action="kg-quiz-submit"]').click();

    const wrongBtns = [...modal.querySelectorAll('[data-action="kg-quiz-deepdive"]')];
    assert.equal(wrongBtns.length, 1, '仅答错的题目应展示「深挖这道题」按钮');
    assert.equal(wrongBtns[0].dataset.questionId, 'q-1');

    // Wrong question persisted in durable wrongQuestions shard & mastery marked 'weak'
    const wrongs = loadCourseWrongQuestions(win, 'c-ui');
    assert.equal(wrongs.length, 1);
    assert.equal(wrongs[0].questionId, 'q-1');
    assert.equal(loadCourseMastery(win, 'c-ui')['sec-ui1'].status, 'weak');

    // Click "深挖这道题" -> creates brand-new isolated session + prefills stem/options/answer/explanation/citation ID & original text!
    wrongBtns[0].click();
    const qaInput = modal.querySelector('[data-kg-qa-input]');
    assert.equal(modal.querySelector('[data-kg-qa-thread]').hidden, false);
    assert.match(qaInput.value, /提示词注入会带来什么风险/u, '应预填题干');
    assert.match(qaInput.value, /A\. 诱导智能体越权执行高危操作/u, '应预填选项');
    assert.match(qaInput.value, /C\. 降低屏幕亮度/u, '应预填我的错选');
    assert.match(qaInput.value, /正确答案：A\. 诱导智能体越权执行高危操作/u, '应预填正确答案');
    assert.match(qaInput.value, /解析/u, '应预填解析');
    assert.match(qaInput.value, /\[S02\]/u, '应预填引用段落 ID');
    assert.match(qaInput.value, /提示词注入可诱导智能体越权执行高危业务操作/u, '应预填原字幕原文');

    // Send deep-dive question -> verify LLM request history DOES NOT contain old session messages (zero context contamination)!
    modal.querySelector('[data-action="kg-qa-send"]').click();
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    assert.equal(sentPayloads.length, 1);
    const historyMsgs = sentPayloads[0].messages.slice(1, -1);
    assert.equal(historyMsgs.length, 0, '深挖新会话不得混入旧会话历史消息导致串味');
    assert.equal(JSON.stringify(sentPayloads[0].messages).includes('旧会话里的无关历史提问'), false);

    // Original general session is still preserved intact in durable store!
    const oldSession = loadSectionChat(win, 'c-ui', 'sec-ui1', 'default');
    assert.equal(oldSession.messages.length, 2);
    assert.equal(oldSession.messages[0].content, '旧会话里的无关历史提问');

    panel.destroy();
  } finally {
    dom.window.close();
  }
});

test('跳播并开声安全保护：暂停态正常开声、自动静音挂课运行中不破坏静音策略、播放器不在本课节给出明确提示', () => {
  const dom = new JSDOM('<body><video></video></body>', { url: 'https://wangda.chinamobile.com/#/study/course/detail/c1/6' });
  try {
    const win = dom.window;
    const video = win.document.querySelector('video');
    Object.defineProperty(video, 'duration', { value: 180, configurable: true });
    video.muted = true;
    video.volume = 0;
    video.play = () => Promise.resolve();

    // 1. Paused queue + unmute: true -> seeks AND unmutes safely
    const rUnmute = seekCourseTime({
      win,
      pageWin: {},
      adapter: { read: () => ({ kind: 'course', courseId: 'c1', activeSectionId: 's1' }) },
      sectionId: 's1',
      seconds: 35,
      queueRunning: false,
      unmute: true,
      autoMuteEnabled: true,
      expectedCourseId: 'c1',
    });
    assert.equal(rUnmute.ok, true);
    assert.equal(rUnmute.unmuted, true);
    assert.equal(video.currentTime, 35);
    assert.equal(video.muted, false);
    assert.ok(video.volume > 0);

    // 2. Running queue + autoMuteEnabled: true -> seeks WITHOUT unmuting (protects silent hang-course state machine!)
    video.muted = true;
    const rProtected = seekCourseTime({
      win,
      pageWin: {},
      adapter: { read: () => ({ kind: 'course', courseId: 'c1', activeSectionId: 's1' }) },
      sectionId: 's1',
      seconds: 50,
      queueRunning: true,
      unmute: true,
      autoMuteEnabled: true,
      expectedCourseId: 'c1',
    });
    assert.equal(rProtected.ok, true);
    assert.equal(video.currentTime, 50);
    assert.equal(video.muted, true, '自动静音挂课运行中不得强制取消静音破坏挂课逻辑');
    assert.equal(rProtected.muteProtected, true);
    assert.match(rProtected.message, /保持静音/u);

    // 3. Player not on current section (and not on course page) -> explicit warning, never silent fail
    const rWrongSec = seekCourseTime({
      win,
      pageWin: {},
      adapter: { read: () => ({ kind: 'course', courseId: 'c1', activeSectionId: 's-other' }), selectSection: () => false },
      sectionId: 's1',
      seconds: 35,
    });
    assert.equal(rWrongSec.ok, false);
    assert.equal(rWrongSec.notOnSection, true);
    assert.match(rWrongSec.message, /不在本课节/u);

    const rNotCourse = seekCourseTime({
      win,
      pageWin: {},
      adapter: { read: () => ({ kind: 'subject', courseId: null, activeSectionId: null }) },
      sectionId: 's1',
      seconds: 35,
    });
    assert.equal(rNotCourse.ok, false);
    assert.equal(rNotCourse.notOnSection, true);
    assert.match(rNotCourse.message, /不是课程播放页/u);
  } finally {
    dom.window.close();
  }
});

// ============================================================================
// 5. 分层存储：13 门课零淘汰、IndexedDB 分片镜像、LRU+TTL 缓存、一次性迁移（含失败保护）与降级路径
// ============================================================================

test('用户资产按课分片持久存储：13 门课 65 节问答与测验全部保留无淘汰（解决旧 20/30 硬顶），并支持 IndexedDB 镜像', async () => {
  const { dom, win } = createMockGmWindow();
  const fakeIdb = createFakeIndexedDb();
  win.indexedDB = fakeIdb.indexedDB;
  try {
    // Write 13 courses x 5 sections = 65 sections of Q&A + 65 sections of Quiz + wrongQuestions + mastery + reviewPlan + notes
    for (let c = 1; c <= 13; c += 1) {
      const cid = `course-${c}`;
      for (let s = 1; s <= 5; s += 1) {
        const sid = `sec-${s}`;
        assert.equal(saveSectionChat(win, cid, sid, [
          { id: `u-${c}-${s}`, role: 'user', content: `课程${c}第${s}节问题` },
          { id: `a-${c}-${s}`, role: 'assistant', content: `课程${c}第${s}节回答 [S01]`, citations: [] },
        ]), true);
        assert.equal(saveSectionQuiz(win, cid, sid, {
          cachedAt: Date.now(),
          sectionId: sid,
          questions: [{ id: 'q-1', type: 'choice', question: `题${c}-${s}`, options: ['A. 1', 'B. 2'], correctIndex: 0, answerLetter: 'A' }],
          attempt: { answers: {}, submitted: false },
        }), true);
      }
      recordWrongQuestionAsset(win, cid, { sectionId: 'sec-1', questionId: 'q-1', question: `错题${c}`, correctIndex: 0, chosenIndex: 1 });
      updateSectionMasteryAsset(win, cid, 'sec-1', { status: 'weak', score: 60 });
      saveCourseReviewPlan(win, cid, { cards: [{ id: `card-${c}`, dueAt: 1000 }], schedule: { targetDate: '2026-12-31', dailyGoal: 2 } });
      saveSectionNote(win, cid, 'sec-1', { segId: 'S01', seconds: 15, content: `第${c}门课核心笔记` });
    }

    // Wait microtasks for async IndexedDB mirroring
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    // Verify ALL 13 courses and ALL 65 sections survived with ZERO eviction!
    const indexedCourses = listIndexedCourseIds(win);
    assert.equal(indexedCourses.length, 13);
    assert.equal(readAssetIndex(win).schemaVersion, WD_STORAGE_SCHEMA_VERSION);
    for (let c = 1; c <= 13; c += 1) {
      const cid = `course-${c}`;
      for (let s = 1; s <= 5; s += 1) {
        const sid = `sec-${s}`;
        assert.equal(loadSectionChat(win, cid, sid).messages[0].content, `课程${c}第${s}节问题`, `课程${c}第${s}节问答不得被淘汰`);
        assert.equal(loadSectionQuiz(win, cid, sid).questions[0].question, `题${c}-${s}`, `课程${c}第${s}节测验不得被淘汰`);
      }
      assert.equal(loadCourseWrongQuestions(win, cid).length, 1);
      assert.equal(loadCourseMastery(win, cid)['sec-1'].status, 'weak');
      assert.equal(loadCourseReviewPlan(win, cid).cards.length, 1);
      assert.equal(loadSectionNotes(win, cid, 'sec-1')[0].content, `第${c}门课核心笔记`);
    }

    // Verify IndexedDB mirror also captured course shards
    const idbShard = await readAssetShardFromIdb(win, 'course-1', 'qa');
    assert.ok(idbShard);
    assert.equal(idbShard.courseId, 'course-1');
    const allIdb = await listAllIdbShards(win);
    assert.ok(allIdb.length >= 13 * 6, 'IndexedDB 应镜像全部 13 门课 6 类资产分片');
  } finally {
    dom.window.close();
  }
});

test('可重建缓存 LRU + TTL 淘汰策略：超时失效、超上限按 LRU 淘汰，且绝不影响用户资产', () => {
  const { dom, win } = createMockGmWindow();
  try {
    // Seed durable user asset first
    saveSectionNote(win, 'c-lru', 's1', { content: '绝不能受缓存淘汰影响的永久笔记' });

    const t0 = 1_700_000_000_000;
    const policy = { maxEntries: 2, ttlMs: 10_000, now: t0 };
    assert.equal(setLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.knowledge, 'k1', { schemaVersion: 3, tree: { a: 1 }, markdown: '#1' }, policy), true);
    assert.equal(setLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.knowledge, 'k2', { schemaVersion: 3, tree: { a: 2 }, markdown: '#2' }, { ...policy, now: t0 + 1000 }), true);
    // Access k1 so k2 becomes least-recently-used
    assert.ok(getLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.knowledge, 'k1', { ...policy, now: t0 + 2000 }));
    // Insert k3 -> k2 MUST be evicted, k1 and k3 kept!
    assert.equal(setLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.knowledge, 'k3', { schemaVersion: 3, tree: { a: 3 }, markdown: '#3' }, { ...policy, now: t0 + 3000 }), true);
    const mapAfterCap = readLruCacheMap(win, WD_CACHE_STORAGE_KEYS.knowledge);
    assert.deepEqual(Object.keys(mapAfterCap).sort(), ['k1', 'k3']);

    // TTL expiration: after t0 + 20_000, k1 is expired and returns null
    assert.equal(getLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.knowledge, 'k1', { ...policy, now: t0 + 20_000 }), null);

    // Durable user asset completely unaffected
    assert.equal(loadSectionNotes(win, 'c-lru', 's1')[0].content, '绝不能受缓存淘汰影响的永久笔记');
  } finally {
    dom.window.close();
  }
});

test('一次性迁移（正常路径 + 失败保留原始数据不丢失）', () => {
  // Part A: Successful one-time migration from legacy localStorage -> GM_setValue + LRU cache
  {
    const { dom, win, gmStore } = createMockGmWindow();
    try {
      win.localStorage.setItem(WD_LEGACY_STORAGE_KEYS.config, JSON.stringify({ provider: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', transport: 'auto' }));
      win.localStorage.setItem(WD_LEGACY_STORAGE_KEYS.apiKey, 'sk-legacy-secret');
      win.localStorage.setItem(WD_LEGACY_STORAGE_KEYS.qa, JSON.stringify({
        'c-old::s-1': { updatedAt: 1000, messages: [{ role: 'user', content: '旧问答问题' }, { role: 'assistant', content: '旧问答回复' }] },
      }));
      win.localStorage.setItem(WD_LEGACY_STORAGE_KEYS.quiz, JSON.stringify({
        'c-old::s-1': {
          sectionTitle: '旧课节',
          questions: [{ id: 'q-1', type: 'choice', question: '旧测验题', options: ['A. 对', 'B. 错'], correctIndex: 0, answerLetter: 'A', explanation: '解析' }],
          attempt: { submitted: true, answers: { 'q-1': 1 } },
        },
      }));
      win.localStorage.setItem(WD_LEGACY_STORAGE_KEYS.cacheV2, JSON.stringify({
        'c-old::course': { schemaVersion: 2, cachedAt: Date.now(), tree: { courseTitle: '旧课', sections: [] }, markdown: '# 旧课', usedAi: true },
      }));

      const receipt = migrateLegacyStorage(win);
      assert.equal(receipt.status, 'migrated');
      assert.equal(receipt.items.config.status, 'migrated');
      assert.equal(receipt.items.apiKey.status, 'migrated');
      assert.equal(receipt.items.apiKey.cleanedLegacy, true);
      assert.equal(receipt.items.qa.status, 'migrated');
      assert.equal(receipt.items.quiz.status, 'migrated');
      assert.equal(receipt.items.quiz.wrongQuestions, 1);
      assert.equal(receipt.items.cache.status, 'migrated');

      // Plaintext API Key scrubbed from host localStorage after GM verification
      assert.equal(win.localStorage.getItem(WD_LEGACY_STORAGE_KEYS.apiKey), null);
      assert.equal(gmStore.get(WD_GM_STORAGE_KEYS.apiKey), 'sk-legacy-secret');
      assert.equal(loadAiSettings(win).apiKey, 'sk-legacy-secret');
      assert.equal(loadAiSettings(win).provider, 'dashscope');
      assert.equal(loadSectionChat(win, 'c-old', 's-1').messages[0].content, '旧问答问题');
      assert.equal(loadSectionQuiz(win, 'c-old', 's-1').questions[0].question, '旧测验题');
      assert.equal(loadCourseWrongQuestions(win, 'c-old').length, 1);
      assert.ok(loadKnowledgeCache(win, 'c-old::course'));

      // Second run is idempotent (does not re-migrate or overwrite)
      const second = migrateLegacyStorage(win);
      assert.equal(second.completedAt, receipt.completedAt);
    } finally {
      dom.window.close();
    }
  }

  // Part B: Failure path (corrupted JSON + GM write failure) MUST preserve original localStorage data untouched & emit warnings!
  {
    const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/home' });
    try {
      const win = dom.window;
      const gmStore = new Map();
      win.GM_getValue = (k, d) => (gmStore.has(k) ? gmStore.get(k) : d);
      win.GM_setValue = (k, v) => {
        if (k === WD_GM_STORAGE_KEYS.apiKey) throw new Error('GM_QUOTA_ERROR');
        gmStore.set(k, v);
      };
      win.localStorage.setItem(WD_LEGACY_STORAGE_KEYS.apiKey, 'sk-must-not-lose');
      win.localStorage.setItem(WD_LEGACY_STORAGE_KEYS.qa, '{broken json!!!');

      const receipt = migrateLegacyStorage(win);
      assert.equal(receipt.status, 'failed');
      assert.equal(receipt.items.apiKey.status, 'failed');
      assert.equal(receipt.items.apiKey.preservedRaw, true);
      assert.equal(receipt.items.qa.status, 'failed');
      assert.equal(receipt.items.qa.preservedRaw, true);
      assert.ok(receipt.warnings.length >= 2);
      // Original raw data 100% preserved!
      assert.equal(win.localStorage.getItem(WD_LEGACY_STORAGE_KEYS.apiKey), 'sk-must-not-lose', '迁移失败不得删除原始 API Key');
      assert.equal(win.localStorage.getItem(WD_LEGACY_STORAGE_KEYS.qa), '{broken json!!!', '迁移失败不得删除原始问答数据');
    } finally {
      dom.window.close();
    }
  }
});

test('降级路径：非油猴环境（GM_setValue 不可用）可正常加载运行、回退 localStorage 并明确告警', () => {
  const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/home' });
  try {
    const win = dom.window;
    // Explicitly no GM_getValue / GM_setValue
    const st = getStorageStatus(win, { gmStorage: null });
    assert.equal(st.hasGm, false);
    assert.equal(st.degraded, true);
    assert.equal(st.backend, 'localStorage-fallback');
    assert.ok(st.warnings.some(w => /GM_setValue/u.test(w) && /降级/u.test(w)));

    const saved = saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-fallback' }, { gmStorage: null });
    assert.equal(saved.ok, true);
    assert.equal(saved.degraded, true);
    assert.equal(loadAiSettings(win, { gmStorage: null }).apiKey, 'sk-fallback');

    assert.equal(saveSectionChat(win, 'c-fb', 's1', [{ role: 'user', content: '纯浏览器问答' }]), true);
    assert.equal(loadSectionChat(win, 'c-fb', 's1').messages[0].content, '纯浏览器问答');

    // Panel renders explicit degradation warning banner in AI settings without crashing
    const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null };
    const controller = { getState: () => structuredClone(state), subscribe: () => () => {}, diagnose: () => ({ kind: 'home' }) };
    const knowledge = createKnowledgeService({ win, pageWin: win, controller, gmStorage: null });
    const panel = createPanel(win, controller, '0.1.0-beta.21', knowledge);
    const root = win.document.getElementById('wangda-assistant').shadowRoot;
    const warnEl = root.querySelector('[data-ai-storage-warn]');
    assert.ok(warnEl);
    assert.equal(warnEl.hidden, false);
    assert.match(warnEl.textContent, /非油猴环境.*GM_setValue.*降级/u);
    panel.destroy();
  } finally {
    dom.window.close();
  }
});
