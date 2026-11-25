import { normalizeTitle, isWithinWindow, decideLearningAction } from './core.js';
import { normalizeQueue, mergeCourses, validWindow, isTaskComplete } from './queue.js';

const wdControllerTaskKey = 'wangda-assistant.task';
const wdControllerLeaseKey = 'wangda-assistant.lease';
const wdControllerLock = 'wangda-assistant.run';
const wdControllerEndedConfirmTimeout = 90000;

function wdControllerDescribeRecognitionFailure(page, { stage = 'subject', expectedSubject = null, timedOut = false } = {}) {
  const prefix = timedOut ? '加载超时' : '识别失败';
  if (!page || page.kind === 'unknown') {
    const basis = page?.recognition?.basis || '路由未匹配已知专区/课程/搜索规则（需 #/study/subject/detail/<SID>、#/study/course/detail/... 或 #/search）';
    return `${prefix}（不支持的结构）：当前页面路由无法识别。依据：${basis}。请点击“页面诊断”核对。`;
  }
  if (stage === 'search-page' || stage === 'results') {
    if (page.kind !== 'search') {
      return `${prefix}（页面未就绪）：尚未处于专区搜索页（当前类型：${page.kind}，需 #/search）。请手动打开专区后读取，或点击“页面诊断”核对。`;
    }
    const rec = page.recognition;
    if (rec?.category === 'zero-results') return `${timedOut ? '搜索结束' : '识别失败'}（零结果）：未找到匹配专区候选。依据：${rec.basis}。请核对关键词或手动打开专区后读取，可点击“页面诊断”核对。`;
    if (rec?.category === 'unsupported-structure') return `搜索识别失败（不支持的结构）：页面搜索结果结构暂不支持。依据：${rec.basis}。请点击“页面诊断”核对。`;
    const basis = rec?.basis || (stage === 'search-page'
      ? '未找到搜索控件（input[id$="searchContent"][name="keyword"] / input[name="searchContent"] 与 i[id$="searchBtn"]）'
      : '尚未出现搜索结果容器（[id$="all-list"]）或结果仍在加载');
    return `${prefix}（页面未就绪）：搜索页面或结果尚未就绪。依据：${basis}。请稍后重试或手动打开专区后读取，可点击“页面诊断”核对。`;
  }
  if (page.kind !== 'subject') {
    return `${prefix}（页面未就绪）：当前不在专区详情页（当前类型：${page.kind}，需 #/study/subject/detail/<SID>）。请进入对应专区页后读取，可点击“页面诊断”核对。`;
  }
  if (expectedSubject && page.subjectId !== expectedSubject.id) {
    return `${prefix}（页面未就绪）：当前专区标识与目标专区不一致（需匹配目标专区 SID）。请核对专区后重试，可点击“页面诊断”核对。`;
  }
  if (page.courses?.length) {
    if (!page.title?.trim()) {
      return '未识别当前专区标题（页面未就绪），已暂停。依据：未从 .subject-banner/.banner-info .title-row .h3、introduce .h3 或 document.title 读到标题。请查看页面诊断后重试读取。';
    }
    if (expectedSubject && normalizeTitle(page.title) !== normalizeTitle(expectedSubject.title)) {
      return '当前专区标题与所选结果不一致，已暂停。依据：专区标题规范化比对不匹配。请核对专区后重试。';
    }
  }
  const rec = page.recognition;
  if (rec?.category === 'zero-results') {
    return `${prefix}（零结果）：当前专区未读取到可执行课程。依据：${rec.basis}。请点击“页面诊断”核对。`;
  }
  if (rec?.category === 'unsupported-structure') {
    return `${prefix}（不支持的结构）：当前专区页面结构暂不支持。依据：${rec.basis}。请点击“页面诊断”查看详情。`;
  }
  const basis = rec?.basis || '尚未检测到可用专区课程列表（检查 .catalog-state-info2、.catalog-state-info 或 .content.new [id*="studyBtn"]）';
  return `${prefix}（页面未就绪）：专区标题或课程列表尚未加载完成。依据：${basis}。请等待加载完成后重试，或点击“页面诊断”核对。`;
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
  let mediaPending = null;
  let stopMediaWatch = null;
  let resumeNoticeKey = null;
  let recovery = null;
  let restorePending = false;
  const retries = new Map();
  const defaultAutomation = { enabled: false, resumeOnReload: false, mute: true };
  const played = new Set();
  const seenPlaying = new Set();
  const resumeAttempts = new Map();
  const listeners = new Set();
  const copy = value => JSON.parse(JSON.stringify(value));
  const isDone = (item, id) => Boolean(item?.done?.includes(id) && !item.recheck?.includes(id));
  const isOnOwnedLearningPage = () => {
    if (destroyed || !task?.current || !task?.subject || record?.activeTaskId !== task.id) return false;
    if (typeof adapter?.read !== 'function') return false;
    try {
      const page = adapter.read();
      return page.kind === 'course' && task.current === page.courseId && task.subject.id === page.subjectId && task.courses.some(course => course.id === page.courseId && course.route === page.route);
    } catch {
      return Boolean(lastOwnedPage && lastOwnedPage.taskId === task.id && lastOwnedPage.courseId === task.current);
    }
  };
  const getState = () => ({ status, phase: restorePending ? 'resuming' : recovery?.network ? 'offline' : recovery ? 'retrying' : confirmWait ? 'confirming' : status, message, unavailable: blocked, onOwnedLearningPage: isOnOwnedLearningPage(), window: copy(record?.window || defaultWindow), automation: copy(record?.automation || defaultAutomation), tasks: copy(record?.tasks || []), activeTaskId: record?.activeTaskId || null, currentCourseId: task?.current || null, currentSectionTitle, currentPlayback: copy(currentPlayback), candidates: copy(candidates), draft: copy(draft), problem: copy(problem) });
  const emit = () => { const state = getState(); for (const listener of listeners) listener(state); };
  const tell = text => { message = text; emit(); return false; };
  const milliseconds = () => now().getTime();
  const notify = text => { try { options.notify?.(text); } catch { /* Notifications are optional. */ } };
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
    preparing = pending = grace = loading = confirmWait = sectionConfirm = recovery = null;
    mediaPending = null;
    if (wasRunning && !complete && task?.current && /人工|播放|媒体已暂停|课节|超时|页面操作未成功|页面读取或操作异常/u.test(text)) problem = { taskId: task.id, courseId: task.current, reason: text };
    status = complete ? 'complete' : 'paused';
    message = text;
    if (wasRunning && ownsCurrentLearningPage()) {
      try {
        adapter.pauseMedia();
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
      message = '课程清单已刷新。' + (nextEntry() ? pendingNotice : ''); emit(); return true;
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
    if (record?.tasks.some(item => item.subject?.id === draft.subject.id)) return tell('该专区已在任务队列中，请刷新已有清单。');
    ensureRecord(); const next = { id: unique(), ...copy(draft), scope: 'all', done: [], skipped: [], current: null };
    record.tasks.push(next); if (!record.activeTaskId) record.activeTaskId = next.id;
    if (!persist()) return false; draft = null; candidates = []; target = ''; message = '专区已加入队列。' + (nextEntry() ? pendingNotice : ''); emit(); return true;
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
    message = `已安排 ${ids.length} 门课程复查。`; emit(); return true;
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
    status = 'preparing'; preparing = { stage: 'subject', candidate, refreshId, since: milliseconds() }; message = '正在打开专区，请等待课程加载。'; watch(); emit();
    if (!adapter.openSubject(candidate)) { stop('无法打开专区，请手动打开后读取。'); return false; } return true;
  };
  const subjectTitleIssue = page => {
    if (preparing?.stage !== 'subject' || page.kind !== 'subject' || page.subjectId !== preparing.candidate.id || !page.courses?.length) return '';
    if (!page.title?.trim()) return '未识别当前专区标题（页面未就绪），已暂停。依据：未从 .subject-banner/.banner-info .title-row .h3、introduce .h3 或 document.title 读到标题。请查看页面诊断后重试读取。';
    if (normalizeTitle(page.title) !== normalizeTitle(preparing.candidate.title)) return '当前专区标题与所选结果不一致，已暂停。依据：专区标题规范化比对不匹配。请核对专区后重试。';
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
    target = value.trim(); draft = null; status = 'preparing'; candidates = []; preparing = { stage: 'search-page', since: milliseconds() }; message = '正在打开专区搜索。'; watch(); emit();
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
    if (!editable() || !record || !record.tasks.length) return tell('请先添加专区任务。');
    if (!isWithinWindow(now(), record.window) && !record.automation.enabled) return tell('当前不在允许的北京时间学习时段内。');
    const preferredTask = preferred && record.tasks.find(item => item.id === preferred.taskId);
    const preferredCourse = queue(preferredTask).find(course => course.id === preferred.courseId && course.selected && !isDone(preferredTask, course.id) && !preferredTask.skipped.includes(course.id) && !preferredTask.deferred?.some(entry => entry.courseId === course.id));
    const entry = preferredCourse ? { item: preferredTask, course: preferredCourse } : nextEntry();
    if (!entry || !entry.item.subject) return tell(record.tasks.some(item => item.deferred?.length) ? '仍有待处理课程，请在详情中重试。' : record.tasks.some(item => item.skipped.length) ? '仍有跳过课程未完成，请重试。' : '请勾选尚未核对的课程。');
    const token = generation;
    if (!await acquire() || token !== generation || !held || !verify()) return false;
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id; problem = null; currentSectionTitle = ''; currentPlayback = null;
    record.runRequested = record.automation.enabled;
    if (!persist()) return false;
    generation += 1; restorePending = false; status = isWithinWindow(now(), record.window) ? 'running' : 'waiting'; needOpen = true; played.clear(); seenPlaying.clear(); resumeAttempts.clear(); retries.clear(); pending = grace = loading = confirmWait = sectionConfirm = recovery = null;
    message = status === 'waiting' ? `等待学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。` : '正在按平台课节状态连续学习。';
    if (status === 'waiting') waitWindow();
    else { watchMedia(); muteCourse(entry.course); }
    watch(); emit(); return true;
  };
  const pause = async () => {
    restorePending = false;
    if (!held && record?.runRequested && !await acquire()) { stop('无法暂停其他标签正在执行的任务，请到执行标签点击暂停。'); return false; }
    if (status !== 'running' && status !== 'preparing' && ownsCurrentLearningPage()) {
      try {
        adapter.pauseMedia();
        if (adapter.leaveLearning(task.subject.route) === false) { stop('页面未能停止，请手动退出学习页。'); return false; }
        lastOwnedPage = null;
      } catch { stop('页面未能停止，请手动退出学习页。'); return false; }
    }
    stop('已暂停，继续学习需手动点击开始。', true); return true;
  };
  const waitFor = (key, reason) => {
    if (loading?.key !== key) loading = { key, since: milliseconds() };
    const since = pending?.kind === 'course' ? pending.arrivedAt ?? loading.since : loading.since;
    if (milliseconds() - since >= 30000) recover(`${reason}，加载超时。`);
  };
  const action = (fn, expectation) => {
    if (!verify() || status !== 'running') return;
    currentPlayback = null;
    if (!fn()) { recover('页面操作未成功。'); return; }
    pending = { ...expectation, since: milliseconds() };
    loading = confirmWait = null;
    if (expectation.kind === 'course') { sectionConfirm = null; lastOwnedPage = null; }
  };
  const nextCourse = (page, leaveWhenDone = true) => {
    currentPlayback = null;
    const entry = nextEntry();
    if (!entry) {
      const count = record.tasks.reduce((n, item) => n + (item.deferred?.length || 0), 0);
      if (count) { stop(`队列已执行完，仍有 ${count} 门待处理课程${record.tasks.some(item => item.skipped.length) ? '及跳过课程' : ''}；请在详情中查看原因并重试。`, leaveWhenDone); notify(message); return; }
      if (record.tasks.some(item => item.skipped.length)) { stop('其他课程已核对，仍有跳过课程未完成，请重试。', true); return; }
      stop('所选课程已全部完成。', true, true); notify('所选课程已完成。'); return;
    }
    generation += 1; mediaPending = null;
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id;
    if (!persist()) return;
    grace = loading = confirmWait = sectionConfirm = recovery = null; lastOwnedPage = null; currentSectionTitle = '';
    if (matchesCourse(page, entry.course)) { pending = null; return; }
    action(() => adapter.openCourse(entry.course), { kind: 'course', id: entry.course.id, before: page.route });
  };
  const deferCurrent = (reason, leave = true) => {
    if (!verify() || status !== 'running') return;
    generation += 1; mediaPending = null; pending = grace = loading = confirmWait = sectionConfirm = recovery = null;
    const page = adapter.read();
    if (ownsCurrentLearningPage()) {
      adapter.pauseMedia();
      if (leave && adapter.leaveLearning(task.subject.route) === false) { stop('未能退出当前学习页，请手动退出后继续。'); notify(message); return; }
      lastOwnedPage = null;
    }
    task.deferred = [...(task.deferred || []).filter(item => item.courseId !== task.current), { courseId: task.current, reason }];
    if (!persist()) return;
    message = `课程已放入待处理：${reason} 继续后续课程。`; emit();
    nextCourse(page, leave);
  };
  const recover = (reason, { reopen = true } = {}) => {
    currentPlayback = null;
    if (!record?.automation.enabled) {
      stop(`${reason} ${reopen ? '已暂停并退出学习页，请人工确认。' : '请在当前页手动播放后再继续。'}`, reopen);
      if (!reopen) notify(message);
      return;
    }
    if (!verify() || status !== 'running') return;
    const key = `${task.id}:${task.current}`, attempt = (retries.get(key) || 0) + 1;
    if (attempt > 3) { deferCurrent(`${reason} 已重试三次。`, reopen); return; }
    generation += 1; mediaPending = null; pending = grace = loading = confirmWait = sectionConfirm = null;
    retries.set(key, attempt);
    if (reopen && ownsCurrentLearningPage()) {
      adapter.pauseMedia();
      if (adapter.leaveLearning(task.subject.route) === false) { stop('重试前未能退出学习页，请手动退出后继续。'); notify(message); return; }
      lastOwnedPage = null;
    }
    recovery = { until: milliseconds() + [5000, 10000, 20000][attempt - 1], reopen, before: adapter.read().route };
    message = `${reason} 正在等待重试 ${attempt}/3。`; emit();
  };
  const waitWindow = () => {
    currentPlayback = null;
    stopMediaWatch?.(); stopMediaWatch = null;
    if (!record.automation.enabled) { stop('已到学习时段边界，已停止媒体并退出学习页。', true); return; }
    if (ownsCurrentLearningPage()) {
      try {
        adapter.pauseMedia();
        if (adapter.leaveLearning(task.subject.route) === false) throw Error();
        lastOwnedPage = null;
      } catch { stop('学习时段结束，但未能退出学习页，请手动停止。', true); notify(message); return; }
    }
    generation += 1; mediaPending = null; pending = grace = loading = confirmWait = sectionConfirm = recovery = null; needOpen = true;
    played.clear(); seenPlaying.clear(); resumeAttempts.clear();
    status = 'waiting'; message = `等待下次学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。`; emit();
  };
  const retry = async (taskId = problem?.taskId, courseId = problem?.courseId) => {
    const changed = await edit(() => {
      const item = record?.tasks.find(item => item.id === taskId);
      if (!item?.courses.some(course => course.id === courseId)) return false;
      item.skipped = item.skipped.filter(id => id !== courseId);
      if (!item.recheck?.includes(courseId)) item.done = item.done.filter(id => id !== courseId);
      item.deferred = (item.deferred || []).filter(entry => entry.courseId !== courseId);
      item.courses.find(course => course.id === courseId).selected = true;
      record.activeTaskId = item.id; item.current = courseId; problem = null; return persist();
    });
    return changed ? start({ taskId, courseId }) : false;
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
          adapter.pauseMedia();
          if (adapter.leaveLearning(item.subject.route) === false) return tell('课程已跳过，但未能退出学习页，请手动退出后继续。');
        }
      } catch { return tell('课程已跳过，但页面操作未能完成，请手动退出学习页后继续。'); }
      return true;
    });
    if (!skipped) return false;
    if (!nextEntry()) { tell('仍有跳过课程未完成，请重试。'); return true; }
    return start();
  };
  const tick = async () => {
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
      if (resumeNoticeKey && (resumeNoticeKey !== `${task?.id}:${page.courseId}:${page.activeSectionId}` || !page.media?.paused || page.media.ended || page.sections?.some(item => item.id === page.activeSectionId && item.status === 'completed'))) {
        resumeNoticeKey = null;
        if (message.startsWith('播放已暂停，正在自动恢复播放')) message = '正在按平台课节状态连续学习。';
      }
      if (page.kind === 'login' || page.kind === 'study-error') {
        stop(page.kind === 'login' ? '登录已失效，请重新登录后继续。' : page.errorCode === '1' ? '其他学习窗口已接管播放，请关闭其他窗口后手动继续。' : '平台学习限制提示，请在当前页面处理后继续。'); notify(message); return;
      }
      if (status === 'waiting') {
        if (isWithinWindow(now(), record.window)) { status = 'running'; needOpen = true; watchMedia(); message = '已进入学习时段，正在继续队列。'; emit(); }
        return;
      }
      if (status === 'running' && record.automation.enabled && page.online === false) {
        if (!recovery?.network) {
          generation += 1; mediaPending = null; pending = grace = loading = confirmWait = sectionConfirm = null;
          if (ownsCurrentLearningPage()) {
            adapter.pauseMedia();
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
            if (!adapter.openSubject(exact[0])) stop('无法打开专区，请手动打开后读取。');
          } else stop('请点击确认要学习的专区。');
          emit();
        } else if (preparing.stage === 'subject' && page.kind === 'subject' && page.subjectId === preparing.candidate.id && page.title && normalizeTitle(page.title) === normalizeTitle(preparing.candidate.title) && page.courses?.length) {
          if (collectPage(page, preparing.refreshId)) stop(message);
        }
        return;
      }
      const current = queue().find(course => course.id === task.current);
      if (!current) { stop('当前课程不在已选清单中。', true); return; }
      if (pauseForRelearn(page, current)) return;
      if (recovery) {
        const onTarget = matchesCourse(page, current);
        const onExpectedSubject = recovery.reopen !== false && page.route === task.subject.route;
        if (page.route !== recovery.before && !onExpectedSubject && !onTarget) { stop('页面已离开目标课程，请确认后重新开始。'); return; }
        if (!recovery.network && milliseconds() < recovery.until) return;
        recovery = null; played.clear(); seenPlaying.clear();
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
          if (milliseconds() - pending.since >= 30000) recover('页面切换超时。');
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
          adapter.pauseMedia(); nextCourse(page); return;
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
          if (page.mediaReady === false && !seenPlaying.has(key)) {
            confirmWait = null;
            waitFor(`player:${active.id}`, '媒体播放器尚未接入播放源');
            return;
          }
          loading = null;
          if (page.media.ended) {
            if (mediaPending?.key === key) mediaPending = null;
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
          if (!page.media.paused) {
            seenPlaying.add(key);
            // Observed playback supersedes any unresolved play request for this section.
            if (mediaPending?.key === key) mediaPending = null;
            const resume = resumeAttempts.get(key);
            if (resume) resume.pausedAt = null;
          }
          if (page.media.paused && !page.media.ended) {
            if (mediaPending?.key === key) {
              if (milliseconds() - mediaPending.since >= 30000) {
                if (mediaPending.resume) { stop('自动恢复播放超时，请检查播放器后继续。'); notify(message); }
                else recover('播放请求超时。');
              }
              return;
            }
            const resuming = seenPlaying.has(key);
            if (resuming) {
              // Ordinary pauses recover in place, with a bounded budget per section.
              let resume = resumeAttempts.get(key);
              if (!resume || (resume.pausedAt === null && milliseconds() - resume.windowStart >= 60000)) {
                resume = { windowStart: milliseconds(), count: 0, pausedAt: milliseconds(), nextAt: milliseconds() + 2000 };
                resumeAttempts.set(key, resume);
              } else if (resume.pausedAt === null) {
                resume.pausedAt = milliseconds(); resume.nextAt = Math.max(resume.nextAt, milliseconds() + 2000);
              }
              if (milliseconds() < resume.nextAt || page.online === false) return;
              if (resume.count >= 3) { stop('自动恢复播放已尝试 3 次，仍反复暂停，请检查播放器后继续。'); notify(message); return; }
              resume.count += 1;
              resume.nextAt = milliseconds() + [5000, 10000, 10000][resume.count - 1];
              message = `播放已暂停，正在自动恢复播放（${resume.count}/3）。`;
              resumeNoticeKey = key;
            } else if (played.has(key)) { recover('媒体未能开始播放。', { reopen: false }); return; }
            played.add(key);
            const request = { key, since: milliseconds(), resume: resuming };
            mediaPending = request;
            const token = generation;
            // muteCourse and media events enforce the option; resume leaves volume unchanged.
            Promise.resolve(adapter.playCurrentMedia(resuming ? false : record.automation.mute)).then(success => {
              try {
                if (destroyed || generation !== token || status !== 'running' || mediaPending !== request || !verify()) return;
                if (!isWithinWindow(now(), record.window)) { waitWindow(); return; }
                const latest = adapter.read();
                if (pauseForRelearn(latest, current)) return;
                if (!matchesCourse(latest, current) || latest.activeSectionId !== active.id) return;
                mediaPending = null;
                if (success) seenPlaying.add(key);
                if (resuming) return;
                if (!success) recover('浏览器未能自动播放。', { reopen: false });
              } catch { if (generation === token && status === 'running') stop('页面读取或操作异常，已暂停并退出学习页，请人工确认。', true); }
            }, () => {
              // Only a native play rejection can use the manual-play pause path.
              try {
                if (destroyed || generation !== token || status !== 'running' || mediaPending !== request || !verify()) return;
                if (!isWithinWindow(now(), record.window)) { waitWindow(); return; }
                const latest = adapter.read();
                if (pauseForRelearn(latest, current)) return;
                if (!matchesCourse(latest, current) || latest.activeSectionId !== active.id) return;
                mediaPending = null;
                if (resuming) return;
                recover('播放失败。', { reopen: false });
              } catch { if (generation === token && status === 'running') stop('页面读取或操作异常，已暂停并退出学习页，请人工确认。', true); }
            });
          }
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
  if (!blocked && record?.automation.enabled && record.automation.resumeOnReload && record.runRequested) { restorePending = true; message = '正在准备恢复上次开始的队列。'; watch(); }
  return {
    getState, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    search, chooseCandidate, collectDraft, draftSetSelection, selectCourses, addDraft, discardDraft, setSelection, setTaskMode, recheckCompleted, refreshTask, removeTask, clearCompletedTasks, moveTask, setWindow, setAutomation,
    start, pause, retry, skipCurrent, tick,
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
    destroy({ preserveRun = false } = {}) { if (destroyed) return; const keep = preserveRun && record?.automation.enabled && record.automation.resumeOnReload && ['running', 'waiting'].includes(status); stop('面板已关闭，任务已暂停。', true, false, keep); destroyed = true; listeners.clear(); },
  };
}
