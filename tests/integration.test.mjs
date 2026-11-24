import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  function search(id, title = `正式专区${id}`) {
    page(`<button id="searchType-4">专题</button><input id="searchContent" name="keyword"><i id="searchBtn">搜索</i><ul id="all-list"><a href="#/study/subject/detail/${id}" title="${title}">结果</a><a href="#/study/subject/detail/other" title="其他专区">其他</a></ul>`);
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
  subject(); return { w, c, a, page, subject, search, course, complete, elapse, collect, panel, root, click, change, add, close };
}

for (const [layout, label, count, status] of [['grid', '图卡', 13, 'unknown'], ['list', '列表', 6, 'completed']]) {
  test(`专题目录${label}可直接读取、搜索进入、入队刷新并保留课程路由`, async () => {
    const html = readFileSync(new URL(`./fixtures/subjects/catalog-${layout}.html`, import.meta.url), 'utf8');
    const body = new JSDOM(html);
    const markup = body.window.document.body.innerHTML;
    body.window.close();
    const f = setup();
    try {
      const title = `示例${label}专题`;
      const sid = `subject-${layout}`;
      const route = `#/study/subject/detail/${sid}`;
      const cid = `${layout}-01`;
      f.w.location.hash = route;
      f.page(markup);
      f.panel.open();
      await f.click('add');
      await f.click('collect');
      const direct = f.c.getState().draft;
      assert.equal(direct.courses.length, count);
      assert.equal(direct.courses[0].status, status);
      assert.equal(direct.courses.some(item => item.selected), false);
      await f.click('back');

      await f.click('add');
      f.root.querySelector('[name="target"]').value = title;
      await f.click('search');
      f.search(sid, title);
      await f.c.tick();
      await f.c.tick();
      assert.equal(f.w.location.hash, route);
      f.page(markup);
      await f.c.tick();
      assert.deepEqual(f.c.getState().draft, direct);
      assert.equal(f.root.querySelector('[data-draft]').hidden, false);
      assert.equal(f.c.draftSetSelection(cid, true), true);
      await f.click('add-draft');
      const [task] = f.c.getState().tasks;
      assert.equal(task.courses[0].selected, true);
      assert.equal(await f.c.refreshTask(task.id), true);
      await f.c.tick();
      assert.deepEqual(f.c.getState().tasks, [task]);

      assert.equal(await f.c.start(), true);
      await f.c.tick();
      assert.equal(f.w.location.hash, `#/study/course/detail/subject-course/${cid}/6/${sid}`);
      assert.equal(f.a.read().subjectId, sid);
      assert.equal(f.a.read().courseId, cid);
    } finally { f.close(); }
  });
}

test('目标课程已自动播放时开始即静音，平台更换播放器后继续静音', async () => {
  const f=setup();f.subject('s',[['a','未开始',true]]);await f.collect();f.w.location.hash='#/study/course/detail/subject-course/a/6/s';f.course('a',true);const first=f.w.document.querySelector('video');first.volume=.4;
  await f.c.start();assert.equal(first.muted,true);assert.equal(first.volume,.4);first.muted=false;await f.c.tick();assert.equal(first.muted,true);
  f.course('a',true);const next=f.w.document.querySelector('video');await f.c.tick();assert.equal(next.muted,true);assert.equal(f.c.getState().tasks[0].done.length,0);f.close();
});

test('原生媒体普通暂停自动原地恢复，保持静音和音量，助手暂停后不恢复', async () => {
  const f=setup();f.subject('s',[['a','未开始',true]]);await f.collect();f.w.location.hash='#/study/course/detail/subject-course/a/6/s';f.course('a',true);
  const previous=f.w.document.querySelector('video'),media=f.w.document.createElement('video');previous.replaceWith(media);let paused=false,plays=0;
  Object.defineProperty(media,'paused',{get:()=>paused});media.play=async()=>{plays++;paused=false;};media.pause=()=>{paused=true;};media.volume=.4;
  await f.c.start();await f.c.tick();assert.equal(media.muted,true);media.muted=false;paused=true;await f.c.tick();await f.elapse(1000);assert.equal(plays,0);await f.elapse(1000);await f.c.tick();
  assert.equal(plays,1);assert.equal(paused,false);assert.equal(media.muted,true);assert.equal(media.volume,.4);assert.match(f.w.location.hash,/subject-course\/a\/6\/s$/u);assert.equal(f.c.getState().status,'running');assert.deepEqual(f.c.getState().tasks[0].done,[]);
  await f.click('run-toggle');await f.elapse(4000);assert.equal(f.c.getState().status,'paused');assert.equal(plays,1);assert.equal(paused,true);f.close();
});

test('继续进入课程后等待课节和媒体源，首次播放失败也在课程页内重试', async () => {
  const f = setup();
  try {
    const subjectRoute = '#/study/subject/detail/s';
    const courseRoute = '#/study/course/detail/subject-course/a/6/s';
    f.subject('s', [['a', '未开始', true]]);
    await f.collect();
    await f.c.setAutomation({ enabled: true, resumeOnReload: false });
    f.w.location.hash = courseRoute;
    f.course('a', true);
    await f.c.start();
    await f.c.tick();
    f.w.location.hash = '#/home';
    await f.c.tick();
    assert.equal(f.c.getState().status, 'paused');

    const navigation = [];
    for (const name of ['openCourse', 'leaveLearning']) {
      const original = f.a[name];
      f.a[name] = (...args) => { navigation.push(name); return original(...args); };
    }
    f.subject('s', [['a', '学习中', true]]);
    assert.equal(f.w.location.hash, subjectRoute);
    await f.click('run-toggle');
    await f.c.tick();
    assert.equal(f.w.location.hash, courseRoute);
    await f.elapse(2000); // The hash has changed but the subject catalog is still mounted.
    assert.equal(f.a.read().sectionListReady, false);
    assert.deepEqual(navigation, ['openCourse']);

    f.course('a', true);
    const media = f.w.document.createElement('video');
    f.w.document.querySelector('video').replaceWith(media);
    let plays = 0, paused = true;
    Object.defineProperty(media, 'paused', { get: () => paused });
    media.pause = () => { paused = true; };
    media.play = async () => {
      if (++plays === 1) throw new f.w.DOMException('fixture: interrupted while starting', 'AbortError');
      paused = false;
    };
    await f.elapse(3000);
    assert.equal(f.a.read().sectionListReady, true);
    assert.equal(f.a.read().mediaReady, false);
    assert.equal(plays, 0);
    assert.equal(f.c.getState().phase, 'running');
    assert.equal(f.w.location.hash, courseRoute);

    media.preload = 'none';
    media.src = '/synthetic-media.mp4';
    assert.equal(media.readyState, media.HAVE_NOTHING);
    assert.equal(f.a.read().mediaReady, true);
    await f.elapse(1000);
    assert.equal(plays, 1);
    assert.equal(f.c.getState().phase, 'retrying');
    assert.match(f.c.getState().message, /1\/3/u);
    assert.equal(f.w.location.hash, courseRoute);
    await f.elapse(5000);
    assert.equal(plays, 2);
    await f.elapse(1000);
    assert.equal(f.c.getState().phase, 'running');
    assert.equal(f.c.getState().currentPlayback.paused, false);
    assert.equal(f.w.location.hash, courseRoute);
    assert.deepEqual(navigation, ['openCourse']);
    assert.deepEqual(f.c.getState().tasks[0].deferred, []);
  } finally { f.close(); }
});

test('课程加载中回到来源专区时暂停，保留课程并且不再导航', async () => {
  const f = setup();
  try {
    f.subject('s', [['a', '未开始', true]]);
    await f.collect();
    await f.c.setAutomation({ enabled: true, resumeOnReload: false });
    const navigation = [];
    for (const name of ['openCourse', 'leaveLearning']) {
      const original = f.a[name];
      f.a[name] = (...args) => { navigation.push(name); return original(...args); };
    }
    await f.c.start();
    await f.c.tick();
    await f.elapse(1000);
    f.subject('s', [['a', '学习中', true]]);
    await f.elapse(1000);
    assert.equal(f.c.getState().status, 'paused');
    assert.match(f.c.getState().message, /已离开目标课程/u);
    await f.elapse(32000);
    assert.equal(f.w.location.hash, '#/study/subject/detail/s');
    assert.deepEqual(navigation, ['openCourse']);
    assert.deepEqual(f.c.getState().tasks[0].deferred, []);
  } finally { f.close(); }
});

test('播放器持续拒绝时只原地重试三次，暂存原因并保留课程页', async () => {
  const f = setup();
  try {
    f.subject('s', [['a', '未开始', true]]);
    await f.collect();
    await f.c.setAutomation({ enabled: true, resumeOnReload: false });
    await f.c.start();
    await f.c.tick();
    const courseRoute = '#/study/course/detail/subject-course/a/6/s';
    f.course('a', true);
    const media = f.w.document.createElement('video');
    f.w.document.querySelector('video').replaceWith(media);
    media.src = '/synthetic-media.mp4';
    media.pause = () => {};
    let plays = 0;
    media.play = async () => { plays++; throw new f.w.DOMException('fixture: autoplay blocked', 'NotAllowedError'); };
    const navigation = [];
    for (const name of ['openCourse', 'leaveLearning']) {
      const original = f.a[name];
      f.a[name] = (...args) => { navigation.push(name); return original(...args); };
    }
    await f.elapse(1000);
    for (const [index, delay] of [5000, 10000, 20000].entries()) {
      assert.match(f.c.getState().message, new RegExp(`${index + 1}/3`, 'u'));
      await f.elapse(delay);
      assert.equal(f.w.location.hash, courseRoute);
      assert.equal(plays, index + 2);
    }
    assert.equal(f.c.getState().status, 'paused');
    assert.match(f.c.getState().tasks[0].deferred[0].reason, /已重试三次/u);
    await f.elapse(60000);
    assert.equal(plays, 4);
    assert.deepEqual(navigation, []);
  } finally { f.close(); }
});

test('视频延迟创建及初始化开声在轮询前静音，暂停与关闭选项后媒体事件不静音', async () => {
  const f=setup();f.subject('s',[['a','未开始',true]]);await f.collect();await f.c.start();await f.c.tick();f.course('a',true);await Promise.resolve();const media=f.w.document.querySelector('video');assert.equal(media.muted,true);
  for(const type of ['loadedmetadata','play','playing','volumechange']){media.muted=false;media.dispatchEvent(new f.w.Event(type));assert.equal(media.muted,true,type);}await f.c.pause();media.muted=false;media.dispatchEvent(new f.w.Event('play'));await Promise.resolve();assert.equal(media.muted,false);
  await f.c.setAutomation({enabled:false,resumeOnReload:false,mute:false});await f.c.start();await f.c.tick();f.course('a',true);await Promise.resolve();const next=f.w.document.querySelector('video');next.dispatchEvent(new f.w.Event('playing'));await f.c.tick();assert.equal(next.muted,false);f.close();
});

test('实际面板学习中清理上一完成专区，当前视频不断播，全部完成后可清空列表', async () => {
  const f=setup();f.subject('s',[['a','未开始',true]]);await f.collect();f.subject('s2',[['b','未开始',true]]);await f.collect();f.panel.open();await f.c.start();await f.c.tick();f.course('a');f.complete('doc');await f.c.tick();await f.c.tick();
  assert.equal(f.root.querySelector('[data-action="clear-completed"]').disabled,true);await f.elapse(6000);f.course('b',true);await f.c.tick();const media=f.w.document.querySelector('video');let pauses=0;media.pause=()=>{pauses++;};const active=f.c.getState().activeTaskId,route=f.w.location.hash;
  assert.equal(f.root.querySelector('[data-action="clear-completed"]').disabled,false);await f.click('clear-completed');assert.equal(f.c.getState().tasks.length,1);assert.equal(f.c.getState().activeTaskId,active);assert.equal(f.c.getState().status,'running');assert.equal(f.w.location.hash,route);assert.equal(pauses,0);assert.equal(media.muted,true);assert.equal(f.root.querySelectorAll('article').length,1);
  f.complete('v');await f.c.tick();await f.elapse(6000);f.complete('doc');await f.c.tick();assert.equal(f.c.getState().status,'complete');await f.click('clear-completed');assert.deepEqual(f.c.getState().tasks,[]);assert.equal(f.c.getState().currentCourseId,null);assert.equal(f.root.querySelectorAll('article').length,0);assert.equal(f.root.querySelector('[data-action="clear-completed"]').disabled,true);f.close();
});

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
  await f.click('start');await f.c.tick();assert.match(f.w.location.hash,/subject-course\/b\/6\/s$/u);f.course('b');f.complete('doc');await f.c.tick();await f.c.tick();assert.equal(f.c.getState().status,'complete');
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
  f.course('z'); f.complete('doc'); await f.c.tick(); await f.c.tick(); await f.elapse(6000); assert.match(f.w.location.hash,/subject-course\/b\/6\/s$/u); assert.deepEqual(f.c.getState().tasks.find(t=>t.id===a.id).done,['a']); f.close();
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
  f.course('b', true); await f.c.tick(); assert.equal(f.c.getState().currentSectionTitle, 'v'); assert.match(f.root.querySelector('[data-course="b"]').closest('label').textContent, /课节 · v/u);
  f.complete('v'); await f.c.tick(); await f.elapse(6000); assert.equal(f.a.read().activeSectionId, 'doc'); await f.c.tick();
  f.complete('doc'); await f.c.tick(); await f.elapse(6000); assert.match(f.w.location.hash, /subject-course\/c\/6\/s$/u);
  f.course('c'); await f.c.tick(); f.complete('doc'); await f.c.tick(); await f.elapse(6000); assert.match(f.w.location.hash, /subject-course\/x\/6\/t$/u);
  assert.match(f.root.querySelector('header').textContent, /总完成 2\/3 门/u); f.course('x'); await f.c.tick(); f.complete('doc'); await f.c.tick();
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
  await f.click('run-toggle'); assert.equal(run.textContent,'暂停'); await f.c.tick(); f.course('c'); f.complete('doc'); await f.c.tick(); await f.c.tick(); await f.elapse(6000);
  f.course('d'); f.complete('doc'); await f.c.tick(); await f.c.tick(); assert.equal(f.c.getState().status,'complete'); assert.equal(run.textContent,'已完成'); assert.equal(run.disabled,true); assert.equal(f.root.querySelector('.body').hidden,true); f.close();
});

test('自动模式通过实际面板开启：考试暂存→下一门完成→详情保留原因，互斥错误不抢占', async () => {
  const f=setup(); await f.collect();
  const automatic=f.root.querySelector('[name="automatic"]'); automatic.checked=true; automatic.dispatchEvent(new f.w.Event('change')); for(let i=0;i<40;i++) await Promise.resolve();
  assert.equal(f.c.getState().automation.enabled,true); await f.click('start'); await f.c.tick(); f.course('c'); f.w.document.querySelector('dl').dataset.sectionType='9'; await f.c.tick();
  assert.match(f.w.location.hash,/subject-course\/d\/6\/s$/u); assert.equal(f.c.getState().tasks[0].deferred[0].courseId,'c');
  f.course('d'); f.complete('doc'); await f.c.tick(); await f.c.tick(); assert.equal(f.c.getState().status,'paused'); assert.match(f.c.getState().message,/待处理/u);
  const task=f.c.getState().tasks[0]; await f.click(`detail-${task.id}`); assert.match(f.root.querySelector(`[data-task-detail="${task.id}"]`).textContent,/待处理.*人工/u);
  await f.click(`retry-${task.id}-c`); await f.c.tick(); f.w.location.hash='#/study/errors/c&1'; await f.c.tick();
  assert.equal(f.c.getState().status,'paused'); assert.match(f.c.getState().message,/其他学习窗口/u); assert.equal(f.w.location.hash,'#/study/errors/c&1'); f.close();
});

test('端到端：空壳正文目录组回退旧卡片与混合目录读取入队并保留路由', async () => {
  const gridHtml = readFileSync(new URL('./fixtures/subjects/catalog-grid.html', import.meta.url), 'utf8');
  const gridBody = new JSDOM(gridHtml);
  const markup = gridBody.window.document.body.innerHTML;
  gridBody.window.close();
  const f = setup();
  try {
    f.w.location.hash = '#/study/subject/detail/mixed-s';
    const root = f.page(markup);
    for (const item of root.querySelectorAll('.catalog-state-info2 .course-item')) item.remove();
    root.insertAdjacentHTML('beforeend', '<div class="content new"><div class="img course-item"><button id="studyBtns-legacy1" data-resource-id="legacy1" data-section-type="10"></button></div><span class="title">回退旧课</span><span class="study-status">未开始</span><span class="cont-class-type">必修</span></div>');
    f.panel.open();
    await f.click('add');
    await f.click('collect');
    assert.deepEqual(f.c.getState().draft.courses.map(item => item.id), ['legacy1']);
    assert.equal(f.c.getState().draft.courses[0].route, '#/study/course/detail/subject-course/legacy1/6/mixed-s');
    await f.click('add-draft');
    assert.equal(f.c.getState().tasks.length, 1);
  } finally { f.close(); }
});

test('端到端：课节分批加载（空章节及已完成子集后补未完成课节）不提前标记完成', async () => {
  const f = setup();
  try {
    f.subject('s', [['c', '未开始', true]]);
    await f.collect();
    await f.c.start();
    await f.c.tick();
    // Phase 1: chapter 1 has 1 completed section, chapter 2 is still empty (unloaded).
    const container = f.page('<div class="chapter-list chapter-all"><ul><li><dl id="show-sectionsone" data-course-id="c" data-section-type="1" class="focus"><dt><span class="qcontent">第1节</span></dt><dd><div class="item continue pointer"><span>已完成</span></div></dd></dl></li><li id="ch2"><div class="list-title">第2章</div></li></ul></div>');
    await f.c.tick();
    await f.c.tick();
    assert.equal(f.c.getState().status, 'running');
    assert.deepEqual(f.c.getState().tasks[0].done, []);

    // Phase 2: chapter 2 renders an uncompleted section.
    container.querySelector('#ch2').insertAdjacentHTML('beforeend', '<dl id="show-sectionstwo" data-course-id="c" data-section-type="1"><dt><span class="qcontent">第2节</span></dt><dd><div class="item start pointer"><span>未开始</span></div></dd></dl>');
    container.querySelectorAll('dl').forEach(el => el.addEventListener('click', () => { container.querySelectorAll('dl').forEach(x => x.classList.remove('focus')); el.classList.add('focus'); }));
    await f.c.tick();
    await f.c.tick();
    await f.elapse(6000);
    assert.equal(f.a.read().activeSectionId, 'two');
    assert.deepEqual(f.c.getState().tasks[0].done, []);
    f.complete('two');
    await f.c.tick();
    assert.equal(f.c.getState().status, 'complete');
    assert.deepEqual(f.c.getState().tasks[0].done, ['c']);
  } finally { f.close(); }
});

test('端到端：视频结束后平台仍报学习中满90秒独立超时，面板展示明确失败原因不卡死', async () => {
  const f = setup();
  try {
    f.subject('s', [['a', '未开始', true], ['b', '未开始', true]]);
    await f.collect();
    f.panel.open();
    await f.c.start();
    await f.c.tick();
    f.course('a', true);
    const video = f.w.document.createElement('video');
    Object.defineProperties(video, { paused: { value: true, configurable: true }, ended: { value: true, configurable: true } });
    video.pause = () => {};
    f.w.document.querySelector('video').replaceWith(video);
    await f.c.tick();
    assert.equal(f.c.getState().phase, 'confirming');
    assert.match(f.root.querySelector('header').textContent, /等待平台确认/u);
    await f.elapse(90000);
    assert.equal(f.c.getState().status, 'paused');
    assert.deepEqual(f.c.getState().tasks[0].done, []);
    assert.match(f.root.querySelector('[data-problem]').textContent, /等待平台确认超时（90秒）/u);
  } finally { f.close(); }
});

test('端到端：多播放器无法确定目标时面板立即可见提示且不触碰任意播放器', async () => {
  const f = setup();
  try {
    f.subject('s', [['a', '未开始', true]]);
    await f.collect();
    f.panel.open();
    await f.c.start();
    await f.c.tick();
    f.course('a', true);
    const audio = f.w.document.createElement('audio');
    const video = f.w.document.createElement('video');
    Object.defineProperties(audio, { paused: { value: false, configurable: true }, ended: { value: false, configurable: true } });
    Object.defineProperties(video, { paused: { value: true, configurable: true }, ended: { value: false, configurable: true } });
    let plays = 0;
    let pauses = 0;
    audio.pause = () => { pauses += 1; };
    video.pause = () => { pauses += 1; };
    video.play = async () => { plays += 1; };
    video.muted = false;
    audio.muted = false;
    f.w.document.querySelector('video').replaceWith(video);
    f.w.document.body.append(audio);
    await f.c.tick();
    assert.equal(f.c.getState().status, 'paused');
    assert.equal(plays, 0);
    assert.equal(pauses, 0);
    assert.equal(video.muted, false);
    assert.equal(audio.muted, false);
    assert.match(f.root.querySelector('[data-problem]').textContent, /多个原生媒体播放器（2 个）/u);
  } finally { f.close(); }
});

test('端到端：手工读取与页面诊断明确区分零结果、页面未就绪与不支持的结构', async () => {
  const f = setup();
  try {
    f.panel.open();
    await f.click('add');
    const scenarios = [
      ['#/study/subject/detail/s', '<div class="subject-detail-page"><div class="empty">暂无课程</div></div>', /零结果/u, 'zero-results'],
      ['#/study/subject/detail/s', '<div class="subject-detail-page"><div class="loading">加载中</div></div>', /页面未就绪/u, 'not-ready'],
      ['#/study/subject/detail/s', '<div class="subject-detail-page"><article class="v3-item"><a href="#/x">未知卡片</a></article></div>', /不支持的结构/u, 'unsupported-structure'],
    ];
    for (const [route, html, messagePattern, category] of scenarios) {
      f.w.location.hash = route;
      f.page(html);
      await f.click('collect');
      assert.match(f.c.getState().message, messagePattern);
      assert.match(f.root.querySelector('.status').textContent, messagePattern);
      await f.click('diagnose');
      const diag = JSON.parse(f.root.querySelector('pre').textContent);
      assert.equal(diag.recognition.category, category);
      assert.ok(diag.recognition.basis);
    }
  } finally { f.close(); }
});
