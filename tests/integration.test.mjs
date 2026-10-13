import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAdapter } from '../src/adapter.js';
import { createController } from '../src/controller.js';
import { createPanel } from '../src/panel.js';

function setup() {
  const dom = new JSDOM('<body></body>', { url: 'https://wangda.chinamobile.com/#/study/subject/detail/s' });
  const w = dom.window; let clock = Date.parse('2026-10-10T02:00:00Z'); const data = new Map();
  const a = createAdapter(w); const c = createController({ adapter: a, owner: 'test', now: () => new Date(clock), setInterval: () => 1, clearInterval: () => {}, storage: { get: key => structuredClone(data.get(key)), set: (key, val) => data.set(key, structuredClone(val)) }, locks: { request: async (_, __, cb) => cb({}) } });
  const page = html => { w.document.body.querySelectorAll(':scope > :not(#wangda-assistant)').forEach(node => node.remove()); const node = w.document.createElement('div'); node.innerHTML = html; w.document.body.append(node); return node; };
  function subject(id = 's', courses = [['c', '已完成', true], ['d', '已完成', false]]) {
    w.location.hash = `#/study/subject/detail/${id}`;
    page(`<div class="subject-banner"><div class="title-row"><h3 class="h3">正式专区${id}</h3></div></div>` + courses.map(([cid, status, required]) => `<div class="content new"><div class="img course-item"><button id="studyBtns-${cid}" data-resource-id="${cid}" data-section-type="10"></button></div><span class="title">课程${cid}</span><span class="study-status">${status}</span><span class="cont-class-type">${required ? '必修' : '选修'}</span></div>`).join(''));
  }
  function search(id) {
    page(`<button id="searchType-4">专题</button><input id="searchContent" name="keyword"><i id="searchBtn">搜索</i><ul id="all-list"><a href="#/study/subject/detail/${id}" title="正式专区${id}">结果</a><a href="#/study/subject/detail/other" title="其他专区">其他</a></ul>`);
  }
  function course(id, video = false) {
    const node = page(`<div class="chapter-list chapter-all"><ul><li>${(video ? [['v', 5], ['doc', 1]] : [['doc', 1]]).map(([sid, type], i) => `<dl id="show-sections${sid}" data-course-id="${id}" data-section-type="${type}" class="${i ? '' : 'focus'}"><dt><span class="qcontent">${sid}</span></dt><dd><div class="item continue pointer"><span>学习中</span></div></dd></dl>`).join('')}</li></ul></div>`);
    node.querySelectorAll('dl').forEach(el => el.addEventListener('click', () => { node.querySelectorAll('dl').forEach(x => x.classList.remove('focus')); el.classList.add('focus'); node.querySelector('video')?.remove(); }));
    if (video) { const media = w.document.createElement('video'); Object.defineProperty(media, 'paused', { value: false }); media.pause = () => {}; node.append(media); }
  }
  const complete = sid => { w.document.getElementById(`show-sections${sid}`).querySelector('dd span').textContent = '已完成'; };
  const elapse = async ms => { for (let i = 0; i < ms; i += 1000) { clock += 1000; await c.tick(); } };
  const collect = async () => { await c.collectDraft(); c.getState().draft.courses.forEach(item => c.draftSetSelection(item.id, true)); await c.addDraft(); };
  const panel = createPanel(w, c, 'test'); const root = w.document.getElementById('wangda-assistant').shadowRoot;
  const click = async name => { const button = root.querySelector(`[data-action="${name}"]`); assert.ok(button, name); button.click(); for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const change = async (selector, checked) => { const input = root.querySelector(selector); input.checked = checked; input.dispatchEvent(new w.Event('change')); for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const add = async (id, cards) => {
    await click('add'); const target = root.querySelector('[name="target"]'); target.value = `搜索专区${id}`; target.dispatchEvent(new w.Event('input')); await click('search'); assert.equal(w.location.hash, '#/search');
    search(id); await c.tick(); await c.tick(); assert.equal(c.getState().status, 'paused'); assert.equal(root.querySelector('[data-candidates]').hidden, false);
    await click(`candidate-${id}`); assert.equal(w.location.hash, `#/study/subject/detail/${id}`); subject(id, cards); await c.tick();
    assert.equal(root.querySelector('[data-candidates]').hidden, true); assert.equal(root.querySelector('[data-draft]').hidden, false);
  };
  const close = () => { panel.destroy(); c.destroy(); w.close(); };
  subject(); return { w, c, a, subject, search, course, complete, elapse, collect, panel, root, click, change, add, close };
}

test('原生视频时间传到当前课程，结束后等待图文，平台全部完成才将专区变灰', async () => {
  const f=setup();f.subject('s',[['a','未开始',true]]);await f.collect();const id=f.c.getState().tasks[0].id;f.panel.open();await f.click(`detail-${id}`);await f.click('start');await f.c.tick();f.course('a',true);
  const media=f.w.document.querySelector('video');Object.defineProperty(media,'currentTime',{value:828});Object.defineProperty(media,'duration',{value:3101});await f.c.tick();
  const card=f.root.querySelector(`[data-task-id="${id}"]`);const row=card.querySelector('[data-course="a"]').closest('label');assert.equal(card.dataset.state,'active');assert.match(row.textContent,/正在播放.*13:48 \/ 51:41/su);assert.match(f.root.querySelector('header').textContent,/13:48 \/ 51:41/u);assert.equal(f.c.getState().tasks[0].done.length,0);
  f.complete('v');await f.c.tick();await f.elapse(6000);await f.c.tick();assert.equal(f.c.getState().currentPlayback,null);assert.equal(row.querySelector('progress').hidden,true);assert.notEqual(card.dataset.state,'completed');
  f.complete('doc');await f.c.tick();assert.equal(card.dataset.state,'completed');assert.equal(card.querySelector('progress').value,1);assert.equal(f.c.getState().status,'complete');f.close();
});

test('指定课程通过筛选手选已完成卡片，刷新不加新课，复查历史后等待新增课节完成', async () => {
  const f=setup(); f.panel.open(); await f.add('s',[['a','未开始',true],['b','已完成',false]]);
  const mode=f.root.querySelector('[name="course-mode-draft"]');assert.ok(mode);mode.value='specific';mode.dispatchEvent(new f.w.Event('change'));for(let i=0;i<40;i++)await Promise.resolve();
  assert.deepEqual(f.c.getState().draft.courses.map(c=>c.selected),[false,false]);const filter=f.root.querySelector('[name="course-filter-draft"]');filter.value='课程b';filter.dispatchEvent(new f.w.Event('input'));
  assert.equal(f.root.querySelector('[data-draft] [data-completed]').open,true);await f.change('[data-draft] [data-course="b"]',true);await f.click('add-draft'); const id=f.c.getState().tasks[0].id;
  await f.click('start');await f.c.tick();assert.match(f.w.location.hash,/subject-course\/b\/6\/s$/u);f.course('b');f.complete('doc');await f.c.tick();assert.equal(f.c.getState().status,'complete');
  await f.click(`detail-${id}`);await f.click(`refresh-${id}`);f.subject('s',[['a','未开始',true],['b','已完成',false],['new','未开始',true]]);await f.c.tick();assert.deepEqual(f.c.getState().tasks[0].courses.map(c=>c.selected),[false,true,false]);
  await f.click(`recheck-${id}`);assert.deepEqual(f.c.getState().tasks[0].done,['b']);assert.equal(f.root.querySelector('[data-action="run-toggle"]').disabled,false);await f.click('run-toggle');await f.c.tick();f.course('b');await f.c.tick();assert.equal(f.c.getState().status,'running');assert.deepEqual(f.c.getState().tasks[0].recheck,['b']);
  f.complete('doc');await f.c.tick();assert.equal(f.c.getState().status,'complete');assert.deepEqual(f.c.getState().tasks[0].done,['b']);assert.deepEqual(f.c.getState().tasks[0].recheck,[]);f.close();
});

test('准备专题遇归档重学页时明确暂停，保留既有队列且不点击恢复按钮', async () => {
  const f=setup();await f.collect();const before=f.c.getState().tasks;f.panel.open();await f.click('add');f.root.querySelector('[name="target"]').value='归档专区';await f.click('search');f.search('archived');await f.c.tick();await f.c.tick();await f.click('candidate-archived');
  f.w.location.hash='#/study/subject-middle/archived/1';const container=f.w.document.createElement('div');container.innerHTML='<h2>该专题已完成</h2><button id="again">重新学习</button>';f.w.document.body.append(container);let clicks=0;container.querySelector('button').onclick=()=>clicks++;await f.c.tick();
  assert.equal(f.c.getState().status,'paused');assert.match(f.c.getState().message,/重新学习.*归档/u);assert.deepEqual(f.c.getState().tasks,before);assert.equal(clicks,0);f.close();
});

test('播放期间拖动专区，当前课节保持，下一门进入新优先专区再返回原专区', async () => {
  const f=setup(); f.panel.open(); await f.add('s',[['a','学习中',true],['b','未开始',true]]); await f.click('add-draft'); await f.add('s2',[['z','学习中',false]]); await f.click('add-draft');
  const [a,b]=f.c.getState().tasks; await f.click('start'); await f.c.tick(); f.course('a',true); let pauses=0; f.w.document.querySelector('video').pause=()=>{pauses++;}; await f.c.tick();
  const route=f.w.location.hash; const target=f.root.querySelector(`[data-task-id="${a.id}"]`); const handle=f.root.querySelector(`[data-drag-task="${b.id}"]`); assert.ok(target); assert.ok(handle); target.getBoundingClientRect=()=>({top:0,height:20});
  handle.dispatchEvent(new f.w.Event('dragstart',{bubbles:true,cancelable:true})); target.dispatchEvent(new f.w.MouseEvent('drop',{bubbles:true,cancelable:true,clientY:1})); for(let i=0;i<40;i++)await Promise.resolve();
  assert.equal(f.w.location.hash,route); assert.equal(pauses,0); assert.equal(f.c.getState().status,'running'); assert.equal(f.a.read().activeSectionId,'v'); assert.deepEqual(f.c.getState().tasks.map(t=>t.id),[b.id,a.id]);
  f.complete('v'); await f.c.tick(); await f.elapse(6000); assert.equal(f.a.read().activeSectionId,'doc'); f.complete('doc'); await f.c.tick(); await f.elapse(6000); assert.match(f.w.location.hash,/subject-course\/z\/6\/s2$/u);
  f.course('z'); f.complete('doc'); await f.c.tick(); await f.elapse(6000); assert.match(f.w.location.hash,/subject-course\/b\/6\/s$/u); assert.deepEqual(f.c.getState().tasks.find(t=>t.id===a.id).done,['a']); f.close();
});

test('搜索点选无标准横幅的自定义专区后显示25门草稿，保留已有任务且核对标签标题', async () => {
  const f = setup(); await f.collect(); const existing = f.c.getState().tasks[0]; f.panel.open();
  await f.click('add'); f.root.querySelector('[name="target"]').value = '示例专区'; await f.click('search');
  f.search('custom'); await f.c.tick(); await f.c.tick(); await f.click('candidate-custom');
  f.w.document.body.innerHTML = '<div class="subject-detail-page subject-detail-page-template2">' + Array.from({ length: 25 }, (_, i) => `<div class="content new"><div class="img course-item"><button id="studyBtns-item${i}" data-resource-id="item${i}" data-section-type="10"></button></div><span class="title">示例课程${i}</span><span class="study-status">${i < 2 ? '已完成' : '未开始'}</span><span class="cont-class-type">选修</span></div>`).join('') + '</div>';
  f.w.document.title = '上一专区标题'; await f.c.tick();
  assert.equal(f.c.getState().status, 'preparing'); assert.equal(f.c.getState().draft, null);
  f.w.document.title = '正式专区custom'; await f.c.tick();
  assert.equal(f.c.getState().status, 'paused'); assert.equal(f.c.getState().draft.courses.length, 25);
  assert.equal(f.c.getState().draft.courses.filter(c => c.selected).length, 23);
  assert.equal(f.root.querySelector('[data-draft]').hidden, false); assert.equal(f.root.querySelector('[data-action="add-draft"]').disabled, false);
  assert.deepEqual(f.c.getState().tasks[0], existing);
  await f.click('add-draft'); assert.equal(f.c.getState().tasks.length, 2); assert.deepEqual(f.c.getState().tasks[0], existing); f.close();
});

test('缺少template2标记且有25门课程的专区，点击候选后直接进入勾选而不等待超时', async () => {
  const f = setup(); f.panel.open(); await f.click('add');
  f.root.querySelector('[name="target"]').value = '示例专区'; await f.click('search');
  f.search('custom'); await f.c.tick(); await f.c.tick(); await f.click('candidate-custom');
  f.w.document.body.innerHTML = '<div class="subject-detail-page">' + Array.from({ length: 25 }, (_, i) => `<div class="content new"><div class="img course-item"><button id="studyBtns-item${i}" data-resource-id="item${i}" data-section-type="10"></button></div><span class="title">示例课程${i}</span><span class="study-status">未开始</span><span class="cont-class-type">选修</span></div>`).join('') + '</div>';
  f.w.document.title = '正式专区custom';
  assert.equal(f.c.getState().status, 'preparing'); await f.c.tick();
  assert.equal(f.c.getState().status, 'paused'); assert.equal(f.c.getState().draft.courses.length, 25);
  assert.equal(f.c.getState().draft.courses.filter(c => c.selected).length, 25);
  assert.equal(f.root.querySelector('[data-draft]').hidden, false);
  assert.equal(f.root.querySelector('[data-action="add-draft"]').disabled, false);
  assert.equal(f.root.querySelector('[data-candidates]').hidden, true); f.close();
});

test('真实面板和adapter：搜索确认添加两专区，状态预选和手工勾选，video→图文→下门→下专区保留SID', async () => {
  const f = setup(); f.panel.open();
  await f.add('s', [['a', '未开始', true], ['b', '学习中', false], ['c', '已完成', true], ['u', '未完成', false]]);
  assert.deepEqual(f.c.getState().draft.courses.map(item => [item.status, item.selected]), [['not-started', true], ['learning', true], ['completed', false], ['unknown', false]]);
  await f.change('[data-draft] [data-course="a"]', false); await f.change('[data-draft] [data-course="c"]', true); await f.click('add-draft');
  assert.equal(f.root.querySelector('[data-view="queue"]').hidden, false);
  await f.add('t', [['x', '未开始', false]]); await f.click('add-draft');
  assert.equal(f.c.getState().tasks.length, 2); assert.ok(f.c.getState().tasks.every(item => item.scope === 'all'));
  const firstId = f.c.getState().tasks[0].id; await f.click(`detail-${firstId}`);
  await f.change(`[data-task-detail="${firstId}"] [data-course="u"]`, true); await f.change(`[data-task-detail="${firstId}"] [data-course="u"]`, false);
  const start = f.root.querySelector('[name="start"]'); start.value = '10:00'; start.dispatchEvent(new f.w.Event('input')); await f.click('start'); assert.deepEqual(f.c.getState().window, { start: '10:00', end: '24:00' });
  assert.equal(f.c.getState().status, 'running'); await f.c.tick(); assert.match(f.w.location.hash, /subject-course\/b\/6\/s$/u);
  f.course('b', true); await f.c.tick(); assert.equal(f.c.getState().currentSectionTitle, 'v'); assert.match(f.root.querySelector('.status').textContent, /当前课节：v/u);
  f.complete('v'); await f.c.tick(); await f.elapse(6000); assert.equal(f.a.read().activeSectionId, 'doc'); await f.c.tick();
  f.complete('doc'); await f.c.tick(); await f.elapse(6000); assert.match(f.w.location.hash, /subject-course\/c\/6\/s$/u);
  f.course('c'); await f.c.tick(); f.complete('doc'); await f.c.tick(); await f.elapse(6000); assert.match(f.w.location.hash, /subject-course\/x\/6\/t$/u);
  assert.match(f.root.querySelector('header').textContent, /专区完成 1\/2/u); f.course('x'); await f.c.tick(); f.complete('doc'); await f.c.tick();
  assert.equal(f.c.getState().status, 'complete'); assert.equal(f.w.location.hash, '#/study/subject/detail/t'); assert.deepEqual(f.c.getState().tasks.map(item => item.done), [['b', 'c'], ['x']]);
  await f.click(`refresh-${firstId}`); f.subject('s', [['a', '未开始', true], ['b', '未开始', false], ['c', '已完成', true], ['u', '未完成', false], ['new', '已完成', true]]); await f.c.tick();
  assert.deepEqual(f.c.getState().tasks[0].done, ['b', 'c']); assert.equal(f.c.getState().tasks[0].courses.find(item => item.id === 'a').selected, false); assert.equal(f.c.getState().tasks[0].courses.find(item => item.id === 'new').selected, false); f.close();
});

test('真实adapter：已完成卡片手工选择后仍检查video→图文→选修下一课，并最终退出', async () => {
  const f = setup(); await f.collect(); await f.c.start(); await f.c.tick();
  assert.match(f.w.location.hash, /subject-course\/c\/6\/s$/u); f.course('c', true); await f.c.tick(); f.complete('v'); await f.c.tick(); await f.elapse(6000); assert.equal(f.a.read().activeSectionId, 'doc');
  await f.c.tick(); f.complete('doc'); await f.c.tick(); await f.elapse(6000); assert.match(f.w.location.hash, /subject-course\/d\/6\/s$/u); f.course('d'); await f.c.tick(); f.complete('doc'); await f.c.tick(); assert.equal(f.c.getState().status, 'complete'); assert.equal(f.w.location.hash, '#/study/subject/detail/s'); f.close();
});

test('真实面板：编辑焦点和脏名称保留、重复诊断、收起后暂停仍退出当前页', async () => {
  const f = setup(); f.panel.open(); await f.click('add'); const target = f.root.querySelector('[name="target"]'); target.focus(); target.value = '编辑中'; target.dispatchEvent(new f.w.Event('input'));
  await f.click('diagnose'); await f.click('diagnose'); assert.equal(target.value, '编辑中'); assert.equal(f.root.activeElement, target); assert.equal(f.root.querySelector('[data-action="diagnose"]').disabled, false);
  await f.click('back'); await f.collect(); await f.click('start'); await f.c.tick(); f.course('c'); await f.click('toggle'); assert.equal(f.root.querySelector('.body').hidden, true); await f.click('run-toggle'); assert.equal(f.c.getState().status, 'paused'); assert.equal(f.w.location.hash, '#/study/subject/detail/s');
  f.w.location.hash = '#/study/course/detail/subject-course/c/6/s'; f.course('c'); await f.click('toggle'); await f.click('stop-learning'); assert.equal(f.w.location.hash, '#/study/subject/detail/s'); f.close();
});

test('真实adapter：状态/播放器加载超时必须退出学习页，面板问题可重试或跳过继续且不误报全完成', async () => {
  for (const mode of ['status', 'player']) {
    const f = setup(); await f.collect(); await f.c.start(); await f.c.tick(); f.course('c', mode === 'player');
    if (mode === 'status') f.w.document.querySelector('dd span').textContent = '正在加载'; else f.w.document.querySelector('video').remove();
    await f.c.tick(); await f.elapse(31000); assert.equal(f.c.getState().status, 'paused'); assert.equal(f.w.location.hash, '#/study/subject/detail/s'); assert.equal(f.c.getState().problem.courseId, 'c');
    assert.match(f.root.querySelector('[data-problem]').textContent, /正式专区s.*课程c/su);
    if (mode === 'status') { await f.click('retry'); assert.equal(f.c.getState().status, 'running'); assert.equal(f.c.getState().problem, null); await f.c.tick(); f.course('c'); await f.click('run-toggle'); }
    else { await f.click('skip'); assert.equal(f.c.getState().status, 'running'); await f.c.tick(); assert.match(f.w.location.hash, /subject-course\/d\/6\/s$/u); f.course('d'); await f.c.tick(); f.complete('doc'); await f.c.tick(); assert.equal(f.c.getState().status, 'paused'); assert.deepEqual(f.c.getState().tasks[0].skipped, ['c']); assert.match(f.c.getState().message, /跳过课程未完成/u); }
    const oldCourseRoute = '#/study/course/detail/subject-course/c/6/s';
    f.w.location.hash = oldCourseRoute; f.course('c', true); let pauses = 0; f.w.document.querySelector('video').pause = () => { pauses += 1; };
    assert.equal(f.c.getState().currentCourseId, mode === 'status' ? 'c' : 'd');
    f.panel.open(); await f.click('stop-learning');
    if (mode === 'status') { assert.equal(f.w.location.hash, '#/study/subject/detail/s'); assert.ok(pauses > 0, '当前课程的媒体应停止'); }
    else { assert.equal(f.w.location.hash, oldCourseRoute, '旧课程不是当前任务执行页，暂停不得跳走'); assert.equal(pauses, 0, '不得触碰旧课程媒体'); }
    f.close();
  }
});

test('考试自动暂停后，展开停止入口仅退出当前归属页，不触碰其他课程或专区媒体', async () => {
  for (const [courseId, subjectId, owned] of [['other', 's', false], ['c', 'other-subject', false], ['c', 's', true]]) {
    const f = setup(); await f.collect(); await f.c.start(); await f.c.tick(); f.course('c');
    const exam = f.w.document.querySelector('dl'); exam.dataset.sectionType = '9'; exam.querySelector('.qcontent').textContent = '考试课节';
    const currentRoute = '#/study/course/detail/subject-course/c/6/s'; await f.c.tick();
    assert.equal(f.c.getState().status, 'paused'); assert.equal(f.c.getState().currentCourseId, 'c'); assert.equal(f.c.getState().currentSectionTitle, '考试课节');
    assert.equal(f.w.location.hash, currentRoute, '考试自动暂停保留页面供人工处理'); assert.equal(f.c.getState().problem.courseId, 'c');
    const route = `#/study/course/detail/subject-course/${courseId}/6/${subjectId}`;
    if (!owned) { f.w.location.hash = route; f.course(courseId); }
    const media = f.w.document.createElement('video'); let pauses = 0; media.pause = () => { pauses += 1; }; f.w.document.body.append(media);
    assert.equal(f.root.querySelector('.body').hidden, true); assert.equal(f.root.querySelector('header [data-action="run-toggle"]').textContent, '继续');
    await f.click('toggle'); assert.equal(f.root.querySelector('[data-action="stop-learning"]').disabled, false); await f.click('stop-learning');
    if (owned) { assert.equal(f.w.location.hash, '#/study/subject/detail/s'); assert.ok(pauses > 0, '当前考试页人工暂停应停止媒体并退出'); }
    else { assert.equal(f.w.location.hash, route); assert.equal(pauses, 0, '其他课程或专区的媒体不属于当前执行页'); }
    assert.equal(f.c.getState().status, 'paused'); f.close();
  }
});

test('收起面板可直接开始、暂停和继续，队列完成后按钮禁用', async () => {
  const f=setup(); await f.collect(); const run=f.root.querySelector('header [data-action="run-toggle"]'); assert.ok(run);
  assert.equal(f.root.querySelector('.body').hidden,true); assert.equal(run.textContent,'开始'); await f.click('run-toggle'); assert.equal(run.textContent,'暂停');
  await f.c.tick(); f.course('c'); await f.c.tick(); await f.click('run-toggle'); assert.equal(run.textContent,'继续'); assert.equal(f.c.getState().status,'paused'); assert.equal(f.w.location.hash,'#/study/subject/detail/s');
  await f.click('run-toggle'); assert.equal(run.textContent,'暂停'); await f.c.tick(); f.course('c'); f.complete('doc'); await f.c.tick(); await f.elapse(6000);
  f.course('d'); f.complete('doc'); await f.c.tick(); assert.equal(f.c.getState().status,'complete'); assert.equal(run.textContent,'已完成'); assert.equal(run.disabled,true); assert.equal(f.root.querySelector('.body').hidden,true); f.close();
});

test('自动模式通过实际面板开启：考试暂存→下一门完成→详情保留原因，互斥错误不抢占', async () => {
  const f=setup(); await f.collect();
  const automatic=f.root.querySelector('[name="automatic"]'); automatic.checked=true; automatic.dispatchEvent(new f.w.Event('change')); for(let i=0;i<40;i++) await Promise.resolve();
  assert.equal(f.c.getState().automation.enabled,true); await f.click('start'); await f.c.tick(); f.course('c'); f.w.document.querySelector('dl').dataset.sectionType='9'; await f.c.tick();
  assert.match(f.w.location.hash,/subject-course\/d\/6\/s$/u); assert.equal(f.c.getState().tasks[0].deferred[0].courseId,'c');
  f.course('d'); f.complete('doc'); await f.c.tick(); assert.equal(f.c.getState().status,'paused'); assert.match(f.c.getState().message,/待处理/u);
  const task=f.c.getState().tasks[0]; await f.click(`detail-${task.id}`); assert.match(f.root.querySelector(`[data-task-detail="${task.id}"]`).textContent,/待处理.*人工/u);
  await f.click(`retry-${task.id}-c`); await f.c.tick(); f.w.location.hash='#/study/errors/c&1'; await f.c.tick();
  assert.equal(f.c.getState().status,'paused'); assert.match(f.c.getState().message,/其他学习窗口/u); assert.equal(f.w.location.hash,'#/study/errors/c&1'); f.close();
});
