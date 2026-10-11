import test from 'node:test';
import assert from 'node:assert/strict';
const { normalizeQueue = () => assert.fail('v2队列尚未实现'), mergeCourses = () => assert.fail('课程合并尚未实现') } = await import('../src/queue.js').catch(() => ({}));
const courses = ['completed', 'learning', 'not-started', 'unknown'].map((status, i) => ({ id: `c${i}`, title: `课程${i}`, route: `#/study/course/detail/subject-course/c${i}/6/s`, required: false, status }));
const legacy = () => ({ version: 1, taskId: 'old', revision: 3, config: { target: '专题', scope: 'required', window: { start: '10:00', end: '23:00' } }, subject: { id: 's', title: '专题', route: '#/study/subject/detail/s' }, courses: [{ ...courses[0], selected: true }], done: ['c0'], current: 'c0' });

test('旧任务不默认自动执行，自动设置和待处理原因独立保存且严格验证', () => {
  const input=normalizeQueue(legacy());
  assert.deepEqual(input.automation,{enabled:false,resumeOnReload:false}); assert.equal(input.runRequested,false); assert.deepEqual(input.tasks[0].deferred,[]);
  input.tasks[0].done=[]; input.tasks[0].deferred=[{courseId:'c0',reason:'需答题',cookie:'secret'}]; input.automation={enabled:true,resumeOnReload:true,extra:'secret'}; input.runRequested=true;
  const output=normalizeQueue(input); assert.deepEqual(output.tasks[0].deferred,[{courseId:'c0',reason:'需答题'}]); assert.equal(output.automation.extra,undefined);
  for (const patch of [{courseId:'missing',reason:'错误'},{courseId:'c0',reason:42}]) { const bad=structuredClone(input); bad.tasks[0].deferred=[patch]; assert.throws(()=>normalizeQueue(bad)); }
  const bad=structuredClone(input); bad.automation.enabled='true'; assert.throws(()=>normalizeQueue(bad));
});
test('卡片完成/未知默认不选，学习中和未开始含选修默认选择', () => {
  assert.deepEqual(mergeCourses([], courses).map(x => x.selected), [false, true, true, false]);
});
test('刷新保留已选状态，丢失条目标记未知并保留身份', () => {
  const old = mergeCourses([], courses); old[0].selected = true;
  const merged = mergeCourses(old, courses.slice(1));
  assert.equal(merged.find(x => x.id === 'c0').selected, true);
  assert.equal(merged.find(x => x.id === 'c0').status, 'unknown');
});
test('v1只读迁移保留窗口、scope、勾选、done/current且不修改输入', () => {
  const input = legacy(), before = structuredClone(input), result = normalizeQueue(input);
  assert.equal(result.version, 2); assert.equal(result.revision, 3); assert.equal(result.tasks[0].scope, 'required');
  assert.deepEqual(result.window, input.config.window); assert.deepEqual(result.tasks[0].done, ['c0']); assert.equal(result.tasks[0].current, 'c0'); assert.equal(result.tasks[0].courses[0].selected, true); assert.deepEqual(input, before);
});
test('损坏和未知版本拒绝，空存储归一化为空', () => {
  assert.equal(normalizeQueue(null), null);
  for (const input of [{version: 99}, {...legacy(), done: [1]}, {...legacy(), revision: 0}]) assert.throws(() => normalizeQueue(input));
});

test('v1和v2都拒绝非字符串ID，并在迁移时剥离额外字段', () => {
  for (const id of [undefined, null, 123]) {
    const input = legacy(); input.subject.id = id; input.subject.route = `#/study/subject/detail/${id}`; input.courses[0].route = `#/study/course/detail/subject-course/c0/6/${id}`;
    assert.throws(() => normalizeQueue(input));
  }
  const input = legacy(); input.subject.cookie = 'secret'; input.courses[0].token = 'secret';
  const result = normalizeQueue(input); assert.equal(result.tasks[0].subject.cookie, undefined); assert.equal(result.tasks[0].courses[0].token, undefined);
  const v2 = normalizeQueue(legacy()); v2.tasks[0].courses[0].id = 123; v2.tasks[0].courses[0].route = '#/study/course/detail/subject-course/123/6/s'; v2.tasks[0].done = []; v2.tasks[0].current = null;
  assert.throws(() => normalizeQueue(v2));
});
