import { normalizeTitle, isWithinWindow, decideLearningAction } from './core.js';
import { normalizeQueue, mergeCourses, validWindow, isTaskComplete } from './queue.js';
import { createPlaybackLog } from './playback-log.js';

const wdControllerTaskKey = 'wangda-assistant.task';
const wdControllerLeaseKey = 'wangda-assistant.lease';
const wdControllerLock = 'wangda-assistant.run';
const wdControllerEndedConfirmTimeout = 90000;
const wdControllerPauseGrace = 2000;
const wdControllerProgressTimeout = 8000;
const wdControllerPlayTimeout = 30000;
const wdControllerProgressDelta = 0.5;
const wdControllerResumeBackoff = [5000, 10000];

function wdControllerDescribeRecognitionFailure(page, { stage = 'subject', expectedSubject = null, timedOut = false } = {}) {
  const prefix = timedOut ? '加载超时' : '识别失败';
  if (!page || page.kind === 'unknown') {
    const basis = page?.recognition?.basis || '路由未匹配已知专题/课程/搜索规则（需 #/study/subject/detail/<SID>、#/study/course/detail/... 或 #/search）';
    return `${prefix}（不支持的结构）：当前页面路由无法识别。依据：${basis}。请点击“页面诊断”核对。`;
  }
  if (stage === 'search-page' || stage === 'results') {
    if (page.kind !== 'search') {
      return `${prefix}（页面未就绪）：尚未处于专题搜索页（当前类型：${page.kind}，需 #/search）。请手动打开专题后读取，或点击“页面诊断”核对。`;
    }
    const rec = page.recognition;
    if (rec?.category === 'zero-results') return `${timedOut ? '搜索结束' : '识别失败'}（零结果）：未找到匹配专题候选。依据：${rec.basis}。请核对关键词或手动打开专题后读取，可点击“页面诊断”核对。`;
    if (rec?.category === 'unsupported-structure') return `搜索识别失败（不支持的结构）：页面搜索结果结构暂不支持。依据：${rec.basis}。请点击“页面诊断”核对。`;
    const basis = rec?.basis || (stage === 'search-page'
      ? '未找到搜索控件（input[id$="searchContent"][name="keyword"] / input[name="searchContent"] 与 i[id$="searchBtn"]）'
      : '尚未出现搜索结果容器（[id$="all-list"]）或结果仍在加载');
    return `${prefix}（页面未就绪）：搜索页面或结果尚未就绪。依据：${basis}。请稍后重试或手动打开专题后读取，可点击“页面诊断”核对。`;
  }
  if (page.kind !== 'subject') {
    return `${prefix}（页面未就绪）：当前不在专题详情页（当前类型：${page.kind}，需 #/study/subject/detail/<SID>）。请进入对应专题页后读取，可点击“页面诊断”核对。`;
  }
  if (expectedSubject && page.subjectId !== expectedSubject.id) {
    return `${prefix}（页面未就绪）：当前专题标识与目标专题不一致（需匹配目标专题 SID）。请核对专区后重试，可点击“页面诊断”核对。`;
  }
  if (page.courses?.length) {
    if (!page.title?.trim()) {
      return '未识别当前专题标题（页面未就绪），已暂停。依据：未从 .subject-banner/.banner-info .title-row .h3、introduce .h3 或 document.title 读到标题。请查看页面诊断后重试读取。';
    }
    if (expectedSubject && normalizeTitle(page.title) !== normalizeTitle(expectedSubject.title)) {
      return '当前专题标题与所选结果不一致，已暂停。依据：专题标题规范化比对不匹配。请核对专区后重试。';
    }
  }
  const rec = page.recognition;
  if (rec?.category === 'zero-results') {
    return `${prefix}（零结果）：当前专题未读取到可执行课程。依据：${rec.basis}。请点击“页面诊断”核对。`;
  }
  if (rec?.category === 'unsupported-structure') {
    return `${prefix}（不支持的结构）：当前专题页面结构暂不支持。依据：${rec.basis}。请点击“页面诊断”查看详情。`;
  }
  const basis = rec?.basis || '尚未检测到可用专题课程列表（检查 .catalog-state-info2、.catalog-state-info 或 .content.new [id*="studyBtn"]）';
  return `${prefix}（页面未就绪）：专题标题或课程列表尚未加载完成。依据：${basis}。请等待加载完成后重试，或点击“页面诊断”核对。`;
}

export function createController(options) {
  const { adapter, storage, locks } = options;
  const now = options.now || (() => new Date());
  const owner = options.owner || globalThis.crypto.randomUUID();
  const unique = () => `${owner}-${now().getTime()}-${++serial}`;
  const schedule = options.setInterval || globalThis.setInterval;
  const unschedule = options.clearInterval || globalThis.clearInterval;
  let serial = 0;
  let record = null;
  let task = null;
  let identity = null;
  let runTaskId = null;
  let draft = null;
  let target = '';
  let problem = null;
  let currentSectionTitle = '';
  let currentPlayback = null;
  const defaultWindow = { start: '09:00', end: '24:00' };
  const pendingNotice = '有待学课程，请手动点击开始继续。';
  let status = 'paused';
  let message = '已暂停，确认配置和课程后点击开始。';
  let candidates = [];
  let blocked = false;
  let destroyed = false;
  let held = false;
  let acquiring = false;
  let releaseLock = null;
  let runId = null;
  let generation = 0;
  let timer = null;
  let preparing = null;
  let pending = null;
  let grace = null;
  let loading = null;
  let confirmWait = null;
  let sectionConfirm = null;
  let lastOwnedPage = null;
  let needOpen = false;
  let ticking = false;
  let mediaHealth = null;
  let playbackAttention = null;
  let stopMediaWatch = null;
  let recovery = null;
  let restorePending = false;
  let visibility = adapter.visibility?.() || 'visible';
  let visibleSince = -Infinity;
  let attemptedWhileHidden = false;
  let lastDiagnosticTick = null;
  let stopPlaybackWatch = null;
  const playbackLog = createPlaybackLog(now);
  const retries = new Map();
  const defaultAutomation = { enabled: false, resumeOnReload: false, mute: true };
  const listeners = new Set();
  const copy = value => JSON.parse(JSON.stringify(value));
  const isDone = (item, id) => Boolean(item?.done?.includes(id) && !item.recheck?.includes(id));
  const getState = () => ({ status, phase: restorePending ? 'resuming' : recovery?.network ? 'offline' : recovery ? 'retrying' : confirmWait ? 'confirming' : status, message, unavailable: blocked, window: copy(record?.window || defaultWindow), automation: copy(record?.automation || defaultAutomation), tasks: copy(record?.tasks || []), activeTaskId: record?.activeTaskId || null, currentCourseId: task?.current || null, currentSectionTitle, currentPlayback: copy(currentPlayback), candidates: copy(candidates), draft: copy(draft), problem: copy(problem) });
  const emit = () => { const state = getState(); for (const listener of listeners) listener(state); };
  const tell = text => { message = text; emit(); return false; };
  const milliseconds = () => now().getTime();
  const retryKey = () => `${task?.id}:${task?.current}`;
  const logContext = () => ({ visibility, runnerStatus: status, courseRetries: retries.get(retryKey()) || 0, resumeFailures: mediaHealth?.failures || 0 });
  const logPlayback = (event, details) => {
    if (playbackLog.enabled) playbackLog.record(event, logContext(), details);
  };
  const observePlayback = page => {
    if (playbackLog.enabled) playbackLog.observe(page, logContext());
  };
  const refreshVisibility = () => {
    const next = adapter.visibility?.() || 'visible';
    if (next === visibility) return;
    const previous = visibility;
    visibility = next;
    if (next === 'visible') visibleSince = milliseconds();
    else attemptedWhileHidden = false;
    logPlayback('visibility', { previous });
  };
  const setPlaybackLogging = enabled => {
    if (destroyed || playbackLog.enabled === Boolean(enabled)) return;
    if (!enabled) {
      logPlayback('recording-stopped');
      playbackLog.setEnabled(false);
    } else {
      lastDiagnosticTick = null;
      refreshVisibility();
      playbackLog.setEnabled(true);
      try { observePlayback(adapter.read()); } catch { /* Logging remains available during page updates. */ }
      logPlayback('recording-started');
    }
  };
  const endMediaRequest = (outcome, reason) => {
    const request = mediaHealth?.request;
    if (!request) return;
    logPlayback('recovery-result', { mode: request.resume ? 'resume' : 'start', outcome, reason, playResult: request.result });
    mediaHealth.request = null;
  };
  const clearMediaHealth = reason => {
    endMediaRequest('cancelled', reason);
    const previous = mediaHealth?.failures;
    mediaHealth = null;
    if (previous) logPlayback('failure-count', { counter: 'resume', previous, reason });
    if (message.startsWith('播放已暂停，正在自动恢复播放')) message = '正在按平台课节状态连续学习。';
  };
  const endCourseRetry = outcome => {
    if (recovery?.attempt) logPlayback('retry-end', { attempt: recovery.attempt, outcome });
    recovery = null;
  };
  const clearCourseRetries = reason => {
    const previous = retries.get(retryKey());
    if (!previous) return;
    retries.delete(retryKey());
    logPlayback('failure-count', { counter: 'course', previous, reason });
  };
  const notify = text => { try { options.notify?.(`网大助手：${text}`); } catch { /* Notifications are optional. */ } };
  const pauseOwnedMedia = reason => {
    logPlayback('pause-command', { source: 'assistant', reason });
    return adapter.pauseMedia();
  };
  const readStored = () => {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') throw Error('存储不可用，无法安全保存任务。');
    const value = storage.get(wdControllerTaskKey);
    return normalizeQueue(value);
  };
  const sameTask = value => identity ? value?.taskId === identity.taskId && value.revision === identity.revision : value === null;
  const ownLease = lease => lease?.owner === owner && lease.runId === runId && lease.taskId === runTaskId;
  const release = () => {
    if (!held) return;
    try { const value = storage.get(wdControllerLeaseKey); if (value?.owner === owner && value.runId === runId) storage.set(wdControllerLeaseKey, null); } catch { blocked = true; message = '本地存储写入失败，已停止。'; }
    held = false;
    const finish = releaseLock;
    releaseLock = null;
    runId = null;
    finish?.();
  };
  const ownsCurrentLearningPage = () => {
    if (!task?.current || !task?.subject || record?.activeTaskId !== task.id) return false;
    try {
      const page = adapter.read();
      const owned = page.kind === 'course' && task.current === page.courseId && task.subject.id === page.subjectId && task.courses.some(course => course.id === page.courseId && course.route === page.route);
      if (owned) lastOwnedPage = { taskId: task.id, courseId: task.current, route: page.route };
      else if (lastOwnedPage?.taskId === task.id && lastOwnedPage.courseId === task.current) lastOwnedPage = null;
      return owned;
    } catch {
      return Boolean(lastOwnedPage && lastOwnedPage.taskId === task.id && lastOwnedPage.courseId === task.current);
    }
  };
  const stop = (text, leave = false, complete = false, preserveRun = false) => {
    currentPlayback = null;
    const wasRunning = status === 'running';
    restorePending = false;
    // Write the stop intent only while this runner still owns both the task revision and lease.
    if (!preserveRun && record?.runRequested) {
      try {
        if (held && sameTask(readStored()) && ownLease(storage.get(wdControllerLeaseKey))) {
          const next = normalizeQueue({ ...record, runRequested: false, revision: identity.revision + 1 });
          storage.set(wdControllerTaskKey, next); record = next; identity = { taskId: next.taskId, revision: next.revision };
          task = record.tasks.find(item => item.id === record.activeTaskId) || null;
        }
      } catch { blocked = true; text += ' 停止状态保存失败，请关闭自动恢复后再使用。'; }
    }
    generation += 1;
    stopMediaWatch?.(); stopMediaWatch = null;
    if (timer !== null) unschedule(timer);
    timer = null;
    preparing = pending = grace = loading = confirmWait = sectionConfirm = null;
    if (wasRunning && !complete && task?.current && /人工|播放|媒体已暂停|课节|超时|页面操作未成功|页面读取或操作异常/u.test(text)) problem = { taskId: task.id, courseId: task.current, reason: text };
    if (wasRunning && !complete && !text.startsWith('已暂停，继续学习') && /人工|手动|播放|课节|超时|登录已失效|平台学习限制|待处理/u.test(text)) {
      logPlayback('manual-intervention', { trigger: playbackAttention?.trigger || 'runner-stop' });
    }
    endCourseRetry('stopped');
    clearMediaHealth('runner-stop');
    status = complete ? 'complete' : 'paused';
    message = text;
    if (wasRunning && ownsCurrentLearningPage()) {
      try {
        if (!playbackAttention || leave) pauseOwnedMedia('runner-stop');
        if (leave) {
          if (adapter.leaveLearning(task.subject.route) === false) message += ' 页面操作未能完成，请手动停止学习。';
          else lastOwnedPage = null;
        }
      } catch { message += ' 页面操作未能完成，请手动停止学习。'; }
    }
    release();
    emit();
  };
  const storageError = error => { blocked = true; stop(error.message?.includes('本地') || error.message?.includes('存储') ? error.message : '本地存储读写失败，已停止。', true); return false; };
  const verify = (requireLease = held) => {
    try {
      if (!sameTask(readStored())) { stop('任务已在其他标签更新，请刷新后确认新任务。', true); return false; }
      if (requireLease) {
        const lease = storage.get(wdControllerLeaseKey);
        // The held Web Lock remains exclusive even if background throttling delays lease renewal.
        if (!ownLease(lease)) { stop('执行权限已失效，已暂停；请重新确认任务。', true); return false; }
      }
      return true;
    } catch (error) { return storageError(error); }
  };
  const lease = () => storage.set(wdControllerLeaseKey, { owner, taskId: runTaskId, runId, expiresAt: milliseconds() + 5000 });
  const acquire = async () => {
    if (destroyed || blocked || acquiring) return false;
    if (held) return verify();
    if (!locks || typeof locks.request !== 'function') return tell('浏览器不支持同源执行锁，请使用新版 Chrome 或 Edge。');
    acquiring = true;
    const token = generation;
    return new Promise(resolve => {
      Promise.resolve().then(() => locks.request(wdControllerLock, { mode: 'exclusive', ifAvailable: true }, async lock => {
        acquiring = false;
        if (!lock || destroyed || generation !== token) { resolve(tell('另一标签正在操作任务，请先在那里暂停。')); return; }
        try {
          if (!verify(false)) { resolve(false); return; }
          const foreign = storage.get(wdControllerLeaseKey);
          if (foreign && foreign.expiresAt > milliseconds() && foreign.owner !== owner) { resolve(tell('另一标签正在运行，请先在那里暂停。')); return; }
          held = true;
          runId = unique();
          runTaskId = record?.taskId || null;
          const lifetime = new Promise(finish => { releaseLock = finish; });
          lease();
          resolve(true);
          await lifetime;
        } catch (error) { acquiring = false; storageError(error); resolve(false); }
      })).catch(error => { acquiring = false; blocked = true; stop('无法获取浏览器执行锁，已停止。'); resolve(false); });
    });
  };
  const persist = () => {
    if (!held || !verify()) return false;
    try {
      const next = normalizeQueue({ ...record, revision: (identity?.revision || 0) + 1 });
      storage.set(wdControllerTaskKey, next);
      record = next; identity = { taskId: next.taskId, revision: next.revision };
      task = record.tasks.find(item => item.id === record.activeTaskId) || null;
      if (status === 'complete' && nextEntry()) { status = 'paused'; message = pendingNotice; }
      runTaskId = record.taskId; lease(); emit(); return true;
    } catch (error) { return storageError(error); }
  };
  const ensureRecord = () => { if (!record) record = { version: 2, taskId: unique(), revision: 0, window: copy(defaultWindow), tasks: [], activeTaskId: null }; };
  const watch = () => { if (timer === null) timer = schedule(() => { void tick(); }, 1000); };
  const editable = () => !destroyed && !blocked && !restorePending && !['running', 'preparing', 'waiting'].includes(status);
  const edit = async fn => {
    if (!editable()) return tell('请先暂停，再修改任务。');
    const token = generation;
    if (!await acquire() || token !== generation || !held || !verify()) return false;
    try { return await fn(); } catch (error) { return storageError(error); } finally { release(); }
  };
  const validPage = (page, subject = null) => page.kind === 'subject' && typeof page.subjectId === 'string' && page.title?.trim() && page.route === `#/study/subject/detail/${page.subjectId}` && page.courses?.length && (!subject || (page.subjectId === subject.id && normalizeTitle(page.title) === normalizeTitle(subject.title)));
  const collectPage = (page, refreshId = null) => {
    if (page.relearn?.manualRequired) return tell(`遇到“重新学习”提示。${page.relearn.reason} 处理后请重新读取专区。`);
    const existing = refreshId ? record?.tasks.find(item => item.id === refreshId) : null;
    if (!validPage(page, existing?.subject)) return tell(wdControllerDescribeRecognitionFailure(page, { stage: 'subject', expectedSubject: existing?.subject, timedOut: false }));
    if (refreshId) {
      if (!existing) return false;
      existing.courses = mergeCourses(existing.courses, page.courses, existing.selectionMode);
      if (!persist()) return false;
      message = '课程清单已刷新，勾选和学习记录已保留。' + (nextEntry() ? pendingNotice : ''); emit(); return true;
    }
    candidates = [];
    draft = { target: target || page.title, selectionMode: 'all-pending', subject: { id: page.subjectId, title: page.title, route: page.route }, courses: mergeCourses([], page.courses) };
    message = '已读取待添加清单，请核对课程勾选后添加。'; emit(); return true;
  };
  const collectDraft = async () => edit(() => { try { return collectPage(adapter.read()); } catch { return tell('当前页面读取失败，请稍后重试。'); } });
  const draftSetSelection = (id, selected) => {
    if (!editable() || !draft) return false;
    const course = draft.courses.find(item => item.id === id); if (!course) return false;
    course.selected = Boolean(selected); emit(); return true;
  };
  const selectCourses = (taskId, mode) => {
    if (!['unfinished', 'required', 'none', 'completed'].includes(mode) || !editable()) return false;
    const apply = (courses, item = null) => {
      for (const course of courses) course.selected = Boolean((mode === 'completed' ? course.selected || course.status === 'completed' || item?.done.includes(course.id) : mode !== 'none' && ['not-started', 'learning'].includes(course.status) && !isDone(item, course.id)) && (mode !== 'required' || course.required) && (item?.scope !== 'required' || course.required));
      emit(); return true;
    };
    if (taskId === null) return draft ? apply(draft.courses) : false;
    return edit(() => { const item = record?.tasks.find(item => item.id === taskId); return item ? apply(item.courses, item) && persist() : false; });
  };
  const discardDraft = () => { if (!editable()) return false; draft = null; candidates = []; target = ''; emit(); return true; };
  const addDraft = async () => edit(() => {
    if (!draft) return tell('请先读取待添加清单。');
    if (record?.tasks.some(item => item.subject?.id === draft.subject.id)) return tell('该专题已在任务队列中，请刷新已有清单。');
    ensureRecord(); const next = { id: unique(), ...copy(draft), scope: 'all', done: [], skipped: [], current: null };
    record.tasks.push(next); if (!record.activeTaskId) record.activeTaskId = next.id;
    if (!persist()) return false; draft = null; candidates = []; target = ''; message = '专题已加入队列，可继续添加其他专题。' + (nextEntry() ? pendingNotice : ''); emit(); return true;
  });
  const setSelection = async (taskId, id, selected) => edit(() => {
    const item = record?.tasks.find(item => item.id === taskId)?.courses.find(course => course.id === id); if (!item) return false;
    item.selected = Boolean(selected); return persist();
  });
  const setTaskMode = async (taskId, mode) => {
    if (!['all-pending', 'specific'].includes(mode) || !editable()) return false;
    const apply = item => {
      if (!item) return false;
      if (item.selectionMode === mode) return true;
      item.selectionMode = mode;
      for (const course of item.courses) course.selected = mode === 'all-pending' && ['not-started', 'learning'].includes(course.status) && !isDone(item, course.id) && (item.scope !== 'required' || course.required);
      return true;
    };
    if (taskId === null) { const changed = apply(draft); if (changed) emit(); return changed; }
    return edit(() => { const item = record?.tasks.find(item => item.id === taskId); return apply(item) && persist(); });
  };
  const recheckCompleted = async taskId => edit(() => {
    const item = record?.tasks.find(item => item.id === taskId);
    if (!item) return false;
    const ids = item.courses.filter(course => course.selected && (item.scope === 'all' || course.required) && (item.done.includes(course.id) || course.status === 'completed')).map(course => course.id);
    if (!ids.length) return tell('请先勾选需要复查的已完成课程。');
    item.recheck = [...new Set([...(item.recheck || []), ...ids])];
    item.skipped = item.skipped.filter(id => !ids.includes(id)); item.deferred = (item.deferred || []).filter(entry => !ids.includes(entry.courseId));
    if (!persist()) return false;
    message = `已安排 ${ids.length} 门课程复查，请点击开始；将核对课节状态，只学习未完成内容。`; emit(); return true;
  });
  const removeTask = async taskId => edit(() => {
    if (!record?.tasks.some(item => item.id === taskId)) return false;
    record.tasks = record.tasks.filter(item => item.id !== taskId);
    if (record.activeTaskId === taskId) record.activeTaskId = record.tasks[0]?.id || null;
    if (problem?.taskId === taskId) problem = null;
    return persist();
  });
  const clearCompletedTasks = async () => {
    if (destroyed || blocked || restorePending || status === 'preparing') return false;
    const running = ['running', 'waiting'].includes(status);
    const clear = () => {
      const removed = new Set(record?.tasks.filter(item => isTaskComplete(item) && !(running && item.id === record.activeTaskId)).map(item => item.id));
      if (!removed.size) return false;
      record.tasks = record.tasks.filter(item => !removed.has(item.id));
      if (removed.has(record.activeTaskId)) { record.activeTaskId = record.tasks[0]?.id || null; currentSectionTitle = ''; currentPlayback = null; }
      if (removed.has(problem?.taskId)) problem = null;
      if (!persist()) return false;
      message = `已清除 ${removed.size} 个已完成专区。`; emit(); return true;
    };
    if (running) { try { return held && verify() ? clear() : false; } catch (error) { return storageError(error); } }
    return edit(clear);
  };
  const moveTask = async (taskId, index) => {
    if (destroyed || blocked || restorePending || status === 'preparing') return false;
    const move = () => {
      const from = record?.tasks.findIndex(item => item.id === taskId) ?? -1;
      if (from < 0 || !Number.isInteger(index) || index < 0 || index >= record.tasks.length) return false;
      if (from === index) return true;
      const [item] = record.tasks.splice(from, 1); record.tasks.splice(index, 0, item);
      return persist();
    };
    if (['running', 'waiting'].includes(status)) return held && verify() ? move() : false;
    return edit(move);
  };
  const setWindow = async window => {
    if (!validWindow(window)) return tell('请填写合法北京时间（结束时间可填24:00）。');
    return edit(() => { ensureRecord(); record.window = { start: window.start, end: window.end }; return persist(); });
  };
  const setAutomation = async value => {
    if (!value || typeof value.enabled !== 'boolean' || typeof value.resumeOnReload !== 'boolean' || (value.mute !== undefined && typeof value.mute !== 'boolean')) return false;
    return edit(() => { ensureRecord(); record.automation = { enabled: value.enabled, resumeOnReload: value.enabled && value.resumeOnReload, mute: value.mute ?? record.automation?.mute ?? true }; record.runRequested = false; return persist(); });
  };
  const prepareSubject = (candidate, refreshId = null) => {
    status = 'preparing'; preparing = { stage: 'subject', candidate, refreshId, since: milliseconds() }; message = '正在打开专题，请等待课程加载。'; watch(); emit();
    if (!adapter.openSubject(candidate)) { stop('无法打开专题，请手动打开后读取。'); return false; } return true;
  };
  const subjectTitleIssue = page => {
    if (preparing?.stage !== 'subject' || page.kind !== 'subject' || page.subjectId !== preparing.candidate.id || !page.courses?.length) return '';
    if (!page.title?.trim()) return '未识别当前专题标题（页面未就绪），已暂停。依据：未从 .subject-banner/.banner-info .title-row .h3、introduce .h3 或 document.title 读到标题。请查看页面诊断后重试读取。';
    if (normalizeTitle(page.title) !== normalizeTitle(preparing.candidate.title)) return '当前专题标题与所选结果不一致，已暂停。依据：专题标题规范化比对不匹配。请核对专区后重试。';
    return '';
  };
  const refreshTask = async taskId => {
    if (!editable()) return tell('请先暂停，再刷新任务。');
    const item = record?.tasks.find(item => item.id === taskId); if (!item?.subject) return false;
    const token = generation; if (!await acquire() || token !== generation || !held || !verify()) return false;
    return prepareSubject(item.subject, taskId);
  };
  const search = async value => {
    if (!editable() || typeof value !== 'string' || !value.trim()) return tell('请先暂停并填写专区名称。');
    const token = generation; if (!await acquire() || token !== generation || !held || !verify()) return false;
    target = value.trim(); draft = null; status = 'preparing'; candidates = []; preparing = { stage: 'search-page', since: milliseconds() }; message = '正在打开专题搜索。'; watch(); emit();
    if (!adapter.goSearch()) { stop('无法进入搜索页，请手动进入后重试。'); return false; } return true;
  };
  const chooseCandidate = async id => {
    if (!editable()) return false;
    const candidate = candidates.find(item => item.id === id), token = generation;
    if (!candidate || !await acquire() || token !== generation || !held || !verify()) return false;
    return prepareSubject(candidate);
  };
  const queue = (item = task) => item ? item.courses.filter(course => course.selected && (item.scope === 'all' || course.required)) : [];
  const nextEntry = () => {
    for (const item of record?.tasks || []) {
      const course = queue(item).find(course => !isDone(item, course.id) && !item.skipped.includes(course.id) && !item.deferred?.some(entry => entry.courseId === course.id));
      if (course) return { item, course };
    }
    return null;
  };
  const matchesCourse = (page, course) => page.kind === 'course' && page.courseId === course.id && page.subjectId === task.subject.id && page.route === course.route;
  const pauseForRelearn = (page, current) => {
    if (!page.relearn?.manualRequired || !(matchesCourse(page, current) || (page.kind === 'course-relearn' && page.courseId === current.id) || (['subject', 'subject-relearn'].includes(page.kind) && page.subjectId === task.subject.id))) return false;
    stop(`遇到“重新学习”提示。${page.relearn.reason} 处理后请手动继续队列。`); notify(message); return true;
  };
  const muteCourse = course => {
    if (status !== 'running' || !held || !runId || record?.automation?.mute === false) return;
    try { adapter.muteCurrentMedia?.(course, runId); } catch { /* Muting an unavailable player must not interrupt learning. */ }
  };
  const watchMedia = () => {
    stopMediaWatch?.(); stopMediaWatch = null;
    if (record?.automation?.mute === false) return;
    try {
      stopMediaWatch = adapter.watchCurrentMedia?.(() => {
        if (destroyed || status !== 'running' || !held || recovery) return;
        if (!isWithinWindow(now(), record.window)) { waitWindow(); return; }
        if (!verify()) return;
        const current = queue().find(course => course.id === task.current);
        if (current) muteCourse(current);
      }) || null;
    } catch { /* Polling still applies muting if media events cannot be watched. */ }
  };
  const start = async (preferred = null) => {
    if (!editable() || !record || !record.tasks.length) return tell('请先添加专题任务。');
    if (!isWithinWindow(now(), record.window) && !record.automation.enabled) return tell('当前不在允许的北京时间学习时段内。');
    const preferredTask = preferred && record.tasks.find(item => item.id === preferred.taskId);
    const preferredCourse = queue(preferredTask).find(course => course.id === preferred.courseId && course.selected && !isDone(preferredTask, course.id) && !preferredTask.skipped.includes(course.id) && !preferredTask.deferred?.some(entry => entry.courseId === course.id));
    const entry = preferredCourse ? { item: preferredTask, course: preferredCourse } : nextEntry();
    if (!entry || !entry.item.subject) return tell(record.tasks.some(item => item.deferred?.length) ? '仍有待处理课程，请在详情中重试。' : record.tasks.some(item => item.skipped.length) ? '仍有跳过课程未完成，请重试。' : '请勾选尚未核对的课程。');
    const token = generation;
    if (!await acquire() || token !== generation || !held || !verify()) return false;
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id; problem = null; currentSectionTitle = ''; currentPlayback = null;
    playbackAttention = null;
    record.runRequested = record.automation.enabled;
    if (!persist()) return false;
    generation += 1; restorePending = false; status = isWithinWindow(now(), record.window) ? 'running' : 'waiting'; needOpen = true;
    if (retries.size) {
      const previous = retries.get(retryKey()) || 0;
      retries.clear();
      if (previous) logPlayback('failure-count', { counter: 'course', previous, reason: 'runner-start' });
    }
    clearMediaHealth('runner-start');
    pending = grace = loading = confirmWait = sectionConfirm = recovery = null;
    message = status === 'waiting' ? `等待学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。` : '正在按平台课节状态连续学习。';
    if (status === 'waiting') waitWindow();
    else { watchMedia(); muteCourse(entry.course); }
    watch(); emit(); return true;
  };
  const pause = async () => {
    restorePending = false;
    if (!held && record?.runRequested && !await acquire()) { stop('无法暂停其他标签正在执行的任务，请到执行标签点击暂停。'); return false; }
    playbackAttention = null;
    if (status !== 'running' && status !== 'preparing' && ownsCurrentLearningPage()) {
      try {
        pauseOwnedMedia('assistant-paused');
        if (adapter.leaveLearning(task.subject.route) === false) { stop('页面未能停止，请手动退出学习页。'); return false; }
        lastOwnedPage = null;
      } catch { stop('页面未能停止，请手动退出学习页。'); return false; }
    }
    stop('已暂停，继续学习需手动点击开始。', true);
    clearCourseRetries('assistant-paused');
    return true;
  };
  const waitFor = (key, reason) => {
    if (loading?.key !== key) loading = { key, since: milliseconds() };
    const since = pending?.kind === 'course' ? pending.arrivedAt ?? loading.since : loading.since;
    if (visibility === 'visible' && milliseconds() - Math.max(since, visibleSince) >= 30000) recover(`${reason}，加载超时。`, { cause: 'load-timeout' });
  };
  const action = (fn, expectation) => {
    if (!verify() || status !== 'running') return;
    currentPlayback = null;
    if (!fn()) { recover('页面操作未成功。', { cause: 'page-action' }); return; }
    pending = { ...expectation, since: milliseconds() };
    loading = confirmWait = null;
    if (expectation.kind === 'course') { sectionConfirm = null; lastOwnedPage = null; }
  };
  const nextCourse = (page, leaveWhenDone = true) => {
    currentPlayback = null;
    const entry = nextEntry();
    if (!entry) {
      const count = record.tasks.reduce((n, item) => n + (item.deferred?.length || 0), 0);
      if (count) {
        stop(`队列已执行完，仍有 ${count} 门待处理课程${record.tasks.some(item => item.skipped.length) ? '及跳过课程' : ''}；请在详情中查看原因并重试。`, leaveWhenDone);
        if (!playbackAttention) notify(message);
        return;
      }
      if (record.tasks.some(item => item.skipped.length)) { stop('其他课程已核对，仍有跳过课程未完成，请重试。', true); return; }
      stop('所选课程已全部完成。', true, true); notify('所选课程已完成。'); return;
    }
    generation += 1;
    clearMediaHealth('course-changed');
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id;
    if (!persist()) return;
    grace = loading = confirmWait = sectionConfirm = recovery = null; lastOwnedPage = null; currentSectionTitle = '';
    if (matchesCourse(page, entry.course)) { pending = null; return; }
    action(() => adapter.openCourse(entry.course), { kind: 'course', id: entry.course.id, before: page.route });
  };
  const rememberPlaybackAttention = (page, trigger, deferredReason = null) => {
    playbackAttention = { taskId: task.id, courseId: task.current, route: page.route,
      sectionId: page.activeSectionId, playerId: page.player?.id, baseline: page.media.currentTime ?? null,
      seekRevision: page.player?.seekRevision, trigger, deferredReason };
  };
  const deferCurrent = (reason, leave = true, trigger = 'platform-or-course', playback = null) => {
    if (!verify() || status !== 'running') return;
    logPlayback('manual-intervention', { trigger, disposition: 'deferred' });
    generation += 1;
    endCourseRetry('deferred');
    clearMediaHealth('course-deferred');
    pending = grace = loading = confirmWait = sectionConfirm = null;
    const page = adapter.read();
    const owned = ownsCurrentLearningPage();
    if (owned) {
      if (!playback || leave) pauseOwnedMedia('course-deferred');
      if (leave && adapter.leaveLearning(task.subject.route) === false) { stop('未能退出当前学习页，请手动退出后继续。'); notify(message); return; }
      lastOwnedPage = null;
    }
    task.deferred = [...(task.deferred || []).filter(item => item.courseId !== task.current), { courseId: task.current, reason }];
    if (!persist()) return;
    if (playback && !leave && owned) {
      if (nextEntry()) pauseOwnedMedia('course-deferred');
      else rememberPlaybackAttention(playback, trigger, reason);
    }
    message = `课程已放入待处理：${reason} 继续后续课程。`; emit();
    nextCourse(page, leave);
  };
  const recover = (reason, { reopen = true, cause, playback } = {}) => {
    currentPlayback = null;
    if (!record?.automation.enabled) {
      if (playback && !reopen) rememberPlaybackAttention(playback, cause);
      stop(`${reason} ${reopen ? '已暂停并退出学习页，请人工确认。' : '请在当前页手动播放后再继续。'}`, reopen);
      return;
    }
    if (!verify() || status !== 'running') return;
    const key = retryKey(), previous = retries.get(key) || 0, attempt = previous + 1;
    if (attempt > 3) { deferCurrent(`${reason} 已重试三次。`, reopen, cause, playback); return; }
    generation += 1;
    if (playback && !reopen) endMediaRequest('cancelled', 'course-retry');
    else clearMediaHealth('course-retry');
    pending = grace = loading = confirmWait = sectionConfirm = null;
    retries.set(key, attempt);
    logPlayback('failure-count', { counter: 'course', previous, reason: cause });
    if (reopen && ownsCurrentLearningPage()) {
      pauseOwnedMedia('course-retry');
      if (adapter.leaveLearning(task.subject.route) === false) { stop('重试前未能退出学习页，请手动退出后继续。'); notify(message); return; }
      lastOwnedPage = null;
    }
    const delayMs = [5000, 10000, 20000][attempt - 1];
    recovery = { until: milliseconds() + delayMs, reopen, before: adapter.read().route, attempt };
    logPlayback('retry-start', { attempt, delayMs, mode: reopen ? 'reopen' : 'in-place', reason: cause });
    message = `${reason} 正在等待重试 ${attempt}/3。`; emit();
  };
  const waitWindow = () => {
    currentPlayback = null;
    stopMediaWatch?.(); stopMediaWatch = null;
    if (!record.automation.enabled) { stop('已到学习时段边界，已停止媒体并退出学习页。', true); return; }
    if (ownsCurrentLearningPage()) {
      try {
        pauseOwnedMedia('schedule-ended');
        if (adapter.leaveLearning(task.subject.route) === false) throw Error();
        lastOwnedPage = null;
      } catch { stop('学习时段结束，但未能退出学习页，请手动停止。', true); notify(message); return; }
    }
    generation += 1;
    endCourseRetry('schedule-ended');
    clearMediaHealth('schedule-ended');
    pending = grace = loading = confirmWait = sectionConfirm = null; needOpen = true;
    status = 'waiting'; message = `等待下次学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。`; emit();
  };
  const retry = async (taskId = problem?.taskId, courseId = problem?.courseId) => {
    logPlayback('retry-start', { mode: 'manual' });
    const changed = await edit(() => {
      const item = record?.tasks.find(item => item.id === taskId);
      if (!item?.courses.some(course => course.id === courseId)) return false;
      item.skipped = item.skipped.filter(id => id !== courseId);
      if (!item.recheck?.includes(courseId)) item.done = item.done.filter(id => id !== courseId);
      item.deferred = (item.deferred || []).filter(entry => entry.courseId !== courseId);
      item.courses.find(course => course.id === courseId).selected = true;
      record.activeTaskId = item.id; item.current = courseId; problem = null; return persist();
    });
    const started = changed && await start({ taskId, courseId });
    logPlayback('retry-end', { mode: 'manual', outcome: started ? 'started' : 'not-started' });
    return started;
  };
  const skipCurrent = async () => {
    const skipped = await edit(() => {
      if (!problem) return false;
      const item = record?.tasks.find(item => item.id === problem.taskId);
      const course = item?.courses.find(course => course.id === problem.courseId); if (!course) return false;
      if (!item.skipped.includes(problem.courseId)) item.skipped.push(problem.courseId);
      if (!item.recheck?.includes(problem.courseId)) item.done = item.done.filter(id => id !== problem.courseId);
      problem = null;
      if (!persist()) return false;
      try {
        const page = adapter.read();
        const owned = page.kind === 'course' && page.courseId === course.id && page.subjectId === item.subject?.id && page.route === course.route;
        if (owned) {
          pauseOwnedMedia('course-skipped');
          if (adapter.leaveLearning(item.subject.route) === false) return tell('课程已跳过，但未能退出学习页，请手动退出后继续。');
        }
      } catch { return tell('课程已跳过，但页面操作未能完成，请手动退出学习页后继续。'); }
      return true;
    });
    if (!skipped) return false;
    if (!nextEntry()) { tell('仍有跳过课程未完成，请重试。'); return true; }
    return start();
  };
  const settleMediaRequest = (health, request, current, result) => {
    if (destroyed || status !== 'running' || mediaHealth !== health || health.request !== request) return;
    try {
      refreshVisibility();
      if (!isWithinWindow(now(), record.window)) { waitWindow(); return; }
      if (!verify()) return;
      const latest = adapter.read();
      if (pauseForRelearn(latest, current)) return;
      if (!matchesCourse(latest, current) || latest.activeSectionId !== request.sectionId || latest.player?.id !== health.playerId) return;
      request.result = result;
      observePlayback(latest);
      logPlayback('play-result', { mode: request.resume ? 'resume' : 'start', result, nativeError: request.nativeError ?? null });
    } catch {
      if (status === 'running' && mediaHealth === health) stop('页面读取或操作异常，已暂停并退出学习页，请人工确认。', true);
    }
  };
  const readProgress = (page, observation) => {
    const media = page.media;
    const time = Number.isFinite(media.currentTime) ? media.currentTime : null;
    const seeking = page.player?.seeking || observation.seekRevision !== page.player?.seekRevision;
    observation.seekRevision = page.player?.seekRevision;
    if (observation.baseline === null || seeking || (time !== null && time < observation.baseline)) observation.baseline = time;
    if (media.paused || media.ended || seeking || time === null) return 0;
    const delta = time - observation.baseline;
    if (delta < wdControllerProgressDelta) return 0;
    observation.baseline = time;
    return delta;
  };
  const observeProgress = (page, health) => {
    const delta = readProgress(page, health);
    if (!delta) return false;
    const source = health.source || 'unattributed';
    if (health.request || health.pauseSince !== null || recovery || milliseconds() >= health.sampleAt) {
      logPlayback('progress', { delta: Math.round(delta * 1000) / 1000, source });
      health.sampleAt = milliseconds() + 10000;
    }
    if (health.request) endMediaRequest('progress', 'current-time-advanced');
    else if (health.pauseSince !== null || recovery) {
      logPlayback('recovery-result', { mode: 'resume', outcome: 'progress', reason: 'observed-resume', source });
    }
    if (health.failures) {
      const previous = health.failures;
      health.failures = 0;
      logPlayback('failure-count', { counter: 'resume', previous, reason: 'current-time-advanced' });
    }
    clearCourseRetries('current-time-advanced');
    health.nextAt = 0;
    health.pauseSince = null;
    health.userPaused = false;
    if (recovery) endCourseRetry('playback-confirmed');
    if (message.startsWith('播放已暂停，正在自动恢复播放') || message.startsWith('播放器已手动暂停') || message.includes('正在等待重试')) {
      message = '正在按平台课节状态连续学习。';
    }
    return true;
  };
  const samePlayer = (page, tracked) => page.activeSectionId === tracked.sectionId && page.player?.id === tracked.playerId;
  const canObservePlayback = (page, current) => Boolean(
    matchesCourse(page, current) && !page.relearn?.manualRequired && page.sectionListReady !== false
    && page.media && page.mediaTarget?.status !== 'ambiguous' && page.mediaTarget?.status !== 'none'
    && !page.issues?.some(issue => !issue.includes('媒体播放器'))
    && page.sections.some(section => section.id === page.activeSectionId && section.courseId === current.id
      && (task.scope === 'all' || section.required) && [5, 6].includes(section.type) && ['learning', 'not-started'].includes(section.status))
  );
  const observeMediaSignal = (page, signal, tracked, recordEvent = true) => {
    if (!signal || !page.media || page.player?.id !== signal.id || signal.event === 'timeupdate') return;
    if (recordEvent) logPlayback(signal.event === 'control-input' ? 'control-input' : 'media-event',
      { mediaEvent: signal.event, source: signal.source, trusted: signal.trusted, action: signal.action });
    if (!tracked || !samePlayer(page, tracked)) return;
    if (signal.event === 'pause' && page.media.paused) {
      tracked.pauseSource = signal.source;
      if (signal.source === 'user' && status === 'running') {
        tracked.userPaused = true;
        endMediaRequest('cancelled', 'player-control-paused');
        message = '播放器已手动暂停，点击播放器继续。';
      }
    } else if (['play', 'playing'].includes(signal.event) && !page.media.paused) {
      tracked.source = signal.source;
      if (signal.event === 'play' && signal.source === 'user' && tracked.request) tracked.request.since = milliseconds();
    }
  };
  const trackPlayer = (page, key, signal) => {
    if (mediaHealth?.key === key && samePlayer(page, mediaHealth)) return;
    clearMediaHealth('player-changed');
    mediaHealth = { key, sectionId: page.activeSectionId, playerId: page.player?.id, started: false, baseline: null,
      wasPaused: false, failures: 0, nextAt: 0, sampleAt: 0, request: null };
    observeMediaSignal(page, signal, mediaHealth, false);
  };
  const observePlaybackAttention = async (page, signal) => {
    const attention = playbackAttention;
    const current = task?.courses.find(course => course.id === attention?.courseId);
    if (!attention || attention.confirming || status !== 'paused' || task?.id !== attention.taskId || task.current !== attention.courseId
      || !current || !canObservePlayback(page, current) || !samePlayer(page, attention)) return;
    observeMediaSignal(page, signal, attention);
    const delta = readProgress(page, attention);
    if (!delta) return;
    attention.confirming = true;
    const source = attention.source || 'unattributed';
    logPlayback('progress', { delta: Math.round(delta * 1000) / 1000, source });
    if (attention.deferredReason) {
      const removed = await edit(() => {
        const latest = adapter.read();
        if (playbackAttention !== attention || !canObservePlayback(latest, current) || !samePlayer(latest, attention)
          || latest.media.paused || latest.media.ended) return false;
        const deferred = task.deferred.filter(item => item.courseId !== attention.courseId || item.reason !== attention.deferredReason);
        if (deferred.length === task.deferred.length) return false;
        task.deferred = deferred;
        return persist();
      });
      if (!removed) { logPlayback('attention-clear-blocked', { trigger: attention.trigger }); return; }
    }
    if (playbackAttention !== attention || status !== 'paused') return;
    playbackAttention = null;
    if (problem?.taskId === attention.taskId && problem.courseId === attention.courseId) problem = null;
    clearCourseRetries('manual-playback-confirmed');
    logPlayback('intervention-cleared', { trigger: attention.trigger, source });
    message = '播放器已恢复播放。助手队列仍暂停。';
    emit();
  };
  const checkPlayback = (page, current, active, health) => {
    const media = page.media;
    const at = milliseconds();
    const time = Number.isFinite(media.currentTime) ? media.currentTime : null;
    if (media.paused && !health.wasPaused) {
      health.pauseSince = at;
      logPlayback('pause-detected', { mode: health.started ? 'resume' : 'start', source: health.pauseSource || 'unattributed' });
    }
    health.wasPaused = media.paused;
    if (!media.paused) {
      health.started = true;
      health.pauseSource = null;
      if (health.request) health.request.unpausedSince ??= at;
    } else if (health.request) health.request.unpausedSince = null;
    observeProgress(page, health);
    if (health.userPaused) return;
    if (page.online === false) return;
    const request = health.request;
    if (request) {
      if (visibility !== 'visible') return;
      const timeout = request.result === 'pending' || !media.paused ? wdControllerPlayTimeout : wdControllerProgressTimeout;
      if (at - Math.max(request.since, visibleSince, request.unpausedSince ?? -Infinity) < timeout) return;
      const reason = ({ pending: 'request-timeout', refused: 'play-refused', rejected: 'play-rejected' })[request.result] || 'no-progress';
      endMediaRequest('failed', reason);
      if (request.resume) {
        const previous = health.failures;
        health.failures += 1;
        logPlayback('failure-count', { counter: 'resume', previous, reason });
      }
      if (!media.paused) {
        rememberPlaybackAttention(page, 'stalled');
        stop('播放进度持续未推进，请在当前页检查播放器后继续。');
        return;
      }
      if (!request.resume) {
        const timedOut = request.result === 'pending';
        const summary = ({ pending: '播放请求超时。', refused: '浏览器未能自动播放。', rejected: '播放失败。' })[request.result] || '播放未能推进。';
        recover(summary, { reopen: timedOut, cause: reason, playback: page });
        return;
      }
      if (health.failures > wdControllerResumeBackoff.length) {
        rememberPlaybackAttention(page, 'resume-exhausted');
        stop('自动恢复播放连续 3 次未能推进，请在当前页检查播放器后继续。');
        return;
      }
      health.nextAt = at + wdControllerResumeBackoff[health.failures - 1];
      return;
    }
    if (!media.paused || at < health.nextAt) return;
    if (visibility === 'hidden') {
      if (attemptedWhileHidden) return;
      attemptedWhileHidden = true;
    } else if (health.started && at - Math.max(health.pauseSince ?? at, visibleSince) < wdControllerPauseGrace) return;

    const resume = health.started;
    const attempt = { sectionId: active.id, since: at, resume, result: 'pending' };
    health.baseline = time;
    health.request = attempt;
    if (resume && visibility === 'visible') message = `播放已暂停，正在自动恢复播放（${health.failures + 1}/3）。`;
    logPlayback('play-attempt', { mode: resume ? 'resume' : 'start', muted: record.automation.mute, source: 'assistant' });
    const expected = { route: page.route, sectionId: active.id, playerId: health.playerId,
      onNativeError: name => { attempt.nativeError = name; } };
    Promise.resolve(adapter.playCurrentMedia(record.automation.mute, expected)).then(
      success => settleMediaRequest(health, attempt, current, success ? 'accepted' : 'refused'),
      () => settleMediaRequest(health, attempt, current, 'rejected'),
    );
  };
  const tick = async (signal = null) => {
    refreshVisibility();
    if (restorePending && !destroyed) { restorePending = false; await start({ taskId: record.activeTaskId, courseId: task?.current }); if (status === 'paused' && timer !== null) { unschedule(timer); timer = null; } return; }
    // Boundary and ownership checks also run while a media.play promise is pending.
    if (destroyed || !['running', 'preparing', 'waiting'].includes(status)) return;
    if (status === 'running' && !isWithinWindow(now(), record.window)) { waitWindow(); return; }
    if (!verify()) return;
    try { lease(); } catch (error) { storageError(error); return; }
    if (ticking) return;
    ticking = true;
    currentPlayback = null;
    try {
      const page = adapter.read();
      observePlayback(page);
      if (playbackLog.enabled) {
        const checkedAt = milliseconds();
        const gapMs = lastDiagnosticTick === null ? 0 : checkedAt - lastDiagnosticTick;
        if (gapMs >= 3000) logPlayback('tick-gap', { gapMs });
        lastDiagnosticTick = checkedAt;
      }
      if (page.kind === 'login' || page.kind === 'study-error') {
        logPlayback('platform-stop', { source: 'platform', trigger: page.kind === 'login' ? 'login' : page.errorCode === '1' ? 'other-window' : 'study-restriction' });
        stop(page.kind === 'login' ? '登录已失效，请重新登录后继续。' : page.errorCode === '1' ? '其他学习窗口已接管播放，请关闭其他窗口后手动继续。' : '平台学习限制提示，请在当前页面处理后继续。'); notify(message); return;
      }
      if (status === 'waiting') {
        if (isWithinWindow(now(), record.window)) { status = 'running'; needOpen = true; watchMedia(); message = '已进入学习时段，正在继续队列。'; emit(); }
        return;
      }
      if (status === 'running' && record.automation.enabled && page.online === false) {
        if (!recovery?.network) {
          generation += 1;
          endCourseRetry('offline');
          clearMediaHealth('offline');
          pending = grace = loading = confirmWait = sectionConfirm = null;
          if (ownsCurrentLearningPage()) {
            pauseOwnedMedia('offline');
            if (adapter.leaveLearning(task.subject.route) === false) { stop('断网后未能退出学习页，请手动退出。'); notify(message); return; }
            lastOwnedPage = null;
          }
          recovery = { network: true, before: adapter.read().route };
          message = '网络已断开，等待网络恢复后继续；当前课程未计为完成。'; emit();
        }
        return;
      }
      if (status === 'preparing') {
        if (preparing.stage === 'subject' && page.relearn?.manualRequired && page.subjectId === preparing.candidate.id && ['subject', 'subject-relearn'].includes(page.kind)) {
          stop(`遇到“重新学习”提示。${page.relearn.reason} 处理后请重新读取专区。`); notify(message); return;
        }
        if (milliseconds() - preparing.since >= 30000) {
          stop(subjectTitleIssue(page) || wdControllerDescribeRecognitionFailure(page, { stage: preparing.stage, expectedSubject: preparing.candidate || null, timedOut: true }));
          return;
        }
        if (preparing.stage === 'search-page' && page.kind === 'search') {
          if (adapter.searchKeyword(target)) preparing = { stage: 'results', since: milliseconds() };
        } else if (preparing.stage === 'results' && page.kind === 'search' && page.candidates?.length) {
          candidates = page.candidates.map(({ id, title, route }) => ({ id, title, route }));
          const exact = candidates.filter(item => normalizeTitle(item.title) === normalizeTitle(target));
          if (exact.length === 1) {
            preparing = { stage: 'subject', candidate: exact[0], since: milliseconds() };
            if (!adapter.openSubject(exact[0])) stop('无法打开专题，请手动打开后读取。');
          } else stop('请点击确认要学习的专题。');
          emit();
        } else if (preparing.stage === 'subject' && page.kind === 'subject' && page.subjectId === preparing.candidate.id && page.title && normalizeTitle(page.title) === normalizeTitle(preparing.candidate.title) && page.courses?.length) {
          if (collectPage(page, preparing.refreshId)) stop(message);
        }
        return;
      }
      const current = queue().find(course => course.id === task.current);
      if (!current) { stop('当前课程不在已选清单中。', true); return; }
      if (pauseForRelearn(page, current)) return;
      observeMediaSignal(page, signal, mediaHealth);
      if (recovery?.reopen === false && mediaHealth && mediaHealth.sectionId === page.activeSectionId && canObservePlayback(page, current)) {
        trackPlayer(page, mediaHealth.key, signal);
        observeProgress(page, mediaHealth);
        if (mediaHealth.userPaused) return;
      }
      if (recovery) {
        const onTarget = matchesCourse(page, current);
        const onExpectedSubject = recovery.reopen !== false && page.route === task.subject.route;
        if (page.route !== recovery.before && !onExpectedSubject && !onTarget) { stop('页面已离开目标课程，请确认后重新开始。'); return; }
        if (!recovery.network && (visibility !== 'visible' || milliseconds() < recovery.until)) return;
        endCourseRetry(onTarget ? 'in-place' : 'reopen');
        if (!onTarget) {
          message = '正在重新进入课程。';
          action(() => adapter.openCourse(current), { kind: 'course', id: current.id, before: page.route });
          return;
        }
        message = '正在按平台课节状态连续学习。';
      }
      if (needOpen) {
        needOpen = false;
        if (!matchesCourse(page, current)) { action(() => adapter.openCourse(current), { kind: 'course', id: current.id, before: page.route }); return; }
      }
      if (pending) {
        const onTarget = matchesCourse(page, current);
        if (onTarget && pending.kind === 'course') {
          // The hash changes before the SPA mounts the new course and its player.
          pending.arrivedAt ??= milliseconds();
        } else if (onTarget && page.activeSectionId === pending.id) {
          pending = null;
        } else {
          if (!onTarget && (pending.arrivedAt !== undefined || page.route !== pending.before)) { stop('页面已离开目标课程，请确认后重新开始。'); return; }
          if (visibility === 'visible' && milliseconds() - Math.max(pending.since, visibleSince) >= 30000) recover('页面切换超时。', { cause: 'navigation-timeout' });
          return;
        }
      }
      if (!matchesCourse(page, current)) {
        lastOwnedPage = null;
        sectionConfirm = null;
        confirmWait = null;
        const entry = nextEntry();
        const next = entry?.course;
        if (isDone(task, current.id) && next && page.subjectId === entry.item.subject?.id && page.courseId === next.id && page.route === next.route) { nextCourse(page); return; }
        const nativeNext = task.courses[task.courses.findIndex(course => course.id === current.id) + 1];
        if (isDone(task, current.id) && grace?.key === `course:${current.id}` && next && nativeNext && matchesCourse(page, nativeNext)) {
          // The site advanced within the just-completed course's subject before applying the new queue order.
          pauseOwnedMedia('course-changed'); nextCourse(page); return;
        }
        stop('页面已离开目标课程，请确认后重新开始。'); return;
      }
      lastOwnedPage = { taskId: task.id, courseId: current.id, route: page.route };
      muteCourse(current);
      if (isDone(task, current.id)) {
        if (!grace || milliseconds() - grace.since >= 6000) nextCourse(page);
        return;
      }
      const sections = page.sections || [];
      const structuralIssue = page.issues?.some(issue => !issue.includes('媒体播放器'));
      if (page.sectionListReady === false) {
        sectionConfirm = null;
        confirmWait = null;
        waitFor('section-list', page.sectionListReason || '课节清单尚未加载完成');
        return;
      }
      if (structuralIssue || !sections.length || sections.some(item => item.courseId !== current.id) || sections.filter(item => item.active).length > 1) {
        sectionConfirm = null;
        confirmWait = null;
        waitFor('structure', page.recognition?.basis || '课程课节尚未可靠加载');
        return;
      }
      const inScope = sections.filter(item => task.scope === 'all' || item.required);
      if (inScope.some(item => !['learning', 'not-started', 'completed'].includes(item.status))) {
        confirmWait = null;
        waitFor('status', '课节状态无法识别');
        return;
      }
      const sectionKey = `${task.id}:${current.id}`;
      const sectionIds = sections.map(item => item.id).join(',');
      if (sectionConfirm?.key === sectionKey && sectionConfirm.ids === sectionIds) sectionConfirm.ticks += 1;
      else sectionConfirm = { key: sectionKey, ids: sectionIds, ticks: 1 };
      const sectionListConfirmed = page.sectionListConfirmed === true || sectionConfirm.ticks >= 2;
      const active = sections.find(item => item.id === page.activeSectionId);
      if (active && (task.scope === 'all' || active.required) && [5, 6].includes(active.type) && page.media && page.mediaTarget?.status !== 'ambiguous') {
        currentPlayback = { taskId: task.id, courseId: current.id, sectionId: active.id, paused: Boolean(page.media.paused), ended: Boolean(page.media.ended),
          currentTime: Number.isFinite(page.media.currentTime) && page.media.currentTime >= 0 ? page.media.currentTime : null,
          duration: Number.isFinite(page.media.duration) && page.media.duration > 0 ? page.media.duration : null };
      }
      currentSectionTitle = active?.title || '';
      const decision = decideLearningAction(page, { status, scope: task.scope });
      if (page.activeSectionId && !active) { confirmWait = null; waitFor('focus', '当前课节无法确认'); return; }
      if ((decision.type === 'course-complete' || decision.type === 'select-section') && !sectionListConfirmed) {
        confirmWait = null;
        waitFor('section-list-confirm', '等待确认课节清单加载完成');
        return;
      }
      const needsPlayer = decision.type === 'wait' && active && [5, 6].includes(active.type);
      if (!needsPlayer || !page.media) clearMediaHealth('player-unavailable');
      if (pending?.kind === 'course' && (!needsPlayer || (page.media && page.mediaReady !== false))) {
        pending = null;
        if (message === '正在重新进入课程。') message = '正在按平台课节状态连续学习。';
      }
      if (decision.type === 'manual') { confirmWait = null; if (record.automation.enabled) deferCurrent('此课节需要人工处理，请完成后重试。'); else { stop('此课节需要人工处理，请在当前页面完成后再继续。'); notify(message); } return; }
      if (decision.type === 'course-complete') {
        confirmWait = null;
        if (!task.done.includes(current.id)) task.done.push(current.id);
        task.recheck = (task.recheck || []).filter(id => id !== current.id);
        if (!persist()) return;
        if (!nextEntry()) { nextCourse(page); return; }
        grace = { key: `course:${current.id}`, since: milliseconds() }; loading = null; return;
      }
      if (decision.type === 'select-section') {
        confirmWait = null;
        const key = `${current.id}:${active?.id || ''}:${decision.sectionId}`;
        if (active?.status === 'completed') {
          if (grace?.key !== key) { grace = { key, since: milliseconds() }; return; }
          if (milliseconds() - grace.since < 6000) return;
        }
        grace = null;
        action(() => adapter.selectSection(decision.sectionId), { kind: 'section', id: decision.sectionId, before: page.route }); return;
      }
      grace = null;
      if (active && ['learning', 'not-started'].includes(active.status)) {
        if ([5, 6].includes(active.type)) {
          if (page.mediaTarget?.status === 'ambiguous' || page.issues?.some(issue => issue.includes('多个原生媒体播放器'))) {
            confirmWait = null;
            loading = null;
            const countText = page.mediaTarget?.count ? `（${page.mediaTarget.count} 个）` : '';
            const reason = `检测到多个原生媒体播放器${countText}，无法确定当前课节目标播放器；已停止自动媒体操作，请检查页面后手动处理。`;
            if (record.automation.enabled) deferCurrent(reason);
            else { stop(reason, false); notify(message); }
            return;
          }
          if (!page.media) { confirmWait = null; waitFor(`player:${active.id}`, '未识别本页媒体播放器'); return; }
          const key = `${task.id}:${current.id}:${active.id}`;
          trackPlayer(page, key, signal);
          if (page.mediaReady === false && !mediaHealth.started && !mediaHealth.request) {
            confirmWait = null;
            waitFor(`player:${active.id}`, '媒体播放器尚未接入播放源');
            return;
          }
          loading = null;
          if (page.media.ended) {
            endMediaRequest('ended', 'media-ended');
            if (confirmWait?.key !== key) {
              confirmWait = { key, since: milliseconds() };
              message = '媒体播放已结束，正在等待平台确认课节完成。';
            } else if (milliseconds() - confirmWait.since >= wdControllerEndedConfirmTimeout) {
              const reason = '媒体播放结束后平台仍报未完成，等待平台确认超时（90秒）。';
              confirmWait = null;
              if (record.automation.enabled) deferCurrent(reason);
              else { stop(`${reason} 已暂停并退出学习页，请人工核对学时记录。`, true); notify(message); }
            }
            return;
          }
          if (confirmWait) {
            confirmWait = null;
            if (message === '媒体播放已结束，正在等待平台确认课节完成。') message = '正在按平台课节状态连续学习。';
          }
          checkPlayback(page, current, active, mediaHealth);
        } else {
          loading = null;
          if (confirmWait) {
            confirmWait = null;
            if (message === '媒体播放已结束，正在等待平台确认课节完成。') message = '正在按平台课节状态连续学习。';
          }
        }
      } else { confirmWait = null; waitFor('active', '等待平台确认当前课节'); }
    } catch { stop('页面读取或操作异常，已暂停，请人工确认。', true); }
    finally { ticking = false; emit(); }
  };
  try { record = readStored(); identity = record ? { taskId: record.taskId, revision: record.revision } : null; task = record?.tasks.find(item => item.id === record.activeTaskId) || null; } catch (error) { blocked = true; message = error.message?.includes('本地') || error.message?.includes('存储') ? error.message : '本地存储读取失败，无法启动。'; }
  stopPlaybackWatch = adapter.watchPlayback?.((event, detail) => {
    if (event === 'route') {
      observePlayback(detail);
      if (playbackAttention && detail.route !== playbackAttention.route) playbackAttention = null;
      return;
    }
    if (event === 'visibility') refreshVisibility();
    const signal = detail ? { event, ...detail } : null;
    const forPlayer = !mediaHealth || mediaHealth.playerId === signal?.id;
    const needsSample = recovery || mediaHealth?.request || mediaHealth?.pauseSince != null;
    const newPlayback = event === 'play' || event === 'playing';
    if (status === 'running' && (event === 'visibility' || newPlayback || (forPlayer && (event !== 'timeupdate' || needsSample)))) {
      void tick(signal);
    } else if (status === 'paused' && (playbackAttention || playbackLog.enabled) && (event !== 'timeupdate' || playbackAttention?.playerId === signal?.id)) {
      try {
        const page = adapter.read();
        observePlayback(page);
        if (playbackAttention) void observePlaybackAttention(page, signal).catch(() => logPlayback('attention-clear-blocked'));
        else observeMediaSignal(page, signal);
      } catch { /* A player update must never interrupt manual playback. */ }
    } else if (event === 'visibility' && ['preparing', 'waiting'].includes(status)) void tick();
  }) || null;
  if (!blocked && record?.automation.enabled && record.automation.resumeOnReload && record.runRequested) { restorePending = true; message = '正在准备恢复上次开始的队列。'; watch(); }
  return {
    getState, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    search, chooseCandidate, collectDraft, draftSetSelection, selectCourses, addDraft, discardDraft, setSelection, setTaskMode, recheckCompleted, refreshTask, removeTask, clearCompletedTasks, moveTask, setWindow, setAutomation,
    start, pause, retry, skipCurrent, tick,
    setPlaybackLogging, getPlaybackLogText: playbackLog.text,
    diagnose() {
      const diagnostic = adapter.diagnose();
      if (preparing) {
        const page = adapter.read();
        const extra = { preparingStage: preparing.stage };
        if (preparing.stage === 'subject') {
          extra.subjectIdMatches = page.kind === 'subject' && page.subjectId === preparing.candidate.id;
          extra.subjectTitleMatches = Boolean(page.title?.trim()) && normalizeTitle(page.title) === normalizeTitle(preparing.candidate.title);
        }
        const failureHint = subjectTitleIssue(page) || (
          (preparing.stage === 'subject' && !validPage(page, preparing.candidate))
          || (preparing.stage !== 'subject' && !(page.kind === 'search' && page.candidates?.length))
            ? wdControllerDescribeRecognitionFailure(page, { stage: preparing.stage, expectedSubject: preparing.candidate || null, timedOut: false })
            : ''
        );
        return { ...diagnostic, ...extra, ...(failureHint ? { failureHint } : {}) };
      }
      return diagnostic;
    },
    destroy({ preserveRun = false } = {}) { if (destroyed) return; const keep = preserveRun && record?.automation.enabled && record.automation.resumeOnReload && ['running', 'waiting'].includes(status); stopPlaybackWatch?.(); stop('面板已关闭，任务已暂停。', true, false, keep); destroyed = true; listeners.clear(); },
  };
}
