import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/controller.js';

function setup(shared = {}, opts = {}) {
  let time = Date.parse('2026-10-11T02:00:00Z');
  let page = { kind: 'subject', subjectId: 's', title: '专区', route: '#/study/subject/detail/s', courses: ['a', 'b'].map((id, i) => ({ id, title: id, required: !i, status: 'not-started', route: `#/study/course/detail/subject-course/${id}/6/s` })), sections: [], issues: [] };
  const actions = [], notices = [];
  const adapter = { read: () => structuredClone(page), diagnose: () => ({}), pauseMedia: () => actions.push('pause'),
    leaveLearning: route => { actions.push('leave'); page = { ...page, kind: 'subject', courseId: null, route }; return true; },
    openCourse: c => { actions.push(c.id); if (!opts.failOpen) page = { ...page, kind: 'course', route: c.route, courseId: c.id, subjectId: 's', sections: [], activeSectionId: null }; return !opts.failOpen; },
    playCurrentMedia: opts.play || (() => Promise.resolve(false)), openSubject: () => true };
  const storage = { get: k => structuredClone(shared[k]), set: (k,v) => { shared[k] = structuredClone(v); } };
  const locks = { request: async (_, __, callback) => { if (shared.locked) return callback(null); shared.locked = true; try { return await callback({}); } finally { shared.locked = false; } } };
  const c = createController({ adapter, storage, locks, owner: opts.owner || 'one', now: () => new Date(time), notify: n => notices.push(n), setInterval: () => 1, clearInterval: () => {} });
  const elapse = async ms => { for (let n=0; n<ms; n+=1000) { time += Math.min(1000, ms-n); await c.tick(); } };
  const lesson = (type=1, status='learning', id=page.courseId || 'a') => { page = { ...page, kind: 'course', courseId: id, subjectId: 's', route: `#/study/course/detail/subject-course/${id}/6/s`, sections: [{ id:'x', courseId:id, title:'课节', type, status, required:true, active:true }], activeSectionId:'x', media: null, issues: [] }; };
  const ready = async (resumeOnReload=false) => { await c.collectDraft(); await c.addDraft(); await c.setAutomation({ enabled:true, resumeOnReload }); };
  return { c, ready, actions, notices, shared, adapter, lesson, elapse, page: patch => { if (patch) page = { ...page, ...patch }; return page; }, advance: ms => { time += ms; } };
}

test('自动模式遇人工课节暂存原因并继续下一门，最后汇总而非完成', async () => {
  const f=setup(); await f.ready(); f.lesson(3); await f.c.start(); await f.c.tick();
  let t=f.c.getState().tasks[0]; assert.equal(t.deferred[0].courseId,'a'); assert.match(t.deferred[0].reason,/人工/u); assert.deepEqual(t.done,[]);
  await f.c.tick(); assert.equal(f.c.getState().currentCourseId,'b'); f.lesson(1,'completed','b'); await f.c.tick();
  assert.equal(f.c.getState().status,'paused'); assert.match(f.c.getState().message,/待处理/u); assert.equal(f.notices.length,1);
  assert.equal(f.shared['wangda-assistant.task'].runRequested,false); f.c.destroy();
});

test('加载故障按退避重试三次，耗尽后暂存，不能重复无限重进', async () => {
  const f=setup(); await f.ready(); await f.c.start(); await f.c.tick(); await f.c.tick(); await f.elapse(31000);
  assert.equal(f.c.getState().phase,'retrying'); assert.match(f.c.getState().message,/1\/3/u);
  await f.elapse(180000);
  assert.equal(f.c.getState().tasks[0].deferred[0].courseId,'a'); assert.equal(f.actions.filter(x=>x==='a').length,4);
  assert.ok(f.actions.includes('b')); await f.c.pause();
});

test('主动暂停取消待重试和刷新恢复意图', async () => {
  const f=setup(); await f.ready(true); await f.c.start(); await f.c.tick(); await f.c.tick(); await f.elapse(31000);
  await f.c.pause(); const before=[...f.actions]; await f.elapse(20000); assert.deepEqual(f.actions,before); assert.equal(f.shared['wangda-assistant.task'].runRequested,false);
});

test('允许时段外启动等待，进入时段自动开始；到终点等待下一天', async () => {
  const f=setup(); await f.ready(); await f.c.setWindow({start:'11:00',end:'12:00'});
  assert.equal(await f.c.start(),true); assert.equal(f.c.getState().status,'waiting'); assert.deepEqual(f.actions,[]);
  f.advance(3600000); await f.c.tick(); assert.equal(f.c.getState().status,'running'); await f.c.tick(); f.lesson();
  f.advance(3600000); await f.c.tick(); assert.equal(f.c.getState().status,'waiting'); assert.ok(f.actions.includes('leave'));
  f.advance(23*3600000); await f.c.tick(); assert.equal(f.c.getState().status,'running'); await f.c.pause();
});

test('主动暂停等待任务后到时不再执行', async () => {
  const f=setup(); await f.ready(); await f.c.setWindow({start:'11:00',end:'12:00'}); await f.c.start(); await f.c.pause();
  f.advance(3600000); await f.c.tick(); assert.equal(f.c.getState().status,'paused'); assert.deepEqual(f.actions,[]);
});

test('卸载保留明确允许的运行意图，重新打开重新获取锁自动恢复', async () => {
  const f=setup(); await f.ready(true); await f.c.start(); await f.c.tick(); f.c.destroy({ preserveRun:true });
  for (let i=0;i<4;i++) await Promise.resolve();
  const g=setup(f.shared,{owner:'two'}); await g.c.tick(); assert.equal(g.c.getState().status,'running'); await g.c.tick(); assert.ok(g.actions.includes('a')); await g.c.pause();
});

test('未开启刷新恢复时卸载不自动开始', async () => {
  const f=setup(); await f.ready(); await f.c.start(); f.c.destroy({preserveRun:true}); const g=setup(f.shared,{owner:'two'}); await g.c.tick(); assert.equal(g.c.getState().status,'paused'); assert.deepEqual(g.actions,[]);
});

test('仍有运行标签时新标签恢复不能抢占或覆写数据', async () => {
  const f=setup(); await f.ready(true); await f.c.start(); const before=structuredClone(f.shared['wangda-assistant.task']);
  const g=setup(f.shared,{owner:'two'}); await g.c.tick(); assert.deepEqual(g.actions,[]); assert.deepEqual(f.shared['wangda-assistant.task'],before); assert.equal(g.c.getState().status,'paused'); await f.c.pause();
});

test('登录失效或并发错误必须停下提醒，不暂存每门或抢播', async () => {
  for (const kind of ['login','study-error']) {
    const f=setup(); await f.ready(true); await f.c.start(); await f.c.tick();
    f.page({kind,route:kind==='login'?'#/login':'#/study/errors/a&1',errorCode:kind==='login'?null:'1'}); await f.c.tick();
    assert.equal(f.c.getState().status,'paused'); assert.deepEqual(f.c.getState().tasks[0].deferred,[]); assert.equal(f.notices.length,1);
    assert.match(f.c.getState().message,kind==='login'?/登录/u:/其他.*窗口/u); const before=[...f.actions]; await f.elapse(20000); assert.deepEqual(f.actions,before);
    assert.equal(f.shared['wangda-assistant.task'].runRequested,false);
  }
});

test('重试待处理课程只移除指定原因，不清除其他记录', async () => {
  const f=setup(); await f.ready(); f.lesson(3); await f.c.start(); await f.c.tick(); await f.c.pause(); const id=f.c.getState().tasks[0].id;
  await f.c.retry(id,'a'); assert.deepEqual(f.c.getState().tasks[0].deferred,[]); assert.equal(f.c.getState().currentCourseId,'a'); await f.c.pause();
});

test('批量选择仅覆盖明确状态的待学项，保留未知和完成项不选', async () => {
  const f=setup(); f.page({courses:[...f.page().courses,{id:'c',title:'c',status:'unknown',required:true,route:'#/study/course/detail/subject-course/c/6/s'},{id:'d',title:'d',status:'completed',required:true,route:'#/study/course/detail/subject-course/d/6/s'}]});
  await f.c.collectDraft(); f.c.selectCourses(null,'required'); assert.deepEqual(f.c.getState().draft.courses.map(c=>c.selected),[true,false,false,false]);
  f.c.selectCourses(null,'unfinished'); assert.deepEqual(f.c.getState().draft.courses.map(c=>c.selected),[true,true,false,false]);
  await f.c.addDraft(); const id=f.c.getState().tasks[0].id; await f.c.selectCourses(id,'none'); assert.ok(f.c.getState().tasks[0].courses.every(c=>!c.selected));
});

test('待处理和重试状态可以取消，旧播放回调不得改变下一门', async () => {
  let finish; const f=setup({}, {play:()=>new Promise(resolve=>{finish=resolve;})}); await f.ready(); f.lesson(5); f.page({media:{paused:true,ended:false}});
  await f.c.start(); await f.c.tick(); await f.elapse(30000); assert.equal(f.c.getState().phase,'retrying');
  const before=f.c.getState(); finish(false); for (let i=0;i<4;i++) await Promise.resolve(); assert.equal(f.c.getState().message,before.message);
  await f.c.pause();
});

test('时段外开始时停止本任务当前播放页，不让它留在学习页', async () => {
  const f=setup(); await f.ready(); f.lesson(5); f.page({media:{paused:false,ended:false}}); await f.c.setWindow({start:'11:00',end:'12:00'});
  await f.c.start(); assert.equal(f.c.getState().status,'waiting'); assert.ok(f.actions.includes('pause')); assert.ok(f.actions.includes('leave')); await f.c.pause();
});

test('自动恢复仍从上次当前课程接续，不从前面的课程重开', async () => {
  const f=setup(); await f.ready(true); await f.c.start(); await f.c.tick(); f.lesson(1,'completed'); await f.c.tick(); await f.elapse(6000); f.lesson(1,'learning','b');
  f.c.destroy({preserveRun:true}); for(let i=0;i<4;i++) await Promise.resolve();
  const g=setup(f.shared,{owner:'two'}); await g.c.tick(); assert.equal(g.c.getState().currentCourseId,'b'); await g.c.pause();
});

test('刷新恢复之前主动暂停也取消持久运行意图', async () => {
  const f=setup(); await f.ready(true); await f.c.start(); f.c.destroy({preserveRun:true}); for(let i=0;i<4;i++) await Promise.resolve();
  const g=setup(f.shared,{owner:'two'}); await g.c.pause(); assert.equal(g.shared['wangda-assistant.task'].runRequested,false); await g.c.tick(); assert.equal(g.c.getState().status,'paused');
});

test('断网等待恢复，不消耗重试预算或把全队列标为异常', async () => {
  const f=setup(); await f.ready(); await f.c.start(); await f.c.tick(); f.lesson(); f.page({online:false}); await f.c.tick();
  assert.equal(f.c.getState().phase,'offline'); assert.ok(f.actions.includes('leave'));
  await f.elapse(300000); assert.equal(f.actions.filter(a=>a==='a').length,1); assert.deepEqual(f.c.getState().tasks[0].deferred,[]);
  f.page({online:true}); await f.c.tick(); await f.c.tick(); assert.equal(f.actions.filter(a=>a==='a').length,2); await f.c.pause();
});

test('重试等待时用户导航离开不把用户拉回，也不清空后续任务', async () => {
  const f=setup(); await f.ready(); await f.c.start(); await f.c.tick(); await f.c.tick(); await f.elapse(30000);
  f.page({kind:'home',route:'#/home'}); const before=[...f.actions]; await f.c.tick(); assert.equal(f.c.getState().status,'paused'); assert.deepEqual(f.actions,before);
});

test('播放过的视频跨学习时段重入后，新的暂停播放器可正常启动', async () => {
  let plays=0; const f=setup({}, {play:()=>{plays++;return Promise.resolve(true);}}); await f.ready(); await f.c.setWindow({start:'10:00',end:'11:00'});
  f.lesson(5); f.page({media:{paused:false,ended:false}}); await f.c.start(); await f.c.tick();
  f.advance(3600000); await f.c.tick(); assert.equal(f.c.getState().status,'waiting'); f.advance(23*3600000); await f.c.tick(); await f.c.tick();
  f.lesson(5); f.page({media:{paused:true,ended:false}}); await f.c.tick(); assert.equal(plays,1); assert.equal(f.c.getState().status,'running'); await f.c.pause();
});

test('播放成功与下一次轮询之间被平台暂停，停止提醒而非自动抢播', async () => {
  let plays=0; const f=setup({}, {play:()=>{plays++;return Promise.resolve(true);}}); await f.ready(); f.lesson(5); f.page({media:{paused:true,ended:false}});
  await f.c.start(); await f.c.tick(); for(let i=0;i<4;i++) await Promise.resolve(); await f.c.tick();
  assert.equal(plays,1); assert.equal(f.c.getState().status,'paused'); assert.match(f.c.getState().message,/媒体已暂停/u); assert.ok(!f.actions.includes('leave')); assert.equal(f.notices.length,1);
});
