import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPanel } from '../src/panel.js';

const course = (id, status = 'not-started', selected = true, required = true) => ({ id, title: `课程${id}`, status, selected, required, route: `#/study/course/detail/subject-course/${id}/6/s` });
const task = (id = 't', courses = [course('a'), course('b', 'completed', false, false)]) => ({ id, target: '搜索名称', subject: { id: 's', title: '正式专区标题', route: '#/study/subject/detail/s' }, scope: 'all', courses, done: [], skipped: [], current: null });
function fixture(overrides = {}) {
  const dom = new JSDOM('<body></body>');
  const state = { status: 'paused', message: '已暂停', unavailable: false, window: { start: '09:00', end: '24:00' }, tasks: [], activeTaskId: null, currentCourseId: null, currentSectionTitle: '', candidates: [], draft: null, problem: null, courses: [], ...overrides };
  const calls = []; let listener;
  const emit = patch => { Object.assign(state, patch); listener(state); };
  const controller = { getState: () => structuredClone(state), subscribe: fn => { listener = fn; return () => {}; } };
  for (const name of ['search', 'chooseCandidate', 'collectDraft', 'setSelection', 'setTaskMode', 'recheckCompleted', 'refreshTask', 'removeTask', 'clearCompletedTasks', 'setWindow', 'start', 'pause', 'retry', 'skipCurrent', 'draftSetSelection', 'discardDraft', 'selectCourses', 'setAutomation']) controller[name] = async (...args) => { calls.push([name, ...args]); if (name === 'setWindow') emit({ window: args[0] }); if (name === 'setAutomation') emit({automation:args[0]}); return true; };
  controller.addDraft = async () => { calls.push(['addDraft']); emit({ tasks: [...state.tasks, task()], draft: null, candidates: [] }); return true; };
  controller.moveTask = async (id, index) => { calls.push(['moveTask',id,index]); const tasks=[...state.tasks]; tasks.splice(index,0,...tasks.splice(tasks.findIndex(t=>t.id===id),1)); emit({tasks}); return true; };
  controller.diagnose = () => { calls.push(['diagnose']); return { kind: 'home', courses: 0 }; };
  const panel = createPanel(dom.window, controller, 'test-version'); const root = dom.window.document.getElementById('wangda-assistant').shadowRoot;
  const click = async action => { const node = root.querySelector(`[data-action="${action}"]`); assert.ok(node, `缺少${action}按钮`); node.click(); for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const close = () => { panel.destroy(); dom.window.close(); };
  return { dom, state, calls, emit, root, click, close, panel };
}
const visibleText = node => [node, ...node.querySelectorAll('*')].filter(n => n.tagName !== 'STYLE' && !n.closest?.('[hidden]')).flatMap(n => [...n.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent)).join(' ');

test('清除已完成按钮展示可清数量，运行时保留当前任务，无完成项及不可编辑时禁用', async () => {
  const done=task('done',[course('d')]);done.done=['d'];const current=task('current',[course('c')]);current.done=['c'];const f=fixture({tasks:[done,current,task('pending')],status:'running',activeTaskId:'current',currentCourseId:'c'});f.panel.open();
  const clear=f.root.querySelector('[data-action="clear-completed"]');assert.ok(clear);assert.match(clear.textContent,/清除已完成.*1/u);assert.equal(clear.disabled,false);await f.click('clear-completed');assert.deepEqual(f.calls.at(-1),['clearCompletedTasks']);assert.equal(f.calls.some(call=>call[0]==='pause'),false);
  f.emit({status:'paused'});assert.match(clear.textContent,/2/u);for(const patch of [{status:'preparing'},{status:'paused',phase:'resuming'},{status:'paused',phase:'paused',unavailable:true},{unavailable:false,tasks:[task('pending')]}]){f.emit(patch);assert.equal(clear.disabled,true);}f.close();
});

test('自动模式内静音开关默认开启且独立于自动重试，选择保存后保持', async () => {
  const f=fixture({tasks:[task()],automation:{enabled:false,resumeOnReload:false}});f.panel.open();const mute=f.root.querySelector('[name="mute"]');assert.ok(mute);assert.equal(mute.checked,true);assert.equal(mute.disabled,false);assert.match(mute.closest('label').textContent,/自动静音课程/u);
  mute.checked=false;mute.dispatchEvent(new f.dom.window.Event('change'));for(let i=0;i<30;i++)await Promise.resolve();assert.deepEqual(f.calls.at(-1),['setAutomation',{enabled:false,resumeOnReload:false,mute:false}]);f.emit({message:'更新'});assert.equal(mute.checked,false);
  f.emit({status:'running'});assert.equal(mute.disabled,true);f.close();
});

test('展开仅卡片显示当前课程，打开详情转移到课程行，收起显示简要时间', async () => {
  const title='示例课程：信息整理与协作应用';const t=task('t',[{...course('v'),title}]);const f=fixture({tasks:[t],status:'running',activeTaskId:'t',currentCourseId:'v',currentSectionTitle:'示例视频课节',message:'正在按平台课节状态连续学习。',currentPlayback:{taskId:'t',courseId:'v',sectionId:'s',paused:false,ended:false,currentTime:61,duration:120}});f.panel.open();
  assert.doesNotMatch(visibleText(f.root.querySelector('header')),/信息整理|01:01/u);assert.equal(f.root.querySelector('.status').hidden,true);assert.equal(visibleText(f.root).split(title).length-1,1);assert.doesNotMatch(visibleText(f.root),/待处理 0|跳过 0|所选 1|专区待学|正在按平台课节/u);
  await f.click('detail-t');assert.equal(f.root.querySelector('.task-current').hidden,true);assert.equal(visibleText(f.root).split(title).length-1,1);assert.match(visibleText(f.root),/示例视频课节.*01:01 \/ 02:00/su);
  const filter=f.root.querySelector('[name="course-filter-t"]');filter.value='不匹配';filter.dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.root.querySelector('.task-current').hidden,false);assert.equal(visibleText(f.root).split(title).length-1,1);filter.value='';filter.dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.root.querySelector('.task-current').hidden,true);
  await f.click('toggle');const header=f.root.querySelector('header');assert.equal(visibleText(header).split(title).length-1,1);assert.match(visibleText(header),/总完成 0\/1.*01:01 \/ 02:00/su);assert.equal(f.root.querySelector('.compact-course').title,title);f.close();
});

test('精简面板保留未知错误、断网重试及人工原因，异常块只显示一次', async () => {
  const f=fixture({tasks:[task()],activeTaskId:'t',currentCourseId:'a',status:'paused',message:'页面已离开目标课程，请确认后重新开始。'});f.panel.open();assert.match(visibleText(f.root),/页面已离开目标课程/u);assert.equal(f.root.querySelector('.status').hidden,false);
  f.emit({status:'running',phase:'retrying',message:'正在等待重试 1/3。'});assert.match(visibleText(f.root),/重试 1\/3/u);await f.click('toggle');assert.match(visibleText(f.root.querySelector('header')),/重试 1\/3/u);
  f.emit({status:'paused',phase:'paused',problem:{taskId:'t',courseId:'a',reason:'请人工完成课后测验'},message:'请人工完成课后测验'});await f.click('toggle');assert.equal(visibleText(f.root).split('请人工完成课后测验').length-1,1);f.close();
});

test('旧人工问题不能遮住最新重学提示，内容相同时才去重', async () => {
  const f=fixture({tasks:[task()],status:'paused',activeTaskId:'t',currentCourseId:'a',problem:{taskId:'t',courseId:'a',reason:'请人工完成旧课后测验'},message:'遇到重新学习提示，请核对归档恢复记录'});f.panel.open();
  assert.match(visibleText(f.root),/归档恢复记录/u);assert.match(visibleText(f.root),/旧课后测验/u);await f.click('toggle');assert.match(visibleText(f.root.querySelector('header')),/归档恢复记录/u);f.close();
});

test('当前专区置顶、完成专区沉底且不改保存顺序，暂停与完成后正确分组', async () => {
  const done=task('done',[course('d')]);done.done=['d'];
  const waiting=task('waiting',[course('w')]);const active=task('active',[course('v')]);
  const f=fixture({tasks:[done,waiting,active],activeTaskId:'active',currentCourseId:'v',status:'running'});
  const order=()=>[...f.root.querySelectorAll('article')].map(n=>n.dataset.taskId);
  assert.deepEqual(order(),['active','waiting','done']);assert.deepEqual(f.state.tasks.map(t=>t.id),['done','waiting','active']);assert.equal(f.calls.length,0);
  assert.equal(f.root.querySelector('[data-task-id="active"]').dataset.state,'active');assert.equal(f.root.querySelector('[data-task-id="done"]').dataset.state,'completed');
  assert.equal(f.root.querySelector('[data-task-progress="done"]').value,1);assert.match(f.root.querySelector('[data-task-id="active"]').textContent,/优先级 2/u);
  await f.click('detail-active');const detail=f.root.querySelector('[data-task-detail="active"]');const filter=detail.querySelector('input[type=search]');filter.value='课程v';filter.focus();
  f.emit({status:'paused',phase:'paused'});assert.deepEqual(order(),['active','waiting','done']);assert.match(f.root.querySelector('[data-task-summary="active"]').textContent,/已暂停/u);assert.equal(f.root.activeElement,filter);
  active.done=['v'];f.emit({tasks:[done,waiting,active],status:'complete',currentCourseId:null});assert.deepEqual(order(),['waiting','done','active']);assert.equal(detail,f.root.querySelector('[data-task-detail="active"]'));assert.equal(detail.hidden,false);assert.equal(f.root.activeElement,filter);
  active.recheck=['v'];f.emit({tasks:[done,waiting,active],status:'paused'});assert.deepEqual(order(),['waiting','active','done']);assert.notEqual(f.root.querySelector('[data-task-id="active"]').dataset.state,'completed');f.close();
});

test('分组展示下排序按保存索引移动，跳过完成卡片并保留当前课程', async () => {
  const done=task('done',[course('d')]);done.done=['d'];const f=fixture({tasks:[task('a'),done,task('b'),task('c')],activeTaskId:'b',currentCourseId:'a',status:'running'});
  await f.click('move-up-b');assert.deepEqual(f.calls.at(-1),['moveTask','b',0]);assert.deepEqual(f.state.tasks.map(t=>t.id),['b','a','done','c']);assert.deepEqual([...f.root.querySelectorAll('article')].map(n=>n.dataset.taskId),['b','a','c','done']);
  assert.equal(f.root.querySelector('[data-drag-task="done"]').disabled,true);assert.equal(f.root.querySelector('[data-action="move-up-done"]').disabled,true);assert.equal(f.calls.some(c=>c[0]==='pause'),false);assert.equal(f.state.currentCourseId,'a');f.close();
});

test('已完成当前课等待切换时专区仍置顶，课程行保留完成状态', async () => {
  const a=task('a',[course('v'),course('next')]);a.done=['v'];const f=fixture({tasks:[task('b'),a],status:'running',activeTaskId:'a',currentCourseId:'v'});f.panel.open();await f.click('detail-a');
  assert.deepEqual([...f.root.querySelectorAll('article')].map(n=>n.dataset.taskId),['a','b']);assert.equal(f.root.querySelector('[data-task-id="a"]').dataset.state,'active');assert.match(f.root.querySelector('[data-task-summary="a"]').textContent,/正在切换课程/u);assert.equal(f.root.querySelector('[data-course="v"]').closest('label').dataset.state,'completed');
  f.emit({status:'paused',phase:'paused'});assert.notEqual(f.root.querySelector('[data-task-id="a"]').dataset.state,'active');f.close();
});

test('当前课程覆盖旧卡片状态，展示课节时间但播放结束不计平台完成', async () => {
  const t=task('t',[course('v')]);const playback={taskId:'t',courseId:'v',sectionId:'s',paused:false,ended:false,currentTime:828,duration:3101};
  const f=fixture({tasks:[t],activeTaskId:'t',currentCourseId:'v',currentSectionTitle:'视频课节',currentPlayback:playback,status:'running'});f.panel.open();await f.click('detail-t');
  const row=f.root.querySelector('[data-course="v"]').closest('label');assert.equal(row.dataset.state,'active');assert.match(row.textContent,/正在播放/u);assert.doesNotMatch(row.textContent,/未开始/u);assert.match(row.textContent,/13:48 \/ 51:41/u);assert.match(row.textContent,/课节 · 视频课节/u);assert.equal(row.querySelector('progress').value,828);assert.equal(row.querySelector('progress').max,3101);
  assert.match(f.root.querySelector('header [data-playback-time]').textContent,/13:48 \/ 51:41/u);
  f.emit({currentPlayback:{...playback,currentTime:3101,ended:true,paused:true}});assert.match(row.textContent,/等待平台确认完成/u);assert.match(f.root.querySelector('[data-task-summary="t"]').textContent,/完成 0/u);assert.equal(f.root.querySelector('[data-task-progress="t"]').value,0);
  f.emit({status:'running',phase:'retrying',currentPlayback:null});assert.match(row.textContent,/正在重试/u);assert.equal(row.querySelector('progress').hidden,true);
  f.emit({phase:'running',currentPlayback:{...playback,taskId:'other'}});assert.doesNotMatch(row.textContent,/13:48/u);assert.equal(row.querySelector('progress').hidden,true);
  f.emit({status:'paused',phase:'paused',currentPlayback:null});assert.match(row.textContent,/已暂停/u);f.close();
});

test('空选择、跳过、待处理和复查不归入全部完成专区', () => {
  const entries=['empty','skip','defer','recheck'].map(id=>task(id,[course(id)]));
  entries[0].courses[0].selected=false;entries[1].skipped=['skip'];entries[2].deferred=[{courseId:'defer',reason:'需处理'}];entries[3].done=['recheck'];entries[3].recheck=['recheck'];
  const f=fixture({tasks:entries,activeTaskId:'defer',currentCourseId:'defer'});for(const t of entries)assert.notEqual(f.root.querySelector(`[data-task-id="${t.id}"]`).dataset.state,'completed');assert.equal(f.root.querySelector('[data-task-id="defer"]').dataset.state,'attention');f.close();
});

test('取消勾选仍待复查课程时保留未完成提示，不能冒充当前课程或全部完成', () => {
  const t=task('t',[course('a','completed'),course('b','completed',false)]);t.done=['a','b'];t.recheck=['b'];
  const f=fixture({tasks:[t],activeTaskId:'t',currentCourseId:'b',status:'paused'});assert.notEqual(f.root.querySelector('[data-task-id="t"]').dataset.state,'completed');assert.notEqual(f.root.querySelector('[data-task-id="t"]').dataset.state,'active');assert.match(f.root.querySelector('[data-task-summary="t"]').textContent,/待复查/u);f.close();
});

test('课程名称筛选保留隐藏勾选、完成匹配自动展开、焦点和筛选跨tick不变', async () => {
  const t=task('t',[course('a'),course('b','completed',true),course('c')]); const f=fixture({tasks:[t]});f.panel.open();await f.click('detail-t');
  const filter=f.root.querySelector('[name="course-filter-t"]');assert.ok(filter); filter.focus();filter.value='课程b';filter.dispatchEvent(new f.dom.window.Event('input'));f.emit({message:'更新'});
  const detail=f.root.querySelector('[data-task-detail="t"]'); assert.equal(f.root.activeElement,filter);assert.equal(filter.value,'课程b');assert.equal(detail.querySelector('[data-course="a"]').closest('label').hidden,true);assert.equal(detail.querySelector('[data-course="a"]').checked,true);
  assert.equal(detail.querySelector('[data-course="b"]').closest('label').hidden,false);assert.equal(detail.querySelector('[data-completed]').open,true);assert.match(detail.textContent,/已选 3 门/u);assert.match(detail.textContent,/筛选不会取消/u);
  filter.value='不存在';filter.dispatchEvent(new f.dom.window.Event('input'));assert.equal(detail.querySelector('[data-no-matches]').hidden,false);f.close();
});

test('范围入口调用设置，复查项不计完成且收起可以开始', async () => {
  const t=task(); t.done=['a']; t.recheck=['a'];t.selectionMode='specific';const f=fixture({tasks:[t],activeTaskId:'t'});f.panel.open();await f.click('detail-t');
  const mode=f.root.querySelector('[name="course-mode-t"]');assert.ok(mode);assert.equal(mode.value,'specific');mode.value='all-pending';mode.dispatchEvent(new f.dom.window.Event('change'));for(let i=0;i<30;i++)await Promise.resolve();assert.deepEqual(f.calls.at(-1),['setTaskMode','t','all-pending']);
  await f.click('recheck-t');assert.deepEqual(f.calls.at(-1),['recheckCompleted','t']);assert.match(f.root.querySelector('[data-task-summary="t"]').textContent,/完成 0/u);assert.match(f.root.querySelector('[data-task-detail="t"]').textContent,/待复查/u);assert.equal(f.root.querySelector('[data-action="run-toggle"]').disabled,false);
  f.emit({status:'running'});assert.equal(mode.disabled,true);assert.equal(f.root.querySelector('[data-action="recheck-t"]').disabled,true);assert.equal(f.root.querySelector('[name="course-filter-t"]').disabled,false);f.close();
});

test('运行中可上移下移，DOM顺序同步且详情保持，首尾禁用', async () => {
  const f=fixture({tasks:[task('a'),task('b'),task('c')],status:'running',activeTaskId:'a'}); f.panel.open();
  const order=()=>[...f.root.querySelectorAll('article')].map(n=>n.dataset.taskId);
  assert.deepEqual(order(),['a','b','c']); await f.click('detail-b'); const detail=f.root.querySelector('[data-task-detail="b"]');
  assert.equal(f.root.querySelector('[data-action="move-up-a"]').disabled,true); assert.equal(f.root.querySelector('[data-action="move-down-c"]').disabled,true);
  await f.click('move-up-b'); assert.deepEqual(f.calls.at(-1),['moveTask','b',0]); assert.deepEqual(order(),['a','b','c']); assert.equal(detail.hidden,false); assert.equal(detail,f.root.querySelector('[data-task-detail="b"]'));
  await f.click('move-down-b'); assert.deepEqual(order(),['a','b','c']); assert.equal(f.calls.some(c=>c[0]==='pause'),false);
  for(const state of [{status:'waiting'}, {status:'running',phase:'retrying'}, {status:'running',phase:'offline'}]){f.emit(state); assert.equal(f.root.querySelector('[data-action="move-up-b"]').disabled,false);}
  for(const state of [{status:'preparing'}, {status:'paused',phase:'resuming'}, {status:'paused',phase:null,unavailable:true}]){f.emit(state); assert.equal(f.root.querySelector('[data-action="move-up-b"]').disabled,true);}
  f.close();
});

test('只接受面板手柄拖动，支持落在卡片上下方，拖动结束清理提示', async () => {
  const f=fixture({tasks:[task('a'),task('b'),task('c')],status:'running'}); f.panel.open();
  const card=id=>f.root.querySelector(`[data-task-id="${id}"]`); const handle=id=>f.root.querySelector(`[data-drag-task="${id}"]`);
  const drag=(node,type,y=1)=>{const e=new f.dom.window.MouseEvent(type,{bubbles:true,cancelable:true,clientY:y}); Object.defineProperty(e,'dataTransfer',{value:{setData(){}}}); node.dispatchEvent(e); return e;};
  assert.ok(handle('c')); card('a').getBoundingClientRect=()=>({top:0,height:20});
  drag(card('a'),'drop'); assert.equal(f.calls.length,0);
  drag(handle('c'),'dragstart'); const over=drag(card('a'),'dragover'); assert.equal(over.defaultPrevented,true); assert.equal(card('a').dataset.drop,'before'); drag(card('a'),'drop'); for(let i=0;i<30;i++)await Promise.resolve();
  assert.deepEqual(f.calls.at(-1),['moveTask','c',0]); assert.deepEqual([...f.root.querySelectorAll('article')].map(n=>n.dataset.taskId),['c','a','b']); assert.equal(f.root.querySelector('[data-drop]'),null);
  card('b').getBoundingClientRect=()=>({top:0,height:20}); drag(handle('c'),'dragstart'); drag(card('b'),'drop',19); for(let i=0;i<30;i++)await Promise.resolve(); assert.deepEqual(f.calls.at(-1),['moveTask','c',2]);
  drag(handle('b'),'dragstart'); drag(card('a'),'dragover'); drag(handle('b'),'dragend'); assert.equal(f.root.querySelector('[data-drop]'),null);
  const count=f.calls.length; drag(card('a'),'drop'); assert.equal(f.calls.length,count); f.close();
});

test('首页仅队列，添加搜索候选和草稿分阶段展示，加入后回队列', async () => {
  const f = fixture(); f.panel.open();
  assert.equal(f.root.querySelector('textarea'), null);
  assert.ok(f.root.querySelector('[data-view="queue"]'));
  assert.equal(f.root.querySelector('[name="target"]').closest('[data-view]').hidden, true);
  await f.click('add'); const target = f.root.querySelector('[name="target"]'); target.value = '输入专区'; await f.click('search'); assert.deepEqual(f.calls.at(-1), ['search', '输入专区']);
  f.emit({ candidates: [{ id: 's', title: '<img src=x>', route: '#/study/subject/detail/s' }] });
  assert.equal(f.root.querySelector('[data-candidates]').hidden, false); assert.equal(f.root.querySelector('img'), null);
  await f.click('candidate-s'); assert.deepEqual(f.calls.at(-1), ['chooseCandidate', 's']);
  f.emit({ draft: { target: '输入专区', subject: task().subject, courses: [course('a'), course('b', 'completed', false, false), course('c', 'unknown', false)] } });
  assert.equal(f.root.querySelector('[data-candidates]').hidden, true);
  assert.equal(f.root.querySelector('[data-action="start"]').disabled, true);
  const input = f.root.querySelector('[data-draft] [data-course="c"]'); input.checked = true; input.dispatchEvent(new f.dom.window.Event('change')); await Promise.resolve(); assert.deepEqual(f.calls.at(-1), ['draftSetSelection', 'c', true]);
  await f.click('add-draft'); assert.equal(f.root.querySelector('[data-view="queue"]').hidden, false); assert.equal(f.root.querySelector('[data-view="add"]').hidden, true); assert.match(f.root.textContent, /正式专区标题/u); f.close();
});

test('标题收起时显示进度，运行可暂停，暂停后可继续', async () => {
  const t = task(); t.done = ['a']; t.courses.push(course('next')); const f = fixture({ tasks: [t, { ...task('t2'), subject: { ...task().subject, id: 's2' } }], activeTaskId: 't', status: 'running', currentCourseId: 'a', currentSectionTitle: '视频课节', message: '执行中' });
  const body = f.root.querySelector('.body'); assert.equal(body.hidden, true);
  const header = f.root.querySelector('header'); assert.match(header.textContent, /学习中/u); assert.match(header.textContent, /总完成 1\/3 门/u);
  const run = header.querySelector('[data-action="run-toggle"]'); assert.ok(run); assert.equal(run.disabled, false); assert.equal(run.textContent, '暂停'); await f.click('run-toggle');
  await f.click('toggle'); assert.match(f.root.querySelector('.task-current').textContent, /课节 · 视频课节/u); assert.match(f.root.querySelector('.task-current').textContent, /课程a/u);
  await f.click('toggle'); f.emit({ status: 'paused' }); assert.equal(body.hidden, true); assert.equal(run.textContent, '继续'); await f.click('run-toggle'); assert.equal(f.calls.filter(call => call[0] === 'pause').length, 1); assert.deepEqual(f.calls.at(-1), ['start']); f.close();
});

test('任务详情支持勾选、更新和移出，运行时只禁编辑，完成课程可折叠且实际done优先', async () => {
  const t = task('t', [course('a'), course('b', 'completed', true, false), course('c', 'learning'), course('d', 'unknown', false)]); t.done = ['a']; t.skipped = ['c'];
  const f = fixture({ tasks: [t], activeTaskId: 't' }); f.panel.open();
  await f.click('detail-t'); const detail = f.root.querySelector('[data-task-detail="t"]'); assert.equal(detail.hidden, false);
  const completed = detail.querySelector('details[data-completed]'); assert.equal(completed.open, false); assert.match(completed.textContent, /课程a.*已完成/su); assert.match(detail.textContent, /已跳过/u); assert.match(detail.textContent, /待确认/u); assert.match(detail.textContent, /选修/u);
  const check = detail.querySelector('[data-course="d"]'); check.checked = true; check.dispatchEvent(new f.dom.window.Event('change')); for (let i = 0; i < 20; i++) await Promise.resolve(); assert.deepEqual(f.calls.at(-1), ['setSelection', 't', 'd', true]);
  await f.click('refresh-t'); await f.click('retry-t-c'); assert.deepEqual(f.calls.at(-1), ['retry', 't', 'c']); completed.open = true;
  f.emit({ status: 'running' }); assert.equal(detail.querySelector('[data-course="d"]').disabled, true); assert.equal(f.root.querySelector('[data-action="refresh-t"]').disabled, true); assert.equal(f.root.querySelector('[data-action="detail-t"]').disabled, false); assert.equal(completed.open, true);
  await f.click('detail-t'); await f.click('detail-t'); assert.equal(detail.hidden, false); f.emit({ status: 'paused' }); await f.click('remove-t'); assert.deepEqual(f.calls.at(-1), ['removeTask', 't']); f.close();
});

test('时间设置保存和开始前保存，tick保留输入焦点、脏值、折叠状态且诊断可重复', async () => {
  const f = fixture({ tasks: [task()] }); f.panel.open(); const start = f.root.querySelector('[name="start"]'); start.focus(); start.value = '10:00'; start.dispatchEvent(new f.dom.window.Event('input'));
  f.emit({ message: '刷新状态' }); assert.equal(f.root.activeElement, start); assert.equal(start.value, '10:00'); assert.ok(start.labels.length);
  await f.click('save-window'); assert.deepEqual(f.calls.find(call => call[0] === 'setWindow'), ['setWindow', { start: '10:00', end: '24:00' }]);
  start.value = '11:00'; start.dispatchEvent(new f.dom.window.Event('input')); await f.click('start'); assert.deepEqual(f.calls.slice(-2), [['setWindow', { start: '11:00', end: '24:00' }], ['start']]);
  await f.click('diagnose'); await f.click('diagnose'); assert.equal(f.calls.filter(call => call[0] === 'diagnose').length, 2); assert.ok(f.root.querySelector('[aria-live="polite"]')); assert.ok([...f.root.querySelectorAll('button')].every(button => button.type === 'button')); f.close();
});

test('问题对应专区和课程并允许重试、跳过；跳过和空选择不能标成全完成', async () => {
  const t = task(); t.skipped = ['a']; const f = fixture({ tasks: [t], problem: { taskId: 't', courseId: 'a', reason: '<script>需人工确认</script>' } }); f.panel.open();
  const problem = f.root.querySelector('[data-problem]'); assert.match(problem.textContent, /正式专区标题.*课程a.*需人工确认/su); assert.equal(problem.querySelector('script'), null); await f.click('retry'); await f.click('skip'); assert.deepEqual(f.calls.slice(-2), [['retry', 't', 'a'], ['skipCurrent']]);
  assert.doesNotMatch(f.root.querySelector('[data-task-summary="t"]').textContent, /全部完成/u);
  t.skipped = []; t.courses.forEach(c => { c.selected = false; }); f.emit({ tasks: [t], problem: null }); assert.match(f.root.querySelector('[data-task-summary="t"]').textContent, /尚未选择/u); f.close();
});

test('旧required任务统计过滤选修并说明兼容范围，无专题旧任务提示重新读取', async () => {
  const t = task('t', [course('a'), course('b', 'not-started', true, false)]); t.scope = 'required'; t.done = ['a', 'b'];
  const f = fixture({ tasks: [t, { ...task('old', []), subject: null }], activeTaskId: 't' }); f.panel.open(); await f.click('detail-t');
  assert.match(f.root.querySelector('[data-task-summary="t"]').textContent, /已完成 1 门/u); assert.equal(f.root.querySelector('[data-task-progress="t"]').max,1); const detail = f.root.querySelector('[data-task-detail="t"]'); assert.match(detail.textContent, /旧任务仅执行必修课程和课节/u); assert.equal(detail.querySelector('[data-course="b"]').disabled, true); assert.match(f.root.querySelector('[data-task-summary="old"]').textContent, /尚未读取专区/u); f.close();
});

test('添加未确认时问题重试和跳过不能启动已有队列；取消添加后恢复', async () => {
  const f = fixture({ tasks: [task()], problem: { taskId: 't', courseId: 'a', reason: '需确认' } }); f.panel.open(); await f.click('add');
  assert.equal(f.root.querySelector('[data-action="retry"]').disabled, true); assert.equal(f.root.querySelector('[data-action="skip"]').disabled, true);
  await f.click('retry'); await f.click('skip'); assert.equal(f.calls.some(call => ['retry', 'skipCurrent'].includes(call[0])), false);
  await f.click('back'); assert.equal(f.root.querySelector('[data-action="retry"]').disabled, false); assert.equal(f.root.querySelector('[data-action="skip"]').disabled, false); f.close();
});

test('取消勾选跳过课后仍提示待重试，不能把任务标成全部完成', () => {
  const t = task('t', [course('a'), course('b', 'not-started', false)]); t.done = ['a']; t.skipped = ['b'];
  const f = fixture({ tasks: [t] }); assert.match(f.root.querySelector('[data-task-summary="t"]').textContent, /跳过课程待重试/u); f.close();
});

test('controller确认加入草稿的状态更新也会返回队列', () => {
  const f = fixture(); f.emit({ draft: { target: '名称', subject: task().subject, courses: task().courses } });
  assert.equal(f.root.querySelector('[data-view="queue"]').hidden, true);
  f.emit({ tasks: [task()], draft: null }); assert.equal(f.root.querySelector('[data-view="queue"]').hidden, false); f.close();
});

test('自动设置保存、批量选择、待处理原因和收起总进度都直接可见', async () => {
  const t=task(); t.deferred=[{courseId:'a',reason:'需要答题'}];
  const f=fixture({tasks:[t],activeTaskId:'t',automation:{enabled:false,resumeOnReload:false},currentCourseId:'a'});
  f.panel.open(); const automatic=f.root.querySelector('[name="automatic"]'); assert.ok(automatic); automatic.checked=true; automatic.dispatchEvent(new f.dom.window.Event('change')); for(let i=0;i<30;i++) await Promise.resolve();
  assert.deepEqual(f.calls.at(-1),['setAutomation',{enabled:true,resumeOnReload:false,mute:true}]);
  const resume=f.root.querySelector('[name="resumeOnReload"]'); assert.equal(resume.disabled,false);
  await f.click('detail-t'); const detail=f.root.querySelector('[data-task-detail="t"]'); assert.match(detail.textContent,/待处理.*需要答题/u); assert.equal(detail.querySelector('[data-action="retry-t-a"]').hidden,false);
  await f.click('select-required-t'); assert.deepEqual(f.calls.at(-1),['selectCourses','t','required']);
  f.emit({status:'running',phase:'retrying',message:'正在等待重试 1/3。'}); await f.click('toggle');
  assert.match(f.root.querySelector('header').textContent,/正在重试.*总完成 0\/1/su); assert.match(f.root.querySelector('header').textContent,/课程a.*重试 1\/3/su);
  assert.equal(automatic.disabled,true); f.emit({status:'waiting',phase:'waiting'}); assert.equal(f.root.querySelector('[data-action="start"]').disabled,true); assert.equal(f.root.querySelector('[data-action="run-toggle"]').disabled,false); f.close();
});

test('收起主按钮开始前保存时段，准备、等待、恢复时均可暂停', async () => {
  const f = fixture({ tasks: [task()] }); const run = f.root.querySelector('[data-action="run-toggle"]');
  assert.ok(run); assert.equal(run.textContent, '开始'); assert.equal(f.root.querySelector('.body').hidden, true);
  const input = f.root.querySelector('[name="start"]'); input.value = '10:30'; input.dispatchEvent(new f.dom.window.Event('input'));
  await f.click('run-toggle'); assert.deepEqual(f.calls.slice(-2), [['setWindow', { start: '10:30', end: '24:00' }], ['start']]);
  for (const state of [{status:'preparing'}, {status:'waiting'}, {status:'paused',phase:'resuming'}, {status:'running',phase:'offline'}, {status:'running',phase:'retrying'}]) {
    f.emit({phase:null,...state}); assert.equal(run.textContent,'暂停'); assert.equal(run.disabled,false); await f.click('run-toggle'); assert.deepEqual(f.calls.at(-1),['pause']);
  }
  f.close();
});

test('空队列、未确认添加、无待学或不可用时不能从标题启动', async () => {
  const f = fixture(); const run = f.root.querySelector('[data-action="run-toggle"]'); assert.ok(run); assert.equal(run.disabled,true);
  f.emit({tasks:[task()]}); assert.equal(run.disabled,false); await f.click('add'); assert.equal(run.disabled,true); await f.click('run-toggle'); assert.equal(f.calls.some(c=>c[0]==='start'),false);
  await f.click('back'); f.emit({unavailable:true}); assert.equal(run.disabled,true);
  f.emit({unavailable:false,tasks:[{...task(),done:['a']}],status:'complete'}); assert.equal(run.textContent,'已完成'); assert.equal(run.disabled,true);
  f.emit({tasks:[{...task(),skipped:['a']}],status:'paused'}); assert.equal(run.disabled,true);
  f.emit({tasks:[{...task(),deferred:[{courseId:'a',reason:'人工处理'}]}]}); assert.equal(run.disabled,true); f.close();
});

test('标题和展开开始按钮共用启动锁，连续点击只启动一次', async () => {
  const f = fixture({tasks:[task()]}); let release; f.panel.destroy();
  const controller = {getState:()=>structuredClone(f.state),subscribe:()=>()=>{},start:()=>new Promise(resolve=>{ f.calls.push(['start']); release=resolve; })};
  const panel = createPanel(f.dom.window,controller,'test'); const root=f.dom.window.document.getElementById('wangda-assistant').shadowRoot;
  const run=root.querySelector('[data-action="run-toggle"]'); assert.ok(run); run.click(); for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(run.disabled,true); assert.equal(root.querySelector('[data-action="start"]').disabled,true); root.querySelector('[data-action="start"]').click(); run.click();
  assert.equal(f.calls.filter(c=>c[0]==='start').length,1); release(true); for(let i=0;i<30;i++)await Promise.resolve(); assert.equal(run.disabled,false); panel.destroy(); f.close();
});
