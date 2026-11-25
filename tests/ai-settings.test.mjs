import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  WD_AI_PROVIDERS,
  getAiProviderPreset,
  resolveAiProtocol,
  buildModelsUrl,
  buildChatEndpointUrl,
  redactAiSecret,
  loadAiSettings,
  saveAiSettings,
  fetchAiModels,
  testAiConnection,
  createKnowledgeService,
} from '../src/knowledge-ai.js';
import { askSectionQuestion, generateSectionQuiz } from '../src/knowledge-tutor.js';
import { createPanel } from '../src/panel.js';

function createPanelHarness({ gmRequest = null, fetchFn = null, gmStorage = undefined } = {}) {
  const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/study/course/detail/c-ai/6' });
  const win = dom.window;
  const state = {
    status: 'paused',
    message: '已暂停',
    unavailable: false,
    window: { start: '09:00', end: '24:00' },
    tasks: [],
    activeTaskId: null,
    currentCourseId: null,
    currentSectionTitle: '',
    candidates: [],
    draft: null,
    problem: null,
  };
  const controller = {
    getState: () => structuredClone(state),
    subscribe: () => () => {},
    diagnose: () => ({ kind: 'course' }),
  };
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
              { startTime: 4, endTime: 12, text: '零信任网络架构强调永不信任始终验证原则。' },
              { startTime: 14, endTime: 24, text: '微隔离通过细粒度策略缩小横向移动攻击面。' },
            ],
          }],
        },
      }),
    },
  };
  const kg = createKnowledgeService({ win, pageWin, controller, gmStorage, gmRequest, fetchFn });
  kg.mapOptions = { skipCdn: true };
  const panel = createPanel(win, controller, '0.1.0-beta.22', kg);
  panel.open();
  const root = win.document.getElementById('wangda-assistant').shadowRoot;
  root.querySelector('[data-settings]').open = true;
  const flush = async (ticks = 40) => {
    for (let i = 0; i < ticks; i += 1) await Promise.resolve();
  };
  const close = () => {
    panel.destroy();
    dom.window.close();
  };
  return { dom, win, kg, panel, root, flush, close };
}

test('Provider 预设覆盖常见服务商、标注跨域可达性，且多协议端点构建正确且不泄露 Key 到 URL', () => {
  const ids = WD_AI_PROVIDERS.map(p => p.id);
  for (const expected of ['openai', 'deepseek', 'dashscope', 'moonshot', 'zhipu', 'openrouter', 'siliconflow', 'gemini', 'anthropic', 'custom']) {
    assert.ok(ids.includes(expected), `缺少预置 provider: ${expected}`);
  }
  const zhipu = getAiProviderPreset('zhipu');
  assert.equal(zhipu.corsMode, 'relay-needed');
  assert.match(zhipu.note, /CORS|GM|中转/u);

  const openai = getAiProviderPreset('openai');
  assert.equal(openai.corsMode, 'proxy-or-relay');
  assert.match(openai.note, /中转|代理/u);

  const deepseek = getAiProviderPreset('deepseek');
  assert.equal(deepseek.corsMode, 'direct');

  // Protocol detection (including backward-compatible Gemini /openai URL)
  assert.equal(resolveAiProtocol({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }), 'gemini');
  assert.equal(resolveAiProtocol({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }), 'openai');
  assert.equal(resolveAiProtocol({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }), 'anthropic');
  assert.equal(resolveAiProtocol({ provider: 'anthropic', baseUrl: 'https://relay.example.com/v1/chat/completions' }), 'openai');

  // Models URL normalization
  assert.equal(buildModelsUrl('https://api.deepseek.com/v1', 'openai'), 'https://api.deepseek.com/v1/models');
  assert.equal(buildModelsUrl('https://relay.example.com/v1/chat/completions', 'openai'), 'https://relay.example.com/v1/models');
  const geminiModelsUrl = buildModelsUrl('https://generativelanguage.googleapis.com/v1beta?key=secret-should-strip', 'gemini');
  assert.equal(geminiModelsUrl, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200');
  assert.doesNotMatch(geminiModelsUrl, /secret-should-strip/u);
  assert.equal(buildModelsUrl('https://api.anthropic.com/v1', 'anthropic'), 'https://api.anthropic.com/v1/models');
  assert.equal(buildModelsUrl('https://api.anthropic.com', 'anthropic'), 'https://api.anthropic.com/v1/models');

  // Chat endpoint normalization
  assert.equal(
    buildChatEndpointUrl('https://generativelanguage.googleapis.com/v1beta', 'gemini', 'models/gemini-2.5-flash'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  );
  assert.equal(
    buildChatEndpointUrl('https://api.anthropic.com/v1', 'anthropic', 'claude-sonnet-4-20250514'),
    'https://api.anthropic.com/v1/messages',
  );

  // Secret redaction
  const redacted = redactAiSecret('Incorrect API key provided: sk-test-secret-99998888 in header', 'sk-test-secret-99998888');
  assert.doesNotMatch(redacted, /sk-test-secret-99998888/u);
  assert.match(redacted, /\[已脱敏\]/u);
});

test('fetchAiModels 覆盖 OpenAI/Gemini/Anthropic 真实端点解析、错误分类、Key 脱敏与可取消', async () => {
  // 1. OpenAI-compatible GET /models via GM_xmlhttpRequest (default priority)
  const gmCalls = [];
  const gmOk = opts => {
    gmCalls.push(opts);
    queueMicrotask(() => opts.onload({
      status: 200,
      responseText: JSON.stringify({
        data: [
          { id: 'text-embedding-3-small', owned_by: 'openai' },
          { id: 'deepseek-reasoner', owned_by: 'deepseek' },
          { id: 'deepseek-chat', owned_by: 'deepseek' },
          { id: 'deepseek-chat', owned_by: 'deepseek' },
        ],
      }),
    }));
    return { abort() {} };
  };
  const rOpenAi = await fetchAiModels(
    { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-demo-fake-key-1234', transport: 'auto' },
    { gmRequest: gmOk },
  );
  assert.equal(rOpenAi.ok, true);
  assert.equal(rOpenAi.channel, 'gm');
  assert.equal(gmCalls[0].method, 'GET');
  assert.equal(gmCalls[0].url, 'https://api.deepseek.com/v1/models');
  assert.equal(gmCalls[0].headers.Authorization, 'Bearer sk-demo-fake-key-1234');
  assert.equal(rOpenAi.models.length, 3, '应自动去重');
  assert.equal(rOpenAi.models[0].id, 'deepseek-chat', '预设默认对话模型优先排前');
  assert.equal(rOpenAi.models.at(-1).id, 'text-embedding-3-small', '非对话模型排在末尾');
  assert.equal(rOpenAi.models.at(-1).nonChat, true);

  // 2. Gemini native GET /v1beta/models with x-goog-api-key
  let geminiReq = null;
  const rGemini = await fetchAiModels(
    { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIzaFakeGeminiKey123456', transport: 'fetch' },
    {
      fetchFn: async (url, init) => {
        geminiReq = { url, init };
        return {
          status: 200,
          text: async () => JSON.stringify({
            models: [
              { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
            ],
          }),
        };
      },
    },
  );
  assert.equal(rGemini.ok, true);
  assert.equal(geminiReq.url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200');
  assert.equal(geminiReq.init.headers['x-goog-api-key'], 'AIzaFakeGeminiKey123456');
  assert.deepEqual(rGemini.models.map(m => m.id), ['gemini-2.5-flash', 'gemini-2.5-pro']);
  assert.equal(rGemini.models[0].label, 'Gemini 2.5 Flash');

  // 3. Anthropic native GET /v1/models with x-api-key + version + browser-access header
  let anthropicReq = null;
  const rAnthropic = await fetchAiModels(
    { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-fake-123456', transport: 'fetch' },
    {
      fetchFn: async (url, init) => {
        anthropicReq = { url, init };
        return {
          status: 200,
          text: async () => JSON.stringify({
            data: [
              { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' },
              { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
            ],
          }),
        };
      },
    },
  );
  assert.equal(rAnthropic.ok, true);
  assert.equal(anthropicReq.url, 'https://api.anthropic.com/v1/models');
  assert.equal(anthropicReq.init.headers['x-api-key'], 'sk-ant-fake-123456');
  assert.equal(anthropicReq.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(anthropicReq.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(rAnthropic.models[0].id, 'claude-sonnet-4-20250514');

  // 4. Error classification: 401 (with secret redaction), 403, 404, 429, Gemini 400 invalid key, CORS/network
  const secretKey = 'sk-must-never-leak-987654';
  const r401 = await fetchAiModels(
    { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: secretKey, transport: 'fetch' },
    { fetchFn: async () => ({ status: 401, text: async () => JSON.stringify({ error: { message: `Incorrect API key provided: ${secretKey}` } }) }) },
  );
  assert.equal(r401.ok, false);
  assert.equal(r401.category, 'invalid_key');
  assert.equal(r401.statusCode, 401);
  assert.doesNotMatch(r401.message, /sk-must-never-leak-987654/u, '错误提示绝不能泄露明文 Key');

  const r403 = await fetchAiModels(
    { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test-403', transport: 'fetch' },
    { fetchFn: async () => ({ status: 403, text: async () => '{"error":{"message":"permission denied"}}' }) },
  );
  assert.equal(r403.category, 'invalid_key');
  assert.equal(r403.statusCode, 403);
  assert.match(r403.message, /无权限|403/u);

  const r404 = await fetchAiModels(
    { provider: 'custom', baseUrl: 'https://relay.example.com/wrong', apiKey: 'sk-test-404', transport: 'fetch' },
    { fetchFn: async () => ({ status: 404, text: async () => '{"error":{"message":"Not Found"}}' }) },
  );
  assert.equal(r404.category, 'endpoint_not_found');
  assert.equal(r404.statusCode, 404);
  assert.match(r404.hint, /Base URL|手动填写/u);

  const r429 = await fetchAiModels(
    { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test-429', transport: 'fetch' },
    { fetchFn: async () => ({ status: 429, text: async () => '{"error":{"message":"Rate limit reached"}}' }) },
  );
  assert.equal(r429.category, 'rate_limited');
  assert.equal(r429.statusCode, 429);

  const rGeminiBadKey = await fetchAiModels(
    { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'bad-gemini-key', transport: 'fetch' },
    { fetchFn: async () => ({ status: 400, text: async () => JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }) }) },
  );
  assert.equal(rGeminiBadKey.category, 'invalid_key');
  assert.equal(rGeminiBadKey.label, 'Key 无效');

  const rCors = await fetchAiModels(
    { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'sk-zhipu', transport: 'fetch' },
    { fetchFn: async () => { throw new TypeError('Failed to fetch'); } },
  );
  assert.equal(rCors.category, 'network_error');
  assert.equal(rCors.isCorsLikely, true);
  assert.match(rCors.message, /CORS|CSP/u);

  // 5. Cancellation via AbortController aborts underlying GM handle
  let gmAborted = false;
  const ac = new AbortController();
  const pending = fetchAiModels(
    { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-cancel', transport: 'gm' },
    {
      signal: ac.signal,
      gmRequest: () => ({ abort() { gmAborted = true; } }),
    },
  );
  ac.abort();
  const rCancelled = await pending;
  assert.equal(gmAborted, true);
  assert.equal(rCancelled.ok, false);
  assert.equal(rCancelled.aborted, true);
  assert.equal(rCancelled.category, 'aborted');
});

test('testAiConnection 覆盖极小请求、五类结果分类、耗时、多协议与未选模型退化说明', async () => {
  // 1. OpenAI minimal 1-token chat success
  let sentBody = null;
  const okOpenAi = await testAiConnection(
    { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-ok', transport: 'fetch' },
    {
      fetchFn: async (_url, init) => {
        sentBody = JSON.parse(init.body);
        return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
      },
    },
  );
  assert.equal(okOpenAi.ok, true);
  assert.equal(okOpenAi.category, 'ok');
  assert.equal(okOpenAi.statusLabel, '可用');
  assert.equal(okOpenAi.model, 'deepseek-chat');
  assert.ok(okOpenAi.latencyMs >= 1);
  assert.equal(sentBody.max_tokens, 1);

  // 2. Reasoning model 400 fallback to max_completion_tokens
  let attempts = 0;
  const okReasoning = await testAiConnection(
    { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'o3-mini', apiKey: 'sk-o3', transport: 'fetch' },
    {
      fetchFn: async (_url, init) => {
        attempts += 1;
        const body = JSON.parse(init.body);
        if (attempts === 1) {
          assert.equal(body.max_tokens, 1);
          return { status: 400, text: async () => '{"error":{"message":"Unsupported parameter: max_tokens is not supported with this model. Use max_completion_tokens instead."}}' };
        }
        assert.equal(body.max_completion_tokens, 16);
        assert.equal('temperature' in body, false);
        return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'hi' } }] }) };
      },
    },
  );
  assert.equal(okReasoning.ok, true);
  assert.equal(attempts, 2);

  // 3. Gemini native & Anthropic native minimal test
  let geminiTestUrl = '';
  const okGemini = await testAiConnection(
    { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', apiKey: 'g-key', transport: 'fetch' },
    {
      fetchFn: async (url, init) => {
        geminiTestUrl = url;
        const b = JSON.parse(init.body);
        assert.equal(b.generationConfig.maxOutputTokens, 1);
        return { status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }) };
      },
    },
  );
  assert.equal(okGemini.ok, true);
  assert.match(geminiTestUrl, /\/models\/gemini-2\.5-flash:generateContent$/u);

  let anthropicTestBody = null;
  const okAnthropic = await testAiConnection(
    { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', apiKey: 'a-key', transport: 'fetch' },
    {
      fetchFn: async (url, init) => {
        assert.equal(url, 'https://api.anthropic.com/v1/messages');
        anthropicTestBody = JSON.parse(init.body);
        return { status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }) };
      },
    },
  );
  assert.equal(okAnthropic.ok, true);
  assert.equal(anthropicTestBody.max_tokens, 1);

  // 4. Five failure buckets: invalid_key, model_not_found, rate_limited, network_error
  const badKey = await testAiConnection(
    { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-bad', transport: 'fetch' },
    { fetchFn: async () => ({ status: 401, text: async () => '{"error":{"message":"invalid api key"}}' }) },
  );
  assert.equal(badKey.ok, false);
  assert.equal(badKey.category, 'invalid_key');
  assert.equal(badKey.statusLabel, 'Key 无效');

  const missingModel = await testAiConnection(
    { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'non-existent-model', apiKey: 'sk-ok', transport: 'fetch' },
    { fetchFn: async () => ({ status: 404, text: async () => '{"error":{"message":"The model non-existent-model does not exist","code":"model_not_found"}}' }) },
  );
  assert.equal(missingModel.ok, false);
  assert.equal(missingModel.category, 'model_not_found');
  assert.equal(missingModel.statusLabel, '模型不存在');

  const rateLimited = await testAiConnection(
    { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-ok', transport: 'fetch' },
    { fetchFn: async () => ({ status: 429, text: async () => '{"error":{"message":"Too many requests"}}' }) },
  );
  assert.equal(rateLimited.ok, false);
  assert.equal(rateLimited.category, 'rate_limited');
  assert.equal(rateLimited.statusLabel, '限流');

  const netErr = await testAiConnection(
    { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: 'sk-ok', transport: 'fetch' },
    { fetchFn: async () => { throw new TypeError('Failed to fetch'); } },
  );
  assert.equal(netErr.ok, false);
  assert.equal(netErr.category, 'network_error');
  assert.equal(netErr.statusLabel, '网络不通');

  // 5. No model selected -> graceful degradation to endpoint + key check with explicit testedWhat / notTestedWhat
  const degraded = await testAiConnection(
    { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', apiKey: 'sk-or', transport: 'fetch' },
    {
      fetchFn: async url => {
        assert.equal(url, 'https://openrouter.ai/api/v1/models');
        return { status: 200, text: async () => JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini' }] }) };
      },
    },
  );
  assert.equal(degraded.ok, true);
  assert.equal(degraded.degradedScope, true);
  assert.equal(degraded.testedScope, 'endpoint');
  assert.match(degraded.testedWhat, /公开|模型列表/u);
  assert.match(degraded.notTestedWhat, /未测试|尚未选择模型/u);
});

test('设置页 AI 面板交互：Provider 联动、眼睛显隐、获取模型可搜索下拉、失败降级手动输入、测试连接状态流转与旧模型平滑兼容', async () => {
  let mode = 'models-ok';
  let slowCancelTriggered = false;
  const fakeFetch = async (url, init) => {
    if (mode === 'slow') {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          slowCancelTriggered = true;
          reject(new Error('aborted'));
        });
      });
    }
    if (mode === '401') return { status: 401, text: async () => '{"error":{"message":"Invalid API key"}}' };
    if (mode === '404') return { status: 404, text: async () => '{"error":{"message":"Not Found"}}' };
    if (mode === 'network') throw new TypeError('Failed to fetch');
    if (url.endsWith('/models')) {
      return {
        status: 200,
        text: async () => JSON.stringify({
          data: [
            { id: 'deepseek-chat' },
            { id: 'deepseek-reasoner' },
            { id: 'qwen-max' },
          ],
        }),
      };
    }
    if (mode === 'test-model-404') {
      return { status: 404, text: async () => '{"error":{"message":"model does not exist","code":"model_not_found"}}' };
    }
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'hi' } }] }) };
  };

  const h = createPanelHarness({ fetchFn: fakeFetch });
  try {
    const { win, root, flush } = h;
    // Strict shadowRoot constraints: no <svg>, no <textarea>, all buttons type=button
    assert.equal(root.querySelector('svg'), null);
    assert.equal(root.querySelector('textarea'), null);
    assert.ok([...root.querySelectorAll('button')].every(b => b.type === 'button'));

    // 1. Existing legacy manual model name preserved smoothly & directly testable
    saveAiSettings(win, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'legacy-hand-typed-v1', apiKey: 'sk-legacy', transport: 'fetch' });
    // Trigger reload into form by switching back and forth? Instead create a fresh panel below for legacy check, or verify here via open:
    const provSel = root.querySelector('[name="ai-provider"]');
    const urlInput = root.querySelector('[name="ai-base-url"]');
    const modelInput = root.querySelector('[name="ai-model"]');
    const keyInput = root.querySelector('[name="ai-api-key"]');

    // Password eye toggle works without any SVG
    const toggleKeyBtn = root.querySelector('[data-action="ai-toggle-key"]');
    assert.equal(keyInput.type, 'password');
    assert.equal(toggleKeyBtn.dataset.visible, 'false');
    toggleKeyBtn.click();
    assert.equal(keyInput.type, 'text');
    assert.equal(toggleKeyBtn.dataset.visible, 'true');
    toggleKeyBtn.click();
    assert.equal(keyInput.type, 'password');
    assert.equal(root.querySelector('svg'), null);

    // Provider switch updates baseUrl & CORS badge
    provSel.value = 'zhipu';
    provSel.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(urlInput.value, 'https://open.bigmodel.cn/api/paas/v4');
    assert.equal(root.querySelector('[data-ai-cors-card]').dataset.cors, 'relay-needed');
    assert.match(root.querySelector('[data-ai-cors-badge]').textContent, /中转|GM/u);

    provSel.value = 'custom';
    provSel.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(urlInput.value, '');
    assert.equal(root.querySelector('[data-ai-base-url-error]').hidden, false);

    // Switch back to deepseek + fill key
    provSel.value = 'deepseek';
    provSel.dispatchEvent(new win.Event('change', { bubbles: true }));
    keyInput.value = 'sk-ui-valid';
    keyInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    root.querySelector('[name="ai-transport"]').value = 'fetch';
    root.querySelector('[name="ai-transport"]').dispatchEvent(new win.Event('change', { bubbles: true }));

    // 2. Fetch models -> cancel while loading
    mode = 'slow';
    const fetchBtn = root.querySelector('[data-action="ai-fetch-models"]');
    const cancelFetchBtn = root.querySelector('[data-action="ai-fetch-models-cancel"]');
    fetchBtn.click();
    await flush(5);
    assert.equal(fetchBtn.disabled, true);
    assert.equal(cancelFetchBtn.hidden, false);
    cancelFetchBtn.click();
    await flush(30);
    assert.equal(slowCancelTriggered, true);
    assert.equal(fetchBtn.disabled, false);
    assert.equal(cancelFetchBtn.hidden, true);
    assert.match(root.querySelector('[data-ai-models-feedback]').textContent, /已取消/u);

    // 3. Fetch models success -> searchable dropdown opens -> filter & pick -> persists immediately
    mode = 'models-ok';
    fetchBtn.click();
    await flush(40);
    const dropdown = root.querySelector('[data-ai-model-dropdown]');
    assert.equal(dropdown.hidden, false);
    const search = root.querySelector('[data-ai-model-search]');
    search.value = 'reasoner';
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
    const visibleOpts = [...root.querySelectorAll('.ai-model-option')];
    assert.equal(visibleOpts.length, 1);
    assert.equal(visibleOpts[0].dataset.modelId, 'deepseek-reasoner');
    visibleOpts[0].click();
    assert.equal(modelInput.value, 'deepseek-reasoner');
    assert.equal(dropdown.hidden, true);
    assert.equal(loadAiSettings(win).model, 'deepseek-reasoner', '点选下拉模型后应立即同步保存');

    // 4. Test connection -> OK badge + latency + model name
    const testBtn = root.querySelector('[data-action="ai-test-connection"]');
    testBtn.click();
    await flush(40);
    assert.equal(root.querySelector('[data-ai-status-pill]').dataset.status, 'ok');
    assert.equal(root.querySelector('[data-ai-test-badge]').dataset.status, 'ok');
    assert.match(root.querySelector('[data-ai-test-result]').textContent, /可用.*deepseek-reasoner.*ms/su);

    // 5. Fetch models failure (401 / 404 / network) -> clear message + fallback manual input works
    for (const [m, expectRe] of [['401', /401|Key 无效/u], ['404', /404|路径/u], ['network', /CORS|CSP|网络/u]]) {
      mode = m;
      fetchBtn.click();
      await flush(40);
      const fb = root.querySelector('[data-ai-models-feedback]');
      assert.equal(fb.hidden, false);
      assert.match(fb.textContent, expectRe);
      const manualFallbackBtn = fb.querySelector('[data-action="ai-manual-fallback"]');
      assert.ok(manualFallbackBtn, '失败时应提供一键手动填写降级按钮');
      manualFallbackBtn.click();
      modelInput.value = `manual-${m}`;
      modelInput.dispatchEvent(new win.Event('change', { bubbles: true }));
      assert.equal(loadAiSettings(win).model, `manual-${m}`);
    }

    // 6. Test connection failure -> error badge + categorized reason
    mode = 'test-model-404';
    testBtn.click();
    await flush(40);
    assert.equal(root.querySelector('[data-ai-status-pill]').dataset.status, 'error');
    assert.match(root.querySelector('[data-ai-test-result]').textContent, /模型不存在/u);
    assert.ok([...root.querySelectorAll('button')].every(b => b.type === 'button'));
  } finally {
    h.close();
  }
});

test('旧手填模型名平滑回显并可直接测试连接，无需强制重选', async () => {
  const testedModels = [];
  const h = createPanelHarness({
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      testedModels.push(body.model);
      return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
    },
  });
  try {
    const { win, root, flush } = h;
    // Simulate pre-existing saved legacy config before panel loads
    h.panel.destroy();
    saveAiSettings(win, {
      provider: 'custom',
      baseUrl: 'https://legacy-relay.example.com/v1',
      model: 'my-old-custom-model-2025',
      apiKey: 'sk-old-user-key',
      transport: 'fetch',
    });
    const p2 = createPanel(win, { getState: () => ({ status: 'paused', message: '', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null }), subscribe: () => () => {}, diagnose: () => ({}) }, '0.1.0-beta.22', h.kg);
    p2.open();
    const r2 = win.document.getElementById('wangda-assistant').shadowRoot;
    r2.querySelector('[data-settings]').open = true;
    assert.equal(r2.querySelector('[name="ai-model"]').value, 'my-old-custom-model-2025');
    r2.querySelector('[data-action="ai-test-connection"]').click();
    await flush(40);
    assert.deepEqual(testedModels, ['my-old-custom-model-2025']);
    assert.equal(r2.querySelector('[data-ai-test-badge]').dataset.status, 'ok');
    p2.destroy();
  } finally {
    h.dom.window.close();
  }
});

test('全链路打通：设置页切换模型/Provider/Key 后，导览、问答、出题与强引用核验立即使用新配置与新协议', async () => {
  const requests = [];
  const gmMap = new Map();
  const gmStorage = {
    get: (k, def) => (gmMap.has(k) ? gmMap.get(k) : def),
    set: (k, v) => { gmMap.set(k, v); },
  };
  const fakeFetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, headers: init.headers, body });
    const isAnthropic = url.includes('/messages');
    const wrap = jsonObj => isAnthropic
      ? JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(jsonObj) }] })
      : JSON.stringify({ choices: [{ message: { content: JSON.stringify(jsonObj) } }] });
    const textBlob = JSON.stringify(body || {});
    if (textBlob.includes('出 4 道高质量自测题')) {
      return {
        status: 200,
        text: async () => wrap({
          questions: [{
            type: 'choice',
            question: '零信任网络架构的核心原则是什么？',
            options: ['A. 永不信任始终验证', 'B. 内网默认可信', 'C. 仅边界防护', 'D. 关闭认证'],
            correctIndex: 0,
            explanation: '依据 [S01] 说明，零信任强调永不信任始终验证。',
            segId: 'S01',
            quote: '零信任网络架构强调永不信任始终验证原则',
          }],
        }),
      };
    }
    if (textBlob.includes('课节级学习问答助教')) {
      return {
        status: 200,
        text: async () => wrap({
          answer: '零信任网络架构核心在于永不信任始终验证 [S01]。',
          citations: [{ segId: 'S01', quote: '零信任网络架构强调永不信任始终验证原则', note: '零信任定义' }],
        }),
      };
    }
    return {
      status: 200,
      text: async () => wrap({
        summary: '本节介绍零信任永不信任始终验证与微隔离策略。',
        keyPoints: [
          { text: '零信任网络架构强调永不信任始终验证原则。', segId: 'S01', quote: '零信任网络架构强调永不信任始终验证原则' },
          { text: '微隔离通过细粒度策略缩小横向移动攻击面。', segId: 'S02', quote: '微隔离通过细粒度策略缩小横向移动攻击面' },
        ],
        outline: [{ name: '零信任核心', points: [{ text: '永不信任始终验证原则。', segId: 'S01', quote: '零信任网络架构强调永不信任始终验证原则' }] }],
        quiz: [],
        glossary: [],
      }),
    };
  };

  const h = createPanelHarness({ fetchFn: fakeFetch, gmStorage });
  try {
    const { win, kg, root } = h;
    // Step 1: Save initial DeepSeek config & run guide + quiz (populates cache with deepseek-chat)
    kg.saveSettings({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-old-deepseek',
      transport: 'fetch',
    });
    const firstGuide = await kg.analyze({ scope: 'section', useAi: true });
    assert.equal(firstGuide.usedAi, true);
    assert.equal(firstGuide.fromCache, false);
    assert.equal(requests.at(-1).url, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(requests.at(-1).body.model, 'deepseek-chat');

    const sec = firstGuide.tree.sections[0];
    const firstQuiz = await generateSectionQuiz({
      win,
      courseTitle: '安全课',
      courseId: 'c-ai',
      section: sec,
      settings: kg.getSettings(),
      fetchFn: fakeFetch,
    });
    assert.equal(firstQuiz.ok, true);
    assert.equal(firstQuiz.fromCache, false);
    assert.equal(requests.at(-1).body.model, 'deepseek-chat');

    // Step 2: Change provider + model + Key in settings UI to Anthropic Claude
    const provSel = root.querySelector('[name="ai-provider"]');
    provSel.value = 'anthropic';
    provSel.dispatchEvent(new win.Event('change', { bubbles: true }));
    const keyInput = root.querySelector('[name="ai-api-key"]');
    keyInput.value = 'sk-ant-new-key';
    keyInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    const modelInput = root.querySelector('[name="ai-model"]');
    modelInput.value = 'claude-sonnet-4-20250514';
    modelInput.dispatchEvent(new win.Event('change', { bubbles: true }));

    // Verify all 3 consumers + citation verification immediately switch to Anthropic & new key/model (NOT stale cache!)
    const nextGuide = await kg.analyze({ scope: 'section', useAi: true });
    assert.equal(nextGuide.usedAi, true);
    assert.equal(nextGuide.fromCache, false, '模型切换后主动 AI 导览不得命中旧模型缓存');
    assert.equal(requests.at(-1).url, 'https://api.anthropic.com/v1/messages');
    assert.equal(requests.at(-1).headers['x-api-key'], 'sk-ant-new-key');
    assert.equal(requests.at(-1).body.model, 'claude-sonnet-4-20250514');
    // Strong citation verification works seamlessly on Anthropic output
    assert.equal(nextGuide.tree.sections[0].keyPoints[0].citationStatus, 'verified');
    assert.equal(nextGuide.tree.sections[0].keyPoints[0].segId, 'S01');

    const qaRes = await askSectionQuestion({
      win,
      courseTitle: '安全课',
      courseId: 'c-ai',
      section: nextGuide.tree.sections[0],
      question: '零信任核心原则是什么？',
      settings: kg.getSettings(),
      fetchFn: fakeFetch,
    });
    assert.equal(qaRes.ok, true);
    assert.equal(requests.at(-1).url, 'https://api.anthropic.com/v1/messages');
    assert.equal(requests.at(-1).body.model, 'claude-sonnet-4-20250514');
    assert.equal(qaRes.message.citations[0].verified, true);
    assert.equal(qaRes.message.citations[0].segId, 'S01');

    const nextQuiz = await generateSectionQuiz({
      win,
      courseTitle: '安全课',
      courseId: 'c-ai',
      section: nextGuide.tree.sections[0],
      settings: kg.getSettings(),
      fetchFn: fakeFetch,
    });
    assert.equal(nextQuiz.ok, true);
    assert.equal(nextQuiz.fromCache, false, '模型切换后出题不得返回旧模型缓存');
    assert.equal(requests.at(-1).url, 'https://api.anthropic.com/v1/messages');
    assert.equal(requests.at(-1).body.model, 'claude-sonnet-4-20250514');
    assert.equal(nextQuiz.quiz.model, 'claude-sonnet-4-20250514');
    assert.equal(nextQuiz.quiz.questions[0].citationStatus, 'verified');
  } finally {
    h.close();
  }
});
