import { isTaskComplete } from './queue.js';

export function createPanel(win, controller, version) {
  const document = win.document;
  const existing = document.getElementById('wangda-assistant');
  if (existing?.wdPanel) return existing.wdPanel;
  const host = document.createElement('div');
  host.id = 'wangda-assistant';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  const element = (tag, text = '', parent = root) => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  element('style', ':host{all:initial;color:#17344d;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif}*{box-sizing:border-box}[hidden]{display:none!important}button,input{font:inherit}button{cursor:pointer;border:1px solid #a8c6e6;background:#f5faff;border-radius:5px;padding:5px 9px;min-height:32px;color:#155a9b}button:hover:not(:disabled){background:#e6f2ff}button:disabled{opacity:.5;cursor:default}button.primary{background:#176ac2;color:#fff;border-color:#176ac2}button.primary:hover:not(:disabled){background:#1259a5}button.danger{color:#b42318;border-color:#f0b4ae;background:#fff5f5}button.danger:hover:not(:disabled){background:#ffe8e6;border-color:#e0867e}button.danger-confirm{background:#c92a2a;color:#fff;border-color:#c92a2a}button.danger-confirm:hover:not(:disabled){background:#b02222}button.ghost{background:#fff;border-color:#c6d5e3;color:#4a657e}button.ghost:hover:not(:disabled){background:#f4f7fa}section{width:380px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;max-height:calc(100dvh - 32px);background:#fff;border:1px solid #a9c5e1;border-radius:10px;box-shadow:0 5px 28px #12345630;overflow:hidden}header{flex-shrink:0;padding:10px 12px;background:#edf5ff}header strong{font-size:15px}.headline,.buttons,.row{display:flex;align-items:center;gap:7px}.headline{justify-content:space-between}.buttons{flex-wrap:wrap;margin:8px 0}.detail-actions{justify-content:space-between}.leave-bar{margin:0 0 10px}.row{align-items:flex-start}.row label{flex:1;min-width:0}small,.muted{font-size:12px;color:#56748f}.progress{margin-top:6px;font-size:12px}.body{padding:12px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}.status,.problem,.ui-error{padding:9px;background:#eff6fd;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:5px;margin-bottom:10px}.problem{background:#fff6e8;border:1px solid #edc88d}.ui-error{background:#fff1f0;border:1px solid #f5b5b0;color:#a61d24;display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.ui-error button{min-width:26px;min-height:26px;padding:0 6px;line-height:1;flex-shrink:0}h2{font-size:14px;margin:8px 0}p{margin:6px 0;overflow-wrap:anywhere}label{display:block;margin-bottom:8px}input[type=text]{width:100%;border:1px solid #b8c9d9;border-radius:4px;background:#fff;color:#17344d;padding:6px}input[type=checkbox]{margin:3px 0;flex-shrink:0}input:focus-visible,button:focus-visible,summary:focus-visible,select:focus-visible{outline:2px solid #176ac2;outline-offset:2px}article{border:1px solid #d2e1ef;border-radius:6px;padding:10px;margin:8px 0}article h3{font-size:13px;margin:0 0 5px;overflow-wrap:anywhere}.course{display:flex;align-items:flex-start;gap:7px;margin:0;padding:7px 0;border-bottom:1px solid #edf2f7}.course:last-child{border-bottom:0}.course span{flex:1;overflow-wrap:anywhere}.course small{display:block}.course button{font-size:12px;min-height:28px;padding:3px 8px;flex-shrink:0}details{margin:8px 0}summary{cursor:pointer;color:#155a9b;font-weight:500}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace;margin:6px 0;padding:8px;background:#f4f7fa;border-radius:5px}.candidate{width:100%;text-align:left;overflow-wrap:anywhere;margin:4px 0}.separator{border-top:1px solid #e2ebf3;margin-top:10px;padding-top:8px}.settings-group{margin:8px 0;padding-top:6px;border-top:1px dashed #e2ebf3}.settings-group:first-of-type{border-top:0;padding-top:0}.settings-title{font-size:12px;font-weight:600;color:#35536e;margin:0 0 6px}.diag-bar{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:8px}.diag-actions{display:flex;gap:6px}.diag-actions button{min-height:28px;padding:3px 8px;font-size:12px}');
  const shell = element('section'); shell.setAttribute('aria-label', '网大助手');
  element('style', '.task-head{display:flex;align-items:flex-start;gap:7px}.task-head h3{flex:1;min-width:0}.sort-actions{display:flex;gap:4px;flex-shrink:0}.sort-actions button{min-width:28px;min-height:28px;padding:2px 6px;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center}.sort-handle{cursor:grab}.sort-handle:active{cursor:grabbing}article[data-drop=before]{border-top:3px solid #176ac2}article[data-drop=after]{border-bottom:3px solid #176ac2}article[data-dragging]{opacity:.6}');
  element('style', 'select,input[type=search]{font:inherit;width:100%;border:1px solid #b8c9d9;border-radius:4px;background:#fff;color:#17344d;padding:6px}.filter-input{margin:0 0 6px}');
  element('style', 'article[data-state=active]{background:#edf6ff;border-color:#72a9df;box-shadow:inset 3px 0 #176ac2}article[data-state=completed]{background:#f3f4f6;border-color:#d8dee5;color:#65727f}article[data-state=attention]{background:#fff9ef;border-color:#e9c78f}.task-priority{margin:3px 0 4px}.task-current{font-size:12px;color:#155a9b;white-space:pre-wrap}.course[data-state=active]{background:#dfedfc;border-radius:4px;padding:8px;border-left:3px solid #176ac2}.course[data-state=active]>span>span,.course[data-state=active] small{color:#155a9b}.course[data-state=active]>span>span{font-weight:600}.course[data-state=completed]{color:#6b7885}.course[data-state=attention] small{color:#8a5716}progress{display:block;width:100%;height:6px;margin:6px 0 8px;border:0;border-radius:4px;overflow:hidden;background:#e1e8ef;accent-color:#176ac2}progress::-webkit-progress-bar{background:#e1e8ef}progress::-webkit-progress-value{background:#176ac2}progress::-moz-progress-bar{background:#176ac2}article[data-state=completed] progress{accent-color:#8b98a5}article[data-state=completed] progress::-webkit-progress-value{background:#8b98a5}article[data-state=completed] progress::-moz-progress-bar{background:#8b98a5}.course progress{margin-bottom:2px}.playback-time{margin-top:4px;font-variant-numeric:tabular-nums}.completed-actions{margin:6px 0}');
  element('style', '.compact-course,.course-caption,.current-name,.task-head h3{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.course>span{min-width:0}.one-line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.task-current{margin:6px 0}.current-name{font-weight:600}.task-current small{color:inherit}.compact-notice{margin-top:5px;white-space:pre-wrap;overflow-wrap:anywhere}.task-current .playback-time{margin-top:3px}.task-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}.task-meta p{margin:0;flex:1;min-width:0}.detail-toggle{min-height:28px;padding:3px 8px;font-size:12px;flex-shrink:0}');
  const header = element('header', '', shell);
  const headline = element('div', '', header); headline.className = 'headline';
  const title = element('div', '', headline); element('strong', '网大助手', title); element('small', ` ${version}`, title);
  const headerButtons = element('div', '', headline); headerButtons.className = 'row';
  const busy = new Set(); const editors = new Set(); let adding = false; let starting = false; let reordering = false; let draggedTaskId = null;
  let pendingRemoveId = null; let pendingRemoveTimer = null; let windowSavedTimer = null; let copyDiagTimer = null;
  let latest = controller.getState();
  const clearRemoveConfirm = () => { if (pendingRemoveTimer !== null) { win.clearTimeout(pendingRemoveTimer); pendingRemoveTimer = null; } pendingRemoveId = null; };
  const clearTimers = () => {
    clearRemoveConfirm();
    if (windowSavedTimer !== null) { win.clearTimeout(windowSavedTimer); windowSavedTimer = null; }
    if (copyDiagTimer !== null) { win.clearTimeout(copyDiagTimer); copyDiagTimer = null; }
  };
  const body = element('div', '', shell); body.className = 'body'; body.hidden = true;
  const uiErrorBox = element('div', '', body); uiErrorBox.className = 'ui-error'; uiErrorBox.setAttribute('role', 'alert'); uiErrorBox.hidden = true;
  const uiErrorText = element('span', '', uiErrorBox);
  const closeUiError = element('button', '×', uiErrorBox); closeUiError.type = 'button'; closeUiError.className = 'ghost'; closeUiError.setAttribute('aria-label', '关闭提示');
  closeUiError.addEventListener('click', () => { uiErrorBox.hidden = true; uiErrorText.textContent = ''; });
  const showUiError = text => { uiErrorText.textContent = text; uiErrorBox.hidden = false; body.scrollTop = 0; };
  const button = (action, text, parent, handler, edit = true) => {
    const node = element('button', text, parent); node.type = 'button'; node.dataset.action = action;
    if (edit) editors.add(node);
    node.addEventListener('click', async () => {
      if (node.disabled || busy.has(node)) return;
      busy.add(node); node.disabled = true;
      try { await handler(); } catch { showUiError('操作未完成，请查看当前状态后重试。'); }
      finally { busy.delete(node); node.disabled = false; render(controller.getState()); }
    });
    return node;
  };
  const isRunning = state => ['running', 'preparing', 'waiting'].includes(state.status) || state.phase === 'resuming';
  const runButton = button('run-toggle', '开始', headerButtons, () => isRunning(controller.getState()) ? controller.pause() : startQueue(), false);
  const toggle = button('toggle', '展开', headerButtons, () => setOpen(body.hidden), false); toggle.setAttribute('aria-expanded', 'false');
  const progress = element('div', '', header); progress.className = 'progress'; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
  const compact = element('div', '', header); compact.className = 'muted compact-course';
  const compactTime = element('div', '', header); compactTime.className = 'muted playback-time'; compactTime.dataset.playbackTime = '';
  const compactNotice = element('div', '', header); compactNotice.className = 'muted compact-notice';
  const execution = element('div', '', body); execution.className = 'status';
  const message = element('div', '', execution);
  const problemBox = element('div', '', body); problemBox.className = 'problem'; problemBox.dataset.problem = '';
  const problemText = element('div', '', problemBox); const problemActions = element('div', '', problemBox); problemActions.className = 'buttons';
  button('retry', '重试本课程', problemActions, () => controller.retry(latest.problem?.taskId, latest.problem?.courseId));
  button('skip', '跳过并继续', problemActions, () => controller.skipCurrent());
  const leaveBar = element('div', '', body); leaveBar.className = 'buttons leave-bar'; leaveBar.hidden = true;
  const leaveLearningButton = button('stop-learning', '退出学习页', leaveBar, () => controller.pause(), false);
  const queueView = element('div', '', body); queueView.dataset.view = 'queue';
  const queueHeading = element('div', '', queueView); queueHeading.className = 'headline'; element('h2', '任务队列', queueHeading);
  const queueHeaderActions = element('div', '', queueHeading); queueHeaderActions.className = 'row';
  const clearCompleted = button('clear-completed', '清除已完成', queueHeaderActions, () => controller.clearCompletedTasks(), false);
  clearCompleted.className = 'ghost';
  clearCompleted.title = '清理已完成专区，保留执行中、未完成和待处理任务。';
  const addButton = button('add', '添加专区', queueHeaderActions, () => { adding = true; clearRemoveConfirm(); render(controller.getState()); target.focus(); });
  const empty = element('p', '暂无学习任务', queueView); empty.className = 'muted';
  const taskList = element('div', '', queueView);
  const addView = element('div', '', body); addView.dataset.view = 'add';
  const exitAddView = async () => { if (await controller.discardDraft() !== false) { adding = false; target.value = ''; } };
  const addHeading = element('div', '', addView); addHeading.className = 'headline';
  element('h2', '添加专区', addHeading);
  const backButton = button('back', '← 返回', addHeading, exitAddView); backButton.className = 'ghost';
  const searchBox = element('div', '', addView);
  const labelInput = (caption, name, parent) => { const label = element('label', caption, parent); const input = element('input', '', label); input.type = 'text'; input.name = name; input.id = `wd-${name}`; label.htmlFor = input.id; editors.add(input); return input; };
  const target = labelInput('专区名称', 'target', searchBox);
  target.placeholder = '输入名称后按回车搜索';
  const searchActions = element('div', '', searchBox); searchActions.className = 'buttons';
  const searchButton = button('search', '搜索', searchActions, () => controller.search(target.value.trim())); searchButton.className = 'primary';
  button('collect', '读取当前页', searchActions, () => controller.collectDraft());
  target.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchButton.click(); } });
  const candidates = element('div', '', addView); candidates.dataset.candidates = '';
  const draftBox = element('div', '', addView); draftBox.dataset.draft = '';
  const draftTitle = element('h3', '', draftBox);
  const draftCourses = createCourseList(draftBox);
  const addActions = element('div', '', draftBox); addActions.className = 'buttons';
  const addDraftButton = button('add-draft', '加入队列', addActions, async () => { if (await controller.addDraft()) { adding = false; target.value = ''; } }); addDraftButton.className = 'primary';
  const cancelDraftButton = button('cancel-draft', '取消', addActions, exitAddView); cancelDraftButton.className = 'ghost';
  const settingsBox = element('details', '', body); settingsBox.className = 'separator'; settingsBox.dataset.settings = '';
  const settingsSummary = element('summary', '设置', settingsBox);
  const runningEditHint = element('p', '运行中仅可查看，暂停后可修改。', settingsBox); runningEditHint.className = 'muted'; runningEditHint.hidden = true;
  const windowGroup = element('div', '', settingsBox); windowGroup.className = 'settings-group';
  element('p', '学习时段（北京时间）', windowGroup).className = 'settings-title';
  const windowRow = element('div', '', windowGroup); windowRow.className = 'row';
  const fields = { start: labelInput('开始时间', 'start', windowRow), end: labelInput('结束时间', 'end', windowRow) };
  fields.start.placeholder = '09:00'; fields.end.placeholder = '24:00';
  const dirty = new Set(); for (const [name, field] of Object.entries(fields)) field.addEventListener('input', () => dirty.add(name));
  const saveWindowButton = button('save-window', '保存', windowGroup, async () => {
    if (await saveWindow()) {
      saveWindowButton.textContent = '已保存';
      if (windowSavedTimer !== null) win.clearTimeout(windowSavedTimer);
      windowSavedTimer = win.setTimeout(() => { windowSavedTimer = null; saveWindowButton.textContent = '保存'; }, 2000);
    }
  });
  const muteGroup = element('div', '', settingsBox); muteGroup.className = 'settings-group';
  const autoGroup = element('div', '', settingsBox); autoGroup.className = 'settings-group';
  function automaticInput(name, caption, parent) {
    const label = element('label', '', parent); const input = element('input', '', label); input.type = 'checkbox'; input.name = name; editors.add(input);
    element('span', ` ${caption}`, label);
    input.addEventListener('change', async () => {
      if (input.disabled) return;
      busy.add(input); input.disabled = true;
      try { await controller.setAutomation({ enabled: automatic.checked, resumeOnReload: automatic.checked && resumeOnReload.checked, mute: mute.checked }); }
      catch { showUiError('自动设置保存失败，请重试。'); }
      finally { busy.delete(input); render(controller.getState()); }
    }); return input;
  }
  const mute = automaticInput('mute', '自动静音课程', muteGroup);
  mute.title = '开启期间持续保持静音；需要声音时请暂停后关闭。';
  const automatic = automaticInput('automatic', '异常自动重试并跳过人工课', autoGroup);
  const resumeOnReload = automaticInput('resumeOnReload', '刷新页面后自动恢复队列', autoGroup);
  const autoHint = element('p', '需保持页面打开；手动暂停将停止续学。', autoGroup); autoHint.className = 'muted'; autoHint.hidden = true;
  const utility = element('div', '', body); utility.className = 'diag-bar separator';
  const diagTrigger = button('diagnose', '页面诊断', utility, () => {
    diagnostic.textContent = JSON.stringify(controller.diagnose(), null, 2);
    diagnosticBox.hidden = false;
  }, false);
  diagTrigger.className = 'ghost';
  const diagnosticBox = element('div', '', body); diagnosticBox.dataset.diagnosticBox = ''; diagnosticBox.hidden = true;
  const diagControls = element('div', '', diagnosticBox); diagControls.className = 'diag-bar';
  element('small', '诊断信息', diagControls);
  const diagActions = element('div', '', diagControls); diagActions.className = 'diag-actions';
  const copyDiagButton = button('copy-diagnose', '复制', diagActions, async () => {
    if (!diagnostic.textContent) return;
    if (win.navigator?.clipboard?.writeText) {
      await win.navigator.clipboard.writeText(diagnostic.textContent);
      copyDiagButton.textContent = '已复制';
      if (copyDiagTimer !== null) win.clearTimeout(copyDiagTimer);
      copyDiagTimer = win.setTimeout(() => { copyDiagTimer = null; copyDiagButton.textContent = '复制'; }, 2000);
    }
  }, false);
  copyDiagButton.className = 'ghost';
  const closeDiagButton = button('close-diagnose', '收起', diagActions, () => { diagnosticBox.hidden = true; }, false);
  closeDiagButton.className = 'ghost';
  const diagnostic = element('pre', '', diagnosticBox);
  const taskNodes = new Map(); let candidateSignature = ''; let draftSubjectId = null;
  const setOpen = open => { body.hidden = !open; toggle.textContent = open ? '收起' : '展开'; toggle.setAttribute('aria-expanded', String(open)); render(controller.getState()); };
  const eligible = task => task.courses.filter(course => course.selected && (task.scope === 'all' || course.required));
  const isDone = (task, id) => Boolean(task?.done.includes(id) && !task.recheck?.includes(id));
  const counts = task => { const selected = eligible(task); return { selected: selected.length, done: selected.filter(course => isDone(task, course.id)).length, skipped: selected.filter(course => task.skipped.includes(course.id)).length, deferred: task.deferred?.length || 0 }; };
  const completeTask = isTaskComplete;
  const currentTask = (task, state = latest) => {
    if (!task?.subject || task.id !== state.activeTaskId || completeTask(task) || ['complete', 'preparing'].includes(state.status)) return false;
    const selected = eligible(task);
    return Boolean(selected.length && (state.currentCourseId ? selected.some(course => course.id === state.currentCourseId && (state.status === 'running' || !isDone(task, course.id)) && !task.skipped.includes(course.id) && !task.deferred?.some(entry => entry.courseId === course.id)) : ['running', 'waiting'].includes(state.status) || state.phase === 'resuming'));
  };
  const sortableTasks = () => latest.tasks.filter(task => !completeTask(task));
  const phaseLabels = { paused: '已暂停', preparing: '正在准备', running: '学习中', complete: '已完成', retrying: '正在重试', waiting: '等待学习时段', offline: '等待网络', resuming: '正在恢复', confirming: '等待平台确认' };
  const phaseLabel = state => phaseLabels[state.phase || state.status] || '等待确认';
  const playbackFor = (item, courseId) => {
    const value = latest.currentPlayback;
    return currentTask(item) && latest.status === 'running' && !['retrying', 'offline', 'resuming'].includes(latest.phase) && value?.taskId === item.id && value.courseId === courseId ? value : null;
  };
  const executionLabel = (item, courseId = latest.currentCourseId) => {
    if (latest.status !== 'running' || ['retrying', 'offline', 'resuming'].includes(latest.phase)) return latest.status === 'paused' ? '当前' : phaseLabel(latest);
    if (isDone(item, courseId)) return '正在切换课程';
    const playback = playbackFor(item, courseId);
    if (playback) return playback.ended ? '等待平台确认完成' : playback.paused ? '正在准备播放' : '正在播放';
    return latest.currentSectionTitle ? '学习中' : '正在进入课程';
  };
  const clock = value => { const seconds = Math.floor(value); const minutes = Math.floor(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  const playbackText = value => Number.isFinite(value?.currentTime) && Number.isFinite(value?.duration) && value.currentTime >= 0 && value.duration > 0 ? `${clock(Math.min(value.currentTime, value.duration))} / ${clock(value.duration)}` : '';
  const quietMessages = new Set([
    '已暂停', '已完成', '执行中', '学习中',
    '已暂停，确认配置和课程后点击开始。', '已暂停，继续学习需手动点击开始。',
    '正在按平台课节状态连续学习。', '等待平台确认当前课节完成。',
    '所选课程已全部完成。', '已进入学习时段，正在继续队列。', '正在重新进入课程。',
    '已读取待添加清单，请核对课程勾选后添加。',
    '请点击确认要学习的专题。', '请点击确认要学习的专区。',
    '有待学课程，请手动点击开始继续。',
  ]);
  const saveWindow = async () => {
    const next = { start: fields.start.value.trim(), end: fields.end.value.trim() };
    if (JSON.stringify(next) !== JSON.stringify(controller.getState().window) && !await controller.setWindow(next)) return false;
    dirty.clear(); return true;
  };
  const startQueue = async () => {
    if (starting) return;
    starting = true; render(controller.getState());
    try { if (await saveWindow()) await controller.start(); }
    finally { starting = false; render(controller.getState()); }
  };
  const canSort = () => !reordering && !starting && !latest.unavailable && latest.status !== 'preparing' && latest.phase !== 'resuming';
  const moveDisplayedTask = async (id, index) => {
    if (!canSort()) return;
    reordering = true; render(controller.getState());
    try { if (!await controller.moveTask(id, index)) showUiError('顺序未保存，请查看当前提示后重试。'); }
    finally { reordering = false; render(controller.getState()); }
  };
  const movePriority = (id, offset) => {
    const ordered = sortableTasks(); const index = ordered.findIndex(task => task.id === id); const neighbor = ordered[index + offset];
    if (index < 0 || !neighbor) return;
    return moveDisplayedTask(id, latest.tasks.findIndex(task => task.id === neighbor.id));
  };
  const clearDrag = () => {
    draggedTaskId = null;
    for (const node of taskList.children) { delete node.dataset.drop; delete node.dataset.dragging; }
  };
  function createCourseList(parent, taskId = null) {
    const scopeId = taskId || 'draft';
    const modeLabel = element('label', '学习范围', parent); const mode = element('select', '', modeLabel); mode.name = `course-mode-${scopeId}`; mode.title = '切换范围将重设当前勾选'; editors.add(mode);
    for (const [value, text] of [['all-pending', '全部待学'], ['specific', '仅学指定课程']]) { const option = element('option', text, mode); option.value = value; }
    mode.addEventListener('change', async () => {
      if (mode.disabled) return; busy.add(mode); mode.disabled = true;
      try { await controller.setTaskMode(taskId, mode.value); } catch { showUiError('学习范围未保存，请重试。'); }
      finally { busy.delete(mode); render(controller.getState()); }
    });
    const filter = element('input', '', parent); filter.type = 'search'; filter.className = 'filter-input'; filter.name = `course-filter-${scopeId}`; filter.setAttribute('aria-label', '筛选课程名称'); filter.placeholder = '筛选课程名称';
    filter.addEventListener('input', () => render(controller.getState()));
    const selection = element('p', '', parent); selection.className = 'muted';
    const controls = element('div', '', parent); controls.className = 'buttons';
    for (const [modeName, caption] of [['unfinished', '全选待学'], ['required', '仅选必修'], ['none', '清空']]) {
      const btn = button(`select-${modeName}-${scopeId}`, caption, controls, () => controller.selectCourses(taskId, modeName));
      if (modeName === 'none') btn.className = 'ghost';
    }
    const pending = element('div', '', parent); const completed = element('details', '', parent); completed.dataset.completed = '';
    const summary = element('summary', '已完成课程', completed);
    const completedActions = element('div', '', completed); completedActions.className = 'buttons completed-actions';
    button(`select-completed-${scopeId}`, '全选已完成', completedActions, () => controller.selectCourses(taskId, 'completed'));
    if (taskId !== null) button(`recheck-${taskId}`, '复查已选', completedActions, () => controller.recheckCompleted(taskId));
    const completeList = element('div', '', completed);
    const noMatches = element('p', '没有匹配的课程。', parent); noMatches.dataset.noMatches = ''; noMatches.className = 'muted';
    return { pending, completed, summary, completeList, nodes: new Map(), mode, filter, selection, noMatches };
  }
  function updateCourses(view, courses, item = null) {
    const ids = new Set(courses.map(course => course.id));
    for (const [id, row] of view.nodes) if (!ids.has(id)) { editors.delete(row.input); if (row.retry) editors.delete(row.retry); row.label.remove(); view.nodes.delete(id); }
    let completedCount = 0, visibleCount = 0, matchedCompleted = 0, selectedCount = 0, hiddenSelectedCount = 0;
    const query = view.filter.value.trim().toLocaleLowerCase();
    view.mode.value = (item || latest.draft)?.selectionMode || 'all-pending';
    for (const course of courses) {
      let row = view.nodes.get(course.id);
      if (!row) {
        const label = element('label', '', view.pending); label.className = 'course';
        const input = element('input', '', label); input.type = 'checkbox'; input.dataset.course = course.id; editors.add(input);
        const text = element('span', '', label); const caption = element('span', '', text); caption.className = 'course-caption'; const meta = element('small', '', text);
        const section = element('small', '', text); section.className = 'one-line';
        const time = element('small', '', text); time.className = 'playback-time'; const playback = element('progress', '', text); playback.setAttribute('aria-label', '当前课节播放进度');
        input.addEventListener('change', async () => {
          if (input.disabled) return;
          busy.add(input); input.disabled = true;
          try { if (item) await controller.setSelection(item.id, course.id, input.checked); else controller.draftSetSelection(course.id, input.checked); }
          catch { showUiError('勾选未能保存，请重试。'); }
          finally { busy.delete(input); render(controller.getState()); }
        });
        const retry = item ? button(`retry-${item.id}-${course.id}`, '重试', label, () => controller.retry(item.id, course.id)) : null;
        row = { label, input, caption, meta, section, retry, time, playback }; view.nodes.set(course.id, row);
      }
      const recheck = item?.recheck?.includes(course.id);
      const current = item && currentTask(item) && latest.currentCourseId === course.id && !isDone(item, course.id);
      const done = !current && !recheck && (isDone(item, course.id) || course.status === 'completed'); const skipped = item?.skipped.includes(course.id);
      const deferred = item?.deferred?.find(entry => entry.courseId === course.id);
      const status = deferred ? `待处理：${deferred.reason.replace(/[。.]$/u, '')}` : skipped ? '已跳过' : current ? (latest.status === 'paused' ? '当前课程' : executionLabel(item, course.id)) : recheck ? '待复查课节' : isDone(item, course.id) ? '已完成' : ({ completed: '已完成', learning: '学习中', 'not-started': '未开始', unknown: '待确认' }[course.status] || '待确认');
      row.label.dataset.state = current ? 'active' : deferred || skipped ? 'attention' : done ? 'completed' : 'pending';
      const playback = current ? playbackFor(item, course.id) : null; const timeText = playbackText(playback);
      row.time.textContent = timeText; row.time.hidden = !timeText; row.playback.hidden = !timeText;
      row.playback.max = timeText ? playback.duration : 1; row.playback.value = timeText ? Math.min(playback.currentTime, playback.duration) : 0;
      row.caption.textContent = course.title; row.caption.title = course.title;
      const reqTag = course.required ? '必修' : '选修';
      row.meta.textContent = deferred ? `${reqTag} · ${status}` : `${status} · ${reqTag}`; row.input.checked = course.selected;
      row.section.textContent = current && latest.currentSectionTitle ? `课节 · ${latest.currentSectionTitle}` : ''; row.section.title = latest.currentSectionTitle || ''; row.section.hidden = !row.section.textContent;
      row.input.disabled = latest.unavailable || ['running', 'preparing', 'waiting'].includes(latest.status) || Boolean(item?.scope === 'required' && !course.required);
      row.input.dataset.legacyDisabled = String(Boolean(item?.scope === 'required' && !course.required));
      if (row.retry) row.retry.hidden = !skipped && !deferred;
      const container = done && !skipped && !deferred ? view.completeList : view.pending;
      if (row.label.parentNode !== container) container.append(row.label);
      if (done && !skipped && !deferred) completedCount += 1;
      row.label.hidden = Boolean(query && !course.title.toLocaleLowerCase().includes(query));
      const isSelected = Boolean(course.selected && (item?.scope !== 'required' || course.required));
      if (isSelected) { selectedCount += 1; if (row.label.hidden) hiddenSelectedCount += 1; }
      if (!row.label.hidden) { visibleCount += 1; if (container === view.completeList) matchedCompleted += 1; }
    }
    view.selection.textContent = query && hiddenSelectedCount
      ? `已选 ${selectedCount}/${courses.length} 门（含 ${hiddenSelectedCount} 门未显示）`
      : `已选 ${selectedCount}/${courses.length} 门`;
    view.completed.hidden = completedCount === 0; view.summary.textContent = `已完成课程（${completedCount}）`;
    if (query && matchedCompleted) view.completed.open = true;
    view.noMatches.hidden = visibleCount > 0;
  }
  function updateTasks(state) {
    const ids = new Set(state.tasks.map(task => task.id));
    for (const [id, view] of taskNodes) if (!ids.has(id)) { for (const control of view.article.querySelectorAll('button,input,select')) editors.delete(control); view.article.remove(); taskNodes.delete(id); }
    for (const item of state.tasks) {
      let view = taskNodes.get(item.id);
      if (!view) {
        const article = element('article', '', taskList); article.dataset.taskId = item.id;
        const heading = element('div', '', article); heading.className = 'task-head'; const title = element('h3', '', heading);
        const sorting = element('div', '', heading); sorting.className = 'sort-actions';
        const handle = element('button', '↕', sorting); handle.type = 'button'; handle.className = 'sort-handle'; handle.dataset.dragTask = item.id; handle.title = '拖动调整专区顺序';
        const up = button(`move-up-${item.id}`, '↑', sorting, () => movePriority(item.id, -1), false);
        const down = button(`move-down-${item.id}`, '↓', sorting, () => movePriority(item.id, 1), false);
        handle.addEventListener('dragstart', event => {
          if (!canSort() || handle.disabled || completeTask(latest.tasks.find(task => task.id === item.id))) { event.preventDefault(); return; }
          clearDrag(); draggedTaskId = item.id; article.dataset.dragging = '';
          if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }
        });
        handle.addEventListener('dragend', clearDrag);
        const after = event => { const box = article.getBoundingClientRect(); return event.clientY >= box.top + box.height / 2; };
        article.addEventListener('dragover', event => {
          if (!draggedTaskId || !canSort() || completeTask(latest.tasks.find(task => task.id === item.id))) return;
          event.preventDefault(); for (const node of taskList.children) delete node.dataset.drop;
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          if (draggedTaskId !== item.id) article.dataset.drop = after(event) ? 'after' : 'before';
        });
        article.addEventListener('dragleave', event => { if (!article.contains(event.relatedTarget)) delete article.dataset.drop; });
        article.addEventListener('drop', async event => {
          if (!draggedTaskId || !canSort() || completeTask(latest.tasks.find(task => task.id === item.id))) { clearDrag(); return; }
          event.preventDefault(); const id = draggedTaskId;
          const from = latest.tasks.findIndex(task => task.id === id), targetIdx = latest.tasks.findIndex(task => task.id === item.id);
          const insertion = targetIdx + Number(after(event)); clearDrag();
          if (from < 0 || targetIdx < 0 || id === item.id || completeTask(latest.tasks[from])) return;
          try { await moveDisplayedTask(id, insertion - Number(from < insertion)); }
          catch { showUiError('顺序未保存，请查看当前提示后重试。'); }
        });
        const priority = element('p', '', article); priority.className = 'task-priority muted';
        const metaRow = element('div', '', article); metaRow.className = 'task-meta';
        const summary = element('p', '', metaRow); summary.dataset.taskSummary = item.id;
        const detailButton = button(`detail-${item.id}`, '详情 ▾', metaRow, () => { detail.hidden = !detail.hidden; detailButton.textContent = detail.hidden ? '详情 ▾' : '收起 ▴'; detailButton.setAttribute('aria-expanded', String(!detail.hidden)); }, false); detailButton.className = 'ghost detail-toggle'; detailButton.setAttribute('aria-expanded', 'false');
        const completion = element('progress', '', article); completion.dataset.taskProgress = item.id;
        const current = element('div', '', article); current.className = 'task-current';
        const currentName = element('div', '', current); currentName.className = 'current-name';
        const currentSection = element('small', '', current); currentSection.className = 'one-line';
        const currentTime = element('small', '', current); currentTime.className = 'playback-time';
        const detail = element('div', '', article); detail.dataset.taskDetail = item.id; detail.hidden = true;
        const legacy = element('p', '旧任务仅执行必修课程和课节；需要包含选修可移出后重新添加专区。', detail); legacy.className = 'muted';
        const courses = createCourseList(detail, item.id); const actions = element('div', '', detail); actions.className = 'buttons detail-actions';
        const refresh = button(`refresh-${item.id}`, '刷新课程', actions, () => controller.refreshTask(item.id));
        const remove = button(`remove-${item.id}`, '移出队列', actions, async () => {
          if (pendingRemoveId !== item.id) {
            clearRemoveConfirm();
            pendingRemoveId = item.id;
            pendingRemoveTimer = win.setTimeout(() => { clearRemoveConfirm(); render(controller.getState()); }, 3000);
            return;
          }
          clearRemoveConfirm();
          await controller.removeTask(item.id);
        });
        remove.className = 'danger';
        view = { article, title, sorting, priority, summary, completion, current, currentName, currentSection, currentTime, detail, legacy, courses, refresh, remove, handle, up, down }; taskNodes.set(item.id, view);
      }
      const subjectTitle = item.subject?.title || item.target;
      view.title.textContent = subjectTitle; view.title.title = subjectTitle;
      view.handle.setAttribute('aria-label', `拖动排序：${subjectTitle}`);
      view.up.setAttribute('aria-label', `上移：${subjectTitle}`);
      view.down.setAttribute('aria-label', `下移：${subjectTitle}`);
      const sortable = sortableTasks(); const priorityIndex = sortable.findIndex(task => task.id === item.id); const completed = completeTask(item), current = currentTask(item, state);
      const showSort = !completed && sortable.length >= 2;
      view.sorting.hidden = !showSort;
      view.handle.disabled = !canSort() || !showSort; view.handle.draggable = !view.handle.disabled;
      view.up.disabled = !canSort() || !showSort || priorityIndex <= 0; view.down.disabled = !canSort() || !showSort || priorityIndex === sortable.length - 1;
      view.up.title = '上移优先级（当前课程继续）'; view.down.title = '下移优先级（当前课程继续）';
      const confirmingRemove = pendingRemoveId === item.id && !isRunning(state) && !state.unavailable;
      view.remove.textContent = confirmingRemove ? '确认移出？' : '移出队列';
      view.remove.className = confirmingRemove ? 'danger danger-confirm' : 'danger';
      const total = counts(item);
      const issues = [['待处理', total.deferred], ['跳过', item.skipped.length], ['待复查', item.recheck?.length || 0]].filter(([, count]) => count).map(([name, count]) => `${name} ${count}`);
      view.article.dataset.state = current ? 'active' : completed ? 'completed' : issues.length ? 'attention' : 'pending';
      view.priority.textContent = `优先级 ${priorityIndex + 1}`; view.priority.hidden = completed || sortable.length < 2;
      if (!item.subject) view.summary.textContent = '尚未读取专区，请移出后重新添加';
      else if (!total.selected) view.summary.textContent = '尚未选择课程';
      else if (completed) view.summary.textContent = `已完成 ${total.selected} 门`;
      else if (current) view.summary.textContent = `${executionLabel(item)} · 完成 ${total.done}/${total.selected} 门${issues.length ? ` · ${issues.join(' · ')}` : ''}`;
      else if (issues.length) view.summary.textContent = `完成 ${total.done}/${total.selected} 门 · ${issues.join(' · ')}`;
      else view.summary.textContent = `待学习 · 完成 ${total.done}/${total.selected} 门`;
      view.completion.max = total.selected || 1; view.completion.value = total.done; view.completion.hidden = !total.selected; view.completion.setAttribute('aria-label', `专区已完成 ${total.done} / ${total.selected} 门`);
      view.currentName.textContent = current ? item.courses.find(course => course.id === state.currentCourseId)?.title || '正在确认课程' : ''; view.currentName.title = view.currentName.textContent;
      view.currentSection.textContent = current && state.currentSectionTitle ? `课节 · ${state.currentSectionTitle}` : ''; view.currentSection.title = state.currentSectionTitle || ''; view.currentSection.hidden = !view.currentSection.textContent;
      view.currentTime.textContent = current ? playbackText(playbackFor(item, state.currentCourseId)) : ''; view.currentTime.hidden = !view.currentTime.textContent;
      view.legacy.hidden = item.scope !== 'required'; view.refresh.dataset.legacyDisabled = String(!item.subject); updateCourses(view.courses, item.courses, item);
      const activeRow = view.courses.nodes.get(state.currentCourseId)?.label; const folded = activeRow?.closest('details[data-completed]');
      const rowVisible = !view.detail.hidden && activeRow && !activeRow.hidden && (!folded || folded.open);
      view.current.hidden = !current || Boolean(rowVisible);
    }
    const display = [...state.tasks.filter(item => currentTask(item, state)), ...state.tasks.filter(item => !currentTask(item, state) && !completeTask(item)), ...state.tasks.filter(completeTask)];
    for (const [index, item] of display.entries()) { const node = taskNodes.get(item.id).article; if (taskList.children[index] !== node) taskList.insertBefore(node, taskList.children[index] || null); }
  }
  function render(state) {
    latest = state;
    const running = isRunning(state);
    const active = state.tasks.find(item => item.id === state.activeTaskId);
    const all = state.tasks.reduce((sum, task) => { const c = counts(task); return { done: sum.done + c.done, selected: sum.selected + c.selected, deferred: sum.deferred + c.deferred }; }, { done: 0, selected: 0, deferred: 0 });
    progress.textContent = `${phaseLabels[state.phase || state.status] || state.status} · 总完成 ${all.done}/${all.selected} 门${all.deferred ? ` · 待处理 ${all.deferred}` : ''}`;
    compact.textContent = active?.courses.find(course => course.id === state.currentCourseId)?.title || ''; compact.title = compact.textContent; compact.hidden = !body.hidden || !compact.textContent;
    compactTime.textContent = active ? playbackText(playbackFor(active, state.currentCourseId)) : ''; compactTime.hidden = !body.hidden || !compactTime.textContent;
    const rawNotice = quietMessages.has(state.message) ? '' : String(state.message || '').replace(/有待学课程，请手动点击开始继续。$/u, '').trim();
    const notice = quietMessages.has(rawNotice) ? '' : rawNotice;
    message.textContent = notice; execution.hidden = !notice || notice === state.problem?.reason;
    compactNotice.textContent = notice || state.problem?.reason || ''; compactNotice.hidden = !body.hidden || !compactNotice.textContent;
    problemBox.hidden = !state.problem;
    if (state.problem) { const item = state.tasks.find(task => task.id === state.problem.taskId); problemText.textContent = `${item?.subject?.title || item?.target || '专区'} · ${item?.courses.find(course => course.id === state.problem.courseId)?.title || '课程'}\n${state.problem.reason}`; }
    if (state.draft) adding = true;
    else if (draftSubjectId && state.tasks.some(item => item.subject?.id === draftSubjectId)) adding = false;
    draftSubjectId = state.draft?.subject.id || null;
    queueView.hidden = adding; addView.hidden = !adding; searchBox.hidden = Boolean(state.draft); draftBox.hidden = !state.draft;
    settingsBox.hidden = adding;
    empty.hidden = state.tasks.length > 0;
    for (const [name, field] of Object.entries(fields)) if (!dirty.has(name) && root.activeElement !== field) field.value = state.window[name];
    updateTasks(state);
    const signature = JSON.stringify(state.candidates);
    if (candidateSignature !== signature) { candidateSignature = signature; for (const control of candidates.querySelectorAll('button')) editors.delete(control); candidates.replaceChildren(); if (state.candidates.length) element('p', '选择要添加的专区：', candidates); for (const item of state.candidates) { const candidate = button(`candidate-${item.id}`, item.title, candidates, () => controller.chooseCandidate(item.id)); candidate.className = 'candidate'; } }
    candidates.hidden = !adding || Boolean(state.draft) || running || !state.candidates.length;
    if (state.draft) { draftTitle.textContent = state.draft.subject.title; updateCourses(draftCourses, state.draft.courses); }
    for (const control of editors) control.disabled = running || state.unavailable || control.dataset.legacyDisabled === 'true';
    automatic.checked = state.automation?.enabled === true; resumeOnReload.checked = state.automation?.resumeOnReload === true; mute.checked = state.automation?.mute !== false;
    resumeOnReload.disabled ||= !automatic.checked;
    autoHint.hidden = !automatic.checked;
    runningEditHint.hidden = !running;
    settingsSummary.textContent = `设置 · ${state.window.start}–${state.window.end}${automatic.checked ? ' · 自动开' : ''}${mute.checked ? ' · 已静音' : ''}`;
    for (const control of problemActions.querySelectorAll('button')) if (control !== leaveLearningButton) control.disabled ||= adding;
    const showLeave = !running && !adding && Boolean(state.onOwnedLearningPage);
    if (showLeave) {
      const targetParent = state.problem ? problemActions : leaveBar;
      if (leaveLearningButton.parentNode !== targetParent) targetParent.append(leaveLearningButton);
    }
    leaveLearningButton.hidden = !showLeave;
    leaveLearningButton.disabled = !showLeave || state.unavailable;
    leaveBar.hidden = !showLeave || Boolean(state.problem);
    if (running || state.unavailable) clearRemoveConfirm();
    const hasPending = state.tasks.some(item => item.subject && eligible(item).some(course => !isDone(item, course.id) && !item.skipped.includes(course.id) && !item.deferred?.some(entry => entry.courseId === course.id)));
    const cannotStart = starting || state.unavailable || adding || Boolean(state.draft) || !hasPending;
    const hasStarted = Boolean(state.currentCourseId) || state.tasks.some(item => item.current || item.done.length || item.skipped.length || item.deferred?.length);
    const completedCount = state.tasks.filter(item => completeTask(item) && !(running && item.id === state.activeTaskId)).length;
    clearCompleted.textContent = `清除已完成（${completedCount}）`;
    clearCompleted.hidden = !completedCount;
    clearCompleted.disabled = !completedCount || state.unavailable || state.status === 'preparing' || state.phase === 'resuming';
    addButton.className = state.tasks.length === 0 ? 'primary' : '';
    addButton.title = running ? '暂停后可添加专区' : '';
    runButton.textContent = running ? '暂停' : state.status === 'complete' ? '已完成' : hasStarted ? '继续' : '开始';
    runButton.className = !running && state.status !== 'complete' ? 'primary' : '';
    runButton.disabled = starting || (!running && cannotStart); toggle.disabled = false;
    for (const control of busy) control.disabled = true;
  }
  const unsubscribe = controller.subscribe(render);
  const panel = { open() { setOpen(true); }, destroy() { clearTimers(); unsubscribe(); host.remove(); } };
  host.wdPanel = panel; document.documentElement.append(host); render(controller.getState());
  return panel;
}
