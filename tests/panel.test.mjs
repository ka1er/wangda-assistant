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
  for (const name of ['search', 'chooseCandidate', 'collectDraft', 'setSelection', 'refreshTask', 'removeTask', 'setWindow', 'start', 'pause', 'retry', 'skipCurrent', 'draftSetSelection', 'discardDraft', 'selectCourses', 'setAutomation']) controller[name] = async (...args) => { calls.push([name, ...args]); if (name === 'setWindow') emit({ window: args[0] }); if (name === 'setAutomation') emit({automation:args[0]}); return true; };
  controller.addDraft = async () => { calls.push(['addDraft']); emit({ tasks: [...state.tasks, task()], draft: null, candidates: [] }); return true; };
  controller.diagnose = () => { calls.push(['diagnose']); return { kind: 'home', courses: 0 }; };
  const panel = createPanel(dom.window, controller, 'test-version'); const root = dom.window.document.getElementById('wangda-assistant').shadowRoot;
  const click = async action => { const node = root.querySelector(`[data-action="${action}"]`); assert.ok(node, `缺少${action}按钮`); node.click(); for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const close = () => { panel.destroy(); dom.window.close(); };
  return { dom, state, calls, emit, root, click, close, panel };
}

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
  const t = task(); t.done = ['a']; const f = fixture({ tasks: [t, { ...task('t2'), subject: { ...task().subject, id: 's2' } }], activeTaskId: 't', status: 'running', currentCourseId: 'a', currentSectionTitle: '视频课节', message: '执行中' });
  const body = f.root.querySelector('.body'); assert.equal(body.hidden, true);
  const header = f.root.querySelector('header'); assert.match(header.textContent, /学习中/u); assert.match(header.textContent, /专区 1\/2/u); assert.match(header.textContent, /本任务完成 1\/1 门/u);
  const run = header.querySelector('[data-action="run-toggle"]'); assert.ok(run); assert.equal(run.disabled, false); assert.equal(run.textContent, '暂停'); await f.click('run-toggle');
  await f.click('toggle'); assert.match(body.textContent, /当前课节：视频课节/u); assert.match(body.textContent, /当前课程：课程a/u);
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
  assert.match(f.root.querySelector('[data-task-summary="t"]').textContent, /所选 1.*完成 1/su); const detail = f.root.querySelector('[data-task-detail="t"]'); assert.match(detail.textContent, /旧任务仅执行必修课程和课节/u); assert.equal(detail.querySelector('[data-course="b"]').disabled, true); assert.match(f.root.querySelector('[data-task-summary="old"]').textContent, /尚未读取专区/u); f.close();
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
  assert.deepEqual(f.calls.at(-1),['setAutomation',{enabled:true,resumeOnReload:false}]);
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
