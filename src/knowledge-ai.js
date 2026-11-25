import { WD_CACHE_SCHEMA_VERSION, WD_CACHE_STORAGE_KEYS, WD_CACHE_LRU_DEFAULTS, WD_GM_STORAGE_KEYS, WD_LEGACY_STORAGE_KEYS, bindWindowGmStorage, ensureStorageMigrated, getStorageStatus, migrateLegacyStorage, readMigrationReceipt, readStoredAiConfig, writeStoredAiConfig, readStoredAiApiKey, writeStoredAiApiKey, getLruCacheEntry, setLruCacheEntry, clearLruCache } from './knowledge-storage.js';
import { cleanAndSegmentCues, formatTimestamp, parseTimestampToSeconds, buildZeroAiSectionTree, buildZeroAiGuide, buildKnowledgeMarkdown, buildScopeLabel, collectCourseSubtitles, estimateKnowledgeTokens, seekCourseTime, sanitizeCompleteText, computeTextSimilarity } from './knowledge-vtt.js';
import { assignStableSegmentIds, buildSegmentIndex, buildCourseSegmentIndex, normalizeSegmentId, verifyCitation } from './knowledge-citations.js';

export const WD_AI_CACHE_SCHEMA_VERSION = WD_CACHE_SCHEMA_VERSION;

export const WD_AI_STORAGE_KEYS = {
  config: WD_GM_STORAGE_KEYS.config,
  apiKey: WD_GM_STORAGE_KEYS.apiKey,
  cache: WD_CACHE_STORAGE_KEYS.knowledge,
  legacyConfig: WD_LEGACY_STORAGE_KEYS.config,
  legacyApiKey: WD_LEGACY_STORAGE_KEYS.apiKey,
};

export const WD_AI_PRIVACY_NOTICE = '安全说明：油猴环境下 API Key 与配置保存在扩展隔离存储 GM_setValue（宿主页面不可读取），学习资产按课分片持久保存；非油猴环境自动降级至 localStorage 并告警。仅存本地、不上传、不经过任何我们自己的服务器；仅在您主动点击分析时直连您配置的 Base URL。';

export const WD_AI_PROVIDERS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    note: '支持浏览器 CORS 且国内可直连（GM 与页面 fetch 均可）。',
  },
  {
    id: 'dashscope',
    label: '通义千问 (DashScope)',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    note: '阿里云百炼 OpenAI 兼容模式，支持浏览器 CORS 且国内可直连。',
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    note: '支持浏览器 CORS 且国内可直连。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 (SiliconFlow)',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    note: '支持浏览器 CORS 且国内可直连。',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    modelsEndpointHint: 'GET /models',
    corsMode: 'relay-needed',
    corsBadge: '需中转 URL 或 GM 通道',
    requiresApiKey: true,
    note: '浏览器跨域下对话接口 /chat/completions 无 CORS 放行头，页面 fetch 会失败；请使用油猴 GM 通道或改填支持 CORS 的中转 URL。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    publicModelList: true,
    note: '原生支持浏览器 CORS 且可直连（线路波动可换中转）；/models 接口公开，建议选定模型后再测连接以校验 Key。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    modelsEndpointHint: 'GET /models',
    corsMode: 'proxy-or-relay',
    corsBadge: '国内需中转 URL 或代理',
    requiresApiKey: true,
    note: '官方支持 CORS，但国内无代理无法直连（连接重置/超时）；请开启代理或改填中转 Base URL。',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    modelsEndpointHint: 'GET /v1beta/models',
    corsMode: 'proxy-or-relay',
    corsBadge: '国内需中转 URL 或代理',
    requiresApiKey: true,
    note: '使用 Gemini 原生端点（亦兼容 /v1beta/openai）。官方放行 CORS，但国内无代理会超时，需代理或填中转 Base URL。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    modelsEndpointHint: 'GET /v1/models',
    corsMode: 'proxy-or-relay',
    corsBadge: '国内需中转 URL 或代理',
    requiresApiKey: true,
    note: '使用 Anthropic 原生端点（带浏览器直连头）。国内无代理会被 403 拦截，请开启代理或改填中转 Base URL。',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
    modelsEndpointHint: 'GET /models',
    corsMode: 'local',
    corsBadge: '本机回环（需开 CORS 或 GM）',
    requiresApiKey: false,
    note: '本机回环服务；页面 fetch 需设置 OLLAMA_ORIGINS=*，或通过油猴 GM 通道访问。',
  },
  {
    id: 'custom',
    label: 'OpenAI 兼容 / 自定义',
    protocol: 'openai',
    baseUrl: '',
    model: '',
    modelsEndpointHint: 'GET {base}/models',
    corsMode: 'custom',
    corsBadge: '自定义 · Base URL 必填',
    requiresApiKey: false,
    note: '兼容任意 OpenAI 协议中转站（One API / New API / LiteLLM 等），Base URL 必填（通常以 /v1 结尾）。',
  },
];

const wdKaiDefaultConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  transport: 'auto',
};

const wdKaiAnthropicVersion = '2023-06-01';

function wdKaiLocalStorage(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

export function getAiProviderPreset(providerId) {
  return WD_AI_PROVIDERS.find(item => item.id === providerId)
    || WD_AI_PROVIDERS.find(item => item.id === wdKaiDefaultConfig.provider)
    || WD_AI_PROVIDERS[0];
}

export function loadAiSettings(win, options = {}) {
  ensureStorageMigrated(win, options);
  const { config: parsed } = readStoredAiConfig(win, options);
  const provider = WD_AI_PROVIDERS.some(p => p.id === parsed.provider) ? parsed.provider : wdKaiDefaultConfig.provider;
  const preset = getAiProviderPreset(provider);
  const transport = ['auto', 'gm', 'fetch'].includes(parsed.transport) ? parsed.transport : 'auto';
  const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : preset.baseUrl;
  const model = typeof parsed.model === 'string' ? parsed.model.trim() : preset.model;
  const { apiKey } = readStoredAiApiKey(win, options);
  return { provider, baseUrl, model, transport, apiKey };
}

export function saveAiSettings(win, input, options = {}) {
  ensureStorageMigrated(win, options);
  const current = loadAiSettings(win, options);
  const provider = WD_AI_PROVIDERS.some(p => p.id === input?.provider) ? input.provider : current.provider;
  const baseUrl = typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : current.baseUrl;
  const model = typeof input?.model === 'string' ? input.model.trim() : current.model;
  const transport = ['auto', 'gm', 'fetch'].includes(input?.transport) ? input.transport : current.transport;
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : current.apiKey;
  const cfgRes = writeStoredAiConfig(win, { provider, baseUrl, model, transport }, options);
  if (!cfgRes.ok) {
    return { ok: false, error: cfgRes.error || '写入 AI 配置失败，请检查存储权限。' };
  }
  const keyRes = writeStoredAiApiKey(win, apiKey, options);
  if (!keyRes.ok) {
    return { ok: false, error: keyRes.error || '写入 API Key 失败，请检查存储权限。' };
  }
  return {
    ok: true,
    backend: keyRes.backend || cfgRes.backend,
    degraded: Boolean(keyRes.degraded || cfgRes.degraded),
    settings: { provider, baseUrl, model, transport, apiKey },
  };
}

export function clearAiApiKey(win, options = {}) {
  const res = writeStoredAiApiKey(win, '', options);
  try { wdKaiLocalStorage(win)?.removeItem?.(WD_LEGACY_STORAGE_KEYS.apiKey); } catch { /* ignore */ }
  if (!res.ok) return { ok: false, error: res.error || '清空本地 Key 失败。' };
  return { ok: true, backend: res.backend };
}

export function buildKnowledgeCacheKey(courseId, scope = 'course', sectionId = null) {
  const cid = String(courseId || 'unknown').trim() || 'unknown';
  if (scope === 'section') {
    const sid = String(sectionId || 'current').trim() || 'current';
    return `${cid}::section::${sid}`;
  }
  return `${cid}::course`;
}

export function loadKnowledgeCache(win, key, policy = {}) {
  if (!key) return null;
  const entry = getLruCacheEntry(win, WD_AI_STORAGE_KEYS.cache, key, {
    ...WD_CACHE_LRU_DEFAULTS.knowledge,
    schemaVersion: WD_AI_CACHE_SCHEMA_VERSION,
    ...policy,
  });
  if (!entry || typeof entry !== 'object' || !entry.tree || typeof entry.markdown !== 'string') return null;
  if (entry.schemaVersion !== WD_AI_CACHE_SCHEMA_VERSION) return null;
  return entry;
}

export function saveKnowledgeCache(win, key, entry, policy = {}) {
  if (!key || !entry?.tree) return false;
  return setLruCacheEntry(win, WD_AI_STORAGE_KEYS.cache, key, {
    schemaVersion: WD_AI_CACHE_SCHEMA_VERSION,
    cachedAt: Number(entry.cachedAt) || Date.now(),
    provider: entry.provider || '',
    model: entry.model || '',
    scope: entry.scope || 'course',
    tree: entry.tree,
    markdown: entry.markdown || buildKnowledgeMarkdown(entry.tree),
    usedAi: Boolean(entry.usedAi),
    fallback: Boolean(entry.fallback),
    failedSections: Array.isArray(entry.failedSections) ? entry.failedSections : [],
    channel: entry.channel || null,
  }, { ...WD_CACHE_LRU_DEFAULTS.knowledge, ...policy });
}

export function clearKnowledgeCache(win, key = null) {
  return clearLruCache(win, WD_AI_STORAGE_KEYS.cache, key);
}

export function redactAiSecret(text, apiKey = '') {
  let out = String(text ?? '');
  const cleanKey = String(apiKey ?? '').trim();
  if (cleanKey.length >= 6) {
    out = out.split(cleanKey).join('[已脱敏]');
  }
  out = out.replace(/\b(?:sk-[a-zA-Z0-9_-]{8,}|AIza[0-9A-Za-z_-]{16,}|Bearer\s+[a-zA-Z0-9._-]{12,})\b/gu, '[已脱敏]');
  return out;
}

export function normalizeAiBaseUrl(baseUrl) {
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
  return url;
}

export function resolveAiProtocol(settings = {}) {
  const providerId = String(settings?.provider || '').trim();
  const rawUrl = String(settings?.baseUrl || '').trim();
  const preset = WD_AI_PROVIDERS.find(item => item.id === providerId);
  if (preset?.protocol === 'anthropic') {
    if (/\/chat\/completions\/?$/iu.test(rawUrl)) return 'openai';
    return 'anthropic';
  }
  if (preset?.protocol === 'gemini') {
    if (/\/openai(?:\/|$)/iu.test(rawUrl) || /\/chat\/completions\/?$/iu.test(rawUrl)) return 'openai';
    return 'gemini';
  }
  return 'openai';
}

export function buildChatCompletionsUrl(baseUrl) {
  const url = normalizeAiBaseUrl(baseUrl);
  const cleanPath = url.pathname.replace(/\/+$/u, '');
  url.pathname = /\/chat\/completions$/iu.test(cleanPath) ? cleanPath : `${cleanPath}/chat/completions`;
  return url.toString();
}

export function buildModelsUrl(baseUrl, protocol = 'openai') {
  const url = normalizeAiBaseUrl(baseUrl);
  let cleanPath = url.pathname.replace(/\/+$/u, '');
  if (protocol === 'gemini') {
    cleanPath = cleanPath
      .replace(/\/models\/[^/]+(?::[a-zA-Z]+)?$/iu, '')
      .replace(/\/models$/iu, '');
    url.pathname = cleanPath ? `${cleanPath}/models` : '/v1beta/models';
    url.searchParams.delete('key');
    if (!url.searchParams.has('pageSize')) url.searchParams.set('pageSize', '200');
    return url.toString();
  }
  if (protocol === 'anthropic') {
    cleanPath = cleanPath.replace(/\/messages$/iu, '').replace(/\/models$/iu, '');
    url.pathname = cleanPath ? `${cleanPath}/models` : '/v1/models';
    return url.toString();
  }
  cleanPath = cleanPath
    .replace(/\/chat\/completions$/iu, '')
    .replace(/\/completions$/iu, '')
    .replace(/\/responses$/iu, '')
    .replace(/\/models$/iu, '');
  url.pathname = `${cleanPath}/models`;
  return url.toString();
}

export function buildChatEndpointUrl(baseUrl, protocol = 'openai', model = '') {
  if (protocol === 'gemini') {
    const url = normalizeAiBaseUrl(baseUrl);
    const cleanModel = String(model || '').trim().replace(/^models\//iu, '');
    if (!cleanModel) throw new Error('未填写模型名');
    let cleanPath = url.pathname.replace(/\/+$/u, '');
    cleanPath = cleanPath
      .replace(/\/models\/[^/]+(?::[a-zA-Z]+)?$/iu, '')
      .replace(/\/models$/iu, '');
    const prefix = cleanPath || '/v1beta';
    url.pathname = `${prefix}/models/${encodeURIComponent(cleanModel)}:generateContent`;
    url.searchParams.delete('key');
    return url.toString();
  }
  if (protocol === 'anthropic') {
    const url = normalizeAiBaseUrl(baseUrl);
    let cleanPath = url.pathname.replace(/\/+$/u, '');
    cleanPath = cleanPath.replace(/\/messages$/iu, '').replace(/\/models$/iu, '');
    url.pathname = cleanPath ? `${cleanPath}/messages` : '/v1/messages';
    return url.toString();
  }
  return buildChatCompletionsUrl(baseUrl);
}

export function validateAiEndpoint(settings = {}) {
  const protocol = resolveAiProtocol(settings);
  normalizeAiBaseUrl(settings?.baseUrl);
  if (protocol === 'openai') buildChatCompletionsUrl(settings?.baseUrl);
  return { ok: true, protocol };
}

function wdKaiExtractErrorDetail(bodyText, apiKey = '') {
  const raw = String(bodyText ?? '').trim();
  if (!raw) return { detail: '', code: '', type: '', isHtml: false };
  const isHtml = /^<!doctype html|^<html[\s>]/iu.test(raw);
  try {
    const parsed = JSON.parse(raw);
    const detail = parsed?.error?.message || parsed?.message || parsed?.detail || (typeof parsed?.error === 'string' ? parsed.error : '');
    const code = String(parsed?.error?.code || parsed?.code || parsed?.error?.status || '');
    const type = String(parsed?.error?.type || parsed?.type || '');
    return {
      detail: redactAiSecret(String(detail || '').trim(), apiKey),
      code,
      type,
      isHtml: false,
    };
  } catch {
    return { detail: '', code: '', type: '', isHtml };
  }
}

export function classifyAiHttpError({ status, bodyText = '', action = 'chat', protocol = 'openai', apiKey = '', model = '' } = {}) {
  const { detail, code, type, isHtml } = wdKaiExtractErrorDetail(bodyText, apiKey);
  const combined = `${detail} ${code} ${type}`.toLowerCase();
  const shortDetail = detail ? detail.slice(0, 100) : '';
  const suffix = shortDetail ? `：${shortDetail}` : '';

  const looksLikeInvalidKey = /api[_ ]?key[_ ]?(?:not[_ ]?valid|invalid|expired|missing)|incorrect api key|invalid[_ ]?api[_ ]?key|invalid[_ ]?x-api-key|authentication|unauthenticated|令牌已过期|令牌无效|鉴权失败|密钥无效/iu.test(combined);
  const looksLikeModelNotFound = /model[_ ]?not[_ ]?found|unknown model|invalid model|unsupported model|does not exist|not_found_error|is not found for api version|模型不存在|无权访问.*模型|not found/iu.test(combined);
  const looksLikeRateLimit = /rate[_ ]?limit|too many requests|quota|insufficient[_ ]?quota|credit|balance|余额不足|额度/iu.test(combined);

  if (status === 401 || (status === 400 && looksLikeInvalidKey)) {
    return {
      category: 'invalid_key',
      label: 'Key 无效',
      statusCode: status,
      message: `API Key 无效或已过期（HTTP ${status}${suffix}）`,
      hint: '请检查 API Key 是否复制完整、未包含多余空格，且与当前选择的服务商匹配。',
    };
  }
  if (status === 403) {
    return {
      category: 'invalid_key',
      label: action === 'fetch-models' ? '无权限' : 'Key 无效',
      statusCode: status,
      message: `API Key 无权限或访问被拒（HTTP 403${suffix}）`,
      hint: '可能是当前 Key 缺少权限、账号未开通该接口或所在地区受限；如为海外服务商，请尝试开启代理或使用中转 Base URL。',
    };
  }
  if (status === 402 || status === 429 || (status === 400 && looksLikeRateLimit)) {
    const isQuota = status === 402 || /quota|balance|credit|余额|额度/iu.test(combined);
    return {
      category: 'rate_limited',
      label: '限流',
      statusCode: status,
      message: isQuota
        ? `账户余额不足或额度已耗尽（HTTP ${status}${suffix}）`
        : `请求过于频繁或触发限流（HTTP ${status}${suffix}）`,
      hint: isQuota ? '请检查服务商控制台余额与配额后再试。' : '触发服务商频率限制，请稍等片刻后重试或切换模型。',
    };
  }
  if (status === 404) {
    if (action === 'fetch-models') {
      return {
        category: 'endpoint_not_found',
        label: '路径不对',
        statusCode: status,
        message: `模型列表接口不存在（HTTP 404${suffix}）`,
        hint: '请检查 Base URL 是否缺少或多余路径（如 /v1）；部分中转未开放 /models 接口，可直接手动填写模型名。',
      };
    }
    if (model && !isHtml && (looksLikeModelNotFound || protocol === 'gemini' || protocol === 'anthropic' || !detail)) {
      return {
        category: 'model_not_found',
        label: '模型不存在',
        statusCode: status,
        message: `模型「${model}」不存在或不可用（HTTP 404${suffix}）`,
        hint: '请点击「获取模型」重新选取可用模型；若确定模型名无误，请检查 Base URL 路径是否正确。',
      };
    }
    return {
      category: 'model_not_found',
      label: '模型或路径不存在',
      statusCode: status,
      message: `接口地址或模型不存在（HTTP 404${suffix}），请检查 Base URL 与模型名`,
      hint: '请核对 Base URL 路径与模型名称，或点击「获取模型」重新选取。',
    };
  }
  if (status === 400 && action !== 'fetch-models' && looksLikeModelNotFound) {
    return {
      category: 'model_not_found',
      label: '模型不存在',
      statusCode: status,
      message: `模型「${model || '当前所选'}」不存在或不受支持（HTTP 400${suffix}）`,
      hint: '请点击「获取模型」重新选取支持对话的模型，或核对模型 ID 拼写。',
    };
  }
  if (status >= 500) {
    return {
      category: 'server_error',
      label: '服务异常',
      statusCode: status,
      message: `服务商暂时异常（HTTP ${status}${suffix}）`,
      hint: '服务商端返回 5xx 错误，请稍后重试。',
    };
  }
  return {
    category: 'bad_request',
    label: '请求失败',
    statusCode: status,
    message: `接口返回错误（HTTP ${status}${suffix}）`,
    hint: '请检查所选服务商协议、Base URL 与模型配置是否一致。',
  };
}

export function classifyAiNetworkError(err, { transport = 'auto', hadGm = false } = {}) {
  const msg = redactAiSecret(err?.message || String(err || '网络请求失败'));
  if (err?.wdAborted || /已取消|已中止/u.test(msg)) {
    return {
      category: 'aborted',
      label: '已取消',
      aborted: true,
      message: '已取消请求',
      hint: '',
    };
  }
  if (err?.wdTimeout || /超时/u.test(msg)) {
    return {
      category: 'network_error',
      label: '网络不通',
      isTimeout: true,
      message: msg,
      hint: '请求超时，服务商响应过慢或当前网络无法直连（如海外官方接口），建议开启代理或填写可直连的中转 Base URL。',
    };
  }
  const channel = err?.wdChannel || (transport === 'fetch' || !hadGm ? 'fetch' : 'gm');
  if (channel === 'fetch') {
    return {
      category: 'network_error',
      label: '网络不通',
      isCorsLikely: true,
      message: '网络请求失败，可能被浏览器 CORS 跨域策略或宿主页面 CSP 拦截',
      hint: '当前走了页面 fetch 通道：若服务商未放行跨域 CORS 或页面存在 CSP 限制会被浏览器拦截。请切换为「自动 / GM_xmlhttpRequest」通道，或改填支持 CORS 的中转 Base URL。',
    };
  }
  return {
    category: 'network_error',
    label: '网络不通',
    isCorsLikely: true,
    message: `网络不通或请求被拦截（${msg}）`,
    hint: '可能是网络不可达、代理未通、被 CORS/CSP 限制，或 Tampermonkey 尚未放行该域名（首次访问新域名请在油猴弹窗点击「允许」）；也可改填可直连的中转 Base URL。',
  };
}

function wdKaiMapHttpError(status, bodyText, extra = {}) {
  return classifyAiHttpError({ status, bodyText, ...extra }).message;
}

function wdKaiGmRequest(gmRequest, { url, method = 'GET', headers = {}, body = null, timeoutMs = 45000, signal, anonymous = true }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('用户已取消请求');
      e.wdAborted = true;
      e.wdChannel = 'gm';
      reject(e);
      return;
    }
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
      const e = new Error('用户已取消请求');
      e.wdAborted = true;
      e.wdChannel = 'gm';
      finish(reject, e);
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
        onerror: err => {
          const e = new Error(`GM_xmlhttpRequest 网络错误${err?.error ? `（${err.error}）` : ''}`);
          e.wdNetwork = true;
          e.wdChannel = 'gm';
          finish(reject, e);
        },
        ontimeout: () => {
          const e = new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`);
          e.wdTimeout = true;
          e.wdNetwork = true;
          e.wdChannel = 'gm';
          finish(reject, e);
        },
        onabort: () => {
          const e = new Error('请求已中止');
          e.wdAborted = true;
          e.wdChannel = 'gm';
          finish(reject, e);
        },
      });
    } catch (err) {
      const e = new Error(`GM_xmlhttpRequest 调用失败：${err?.message || err}`);
      e.wdNetwork = true;
      e.wdChannel = 'gm';
      finish(reject, e);
    }
  });
}

async function wdKaiFetchRequest(fetchFn, { url, method = 'GET', headers = {}, body = null, timeoutMs = 45000, signal, credentials = 'omit' }) {
  if (typeof fetchFn !== 'function') {
    const e = new Error('当前环境不支持页面 fetch');
    e.wdNetwork = true;
    e.wdChannel = 'fetch';
    throw e;
  }
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
    if (timedOut) {
      const e = new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`);
      e.wdTimeout = true;
      e.wdNetwork = true;
      e.wdChannel = 'fetch';
      throw e;
    }
    if (signal?.aborted) {
      const e = new Error('用户已取消请求');
      e.wdAborted = true;
      e.wdChannel = 'fetch';
      throw e;
    }
    const e = new Error(`页面 fetch 失败（可能是 CORS 拦截或网络不可达）：${err?.message || err}`);
    e.wdNetwork = true;
    e.wdChannel = 'fetch';
    throw e;
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
    if (!hasGm) {
      const e = new Error('当前环境未提供 GM_xmlhttpRequest，请在设置中切换为「自动」或「页面 fetch」');
      e.wdNetwork = true;
      e.wdChannel = 'gm';
      throw e;
    }
    return wdKaiGmRequest(gmRequest, { url, method, headers, body, timeoutMs, signal, anonymous: true });
  }
  if (transport === 'fetch') {
    return wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
  }
  if (hasGm) {
    try {
      return await wdKaiGmRequest(gmRequest, { url, method, headers, body, timeoutMs, signal, anonymous: true });
    } catch (gmErr) {
      if (signal?.aborted || gmErr?.wdAborted || !hasFetch) throw gmErr;
      try {
        return await wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
      } catch {
        throw gmErr;
      }
    }
  }
  return wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
}

export function buildAiAuthHeaders(settings = {}, protocol = 'openai', { includeContentType = true } = {}) {
  const headers = {};
  if (includeContentType) headers['Content-Type'] = 'application/json';
  const apiKey = String(settings?.apiKey ?? '').trim();
  if (protocol === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = wdKaiAnthropicVersion;
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return headers;
  }
  if (protocol === 'gemini') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
    return headers;
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function wdKaiBuildChatRequestPayload(protocol, { model, messages, temperature = 0.2, maxTokens = null, useMaxCompletionTokens = false }) {
  const list = Array.isArray(messages) ? messages : [];
  if (protocol === 'anthropic') {
    const systemParts = [];
    const conv = [];
    for (const m of list) {
      if (!m || !m.content) continue;
      if (m.role === 'system') systemParts.push(String(m.content));
      else conv.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) });
    }
    if (!conv.length) conv.push({ role: 'user', content: 'hi' });
    const payload = {
      model,
      max_tokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
      messages: conv,
    };
    if (systemParts.length) payload.system = systemParts.join('\n\n');
    if (typeof temperature === 'number' && Number.isFinite(temperature)) payload.temperature = temperature;
    return payload;
  }
  if (protocol === 'gemini') {
    const systemParts = [];
    const contents = [];
    for (const m of list) {
      if (!m || !m.content) continue;
      if (m.role === 'system') systemParts.push(String(m.content));
      else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content) }],
        });
      }
    }
    if (!contents.length) contents.push({ role: 'user', parts: [{ text: 'hi' }] });
    const generationConfig = {};
    if (typeof temperature === 'number' && Number.isFinite(temperature)) generationConfig.temperature = temperature;
    if (Number.isInteger(maxTokens) && maxTokens > 0) generationConfig.maxOutputTokens = maxTokens;
    const payload = { contents };
    if (systemParts.length) payload.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
    if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;
    return payload;
  }
  const payload = { model, messages: list };
  if (typeof temperature === 'number' && Number.isFinite(temperature)) payload.temperature = temperature;
  if (Number.isInteger(maxTokens) && maxTokens > 0) {
    if (useMaxCompletionTokens) payload.max_completion_tokens = maxTokens;
    else payload.max_tokens = maxTokens;
  }
  return payload;
}

function wdKaiExtractChatContent(envelope, protocol = 'openai', { allowEmptyText = false } = {}) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('接口响应体不是合法 JSON 对象');
  }
  if (protocol === 'anthropic') {
    const blocks = Array.isArray(envelope.content) ? envelope.content : null;
    if (!blocks) throw new Error('接口响应缺少 content 字段（请确认 Base URL 为 Anthropic 兼容端点）');
    const text = blocks
      .filter(b => b && (b.type === 'text' || typeof b.text === 'string'))
      .map(b => String(b.text || ''))
      .join('')
      .trim();
    if (!text && !allowEmptyText && !blocks.length) throw new Error('模型未返回有效文本内容');
    return text;
  }
  if (protocol === 'gemini') {
    const candidates = Array.isArray(envelope.candidates) ? envelope.candidates : null;
    if (!candidates || !candidates.length) throw new Error('接口响应缺少 candidates 字段（请确认 Base URL 为 Gemini 原生端点）');
    const parts = Array.isArray(candidates[0]?.content?.parts) ? candidates[0].content.parts : [];
    const text = parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
    if (!text && !allowEmptyText) throw new Error('模型未返回有效文本内容');
    return text;
  }
  const msgContent = envelope?.choices?.[0]?.message?.content;
  let text = '';
  if (typeof msgContent === 'string') {
    text = msgContent.trim();
  } else if (Array.isArray(msgContent)) {
    text = msgContent.map(part => (typeof part === 'string' ? part : String(part?.text || ''))).join('').trim();
  } else if (allowEmptyText && Array.isArray(envelope?.choices) && envelope.choices.length > 0) {
    text = '';
  } else {
    throw new Error('接口响应缺少 choices[0].message.content');
  }
  if (!text && !allowEmptyText) {
    throw new Error('接口响应缺少 choices[0].message.content');
  }
  return text;
}

export async function invokeAiChat({
  settings,
  messages,
  temperature = 0.2,
  maxTokens = null,
  gmRequest,
  fetchFn,
  signal,
  timeoutMs = 45000,
  allowEmptyText = false,
  action = 'chat',
} = {}) {
  const protocol = resolveAiProtocol(settings);
  const model = String(settings?.model || '').trim();
  if (!model) throw new Error('未填写模型名');
  const endpoint = buildChatEndpointUrl(settings?.baseUrl, protocol, model);
  const headers = buildAiAuthHeaders(settings, protocol, { includeContentType: true });
  const payload = JSON.stringify(wdKaiBuildChatRequestPayload(protocol, { model, messages, temperature, maxTokens }));
  const res = await sendAiHttpRequest({
    transport: settings?.transport || 'auto',
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
    const classified = classifyAiHttpError({
      status: res.status,
      bodyText: res.text,
      action,
      protocol,
      apiKey: settings?.apiKey || '',
      model,
    });
    const err = new Error(classified.message);
    err.wdClassified = classified;
    err.status = res.status;
    err.wdChannel = res.channel;
    throw err;
  }
  let envelope;
  try {
    envelope = JSON.parse(res.text);
  } catch {
    const err = new Error('接口响应体不是合法 JSON（请检查 Base URL 是否指向兼容对话端点）');
    err.wdCategory = 'invalid_response';
    err.wdChannel = res.channel;
    throw err;
  }
  const content = wdKaiExtractChatContent(envelope, protocol, { allowEmptyText });
  return { content, channel: res.channel, protocol, endpoint, status: res.status };
}

const wdKaiNonChatModelRe = /(?:^|[/:-])(embedding|embed|text-embedding|bge-|rerank|whisper|tts|speech|audio|dall-e|imagen|flux|stable-diffusion|midjourney|moderation|omni-moderation|realtime|transcribe|sora|veo)(?:$|[/:-])/iu;

export function parseModelsListResponse(text, protocol = 'openai', providerId = '') {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('模型列表响应不是合法 JSON（请检查 Base URL 或网关是否返回了网页）');
  }
  let rawItems = [];
  if (protocol === 'gemini' && Array.isArray(parsed?.models)) {
    const hasMethodInfo = parsed.models.some(m => Array.isArray(m?.supportedGenerationMethods));
    rawItems = parsed.models
      .filter(m => !hasMethodInfo || !Array.isArray(m?.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent'))
      .map(m => {
        const rawName = String(m?.name || m?.id || '').trim();
        const id = rawName.replace(/^models\//iu, '');
        const label = String(m?.displayName || '').trim();
        return {
          id,
          label: label && label !== id ? label : '',
          ownedBy: 'google',
          created: 0,
        };
      });
  } else if (protocol === 'anthropic' && Array.isArray(parsed?.data)) {
    rawItems = parsed.data.map(m => {
      const id = String(m?.id || '').trim();
      const label = String(m?.display_name || m?.name || '').trim();
      const created = m?.created_at ? Date.parse(m.created_at) || 0 : 0;
      return {
        id,
        label: label && label !== id ? label : '',
        ownedBy: 'anthropic',
        created,
      };
    });
  } else {
    const list = Array.isArray(parsed?.data) ? parsed.data
      : Array.isArray(parsed?.models) ? parsed.models
      : Array.isArray(parsed) ? parsed : null;
    if (!list) {
      throw new Error('模型列表响应缺少 data/models 数组（该接口可能不符合标准模型列表格式）');
    }
    rawItems = list.map(m => {
      if (typeof m === 'string') return { id: m.trim(), label: '', ownedBy: '', created: 0 };
      const id = String(m?.id || m?.name || m?.model || '').trim().replace(/^models\//iu, '');
      const label = String(m?.display_name || m?.displayName || (m?.name && m.name !== id ? m.name : '') || '').trim();
      return {
        id,
        label: label && label !== id ? label : '',
        ownedBy: String(m?.owned_by || m?.provider || '').trim(),
        created: Number(m?.created) || 0,
      };
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const item of rawItems) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push({
      ...item,
      nonChat: wdKaiNonChatModelRe.test(item.id),
    });
  }
  const presetDefaultModel = WD_AI_PROVIDERS.find(p => p.id === providerId)?.model || '';
  deduped.sort((a, b) => {
    if (a.id === presetDefaultModel && b.id !== presetDefaultModel) return -1;
    if (b.id === presetDefaultModel && a.id !== presetDefaultModel) return 1;
    if (a.nonChat !== b.nonChat) return a.nonChat ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
  return deduped;
}

export async function fetchAiModels(settings = {}, options = {}) {
  const startedAt = Date.now();
  const providerId = String(settings?.provider || wdKaiDefaultConfig.provider);
  const preset = WD_AI_PROVIDERS.find(p => p.id === providerId) || getAiProviderPreset(providerId);
  const protocol = resolveAiProtocol(settings);
  const apiKey = String(settings?.apiKey ?? '').trim();
  const transport = ['auto', 'gm', 'fetch'].includes(settings?.transport) ? settings.transport : 'auto';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;

  if (!String(settings?.baseUrl ?? '').trim()) {
    return {
      ok: false,
      models: [],
      category: 'config_error',
      label: '配置不完整',
      message: '请先填写 Base URL 再获取模型列表',
      hint: '选择预置服务商会自动填充 Base URL；自定义模式请填写完整 https:// 接口地址。',
      latencyMs: 0,
    };
  }
  let endpoint;
  try {
    endpoint = buildModelsUrl(settings.baseUrl, protocol);
  } catch (err) {
    return {
      ok: false,
      models: [],
      category: 'config_error',
      label: '地址非法',
      message: err?.message || 'Base URL 格式非法',
      hint: '请以 https:// 开头（本机回环支持 http://127.0.0.1 或 localhost）。',
      latencyMs: 0,
    };
  }
  if (preset?.requiresApiKey && !apiKey) {
    return {
      ok: false,
      models: [],
      category: 'config_error',
      label: '缺少 Key',
      message: '请先输入 API Key 再点击「获取模型」',
      hint: '密钥仅保存在本地隔离存储，不经过第三方服务器。',
      latencyMs: 0,
    };
  }

  const headers = buildAiAuthHeaders({ ...settings, apiKey }, protocol, { includeContentType: false });
  try {
    const res = await sendAiHttpRequest({
      transport,
      gmRequest: options.gmRequest,
      fetchFn: options.fetchFn,
      url: endpoint,
      method: 'GET',
      headers,
      body: null,
      timeoutMs,
      signal: options.signal,
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (res.status < 200 || res.status >= 300) {
      const classified = classifyAiHttpError({
        status: res.status,
        bodyText: res.text,
        action: 'fetch-models',
        protocol,
        apiKey,
      });
      return {
        ok: false,
        models: [],
        ...classified,
        latencyMs,
        channel: res.channel,
        endpoint,
        protocol,
      };
    }
    const models = parseModelsListResponse(res.text, protocol, providerId);
    if (!models.length) {
      return {
        ok: false,
        models: [],
        category: 'empty_models',
        label: '无可用模型',
        statusCode: res.status,
        message: '接口返回成功，但模型列表为空',
        hint: '该 Key 可能暂未分配可用模型，或可尝试直接手动填写模型名。',
        latencyMs,
        channel: res.channel,
        endpoint,
        protocol,
      };
    }
    return {
      ok: true,
      models,
      total: models.length,
      latencyMs,
      channel: res.channel,
      endpoint,
      protocol,
      publicModelList: Boolean(preset?.publicModelList),
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const classified = classifyAiNetworkError(err, {
      transport,
      hadGm: typeof options.gmRequest === 'function',
    });
    return {
      ok: false,
      models: [],
      ...classified,
      latencyMs,
      endpoint,
      protocol,
    };
  }
}

export async function testAiConnection(settings = {}, options = {}) {
  const startedAt = Date.now();
  const providerId = String(settings?.provider || wdKaiDefaultConfig.provider);
  const preset = WD_AI_PROVIDERS.find(p => p.id === providerId) || getAiProviderPreset(providerId);
  const protocol = resolveAiProtocol(settings);
  const apiKey = String(settings?.apiKey ?? '').trim();
  const model = String(settings?.model ?? '').trim();
  const transport = ['auto', 'gm', 'fetch'].includes(settings?.transport) ? settings.transport : 'auto';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000;

  if (!String(settings?.baseUrl ?? '').trim()) {
    return {
      ok: false,
      category: 'config_error',
      statusLabel: '配置不完整',
      badgeStatus: 'error',
      testedScope: model ? 'model' : 'endpoint',
      model,
      latencyMs: 0,
      message: '请先填写 Base URL',
      hint: '选择预置服务商会自动填入默认地址；自定义档必须填写 Base URL。',
    };
  }
  try {
    normalizeAiBaseUrl(settings.baseUrl);
  } catch (err) {
    return {
      ok: false,
      category: 'config_error',
      statusLabel: '地址非法',
      badgeStatus: 'error',
      testedScope: model ? 'model' : 'endpoint',
      model,
      latencyMs: 0,
      message: err?.message || 'Base URL 格式非法',
      hint: '请检查地址协议（仅支持 https:// 或本机回环）。',
    };
  }
  if (preset?.requiresApiKey && !apiKey) {
    return {
      ok: false,
      category: 'invalid_key',
      statusLabel: 'Key 未填写',
      badgeStatus: 'unconfigured',
      testedScope: model ? 'model' : 'endpoint',
      model,
      latencyMs: 0,
      message: '请先输入 API Key 后再测试连接',
      hint: '留空将保持零 AI 档（仅使用本地字幕规则摘要）。',
    };
  }

  // Degraded mode when no model is chosen yet: test endpoint + key connectivity via /models
  if (!model) {
    const listRes = await fetchAiModels({ ...settings, apiKey, transport }, { ...options, timeoutMs });
    if (listRes.aborted) {
      return {
        ok: false,
        aborted: true,
        category: 'aborted',
        statusLabel: '已取消',
        badgeStatus: 'idle',
        testedScope: 'endpoint',
        model: '',
        latencyMs: listRes.latencyMs,
        message: '已取消连接测试',
        hint: '',
      };
    }
    if (listRes.ok) {
      const testedWhat = preset?.publicModelList
        ? `已测：接口连通性与模型列表（获取到 ${listRes.models.length} 个模型；注意该服务商 /models 公开，未校验 Key 鉴权）`
        : `已测：接口连通性与 API Key 鉴权（获取到 ${listRes.models.length} 个模型）`;
      const notTestedWhat = '未测：尚未选择模型，未发起对话推理，无法确认具体模型权限与账户余额';
      return {
        ok: true,
        degradedScope: true,
        category: 'ok',
        statusLabel: '端点可用（未测模型）',
        badgeStatus: 'ok',
        testedScope: 'endpoint',
        model: '',
        modelCount: listRes.models.length,
        models: listRes.models,
        latencyMs: listRes.latencyMs,
        channel: listRes.channel,
        protocol: listRes.protocol,
        testedWhat,
        notTestedWhat,
        message: `端点连通（未选模型） · ${listRes.latencyMs}ms`,
        hint: '建议从上方下拉选择一个模型后再次点击「测试连接」，完成端到端推理校验。',
      };
    }
    const categoryMap = {
      invalid_key: { category: 'invalid_key', statusLabel: 'Key 无效' },
      rate_limited: { category: 'rate_limited', statusLabel: '限流' },
      network_error: { category: 'network_error', statusLabel: '网络不通' },
      endpoint_not_found: { category: 'network_error', statusLabel: '端点不可达' },
    };
    const mapped = categoryMap[listRes.category] || { category: listRes.category || 'other_error', statusLabel: listRes.label || '不可用' };
    return {
      ok: false,
      category: mapped.category,
      statusLabel: mapped.statusLabel,
      badgeStatus: 'error',
      testedScope: 'endpoint',
      model: '',
      statusCode: listRes.statusCode || null,
      latencyMs: listRes.latencyMs,
      channel: listRes.channel || null,
      protocol: listRes.protocol || protocol,
      testedWhat: '尝试探测模型列表端点与 Key 鉴权（尚未选择具体模型）',
      notTestedWhat: '未测试具体模型推理',
      message: listRes.message,
      hint: listRes.hint || '',
    };
  }

  // Full minimal real chat request (1-token scale) with the selected model
  const attemptTest = async (useFallbackMaxCompletion = false) => {
    const endpoint = buildChatEndpointUrl(settings.baseUrl, protocol, model);
    const headers = buildAiAuthHeaders({ ...settings, apiKey }, protocol, { includeContentType: true });
    const payloadObj = wdKaiBuildChatRequestPayload(protocol, {
      model,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: useFallbackMaxCompletion ? null : 0,
      maxTokens: useFallbackMaxCompletion ? 16 : 1,
      useMaxCompletionTokens: useFallbackMaxCompletion,
    });
    const res = await sendAiHttpRequest({
      transport,
      gmRequest: options.gmRequest,
      fetchFn: options.fetchFn,
      url: endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify(payloadObj),
      timeoutMs,
      signal: options.signal,
    });
    return { res, endpoint };
  };

  try {
    let { res, endpoint } = await attemptTest(false);
    // Compatibility fallback for reasoning models (e.g. o1/o3/gpt-5) rejecting max_tokens or temperature=0
    if (protocol === 'openai' && res.status === 400 && /max_tokens|max_completion_tokens|temperature/iu.test(res.text)) {
      const retry = await attemptTest(true);
      res = retry.res;
      endpoint = retry.endpoint;
    }
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (res.status < 200 || res.status >= 300) {
      const classified = classifyAiHttpError({
        status: res.status,
        bodyText: res.text,
        action: 'test-model',
        protocol,
        apiKey,
        model,
      });
      const statusLabel = classified.category === 'invalid_key' ? 'Key 无效'
        : classified.category === 'model_not_found' ? '模型不存在'
        : classified.category === 'rate_limited' ? '限流'
        : classified.label || '不可用';
      return {
        ok: false,
        category: classified.category,
        statusLabel,
        badgeStatus: 'error',
        testedScope: 'model',
        model,
        statusCode: res.status,
        latencyMs,
        channel: res.channel,
        protocol,
        endpoint,
        message: classified.message,
        hint: classified.hint,
      };
    }
    try {
      const envelope = JSON.parse(res.text);
      wdKaiExtractChatContent(envelope, protocol, { allowEmptyText: true });
    } catch (parseErr) {
      return {
        ok: false,
        category: 'invalid_response',
        statusLabel: '响应异常',
        badgeStatus: 'error',
        testedScope: 'model',
        model,
        statusCode: res.status,
        latencyMs,
        channel: res.channel,
        protocol,
        endpoint,
        message: parseErr?.message || '接口返回了无法识别的响应格式',
        hint: '请检查 Base URL 与所选服务商协议是否匹配。',
      };
    }
    return {
      ok: true,
      category: 'ok',
      statusLabel: '可用',
      badgeStatus: 'ok',
      testedScope: 'model',
      model,
      statusCode: res.status,
      latencyMs,
      channel: res.channel,
      protocol,
      endpoint,
      testedWhat: `已使用模型 ${model} 完成最小对话请求（1 token 量级），验证了端点、Key 鉴权与模型推理可用`,
      notTestedWhat: '未验证长上下文响应与结构化 JSON 稳定度',
      message: `可用 · ${model} · ${latencyMs}ms`,
      hint: '',
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const classified = classifyAiNetworkError(err, {
      transport,
      hadGm: typeof options.gmRequest === 'function',
    });
    if (classified.aborted) {
      return {
        ok: false,
        aborted: true,
        category: 'aborted',
        statusLabel: '已取消',
        badgeStatus: 'idle',
        testedScope: 'model',
        model,
        latencyMs,
        message: '已取消连接测试',
        hint: '',
      };
    }
    return {
      ok: false,
      category: 'network_error',
      statusLabel: '网络不通',
      badgeStatus: 'error',
      testedScope: 'model',
      model,
      latencyMs,
      protocol,
      message: classified.message,
      hint: classified.hint,
    };
  }
}

export function buildSectionPrompt(courseTitle, section, segments, chunkInfo = null) {
  const isChunk = Boolean(chunkInfo && chunkInfo.total > 1);
  const chunkHint = isChunk ? `（第 ${chunkInfo.index}/${chunkInfo.total} 分段）` : '';
  const safeSegments = (Array.isArray(segments) ? segments : []).map((seg, idx) => ({
    ...seg,
    segId: seg?.segId || `S${String(seg?.index || idx + 1).padStart(2, '0')}`,
  }));
  const transcript = safeSegments.map(seg => `[${seg.segId}] ${seg.text}`).join('\n');
  const system = [
    '你是资深企业课程学习教练。请根据带分段编号 [S01]、[S02]… 的课程字幕，产出一份让学员「花 2 分钟就能看懂、且每条结论均可对照原字幕核验」的结构化学习卡片。',
    '只输出合法 JSON，不要任何前言、解释或额外文字。',
    'JSON Schema：',
    '{"summary":"1~2句完整陈述句，讲清本节针对什么问题与核心结论(20~80字，禁止省略号、禁止复述课节标题)","keyPoints":[{"text":"一句完整、包含主谓宾的自足陈述句(8~40字，禁止省略号结尾、禁止复制字幕原话片段、禁止把课节标题当内容)","segId":"S01","quote":"对应原字幕关键词或短句(6~24字)"}],"outline":[{"name":"二级主题短语(<=16字，完整无省略号，收敛为2~5组)","points":[{"text":"完整知识点陈述(8~36字，无省略号)","segId":"S01","quote":"对应原字幕短句"}]}],"quiz":[{"question":"基于核心要点的完整自测问题？","answer":"1~2句完整简洁参考答案","segId":"S01","quote":"对应原字幕短句"}],"glossary":[{"term":"专有名词/缩写","definition":"一句完整的白话解释(12~55字，禁止以「课程提及：」开头，禁止省略号)","isCore":true,"importance":"本课重点","segId":"S01","quote":"对应原字幕短句"}]}',
    '约束：',
    isChunk
      ? '1. 当前为长课节的子分段：summary 用 1~2 句完整句概括本段核心结论；keyPoints 给 2~3 条（宁少不凑）；outline 给 1~3 组主题；quiz 给 1~2 题；glossary 抽取本段专有名词（无则空数组）；'
      : '1. keyPoints 严格 3~6 条（宁少不凑），每条必须是「一句完整、包含主谓宾的自足陈述句，8–40 字」，严禁以省略号（… / ...）结尾、严禁复制字幕口语原话片段、严禁把课节标题当内容；outline 收敛为 2~5 个二级主题，每组 2~6 条完整知识点；quiz 给 3~5 个检验是否学会的问题；glossary 抽取 0~6 个关键专有名词；',
    '2. glossary 每条释义必须为「一句完整的白话解释」，并用 isCore（布尔）与 importance（"本课重点" 或 "拓展提及"）明确标注是否属于本课重点；严禁使用「课程提及：」「课程提到：」等前缀，严禁出现省略号截断；',
    '3. 所有出处只能引用输入字幕中给出的分段编号 segId（例如 "S01"、"S02"），严禁自行估算或编造时间戳，严禁编造不存在的编号，并附带该段对应的原话关键词短句 quote（供程序自动核验，不得杜撰）；',
    '4. 严格忠于字幕原文，禁止编造原文未提及的概念或结论；禁止出现「其他/杂项」。',
  ].join('\n');
  const user = `课程：《${courseTitle || '当前课程'}》\n课节：第 ${section.sectionIndex || 1} 节《${section.title || '当前课节'}》${chunkHint}\n\n带编号字幕分段：\n${transcript}`;
  return { system, user };
}

export function buildSectionChunkAggregationPrompt(courseTitle, section, chunkPayloads) {
  const formatRef = p => (p?.segId ? `[${p.segId}]` : (p?.timestamp ? `(${p.timestamp})` : ''));
  const digest = chunkPayloads.map((c, idx) => {
    const pts = (c.keyPoints || []).map(p => `${p.text}${formatRef(p)}`).join('；');
    const topics = (c.outline || []).map(t => `${t.name}: ${(t.points || []).map(p => `${p.text}${formatRef(p)}`).join('、')}`).join(' | ');
    return `分段${idx + 1} 摘要：${c.summary || ''}\n  要点：${pts}\n  主题：${topics}`;
  }).join('\n');
  const system = [
    '你是课程学习卡片聚合助手。下面是一节较长课程各个分段的初步提炼结果，请合并重复知识点并收敛为一份完整、易速览的单节学习 JSON（不要任何额外说明）。',
    'JSON Schema：{"summary":"整节1~2句完整核心结论(20~80字，禁止省略号与标题复述)","keyPoints":[{"text":"一句完整、包含主谓宾的自足陈述句(8~40字，禁止省略号/原话片段/标题复述)","segId":"S01","quote":"对应原话短句"}],"outline":[{"name":"二级主题(<=16字，完整无省略号，收敛为3~5组)","points":[{"text":"完整知识点陈述(8~36字，无省略号)","segId":"S01","quote":"对应原话短句"}]}],"quiz":[{"question":"完整自测问题？","answer":"完整简洁参考答案","segId":"S01","quote":"对应原话短句"}],"glossary":[{"term":"术语","definition":"一句完整白话解释(禁止「课程提及：」前缀与省略号)","isCore":true,"importance":"本课重点","segId":"S01","quote":"对应原话短句"}]}',
    '要求：keyPoints 严格 3~6 条（宁少不凑），合并同类要点；quiz 收敛为 3~5 题；glossary 标注 isCore 与 importance（"本课重点" 或 "拓展提及"）；所有出处只引用输入中已有的分段编号 segId（如 "S01"），严禁编造编号或时间戳；所有字段严禁以省略号结尾。',
  ].join('\n');
  return { system, user: `课程：《${courseTitle}》\n课节：《${section.title}》\n\n各分段结果：\n${digest}` };
}

export function buildCourseAggregationPrompt(courseTitle, sectionTrees) {
  const formatRef = p => (p?.segId ? `[${p.segId}]` : (p?.timestamp ? `(${p.timestamp})` : ''));
  const digest = sectionTrees.map(sec => {
    const kps = (sec.keyPoints || []).slice(0, 4).map(p => `${p.text}${formatRef(p)}`).join('；');
    const lines = (sec.outline || sec.topics || []).map(t => `  - ${t.name}: ${(t.points || []).map(p => `${p.text}${formatRef(p)}`).join('；')}`);
    return `课节ID=${sec.sectionId} 《${sec.title}》\n  一句话概览：${sec.summary || ''}\n  核心要点：${kps}\n${lines.join('\n')}`;
  }).join('\n');
  const system = [
    '你是课程知识体系聚合助手。下面是一门课各课节的提炼结果，请输出整门课级总览与去重后的知识地图 JSON（只输出 JSON）。',
    'JSON 格式：{"overview":"1~2句完整陈述句讲清整门课核心问题与关键结论(25~90字，禁止罗列课节标题充数，禁止省略号)","keyPoints":[{"text":"一句完整、包含主谓宾的自足陈述句(8~40字，禁止省略号/原话片段/标题复述)","sectionId":"原sectionId","segId":"S01","quote":"对应原话短句"}],"sections":[{"sectionId":"原sectionId","summary":"该节完整核心结论(禁止省略号)","outline":[{"name":"二级主题(无省略号)","points":[{"text":"完整知识点陈述(无省略号)","segId":"S01","quote":"对应原话短句"}]}]}]}',
    '要求：全课 keyPoints 选 3~6 条（宁少不凑），同一知识点在不同课节重复出现时必须合并去重；所有出处只引用输入中出现的原 sectionId 与分段编号 segId（如 "S01"），严禁编造编号或时间戳；所有输出字段严禁以省略号结尾。',
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

function wdKaiResolveItemCitation(rawItem, claimText, verifyOpts = {}) {
  const hasRef = Boolean(
    rawItem && typeof rawItem === 'object' && (
      rawItem.segId !== undefined && rawItem.segId !== null && rawItem.segId !== ''
      || rawItem.seg_id !== undefined && rawItem.seg_id !== null && rawItem.seg_id !== ''
      || rawItem.segmentId !== undefined && rawItem.segmentId !== null && rawItem.segmentId !== ''
      || rawItem.ref !== undefined && rawItem.ref !== null && rawItem.ref !== ''
      || rawItem.time !== undefined && rawItem.time !== null && rawItem.time !== ''
      || rawItem.timestamp !== undefined && rawItem.timestamp !== null && rawItem.timestamp !== ''
      || rawItem.seconds !== undefined && rawItem.seconds !== null && rawItem.seconds !== ''
    ),
  );
  if (!hasRef) {
    return { seconds: null, timestamp: '', segId: null, refKey: null, citationStatus: 'none', citation: null };
  }
  const segmentIndex = verifyOpts.segmentIndex || null;
  if (segmentIndex) {
    const verified = verifyCitation(rawItem, segmentIndex, {
      claimText,
      sectionId: rawItem.sectionId || verifyOpts.sectionId,
      similarityThreshold: verifyOpts.similarityThreshold,
      durationSec: verifyOpts.durationSec,
    });
    return {
      seconds: verified.verified ? verified.seconds : null,
      timestamp: verified.verified ? verified.timestamp : '',
      segId: verified.segId || null,
      refKey: verified.refKey || null,
      citationStatus: verified.status,
      citation: verified,
    };
  }
  // Standalone normalization without segment table (fallback parse only)
  const normId = normalizeSegmentId(rawItem.segId ?? rawItem.seg_id ?? rawItem.segmentId ?? rawItem.ref);
  const sec = parseTimestampToSeconds(rawItem.time ?? rawItem.timestamp ?? rawItem.seconds);
  return {
    seconds: sec === null ? null : Math.floor(sec),
    timestamp: sec === null ? '' : formatTimestamp(sec),
    segId: normId?.segId || null,
    refKey: normId ? `${rawItem.sectionId || verifyOpts.sectionId || 'current'}#${normId.segId}` : null,
    citationStatus: normId || sec !== null ? 'unverified' : 'none',
    citation: null,
  };
}

function wdKaiNormalizePoint(pt, verifyOpts = {}) {
  if (typeof pt === 'string') {
    const text = sanitizeCompleteText(pt, { maxLen: 60, allowShort: true, stripPrefixes: true });
    return text ? { text, seconds: null, timestamp: '' } : null;
  }
  if (!pt || typeof pt !== 'object') return null;
  const rawText = String(pt.text || pt.point || pt.content || pt.title || pt.summary || '').trim();
  const text = sanitizeCompleteText(rawText, { maxLen: 60, allowShort: true, stripPrefixes: true });
  if (!text) return null;
  const cite = wdKaiResolveItemCitation(pt, text, verifyOpts);
  const sectionId = pt.sectionId ? String(pt.sectionId) : (cite.citation?.sectionId && verifyOpts.segmentIndex?.isCourseIndex ? cite.citation.sectionId : undefined);
  return {
    text,
    seconds: cite.seconds,
    timestamp: cite.timestamp,
    ...(cite.segId ? { segId: cite.segId } : {}),
    ...(cite.refKey ? { refKey: cite.refKey } : {}),
    ...(cite.citationStatus !== 'none' ? { citationStatus: cite.citationStatus } : {}),
    ...(cite.citation ? { citation: cite.citation } : {}),
    ...(sectionId ? { sectionId } : {}),
  };
}

function wdKaiNormalizeOutline(rawTopics, verifyOpts = {}) {
  if (!Array.isArray(rawTopics)) return [];
  const topics = [];
  for (const item of rawTopics) {
    if (!item || typeof item !== 'object') continue;
    const rawName = String(item.name || item.title || item.topic || item.chapter || '').trim();
    const name = sanitizeCompleteText(rawName, { maxLen: 36, allowShort: true, stripPrefixes: true });
    const rawPoints = Array.isArray(item.points) ? item.points
      : Array.isArray(item.items) ? item.items
      : Array.isArray(item.children) ? item.children : [];
    const points = rawPoints.map(pt => wdKaiNormalizePoint(pt, verifyOpts)).filter(Boolean);
    if (name && points.length) topics.push({ name, points });
    else if (name) topics.push({ name, points: [{ text: name, seconds: null, timestamp: '' }] });
  }
  return topics;
}

function wdKaiNormalizeQuiz(rawQuiz, verifyOpts = {}) {
  if (!Array.isArray(rawQuiz)) return [];
  const items = [];
  for (const q of rawQuiz) {
    if (!q || typeof q !== 'object') continue;
    const question = sanitizeCompleteText(q.question || q.q || q.prompt || '', { maxLen: 120, allowShort: true, stripPrefixes: true });
    const answer = sanitizeCompleteText(q.answer || q.a || q.explanation || '', { maxLen: 220, allowShort: true, stripPrefixes: true });
    if (!question || !answer) continue;
    const cite = wdKaiResolveItemCitation(q, `${question} ${answer}`, verifyOpts);
    items.push({
      question,
      answer,
      seconds: cite.seconds,
      timestamp: cite.timestamp,
      ...(cite.segId ? { segId: cite.segId } : {}),
      ...(cite.refKey ? { refKey: cite.refKey } : {}),
      ...(cite.citationStatus !== 'none' ? { citationStatus: cite.citationStatus } : {}),
      ...(cite.citation ? { citation: cite.citation } : {}),
    });
  }
  return items.slice(0, 6);
}

function wdKaiNormalizeGlossary(rawGlossary, verifyOpts = {}) {
  if (!Array.isArray(rawGlossary)) return [];
  const seen = new Set();
  const items = [];
  for (const g of rawGlossary) {
    if (!g || typeof g !== 'object') continue;
    const term = sanitizeCompleteText(g.term || g.name || g.word || g.concept || '', { maxLen: 32, allowShort: true, stripPrefixes: true });
    const definition = sanitizeCompleteText(g.definition || g.desc || g.explain || g.meaning || '', { maxLen: 80, allowShort: true, stripPrefixes: true });
    if (!term || !definition || seen.has(term)) continue;
    seen.add(term);
    const cite = wdKaiResolveItemCitation(g, `${term} ${definition}`, verifyOpts);
    const rawImportance = String(g.importance || g.level || g.priority || '').trim();
    const explicitCore = typeof g.isCore === 'boolean' ? g.isCore
      : typeof g.is_core === 'boolean' ? g.is_core
      : typeof g.core === 'boolean' ? g.core
      : typeof g.isKey === 'boolean' ? g.isKey : null;
    const inferredCore = explicitCore !== null
      ? explicitCore
      : (rawImportance ? /重点|核心|必学|关键/u.test(rawImportance) : null);
    const importance = inferredCore === true ? '本课重点'
      : inferredCore === false ? '拓展提及'
      : (rawImportance && !/省略/u.test(rawImportance) ? rawImportance : '');
    items.push({
      term,
      definition,
      ...(inferredCore !== null ? { isCore: inferredCore } : {}),
      ...(importance ? { importance } : {}),
      seconds: cite.seconds,
      timestamp: cite.timestamp,
      ...(cite.segId ? { segId: cite.segId } : {}),
      ...(cite.refKey ? { refKey: cite.refKey } : {}),
      ...(cite.citationStatus !== 'none' ? { citationStatus: cite.citationStatus } : {}),
      ...(cite.citation ? { citation: cite.citation } : {}),
    });
  }
  return items.slice(0, 8);
}

export function normalizeSectionStudyPayload(data, options = {}) {
  if (!data || typeof data !== 'object') throw new Error('模型返回结构无效');
  const sectionTitle = String(options.sectionTitle || '').replace(/^第\s*\d+\s*[章节讲课]\s*/u, '').trim();
  const isTitleCopy = txt => Boolean(sectionTitle && sectionTitle.length >= 4 && computeTextSimilarity(txt, sectionTitle) >= 0.85);
  const segmentIndex = options.segmentIndex
    || (Array.isArray(options.segments) && options.segments.length ? buildSegmentIndex(options.segments, { sectionId: options.sectionId, durationSec: options.durationSec }) : null);
  const verifyOpts = {
    segmentIndex,
    sectionId: options.sectionId || segmentIndex?.sectionId || 'current',
    similarityThreshold: options.similarityThreshold,
    durationSec: options.durationSec,
  };
  const outline = wdKaiNormalizeOutline(data.outline ?? data.topics ?? data.chapters, verifyOpts);
  const rawKeyPoints = Array.isArray(data.keyPoints) ? data.keyPoints
    : Array.isArray(data.key_points) ? data.key_points
    : Array.isArray(data.highlights) ? data.highlights
    : Array.isArray(data.takeaways) ? data.takeaways : [];
  const normalizedKps = rawKeyPoints.map(kp => wdKaiNormalizePoint(kp, verifyOpts)).filter(Boolean);
  const nonTitleKps = normalizedKps.filter(kp => !isTitleCopy(kp.text));
  const kpSource = nonTitleKps.length ? nonTitleKps : normalizedKps;
  const keyPoints = [];
  for (const kp of kpSource) {
    if (keyPoints.some(existing => computeTextSimilarity(existing.text, kp.text) >= 0.72)) continue;
    keyPoints.push(kp);
    if (keyPoints.length >= 6) break;
  }
  const quiz = wdKaiNormalizeQuiz(data.quiz ?? data.questions ?? data.qa ?? data.selfCheck, verifyOpts);
  const glossary = wdKaiNormalizeGlossary(data.glossary ?? data.terms ?? data.concepts, verifyOpts);
  let summary = sanitizeCompleteText(data.summary || data.oneLineSummary || data.overview || '', { maxLen: 120, allowShort: true, stripPrefixes: true });

  if (!outline.length && !keyPoints.length && !summary) {
    throw new Error('模型未返回有效的完整摘要、要点或大纲内容');
  }
  if (!keyPoints.length && outline.length) {
    for (const topic of outline) {
      const first = topic.points[0];
      if (first && !keyPoints.some(k => computeTextSimilarity(k.text, first.text) >= 0.72)) {
        keyPoints.push({ ...first });
      }
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
  const { content, channel } = await invokeAiChat({
    settings,
    messages,
    temperature: 0.2,
    gmRequest,
    fetchFn,
    signal,
    timeoutMs,
  });
  return { data: parseStrictJsonContent(content), channel };
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
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: '未配置 API Key，当前展示本地摘要（未使用 AI）。' });
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
    validateAiEndpoint(settings);
  } catch (err) {
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: `AI 配置无效（${err.message}），已自动降级为本地摘要。` });
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
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: '未填写模型名，已自动降级为本地摘要。' });
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
    const rawSegments = Array.isArray(sec.segments) && sec.segments.length
      ? sec.segments
      : cleanAndSegmentCues(sec.cues || [], { sectionId: sec.sectionId || 'current' }).segments;
    const segments = assignStableSegmentIds(rawSegments, sec.sectionId || 'current');
    const secWithSegs = { ...sec, segments };
    const secSegmentIndex = buildSegmentIndex(secWithSegs);
    const zeroSec = buildZeroAiSectionTree(secWithSegs, highlights);

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
      const prompt = buildSectionPrompt(courseData.title, secWithSegs, chunks[c], { index: c + 1, total: chunks.length });
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
        chunkPayloads.push(normalizeSectionStudyPayload(data, {
          sectionTitle: sec.title,
          sectionId: sec.sectionId || 'current',
          segmentIndex: secSegmentIndex,
          similarityThreshold: options.similarityThreshold,
        }));
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
            const aggPrompt = buildSectionChunkAggregationPrompt(courseData.title, secWithSegs, chunkPayloads);
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
            finalPayload = normalizeSectionStudyPayload(data, {
              sectionTitle: sec.title,
              sectionId: sec.sectionId || 'current',
              segmentIndex: secSegmentIndex,
              similarityThreshold: options.similarityThreshold,
            });
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
        durationSec: secSegmentIndex.maxEndSec,
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
      const failReason = sectionError || 'AI 解析失败';
      failedSections.push({ sectionId: sec.sectionId, title: sec.title, reason: failReason });
      warnings.push(`课节「${sec.title}」AI 解读失败（${failReason}），已降级为本地摘要`);
      resultSections.push({ ...zeroSec, fallbackReason: failReason });
    }
  }

  const skippedSummary = skippedNoSubtitleSections.length
    ? `批量处理已跳过 ${skippedNoSubtitleSections.length} 个无字幕课节：${skippedNoSubtitleSections.map(s => `《${s.title}》`).join('、')}。`
    : '';
  if (skippedSummary && !warnings.includes(skippedSummary)) warnings.push(skippedSummary);

  // If NO section succeeded with AI at all, cleanly return full zero-AI fallback with reason
  if (aiSuccessCount === 0) {
    const reason = firstError
      ? `AI 解读失败（${firstError}），已自动降级为本地摘要。`
      : '本课无字幕：当前范围暂无可用 AI 字幕正文，无法生成时间轴导览、问答与出题。';
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: reason });
    zero.tree.failedSections = failedSections;
    // Keep non-duplicate course warnings without repeating identical per-section error lines
    const nonRedundantWarnings = warnings.filter(w => !firstError || !w.includes(firstError));
    if (nonRedundantWarnings.length) zero.tree.warnings = [...new Set([...zero.tree.warnings, ...nonRedundantWarnings])];
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
    : captionedResultSections.filter(s => s.summary).map(s => s.summary).slice(0, 2).join('；');
  let courseKeyPoints = [];
  for (const sec of captionedResultSections) {
    if (sec.keyPoints?.[0]) {
      const kp = sec.keyPoints[0];
      if (!courseKeyPoints.some(existing => computeTextSimilarity(existing.text, kp.text) >= 0.55)) {
        courseKeyPoints.push({ ...kp, sectionId: sec.sectionId || 'current', sectionIndex: sec.sectionIndex || 1, sectionTitle: sec.title });
      }
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
      const cleanOverview = sanitizeCompleteText(data.overview || '', { maxLen: 140, allowShort: true, stripPrefixes: true });
      if (cleanOverview) overview = cleanOverview;
      const courseSegIndex = buildCourseSegmentIndex(resultSections);
      const rawCourseKps = Array.isArray(data.keyPoints)
        ? data.keyPoints.map(kp => wdKaiNormalizePoint(kp, { segmentIndex: courseSegIndex, similarityThreshold: options.similarityThreshold })).filter(Boolean)
        : [];
      const dedupCourseKps = [];
      for (const kp of rawCourseKps) {
        if (dedupCourseKps.some(existing => computeTextSimilarity(existing.text, kp.text) >= 0.55)) continue;
        const matchedSec = kp.sectionId ? resultSections.find(s => String(s.sectionId) === String(kp.sectionId)) : null;
        dedupCourseKps.push({
          ...kp,
          ...(matchedSec ? { sectionIndex: matchedSec.sectionIndex || 1, sectionTitle: matchedSec.title } : {}),
        });
        if (dedupCourseKps.length >= 6) break;
      }
      if (dedupCourseKps.length) courseKeyPoints = dedupCourseKps;
      if (Array.isArray(data.sections)) {
        const byId = new Map(data.sections.map(s => [String(s?.sectionId || ''), s]));
        for (const sec of resultSections) {
          if (sec.mode !== 'ai') continue;
          const updated = byId.get(String(sec.sectionId || ''));
          const cleanSecSummary = sanitizeCompleteText(updated?.summary || '', { maxLen: 120, allowShort: true, stripPrefixes: true });
          if (cleanSecSummary) sec.summary = cleanSecSummary;
          const secSegIdx = courseSegIndex.resolveSection(sec.sectionId);
          const nextOutline = wdKaiNormalizeOutline(updated?.outline ?? updated?.topics, {
            segmentIndex: secSegIdx,
            sectionId: sec.sectionId,
            similarityThreshold: options.similarityThreshold,
          });
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
    fallbackReason: failedSections.length ? `部分课节（${failedSections.length} 节）AI 解读失败，已局部降级为本地摘要。` : '',
    failedSections,
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

export function createKnowledgeService({ win, pageWin = win, controller, adapter, gmStorage = undefined, gmRequest, fetchFn } = {}) {
  if (gmStorage !== undefined) bindWindowGmStorage(win, gmStorage);
  ensureStorageMigrated(win, { gmStorage });
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
  let modelsAbort = null;
  let testAbort = null;
  let lastCourseData = null;
  const settingsListeners = new Set();
  const emitSettingsChange = nextSettings => {
    for (const fn of settingsListeners) {
      try { fn(nextSettings); } catch { /* ignore listener error */ }
    }
  };

  const findCachedForData = (data, preferredScope = null, sectionId = null, matchSettings = null) => {
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
      if (!hit?.usedAi) continue;
      if (matchSettings) {
        const sameProvider = !hit.provider || !matchSettings.provider || hit.provider === matchSettings.provider;
        const sameModel = !hit.model || !matchSettings.model || hit.model === matchSettings.model;
        if (!sameProvider || !sameModel) continue;
      }
      return { key, hit };
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
    getSettings: () => loadAiSettings(win, { gmStorage }),
    saveSettings: next => {
      const res = saveAiSettings(win, next, { gmStorage });
      if (res.ok) emitSettingsChange(res.settings);
      return res;
    },
    clearApiKey: () => {
      const res = clearAiApiKey(win, { gmStorage });
      if (res.ok) emitSettingsChange(loadAiSettings(win, { gmStorage }));
      return res;
    },
    onSettingsChange: fn => {
      if (typeof fn !== 'function') return () => {};
      settingsListeners.add(fn);
      return () => { settingsListeners.delete(fn); };
    },
    clearCache: key => clearKnowledgeCache(win, key),
    getStorageStatus: () => getStorageStatus(win, { gmStorage }),
    getMigrationReceipt: () => readMigrationReceipt(win, { gmStorage }),
    migrateStorage: opts => migrateLegacyStorage(win, { gmStorage, ...(opts || {}) }),
    abortFetchModels() {
      try { modelsAbort?.abort?.(); } catch { /* ignore */ }
      modelsAbort = null;
    },
    abortTestConnection() {
      try { testAbort?.abort?.(); } catch { /* ignore */ }
      testAbort = null;
    },
    async fetchModels(overrideSettings = null, opts = {}) {
      this.abortFetchModels();
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      modelsAbort = ac;
      const baseCfg = loadAiSettings(win, { gmStorage });
      const effectiveCfg = overrideSettings ? { ...baseCfg, ...overrideSettings } : baseCfg;
      try {
        return await fetchAiModels(effectiveCfg, {
          gmRequest,
          fetchFn: resolveFetch(),
          signal: opts.signal || ac?.signal,
          timeoutMs: opts.timeoutMs,
        });
      } finally {
        if (modelsAbort === ac) modelsAbort = null;
      }
    },
    async testConnection(overrideSettings = null, opts = {}) {
      this.abortTestConnection();
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      testAbort = ac;
      const baseCfg = loadAiSettings(win, { gmStorage });
      const effectiveCfg = overrideSettings ? { ...baseCfg, ...overrideSettings } : baseCfg;
      try {
        return await testAiConnection(effectiveCfg, {
          gmRequest,
          fetchFn: resolveFetch(),
          signal: opts.signal || ac?.signal,
          timeoutMs: opts.timeoutMs,
        });
      } finally {
        if (testAbort === ac) testAbort = null;
      }
    },
    abort() {
      try { activeAbort?.abort?.(); } catch { /* ignore */ }
      activeAbort = null;
      this.abortFetchModels();
      this.abortTestConnection();
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
      try { activeAbort?.abort?.(); } catch { /* ignore */ }
      activeAbort = null;
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

        const currentSettings = loadAiSettings(win, { gmStorage });
        // Instant open from localStorage cache when available (when actively running AI, require model/provider match so model switch takes effect immediately)
        const targetScopeHasSubtitle = effectiveScope === 'section'
          ? Boolean(data.sections.find(s => s.sectionId === focusSecId)?.hasSubtitle !== false && data.captionedSections > 0)
          : data.captionedSections > 0;
        if (!forceRefresh && targetScopeHasSubtitle && (useAi || preferCacheOnOpen)) {
          const cached = findCachedForData(
            data,
            useAi ? effectiveScope : (sectionId ? 'section' : null),
            focusSecId,
            useAi ? currentSettings : null,
          );
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

        const settings = currentSettings;
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
    seek({ sectionId, seconds, unmute = false, expectedCourseId = null }) {
      const state = controller?.getState?.();
      const queueRunning = Boolean(state && ['running', 'preparing', 'waiting'].includes(state.status));
      const autoMuteEnabled = state?.automation?.mute !== false;
      return seekCourseTime({
        win,
        pageWin,
        adapter,
        sectionId,
        seconds,
        queueRunning,
        unmute,
        autoMuteEnabled,
        expectedCourseId: expectedCourseId || lastCourseData?.courseId || null,
      });
    },
  };
}
