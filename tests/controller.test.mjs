import test from 'node:test';
import assert from 'node:assert/strict';
const { createController = () => assert.fail('控制器尚未实现') } = await import('../src/controller.js').catch(() => ({}));

export function fixture(shared = {}, options = {}) {
  let time = Date.parse('2026-10-10T02:00:00Z');
  let page = { kind: 'subject', subjectId: 's', title: '测试专题', route: '#/study/subject/detail/s', courses: [{ id: 'c', title: '课程', required: true, status: 'completed', route: '#/study/course/detail/subject-course/c/6/s' }], sections: [], issues: [] };
  const actions = [];
  const storage = { get: key => structuredClone(shared[key]), set: (key, value) => { if (options.failWrite) throw Error('write'); shared[key] = structuredClone(value); } };
  const locks = options.noLocks ? null : { request: async (_name, _opts, callback) => {
    if (shared.locked) return callback(null);
    shared.locked = true;
    try { return await callback({ name: 'run' }); } finally { shared.locked = false; }
  } };
  const adapter = { read: () => structuredClone(page), diagnose: () => ({ kind: page.kind, sections: page.sections.length }),
    goSearch: () => { actions.push('search'); page.kind = 'search'; return true; }, searchKeyword: text => { actions.push(['keyword', text]); return true; },
    openSubject: item => { actions.push(['subject', item.id]); return true; }, openCourse: item => { actions.push(['course', item.id]); return true; },
    selectSection: id => { actions.push(['section', id]); return true; }, pauseMedia: () => actions.push('pause'), leaveLearning: () => actions.push('leave'),
    playCurrentMedia: () => { actions.push('play'); return options.play ? options.play() : Promise.resolve(true); } };
  const c = createController({ adapter, storage, locks, now: () => new Date(time), owner: options.owner || Math.random().toString(), setInterval: () => 1, clearInterval: () => {} });
  return { c, shared, actions, adapter, page: value => { if (value) page = { ...page, ...value }; return page; }, advance: ms => { time += ms; }, config: () => c.setWindow({ start: '09:00', end: '24:00' }) };
}

export async function ready(f) { await f.config(); await f.c.collectDraft(); for (const course of f.c.getState().draft?.courses || []) f.c.draftSetSelection(course.id, true); await f.c.addDraft(); f.actions.length = 0; return f; }
export function course(sections, extra = {}) { return { kind: 'course', subjectId: 's', courseId: 'c', route: '#/study/course/detail/subject-course/c/6/s', sections, activeSectionId: sections.find(x => x.active)?.id || null, media: null, issues: [], ...extra }; }
export function section(id = 'v', type = 5, status = 'learning', active = true) { return { id, courseId: 'c', type, status, active, required: true }; }
export async function elapse(f, duration) { for (let remaining = duration; remaining > 0; remaining -= 1000) { f.advance(Math.min(remaining, 1000)); await f.c.tick(); } }

test('开始立即尝试目标静音，运行轮询继续应用，暂停和离开后不操作', async () => {
  const f=await ready(fixture());const muted=[];f.adapter.muteCurrentMedia=(target,run)=>{muted.push([target.id,target.route,run]);return true;};f.page(course([section()],{media:{paused:false,ended:false}}));
  await f.c.start();assert.equal(muted.length,1);assert.equal(muted[0][0],'c');assert.ok(muted[0][2]);await f.c.tick();assert.equal(muted.length,2);assert.equal(muted[1][2],muted[0][2]);
  await f.c.pause();await f.c.tick();assert.equal(muted.length,2);await f.c.start();assert.notEqual(muted.at(-1)[2],muted[0][2]);const count=muted.length;f.page({route:'#/home',kind:'home'});await f.c.tick();assert.equal(muted.length,count);f.c.destroy();
});

test('播放时间仅从已核对课程课节展示，不持久化且切节图文暂停时清除', async () => {
  const f=await ready(fixture());await f.c.start();f.page(course([section()],{media:{paused:false,ended:false,currentTime:42,duration:100}}));await f.c.tick();
  assert.deepEqual(f.c.getState().currentPlayback,{taskId:f.c.getState().activeTaskId,courseId:'c',sectionId:'v',paused:false,ended:false,currentTime:42,duration:100});assert.equal(JSON.stringify(f.shared).includes('currentTime'),false);
  f.page(course([section('doc',1)],{media:{paused:false,ended:false,currentTime:42,duration:100}}));await f.c.tick();assert.equal(f.c.getState().currentPlayback,null);
  f.page(course([section()],{media:{paused:false,ended:true,currentTime:100,duration:100}}));await f.c.tick();assert.equal(f.c.getState().tasks[0].done.length,0);assert.equal(f.c.getState().currentPlayback.ended,true);
  await f.c.pause();assert.equal(f.c.getState().currentPlayback,null);f.c.destroy();
});

test('离开课程或结构未确认时不能保留上一页播放进度', async () => {
  for(const patch of [{issues:['课节标识无法识别']},{route:'#/study/course/detail/subject-course/other/6/s',courseId:'other'}]){
    const f=await ready(fixture());await f.c.start();f.page(course([section()],{media:{paused:false,ended:false,currentTime:2,duration:10}}));await f.c.tick();assert.ok(f.c.getState().currentPlayback);
    f.page(patch);await f.c.tick();assert.equal(f.c.getState().currentPlayback,null);f.c.destroy();
  }
});

test('指定范围先清空预选，加入刷新新增课程不勾选，范围与原勾选恢复', async () => {
  const f=fixture(); await f.c.collectDraft(); assert.equal(typeof f.c.setTaskMode,'function');
  assert.equal(await f.c.setTaskMode(null,'specific'),true); assert.equal(f.c.getState().draft.selectionMode,'specific'); assert.equal(f.c.getState().draft.courses[0].selected,false);
  assert.equal(await f.c.setTaskMode(null,'all-pending'),true); assert.equal(await f.c.setTaskMode(null,'specific'),true);
  f.c.draftSetSelection('c',true); await f.c.addDraft(); const id=f.c.getState().tasks[0].id;
  await f.c.refreshTask(id); f.page({courses:[...f.page().courses,{id:'d',title:'新增课程',required:true,status:'not-started',route:'#/study/course/detail/subject-course/d/6/s'}]}); await f.c.tick();
  assert.deepEqual(f.c.getState().tasks[0].courses.map(c=>c.selected),[true,false]); const restored=fixture(f.shared); assert.equal(restored.c.getState().tasks[0].selectionMode,'specific'); restored.c.destroy();
  assert.equal(await f.c.setTaskMode(id,'all-pending'),true); assert.deepEqual(f.c.getState().tasks[0].courses.map(c=>c.selected),[false,true]); f.c.destroy();
});

test('草稿指定课程切回全部待学可恢复预选，不依赖尚未建立的完成记录', async () => {
  const f=fixture();f.page({courses:[{...f.page().courses[0],status:'learning'}]});await f.c.collectDraft();await f.c.setTaskMode(null,'specific');assert.equal(f.c.getState().draft.courses[0].selected,false);
  assert.equal(await f.c.setTaskMode(null,'all-pending'),true);assert.equal(f.c.getState().draft.courses[0].selected,true);f.c.destroy();
});

test('草稿勾选已完成时未知和未选待学课程保持布尔false且可正常加入', async () => {
  const f=fixture();f.page({courses:[...f.page().courses,{id:'d',title:'未知课程',required:true,status:'unknown',route:'#/study/course/detail/subject-course/d/6/s'}]});await f.c.collectDraft();await f.c.setTaskMode(null,'specific');await f.c.selectCourses(null,'completed');
  assert.deepEqual(f.c.getState().draft.courses.map(c=>c.selected),[true,false]);assert.equal(await f.c.addDraft(),true);assert.equal(f.c.getState().unavailable,false);f.c.destroy();
});

test('复查保留done，恢复后重新读取课节，有新增课节则等待完成且不重复累积done', async () => {
  const f=await ready(fixture()); await f.c.start(); await f.c.tick(); f.page(course([section('doc',1,'completed')])); await f.c.tick();
  const id=f.c.getState().tasks[0].id; assert.equal(f.c.getState().status,'complete'); assert.equal(typeof f.c.recheckCompleted,'function');
  assert.equal(await f.c.recheckCompleted(id),true); assert.deepEqual(f.c.getState().tasks[0].done,['c']); assert.deepEqual(f.c.getState().tasks[0].recheck,['c']); assert.equal(f.c.getState().status,'paused');
  const restored=fixture(f.shared); assert.deepEqual(restored.c.getState().tasks[0].recheck,['c']); restored.c.destroy();
  await f.c.start(); f.page(course([section('new-doc',1,'learning')])); await f.c.tick(); assert.equal(f.c.getState().status,'running'); assert.deepEqual(f.c.getState().tasks[0].recheck,['c']);
  f.page(course([section('new-doc',1,'completed')])); await f.c.tick(); assert.equal(f.c.getState().status,'complete'); assert.deepEqual(f.c.getState().tasks[0].done,['c']); assert.deepEqual(f.c.getState().tasks[0].recheck,[]); f.c.destroy();
});

test('复查遇人工环节可暂存，完成历史保留但仍属于待处理，运行期间不能修改范围', async () => {
  const f=await ready(fixture()); await f.c.start(); await f.c.tick(); f.page(course([section('doc',1,'completed')])); await f.c.tick(); const id=f.c.getState().tasks[0].id;
  assert.equal(typeof f.c.recheckCompleted,'function'); await f.c.recheckCompleted(id); await f.c.setAutomation({enabled:true,resumeOnReload:false}); await f.c.start();
  assert.equal(await f.c.setTaskMode(id,'specific'),false); assert.equal(await f.c.recheckCompleted(id),false);
  f.page(course([section('exam',9,'learning')])); await f.c.tick(); assert.equal(f.c.getState().unavailable,false); assert.deepEqual(f.c.getState().tasks[0].done,['c']); assert.equal(f.c.getState().tasks[0].deferred[0].courseId,'c'); assert.match(f.c.getState().message,/待处理/u); f.c.destroy();
});

test('复查遇人工环节手动跳过及重试均保留原完成历史', async () => {
  const f=await ready(fixture());await f.c.start();await f.c.tick();f.page(course([section('doc',1,'completed')]));await f.c.tick();const id=f.c.getState().tasks[0].id;
  await f.c.recheckCompleted(id);await f.c.start();f.page(course([section('exam',9)]));await f.c.tick();assert.equal(f.c.getState().status,'paused');await f.c.skipCurrent();
  assert.deepEqual(f.c.getState().tasks[0].done,['c']);assert.deepEqual(f.c.getState().tasks[0].skipped,['c']);assert.deepEqual(f.c.getState().tasks[0].recheck,['c']);
  await f.c.retry(id,'c');assert.deepEqual(f.c.getState().tasks[0].done,['c']);assert.deepEqual(f.c.getState().tasks[0].recheck,['c']);f.c.destroy();
});

test('运行中遇目标课程重学页面或确认框暂停并取消自动恢复', async () => {
  for(const kind of ['course','course-relearn']){
    const f=await ready(fixture());await f.c.setAutomation({enabled:true,resumeOnReload:true});await f.c.start();await f.c.tick();
    f.page({kind,courseId:'c',subjectId:kind==='course'?'s':null,route:kind==='course'?'#/study/course/detail/subject-course/c/6/s':'#/study/course-middle/c/2',relearn:{kind:'course',manualRequired:true,reason:'请在平台处理归档恢复。'}});await f.c.tick();assert.equal(f.c.getState().status,'paused');assert.match(f.c.getState().message,/重新学习/u);assert.equal(f.shared['wangda-assistant.task'].runRequested,false);f.c.destroy();
  }
});

test('播放异步失败晚到时优先处理重学提示，不重试离页并清自动恢复意图', async () => {
  for(const reject of [false,true]){
    let settle;const play=new Promise((resolve,fail)=>{settle=()=>reject?fail(Error('blocked')):resolve(false);});const f=await ready(fixture({}, {play:()=>play}));
    await f.c.setAutomation({enabled:true,resumeOnReload:true});await f.c.start();f.page(course([section()],{media:{paused:true,ended:false}}));await f.c.tick();
    f.page({relearn:{kind:'course',manualRequired:true,reason:'请人工处理归档恢复。'}});f.actions.length=0;settle();for(let i=0;i<40;i++)await Promise.resolve();
    assert.equal(f.c.getState().status,'paused');assert.match(f.c.getState().message,/重新学习/u);assert.equal(f.shared['wangda-assistant.task'].runRequested,false);assert.equal(f.actions.includes('leave'),false);f.c.destroy();
  }
});

async function twoOrderedTasks(f) {
  f.page({courses:[...f.page().courses,{id:'d',title:'原专区剩余课程',required:true,status:'learning',route:'#/study/course/detail/subject-course/d/6/s'}]});
  await ready(f);
  f.page({kind:'subject',subjectId:'s2',title:'另一个专区',route:'#/study/subject/detail/s2',courses:[{id:'z',title:'另一课程',required:true,status:'learning',route:'#/study/course/detail/subject-course/z/6/s2'}]});
  await f.c.collectDraft(); await f.c.addDraft(); f.actions.length=0; return f;
}

test('专区排序保存并恢复，任务内容和当前标识保持原样，非法位置不写入', async () => {
  const f=await twoOrderedTasks(fixture()); const before=f.c.getState(); const [a,b]=before.tasks;
  assert.equal(typeof f.c.moveTask,'function'); assert.equal(await f.c.moveTask(b.id,0),true);
  assert.deepEqual(f.c.getState().tasks,[b,a]); assert.equal(f.c.getState().activeTaskId,before.activeTaskId); assert.equal(f.c.getState().status,'paused'); assert.deepEqual(f.actions,[]);
  const restored=fixture(f.shared); assert.deepEqual(restored.c.getState().tasks,[b,a]); restored.c.destroy();
  const revision=f.shared['wangda-assistant.task'].revision;
  for(const [id,index] of [[a.id,-1],[a.id,2],[a.id,0.5],['missing',0],[a.id,'0']])assert.equal(await f.c.moveTask(id,index),false);
  assert.equal(await f.c.moveTask(b.id,0),true); assert.equal(f.shared['wangda-assistant.task'].revision,revision); f.c.destroy();
});

test('运行时重排不暂停和切页，当前课程完成后按新顺序进入下一专区', async () => {
  const f=await twoOrderedTasks(fixture()); const [a,b]=f.c.getState().tasks; await f.c.start(); await f.c.tick();
  f.page(course([section('doc',1,'learning')])); await f.c.tick(); const before=f.c.getState(); const actions=[...f.actions];
  assert.equal(typeof f.c.moveTask,'function'); assert.equal(await f.c.moveTask(b.id,0),true);
  const after=f.c.getState(); assert.equal(after.status,'running'); assert.equal(after.activeTaskId,a.id); assert.equal(after.currentCourseId,'c'); assert.equal(after.currentSectionTitle,before.currentSectionTitle); assert.deepEqual(f.actions,actions); assert.equal(f.shared.locked,true);
  f.page(course([section('doc',1,'completed')])); await f.c.tick(); await elapse(f,6000);
  assert.equal(f.c.getState().activeTaskId,b.id); assert.deepEqual(f.actions.at(-1),['course','z']); assert.deepEqual(f.c.getState().tasks[1].done,['c']);
  f.page(course([section('z-doc',1,'completed')],{subjectId:'s2',courseId:'z',route:'#/study/course/detail/subject-course/z/6/s2',sections:[{...section('z-doc',1,'completed'),courseId:'z'}]})); await f.c.tick(); await elapse(f,6000);
  assert.equal(f.c.getState().activeTaskId,a.id); assert.deepEqual(f.actions.at(-1),['course','d']); f.c.destroy();
});

test('排序遵守准备状态和外来版本检查，不能覆盖另一标签的新队列', async () => {
  const f=await twoOrderedTasks(fixture()); const [a,b]=f.c.getState().tasks; assert.equal(typeof f.c.moveTask,'function');
  await f.c.search('测试'); const stored=structuredClone(f.shared['wangda-assistant.task']); assert.equal(await f.c.moveTask(b.id,0),false); assert.deepEqual(f.shared['wangda-assistant.task'],stored); await f.c.pause();
  await f.c.start(); f.shared['wangda-assistant.task'].revision+=1; const foreign=structuredClone(f.shared['wangda-assistant.task']);
  assert.equal(await f.c.moveTask(b.id,0),false); assert.deepEqual(f.shared['wangda-assistant.task'],foreign); assert.equal(f.c.getState().status,'paused'); assert.deepEqual(f.c.getState().tasks.map(t=>t.id),[a.id,b.id]); f.c.destroy();
});

test('完成后原生抢先切原专区紧邻下一门，停止该页媒体并按新排序进入优先专区', async () => {
  const f=await twoOrderedTasks(fixture()); const [,b]=f.c.getState().tasks; await f.c.start(); await f.c.tick(); f.page(course([section('doc',1,'learning')])); await f.c.tick(); await f.c.moveTask(b.id,0);
  f.page(course([section('doc',1,'completed')])); await f.c.tick(); assert.deepEqual(f.c.getState().tasks[1].done,['c']);
  f.page(course([{...section('doc',1),courseId:'d'}],{courseId:'d',route:'#/study/course/detail/subject-course/d/6/s'})); f.actions.length=0; await f.c.tick();
  assert.equal(f.c.getState().status,'running'); assert.equal(f.c.getState().activeTaskId,b.id); assert.deepEqual(f.actions,['pause',['course','z']]); assert.deepEqual(f.c.getState().tasks[1].done,['c']); f.c.destroy();
});

test('未确认完成或完成后无关页面仍暂停，不借排序接管其他课程', async () => {
  for(const [complete,id,sid] of [[false,'d','s'],[true,'d','other'],[true,'unknown','s']]) {
    const f=await twoOrderedTasks(fixture()); const [,b]=f.c.getState().tasks; await f.c.start(); await f.c.tick(); f.page(course([section('doc',1,complete?'completed':'learning')])); await f.c.tick(); await f.c.moveTask(b.id,0);
    f.page(course([{...section('doc',1),courseId:id}],{courseId:id,subjectId:sid,route:`#/study/course/detail/subject-course/${id}/6/${sid}`})); f.actions.length=0; await f.c.tick();
    assert.equal(f.c.getState().status,'paused'); assert.match(f.c.getState().message,/页面已离开目标课程/u); assert.deepEqual(f.actions,[]); f.c.destroy();
  }
});

test('专题课程已加载但标题缺失或不匹配时，诊断和超时明确原因且不写任务', async () => {
  for (const title of ['', '其他专题']) {
    const f = fixture(); await f.c.search('新专题'); await f.c.tick();
    f.page({ kind: 'search', candidates: [{ id: 's', title: '新专题', route: '#/study/subject/detail/s' }] }); await f.c.tick();
    f.page({ kind: 'subject', title, route: '#/study/subject/detail/s' }); await f.c.tick();
    assert.equal(f.c.getState().status, 'preparing'); assert.equal(f.c.getState().draft, null);
    assert.equal(f.c.diagnose().subjectTitleMatches, false);
    await elapse(f, 31000); assert.equal(f.c.getState().status, 'paused');
    assert.match(f.c.getState().message, title ? /专题标题.*不一致/u : /未识别.*专题标题/u);
    assert.equal(f.shared['wangda-assistant.task'], undefined);
    await f.c.pause();
  }
});

test('初始及刷新绝不动作或覆写共享任务', async () => {
  const f = await ready(fixture()); await f.c.start(); const before = structuredClone(f.shared['wangda-assistant.task']);
  const g = fixture(f.shared); await g.c.tick(); assert.deepEqual(g.actions, []); assert.deepEqual(f.shared['wangda-assistant.task'], before);
  await f.c.pause();
});
test('全部范围不因专题课程卡已完成而跳过课节', async () => {
  const f = await ready(fixture()); await f.c.start(); await f.c.tick(); assert.deepEqual(f.actions[0], ['course', 'c']);
  f.page(course([section()])); await f.c.tick(); assert.equal(f.c.getState().status, 'running'); await f.c.pause();
});
test('暂停取消完成宽限期和未来切节，退出图文学习', async () => {
  const f = await ready(fixture()); f.page(course([section('a', 1, 'completed'), section('b', 1, 'not-started', false)]));
  await f.c.start(); await f.c.tick(); await f.c.pause(); f.advance(7000); await f.c.tick();
  assert.ok(f.actions.includes('pause')); assert.ok(f.actions.includes('leave')); assert.ok(!f.actions.some(x => Array.isArray(x) && x[0] === 'section'));
});
test('平台自动切节宽限期间重新读focus，不重复点击', async () => {
  const f = await ready(fixture()); f.page(course([section('a', 1, 'completed'), section('b', 1, 'not-started', false)]));
  await f.c.start(); await f.c.tick(); await elapse(f, 5000); f.page(course([section('a', 1, 'completed', false), section('b', 1, 'learning')])); await elapse(f, 1000);
  assert.equal(f.c.getState().status, 'running'); assert.ok(!f.actions.some(x => Array.isArray(x) && x[0] === 'section')); await f.c.pause();
});
test('视频ended不能代替平台completed；考试暂停保留页面', async () => {
  const f = await ready(fixture()); f.page(course([section()], { media: { ended: true, paused: true } })); await f.c.start(); await f.c.tick(); await elapse(f, 40000); assert.equal(f.c.getState().status, 'running');
  f.page(course([section('exam', 3)])); await f.c.tick(); assert.equal(f.c.getState().status, 'paused'); assert.ok(!f.actions.includes('leave'));
});
test('pending播放遇窗口终点立即停止，回调不恢复执行', async () => {
  let finish; const f = await ready(fixture({}, { play: () => new Promise(resolve => { finish = resolve; }) }));
  f.page(course([section()], { media: { ended: false, paused: true } })); await f.c.start(); await f.c.tick(); assert.equal(typeof finish, 'function');
  f.advance(14 * 3600000); await f.c.tick(); assert.equal(f.c.getState().status, 'paused'); assert.ok(f.actions.includes('leave')); finish(true); await Promise.resolve(); await f.c.tick(); assert.equal(f.actions.filter(x => x === 'play').length, 1);
});
test('同源双标签只有一个runner，foreign不能修改配置或清单', async () => {
  const f = await ready(fixture()); const g = fixture(f.shared); await f.c.start(); const before = structuredClone(f.shared['wangda-assistant.task']);
  assert.equal(await g.c.start(), false); assert.equal(await g.c.setWindow({ start: '10:00', end: '23:00' }), false); assert.equal(await g.c.collectDraft(), false); assert.deepEqual(f.shared['wangda-assistant.task'], before); await f.c.pause();
});
test('过时tab与owner丢失不能覆写新任务', async () => {
  const f = await ready(fixture()); const g = fixture(f.shared); await f.c.setWindow({ start: '10:00', end: '23:00' });
  const before = structuredClone(f.shared['wangda-assistant.task']); assert.equal(await g.config(), false); assert.deepEqual(f.shared['wangda-assistant.task'], before);
  const h = await ready(fixture()); h.page(course([section('doc', 1)])); await h.c.start(); await h.c.tick();
  h.shared['wangda-assistant.task'] = { ...h.shared['wangda-assistant.task'], taskId: 'new-task', revision: 50 };
  h.shared['wangda-assistant.lease'] = { owner: 'other', taskId: 'new-task', runId: 'other-run', expiresAt: Date.parse('2026-10-10T02:00:10Z') };
  const newTask = structuredClone(h.shared['wangda-assistant.task']); const newLease = structuredClone(h.shared['wangda-assistant.lease']); await h.c.tick();
  assert.equal(h.c.getState().status, 'paused'); assert.deepEqual(h.shared['wangda-assistant.task'], newTask); assert.deepEqual(h.shared['wangda-assistant.lease'], newLease); assert.ok(h.actions.includes('leave'));
});
test('已见playing后被平台暂停不自动重播', async () => {
  const f = await ready(fixture()); f.page(course([section()], { media: { ended: false, paused: false } })); await f.c.start(); await f.c.tick(); f.page({ media: { ended: false, paused: true } }); await f.c.tick(); assert.equal(f.c.getState().status, 'paused'); assert.ok(!f.actions.includes('play')); assert.ok(!f.actions.includes('leave'));
});
test('播放Promise等待时用户暂停，晚到回调无动作', async () => {
  let finish; const f = await ready(fixture({}, { play: () => new Promise(resolve => { finish = resolve; }) })); f.page(course([section()], { media: { ended: false, paused: true } })); await f.c.start(); await f.c.tick(); await f.c.pause(); const before = [...f.actions]; finish(false); await Promise.resolve(); await f.c.tick(); assert.deepEqual(f.actions, before);
});
test('持续暂停的播放请求30秒未settle必须退出，晚到成功或失败均无动作', async () => {
  for (const result of [true, false]) {
    let finish; const f = await ready(fixture({}, { play: () => new Promise(resolve => { finish = resolve; }) }));
    f.page(course([section()], { media: { ended: false, paused: true } })); await f.c.start(); await f.c.tick();
    await elapse(f, 29000); assert.equal(f.c.getState().status, 'running'); assert.ok(!f.actions.includes('leave'));
    await elapse(f, 1000); assert.equal(f.c.getState().status, 'paused'); assert.match(f.c.getState().message, /播放.*超时/u); assert.ok(f.actions.includes('pause')); assert.ok(f.actions.includes('leave'));
    const stopped = [...f.actions]; finish(result); for (let i = 0; i < 5; i += 1) await Promise.resolve(); await f.c.tick(); assert.deepEqual(f.actions, stopped); assert.equal(f.c.getState().status, 'paused');
  }
});
test('播放请求未settle但媒体已playing时长播放不误超时', async () => {
  const f = await ready(fixture({}, { play: () => new Promise(() => {}) }));
  f.page(course([section()], { media: { ended: false, paused: true } })); await f.c.start(); await f.c.tick();
  f.page({ media: { ended: false, paused: false } }); await elapse(f, 600000); assert.equal(f.c.getState().status, 'running'); assert.ok(!f.actions.includes('leave')); assert.equal(f.actions.filter(x => x === 'play').length, 1);
  f.page({ media: { ended: false, paused: true } }); await f.c.tick(); assert.equal(f.c.getState().status, 'paused'); assert.match(f.c.getState().message, /媒体已暂停/u); assert.ok(!f.actions.includes('leave')); await f.c.pause();
});
test('播放成功后快照读取异常必须退出学习页，不能误当原生播放失败', async () => {
  let finish; const f = await ready(fixture({}, { play: () => new Promise(resolve => { finish = resolve; }) }));
  f.page(course([section()], { media: { ended: false, paused: true } })); await f.c.start(); await f.c.tick();
  f.adapter.read = () => { throw Error('snapshot failed'); }; finish(true);
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.equal(f.c.getState().status, 'paused'); assert.ok(f.actions.includes('pause')); assert.ok(f.actions.includes('leave')); assert.match(f.c.getState().message, /页面.*异常/u);
});
test('明确原生播放reject保留当前页供人工播放', async () => {
  const f = await ready(fixture({}, { play: () => Promise.reject(Error('autoplay blocked')) }));
  f.page(course([section()], { media: { ended: false, paused: true } })); await f.c.start(); await f.c.tick();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.equal(f.c.getState().status, 'paused'); assert.ok(f.actions.includes('pause')); assert.ok(!f.actions.includes('leave')); assert.match(f.c.getState().message, /播放失败/u);
});
test('课程完成宽限期只接受已选下一课，不能覆盖用户离开页面', async () => {
  const f = fixture(); f.page({ courses: [...f.page().courses, { id: 'd', title: '选修', required: false, route: '#/study/course/detail/subject-course/d/6/s' }] }); await ready(f);
  f.page(course([section('doc', 1, 'completed')])); await f.c.start(); await f.c.tick(); f.page({ kind: 'home', route: '#/home', courseId: null, subjectId: null }); await f.c.tick();
  assert.equal(f.c.getState().status, 'paused'); assert.ok(!f.actions.some(x => Array.isArray(x) && x[0] === 'course'));
});
test('相同CID但普通课程路由必须导航到所选专题上下文', async () => {
  const f = await ready(fixture()); f.page(course([section('doc', 1)], { route: '#/study/course/detail/c/10', subjectId: null })); await f.c.start(); await f.c.tick(); assert.deepEqual(f.actions[0], ['course', 'c']); await f.c.pause();
});
test('已观察全课节完成后原生跳到已选下一课可以接续', async () => {
  const f = fixture(); f.page({ courses: [...f.page().courses, { id: 'd', title: '选修', required: false, route: '#/study/course/detail/subject-course/d/6/s' }] }); await ready(f);
  f.page(course([section('doc', 1, 'completed')])); await f.c.start(); await f.c.tick(); f.page(course([{ ...section('d-doc', 1), courseId: 'd' }], { courseId: 'd', route: '#/study/course/detail/subject-course/d/6/s' })); await f.c.tick(); await f.c.tick(); assert.equal(f.c.getState().status, 'running'); assert.equal(f.c.getState().currentCourseId, 'd'); assert.ok(!f.actions.some(x => Array.isArray(x) && x[0] === 'course')); await f.c.pause();
});
test('锁不可用、schema无效、写失败均停止且无页面动作', async () => {
  for (const f of [fixture({}, { noLocks: true }), fixture({ 'wangda-assistant.task': { version: 99 } }), fixture({}, { failWrite: true })]) {
    assert.equal(await f.config(), false); assert.equal(await f.c.start(), false); assert.deepEqual(f.actions, []); assert.ok(f.c.getState().message);
  }
});
test('加载和导航有限超时，合法learning不超时', async () => {
  const f = await ready(fixture()); await f.c.start(); await f.c.tick(); await elapse(f, 31000); assert.equal(f.c.getState().status, 'paused'); assert.match(f.c.getState().message, /切换超时/u);
  const g = await ready(fixture()); g.page(course([section('doc', 1)])); await g.c.start(); await g.c.tick(); await elapse(g, 600000); assert.equal(g.c.getState().status, 'running'); await g.c.pause();
});
test('blocked媒体只尝试一次，未知播放器等待后人工暂停', async () => {
  const f = await ready(fixture({}, { play: () => Promise.resolve(false) })); f.page(course([section()], { media: { ended: false, paused: true } })); await f.c.start(); await f.c.tick(); await Promise.resolve(); await f.c.tick(); assert.equal(f.actions.filter(x => x === 'play').length, 1); assert.equal(f.c.getState().status, 'paused'); assert.ok(!f.actions.includes('leave'));
  const g = await ready(fixture()); g.page(course([section()])); await g.c.start(); await g.c.tick(); await elapse(g, 31000); assert.equal(g.c.getState().status, 'paused'); assert.match(g.c.getState().message, /播放器/u);
});
test('混入旧课节或多focus不能宣布完成', async () => {
  const f = await ready(fixture()); f.page(course([section('x', 1, 'completed')], { issues: ['课程页面内容尚未更新：不匹配课节 1 个'] })); await f.c.start(); await f.c.tick(); assert.notEqual(f.c.getState().status, 'complete'); await elapse(f, 31000); assert.equal(f.c.getState().status, 'paused');
});
test('精确唯一专题自动进入，等待匹配横幅；模糊结果等点选', async () => {
  const f = fixture(); await f.config(); await f.c.search('测试专题'); await f.c.tick(); f.page({ kind: 'search', candidates: [{ id: 's', title: '测试专题', route: '#/study/subject/detail/s' }] }); await f.c.tick(); assert.ok(f.actions.some(x => Array.isArray(x) && x[0] === 'subject'));
  f.page({ kind: 'subject', title: '旧专题' }); await f.c.tick(); assert.equal(f.c.getState().tasks.length, 0); await elapse(f, 31000); assert.equal(f.c.getState().status, 'paused');
});

// Queue v2 behaviors supplement the existing runner boundary regression suite.
test('草稿显式添加多个专区，重复专题不覆盖，默认状态预选', async () => {
  const f = fixture(); f.page({ courses: [
    { ...f.page().courses[0], status: 'completed' },
    { ...f.page().courses[0], id: 'd', status: 'learning', required: false, route: '#/study/course/detail/subject-course/d/6/s' },
  ] });
  assert.equal(await f.c.collectDraft(), true); assert.equal(f.c.getState().tasks.length, 0);
  assert.deepEqual(f.c.getState().draft.courses.map(x => x.selected), [false, true]);
  f.c.draftSetSelection('c', true); assert.equal(await f.c.addDraft(), true);
  const first = f.c.getState().tasks[0]; assert.equal(first.scope, 'all');
  await f.c.collectDraft(); assert.equal(await f.c.addDraft(), false); assert.equal(f.c.getState().tasks.length, 1);
  f.page({ subjectId: 's2', title: '第二专题', route: '#/study/subject/detail/s2', courses: [{ id: 'z', title: '课程z', required: true, status: 'not-started', route: '#/study/course/detail/subject-course/z/6/s2' }] });
  await f.c.collectDraft(); await f.c.addDraft(); assert.equal(f.c.getState().tasks.length, 2);
});
test('迁移构造不写入，明确修改才首次写v2并保留旧required', async () => {
  const old = { version: 1, taskId: 'legacy', revision: 1, config: { target: '测试专题', scope: 'required', window: {start:'10:00',end:'23:00'} }, subject: {id:'s',title:'测试专题',route:'#/study/subject/detail/s'}, courses:[{id:'c',title:'课程',route:'#/study/course/detail/subject-course/c/6/s',required:true,selected:true}], done:['c'],current:'c' };
  const f = fixture({'wangda-assistant.task': old}); assert.deepEqual(f.shared['wangda-assistant.task'], old);
  const task = f.c.getState().tasks[0]; assert.equal(task.scope, 'required'); assert.equal(await f.c.setSelection(task.id,'c',false), true);
  assert.equal(f.shared['wangda-assistant.task'].version,2); assert.deepEqual(f.c.getState().tasks[0].done,['c']);
});
test('异常记录可跳过后继续，跳过绝不当作完成，重试清除skip', async () => {
  const f = fixture(); f.page({ courses: [...f.page().courses.map(x => ({...x,status:'learning'})), {id:'d',title:'第二课',route:'#/study/course/detail/subject-course/d/6/s',required:false,status:'not-started'}] }); await ready(f);
  f.page(course([section('exam',3)])); await f.c.start(); await f.c.tick();
  assert.equal(f.c.getState().problem.courseId,'c'); assert.equal(await f.c.skipCurrent(),true);
  const task = f.c.getState().tasks[0]; assert.deepEqual(task.skipped,['c']); assert.deepEqual(task.done,[]);
  f.page(course([{...section('done',1,'completed'),courseId:'d'}],{courseId:'d',route:'#/study/course/detail/subject-course/d/6/s'})); await f.c.tick();
  assert.equal(f.c.getState().status,'paused'); assert.match(f.c.getState().message,/跳过|未完成/u);
  assert.equal(await f.c.retry(task.id,'c'),true); assert.deepEqual(f.c.getState().tasks[0].skipped,[]); await f.c.pause();
});

test('完成第一专区后等待原生宽限，再按顺序进入下一专区；暂停返回当前专题', async () => {
  const f = await ready(fixture());
  f.page({ subjectId:'s2',title:'第二专题',route:'#/study/subject/detail/s2',courses:[{id:'z',title:'第二专题课程',status:'not-started',required:false,route:'#/study/course/detail/subject-course/z/6/s2'}] });
  await f.c.collectDraft(); await f.c.addDraft(); const second = f.c.getState().tasks[1]; f.actions.length=0;
  f.page(course([section('doc',1,'completed')])); await f.c.start(); await f.c.tick();
  await elapse(f,5000); assert.ok(!f.actions.some(x => Array.isArray(x) && x[0]==='course'));
  await elapse(f,1000); assert.deepEqual(f.actions.find(x => Array.isArray(x) && x[0]==='course'),['course','z']); assert.equal(f.c.getState().activeTaskId,second.id);
  f.page(course([{...section('docz',1),courseId:'z'}],{subjectId:'s2',courseId:'z',route:'#/study/course/detail/subject-course/z/6/s2'})); await f.c.tick();
  let destination; f.adapter.leaveLearning = value => { destination=value; }; await f.c.pause(); assert.equal(destination,'#/study/subject/detail/s2');
  assert.deepEqual(f.c.getState().tasks.map(x=>x.done),[['c'],[]]);
});
test('刷新显式导航并等待专题id和横幅一致，保留done/skipped/勾选和其他专区', async () => {
  const f = await ready(fixture()); const first = f.c.getState().tasks[0];
  f.page(course([section('doc',1,'completed')])); await f.c.start(); await f.c.tick(); assert.deepEqual(f.c.getState().tasks[0].done,['c']);
  await f.c.setSelection(first.id,'c',false); f.page({kind:'home',route:'#/home'}); assert.equal(await f.c.refreshTask(first.id),true);
  assert.deepEqual(f.actions.at(-1),['subject','s']);
  f.page({kind:'subject',subjectId:'s',title:'旧专题',route:'#/study/subject/detail/s',courses:[{id:'d',title:'新课程',required:false,status:'learning',route:'#/study/course/detail/subject-course/d/6/s'}]}); await f.c.tick(); assert.equal(f.c.getState().status,'preparing');
  f.page({title:'测试专题'}); await f.c.tick(); const refreshed=f.c.getState().tasks[0];
  assert.equal(f.c.getState().status,'paused'); assert.deepEqual(refreshed.done,['c']); assert.equal(refreshed.courses.find(x=>x.id==='c').status,'unknown'); assert.equal(refreshed.courses.find(x=>x.id==='c').selected,false); assert.equal(refreshed.courses.find(x=>x.id==='d').selected,true);
});
test('运行中所有管理变更被拒绝且保留全部学习记录', async () => {
  const f=await ready(fixture()); const task=f.c.getState().tasks[0]; await f.c.start(); const before=structuredClone(f.shared['wangda-assistant.task']);
  for (const result of [await f.c.collectDraft(),await f.c.setSelection(task.id,'c',false),await f.c.removeTask(task.id),await f.c.refreshTask(task.id),await f.c.setWindow({start:'10:00',end:'22:00'}),await f.c.addDraft(),f.c.discardDraft()]) assert.equal(result,false);
  assert.deepEqual(f.shared['wangda-assistant.task'],before); await f.c.pause();
});
test('指定跳过课程重试优先进入该课程，保留其他done和skip',async()=>{
  const f=await ready(fixture()); const stored=f.shared['wangda-assistant.task']; const first=stored.tasks[0];
  first.courses.push({id:'d',title:'第二课程',route:'#/study/course/detail/subject-course/d/6/s',required:true,status:'unknown',selected:true}); first.skipped=['d'];
  const g=fixture(f.shared); assert.equal(await g.c.retry(first.id,'d'),true); assert.equal(g.c.getState().currentCourseId,'d'); await g.c.pause();
});
test('用户导航到无关课程后自动停止，不暂停或退出无关页面',async()=>{
  const f=await ready(fixture()); f.page(course([section('doc',1)])); await f.c.start(); await f.c.tick(); f.actions.length=0;
  f.page(course([{...section('other',1),courseId:'other'}],{courseId:'other',subjectId:'otherSubject',route:'#/study/course/detail/subject-course/other/6/otherSubject'})); await f.c.tick();
  assert.equal(f.c.getState().status,'paused'); assert.deepEqual(f.actions,[]);
});

test('确认专题、放弃草稿和添加成功均清理上次候选',async()=>{
  const f=fixture(); await f.c.search('测试专题'); await f.c.tick(); f.page({kind:'search',candidates:[{id:'s',title:'测试专题相似',route:'#/study/subject/detail/s'}]}); await f.c.tick(); assert.equal(f.c.getState().candidates.length,1);
  f.c.discardDraft(); assert.deepEqual(f.c.getState().candidates,[]);
  await f.c.search('测试专题'); await f.c.tick(); f.page({kind:'search',candidates:[{id:'s',title:'测试专题',route:'#/study/subject/detail/s'}]}); await f.c.tick();
  f.page({kind:'subject',subjectId:'s',title:'测试专题',route:'#/study/subject/detail/s'}); await f.c.tick(); assert.ok(f.c.getState().draft); assert.deepEqual(f.c.getState().candidates,[]);
  await f.c.addDraft(); assert.deepEqual(f.c.getState().candidates,[]);
});
test('跨专区复用同课程ID时每课正常play一次，旧Promise晚到不会暂停新专区',async()=>{
  let firstFinish; let plays=0;
  const f=await ready(fixture({}, {play:()=>{plays+=1;return plays===1 ? new Promise(resolve=>{firstFinish=resolve;}) : Promise.resolve(true);}}));
  f.page({subjectId:'s2',title:'第二专题',route:'#/study/subject/detail/s2',courses:[{id:'c',title:'相同ID',route:'#/study/course/detail/subject-course/c/6/s2',required:true,status:'learning'}]}); await f.c.collectDraft(); await f.c.addDraft();
  f.page(course([section('v',5)],{media:{paused:true,ended:false}})); await f.c.start(); await f.c.tick(); assert.equal(plays,1);
  f.page(course([section('v',5,'completed')],{media:{paused:false,ended:true}})); await f.c.tick(); await elapse(f,6000);
  f.page(course([section('v',5)],{subjectId:'s2',route:'#/study/course/detail/subject-course/c/6/s2',media:{paused:true,ended:false}})); await f.c.tick();
  assert.equal(plays,2); firstFinish(false); for(let i=0;i<5;i+=1) await Promise.resolve(); assert.equal(f.c.getState().status,'running'); await f.c.pause();
});

test('人工课节异常仍提供当前课节标题以供确认',async()=>{
  const f=await ready(fixture()); f.page(course([{...section('exam',3),title:'课后测试'}])); await f.c.start(); await f.c.tick();
  assert.equal(f.c.getState().currentSectionTitle,'课后测试'); assert.equal(f.c.getState().problem.taskId,f.c.getState().activeTaskId);
});
test('只读搜索和草稿不升级v1；过时标签首次升级不得覆盖新revision',async()=>{
  const old={version:1,taskId:'legacy',revision:2,config:{target:'测试专题',scope:'required',window:{start:'09:00',end:'24:00'}},subject:{id:'s',title:'测试专题',route:'#/study/subject/detail/s'},courses:[{id:'c',title:'课程',route:'#/study/course/detail/subject-course/c/6/s',required:true,selected:true}],done:[],current:null};
  const f=fixture({'wangda-assistant.task':old}); await f.c.collectDraft(); assert.deepEqual(f.shared['wangda-assistant.task'],old); f.c.discardDraft();
  await f.c.search('测试专题'); await f.c.pause(); assert.deepEqual(f.shared['wangda-assistant.task'],old);
  const g=fixture(f.shared); await f.c.setWindow({start:'10:00',end:'23:00'}); const before=structuredClone(f.shared['wangda-assistant.task']);
  assert.equal(await g.c.setSelection('legacy','c',false),false); assert.deepEqual(f.shared['wangda-assistant.task'],before);
});
test('刷新和改勾选保留跳过记录与其他专区，删除只移除指定任务',async()=>{
  const f=await ready(fixture()); const id=f.c.getState().tasks[0].id; f.page(course([section('exam',3)])); await f.c.start(); await f.c.tick(); await f.c.skipCurrent();
  f.page({kind:'subject',subjectId:'s2',title:'第二专题',route:'#/study/subject/detail/s2',courses:[{id:'z',title:'第二课',status:'learning',required:false,route:'#/study/course/detail/subject-course/z/6/s2'}]}); await f.c.collectDraft(); await f.c.addDraft(); const before=structuredClone(f.c.getState().tasks[1]);
  await f.c.setSelection(id,'c',false); await f.c.refreshTask(id); f.page({kind:'subject',subjectId:'s',title:'测试专题',route:'#/study/subject/detail/s',courses:[{id:'c',title:'课程',status:'unknown',required:true,route:'#/study/course/detail/subject-course/c/6/s'}]}); await f.c.tick();
  assert.deepEqual(f.c.getState().tasks[0].skipped,['c']); assert.equal(f.c.getState().tasks[0].courses[0].selected,false); assert.deepEqual(f.c.getState().tasks[1],before);
  assert.equal(await f.c.removeTask(id),true); assert.deepEqual(f.c.getState().tasks,[before]); assert.equal(f.c.getState().activeTaskId,before.id);
});

test('旧required任务保留选修勾选但兼容原执行范围',async()=>{
  const old={version:1,taskId:'legacy',revision:2,config:{target:'测试专题',scope:'required',window:{start:'09:00',end:'24:00'}},subject:{id:'s',title:'测试专题',route:'#/study/subject/detail/s'},courses:[{id:'optional',title:'选修',route:'#/study/course/detail/subject-course/optional/6/s',required:false,selected:true},{id:'c',title:'必修',route:'#/study/course/detail/subject-course/c/6/s',required:true,selected:true}],done:[],current:null};
  const f=fixture({'wangda-assistant.task':old}); assert.equal(f.c.getState().tasks[0].courses[0].selected,true); await f.c.start(); assert.equal(f.c.getState().currentCourseId,'c'); await f.c.pause();
});

test('第二专区运行中手动返回已完成第一专区，不暂停旧current对应的页面', async () => {
  const f = await ready(fixture());
  f.page({ subjectId: 's2', title: '第二专题', route: '#/study/subject/detail/s2', courses: [{ id: 'z', title: '第二课程', required: true, status: 'learning', route: '#/study/course/detail/subject-course/z/6/s2' }] });
  await f.c.collectDraft(); await f.c.addDraft(); const secondId = f.c.getState().tasks[1].id;
  f.page(course([section('done', 1, 'completed')])); await f.c.start(); await f.c.tick(); await elapse(f, 6000);
  f.page(course([{ ...section('z-doc', 1), courseId: 'z' }], { subjectId: 's2', courseId: 'z', route: '#/study/course/detail/subject-course/z/6/s2' })); await f.c.tick();
  assert.equal(f.c.getState().activeTaskId, secondId); assert.equal(f.c.getState().tasks[0].current, 'c'); assert.deepEqual(f.c.getState().tasks[0].done, ['c']);
  f.actions.length = 0; f.page(course([section('done', 1, 'completed')])); await f.c.tick();
  assert.equal(f.c.getState().status, 'paused'); assert.deepEqual(f.actions, []);
});

test('最后一门人工或H5课节显式跳过时退出对应学习页，仍保持未完成', async () => {
  for (const type of [3, 4]) {
    const f = await ready(fixture()); f.page(course([section('manual', type)]));
    f.adapter.leaveLearning = route => { f.actions.push(['leave', route]); f.page({ kind: 'subject', route, courseId: null, subjectId: 's' }); return true; };
    await f.c.start(); await f.c.tick(); assert.equal(f.c.getState().status, 'paused'); assert.equal(f.page().kind, 'course');
    f.actions.length = 0; assert.equal(await f.c.skipCurrent(), true);
    assert.equal(f.page().kind, 'subject'); assert.ok(f.actions.includes('pause')); assert.deepEqual(f.actions.at(-1), ['leave', '#/study/subject/detail/s']);
    assert.equal(f.c.getState().status, 'paused'); assert.deepEqual(f.c.getState().tasks[0].done, []); assert.deepEqual(f.c.getState().tasks[0].skipped, ['c']); assert.match(f.c.getState().message, /未完成/u);
  }
});
test('跳过异常课程先退出该学习页，再接续下一门课程', async () => {
  const f = fixture(); f.page({ courses: [...f.page().courses, { id: 'd', title: '下一门', route: '#/study/course/detail/subject-course/d/6/s', required: false, status: 'learning' }] }); await ready(f);
  f.adapter.leaveLearning = route => { f.actions.push(['leave', route]); f.page({ kind: 'subject', route, courseId: null }); return true; };
  f.page(course([section('manual', 3)])); await f.c.start(); await f.c.tick(); f.actions.length = 0;
  assert.equal(await f.c.skipCurrent(), true); assert.ok(f.actions.includes('pause')); assert.deepEqual(f.actions.find(item => Array.isArray(item) && item[0] === 'leave'), ['leave', '#/study/subject/detail/s']);
  assert.equal(f.c.getState().status, 'running'); assert.equal(f.c.getState().currentCourseId, 'd'); await f.c.tick(); assert.deepEqual(f.actions.at(-1), ['course', 'd']);
  assert.deepEqual(f.c.getState().tasks[0].done, []); assert.deepEqual(f.c.getState().tasks[0].skipped, ['c']); await f.c.pause();
});
test('异常后用户已离开problem学习页，跳过不停止或退出无关页面', async () => {
  const f = await ready(fixture()); f.page(course([section('manual', 3)])); await f.c.start(); await f.c.tick();
  f.page(course([{ ...section('other', 5), courseId: 'other' }], { courseId: 'other', subjectId: 'otherSubject', route: '#/study/course/detail/subject-course/other/6/otherSubject', media: { paused: false, ended: false } }));
  f.actions.length = 0; assert.equal(await f.c.skipCurrent(), true); assert.deepEqual(f.actions, []); assert.equal(f.page().courseId, 'other');
  assert.equal(f.c.getState().status, 'paused'); assert.deepEqual(f.c.getState().tasks[0].done, []); assert.deepEqual(f.c.getState().tasks[0].skipped, ['c']);
});

test('跳过时读取或退出失败保持暂停并提示人工确认，不继续下一门', async () => {
  for (const failure of ['read', 'pause', 'leave', 'leave-false']) {
    const f = fixture(); f.page({ courses: [...f.page().courses, { id: 'd', title: '下一门', route: '#/study/course/detail/subject-course/d/6/s', required: true, status: 'learning' }] }); await ready(f);
    f.page(course([section('manual', 3)])); await f.c.start(); await f.c.tick(); f.actions.length = 0;
    if (failure === 'read') f.adapter.read = () => { throw Error('snapshot unavailable'); };
    if (failure === 'pause') f.adapter.pauseMedia = () => { throw Error('pause failed'); };
    if (failure === 'leave') f.adapter.leaveLearning = () => { throw Error('navigation failed'); };
    if (failure === 'leave-false') f.adapter.leaveLearning = () => false;
    assert.equal(await f.c.skipCurrent(), false); await f.c.tick();
    assert.equal(f.c.getState().status, 'paused'); assert.equal(f.c.getState().currentCourseId, 'c'); assert.match(f.c.getState().message, /未能|手动退出/u);
    assert.ok(!f.actions.some(action => Array.isArray(action) && action[0] === 'course'));
    if (failure === 'read') assert.deepEqual(f.actions, []);
    assert.deepEqual(f.c.getState().tasks[0].done, []); assert.deepEqual(f.c.getState().tasks[0].skipped, ['c']);
  }
});

test('全部完成后添加第二专区有待学课程时回到暂停，需手动开始', async () => {
  const f = await ready(fixture()); f.page(course([section('done', 1, 'completed')])); await f.c.start(); await f.c.tick(); assert.equal(f.c.getState().status, 'complete');
  f.page({ kind: 'subject', subjectId: 's2', title: '第二专题', route: '#/study/subject/detail/s2', courses: [{ id: 'z', title: '待学课', required: false, status: 'learning', route: '#/study/course/detail/subject-course/z/6/s2' }] });
  f.actions.length = 0; await f.c.collectDraft(); await f.c.addDraft();
  assert.equal(f.c.getState().status, 'paused'); assert.match(f.c.getState().message, /待学|待.*课程/u); assert.match(f.c.getState().message, /手动.*开始/u); assert.deepEqual(f.actions, []);
});
test('全部完成后勾选原未学课程时回到暂停，需手动开始', async () => {
  const f = fixture(); f.page({ courses: [...f.page().courses, { id: 'd', title: '未选课程', required: true, status: 'learning', route: '#/study/course/detail/subject-course/d/6/s' }] }); await ready(f);
  const id = f.c.getState().tasks[0].id; await f.c.setSelection(id, 'd', false);
  f.page(course([section('done', 1, 'completed')])); await f.c.start(); await f.c.tick(); assert.equal(f.c.getState().status, 'complete');
  f.actions.length = 0; assert.equal(await f.c.setSelection(id, 'd', true), true);
  assert.equal(f.c.getState().status, 'paused'); assert.match(f.c.getState().message, /待学|待.*课程/u); assert.match(f.c.getState().message, /手动.*开始/u); assert.deepEqual(f.actions, []);
});
test('全部完成后刷新发现新增待学课程时保持暂停并提示手动开始', async () => {
  const f = await ready(fixture()); const id = f.c.getState().tasks[0].id;
  f.page(course([section('done', 1, 'completed')])); await f.c.start(); await f.c.tick(); assert.equal(f.c.getState().status, 'complete');
  f.actions.length = 0; assert.equal(await f.c.refreshTask(id), true); assert.deepEqual(f.actions, [['subject', 's']]); f.actions.length = 0;
  f.page({ kind: 'subject', subjectId: 's', title: '测试专题', route: '#/study/subject/detail/s', courses: [...f.c.getState().tasks[0].courses, { id: 'd', title: '新增课程', required: false, status: 'learning', route: '#/study/course/detail/subject-course/d/6/s' }] }); await f.c.tick();
  assert.equal(f.c.getState().status, 'paused'); assert.match(f.c.getState().message, /待学|待.*课程/u); assert.match(f.c.getState().message, /手动.*开始/u); assert.deepEqual(f.actions, []);
});
test('全部完成后仅修改时间窗口且无待学课程，保留完成状态', async () => {
  const f = await ready(fixture()); f.page(course([section('done', 1, 'completed')])); await f.c.start(); await f.c.tick(); f.actions.length = 0;
  assert.equal(await f.c.setWindow({ start: '10:00', end: '23:00' }), true); assert.equal(f.c.getState().status, 'complete'); assert.deepEqual(f.actions, []);
});

test('人工暂停后点击暂停，不操作无关CID、同CID错专区或普通课程路由', async () => {
  for (const page of [
    { courseId: 'other', subjectId: 'otherSubject', route: '#/study/course/detail/subject-course/other/6/otherSubject' },
    { courseId: 'c', subjectId: 'otherSubject', route: '#/study/course/detail/subject-course/c/6/otherSubject' },
    { courseId: 'c', subjectId: null, route: '#/study/course/detail/c/10' },
  ]) {
    const f = await ready(fixture()); f.page(course([section('exam', 3)])); await f.c.start(); await f.c.tick(); assert.equal(f.c.getState().status, 'paused');
    f.page(course([section('other', 5)], { ...page, media: { paused: false, ended: false } })); f.actions.length = 0;
    assert.equal(await f.c.pause(), true); assert.deepEqual(f.actions, []); assert.equal(f.page().route, page.route);
  }
});
test('初始无task点击暂停不触碰当前无关课程，快照异常也不凭空操作', async () => {
  for (const throwSnapshot of [false, true]) {
    const f = fixture(); f.page(course([section('unrelated', 5)], { media: { paused: false, ended: false } }));
    if (throwSnapshot) f.adapter.read = () => { throw Error('snapshot unavailable'); };
    assert.equal(await f.c.pause(), true); assert.deepEqual(f.actions, []); assert.equal(f.c.getState().status, 'paused');
  }
});
test('preparing点击暂停只取消准备，即使当前仍显示先前已控课程也不操作页面', async () => {
  const f = await ready(fixture()); f.page(course([section('exam', 3)])); await f.c.start(); await f.c.tick();
  await f.c.search('第二专题'); assert.equal(f.c.getState().status, 'preparing');
  f.page(course([section('exam', 3)])); f.actions.length = 0; assert.equal(await f.c.pause(), true);
  assert.equal(f.c.getState().status, 'paused'); assert.deepEqual(f.actions, []); await f.c.tick(); assert.deepEqual(f.actions, []);
  for (let i = 0; i < 5; i += 1) await Promise.resolve(); assert.equal(f.shared.locked, false);
});
test('人工暂停保留的同归属学习页可通过显式暂停退出', async () => {
  const f = await ready(fixture()); f.page(course([section('exam', 3)])); await f.c.start(); await f.c.tick(); assert.ok(!f.actions.includes('leave'));
  let destination; f.adapter.leaveLearning = route => { destination = route; f.actions.push('leave'); return true; }; f.actions.length = 0;
  assert.equal(await f.c.pause(), true); assert.deepEqual(f.actions, ['pause', 'leave']); assert.equal(destination, '#/study/subject/detail/s');
});
test('已知活动任务暂停后快照失败，显式暂停仍停止最后已控学习页', async () => {
  const f = await ready(fixture()); f.page(course([section('exam', 3)])); await f.c.start(); await f.c.tick(); f.actions.length = 0;
  f.adapter.read = () => { throw Error('snapshot unavailable'); }; assert.equal(await f.c.pause(), true); assert.deepEqual(f.actions, ['pause', 'leave']);
});
