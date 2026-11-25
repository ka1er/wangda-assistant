import { cleanAndSegmentCues, formatTimestamp, parseTimestampToSeconds, buildZeroAiSectionTree, buildZeroAiGuide, buildKnowledgeMarkdown, buildScopeLabel, collectCourseSubtitles, estimateKnowledgeTokens, seekCourseTime } from './knowledge-vtt.js';

export const WD_AI_STORAGE_KEYS = {
  config: 'wangda-assistant.ai.config',
  apiKey: 'wangda-assistant.ai.apiKey',
  cache: 'wangda-assistant.ai.cache.v1',
};

export const WD_AI_PRIVACY_NOTICE = '安全说明：API Key 仅保存在当前浏览器 localStorage（wangda-assistant.ai.apiKey），仅存本地、不上传、不经过任何我们自己的服务器；仅在您主动点击分析时直连您配置的 Base URL。';

export const WD_AI_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: '实测：支持 CORS 且国内直连可用' },
  { id: 'dashscope', label: '通义千问 (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', note: '实测：支持 CORS 且国内直连可用' },
  { id: 'openai', label: 'OpenAI (官方/兼容)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', note: '实测：支持 CORS，但国内无代理超时，建议填中转 Base URL' },
  { id: 'gemini', label: 'Gemini (OpenAI兼容)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', note: '实测：支持 CORS，但国内无代理超时，建议填中转 Base URL' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', note: '实测：支持 CORS 且可直连；线路波动时可换中转' },
  { id: 'moonshot', label: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', note: '实测：支持 CORS 且国内直连可用' },
  { id: 'siliconflow', label: 'SiliconFlow (硅基流动)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', note: '实测：支持 CORS 且国内直连可用' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', note: '实测：官方端拦截页面 CORS，需走 GM_xmlhttpRequest 或自填中转 URL' },
  { id: 'ollama', label: '本地 Ollama / 兼容网关', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', note: '实测：HTTPS 页面允许回环 127.0.0.1，需开启 CORS 或走 GM 通道' },
  { id: 'custom', label: '自定义 OpenAI 兼容中转', baseUrl: '', model: '', note: '自行填写中转 Base URL 与模型名（兼容 /v1 或完整 /chat/completions）' },
];

const wdKaiDefaultConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  transport: 'auto',
};
const wdKaiMaxCacheEntries = 20;

function wdKaiLocalStorage(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

export function getAiProviderPreset(providerId) {
  return WD_AI_PROVIDERS.find(item => item.id === providerId) || WD_AI_PROVIDERS[0];
}

export function loadAiSettings(win) {
  const ls = wdKaiLocalStorage(win);
  let parsed = {};
  try {
    const raw = ls?.getItem?.(WD_AI_STORAGE_KEYS.config);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') parsed = obj;
    }
  } catch {
    parsed = {};
  }
  const provider = WD_AI_PROVIDERS.some(p => p.id === parsed.provider) ? parsed.provider : wdKaiDefaultConfig.provider;
  const preset = getAiProviderPreset(provider);
  const transport = ['auto', 'gm', 'fetch'].includes(parsed.transport) ? parsed.transport : 'auto';
  const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : preset.baseUrl;
  const model = typeof parsed.model === 'string' ? parsed.model.trim() : preset.model;
  let apiKey = '';
  try {
    apiKey = String(ls?.getItem?.(WD_AI_STORAGE_KEYS.apiKey) || '').trim();
  } catch {
    apiKey = '';
  }
  return { provider, baseUrl, model, transport, apiKey };
}

export function saveAiSettings(win, input) {
  const ls = wdKaiLocalStorage(win);
  if (!ls || typeof ls.setItem !== 'function') return { ok: false, error: '浏览器 localStorage 不可用。' };
  const current = loadAiSettings(win);
  const provider = WD_AI_PROVIDERS.some(p => p.id === input?.provider) ? input.provider : current.provider;
  const baseUrl = typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : current.baseUrl;
  const model = typeof input?.model === 'string' ? input.model.trim() : current.model;
  const transport = ['auto', 'gm', 'fetch'].includes(input?.transport) ? input.transport : current.transport;
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : current.apiKey;
  try {
    ls.setItem(WD_AI_STORAGE_KEYS.config, JSON.stringify({ provider, baseUrl, model, transport }));
    if (apiKey) ls.setItem(WD_AI_STORAGE_KEYS.apiKey, apiKey);
    else ls.removeItem(WD_AI_STORAGE_KEYS.apiKey);
    return { ok: true, settings: { provider, baseUrl, model, transport, apiKey } };
  } catch {
    return { ok: false, error: '写入 localStorage 失败，请检查浏览器存储权限。' };
  }
}

export function clearAiApiKey(win) {
  const ls = wdKaiLocalStorage(win);
  try {
    ls?.removeItem?.(WD_AI_STORAGE_KEYS.apiKey);
    return { ok: true };
  } catch {
    return { ok: false, error: '清空本地 Key 失败。' };
  }
}

export function buildKnowledgeCacheKey(courseId, scope = 'course', sectionId = null) {
  const cid = String(courseId || 'unknown').trim() || 'unknown';
  if (scope === 'section') {
    const sid = String(sectionId || 'current').trim() || 'current';
    return `${cid}::section::${sid}`;
  }
  return `${cid}::course`;
}

function wdKaiReadCacheMap(win) {
  const ls = wdKaiLocalStorage(win);
  try {
    const raw = ls?.getItem?.(WD_AI_STORAGE_KEYS.cache);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function wdKaiWriteCacheMap(win, map) {
  const ls = wdKaiLocalStorage(win);
  if (!ls || typeof ls.setItem !== 'function') return false;
  const entries = Object.entries(map)
    .filter(([, v]) => v && typeof v === 'object' && v.tree)
    .sort((a, b) => (Number(b[1].cachedAt) || 0) - (Number(a[1].cachedAt) || 0));
  for (let limit = Math.min(entries.length, wdKaiMaxCacheEntries); limit >= 1; limit -= 1) {
    try {
      const pruned = Object.fromEntries(entries.slice(0, limit));
      ls.setItem(WD_AI_STORAGE_KEYS.cache, JSON.stringify(pruned));
      return true;
    } catch { /* quota exceeded -> evict oldest and retry */ }
  }
  return false;
}

export function loadKnowledgeCache(win, key) {
  if (!key) return null;
  const map = wdKaiReadCacheMap(win);
  const entry = map[key];
  if (!entry || typeof entry !== 'object' || !entry.tree || typeof entry.markdown !== 'string') return null;
  return entry;
}

export function saveKnowledgeCache(win, key, entry) {
  if (!key || !entry?.tree) return false;
  const map = wdKaiReadCacheMap(win);
  map[key] = {
    cachedAt: Date.now(),
    provider: entry.provider || '',
    model: entry.model || '',
    scope: entry.scope || 'course',
    tree: entry.tree,
    markdown: entry.markdown || buildKnowledgeMarkdown(entry.tree),
    usedAi: Boolean(entry.usedAi),
    fallback: Boolean(entry.fallback),
    failedSections: Array.isArray(entry.failedSections) ? entry.failedSections : [],
    channel: entry.channel || null,
  };
  return wdKaiWriteCacheMap(win, map);
}

export function clearKnowledgeCache(win, key = null) {
  const ls = wdKaiLocalStorage(win);
  if (!ls) return false;
  try {
    if (!key) { ls.removeItem(WD_AI_STORAGE_KEYS.cache); return true; }
    const map = wdKaiReadCacheMap(win);
    delete map[key];
    ls.setItem(WD_AI_STORAGE_KEYS.cache, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function buildChatCompletionsUrl(baseUrl) {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) throw new Error('未填写 Base URL');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Base URL 格式非法，请以 https:// 开头');
  }
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('Base URL 仅支持 https://（或本机 http://127.0.0.1 / localhost）');
  }
  const cleanPath = url.pathname.replace(/\/+$/u, '');
  url.pathname = /\/chat\/completions$/iu.test(cleanPath) ? cleanPath : `${cleanPath}/chat/completions`;
  return url.toString();
}

function wdKaiMapHttpError(status, bodyText) {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.message || '';
  } catch {
    detail = '';
  }
  if (status === 401 || status === 403) return `API Key 无效或无权限（HTTP ${status}${detail ? `：${detail.slice(0, 80)}` : ''}）`;
  if (status === 402) return `账户余额不足或额度已耗尽（HTTP 402${detail ? `：${detail.slice(0, 80)}` : ''}）`;
  if (status === 429) return `请求受限或额度耗尽（HTTP 429${detail ? `：${detail.slice(0, 80)}` : ''}）`;
  if (status === 404) return `接口地址或模型不存在（HTTP 404），请检查 Base URL 与模型名`;
  if (status >= 500) return `服务商暂时异常（HTTP ${status}）`;
  return `接口返回错误（HTTP ${status}${detail ? `：${detail.slice(0, 80)}` : ''}）`;
}

function wdKaiGmRequest(gmRequest, { url, method = 'GET', headers = {}, body = null, timeoutMs = 45000, signal, anonymous = true }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('用户已取消请求')); return; }
    let settled = false;
    let handle = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      try { handle?.abort?.(); } catch { /* ignore */ }
      finish(reject, new Error('用户已取消请求'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      handle = gmRequest({
        method,
        url,
        headers,
        data: body ?? undefined,
        timeout: timeoutMs,
        anonymous,
        onload: res => finish(resolve, { status: Number(res?.status || 0), text: String(res?.responseText ?? ''), channel: 'gm' }),
        onerror: err => finish(reject, new Error(`GM_xmlhttpRequest 网络错误${err?.error ? `（${err.error}）` : ''}`)),
        ontimeout: () => finish(reject, new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`)),
        onabort: () => finish(reject, new Error('请求已中止')),
      });
    } catch (err) {
      finish(reject, new Error(`GM_xmlhttpRequest 调用失败：${err?.message || err}`));
    }
  });
}

async function wdKaiFetchRequest(fetchFn, { url, method = 'GET', headers = {}, body = null, timeoutMs = 45000, signal, credentials = 'omit' }) {
  if (typeof fetchFn !== 'function') throw new Error('当前环境不支持页面 fetch');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  const onParentAbort = () => controller?.abort();
  signal?.addEventListener?.('abort', onParentAbort, { once: true });
  const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      method,
      headers,
      body: body ?? undefined,
      credentials,
      signal: controller?.signal || signal,
    });
    const text = await res.text();
    return { status: res.status, text, channel: 'fetch' };
  } catch (err) {
    if (timedOut) throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`);
    if (signal?.aborted) throw new Error('用户已取消请求');
    throw new Error(`页面 fetch 失败（可能是 CORS 拦截或网络不可达）：${err?.message || err}`);
  } finally {
    if (timer !== null) clearTimeout(timer);
    signal?.removeEventListener?.('abort', onParentAbort);
  }
}

export async function sendAiHttpRequest(options) {
  const { transport = 'auto', gmRequest, fetchFn, url, method = 'POST', headers = {}, body = null, timeoutMs = 45000, signal } = options;
  const hasGm = typeof gmRequest === 'function';
  const hasFetch = typeof fetchFn === 'function';
  if (transport === 'gm') {
    if (!hasGm) throw new Error('当前环境未提供 GM_xmlhttpRequest，请在设置中切换为「自动」或「页面 fetch」');
    return wdKaiGmRequest(gmRequest, { url, method, headers, body, timeoutMs, signal, anonymous: true });
  }
  if (transport === 'fetch') {
    return wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
  }
  if (hasGm) {
    try {
      return await wdKaiGmRequest(gmRequest, { url, method, headers, body, timeoutMs, signal, anonymous: true });
    } catch (gmErr) {
      if (signal?.aborted || !hasFetch) throw gmErr;
      try {
        return await wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
      } catch {
        throw gmErr;
      }
    }
  }
  return wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
}

export function buildSectionPrompt(courseTitle, section, segments, chunkInfo = null) {
  const isChunk = Boolean(chunkInfo && chunkInfo.total > 1);
  const chunkHint = isChunk ? `（第 ${chunkInfo.index}/${chunkInfo.total} 分段）` : '';
  const transcript = segments.map(seg => `[${seg.timestamp}] ${seg.text}`).join('\n');
  const system = [
    '你是资深企业课程学习教练。请根据带时间戳的课程字幕，产出一份让学员「花 2 分钟就能看懂并自检是否学会」的结构化学习卡片。',
    '只输出合法 JSON，不要任何前言、解释或额外文字。',
    'JSON Schema：',
    '{"summary":"一句话讲清本节核心结论与收获(<=50字)","keyPoints":[{"text":"白话结论要点(<=25字，不要复述标题)","time":"mm:ss"}],"outline":[{"name":"二级主题(<=16字，收敛为2~5组)","points":[{"text":"三级知识点短语(<=20字)","time":"mm:ss"}]}],"quiz":[{"question":"基于核心要点的自测问题？","answer":"1~2句简洁参考答案","time":"mm:ss"}],"glossary":[{"term":"专有名词/缩写","definition":"一句话通俗解释(<=35字)","time":"mm:ss"}]}',
    '约束：',
    isChunk
      ? '1. 当前为长课节的子分段：summary 写本段一句话核心结论；keyPoints 给 2~3 条；outline 给 1~3 组主题；quiz 给 1~2 题；glossary 抽取本段专有名词（无则空数组）；'
      : '1. keyPoints 严格 3~6 条白话结论（每条 <=25 字，讲清结论不要目录式复述标题）；outline 收敛为 2~5 个二级主题，每组 2~6 条知识点；quiz 给 3~5 个检验是否学会的问题；glossary 抽取 0~6 个关键专有名词；',
    '2. 所有 time 必须取自输入字幕首次出现的时间戳（mm:ss 或 hh:mm:ss）；',
    '3. 严格忠于字幕原文，禁止编造原文未提及的概念或结论；禁止出现「其他/杂项」。',
  ].join('\n');
  const user = `课程：《${courseTitle || '当前课程'}》\n课节：第 ${section.sectionIndex || 1} 节《${section.title || '当前课节'}》${chunkHint}\n\n字幕分段：\n${transcript}`;
  return { system, user };
}

export function buildSectionChunkAggregationPrompt(courseTitle, section, chunkPayloads) {
  const digest = chunkPayloads.map((c, idx) => {
    const pts = (c.keyPoints || []).map(p => `${p.text}(${p.timestamp || ''})`).join('；');
    const topics = (c.outline || []).map(t => `${t.name}: ${(t.points || []).map(p => `${p.text}(${p.timestamp || ''})`).join('、')}`).join(' | ');
    return `分段${idx + 1} 摘要：${c.summary || ''}\n  要点：${pts}\n  主题：${topics}`;
  }).join('\n');
  const system = [
    '你是课程学习卡片聚合助手。下面是一节较长课程各个分段的初步提炼结果，请去重收敛为一份完整、易速览的单节学习 JSON（不要任何额外说明）。',
    'JSON Schema：{"summary":"整节一句话核心结论(<=50字)","keyPoints":[{"text":"核心结论要点(<=25字)","time":"mm:ss"}],"outline":[{"name":"二级主题(<=16字，收敛为3~5组)","points":[{"text":"三级知识点(<=20字)","time":"mm:ss"}]}],"quiz":[{"question":"自测问题？","answer":"简洁参考答案","time":"mm:ss"}],"glossary":[{"term":"术语","definition":"一句话解释(<=35字)","time":"mm:ss"}]}',
    '要求：keyPoints 收敛为 3~6 条；quiz 收敛为 3~5 题；保留原 mm:ss 时间戳。',
  ].join('\n');
  return { system, user: `课程：《${courseTitle}》\n课节：《${section.title}》\n\n各分段结果：\n${digest}` };
}

export function buildCourseAggregationPrompt(courseTitle, sectionTrees) {
  const digest = sectionTrees.map(sec => {
    const kps = (sec.keyPoints || []).slice(0, 4).map(p => `${p.text}(${p.timestamp || ''})`).join('；');
    const lines = (sec.outline || sec.topics || []).map(t => `  - ${t.name}: ${(t.points || []).map(p => `${p.text}(${p.timestamp || ''})`).join('；')}`);
    return `课节ID=${sec.sectionId} 《${sec.title}》\n  一句话概览：${sec.summary || ''}\n  核心要点：${kps}\n${lines.join('\n')}`;
  }).join('\n');
  const system = [
    '你是课程知识体系聚合助手。下面是一门课各课节的提炼结果，请输出整门课级总览与去重后的知识地图 JSON（只输出 JSON）。',
    'JSON 格式：{"overview":"一句话全课核心概要(<=60字)","keyPoints":[{"text":"全课核心结论(<=25字)","sectionId":"原sectionId","time":"mm:ss"}],"sections":[{"sectionId":"原sectionId","summary":"该节一句话概览","outline":[{"name":"二级主题","points":[{"text":"知识点短语(<=20字)","time":"mm:ss"}]}]}]}',
    '要求：全课 keyPoints 选 3~6 条最核心结论并保留原 sectionId 与 mm:ss 时间戳。',
  ].join('\n');
  return { system, user: `课程：《${courseTitle}》\n\n各课节摘要与要点：\n${digest}` };
}

export function parseStrictJsonContent(rawContent) {
  const text = String(rawContent ?? '').replace(/^\uFEFF/u, '').trim();
  if (!text) throw new Error('模型返回内容为空');
  const candidates = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/iu.exec(text);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(text);
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
  }
  for (const raw of candidates) {
    for (const attempt of [
      raw,
      raw.replace(/,\s*([}\]])/gu, '$1'),
      raw.replace(/\/\/[^\n]*/gu, '').replace(/,\s*([}\]])/gu, '$1'),
    ]) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch { /* try next relaxed variant */ }
    }
  }
  throw new Error('模型返回的不是合法 JSON');
}

function wdKaiNormalizePoint(pt) {
  if (typeof pt === 'string') {
    const text = pt.trim();
    return text ? { text, seconds: null, timestamp: '' } : null;
  }
  if (!pt || typeof pt !== 'object') return null;
  const text = String(pt.text || pt.point || pt.content || pt.title || pt.summary || '').trim();
  if (!text) return null;
  const sec = parseTimestampToSeconds(pt.time ?? pt.timestamp ?? pt.seconds);
  const sectionId = pt.sectionId ? String(pt.sectionId) : undefined;
  return {
    text,
    seconds: sec === null ? null : Math.floor(sec),
    timestamp: sec === null ? '' : formatTimestamp(sec),
    ...(sectionId ? { sectionId } : {}),
  };
}

function wdKaiNormalizeOutline(rawTopics) {
  if (!Array.isArray(rawTopics)) return [];
  const topics = [];
  for (const item of rawTopics) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || item.title || item.topic || item.chapter || '').trim();
    const rawPoints = Array.isArray(item.points) ? item.points
      : Array.isArray(item.items) ? item.items
      : Array.isArray(item.children) ? item.children : [];
    const points = rawPoints.map(wdKaiNormalizePoint).filter(Boolean);
    if (name && points.length) topics.push({ name, points });
    else if (name) topics.push({ name, points: [{ text: name, seconds: null, timestamp: '' }] });
  }
  return topics;
}

function wdKaiNormalizeQuiz(rawQuiz) {
  if (!Array.isArray(rawQuiz)) return [];
  const items = [];
  for (const q of rawQuiz) {
    if (!q || typeof q !== 'object') continue;
    const question = String(q.question || q.q || q.prompt || '').trim();
    const answer = String(q.answer || q.a || q.explanation || '').trim();
    if (!question || !answer) continue;
    const sec = parseTimestampToSeconds(q.time ?? q.timestamp ?? q.seconds);
    items.push({
      question,
      answer,
      seconds: sec === null ? null : Math.floor(sec),
      timestamp: sec === null ? '' : formatTimestamp(sec),
    });
  }
  return items.slice(0, 6);
}

function wdKaiNormalizeGlossary(rawGlossary) {
  if (!Array.isArray(rawGlossary)) return [];
  const seen = new Set();
  const items = [];
  for (const g of rawGlossary) {
    if (!g || typeof g !== 'object') continue;
    const term = String(g.term || g.name || g.word || g.concept || '').trim();
    const definition = String(g.definition || g.desc || g.explain || g.meaning || '').trim();
    if (!term || !definition || seen.has(term)) continue;
    seen.add(term);
    const sec = parseTimestampToSeconds(g.time ?? g.timestamp ?? g.seconds);
    items.push({
      term,
      definition,
      seconds: sec === null ? null : Math.floor(sec),
      timestamp: sec === null ? '' : formatTimestamp(sec),
    });
  }
  return items.slice(0, 8);
}

export function normalizeSectionStudyPayload(data) {
  if (!data || typeof data !== 'object') throw new Error('模型返回结构无效');
  const outline = wdKaiNormalizeOutline(data.outline ?? data.topics ?? data.chapters);
  const rawKeyPoints = Array.isArray(data.keyPoints) ? data.keyPoints
    : Array.isArray(data.key_points) ? data.key_points
    : Array.isArray(data.highlights) ? data.highlights
    : Array.isArray(data.takeaways) ? data.takeaways : [];
  let keyPoints = rawKeyPoints.map(wdKaiNormalizePoint).filter(Boolean).slice(0, 6);
  const quiz = wdKaiNormalizeQuiz(data.quiz ?? data.questions ?? data.qa ?? data.selfCheck);
  const glossary = wdKaiNormalizeGlossary(data.glossary ?? data.terms ?? data.concepts);
  let summary = String(data.summary || data.oneLineSummary || data.overview || '').trim();

  if (!outline.length && !keyPoints.length && !summary) {
    throw new Error('模型未返回有效的摘要、要点或大纲内容');
  }
  if (!keyPoints.length && outline.length) {
    for (const topic of outline) {
      const first = topic.points[0];
      if (first) keyPoints.push({ text: first.text.slice(0, 25), seconds: first.seconds, timestamp: first.timestamp });
      if (keyPoints.length >= 5) break;
    }
  }
  if (!outline.length && keyPoints.length) {
    outline.push({ name: '核心知识点', points: keyPoints.map(k => ({ ...k })) });
  }
  if (!summary) {
    summary = keyPoints.slice(0, 2).map(k => k.text).join('；') || outline.slice(0, 2).map(t => t.name).join('、');
  }
  return { summary, keyPoints, outline, quiz, glossary };
}

export function splitSegmentsIntoChunks(segments, maxChars = 12000) {
  const list = Array.isArray(segments) ? segments : [];
  if (!list.length) return [];
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const seg of list) {
    const len = (seg.text || '').length + 12;
    if (current.length && chars + len > maxChars) {
      chunks.push(current);
      current = [seg];
      chars = len;
    } else {
      current.push(seg);
      chars += len;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function wdKaiCallChatJson({ settings, messages, gmRequest, fetchFn, signal, timeoutMs = 45000 }) {
  const endpoint = buildChatCompletionsUrl(settings.baseUrl);
  if (!settings.model) throw new Error('未填写模型名');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };
  const payload = JSON.stringify({
    model: settings.model,
    temperature: 0.2,
    messages,
  });
  const res = await sendAiHttpRequest({
    transport: settings.transport,
    gmRequest,
    fetchFn,
    url: endpoint,
    method: 'POST',
    headers,
    body: payload,
    timeoutMs,
    signal,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(wdKaiMapHttpError(res.status, res.text));
  }
  let envelope;
  try {
    envelope = JSON.parse(res.text);
  } catch {
    throw new Error('接口响应体不是合法 JSON（请检查 Base URL 是否指向兼容 /chat/completions 端点）');
  }
  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('接口响应缺少 choices[0].message.content');
  }
  return { data: parseStrictJsonContent(content), channel: res.channel };
}

function wdKaiMergeChunkFallback(chunkPayloads) {
  const chunkSummaries = chunkPayloads.map((c, idx) => ({
    chunkIndex: idx + 1,
    summary: c.summary || c.keyPoints?.[0]?.text || c.outline?.[0]?.name || '',
    seconds: c.keyPoints?.[0]?.seconds ?? c.outline?.[0]?.points?.[0]?.seconds ?? null,
    timestamp: c.keyPoints?.[0]?.timestamp || c.outline?.[0]?.points?.[0]?.timestamp || '',
  })).filter(x => x.summary);
  const summary = chunkSummaries.map(c => c.summary).slice(0, 2).join('；');
  const keyPoints = [];
  const outline = [];
  const quiz = [];
  const glossary = [];
  const seenTerms = new Set();
  for (const c of chunkPayloads) {
    for (const kp of (c.keyPoints || [])) {
      if (keyPoints.length < 6 && !keyPoints.some(x => x.text === kp.text)) keyPoints.push(kp);
    }
    outline.push(...(c.outline || []));
    for (const q of (c.quiz || [])) {
      if (quiz.length < 5) quiz.push(q);
    }
    for (const g of (c.glossary || [])) {
      if (glossary.length < 8 && !seenTerms.has(g.term)) { seenTerms.add(g.term); glossary.push(g); }
    }
  }
  return { summary, keyPoints, outline, quiz, glossary, chunkSummaries };
}

export async function summarizeCourseWithAi(courseData, settings, options = {}) {
  const scope = options.scope === 'section' ? 'section' : 'course';
  const targetSectionId = options.sectionId || null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const signal = options.signal;
  const maxSectionChars = Number.isFinite(options.maxSectionChars) ? options.maxSectionChars : 12000;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 45000;

  const allSections = Array.isArray(courseData?.sections) ? courseData.sections : [];
  const selected = scope === 'section'
    ? (targetSectionId
      ? allSections.filter(sec => sec.sectionId === targetSectionId).slice(0, 1)
      : allSections.filter(sec => sec.active || (courseData?.activeSectionId && sec.sectionId === courseData.activeSectionId)).slice(0, 1))
    : allSections;
  const targetSections = selected.length ? selected : allSections.slice(0, 1);

  // Short-circuit cleanly when target section(s) have NO AI subtitles at all (0 LLM calls, never crash/hang)
  const targetCaptioned = targetSections.filter(sec => {
    if (sec?.hasSubtitle === false) return false;
    const segs = Array.isArray(sec?.segments) && sec.segments.length ? sec.segments : cleanAndSegmentCues(sec?.cues || []).segments;
    return segs.length > 0;
  });
  if (targetCaptioned.length === 0) {
    const noSubReason = scope === 'section'
      ? (targetSections[0]?.subtitleReason || '本课无字幕：该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。')
      : '本课无字幕：整门课所有课节均未检测到可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。';
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: noSubReason });
    return {
      ...zero,
      usedAi: false,
      fallback: false,
      noSubtitle: true,
      skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
      failedSections: [],
      channel: null,
    };
  }

  if (!settings?.apiKey?.trim()) {
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: '未配置 API Key，已使用零 AI 默认导览。' });
    return {
      ...zero,
      usedAi: false,
      fallback: false,
      noSubtitle: false,
      skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
      failedSections: [],
      channel: null,
    };
  }
  try {
    buildChatCompletionsUrl(settings.baseUrl);
  } catch (err) {
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: `AI 配置无效（${err.message}），已回退到零 AI 导览。` });
    return {
      ...zero,
      usedAi: false,
      fallback: true,
      noSubtitle: false,
      skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
      failedSections: [],
      channel: null,
    };
  }
  if (!settings.model?.trim()) {
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: '未填写模型名，已回退到零 AI 导览。' });
    return {
      ...zero,
      usedAi: false,
      fallback: true,
      noSubtitle: false,
      skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
      failedSections: [],
      channel: null,
    };
  }

  const highlights = Array.isArray(courseData?.highlights) ? courseData.highlights : [];

  const resultSections = [];
  const failedSections = [];
  const skippedNoSubtitleSections = [];
  const warnings = Array.isArray(courseData?.warnings) ? [...courseData.warnings] : [];
  let aiSuccessCount = 0;
  let lastChannel = null;
  let firstError = '';

  for (let i = 0; i < targetSections.length; i += 1) {
    if (signal?.aborted) {
      return {
        ...buildZeroAiGuide(courseData, { scope, fallbackReason: '已取消 AI 分析，当前展示零 AI 导览。' }),
        usedAi: false,
        fallback: true,
        aborted: true,
        noSubtitle: false,
        skippedNoSubtitleSections,
        failedSections,
        channel: lastChannel,
      };
    }
    const sec = targetSections[i];
    const segments = Array.isArray(sec.segments) && sec.segments.length
      ? sec.segments
      : cleanAndSegmentCues(sec.cues || []).segments;
    const zeroSec = buildZeroAiSectionTree(sec, highlights);

    if (sec.hasSubtitle === false || !segments.length) {
      skippedNoSubtitleSections.push({
        sectionId: sec.sectionId || null,
        title: sec.title || `课节 ${i + 1}`,
        status: sec.subtitleStatus || 'no-subtitle',
        reason: sec.subtitleReason || '本课无字幕',
      });
      resultSections.push(zeroSec);
      continue;
    }

    onProgress({ done: i, total: targetSections.length, stage: 'section', title: sec.title });
    const chunks = splitSegmentsIntoChunks(segments, maxSectionChars);
    const chunkPayloads = [];
    let sectionError = '';
    for (let c = 0; c < chunks.length; c += 1) {
      const prompt = buildSectionPrompt(courseData.title, sec, chunks[c], { index: c + 1, total: chunks.length });
      try {
        const { data, channel } = await wdKaiCallChatJson({
          settings,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          gmRequest: options.gmRequest,
          fetchFn: options.fetchFn,
          signal,
          timeoutMs,
        });
        lastChannel = channel;
        chunkPayloads.push(normalizeSectionStudyPayload(data));
      } catch (err) {
        sectionError = err?.message || String(err);
        if (!firstError) firstError = sectionError;
        break;
      }
    }

    if (chunkPayloads.length > 0 && (!sectionError || chunkPayloads.length >= 1)) {
      let finalPayload = chunkPayloads[0];
      let chunkSummaries = [];
      if (chunks.length > 1) {
        const mergedFallback = wdKaiMergeChunkFallback(chunkPayloads);
        chunkSummaries = mergedFallback.chunkSummaries;
        if (!sectionError && chunkPayloads.length > 1 && !signal?.aborted) {
          try {
            onProgress({ done: i, total: targetSections.length, stage: 'section-aggregate', title: `正在收敛课节《${sec.title}》分段要点…` });
            const aggPrompt = buildSectionChunkAggregationPrompt(courseData.title, sec, chunkPayloads);
            const { data } = await wdKaiCallChatJson({
              settings,
              messages: [
                { role: 'system', content: aggPrompt.system },
                { role: 'user', content: aggPrompt.user },
              ],
              gmRequest: options.gmRequest,
              fetchFn: options.fetchFn,
              signal,
              timeoutMs,
            });
            finalPayload = normalizeSectionStudyPayload(data);
          } catch (aggErr) {
            warnings.push(`长课节「${sec.title}」二次聚合失败（${aggErr?.message || aggErr}），已保留每段一句话摘要与分段要点`);
            finalPayload = mergedFallback;
          }
        } else {
          if (sectionError) warnings.push(`长课节「${sec.title}」部分分段失败（${sectionError}），已保留已完成分段的每段一句话摘要`);
          finalPayload = mergedFallback;
        }
      }
      aiSuccessCount += 1;
      resultSections.push({
        sectionId: sec.sectionId || null,
        sectionIndex: sec.sectionIndex || (i + 1),
        chapterTitle: sec.chapterTitle || '',
        title: sec.title || `课节 ${i + 1}`,
        mode: 'ai',
        source: sec.source || 'vtt-url',
        hasSubtitle: true,
        subtitleStatus: 'ok',
        subtitleReason: '',
        subtitleLogs: Array.isArray(sec.subtitleLogs) ? sec.subtitleLogs : [],
        summary: finalPayload.summary,
        keyPoints: finalPayload.keyPoints,
        outline: finalPayload.outline,
        topics: finalPayload.outline,
        quiz: finalPayload.quiz,
        glossary: finalPayload.glossary,
        timeline: zeroSec.timeline,
        ...(chunkSummaries.length ? { chunkSummaries } : {}),
      });
    } else {
      failedSections.push({ sectionId: sec.sectionId, title: sec.title, reason: sectionError || 'AI 解析失败' });
      warnings.push(`课节「${sec.title}」AI 分析失败（${sectionError}），已回退零 AI 速览`);
      resultSections.push(zeroSec);
    }
  }

  const skippedSummary = skippedNoSubtitleSections.length
    ? `批量处理已跳过 ${skippedNoSubtitleSections.length} 个无字幕课节：${skippedNoSubtitleSections.map(s => `《${s.title}》`).join('、')}。`
    : '';
  if (skippedSummary && !warnings.includes(skippedSummary)) warnings.push(skippedSummary);

  // If NO section succeeded with AI at all, cleanly return full zero-AI fallback with reason
  if (aiSuccessCount === 0) {
    const reason = firstError
      ? `AI 分析失败（${firstError}），已自动回退到零 AI 导览。`
      : '本课无字幕：当前范围暂无可用 AI 字幕正文，无法生成时间轴导览、问答与出题。';
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: reason });
    if (targetSections.length > 1) zero.tree.warnings = [...new Set([...zero.tree.warnings, ...warnings])];
    return {
      ...zero,
      usedAi: false,
      fallback: Boolean(firstError),
      noSubtitle: !firstError,
      skippedNoSubtitleSections,
      failedSections,
      channel: lastChannel,
    };
  }

  // Course-level aggregation when multiple sections succeeded with AI
  const captionedResultSections = resultSections.filter(s => s.hasSubtitle !== false);
  let overview = resultSections.length === 1
    ? (resultSections[0].summary || '')
    : captionedResultSections.filter(s => s.summary).map(s => `《${s.title}》${s.summary}`).slice(0, 2).join('；');
  let courseKeyPoints = [];
  for (const sec of captionedResultSections) {
    if (sec.keyPoints?.[0]) {
      courseKeyPoints.push({ ...sec.keyPoints[0], sectionId: sec.sectionId || 'current', sectionTitle: sec.title });
    }
    if (courseKeyPoints.length >= 6) break;
  }

  if (scope === 'course' && aiSuccessCount > 1 && !signal?.aborted) {
    onProgress({ done: targetSections.length, total: targetSections.length, stage: 'aggregate', title: '正在聚合整门课知识地图与总览…' });
    try {
      const aiOnly = resultSections.filter(s => s.mode === 'ai');
      const aggPrompt = buildCourseAggregationPrompt(courseData.title, aiOnly);
      const { data } = await wdKaiCallChatJson({
        settings,
        messages: [
          { role: 'system', content: aggPrompt.system },
          { role: 'user', content: aggPrompt.user },
        ],
        gmRequest: options.gmRequest,
        fetchFn: options.fetchFn,
        signal,
        timeoutMs,
      });
      if (typeof data.overview === 'string' && data.overview.trim()) overview = data.overview.trim();
      const rawCourseKps = Array.isArray(data.keyPoints) ? data.keyPoints.map(wdKaiNormalizePoint).filter(Boolean).slice(0, 6) : [];
      if (rawCourseKps.length) courseKeyPoints = rawCourseKps;
      if (Array.isArray(data.sections)) {
        const byId = new Map(data.sections.map(s => [String(s?.sectionId || ''), s]));
        for (const sec of resultSections) {
          if (sec.mode !== 'ai') continue;
          const updated = byId.get(String(sec.sectionId || ''));
          if (typeof updated?.summary === 'string' && updated.summary.trim()) sec.summary = updated.summary.trim();
          const nextOutline = wdKaiNormalizeOutline(updated?.outline ?? updated?.topics);
          if (nextOutline.length) {
            sec.outline = nextOutline;
            sec.topics = nextOutline;
          }
        }
      }
    } catch (err) {
      warnings.push(`整门课聚合总览未完成（${err?.message || err}），已保留各课节一句话摘要与完整要点`);
    }
  }

  const tree = {
    mode: failedSections.length ? 'ai-partial' : 'ai',
    scope,
    scopeLabel: buildScopeLabel(scope, resultSections),
    courseId: courseData?.courseId || null,
    activeSectionId: courseData?.activeSectionId || resultSections[0]?.sectionId || null,
    courseTitle: courseData?.title || '当前课程',
    overview,
    courseKeyPoints,
    hasAnySubtitle: true,
    noSubtitle: false,
    skippedNoSubtitleSections,
    skippedSummary,
    subtitleDiagnostics: Array.isArray(courseData?.subtitleDiagnostics) ? courseData.subtitleDiagnostics : [],
    generatedAt: new Date().toISOString(),
    fallbackReason: failedSections.length ? `部分课节（${failedSections.length} 节）AI 失败，已局部回退零 AI 速览。` : '',
    warnings,
    sections: resultSections,
  };
  const markdown = buildKnowledgeMarkdown(tree);
  onProgress({ done: targetSections.length, total: targetSections.length, stage: 'done', title: '完成' });
  return {
    tree,
    markdown,
    usedAi: true,
    fallback: failedSections.length > 0,
    noSubtitle: false,
    skippedNoSubtitleSections,
    failedSections,
    channel: lastChannel,
  };
}

export function createKnowledgeService({ win, pageWin = win, controller, adapter, gmRequest, fetchFn } = {}) {
  const resolveFetch = () => {
    if (typeof fetchFn === 'function') return fetchFn;
    if (typeof pageWin?.fetch === 'function') return pageWin.fetch.bind(pageWin);
    if (typeof win?.fetch === 'function') return win.fetch.bind(win);
    return null;
  };
  const wdKaiHttpStatusError = status => {
    const err = new Error(`HTTP ${status}`);
    err.status = status;
    return err;
  };
  const httpGetVtt = async (url, { signal, sameOrigin = true } = {}) => {
    const nativeFetch = resolveFetch();
    if (sameOrigin && nativeFetch) {
      const res = await wdKaiFetchRequest(nativeFetch, { url, method: 'GET', timeoutMs: 15000, signal, credentials: 'same-origin' });
      if (res.status >= 200 && res.status < 300) return { status: res.status, text: res.text };
      if (typeof gmRequest !== 'function') throw wdKaiHttpStatusError(res.status);
    }
    if (typeof gmRequest === 'function') {
      const res = await wdKaiGmRequest(gmRequest, { url, method: 'GET', timeoutMs: 15000, signal, anonymous: false });
      if (res.status >= 200 && res.status < 300) return { status: res.status, text: res.text };
      throw wdKaiHttpStatusError(res.status);
    }
    if (nativeFetch) {
      const res = await wdKaiFetchRequest(nativeFetch, { url, method: 'GET', timeoutMs: 15000, signal, credentials: 'omit' });
      if (res.status >= 200 && res.status < 300) return { status: res.status, text: res.text };
      throw wdKaiHttpStatusError(res.status);
    }
    throw new Error('无可用请求通道');
  };

  let activeAbort = null;
  let lastCourseData = null;

  const findCachedForData = (data, preferredScope = null, sectionId = null) => {
    if (!data?.courseId) return null;
    const focusSecId = sectionId || data.activeSectionId;
    const keys = preferredScope === 'section'
      ? [buildKnowledgeCacheKey(data.courseId, 'section', focusSecId)]
      : preferredScope === 'course'
        ? [buildKnowledgeCacheKey(data.courseId, 'course')]
        : sectionId
          ? [buildKnowledgeCacheKey(data.courseId, 'section', sectionId), buildKnowledgeCacheKey(data.courseId, 'course')]
          : [
            buildKnowledgeCacheKey(data.courseId, 'course'),
            buildKnowledgeCacheKey(data.courseId, 'section', focusSecId),
          ];
    for (const key of keys) {
      const hit = loadKnowledgeCache(win, key);
      if (hit?.usedAi) return { key, hit };
    }
    return null;
  };

  return {
    providers: WD_AI_PROVIDERS,
    privacyNotice: WD_AI_PRIVACY_NOTICE,
    storageKeys: WD_AI_STORAGE_KEYS,
    hasGmTransport: () => typeof gmRequest === 'function',
    getPageWin: () => pageWin,
    httpGetSubtitle: httpGetVtt,
    getTransportDeps: () => ({ gmRequest, fetchFn: resolveFetch() }),
    getLastDiagnostics: () => lastCourseData ? {
      courseId: lastCourseData.courseId,
      courseTitle: lastCourseData.title,
      totalSections: lastCourseData.sections?.length || 0,
      captionedSections: lastCourseData.captionedSections || 0,
      hasAnySubtitle: Boolean(lastCourseData.hasAnySubtitle),
      skippedNoSubtitleSections: lastCourseData.skippedNoSubtitleSections || [],
      fallbackOrder: lastCourseData.fallbackOrder || [],
      logs: lastCourseData.subtitleDiagnostics || [],
    } : null,
    getSettings: () => loadAiSettings(win),
    saveSettings: next => saveAiSettings(win, next),
    clearApiKey: () => clearAiApiKey(win),
    clearCache: key => clearKnowledgeCache(win, key),
    abort() {
      try { activeAbort?.abort?.(); } catch { /* ignore */ }
      activeAbort = null;
    },
    async collect(scope = 'course', sectionId = null) {
      const data = await collectCourseSubtitles({ win, pageWin, scope, sectionId, httpGet: httpGetVtt });
      lastCourseData = data;
      return {
        courseData: data,
        estimates: {
          section: estimateKnowledgeTokens(data, 'section'),
          course: estimateKnowledgeTokens(data, 'course'),
        },
        zeroAi: buildZeroAiGuide(data, { scope, sectionId }),
      };
    },
    async analyze({ scope = 'section', sectionId = null, useAi = false, forceRefresh = false, preferCacheOnOpen = false, onProgress } = {}) {
      this.abort();
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      activeAbort = ac;
      try {
        const effectiveScope = sectionId && scope === 'section' ? 'section' : scope;
        const collectScope = preferCacheOnOpen && !sectionId ? 'course' : effectiveScope;
        const data = await collectCourseSubtitles({ win, pageWin, scope: collectScope, sectionId, httpGet: httpGetVtt, signal: ac?.signal });
        lastCourseData = data;
        const focusSecId = sectionId || data.activeSectionId;
        const estimates = {
          section: estimateKnowledgeTokens({ ...data, activeSectionId: focusSecId }, 'section'),
          course: estimateKnowledgeTokens(data, 'course'),
        };

        // Instant open from localStorage cache when available (only when target scope actually has subtitles)
        const targetScopeHasSubtitle = effectiveScope === 'section'
          ? Boolean(data.sections.find(s => s.sectionId === focusSecId)?.hasSubtitle !== false && data.captionedSections > 0)
          : data.captionedSections > 0;
        if (!forceRefresh && targetScopeHasSubtitle && (useAi || preferCacheOnOpen)) {
          const cached = findCachedForData(data, useAi ? effectiveScope : (sectionId ? 'section' : null), focusSecId);
          if (cached) {
            const mergedTree = {
              ...cached.hit.tree,
              subtitleDiagnostics: data.subtitleDiagnostics || [],
              skippedNoSubtitleSections: cached.hit.tree.skippedNoSubtitleSections || data.skippedNoSubtitleSections || [],
              hasAnySubtitle: data.hasAnySubtitle,
            };
            return {
              courseData: data,
              estimates,
              tree: mergedTree,
              markdown: cached.hit.markdown,
              usedAi: cached.hit.usedAi,
              fallback: cached.hit.fallback,
              noSubtitle: false,
              skippedNoSubtitleSections: mergedTree.skippedNoSubtitleSections,
              failedSections: cached.hit.failedSections || [],
              channel: cached.hit.channel,
              fromCache: true,
              cachedAt: cached.hit.cachedAt,
              cacheKey: cached.key,
            };
          }
        }

        if (!useAi) {
          const zero = buildZeroAiGuide(data, { scope: effectiveScope, sectionId: focusSecId });
          return {
            courseData: data,
            estimates,
            ...zero,
            usedAi: false,
            fallback: false,
            noSubtitle: Boolean(zero.tree.noSubtitle),
            skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
            failedSections: [],
            fromCache: false,
          };
        }

        const settings = loadAiSettings(win);
        const result = await summarizeCourseWithAi(data, settings, {
          scope: effectiveScope,
          sectionId: focusSecId,
          onProgress,
          signal: ac?.signal,
          gmRequest,
          fetchFn: resolveFetch(),
        });

        let cacheKey = null;
        if (result.usedAi && !result.aborted && data.courseId) {
          cacheKey = buildKnowledgeCacheKey(data.courseId, effectiveScope, focusSecId);
          saveKnowledgeCache(win, cacheKey, {
            ...result,
            scope: effectiveScope,
            provider: settings.provider,
            model: settings.model,
          });
        }

        return {
          courseData: data,
          estimates,
          ...result,
          fromCache: false,
          cachedAt: cacheKey ? Date.now() : null,
          cacheKey,
        };
      } finally {
        if (activeAbort === ac) activeAbort = null;
      }
    },
    getLastCourseData: () => lastCourseData,
    seek({ sectionId, seconds }) {
      const state = controller?.getState?.();
      const queueRunning = Boolean(state && ['running', 'preparing', 'waiting'].includes(state.status));
      return seekCourseTime({ win, pageWin, adapter, sectionId, seconds, queueRunning });
    },
  };
}
