export const WD_STORAGE_SCHEMA_VERSION = 1;
export const WD_CACHE_SCHEMA_VERSION = 3;

export const WD_LEGACY_STORAGE_KEYS = {
  config: 'wangda-assistant.ai.config',
  apiKey: 'wangda-assistant.ai.apiKey',
  cacheV1: 'wangda-assistant.ai.cache.v1',
  cacheV2: 'wangda-assistant.ai.cache.v2',
  qa: 'wangda-assistant.ai.qa.v1',
  quiz: 'wangda-assistant.ai.quiz.v1',
};

export const WD_GM_STORAGE_KEYS = {
  config: 'wangda-assistant.gm.ai.config.v1',
  apiKey: 'wangda-assistant.gm.ai.apiKey.v1',
  assetIndex: 'wangda-assistant.gm.assets.index.v1',
  assetShardPrefix: 'wangda-assistant.gm.asset.v1.',
  migration: 'wangda-assistant.gm.migration.v1',
};

export const WD_FALLBACK_STORAGE_KEYS = {
  config: WD_LEGACY_STORAGE_KEYS.config,
  apiKey: WD_LEGACY_STORAGE_KEYS.apiKey,
  assetIndex: 'wangda-assistant.fallback.assets.index.v1',
  assetShardPrefix: 'wangda-assistant.fallback.asset.v1.',
  migration: 'wangda-assistant.fallback.migration.v1',
};

export const WD_CACHE_STORAGE_KEYS = {
  knowledge: 'wangda-assistant.ai.cache.v3',
  subtitles: 'wangda-assistant.cache.subtitles.v1',
};

export const WD_ASSET_KINDS = ['qa', 'quiz', 'wrongQuestions', 'mastery', 'reviewPlan', 'notes'];

export const WD_CACHE_LRU_DEFAULTS = {
  knowledge: {
    maxEntries: 40,
    maxBytes: 1536 * 1024, // 1.5 MB budget inside localStorage
    ttlMs: 14 * 24 * 60 * 60 * 1000, // 14 days
  },
  subtitles: {
    maxEntries: 60,
    maxBytes: 1024 * 1024, // 1.0 MB budget inside localStorage
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

export const WD_IDB_CONFIG = {
  dbName: 'wangda-assistant-assets-v1',
  dbVersion: 1,
  storeName: 'course_shards',
};

const wdKstIdbCache = new WeakMap();
const wdKstRuntimeWarnings = new WeakMap();

function wdKstSafeCourseId(courseId) {
  return String(courseId || 'unknown').trim() || 'unknown';
}

function wdKstLocalStorage(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

export function resolveGmStorage(win, explicitGmStorage = undefined) {
  if (explicitGmStorage === null) return null;
  if (explicitGmStorage && typeof explicitGmStorage.get === 'function' && typeof explicitGmStorage.set === 'function') {
    return explicitGmStorage;
  }
  if (win?.__wdGmStorage && typeof win.__wdGmStorage.get === 'function' && typeof win.__wdGmStorage.set === 'function') {
    return win.__wdGmStorage;
  }
  if (win && ('GM_getValue' in win || 'GM_setValue' in win)) {
    if (typeof win.GM_getValue === 'function' && typeof win.GM_setValue === 'function') {
      return {
        get: (key, fallback = undefined) => win.GM_getValue(key, fallback),
        set: (key, value) => win.GM_setValue(key, value),
      };
    }
    return null;
  }
  try {
    if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
      return {
        get: (key, fallback = undefined) => GM_getValue(key, fallback),
        set: (key, value) => GM_setValue(key, value),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function bindWindowGmStorage(win, gmStorage) {
  if (!win || typeof win !== 'object') return;
  try {
    win.__wdGmStorage = gmStorage || null;
  } catch { /* ignore non-extensible window */ }
}

function wdKstRecordWarning(win, warning) {
  if (!win || !warning) return;
  const list = wdKstRuntimeWarnings.get(win) || [];
  if (!list.includes(warning)) {
    list.push(warning);
    wdKstRuntimeWarnings.set(win, list);
  }
}

export function getStorageStatus(win, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const ls = wdKstLocalStorage(win);
  const hasIdb = Boolean(win?.indexedDB && typeof win.indexedDB.open === 'function');
  const warnings = [...(wdKstRuntimeWarnings.get(win) || [])];
  if (!gm) {
    const degradeMsg = '当前环境未检测到 GM_setValue（非油猴环境或权限受限），API Key 与用户学习资产已自动降级保存到 localStorage，可能存在同源可读与容量限制风险。';
    if (!warnings.includes(degradeMsg)) warnings.unshift(degradeMsg);
  }
  return {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    cacheSchemaVersion: WD_CACHE_SCHEMA_VERSION,
    hasGm: Boolean(gm),
    hasLocalStorage: Boolean(ls),
    hasIndexedDb: hasIdb,
    degraded: !gm,
    backend: gm ? (hasIdb ? 'gm+indexeddb' : 'gm') : (ls ? (hasIdb ? 'localStorage-fallback+indexeddb' : 'localStorage-fallback') : 'memory-only'),
    cacheBackend: ls ? 'localStorage-lru' : 'unavailable',
    warnings,
    migration: readMigrationReceipt(win, options),
  };
}

function wdKstKvRead(win, key, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  if (gm) {
    try {
      const val = gm.get(key, undefined);
      return { ok: true, value: val === undefined ? null : val, backend: 'gm' };
    } catch (err) {
      return { ok: false, value: null, backend: 'gm', error: err?.message || String(err) };
    }
  }
  const ls = wdKstLocalStorage(win);
  if (!ls || typeof ls.getItem !== 'function') {
    return { ok: false, value: null, backend: 'unavailable', error: '本地存储不可用' };
  }
  try {
    const raw = ls.getItem(key);
    if (raw === null || raw === undefined) return { ok: true, value: null, backend: 'localStorage-fallback' };
    if (options.rawString) return { ok: true, value: raw, backend: 'localStorage-fallback' };
    return { ok: true, value: JSON.parse(raw), backend: 'localStorage-fallback' };
  } catch (err) {
    return { ok: false, value: null, backend: 'localStorage-fallback', error: err?.message || String(err) };
  }
}

function wdKstKvWrite(win, key, value, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  if (gm) {
    try {
      gm.set(key, value);
      return { ok: true, backend: 'gm' };
    } catch (err) {
      return { ok: false, backend: 'gm', error: err?.message || String(err) };
    }
  }
  wdKstRecordWarning(win, '当前环境未检测到 GM_setValue（非油猴环境或权限受限），API Key 与用户学习资产已自动降级保存到 localStorage，可能存在同源可读与容量限制风险。');
  const ls = wdKstLocalStorage(win);
  if (!ls || typeof ls.setItem !== 'function') {
    return { ok: false, backend: 'unavailable', error: '浏览器 localStorage 与 GM_setValue 均不可用。' };
  }
  try {
    if (value === null || value === undefined) {
      ls.removeItem?.(key);
    } else if (options.rawString) {
      ls.setItem(key, String(value));
    } else {
      ls.setItem(key, JSON.stringify(value));
    }
    return { ok: true, backend: 'localStorage-fallback', degraded: true };
  } catch (err) {
    return { ok: false, backend: 'localStorage-fallback', degraded: true, error: err?.message || String(err) };
  }
}

// ============================================================================
// Optional IndexedDB Shard Mirror (async, best-effort, never blocks sync APIs)
// ============================================================================

function wdKstOpenIdb(win) {
  if (!win?.indexedDB || typeof win.indexedDB.open !== 'function') return Promise.resolve(null);
  if (wdKstIdbCache.has(win)) return wdKstIdbCache.get(win);
  const promise = new Promise(resolve => {
    try {
      const req = win.indexedDB.open(WD_IDB_CONFIG.dbName, WD_IDB_CONFIG.dbVersion);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(WD_IDB_CONFIG.storeName)) {
            const store = db.createObjectStore(WD_IDB_CONFIG.storeName, { keyPath: 'shardKey' });
            store.createIndex('courseId', 'courseId', { unique: false });
            store.createIndex('kind', 'kind', { unique: false });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        } catch { /* ignore upgrade error */ }
      };
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  wdKstIdbCache.set(win, promise);
  return promise;
}

export async function writeAssetShardToIdb(win, shardRecord) {
  const db = await wdKstOpenIdb(win);
  if (!db) return { ok: false, skipped: true };
  return new Promise(resolve => {
    try {
      const tx = db.transaction(WD_IDB_CONFIG.storeName, 'readwrite');
      const store = tx.objectStore(WD_IDB_CONFIG.storeName);
      store.put(shardRecord);
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => resolve({ ok: false, error: tx.error?.message || 'IndexedDB 写入失败' });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

export async function readAssetShardFromIdb(win, courseId, kind) {
  const db = await wdKstOpenIdb(win);
  if (!db) return null;
  const shardKey = `${wdKstSafeCourseId(courseId)}::${kind}`;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(WD_IDB_CONFIG.storeName, 'readonly');
      const req = tx.objectStore(WD_IDB_CONFIG.storeName).get(shardKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function listAllIdbShards(win) {
  const db = await wdKstOpenIdb(win);
  if (!db) return [];
  return new Promise(resolve => {
    try {
      const tx = db.transaction(WD_IDB_CONFIG.storeName, 'readonly');
      const req = tx.objectStore(WD_IDB_CONFIG.storeName).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

// ============================================================================
// AI Config & Secret Storage (GM_setValue primary, localStorage fallback)
// ============================================================================

export function readStoredAiConfig(win, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const key = gm ? WD_GM_STORAGE_KEYS.config : WD_FALLBACK_STORAGE_KEYS.config;
  const res = wdKstKvRead(win, key, options);
  if (res.ok && res.value && typeof res.value === 'object') {
    return { config: res.value, backend: res.backend };
  }
  if (res.ok && typeof res.value === 'string') {
    try {
      const parsed = JSON.parse(res.value);
      if (parsed && typeof parsed === 'object') return { config: parsed, backend: res.backend };
    } catch { /* ignore */ }
  }
  return { config: {}, backend: res.backend };
}

export function writeStoredAiConfig(win, configObj, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const key = gm ? WD_GM_STORAGE_KEYS.config : WD_FALLBACK_STORAGE_KEYS.config;
  const payload = { ...configObj, schemaVersion: WD_STORAGE_SCHEMA_VERSION, updatedAt: Date.now() };
  return wdKstKvWrite(win, key, payload, options);
}

export function readStoredAiApiKey(win, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const key = gm ? WD_GM_STORAGE_KEYS.apiKey : WD_FALLBACK_STORAGE_KEYS.apiKey;
  const res = wdKstKvRead(win, key, { ...options, rawString: !gm });
  if (!res.ok || res.value === null || res.value === undefined) return { apiKey: '', backend: res.backend };
  return { apiKey: String(res.value).trim(), backend: res.backend };
}

export function writeStoredAiApiKey(win, apiKey, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const key = gm ? WD_GM_STORAGE_KEYS.apiKey : WD_FALLBACK_STORAGE_KEYS.apiKey;
  const clean = String(apiKey ?? '').trim();
  const res = wdKstKvWrite(win, key, clean || null, { ...options, rawString: !gm });
  // When stored safely in GM, ensure no lingering plaintext API key remains in host localStorage
  if (res.ok && gm) {
    try { wdKstLocalStorage(win)?.removeItem?.(WD_LEGACY_STORAGE_KEYS.apiKey); } catch { /* ignore */ }
  }
  return res;
}

// ============================================================================
// Durable User Asset Store (Per-Course Sharded + Master Index, Zero Eviction)
// ============================================================================

function wdKstAssetIndexKey(win, options = {}) {
  return resolveGmStorage(win, options.gmStorage)
    ? WD_GM_STORAGE_KEYS.assetIndex
    : WD_FALLBACK_STORAGE_KEYS.assetIndex;
}

export function buildAssetShardKey(win, courseId, kind, options = {}) {
  const prefix = resolveGmStorage(win, options.gmStorage)
    ? WD_GM_STORAGE_KEYS.assetShardPrefix
    : WD_FALLBACK_STORAGE_KEYS.assetShardPrefix;
  return `${prefix}${encodeURIComponent(wdKstSafeCourseId(courseId))}.${kind}`;
}

export function readAssetIndex(win, options = {}) {
  const res = wdKstKvRead(win, wdKstAssetIndexKey(win, options), options);
  const raw = res.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.courses && typeof raw.courses === 'object') {
    return {
      schemaVersion: Number(raw.schemaVersion) || WD_STORAGE_SCHEMA_VERSION,
      updatedAt: Number(raw.updatedAt) || 0,
      courses: { ...raw.courses },
    };
  }
  return { schemaVersion: WD_STORAGE_SCHEMA_VERSION, updatedAt: 0, courses: {} };
}

function wdKstWriteAssetIndex(win, indexObj, options = {}) {
  const next = {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    courses: indexObj.courses || {},
  };
  return wdKstKvWrite(win, wdKstAssetIndexKey(win, options), next, options);
}

function wdKstDefaultAssetData(kind) {
  if (kind === 'wrongQuestions') return { items: {} };
  if (kind === 'mastery') return { sections: {} };
  if (kind === 'reviewPlan') return { schemaVersion: WD_STORAGE_SCHEMA_VERSION, cards: [], schedule: { targetDate: null, dailyGoal: null } };
  if (kind === 'notes') return { sections: {} };
  return {};
}

function wdKstCountShardEntries(kind, data) {
  if (!data || typeof data !== 'object') return 0;
  if (kind === 'wrongQuestions') return Object.keys(data.items || {}).length;
  if (kind === 'mastery') return Object.keys(data.sections || {}).length;
  if (kind === 'reviewPlan') return Array.isArray(data.cards) ? data.cards.length : 0;
  if (kind === 'notes') {
    return Object.values(data.sections || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  }
  return Object.keys(data).length;
}

export function readCourseAssetShard(win, courseId, kind, options = {}) {
  if (!WD_ASSET_KINDS.includes(kind)) throw new Error(`未知用户资产类型：${kind}`);
  const cid = wdKstSafeCourseId(courseId);
  const storageKey = buildAssetShardKey(win, cid, kind, options);
  const res = wdKstKvRead(win, storageKey, options);
  const raw = res.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data && typeof raw.data === 'object') {
    return {
      schemaVersion: Number(raw.schemaVersion) || WD_STORAGE_SCHEMA_VERSION,
      courseId: cid,
      kind,
      updatedAt: Number(raw.updatedAt) || 0,
      data: raw.data,
      backend: res.backend,
    };
  }
  return {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    courseId: cid,
    kind,
    updatedAt: 0,
    data: wdKstDefaultAssetData(kind),
    backend: res.backend,
  };
}

export function writeCourseAssetShard(win, courseId, kind, data, options = {}) {
  if (!WD_ASSET_KINDS.includes(kind)) throw new Error(`未知用户资产类型：${kind}`);
  const cid = wdKstSafeCourseId(courseId);
  const now = Date.now();
  const storageKey = buildAssetShardKey(win, cid, kind, options);
  const record = {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    shardKey: `${cid}::${kind}`,
    courseId: cid,
    kind,
    updatedAt: now,
    data: data && typeof data === 'object' ? data : wdKstDefaultAssetData(kind),
  };
  const writeRes = wdKstKvWrite(win, storageKey, record, options);
  if (!writeRes.ok) return writeRes;

  const index = readAssetIndex(win, options);
  const prevCourse = index.courses[cid] || { courseId: cid, shards: [], counts: {}, updatedAt: 0 };
  const shards = Array.from(new Set([...(prevCourse.shards || []), kind]));
  const counts = { ...(prevCourse.counts || {}), [kind]: wdKstCountShardEntries(kind, record.data) };
  index.courses[cid] = { courseId: cid, shards, counts, updatedAt: now };
  wdKstWriteAssetIndex(win, index, options);

  // Best-effort async mirror into IndexedDB when available
  if (options.mirrorIdb !== false) {
    void writeAssetShardToIdb(win, record);
  }
  return { ...writeRes, record };
}

export function listIndexedCourseIds(win, options = {}) {
  const index = readAssetIndex(win, options);
  return Object.keys(index.courses || {});
}

// High-level User Asset Helpers (Wrong Questions / Mastery / Review Plan / Notes)
export function recordWrongQuestionAsset(win, courseId, entry, options = {}) {
  if (!entry || !entry.questionId) return { ok: false, error: '缺少错题标识' };
  const shard = readCourseAssetShard(win, courseId, 'wrongQuestions', options);
  const items = { ...(shard.data.items || {}) };
  const secId = String(entry.sectionId || 'current');
  const key = `${secId}::${entry.questionId}`;
  const prev = items[key];
  const now = Date.now();
  items[key] = {
    id: key,
    courseId: wdKstSafeCourseId(courseId),
    sectionId: secId,
    sectionTitle: String(entry.sectionTitle || prev?.sectionTitle || ''),
    questionId: String(entry.questionId),
    question: String(entry.question || prev?.question || ''),
    options: Array.isArray(entry.options) ? entry.options : (prev?.options || []),
    chosenIndex: Number.isInteger(entry.chosenIndex) ? entry.chosenIndex : null,
    correctIndex: Number.isInteger(entry.correctIndex) ? entry.correctIndex : (prev?.correctIndex ?? 0),
    answerLetter: String(entry.answerLetter || prev?.answerLetter || ''),
    explanation: String(entry.explanation || prev?.explanation || ''),
    citation: entry.citation || prev?.citation || null,
    wrongCount: (Number(prev?.wrongCount) || 0) + 1,
    firstWrongAt: prev?.firstWrongAt || now,
    lastWrongAt: now,
    mastered: false,
  };
  return writeCourseAssetShard(win, courseId, 'wrongQuestions', { items }, options);
}

export function loadCourseWrongQuestions(win, courseId, options = {}) {
  const shard = readCourseAssetShard(win, courseId, 'wrongQuestions', options);
  return Object.values(shard.data.items || {}).sort((a, b) => (b.lastWrongAt || 0) - (a.lastWrongAt || 0));
}

export function updateSectionMasteryAsset(win, courseId, sectionId, patch, options = {}) {
  const shard = readCourseAssetShard(win, courseId, 'mastery', options);
  const sections = { ...(shard.data.sections || {}) };
  const sid = String(sectionId || 'current');
  const prev = sections[sid] || { sectionId: sid, status: 'unseen', score: null, wrongCount: 0, reviewCount: 0 };
  sections[sid] = {
    ...prev,
    ...patch,
    sectionId: sid,
    updatedAt: Date.now(),
  };
  return writeCourseAssetShard(win, courseId, 'mastery', { sections }, options);
}

export function loadCourseMastery(win, courseId, options = {}) {
  return readCourseAssetShard(win, courseId, 'mastery', options).data.sections || {};
}

export function loadCourseReviewPlan(win, courseId, options = {}) {
  return readCourseAssetShard(win, courseId, 'reviewPlan', options).data;
}

export function saveCourseReviewPlan(win, courseId, planData, options = {}) {
  const next = {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    cards: Array.isArray(planData?.cards) ? planData.cards : [],
    schedule: planData?.schedule && typeof planData.schedule === 'object'
      ? { targetDate: planData.schedule.targetDate || null, dailyGoal: planData.schedule.dailyGoal ?? null }
      : { targetDate: null, dailyGoal: null },
  };
  return writeCourseAssetShard(win, courseId, 'reviewPlan', next, options);
}

export function loadSectionNotes(win, courseId, sectionId, options = {}) {
  const shard = readCourseAssetShard(win, courseId, 'notes', options);
  const sid = String(sectionId || 'current');
  const list = shard.data.sections?.[sid];
  return Array.isArray(list) ? list : [];
}

export function saveSectionNote(win, courseId, sectionId, note, options = {}) {
  const shard = readCourseAssetShard(win, courseId, 'notes', options);
  const sections = { ...(shard.data.sections || {}) };
  const sid = String(sectionId || 'current');
  const prev = Array.isArray(sections[sid]) ? [...sections[sid]] : [];
  const now = Date.now();
  const nextNote = {
    id: note?.id || `note-${now}-${prev.length + 1}`,
    sectionId: sid,
    segId: note?.segId || null,
    seconds: Number.isFinite(note?.seconds) ? Math.floor(note.seconds) : null,
    content: String(note?.content || '').trim(),
    createdAt: note?.createdAt || now,
    updatedAt: now,
  };
  const existingIdx = prev.findIndex(item => item.id === nextNote.id);
  if (existingIdx >= 0) prev[existingIdx] = nextNote;
  else prev.push(nextNote);
  sections[sid] = prev;
  return writeCourseAssetShard(win, courseId, 'notes', { sections }, options);
}

// ============================================================================
// Rebuildable Cache Layer (localStorage LRU + TTL + Size Budget)
// ============================================================================

function wdKstEstimateBytes(obj) {
  try {
    return JSON.stringify(obj).length * 2;
  } catch {
    return 0;
  }
}

export function readLruCacheMap(win, storageKey) {
  const ls = wdKstLocalStorage(win);
  if (!ls || typeof ls.getItem !== 'function') return {};
  try {
    const raw = ls.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLruCacheMap(win, storageKey, map, policy = {}) {
  const ls = wdKstLocalStorage(win);
  if (!ls || typeof ls.setItem !== 'function') return { ok: false, evicted: 0 };
  const now = Number.isFinite(policy.now) ? policy.now : Date.now();
  const maxEntries = Number.isFinite(policy.maxEntries) ? Math.max(1, policy.maxEntries) : 40;
  const maxBytes = Number.isFinite(policy.maxBytes) ? Math.max(4096, policy.maxBytes) : 1536 * 1024;
  const ttlMs = Number.isFinite(policy.ttlMs) ? Math.max(1000, policy.ttlMs) : 14 * 24 * 60 * 60 * 1000;

  let evicted = 0;
  const validEntries = [];
  for (const [k, v] of Object.entries(map || {})) {
    if (!v || typeof v !== 'object') { evicted += 1; continue; }
    const cachedAt = Number(v.cachedAt) || 0;
    if (cachedAt > 0 && now - cachedAt > ttlMs) {
      evicted += 1;
      continue;
    }
    validEntries.push([k, v]);
  }

  validEntries.sort((a, b) => {
    const ta = Number(a[1].lastAccessedAt || a[1].cachedAt) || 0;
    const tb = Number(b[1].lastAccessedAt || b[1].cachedAt) || 0;
    return tb - ta;
  });

  if (validEntries.length > maxEntries) {
    evicted += validEntries.length - maxEntries;
  }
  const kept = validEntries.slice(0, maxEntries);

  // Enforce byte budget from MRU to LRU
  while (kept.length > 1 && wdKstEstimateBytes(Object.fromEntries(kept)) > maxBytes) {
    kept.pop();
    evicted += 1;
  }

  // Handle QuotaExceededError cleanly by dropping least-recently-used entries
  for (let limit = kept.length; limit >= 0; limit -= 1) {
    try {
      const pruned = Object.fromEntries(kept.slice(0, limit));
      ls.setItem(storageKey, JSON.stringify(pruned));
      return { ok: true, kept: limit, evicted: evicted + (kept.length - limit), bytes: wdKstEstimateBytes(pruned) };
    } catch { /* quota exceeded -> evict oldest and retry */ }
  }
  return { ok: false, kept: 0, evicted: evicted + kept.length, bytes: 0 };
}

export function getLruCacheEntry(win, storageKey, key, policy = {}) {
  if (!key) return null;
  const now = Number.isFinite(policy.now) ? policy.now : Date.now();
  const ttlMs = Number.isFinite(policy.ttlMs) ? Math.max(1000, policy.ttlMs) : 14 * 24 * 60 * 60 * 1000;
  const map = readLruCacheMap(win, storageKey);
  const entry = map[key];
  if (!entry || typeof entry !== 'object') return null;
  const cachedAt = Number(entry.cachedAt) || 0;
  if (cachedAt > 0 && now - cachedAt > ttlMs) {
    delete map[key];
    writeLruCacheMap(win, storageKey, map, { ...policy, now });
    return null;
  }
  if (typeof policy.schemaVersion === 'number' && entry.schemaVersion !== policy.schemaVersion) {
    return null;
  }
  // Touch LRU access timestamp
  map[key] = { ...entry, lastAccessedAt: now };
  writeLruCacheMap(win, storageKey, map, { ...policy, now });
  return map[key];
}

export function setLruCacheEntry(win, storageKey, key, entry, policy = {}) {
  if (!key || !entry || typeof entry !== 'object') return false;
  const now = Number.isFinite(policy.now) ? policy.now : Date.now();
  const map = readLruCacheMap(win, storageKey);
  map[key] = {
    ...entry,
    cachedAt: Number(entry.cachedAt) || now,
    lastAccessedAt: now,
  };
  const res = writeLruCacheMap(win, storageKey, map, { ...policy, now });
  return Boolean(res.ok);
}

export function clearLruCache(win, storageKey, key = null) {
  const ls = wdKstLocalStorage(win);
  if (!ls) return false;
  try {
    if (!key) {
      ls.removeItem(storageKey);
      return true;
    }
    const map = readLruCacheMap(win, storageKey);
    delete map[key];
    ls.setItem(storageKey, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function loadSubtitleParseCache(win, courseId, sectionId, policy = {}) {
  const key = `${wdKstSafeCourseId(courseId)}::${String(sectionId || 'current')}`;
  return getLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.subtitles, key, {
    ...WD_CACHE_LRU_DEFAULTS.subtitles,
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    ...policy,
  });
}

export function saveSubtitleParseCache(win, courseId, sectionId, payload, policy = {}) {
  const key = `${wdKstSafeCourseId(courseId)}::${String(sectionId || 'current')}`;
  return setLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.subtitles, key, {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    courseId: wdKstSafeCourseId(courseId),
    sectionId: String(sectionId || 'current'),
    segments: Array.isArray(payload?.segments) ? payload.segments : [],
    durationSec: Number.isFinite(payload?.durationSec) ? payload.durationSec : null,
    source: payload?.source || '',
  }, { ...WD_CACHE_LRU_DEFAULTS.subtitles, ...policy });
}

// ============================================================================
// One-Time Legacy Migration (Never Loses Raw Data on Failure)
// ============================================================================

function wdKstMigrationReceiptKey(win, options = {}) {
  return resolveGmStorage(win, options.gmStorage)
    ? WD_GM_STORAGE_KEYS.migration
    : WD_FALLBACK_STORAGE_KEYS.migration;
}

export function readMigrationReceipt(win, options = {}) {
  const res = wdKstKvRead(win, wdKstMigrationReceiptKey(win, options), options);
  return res.ok && res.value && typeof res.value === 'object' ? res.value : null;
}

function wdKstSplitLegacySectionKey(compoundKey) {
  const str = String(compoundKey || '');
  const idx = str.indexOf('::');
  if (idx < 0) return { courseId: 'unknown', sectionId: str || 'current' };
  return {
    courseId: str.slice(0, idx) || 'unknown',
    sectionId: str.slice(idx + 2) || 'current',
  };
}

export function migrateLegacyStorage(win, options = {}) {
  const force = Boolean(options.force);
  const gm = resolveGmStorage(win, options.gmStorage);
  const ls = wdKstLocalStorage(win);
  const backend = gm ? 'gm' : (ls ? 'localStorage-fallback' : 'unavailable');
  const existingReceipt = readMigrationReceipt(win, options);
  if (
    !force
    && existingReceipt
    && existingReceipt.schemaVersion === WD_STORAGE_SCHEMA_VERSION
    && existingReceipt.backend === backend
    && ['migrated', 'noop', 'degraded'].includes(existingReceipt.status)
  ) {
    return existingReceipt;
  }
  const warnings = [];
  const items = {
    config: { status: 'skipped', count: 0 },
    apiKey: { status: 'skipped', count: 0 },
    qa: { status: 'skipped', count: 0 },
    quiz: { status: 'skipped', count: 0 },
    cache: { status: 'skipped', count: 0 },
  };

  if (!ls || typeof ls.getItem !== 'function') {
    const receipt = {
      schemaVersion: WD_STORAGE_SCHEMA_VERSION,
      completedAt: Date.now(),
      status: 'noop',
      backend,
      items,
      warnings: ['当前环境无 localStorage，跳过旧版数据迁移。'],
    };
    wdKstKvWrite(win, wdKstMigrationReceiptKey(win, options), receipt, options);
    return receipt;
  }

  let anyMigrated = false;
  let anyFailed = false;

  // 1. Migrate AI Config (only needs cross-backend move when GM is available)
  try {
    const rawConfig = ls.getItem(WD_LEGACY_STORAGE_KEYS.config);
    if (rawConfig) {
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(rawConfig);
      } catch (parseErr) {
        anyFailed = true;
        items.config = { status: 'failed', count: 0, preservedRaw: true, error: `配置 JSON 解析失败：${parseErr.message}` };
        warnings.push('旧版 AI 配置数据损坏，已保留原始 localStorage 数据未删除。');
      }
      if (parsedConfig && typeof parsedConfig === 'object' && !Array.isArray(parsedConfig)) {
        if (gm) {
          const existing = readStoredAiConfig(win, options).config;
          const hasExisting = existing && typeof existing.provider === 'string' && existing.updatedAt;
          if (!hasExisting) {
            const wRes = writeStoredAiConfig(win, parsedConfig, options);
            const verified = wRes.ok && Boolean(readStoredAiConfig(win, options).config?.provider || Object.keys(parsedConfig).length === 0);
            if (verified) {
              anyMigrated = true;
              items.config = { status: 'migrated', count: 1, cleanedLegacy: false };
            } else {
              anyFailed = true;
              items.config = { status: 'failed', count: 0, preservedRaw: true, error: wRes.error || 'GM 写入校验失败' };
              warnings.push('旧版 AI 配置迁入 GM_setValue 失败，已保留原始 localStorage 数据。');
            }
          } else {
            items.config = { status: 'skipped', count: 0, reason: 'target-exists' };
          }
        } else {
          items.config = { status: 'degraded-kept', count: 1, preservedRaw: true };
        }
      }
    }
  } catch (err) {
    anyFailed = true;
    items.config = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
    warnings.push('读取旧版 AI 配置失败，已保留原始数据。');
  }

  // 2. Migrate API Key to GM_setValue (and scrub plaintext from localStorage ONLY after GM read-back verification)
  try {
    const rawKey = ls.getItem(WD_LEGACY_STORAGE_KEYS.apiKey);
    if (rawKey && String(rawKey).trim()) {
      const trimmedKey = String(rawKey).trim();
      if (gm) {
        const existingKey = readStoredAiApiKey(win, options).apiKey;
        if (!existingKey) {
          const wRes = wdKstKvWrite(win, WD_GM_STORAGE_KEYS.apiKey, trimmedKey, options);
          const readBack = readStoredAiApiKey(win, options).apiKey;
          if (wRes.ok && readBack === trimmedKey) {
            anyMigrated = true;
            try { ls.removeItem(WD_LEGACY_STORAGE_KEYS.apiKey); } catch { /* ignore */ }
            items.apiKey = { status: 'migrated', count: 1, cleanedLegacy: true };
          } else {
            anyFailed = true;
            items.apiKey = { status: 'failed', count: 0, preservedRaw: true, error: wRes.error || 'GM API Key 回读校验失败' };
            warnings.push('API Key 迁移到 GM_setValue 失败，已保留原 localStorage 中的 Key 以防丢失。');
          }
        } else {
          // GM already holds a key; safe to scrub old plaintext copy
          try { ls.removeItem(WD_LEGACY_STORAGE_KEYS.apiKey); } catch { /* ignore */ }
          items.apiKey = { status: 'skipped', count: 0, reason: 'target-exists', cleanedLegacy: true };
        }
      } else {
        items.apiKey = { status: 'degraded-kept', count: 1, preservedRaw: true };
        warnings.push('当前非油猴环境无法迁移 API Key 至 GM_setValue，已暂留于 localStorage 并启用降级模式。');
      }
    }
  } catch (err) {
    anyFailed = true;
    items.apiKey = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
    warnings.push('API Key 迁移异常，已保留原始数据。');
  }

  // 3. Migrate Legacy Q&A History -> Per-Course Durable Shards (NO 30-entry cap!)
  try {
    const rawQa = ls.getItem(WD_LEGACY_STORAGE_KEYS.qa);
    if (rawQa) {
      let qaMap;
      try {
        qaMap = JSON.parse(rawQa);
      } catch (parseErr) {
        anyFailed = true;
        items.qa = { status: 'failed', count: 0, preservedRaw: true, error: `问答 JSON 解析失败：${parseErr.message}` };
        warnings.push('旧版问答记录解析失败，已保留原始 localStorage 数据未删除。');
      }
      if (qaMap && typeof qaMap === 'object' && !Array.isArray(qaMap)) {
        const byCourse = new Map();
        for (const [compoundKey, entry] of Object.entries(qaMap)) {
          if (!entry || !Array.isArray(entry.messages) || !entry.messages.length) continue;
          const { courseId, sectionId } = wdKstSplitLegacySectionKey(compoundKey);
          if (!byCourse.has(courseId)) byCourse.set(courseId, {});
          byCourse.get(courseId)[sectionId] = entry;
        }
        let migratedSections = 0;
        let qaFailed = false;
        for (const [courseId, secEntries] of byCourse.entries()) {
          const shard = readCourseAssetShard(win, courseId, 'qa', options);
          const merged = { ...(shard.data || {}) };
          for (const [secId, oldEntry] of Object.entries(secEntries)) {
            if (!merged[secId]) {
              const ts = Number(oldEntry.updatedAt) || Date.now();
              merged[secId] = {
                activeSessionId: 'default',
                updatedAt: ts,
                sessions: {
                  default: {
                    id: 'default',
                    title: '历史问答（已迁移）',
                    kind: 'general',
                    createdAt: ts,
                    updatedAt: ts,
                    messages: oldEntry.messages,
                  },
                },
              };
              migratedSections += 1;
            }
          }
          const wRes = writeCourseAssetShard(win, courseId, 'qa', merged, options);
          if (!wRes.ok) {
            qaFailed = true;
            anyFailed = true;
            warnings.push(`课程 ${courseId} 问答记录迁移失败（${wRes.error || '写入失败'}），原始数据已保留。`);
          }
        }
        if (qaFailed) {
          items.qa = { status: 'failed', count: migratedSections, preservedRaw: true };
        } else if (migratedSections > 0) {
          anyMigrated = true;
          items.qa = { status: 'migrated', count: migratedSections, courses: byCourse.size, preservedBackup: true };
        }
      }
    }
  } catch (err) {
    anyFailed = true;
    items.qa = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
    warnings.push('旧版问答记录迁移异常，已保留原始数据。');
  }

  // 4. Migrate Legacy Quiz Records -> Per-Course Durable Shards + Wrong Question Extraction
  try {
    const rawQuiz = ls.getItem(WD_LEGACY_STORAGE_KEYS.quiz);
    if (rawQuiz) {
      let quizMap;
      try {
        quizMap = JSON.parse(rawQuiz);
      } catch (parseErr) {
        anyFailed = true;
        items.quiz = { status: 'failed', count: 0, preservedRaw: true, error: `测验 JSON 解析失败：${parseErr.message}` };
        warnings.push('旧版测验记录解析失败，已保留原始 localStorage 数据未删除。');
      }
      if (quizMap && typeof quizMap === 'object' && !Array.isArray(quizMap)) {
        const byCourse = new Map();
        for (const [compoundKey, entry] of Object.entries(quizMap)) {
          if (!entry || !Array.isArray(entry.questions) || !entry.questions.length) continue;
          const { courseId, sectionId } = wdKstSplitLegacySectionKey(compoundKey);
          if (!byCourse.has(courseId)) byCourse.set(courseId, {});
          byCourse.get(courseId)[sectionId] = entry;
        }
        let migratedSections = 0;
        let migratedWrongs = 0;
        let quizFailed = false;
        for (const [courseId, secEntries] of byCourse.entries()) {
          const shard = readCourseAssetShard(win, courseId, 'quiz', options);
          const merged = { ...(shard.data || {}) };
          for (const [secId, oldQuiz] of Object.entries(secEntries)) {
            if (!merged[secId]) {
              merged[secId] = { ...oldQuiz, migratedAt: Date.now() };
              migratedSections += 1;
              // Extract any submitted wrong choice answers into durable wrongQuestions shard
              if (oldQuiz.attempt?.submitted && oldQuiz.attempt?.answers) {
                for (const q of oldQuiz.questions) {
                  if (q.type !== 'choice') continue;
                  const chosen = oldQuiz.attempt.answers[q.id];
                  if (Number.isInteger(chosen) && chosen !== q.correctIndex) {
                    const wr = recordWrongQuestionAsset(win, courseId, {
                      sectionId: secId,
                      sectionTitle: oldQuiz.sectionTitle || '',
                      questionId: q.id,
                      question: q.question,
                      options: q.options,
                      chosenIndex: chosen,
                      correctIndex: q.correctIndex,
                      answerLetter: q.answerLetter,
                      explanation: q.explanation,
                    }, options);
                    if (wr.ok) migratedWrongs += 1;
                  }
                }
              }
            }
          }
          const wRes = writeCourseAssetShard(win, courseId, 'quiz', merged, options);
          if (!wRes.ok) {
            quizFailed = true;
            anyFailed = true;
            warnings.push(`课程 ${courseId} 测验记录迁移失败（${wRes.error || '写入失败'}），原始数据已保留。`);
          }
        }
        if (quizFailed) {
          items.quiz = { status: 'failed', count: migratedSections, preservedRaw: true };
        } else if (migratedSections > 0) {
          anyMigrated = true;
          items.quiz = { status: 'migrated', count: migratedSections, wrongQuestions: migratedWrongs, courses: byCourse.size, preservedBackup: true };
        }
      }
    }
  } catch (err) {
    anyFailed = true;
    items.quiz = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
    warnings.push('旧版测验记录迁移异常，已保留原始数据。');
  }

  // 5. Inspect & Migrate Rebuildable Knowledge Cache (v2 -> v3 LRU metadata; never fails asset migration)
  try {
    const rawCacheV2 = ls.getItem(WD_LEGACY_STORAGE_KEYS.cacheV2);
    if (rawCacheV2) {
      let cacheMap;
      try {
        cacheMap = JSON.parse(rawCacheV2);
      } catch (parseErr) {
        anyFailed = true;
        items.cache = { status: 'failed', count: 0, preservedRaw: true, error: `缓存 JSON 解析失败：${parseErr.message}` };
        warnings.push('旧版知识缓存解析失败，已保留原始记录未删除。');
      }
      if (cacheMap && typeof cacheMap === 'object' && !Array.isArray(cacheMap)) {
        let migratedCacheCount = 0;
        const targetMap = readLruCacheMap(win, WD_CACHE_STORAGE_KEYS.knowledge);
        for (const [k, entry] of Object.entries(cacheMap)) {
          // Only migrate valid v2 entries (v1 / malformed entries intentionally skipped so stale ellipsis caches never return)
          if (!entry || typeof entry !== 'object' || entry.schemaVersion !== 2 || !entry.tree || typeof entry.markdown !== 'string') continue;
          if (!targetMap[k]) {
            targetMap[k] = {
              ...entry,
              schemaVersion: WD_CACHE_SCHEMA_VERSION,
              legacySchemaVersion: 2,
              migratedAt: Date.now(),
              lastAccessedAt: Number(entry.cachedAt) || Date.now(),
            };
            migratedCacheCount += 1;
          }
        }
        if (migratedCacheCount > 0) {
          const wRes = writeLruCacheMap(win, WD_CACHE_STORAGE_KEYS.knowledge, targetMap, WD_CACHE_LRU_DEFAULTS.knowledge);
          if (wRes.ok) {
            anyMigrated = true;
            items.cache = { status: 'migrated', count: migratedCacheCount, kept: wRes.kept, evicted: wRes.evicted };
          } else {
            anyFailed = true;
            items.cache = { status: 'failed', count: 0, preservedRaw: true, error: '写入新版 LRU 缓存失败' };
            warnings.push('旧版知识缓存迁移失败，原始缓存已保留。');
          }
        }
      }
    }
  } catch (err) {
    anyFailed = true;
    items.cache = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
  }

  const finalStatus = anyFailed
    ? (anyMigrated ? 'partial' : 'failed')
    : anyMigrated
      ? (gm ? 'migrated' : 'degraded')
      : (gm ? 'noop' : 'degraded');

  const receipt = {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    completedAt: Date.now(),
    status: finalStatus,
    backend,
    items,
    warnings,
  };
  wdKstKvWrite(win, wdKstMigrationReceiptKey(win, options), receipt, options);
  return receipt;
}

export function ensureStorageMigrated(win, options = {}) {
  return migrateLegacyStorage(win, { ...options, force: false });
}
