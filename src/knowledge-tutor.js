import { cleanAndSegmentCues, formatTimestamp, parseTimestampToSeconds, buildSeekHref, createSubtitleAvailabilityProber } from './knowledge-vtt.js';
import { WD_AI_STORAGE_KEYS, loadAiSettings, buildChatCompletionsUrl, sendAiHttpRequest, parseStrictJsonContent } from './knowledge-ai.js';

export function sectionHasSubtitle(section) {
  if (!section) return false;
  if (section.hasSubtitle === false) return false;
  if (section.hasSubtitle === true) return true;
  if (Array.isArray(section.cues) && section.cues.length > 0) return true;
  if (Array.isArray(section.segments) && section.segments.length > 0) return true;
  if (Array.isArray(section.timeline) && section.timeline.length > 0 && section.mode !== 'highlight' && section.mode !== 'placeholder') return true;
  return false;
}

export const WD_TUTOR_STORAGE_KEYS = {
  qa: 'wangda-assistant.ai.qa.v1',
  quiz: 'wangda-assistant.ai.quiz.v1',
};

const wdKtutMaxStoredSections = 30;
const wdKtutMaxMessagesPerSection = 24;
const wdKtutHistoryTurnsForPrompt = 6;
const wdKtutStyleId = 'wd-section-guide-entry-style';

function wdKtutStorage(win) {
  try { return win?.localStorage || null; } catch { return null; }
}

export function buildTutorSectionKey(courseId, sectionId) {
  const cid = String(courseId || 'unknown').trim() || 'unknown';
  const sid = String(sectionId || 'current').trim() || 'current';
  return `${cid}::${sid}`;
}

function wdKtutReadStore(win, storageKey) {
  const ls = wdKtutStorage(win);
  try {
    const raw = ls?.getItem?.(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function wdKtutWriteStore(win, storageKey, map) {
  const ls = wdKtutStorage(win);
  if (!ls || typeof ls.setItem !== 'function') return false;
  const entries = Object.entries(map)
    .filter(([, v]) => v && typeof v === 'object')
    .sort((a, b) => (Number(b[1].updatedAt || b[1].cachedAt) || 0) - (Number(a[1].updatedAt || a[1].cachedAt) || 0));
  for (let limit = Math.min(entries.length, wdKtutMaxStoredSections); limit >= 1; limit -= 1) {
    try {
      ls.setItem(storageKey, JSON.stringify(Object.fromEntries(entries.slice(0, limit))));
      return true;
    } catch { /* evict oldest entry on quota error */ }
  }
  return false;
}

export function loadSectionChat(win, courseId, sectionId) {
  const key = buildTutorSectionKey(courseId, sectionId);
  const entry = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.qa)[key];
  if (!entry || !Array.isArray(entry.messages)) return { key, messages: [], updatedAt: null };
  return { key, messages: entry.messages, updatedAt: entry.updatedAt || null };
}

export function saveSectionChat(win, courseId, sectionId, messages) {
  const key = buildTutorSectionKey(courseId, sectionId);
  const map = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.qa);
  const trimmed = (Array.isArray(messages) ? messages : []).slice(-wdKtutMaxMessagesPerSection);
  map[key] = { updatedAt: Date.now(), messages: trimmed };
  return wdKtutWriteStore(win, WD_TUTOR_STORAGE_KEYS.qa, map);
}

export function clearSectionChat(win, courseId, sectionId) {
  const ls = wdKtutStorage(win);
  if (!ls) return false;
  const key = buildTutorSectionKey(courseId, sectionId);
  const map = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.qa);
  delete map[key];
  try { ls.setItem(WD_TUTOR_STORAGE_KEYS.qa, JSON.stringify(map)); return true; } catch { return false; }
}

export function loadSectionQuiz(win, courseId, sectionId) {
  const key = buildTutorSectionKey(courseId, sectionId);
  const entry = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.quiz)[key];
  if (!entry || !Array.isArray(entry.questions) || !entry.questions.length) return null;
  return entry;
}

export function saveSectionQuiz(win, courseId, sectionId, quizRecord) {
  const key = buildTutorSectionKey(courseId, sectionId);
  const map = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.quiz);
  map[key] = { ...quizRecord, updatedAt: Date.now() };
  return wdKtutWriteStore(win, WD_TUTOR_STORAGE_KEYS.quiz, map);
}

export function clearSectionQuiz(win, courseId, sectionId) {
  const ls = wdKtutStorage(win);
  if (!ls) return false;
  const key = buildTutorSectionKey(courseId, sectionId);
  const map = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.quiz);
  delete map[key];
  try { ls.setItem(WD_TUTOR_STORAGE_KEYS.quiz, JSON.stringify(map)); return true; } catch { return false; }
}

function wdKtutExtractQueryTerms(query) {
  const text = String(query ?? '').toLowerCase();
  const terms = new Set();
  for (const m of text.matchAll(/[a-z0-9_-]{2,}/gu)) terms.add(m[0]);
  for (const m of text.matchAll(/[\u4e00-\u9fa5]{2,}/gu)) {
    const chunk = m[0];
    if (chunk.length <= 4) terms.add(chunk);
    for (let i = 0; i < chunk.length - 1; i += 1) {
      terms.add(chunk.slice(i, i + 2));
      if (i + 3 <= chunk.length) terms.add(chunk.slice(i, i + 3));
    }
  }
  const targetMinutes = [];
  for (const m of text.matchAll(/第\s*(\d{1,3})\s*分/gu)) targetMinutes.push(Number(m[1]) * 60);
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})\b/gu)) targetMinutes.push(Number(m[1]) * 60 + Number(m[2]));
  return { terms: [...terms], targetMinutes };
}

export function selectRelevantSectionContext(section, query = '', options = {}) {
  const maxContextChars = Number.isFinite(options.maxContextChars) ? options.maxContextChars : 7500;
  const rawSegments = Array.isArray(section?.segments) && section.segments.length
    ? section.segments
    : Array.isArray(section?.timeline) && section.timeline.length
      ? section.timeline.map((t, idx) => ({
        index: t.index || idx + 1,
        startSec: Number.isFinite(t.startSec) ? t.startSec : 0,
        timestamp: t.timestamp || formatTimestamp(t.startSec || 0),
        text: t.text || t.headline || '',
      }))
      : cleanAndSegmentCues(section?.cues || []).segments;

  const headerLines = [];
  if (section?.summary) headerLines.push(`【课节概览】${section.summary}`);
  if (Array.isArray(section?.keyPoints) && section.keyPoints.length) {
    headerLines.push(`【核心要点】${section.keyPoints.map(k => `${k.text}${k.timestamp ? `(${k.timestamp})` : ''}`).join('；')}`);
  }
  const outline = Array.isArray(section?.outline) && section.outline.length ? section.outline : (section?.topics || []);
  if (outline.length) {
    headerLines.push(`【知识点大纲】${outline.map(t => `${t.name}: ${(t.points || []).map(p => `${p.text}${p.timestamp ? `(${p.timestamp})` : ''}`).join('、')}`).join(' | ')}`);
  }
  const headerText = headerLines.join('\n').slice(0, Math.floor(maxContextChars * 0.25));
  const segBudget = Math.max(800, maxContextChars - headerText.length - 80);

  const formatted = rawSegments.map((seg, idx) => {
    const startSec = Number.isFinite(seg.startSec) ? Math.floor(seg.startSec) : Math.floor((Number(seg.startMs) || 0) / 1000);
    const ts = seg.timestamp || formatTimestamp(startSec);
    const minute = Math.floor(startSec / 60) + 1;
    const line = `[${ts} · 约第${minute}分钟] ${String(seg.text || '').trim()}`;
    return { idx, startSec, ts, line, textLower: String(seg.text || '').toLowerCase() };
  });

  const totalChars = formatted.reduce((sum, s) => sum + s.line.length + 1, 0);
  let chosen = formatted;
  let truncated = false;

  if (totalChars > segBudget && formatted.length > 0) {
    truncated = true;
    const { terms, targetMinutes } = wdKtutExtractQueryTerms(query);
    const scored = formatted.map(item => {
      let score = 0;
      for (const term of terms) {
        if (item.textLower.includes(term)) score += term.length >= 3 ? 4 : 1.5;
      }
      for (const targetSec of targetMinutes) {
        const dist = Math.abs(item.startSec - targetSec);
        if (dist <= 60) score += 12;
        else if (dist <= 180) score += 5;
      }
      if (item.idx === 0) score += 1;
      if (item.idx === formatted.length - 1) score += 0.5;
      return { item, score };
    });

    const hasSignal = scored.some(s => s.score > 1.5);
    const pickedIndices = new Set();
    let usedChars = 0;

    if (hasSignal) {
      scored.sort((a, b) => b.score - a.score || a.item.idx - b.item.idx);
      for (const { item } of scored) {
        const candidates = [item.idx];
        if (item.idx > 0) candidates.push(item.idx - 1);
        if (item.idx + 1 < formatted.length) candidates.push(item.idx + 1);
        for (const cIdx of candidates) {
          if (pickedIndices.has(cIdx)) continue;
          const len = formatted[cIdx].line.length + 1;
          if (usedChars + len <= segBudget) {
            pickedIndices.add(cIdx);
            usedChars += len;
          }
        }
        if (usedChars >= segBudget * 0.92) break;
      }
    } else {
      // Uniformly sample across timeline when no query keywords (e.g., quiz generation on long transcript)
      const step = Math.max(1, Math.ceil(totalChars / segBudget));
      for (let i = 0; i < formatted.length; i += step) {
        const len = formatted[i].line.length + 1;
        if (usedChars + len <= segBudget) {
          pickedIndices.add(i);
          usedChars += len;
        }
      }
      // Fill remaining budget greedily from start
      for (let i = 0; i < formatted.length && usedChars < segBudget * 0.85; i += 1) {
        if (pickedIndices.has(i)) continue;
        const len = formatted[i].line.length + 1;
        if (usedChars + len <= segBudget) { pickedIndices.add(i); usedChars += len; }
      }
    }
    chosen = [...pickedIndices].sort((a, b) => a - b).map(i => formatted[i]);
  }

  const transcriptBlock = chosen.length
    ? chosen.map(c => c.line).join('\n')
    : '（本课节暂无字幕原文，仅可依据上方标题或知识点作答）';
  const contextText = [headerText, '【带时间戳字幕片段】', transcriptBlock].filter(Boolean).join('\n\n');
  return {
    contextText,
    totalSegments: formatted.length,
    selectedSegments: chosen.length,
    truncated,
    totalChars,
    selectedChars: chosen.reduce((sum, s) => sum + s.line.length + 1, 0),
  };
}

export function extractTimestampsFromText(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text ?? '').matchAll(/(?<!\d)(\d{1,2}:\d{2}(?::\d{2})?)(?!\d)/gu)) {
    const sec = parseTimestampToSeconds(m[1]);
    if (sec === null) continue;
    const floorSec = Math.floor(sec);
    if (seen.has(floorSec)) continue;
    seen.add(floorSec);
    out.push({
      seconds: floorSec,
      timestamp: formatTimestamp(floorSec),
      minuteLabel: `约第 ${Math.floor(floorSec / 60) + 1} 分钟`,
      note: '',
    });
  }
  return out;
}

function wdKtutNormalizeCitations(rawCitations, answerText) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(rawCitations)) {
    for (const c of rawCitations) {
      if (!c) continue;
      const rawTime = typeof c === 'string' ? c : (c.time ?? c.timestamp ?? c.seconds);
      const sec = parseTimestampToSeconds(rawTime);
      if (sec === null) continue;
      const floorSec = Math.floor(sec);
      if (seen.has(floorSec)) continue;
      seen.add(floorSec);
      out.push({
        seconds: floorSec,
        timestamp: formatTimestamp(floorSec),
        minuteLabel: `约第 ${Math.floor(floorSec / 60) + 1} 分钟`,
        note: typeof c === 'object' ? String(c.note || c.reason || c.excerpt || '').trim().slice(0, 40) : '',
      });
    }
  }
  for (const item of extractTimestampsFromText(answerText)) {
    if (seen.has(item.seconds)) continue;
    seen.add(item.seconds);
    out.push(item);
  }
  return out.slice(0, 6);
}

export function buildSectionQaMessages({ courseTitle, section, contextText, history = [], question }) {
  const system = [
    '你是网大课程的课节级学习问答助教。请严格依据下方提供的「本课节知识点与带时间戳字幕片段」回答学员问题。',
    '核心要求：',
    '1. 严禁凭空编造课程未讲过的内容；若字幕中未提及，请直接说明「本课节字幕未提及该内容」，不要瞎编；',
    '2. 回答必须标注依据大约在视频第几分钟以及精确 mm:ss 时间点（例如：「约第 2 分钟 (01:50)」）；',
    '3. 优先输出合法 JSON（无多余前后缀）：{"answer":"简明易懂的中文回答，文内引用 (mm:ss)","citations":[{"time":"mm:ss","note":"依据简述(<=24字)"}]}；',
    `当前课程：《${courseTitle || '当前课程'}》`,
    `当前课节：《${section?.title || '当前课节'}》`,
    '',
    contextText,
  ].join('\n');

  const trimmedHistory = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-wdKtutHistoryTurnsForPrompt)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 1200) }));

  return [
    { role: 'system', content: system },
    ...trimmedHistory,
    { role: 'user', content: String(question ?? '').trim() },
  ];
}

async function wdKtutInvokeLlm({ settings, messages, gmRequest, fetchFn, signal, timeoutMs = 45000 }) {
  const endpoint = buildChatCompletionsUrl(settings.baseUrl);
  if (!settings.model?.trim()) throw new Error('未填写模型名');
  const res = await sendAiHttpRequest({
    transport: settings.transport,
    gmRequest,
    fetchFn,
    url: endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({ model: settings.model, temperature: 0.25, messages }),
    timeoutMs,
    signal,
  });
  if (res.status < 200 || res.status >= 300) {
    let detail = '';
    try { const obj = JSON.parse(res.text); detail = obj?.error?.message || obj?.message || ''; } catch { detail = ''; }
    if (res.status === 401 || res.status === 403) throw new Error(`API Key 无效或无权限（HTTP ${res.status}${detail ? `：${detail.slice(0, 80)}` : ''}）`);
    if (res.status === 402 || res.status === 429) throw new Error(`额度耗尽或请求受限（HTTP ${res.status}${detail ? `：${detail.slice(0, 80)}` : ''}）`);
    throw new Error(`接口返回错误（HTTP ${res.status}${detail ? `：${detail.slice(0, 80)}` : ''}）`);
  }
  let envelope;
  try { envelope = JSON.parse(res.text); } catch { throw new Error('接口响应体不是合法 JSON'); }
  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型未返回有效回答内容');
  return { content: content.trim(), channel: res.channel };
}

export async function askSectionQuestion({ win, courseTitle, courseId, section, question, settings, gmRequest, fetchFn, signal, maxContextChars = 7500, timeoutMs = 45000 }) {
  const qText = String(question ?? '').trim();
  if (!qText) return { ok: false, error: '请输入你想提问的内容。' };
  if (!sectionHasSubtitle(section)) {
    return {
      ok: false,
      noSubtitle: true,
      error: section?.subtitleReason || '本课无字幕：该课节没有 AI 字幕，因此无法基于字幕进行 AI 问答。',
    };
  }
  const cfg = settings || loadAiSettings(win);
  if (!cfg?.apiKey?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先点击「AI 设置」填写 Provider、Base URL 与 API Key。' };
  }
  try { buildChatCompletionsUrl(cfg.baseUrl); } catch (err) {
    return { ok: false, needsAiConfig: true, error: `AI 配置无效（${err.message}），请检查「AI 设置」。` };
  }
  if (!cfg.model?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先在「AI 设置」中填写模型名。' };
  }

  const sectionId = section?.sectionId || 'current';
  const stored = loadSectionChat(win, courseId, sectionId);
  const ctx = selectRelevantSectionContext(section, qText, { maxContextChars });
  const messages = buildSectionQaMessages({
    courseTitle,
    section,
    contextText: ctx.contextText,
    history: stored.messages,
    question: qText,
  });

  try {
    const { content, channel } = await wdKtutInvokeLlm({ settings: cfg, messages, gmRequest, fetchFn, signal, timeoutMs });
    let answer = content;
    let rawCitations = [];
    try {
      const parsed = parseStrictJsonContent(content);
      if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
        answer = parsed.answer.trim();
        rawCitations = parsed.citations || parsed.evidence || parsed.references || [];
      }
    } catch {
      // Graceful plain-text fallback: keep full answer text & extract mm:ss timestamps
    }
    const citations = wdKtutNormalizeCitations(rawCitations, answer);
    const nowTs = Date.now();
    const userMsg = { id: `u-${nowTs}`, role: 'user', content: qText, createdAt: nowTs };
    const assistantMsg = {
      id: `a-${nowTs + 1}`,
      role: 'assistant',
      content: answer,
      citations,
      createdAt: nowTs + 1,
      contextMeta: {
        selectedSegments: ctx.selectedSegments,
        totalSegments: ctx.totalSegments,
        truncated: ctx.truncated,
      },
    };
    const nextMessages = [...stored.messages, userMsg, assistantMsg].slice(-wdKtutMaxMessagesPerSection);
    saveSectionChat(win, courseId, sectionId, nextMessages);
    return { ok: true, message: assistantMsg, messages: nextMessages, contextMeta: assistantMsg.contextMeta, channel };
  } catch (err) {
    return { ok: false, error: `AI 提问失败：${err?.message || err}` };
  }
}

export function buildSectionQuizPrompt({ courseTitle, section, contextText }) {
  const system = [
    '你是企业培训课程出题教练。请严格根据下方本课节知识点与带时间戳字幕，出 4 道高质量自测题（默认 2~3 道单选题 + 1~2 道简答题，总题数 3~5 题）。',
    '只输出合法 JSON，不要任何前言或解释。',
    'JSON Schema：',
    '{"questions":[{"type":"choice","question":"单选题干？","options":["A. 选项一","B. 选项二","C. 选项三","D. 选项四"],"correctIndex":0,"explanation":"解析并说明约在视频第几分钟讲到","time":"mm:ss"},{"type":"short","question":"简答题干？","referenceAnswer":"简洁参考答案要点","explanation":"解析与视频定位依据","time":"mm:ss"}]}',
    '规则：',
    '1. 题目必须紧扣本课节核心知识点，不得编造字幕未提及的考点；',
    '2. 每道选择题必须恰好 4 个清晰选项且 correctIndex 为 0~3 的整数；',
    '3. 每道题必须附带对应视频时间点 time (mm:ss) 与简明解析。',
  ].join('\n');
  const user = `课程：《${courseTitle || '当前课程'}》\n课节：《${section?.title || '当前课节'}》\n\n${contextText}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function wdKtutParseChoiceIndex(raw, optionsLen) {
  if (Number.isInteger(raw) && raw >= 0 && raw < optionsLen) return raw;
  const s = String(raw ?? '').trim().toUpperCase();
  if (/^\d+$/u.test(s)) {
    const n = Number(s);
    if (n >= 0 && n < optionsLen) return n;
  }
  const letter = /^[A-D]/u.exec(s);
  if (letter) {
    const idx = letter[0].charCodeAt(0) - 65;
    if (idx >= 0 && idx < optionsLen) return idx;
  }
  return 0;
}

export function normalizeQuizPaper(data) {
  const rawList = Array.isArray(data?.questions) ? data.questions
    : Array.isArray(data?.quiz) ? data.quiz
    : Array.isArray(data?.items) ? data.items : [];
  const questions = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const qText = String(item.question || item.q || item.prompt || '').trim();
    if (!qText) continue;
    const sec = parseTimestampToSeconds(item.time ?? item.timestamp ?? item.seconds);
    const floorSec = sec === null ? null : Math.floor(sec);
    const ts = floorSec === null ? '' : formatTimestamp(floorSec);
    const rawOpts = Array.isArray(item.options) ? item.options.map(o => String(o ?? '').trim()).filter(Boolean) : [];
    const declaredType = String(item.type || '').toLowerCase();
    const isChoice = declaredType === 'choice' || declaredType === 'single' || declaredType === 'mcq' || rawOpts.length >= 2;
    const explanation = String(item.explanation || item.analysis || item.reason || '').trim();

    if (isChoice && rawOpts.length >= 2) {
      const options = rawOpts.slice(0, 4).map((opt, idx) => {
        const prefix = `${String.fromCharCode(65 + idx)}. `;
        return /^[A-D][.、:：\s]/iu.test(opt) ? opt : `${prefix}${opt}`;
      });
      const correctIndex = wdKtutParseChoiceIndex(item.correctIndex ?? item.answerIndex ?? item.answer, options.length);
      questions.push({
        id: `q-${questions.length + 1}`,
        type: 'choice',
        question: qText,
        options,
        correctIndex,
        answerLetter: String.fromCharCode(65 + correctIndex),
        explanation: explanation || `正确答案为 ${options[correctIndex]}${ts ? `（参见 ${ts}）` : ''}。`,
        seconds: floorSec,
        timestamp: ts,
      });
    } else {
      const referenceAnswer = String(item.referenceAnswer || item.answer || item.a || explanation || '').trim();
      if (!referenceAnswer) continue;
      questions.push({
        id: `q-${questions.length + 1}`,
        type: 'short',
        question: qText,
        referenceAnswer,
        explanation: explanation || (ts ? `详见视频约第 ${Math.floor(floorSec / 60) + 1} 分钟（${ts}）讲解。` : ''),
        seconds: floorSec,
        timestamp: ts,
      });
    }
    if (questions.length >= 5) break;
  }
  if (!questions.length) throw new Error('模型未返回有效题目列表');
  return questions;
}

export function gradeSectionQuiz(questions, answers = {}) {
  const list = Array.isArray(questions) ? questions : [];
  let choiceTotal = 0;
  let choiceCorrect = 0;
  let shortTotal = 0;
  const details = {};
  for (const q of list) {
    if (q.type === 'choice') {
      choiceTotal += 1;
      const chosen = answers[q.id];
      const validChosen = Number.isInteger(chosen) ? chosen : null;
      const isCorrect = validChosen !== null && validChosen === q.correctIndex;
      if (isCorrect) choiceCorrect += 1;
      details[q.id] = { type: 'choice', chosen: validChosen, correct: isCorrect, correctIndex: q.correctIndex };
    } else {
      shortTotal += 1;
      details[q.id] = { type: 'short', text: String(answers[q.id] ?? '').trim(), autoGraded: false };
    }
  }
  const percent = choiceTotal > 0 ? Math.round((choiceCorrect / choiceTotal) * 100) : null;
  return { choiceTotal, choiceCorrect, shortTotal, percent, details };
}

export async function generateSectionQuiz({ win, courseTitle, courseId, section, settings, forceRefresh = false, gmRequest, fetchFn, signal, maxContextChars = 7500, timeoutMs = 45000 }) {
  const sectionId = section?.sectionId || 'current';
  if (!sectionHasSubtitle(section)) {
    return {
      ok: false,
      noSubtitle: true,
      error: section?.subtitleReason || '本课无字幕：该课节没有 AI 字幕，因此无法基于字幕用 AI 出题。',
    };
  }
  if (!forceRefresh) {
    const cached = loadSectionQuiz(win, courseId, sectionId);
    if (cached) return { ok: true, quiz: cached, fromCache: true };
  }
  const cfg = settings || loadAiSettings(win);
  if (!cfg?.apiKey?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先点击「AI 设置」填写 Provider、Base URL 与 API Key 后再使用「用 AI 出题」。' };
  }
  try { buildChatCompletionsUrl(cfg.baseUrl); } catch (err) {
    return { ok: false, needsAiConfig: true, error: `AI 配置无效（${err.message}），请检查「AI 设置」。` };
  }
  if (!cfg.model?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先在「AI 设置」中填写模型名。' };
  }

  const ctx = selectRelevantSectionContext(section, '', { maxContextChars });
  if (ctx.totalSegments === 0 && !(section?.keyPoints?.length || section?.outline?.length)) {
    return { ok: false, error: '当前课节暂无可用字幕或知识点，无法出题。' };
  }
  const messages = buildSectionQuizPrompt({ courseTitle, section, contextText: ctx.contextText });
  try {
    const { content, channel } = await wdKtutInvokeLlm({ settings: cfg, messages, gmRequest, fetchFn, signal, timeoutMs });
    const parsed = parseStrictJsonContent(content);
    const questions = normalizeQuizPaper(parsed);
    const quizRecord = {
      cachedAt: Date.now(),
      sectionId,
      sectionTitle: section?.title || '当前课节',
      provider: cfg.provider,
      model: cfg.model,
      questions,
      attempt: { answers: {}, submitted: false, submittedAt: null },
      contextMeta: { selectedSegments: ctx.selectedSegments, totalSegments: ctx.totalSegments, truncated: ctx.truncated },
    };
    saveSectionQuiz(win, courseId, sectionId, quizRecord);
    return { ok: true, quiz: quizRecord, fromCache: false, channel };
  } catch (err) {
    return { ok: false, error: `AI 出题失败：${err?.message || err}` };
  }
}

function wdKtutNormalizeStatusLabel(raw) {
  const txt = String(raw ?? '').trim();
  if (txt === '已完成' || txt === 'completed') return 'completed';
  if (txt === '学习中' || txt === 'learning') return 'learning';
  if (txt === '未开始' || txt === 'not-started') return 'not-started';
  return 'unknown';
}

function wdKtutParseProgressNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?%?$/u.test(trimmed)) {
      const n = Number(trimmed.replace(/%$/u, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
  }
  return null;
}

export function evaluateSectionStudyStatus({ domStatus = 'unknown', modelFinishStatus = null, progress = null, active = false, isPlaying = false } = {}) {
  const domState = wdKtutNormalizeStatusLabel(domStatus);
  const modelState = wdKtutNormalizeStatusLabel(modelFinishStatus);
  const pct = wdKtutParseProgressNumber(progress);

  // 1. Verified completed
  if (domState === 'completed') return { eligible: true, state: 'completed', reason: 'DOM 状态：已完成' };
  if (domState === 'unknown' && (modelState === 'completed' || (pct !== null && pct >= 100))) {
    return { eligible: true, state: 'completed', reason: '模型/进度状态：已完成' };
  }

  // 2. Verified learning
  if (domState === 'learning') return { eligible: true, state: 'learning', reason: 'DOM 状态：学习中' };
  if (domState === 'unknown' && (modelState === 'learning' || (pct !== null && pct > 0 && pct < 100))) {
    return { eligible: true, state: 'learning', reason: '模型/进度状态：学习中' };
  }

  // 3. Explicit not-started: only allow when this exact section is actively playing right now
  if (domState === 'not-started' || modelState === 'not-started') {
    if (active && isPlaying) return { eligible: true, state: 'learning', reason: '当前选中课节正在播放中' };
    return { eligible: false, state: 'not-started', reason: '课节未开始，不显示 AI 导览标识' };
  }

  // 4. Conservative fallback when platform status is missing / conflicting / unclear
  return { eligible: false, state: 'unknown', reason: '无法可靠判定学习状态，按保守策略不显示' };
}

export function shouldShowSectionGuide({ hasSubtitle, studyStatus } = {}) {
  const subOk = hasSubtitle === true;
  const studyOk = Boolean(studyStatus && studyStatus.eligible === true);
  return subOk && studyOk;
}

export function readSectionDomStudyStatus(dl, modelSection = null, doc = null) {
  // Exact same selector and consensus rule as adapter.js (L56-L60, L565)
  const spans = [...(dl?.querySelectorAll?.('dd .item.start.pointer > span, dd .item.continue.pointer > span') || [])];
  const texts = spans.map(el => (el?.textContent || '').trim());
  let domStatus = 'unknown';
  if (texts.length > 0 && texts.every(v => v === texts[0])) {
    domStatus = wdKtutNormalizeStatusLabel(texts[0]);
  }
  const active = Boolean(dl?.classList?.contains?.('focus'));
  let isPlaying = false;
  if (active && doc?.querySelectorAll) {
    const visibleMedia = [...doc.querySelectorAll('video,audio')].filter(el => el.isConnected && !el.hidden);
    if (visibleMedia.length === 1) {
      const m = visibleMedia[0];
      isPlaying = Boolean((!m.paused && !m.ended) || (Number.isFinite(m.currentTime) && m.currentTime > 0));
    }
  }
  const modelFinishStatus = modelSection?.finishStatus ?? null;
  const progress = modelSection?.completedRate ?? modelSection?.progress ?? null;
  return evaluateSectionStudyStatus({ domStatus, modelFinishStatus, progress, active, isPlaying });
}

export function mountSectionGuideButtons({ win, pageWin = win, httpGet = null, maxConcurrency = 2, onOpenSection } = {}) {
  const doc = win?.document;
  if (!doc || typeof onOpenSection !== 'function') {
    return { refresh() { return 0; }, setSubtitleStatuses() {}, flushProbes() { return Promise.resolve(); }, destroy() {} };
  }
  let destroyed = false;
  let scheduled = false;
  let lastRouteCourseId = null;
  const pendingPromises = new Set();
  const prober = createSubtitleAvailabilityProber({ win, pageWin, httpGet, maxConcurrency });

  const ensureStyle = () => {
    if (doc.getElementById(wdKtutStyleId)) return;
    const style = doc.createElement('style');
    style.id = wdKtutStyleId;
    style.textContent = [
      '.wd-sec-guide-btn{display:inline-flex;align-items:center;gap:3px;margin-left:8px;padding:2px 8px;min-height:22px;line-height:16px;font-size:11px;font-weight:600;letter-spacing:-0.01em;font-family:-apple-system,BlinkMacSystemFont,"Inter","PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1d4ed8;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.26);border-radius:999px;cursor:pointer;vertical-align:middle;position:relative;z-index:2;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .12s ease;}',
      '.wd-sec-guide-btn:hover{background:rgba(37,99,235,.15);border-color:rgba(37,99,235,.48);color:#1e40af;}',
      '.wd-sec-guide-btn:active{transform:scale(.97);}',
      '.wd-sec-guide-btn:focus-visible{outline:2px solid #2563eb;outline-offset:2px;}',
      '@media (prefers-color-scheme:dark){.wd-sec-guide-btn{color:#93c5fd;background:rgba(59,130,246,.16);border-color:rgba(96,165,250,.36);}.wd-sec-guide-btn:hover{background:rgba(59,130,246,.28);border-color:rgba(96,165,250,.6);color:#dbeafe;}}',
    ].join('');
    (doc.head || doc.documentElement).append(style);
  };

  const extractSectionId = dl => {
    const id = String(dl?.id || '');
    const pos = id.lastIndexOf('show-sections');
    if (pos < 0) return null;
    const raw = id.slice(pos + 'show-sections'.length);
    return /^[A-Za-z0-9_-]+$/u.test(raw) ? raw : null;
  };

  const stopAll = ev => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
  };

  const removeGuideFromDl = dl => {
    const existing = dl.querySelector(':scope > dd > button[data-wd-section-guide], :scope > button[data-wd-section-guide]');
    if (existing) existing.remove();
  };

  const ensureGuideOnDl = (dl, sectionId) => {
    ensureStyle();
    let btn = dl.querySelector(':scope > dd > button[data-wd-section-guide], :scope > button[data-wd-section-guide]');
    if (btn) {
      btn.dataset.wdSectionGuide = sectionId;
      return;
    }
    btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'wd-sec-guide-btn';
    btn.dataset.wdSectionGuide = sectionId;
    btn.textContent = '💡 AI 导览';
    btn.title = '打开本课节 AI 导览（总结 / 时间轴 / 问答 / 出题）';
    btn.setAttribute('aria-label', '打开课节 AI 导览');
    btn.addEventListener('mousedown', stopAll);
    btn.addEventListener('pointerdown', stopAll);
    btn.addEventListener('click', ev => {
      stopAll(ev);
      const titleEl = dl.querySelector('.qcontent');
      const title = (titleEl?.getAttribute?.('title') || titleEl?.textContent || '').trim();
      const courseId = dl.getAttribute('data-course-id') ?? dl.getAttribute('data-courseid') ?? null;
      onOpenSection({ sectionId, title, courseId });
    });
    const host = dl.querySelector(':scope > dd') || dl;
    host.append(btn);
  };

  const refresh = () => {
    if (destroyed) return 0;
    const dls = [...doc.querySelectorAll('.chapter-list.chapter-all ul li dl[id*="show-sections"]')];
    if (!dls.length) return 0;
    const firstCourseId = dls[0].getAttribute('data-course-id') ?? dls[0].getAttribute('data-courseid') ?? null;
    if (lastRouteCourseId && firstCourseId && lastRouteCourseId !== firstCourseId) {
      prober.resetPending();
    }
    if (firstCourseId) lastRouteCourseId = firstCourseId;

    let eligibleMounted = 0;
    for (const dl of dls) {
      const sectionId = extractSectionId(dl);
      if (!sectionId) continue;
      const courseId = dl.getAttribute('data-course-id') ?? dl.getAttribute('data-courseid') ?? null;
      const resourceId = dl.getAttribute('data-resource-id') ?? dl.getAttribute('data-resourceid') ?? null;
      const active = dl.classList.contains('focus');
      const modInfo = prober.lookupSectionModuleInfo(courseId, sectionId, resourceId);
      const study = readSectionDomStudyStatus(dl, modInfo.matchedSection, doc);

      // Gate 1: Must be explicitly learning or completed; unstarted / unknown never shows & never triggers network probe!
      if (!study.eligible) {
        removeGuideFromDl(dl);
        continue;
      }

      // Gate 2: Must have usable subtitles (captionVtt or Video.js captions cues); lazy + bounded concurrency + cached!
      const cached = prober.getCached({ courseId, sectionId, resourceId, active });
      if (cached) {
        if (shouldShowSectionGuide({ hasSubtitle: cached.available, studyStatus: study })) {
          ensureGuideOnDl(dl, sectionId);
          eligibleMounted += 1;
        } else {
          removeGuideFromDl(dl);
        }
        continue;
      }

      // Do not render placeholder while probing; probe lazily in background and update asynchronously
      removeGuideFromDl(dl);
      const probePromise = prober.probeSection({ courseId, sectionId, resourceId, active }).then(res => {
        if (destroyed || !dl.isConnected) return;
        const latestModInfo = prober.lookupSectionModuleInfo(courseId, sectionId, resourceId);
        const latestStudy = readSectionDomStudyStatus(dl, latestModInfo.matchedSection, doc);
        if (shouldShowSectionGuide({ hasSubtitle: res?.available === true, studyStatus: latestStudy })) {
          ensureGuideOnDl(dl, sectionId);
        } else {
          removeGuideFromDl(dl);
        }
      });
      pendingPromises.add(probePromise);
      probePromise.finally(() => pendingPromises.delete(probePromise));
    }
    return eligibleMounted;
  };

  const setSubtitleStatuses = (statusMap, courseId = null) => {
    if (destroyed || !statusMap || typeof statusMap !== 'object') return;
    for (const [sid, info] of Object.entries(statusMap)) {
      if (!sid) continue;
      if (info && typeof info.hasSubtitle === 'boolean') {
        prober.setConfirmed(String(sid), info.hasSubtitle, courseId || lastRouteCourseId);
      }
    }
    refresh();
  };

  const scheduleRefresh = () => {
    if (destroyed || scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      refresh();
    });
  };

  const onHashChange = () => {
    prober.resetPending();
    scheduleRefresh();
  };

  const onMediaPlay = ev => {
    if (destroyed) return;
    const target = ev?.target;
    if (target && (target.tagName === 'VIDEO' || target.tagName === 'AUDIO')) {
      scheduleRefresh();
    }
  };

  const observer = typeof win.MutationObserver === 'function'
    ? new win.MutationObserver(records => {
      if (destroyed) return;
      for (const rec of records) {
        if (rec.type === 'attributes') {
          if (rec.target?.nodeType === 1 && !rec.target.closest?.('#wangda-assistant') && rec.target.matches?.('dl[id*="show-sections"]')) {
            scheduleRefresh();
            return;
          }
          continue;
        }
        for (const node of rec.addedNodes) {
          if (node.nodeType === 1 && node.id !== wdKtutStyleId && !node.matches?.('[data-wd-section-guide]') && !node.closest?.('#wangda-assistant')) {
            scheduleRefresh();
            return;
          }
          if (node.nodeType === 3 && node.parentElement?.closest?.('dl[id*="show-sections"]')) {
            scheduleRefresh();
            return;
          }
        }
      }
    })
    : null;
  if (observer && doc.body) observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  win.addEventListener?.('hashchange', onHashChange);
  doc.addEventListener?.('play', onMediaPlay, true);
  refresh();

  return {
    refresh,
    setSubtitleStatuses,
    flushProbes: async () => {
      while (pendingPromises.size > 0) {
        await Promise.allSettled([...pendingPromises]);
      }
    },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      win.removeEventListener?.('hashchange', onHashChange);
      doc.removeEventListener?.('play', onMediaPlay, true);
      prober.destroy();
      for (const btn of doc.querySelectorAll('button[data-wd-section-guide]')) btn.remove();
      doc.getElementById(wdKtutStyleId)?.remove();
    },
  };
}
