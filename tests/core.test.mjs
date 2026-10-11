import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotice, normalizeTitle, isWithinWindow, chooseNextSection, decideLearningAction } from '../src/core.js';

// 合成通知，保留解析边界，不包含真实单位的通知内容。
const notice = `@所有人
网上大学：示例专区 办公协作全部课程
学习路径：中移网大→示例专区 办公协作
参加人员：测试人员
学习时段：早9:00—晚12:00。`;
const running = { status: 'running', scope: 'all', window: { start: '09:00', end: '24:00' } };
const section = (id, changes = {}) => ({ id, courseId: 'course-1', type: 6, status: 'not-started', required: true, active: false, ...changes });
const course = (sections, extra = {}) => ({ kind: 'course', sections, activeSectionId: null, media: null, ...extra });

test('解析合成通知的目标、全部范围与早九至晚十二', () => {
  assert.deepEqual(parseNotice(notice), {
    target: '示例专区 办公协作', scope: 'all', window: { start: '09:00', end: '24:00' }, warnings: [], valid: true,
  });
});

test('路径目标优先于网上大学行，并移除导航与范围尾缀', () => {
  assert.equal(parseNotice('网上大学：旧名称全部课程\n学习路径：中移网大→学习中心→新专题专区→全部课程\n时间：09:00-21:00').target, '新专题专区');
});

test('无路径时可从网上大学行提取名称', () => {
  const result = parseNotice('网上大学：信息安全专区全部课程\n参加人员：全体人员\n时间：9:00—21:00');
  assert.equal(result.target, '信息安全专区');
  assert.equal(result.valid, true);
});

test('首行课程名称可去掉学习和范围尾缀', () => {
  assert.equal(parseNotice('信息安全专区全部课程学习\n参加人员：全体人员\n时间：早9点至晚9点').target, '信息安全专区');
});

test('仅参加人员和学习要求不能捏造课程目标', () => {
  const result = parseNotice('@所有人\n参加人员：全体人员\n要求：完成全部课程学习');
  assert.equal(result.target, '');
  assert.equal(result.valid, false);
  assert.ok(result.warnings.length > 0);
});

test('模糊标题不能当作课程目标', () => {
  for (const text of ['', '学习通知\n请大家按时学习', '关于开展学习的通知\n参加人员：全体人员']) {
    assert.equal(parseNotice(text).valid, false);
    assert.equal(parseNotice(text).target, '');
  }
});

test('必修范围通过明确正向要求识别', () => {
  assert.equal(parseNotice('网上大学：信息安全专区\n要求：只学习必修课程\n时间：09:00-21:00').scope, 'required');
});

test('否定必修和否定全部不会被当作正向范围', () => {
  assert.equal(parseNotice('网上大学：信息安全专区全部课程\n要求：不限必修课程\n时间：09:00-21:00').scope, 'all');
  assert.equal(parseNotice('网上大学：信息安全专区\n要求：不是全部课程，只学习必修课程\n时间：09:00-21:00').scope, 'required');
  assert.equal(parseNotice('网上大学：信息安全专区\n要求：非必修课程也要学习\n时间：09:00-21:00').scope, 'all');
});

test('明确否定的名称不能成为目标', () => {
  const result = parseNotice('网上大学：不要学习“旧课程”\n参加人员：全体人员\n时间：09:00-21:00');
  assert.equal(result.valid, false);
  assert.equal(result.target, '');
});

test('网上大学字段只写通用学习要求时仍须补充目标', () => {
  for (const text of ['网上大学：请学习全部课程', '网上大学：完成全部课程学习', '网上大学：开展课程学习']) {
    assert.equal(parseNotice(text).target, '');
    assert.equal(parseNotice(text).valid, false);
  }
});

test('无需完成或不需要学习必修的否定表述不切换到必修范围', () => {
  for (const requirement of ['无需完成必修课程', '不需要学习必修课程', '不要求只学习必修课程']) {
    assert.equal(parseNotice(`网上大学：信息安全专区\n要求：${requirement}`).scope, 'all');
  }
});

test('缺少时间使用可见默认窗口并告知用户', () => {
  const result = parseNotice('网上大学：信息安全专区全部课程');
  assert.deepEqual(result.window, { start: '09:00', end: '24:00' });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(message => /时间|时段/.test(message)));
});

test('中文时间区分晚九、午十二和晚十二', () => {
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：上午9:30至晚上9:15').window, { start: '09:30', end: '21:15' });
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：早9点到中午12点').window, { start: '09:00', end: '12:00' });
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：晚上9点到次日凌晨2点').window, { start: '21:00', end: '02:00' });
});

test('下午结束时间省略时段时继承下午，不能误放行晚间和凌晨', () => {
  const result = parseNotice('网上大学：安全课程\n时间：下午2点到5点');
  assert.equal(result.valid, true);
  assert.deepEqual(result.window, { start: '14:00', end: '17:00' });
  assert.equal(isWithinWindow(new Date('2026-10-10T12:00:00Z'), result.window), false);
  assert.equal(isWithinWindow(new Date('2026-10-10T17:00:00Z'), result.window), false);
});

test('早九至十二的结束时间继承早间而不变成午夜', () => {
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：早9至12').window, { start: '09:00', end: '12:00' });
});

test('晚九到十二的结束时间继承晚间并使用24:00终点', () => {
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：晚9到12').window, { start: '21:00', end: '24:00' });
});

test('显式结束时段优先且24小时制不额外加十二', () => {
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：晚上9点到次日凌晨2点').window, { start: '21:00', end: '02:00' });
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：下午2点到次日凌晨5点').window, { start: '14:00', end: '05:00' });
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：09:00—17:00').window, { start: '09:00', end: '17:00' });
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：21:00-02:00').window, { start: '21:00', end: '02:00' });
});

test('显式次日结束时间不继承起点的下午时段', () => {
  assert.deepEqual(parseNotice('网上大学：安全课程\n时间：下午2点到次日5点').window, { start: '14:00', end: '05:00' });
});

test('明确但无效的时间不能悄悄采用默认窗口', () => {
  const result = parseNotice('网上大学：安全课程\n时间：25:00-26:00');
  assert.equal(result.valid, false);
  assert.ok(result.warnings.some(message => /时间|时段/.test(message)));
});

test('显式单个小时缺少结束时间时应要求补全', () => {
  const result = parseNotice('网上大学：安全课程\n时间：9点');
  assert.equal(result.valid, false);
  assert.ok(result.warnings.some(message => /时间|时段/.test(message)));
});

test('无法解析的超范围中文小时不能退回有效默认时间', () => {
  const result = parseNotice('网上大学：安全课程\n时间：99点到100点');
  assert.equal(result.valid, false);
  assert.ok(result.warnings.some(message => /时间|时段/.test(message)));
});

test('标题匹配统一全半角、大小写和标点但保留有意义词', () => {
  assert.equal(normalizeTitle(' “ＡＩ 智联：人机协作！” '), 'ai智联人机协作');
  assert.notEqual(normalizeTitle('安全生产必修课程'), normalizeTitle('安全生产课程'));
  assert.notEqual(normalizeTitle('非必修课程'), normalizeTitle('必修课程'));
  assert.equal(normalizeTitle(null), '');
});

test('北京时间窗口起点包含、终点排除，独立于主机时区', () => {
  const window = { start: '09:00', end: '21:00' };
  assert.equal(isWithinWindow(new Date('2026-10-10T00:59:59Z'), window), false);
  assert.equal(isWithinWindow(new Date('2026-10-10T01:00:00Z'), window), true);
  assert.equal(isWithinWindow(new Date('2026-10-10T12:59:59Z'), window), true);
  assert.equal(isWithinWindow(new Date('2026-10-10T13:00:00Z'), window), false);
});

test('24:00为当日排除终点，午夜不能误判为前一天窗口', () => {
  const window = { start: '09:00', end: '24:00' };
  assert.equal(isWithinWindow(new Date('2026-10-10T15:59:59Z'), window), true);
  assert.equal(isWithinWindow(new Date('2026-10-10T16:00:00Z'), window), false);
});

test('跨午夜窗口同时覆盖晚上与凌晨并排除终点', () => {
  const window = { start: '21:00', end: '02:00' };
  assert.equal(isWithinWindow(new Date('2026-10-10T13:00:00Z'), window), true);
  assert.equal(isWithinWindow(new Date('2026-10-10T17:59:59Z'), window), true);
  assert.equal(isWithinWindow(new Date('2026-10-10T18:00:00Z'), window), false);
  assert.equal(isWithinWindow(new Date('2026-10-10T04:00:00Z'), window), false);
});

test('无效日期和时间窗口不会放行', () => {
  assert.equal(isWithinWindow(new Date('invalid'), { start: '09:00', end: '24:00' }), false);
  assert.equal(isWithinWindow(new Date('2026-10-10T01:00:00Z'), { start: '25:00', end: '26:00' }), false);
  assert.equal(isWithinWindow(new Date('2026-10-10T01:00:00Z'), { start: '09:00', end: '09:00' }), false);
});

test('选择首个未完成课节并保留未知状态，不能只看活动课节后方', () => {
  const sections = [section('done', { status: 'completed' }), section('unknown', { status: 'unknown' }), section('later')];
  assert.equal(chooseNextSection(sections, 'all').id, 'unknown');
  assert.equal(chooseNextSection([], 'all'), null);
});

test('全部范围不能用必修完成率替代，必修范围只选择必修', () => {
  const sections = [section('optional', { required: false }), section('required', { status: 'completed' })];
  assert.equal(chooseNextSection(sections, 'all').id, 'optional');
  assert.equal(chooseNextSection(sections, 'required'), null);
});

test('无任务、暂停和空闲状态均无操作', () => {
  for (const task of [null, {}, { status: 'paused' }, { status: 'idle' }]) {
    assert.equal(decideLearningAction(course([section('first')]), task).type, 'idle');
  }
});

test('没有课节先等待页面识别，不能宣告完成', () => {
  assert.equal(decideLearningAction(course([]), running).type, 'wait');
});

test('活动课节未完成时始终等待平台状态，包括视频已结束', () => {
  const sections = [section('active', { status: 'learning', active: true }), section('next')];
  assert.equal(decideLearningAction(course(sections, { activeSectionId: 'active', media: { ended: true, paused: true } }), running).type, 'wait');
  assert.equal(decideLearningAction(course(sections, { media: { ended: false, paused: true } }), running).type, 'wait');
});

test('活动课节完成后回到前面漏学的课节', () => {
  const sections = [section('missed'), section('active', { status: 'completed' }), section('later')];
  const result = decideLearningAction(course(sections, { activeSectionId: 'active' }), running);
  assert.equal(result.type, 'select-section');
  assert.equal(result.sectionId, 'missed');
});

test('未知活动状态保持等待，不得跳过', () => {
  const sections = [section('unknown', { status: 'unknown', active: true }), section('later')];
  assert.equal(decideLearningAction(course(sections), running).type, 'wait');
});

test('未知目标状态等待确认后再选课节', () => {
  assert.equal(decideLearningAction(course([section('unknown', { status: 'unknown' })]), running).type, 'wait');
});

test('考试、作业、URL、H5和未知类型要求人工处理', () => {
  for (const type of [9, 18, 21, 8, 3, 4, 999, null]) {
    const result = decideLearningAction(course([section('manual', { type })]), running);
    assert.equal(result.type, 'manual', `type ${type}`);
    assert.equal(result.sectionId, 'manual');
  }
});

test('当前未完成考试同样要求人工处理', () => {
  assert.equal(decideLearningAction(course([section('exam', { type: 9, status: 'learning', active: true })]), running).type, 'manual');
});

test('受支持的资源类型可被选择', () => {
  for (const type of [1, 2, 5, 6, 7, 20]) {
    assert.deepEqual(decideLearningAction(course([section('resource', { type })]), running), { type: 'select-section', sectionId: 'resource' });
  }
});

test('必修范围中的人工课节不能自动跳过', () => {
  const sections = [section('exam', { type: 9 }), section('required-video')];
  assert.equal(decideLearningAction(course(sections), { ...running, scope: 'required' }).type, 'manual');
});

test('当前选修课不阻挡必修任务选择目标', () => {
  const sections = [section('optional', { required: false, status: 'learning', active: true }), section('required-video')];
  assert.equal(decideLearningAction(course(sections), { ...running, scope: 'required' }).sectionId, 'required-video');
});

test('只有目标范围课节全部completed才能完成课程', () => {
  const sections = [section('required', { status: 'completed' }), section('optional', { required: false })];
  assert.equal(decideLearningAction(course(sections), running).type, 'select-section');
  assert.equal(decideLearningAction(course(sections), { ...running, scope: 'required' }).type, 'course-complete');
  assert.equal(decideLearningAction(course(sections.map(item => ({ ...item, status: 'completed' }))), running).type, 'course-complete');
});

test('课程以外页面不进行课节操作，登录页提示人工', () => {
  for (const kind of ['subject', 'search', 'home', 'unknown']) {
    assert.equal(decideLearningAction({ kind, sections: [section('first')] }, running).type, 'wait');
  }
  assert.equal(decideLearningAction({ kind: 'login' }, running).type, 'manual');
});
