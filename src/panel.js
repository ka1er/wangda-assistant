export function createPanel(win, controller, version) {
  const document = win.document;
  const existing = document.getElementById('wangda-assistant');
  if (existing?.wdPanel) return existing.wdPanel;
  const host = document.createElement('div');
  host.id = 'wangda-assistant';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  const element = (tag, text = '', parent = root) => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  element('style', ':host{all:initial;color:#17344d;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif}*{box-sizing:border-box}[hidden]{display:none!important}button,input{font:inherit}button{cursor:pointer;border:1px solid #a8c6e6;background:#f5faff;border-radius:5px;padding:5px 9px;color:#155a9b}button:hover{background:#e6f2ff}button:disabled{opacity:.5;cursor:default}button.primary{background:#176ac2;color:#fff;border-color:#176ac2}section{width:380px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #a9c5e1;border-radius:10px;box-shadow:0 5px 28px #12345630;overflow:hidden}header{padding:10px 12px;background:#edf5ff}header strong{font-size:15px}.headline,.buttons,.row{display:flex;align-items:center;gap:7px}.headline{justify-content:space-between}.buttons{flex-wrap:wrap;margin:9px 0}.row{align-items:flex-start}.row label{flex:1;min-width:0}small,.muted{font-size:12px;color:#56748f}.progress{margin-top:7px;font-size:12px}.body{padding:12px;max-height:calc(100dvh - 155px);overflow-y:auto;overscroll-behavior:contain}.status,.problem{padding:9px;background:#eff6fd;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:5px;margin-bottom:10px}.problem{background:#fff6e8;border:1px solid #edc88d}h2{font-size:14px;margin:10px 0}p{margin:6px 0;overflow-wrap:anywhere}label{display:block;margin-bottom:8px}input[type=text]{width:100%;border:1px solid #b8c9d9;border-radius:4px;background:#fff;color:#17344d;padding:6px}input[type=checkbox]{margin:3px 0;flex-shrink:0}input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid #176ac2;outline-offset:2px}article{border:1px solid #d2e1ef;border-radius:6px;padding:10px;margin:8px 0}article h3{font-size:13px;margin:0 0 5px;overflow-wrap:anywhere}.course{display:flex;align-items:flex-start;gap:7px;margin:0;padding:7px 0;border-bottom:1px solid #edf2f7}.course:last-child{border-bottom:0}.course span{flex:1;overflow-wrap:anywhere}.course small{display:block}.course button{font-size:12px;padding:2px 5px}details{margin:8px 0}summary{cursor:pointer;color:#155a9b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace;margin:6px 0}.candidate{width:100%;text-align:left;overflow-wrap:anywhere;margin:4px 0}.separator{border-top:1px solid #e2ebf3;margin-top:12px;padding-top:3px}');
  const shell = element('section'); shell.setAttribute('aria-label', '网大助手');
  element('style', 'section{display:flex;flex-direction:column;max-height:calc(100dvh - 32px)}header{flex-shrink:0}.body{min-height:0}');
  element('style', '.task-head{display:flex;align-items:flex-start;gap:7px}.task-head h3{flex:1;min-width:0}.sort-actions{display:flex;gap:4px;flex-shrink:0}.sort-actions button{padding:2px 5px;font-size:12px}.sort-handle{cursor:grab}.sort-handle:active{cursor:grabbing}article[data-drop=before]{border-top:3px solid #176ac2}article[data-drop=after]{border-bottom:3px solid #176ac2}article[data-dragging]{opacity:.6}');
  const header = element('header', '', shell);
  const headline = element('div', '', header); headline.className = 'headline';
  const title = element('div', '', headline); element('strong', '网大助手', title); element('small', ` ${version}`, title);
  const headerButtons = element('div', '', headline); headerButtons.className = 'row';
  const busy = new Set(); const editors = new Set(); let adding = false; let starting = false; let reordering = false; let draggedTaskId = null; let latest = controller.getState();
  const button = (action, text, parent, handler, edit = true) => {
    const node = element('button', text, parent); node.type = 'button'; node.dataset.action = action;
    if (edit) editors.add(node);
    node.addEventListener('click', async () => {
      if (node.disabled || busy.has(node)) return;
      busy.add(node); node.disabled = true;
      try { await handler(); } catch { diagnostic.textContent = '操作未完成，请查看当前状态后重试。'; }
      finally { busy.delete(node); node.disabled = false; render(controller.getState()); }
    });
    return node;
  };
  const isRunning = state => ['running', 'preparing', 'waiting'].includes(state.status) || state.phase === 'resuming';
  const runButton = button('run-toggle', '开始', headerButtons, () => isRunning(controller.getState()) ? controller.pause() : startQueue(), false);
  const toggle = button('toggle', '展开', headerButtons, () => setOpen(body.hidden), false); toggle.setAttribute('aria-expanded', 'false');
  const progress = element('div', '', header); progress.className = 'progress'; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
  const compact = element('div', '', header); compact.className = 'muted'; compact.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:4.5em;overflow:auto;';
  const body = element('div', '', shell); body.className = 'body'; body.hidden = true;
  const execution = element('div', '', body); execution.className = 'status';
  const currentText = element('div', '', execution); const message = element('div', '', execution);
  const problemBox = element('div', '', body); problemBox.className = 'problem'; problemBox.dataset.problem = '';
  const problemText = element('div', '', problemBox); const problemActions = element('div', '', problemBox); problemActions.className = 'buttons';
  button('retry', '重试本课程', problemActions, () => controller.retry(latest.problem?.taskId, latest.problem?.courseId));
  button('skip', '跳过并继续', problemActions, () => controller.skipCurrent());
  const queueView = element('div', '', body); queueView.dataset.view = 'queue';
  const queueHeading = element('div', '', queueView); queueHeading.className = 'headline'; element('h2', '任务队列', queueHeading);
  button('add', '添加专区', queueHeading, () => { adding = true; render(controller.getState()); target.focus(); });
  element('p', '拖动 ↕ 调整先后；当前课程继续，下一门按新顺序执行。', queueView).className = 'muted';
  const empty = element('p', '还没有任务，点击“添加专区”开始。', queueView); empty.className = 'muted';
  const taskList = element('div', '', queueView);
  const queueControls = element('div', '', queueView); queueControls.className = 'buttons';
  const startButton = button('start', '开始 / 继续队列', queueControls, () => startQueue()); startButton.className = 'primary';
  const addView = element('div', '', body); addView.dataset.view = 'add';
  element('h2', '添加专区', addView);
  const searchBox = element('div', '', addView);
  const labelInput = (caption, name, parent) => { const label = element('label', caption, parent); const input = element('input', '', label); input.type = 'text'; input.name = name; input.id = `wd-${name}`; label.htmlFor = input.id; editors.add(input); return input; };
  const target = labelInput('专区名称', 'target', searchBox);
  const searchActions = element('div', '', searchBox); searchActions.className = 'buttons';
  button('search', '搜索专区', searchActions, () => controller.search(target.value.trim()));
  button('collect', '读取当前专区', searchActions, () => controller.collectDraft());
  const candidates = element('div', '', addView); candidates.dataset.candidates = '';
  const draftBox = element('div', '', addView); draftBox.dataset.draft = '';
  const draftTitle = element('h3', '', draftBox);
  const draftHelp = element('p', '核对课程后加入队列；已完成和待确认课程默认不勾选。', draftBox); draftHelp.className = 'muted';
  const draftCourses = createCourseList(draftBox);
  const addActions = element('div', '', draftBox); addActions.className = 'buttons';
  const addDraftButton = button('add-draft', '加入队列', addActions, async () => { if (await controller.addDraft()) { adding = false; target.value = ''; } }); addDraftButton.className = 'primary';
  button('back', '取消添加，返回队列', addView, async () => { if (await controller.discardDraft() !== false) { adding = false; target.value = ''; } });
  const windowBox = element('details', '', body); windowBox.className = 'separator'; element('summary', '学习时段（北京时间）', windowBox);
  const windowRow = element('div', '', windowBox); windowRow.className = 'row';
  const fields = { start: labelInput('开始时间', 'start', windowRow), end: labelInput('结束时间（支持24:00）', 'end', windowRow) };
  const dirty = new Set(); for (const [name, field] of Object.entries(fields)) field.addEventListener('input', () => dirty.add(name));
  button('save-window', '保存学习时段', windowBox, () => saveWindow());
  const autoBox = element('div', '', body); autoBox.className = 'separator'; element('h2', '自动模式', autoBox);
  function automaticInput(name, caption) {
    const label = element('label', '', autoBox); const input = element('input', '', label); input.type = 'checkbox'; input.name = name; editors.add(input);
    element('span', ` ${caption}`, label);
    input.addEventListener('change', async () => {
      if (input.disabled) return;
      busy.add(input); input.disabled = true;
      try { await controller.setAutomation({ enabled: automatic.checked, resumeOnReload: automatic.checked && resumeOnReload.checked }); }
      catch { diagnostic.textContent = '自动设置保存失败，请重试。'; }
      finally { busy.delete(input); render(controller.getState()); }
    }); return input;
  }
  const automatic = automaticInput('automatic', '自动重试、暂存异常课程并续学');
  const resumeOnReload = automaticInput('resumeOnReload', '刷新或重新打开后恢复已开始的队列');
  element('p', '开启后，到学习时段自动继续；主动暂停会取消自动执行。需保持浏览器和网大页面打开。', autoBox).className = 'muted';
  const utility = element('div', '', body); utility.className = 'buttons';
  button('stop-learning', '停止学习并退出', utility, () => controller.pause(), false);
  button('diagnose', '页面诊断', utility, () => { diagnostic.textContent = JSON.stringify(controller.diagnose(), null, 2); }, false);
  const diagnostic = element('pre', '', body);
  const taskNodes = new Map(); let candidateSignature = ''; let draftSubjectId = null;
  const setOpen = open => { body.hidden = !open; toggle.textContent = open ? '收起' : '展开'; toggle.setAttribute('aria-expanded', String(open)); };
  const eligible = task => task.courses.filter(course => course.selected && (task.scope === 'all' || course.required));
  const counts = task => { const selected = eligible(task); return { selected: selected.length, done: selected.filter(course => task.done.includes(course.id)).length, skipped: selected.filter(course => task.skipped.includes(course.id)).length, deferred: task.deferred?.length || 0 }; };
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
    try { if (!await controller.moveTask(id, index)) diagnostic.textContent = '顺序未保存，请查看当前提示后重试。'; }
    finally { reordering = false; render(controller.getState()); }
  };
  const clearDrag = () => {
    draggedTaskId = null;
    for (const node of taskList.children) { delete node.dataset.drop; delete node.dataset.dragging; }
  };
  function createCourseList(parent, taskId = null) {
    const controls = element('div', '', parent); controls.className = 'buttons';
    for (const [mode, caption] of [['unfinished', '全部未完成'], ['required', '仅必修'], ['none', '清空选择']]) button(`select-${mode}-${taskId || 'draft'}`, caption, controls, () => controller.selectCourses(taskId, mode));
    const pending = element('div', '', parent); const completed = element('details', '', parent); completed.dataset.completed = '';
    const summary = element('summary', '已完成课程', completed); const completeList = element('div', '', completed);
    return { pending, completed, summary, completeList, nodes: new Map() };
  }
  function updateCourses(view, courses, item = null) {
    const ids = new Set(courses.map(course => course.id));
    for (const [id, row] of view.nodes) if (!ids.has(id)) { editors.delete(row.input); if (row.retry) editors.delete(row.retry); row.label.remove(); view.nodes.delete(id); }
    let completedCount = 0;
    for (const course of courses) {
      let row = view.nodes.get(course.id);
      if (!row) {
        const label = element('label', '', view.pending); label.className = 'course';
        const input = element('input', '', label); input.type = 'checkbox'; input.dataset.course = course.id; editors.add(input);
        const text = element('span', '', label); const caption = element('span', '', text); const meta = element('small', '', text);
        input.addEventListener('change', async () => {
          if (input.disabled) return;
          busy.add(input); input.disabled = true;
          try { if (item) await controller.setSelection(item.id, course.id, input.checked); else controller.draftSetSelection(course.id, input.checked); }
          catch { diagnostic.textContent = '勾选未能保存，请重试。'; }
          finally { busy.delete(input); render(controller.getState()); }
        });
        const retry = item ? button(`retry-${item.id}-${course.id}`, '重试', label, () => controller.retry(item.id, course.id)) : null;
        row = { label, input, caption, meta, retry }; view.nodes.set(course.id, row);
      }
      const done = item?.done.includes(course.id) || course.status === 'completed'; const skipped = item?.skipped.includes(course.id);
      const deferred = item?.deferred?.find(entry => entry.courseId === course.id);
      const status = item?.done.includes(course.id) ? '已完成' : deferred ? `待处理：${deferred.reason}` : skipped ? '已跳过' : ({ completed: '已完成', learning: '学习中', 'not-started': '未开始', unknown: '待确认' }[course.status] || '待确认');
      row.caption.textContent = course.title; row.meta.textContent = `${status} · ${course.required ? '必修' : '选修'}`; row.input.checked = course.selected;
      row.input.disabled = latest.unavailable || ['running', 'preparing', 'waiting'].includes(latest.status) || Boolean(item?.scope === 'required' && !course.required);
      row.input.dataset.legacyDisabled = String(Boolean(item?.scope === 'required' && !course.required));
      if (row.retry) row.retry.hidden = !skipped && !deferred;
      const container = done && !skipped && !deferred ? view.completeList : view.pending;
      if (row.label.parentNode !== container) container.append(row.label);
      if (done && !skipped && !deferred) completedCount += 1;
    }
    view.completed.hidden = completedCount === 0; view.summary.textContent = `已完成课程（${completedCount}）`;
  }
  function updateTasks(state) {
    const ids = new Set(state.tasks.map(task => task.id));
    for (const [id, view] of taskNodes) if (!ids.has(id)) { for (const control of view.article.querySelectorAll('button,input')) editors.delete(control); view.article.remove(); taskNodes.delete(id); }
    for (const [index, item] of state.tasks.entries()) {
      let view = taskNodes.get(item.id);
      if (!view) {
        const article = element('article', '', taskList); article.dataset.taskId = item.id;
        const heading = element('div', '', article); heading.className = 'task-head'; const title = element('h3', '', heading);
        const sorting = element('div', '', heading); sorting.className = 'sort-actions';
        const handle = element('button', '↕', sorting); handle.type = 'button'; handle.className = 'sort-handle'; handle.dataset.dragTask = item.id; handle.title = '拖动调整专区顺序';
        const up = button(`move-up-${item.id}`, '上移', sorting, () => moveDisplayedTask(item.id, latest.tasks.findIndex(task => task.id === item.id) - 1), false);
        const down = button(`move-down-${item.id}`, '下移', sorting, () => moveDisplayedTask(item.id, latest.tasks.findIndex(task => task.id === item.id) + 1), false);
        handle.addEventListener('dragstart', event => {
          if (!canSort()) { event.preventDefault(); return; }
          clearDrag(); draggedTaskId = item.id; article.dataset.dragging = '';
          if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }
        });
        handle.addEventListener('dragend', clearDrag);
        const after = event => { const box = article.getBoundingClientRect(); return event.clientY >= box.top + box.height / 2; };
        article.addEventListener('dragover', event => {
          if (!draggedTaskId || !canSort()) return;
          event.preventDefault(); for (const node of taskList.children) delete node.dataset.drop;
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          if (draggedTaskId !== item.id) article.dataset.drop = after(event) ? 'after' : 'before';
        });
        article.addEventListener('dragleave', event => { if (!article.contains(event.relatedTarget)) delete article.dataset.drop; });
        article.addEventListener('drop', async event => {
          if (!draggedTaskId || !canSort()) return;
          event.preventDefault(); const id = draggedTaskId;
          const from = latest.tasks.findIndex(task => task.id === id), target = latest.tasks.findIndex(task => task.id === item.id);
          const insertion = target + Number(after(event)); clearDrag();
          if (from < 0 || target < 0 || id === item.id) return;
          try { await moveDisplayedTask(id, insertion - Number(from < insertion)); }
          catch { diagnostic.textContent = '顺序未保存，请查看当前提示后重试。'; }
        });
        const summary = element('p', '', article); summary.dataset.taskSummary = item.id;
        const detailButton = button(`detail-${item.id}`, '查看详情', article, () => { detail.hidden = !detail.hidden; detailButton.textContent = detail.hidden ? '查看详情' : '收起详情'; detailButton.setAttribute('aria-expanded', String(!detail.hidden)); }, false); detailButton.setAttribute('aria-expanded', 'false');
        const detail = element('div', '', article); detail.dataset.taskDetail = item.id; detail.hidden = true;
        const legacy = element('p', '旧任务仅执行必修课程和课节；需要包含选修可移出后重新添加专区。', detail); legacy.className = 'muted';
        const courses = createCourseList(detail, item.id); const actions = element('div', '', detail); actions.className = 'buttons';
        const refresh = button(`refresh-${item.id}`, '更新清单', actions, () => controller.refreshTask(item.id));
        button(`remove-${item.id}`, '移出队列', actions, () => controller.removeTask(item.id));
        view = { article, title, summary, detail, legacy, courses, refresh, handle, up, down }; taskNodes.set(item.id, view);
      }
      view.title.textContent = `${index + 1}. ${item.subject?.title || item.target}`;
      view.handle.setAttribute('aria-label', `拖动排序：${item.subject?.title || item.target}`);
      view.handle.disabled = !canSort() || state.tasks.length < 2; view.handle.draggable = !view.handle.disabled;
      view.up.disabled = !canSort() || index === 0; view.down.disabled = !canSort() || index === state.tasks.length - 1;
      if (taskList.children[index] !== view.article) taskList.insertBefore(view.article, taskList.children[index] || null);
      const total = counts(item);
      const status = !item.subject ? '尚未读取专区，请移出后重新添加' : !total.selected ? '尚未选择课程' : item.id === state.activeTaskId && ['running', 'preparing', 'waiting'].includes(state.status) ? '执行中' : total.deferred ? '有待处理课程' : item.skipped.length ? '有跳过课程待重试' : total.done === total.selected ? '全部完成' : '待学习';
      view.summary.textContent = `所选 ${total.selected} · 完成 ${total.done} · 待处理 ${total.deferred} · 跳过 ${total.skipped} · ${status}`;
      view.legacy.hidden = item.scope !== 'required'; view.refresh.dataset.legacyDisabled = String(!item.subject); updateCourses(view.courses, item.courses, item);
    }
  }
  function render(state) {
    latest = state;
    const running = isRunning(state);
    const active = state.tasks.find(item => item.id === state.activeTaskId); const total = active ? counts(active) : { done: 0, selected: 0 };
    const labels = { paused: '已暂停', preparing: '正在准备', running: '学习中', complete: '已完成', retrying: '正在重试', waiting: '等待学习时段', offline: '等待网络', resuming: '正在恢复' };
    const all = state.tasks.reduce((sum, task) => { const c = counts(task); return { done: sum.done + c.done, selected: sum.selected + c.selected, deferred: sum.deferred + c.deferred }; }, { done: 0, selected: 0, deferred: 0 });
    progress.textContent = `${labels[state.phase || state.status] || state.status} · 专区 ${active ? state.tasks.indexOf(active) + 1 : 0}/${state.tasks.length} · 本任务完成 ${total.done}/${total.selected} 门 · 总完成 ${all.done}/${all.selected}${all.deferred ? ` · 待处理 ${all.deferred}` : ''}`;
    compact.textContent = [active?.courses.find(course => course.id === state.currentCourseId)?.title || '', state.message].filter(Boolean).join('\n');
    currentText.textContent = [`当前专区：${active?.subject?.title || '—'}`, `当前课程：${active?.courses.find(course => course.id === state.currentCourseId)?.title || '—'}`, `当前课节：${state.currentSectionTitle || '—'}`].join('\n'); message.textContent = state.message;
    problemBox.hidden = !state.problem;
    if (state.problem) { const item = state.tasks.find(task => task.id === state.problem.taskId); problemText.textContent = `${item?.subject?.title || item?.target || '专区'} · ${item?.courses.find(course => course.id === state.problem.courseId)?.title || '课程'}\n${state.problem.reason}`; }
    if (state.draft) adding = true;
    else if (draftSubjectId && state.tasks.some(item => item.subject?.id === draftSubjectId)) adding = false;
    draftSubjectId = state.draft?.subject.id || null;
    queueView.hidden = adding; addView.hidden = !adding; searchBox.hidden = Boolean(state.draft); draftBox.hidden = !state.draft;
    empty.hidden = state.tasks.length > 0;
    for (const [name, field] of Object.entries(fields)) if (!dirty.has(name) && root.activeElement !== field) field.value = state.window[name];
    updateTasks(state);
    const signature = JSON.stringify(state.candidates);
    if (candidateSignature !== signature) { candidateSignature = signature; for (const control of candidates.querySelectorAll('button')) editors.delete(control); candidates.replaceChildren(); if (state.candidates.length) element('p', '请选择要添加的专区：', candidates); for (const item of state.candidates) { const candidate = button(`candidate-${item.id}`, item.title, candidates, () => controller.chooseCandidate(item.id)); candidate.className = 'candidate'; } }
    candidates.hidden = !adding || Boolean(state.draft) || running || !state.candidates.length;
    if (state.draft) { draftTitle.textContent = state.draft.subject.title; updateCourses(draftCourses, state.draft.courses); }
    for (const control of editors) control.disabled = running || state.unavailable || control.dataset.legacyDisabled === 'true';
    automatic.checked = state.automation?.enabled === true; resumeOnReload.checked = state.automation?.resumeOnReload === true;
    resumeOnReload.disabled ||= !automatic.checked;
    for (const control of problemActions.querySelectorAll('button')) control.disabled ||= adding;
    const hasPending = state.tasks.some(item => item.subject && eligible(item).some(course => !item.done.includes(course.id) && !item.skipped.includes(course.id) && !item.deferred?.some(entry => entry.courseId === course.id)));
    const cannotStart = starting || state.unavailable || adding || Boolean(state.draft) || !hasPending;
    const hasStarted = Boolean(state.currentCourseId) || state.tasks.some(item => item.current || item.done.length || item.skipped.length || item.deferred?.length);
    startButton.disabled = running || cannotStart;
    runButton.textContent = running ? '暂停' : state.status === 'complete' ? '已完成' : hasStarted ? '继续' : '开始';
    runButton.disabled = starting || (!running && cannotStart); toggle.disabled = false;
    for (const control of busy) control.disabled = true;
  }
  const unsubscribe = controller.subscribe(render);
  const panel = { open() { setOpen(true); }, destroy() { unsubscribe(); host.remove(); } };
  host.wdPanel = panel; document.documentElement.append(host); render(controller.getState());
  return panel;
}
