import test from 'node:test';
import assert from 'node:assert/strict';

test('互斥学习错误页按路由识别，不混同一般未知页', async () => {
  const { readPage }=await import('../src/adapter.js');
  const { JSDOM }=await import('jsdom'); const dom=new JSDOM('<body></body>');
  const page=readPage(dom.window.document,'#/study/errors/a-b&1');
  assert.equal(page.kind,'study-error'); assert.equal(page.courseId,'a-b'); assert.equal(page.errorCode,'1');
  assert.equal(readPage(dom.window.document,'#/study/errors/a-b&2').errorCode,'2');
  assert.equal(readPage(dom.window.document,'#/study/errors/../../x&1').kind,'unknown'); dom.window.close();
});

test('适配器提供浏览器离线状态，不主动发起网络探测', async () => {
  const { createAdapter }=await import('../src/adapter.js'); const { JSDOM }=await import('jsdom'); const dom=new JSDOM('<body></body>',{url:'https://wangda.chinamobile.com/#/home'});
  Object.defineProperty(dom.window.navigator,'onLine',{value:false}); assert.equal(createAdapter(dom.window).read().online,false); dom.window.close();
});
import { JSDOM } from 'jsdom';
import { readPage, createAdapter } from '../src/adapter.js';

const sid = 'e95b6adc-74da-40cc-a0d0-cdc0e4c393a2';
const subjectRoute = `#/study/subject/detail/${sid}`;
const courseRoute = `#/study/course/detail/subject-course/course-1/6/${sid}`;
const dom = (html = '', hash = courseRoute) => new JSDOM(html, { url: `https://wangda.chinamobile.com/${hash}` });
const section = (id, options = {}) => `<dl class="required ${options.active ? 'focus' : ''}" id="${options.prefix || 'D597'}show-sections${id}" data-sectionType="${options.type || 2}" data-resourceId="resource-${id}" data-courseId="${options.courseId || 'course-1'}"><dt>${options.optional ? '<span class="required-tag">选修</span>' : ''}<span class="qcontent" title="01:课节${id}">截断标题</span></dt><dd><div class="item ${options.status === '已完成' ? 'continue' : 'start'} pointer"><span>${options.status || '未开始'}</span></div><div class="tips-text">该课程已完成</div></dd></dl>`;
const chapters = (html) => `<div class="course-side-title-row"><span class="text-overflow">课程标题</span></div><div class="chapter-list chapter-all"><ul><li><div class="list-title" id="Drizzle42list-item-1">章节</div><div class="hidden">${html}</div></li></ul></div>`;
const card = (id, options = {}) => `<li><div class="content new"><div class="img course-item"><div class="img-cont" id="D99studyBtn-${id}" data-resource-id="${id}" data-section-type="${options.type || 10}"></div><a class="btn" id="DrizzlestudyBtns-${id}" data-resource-id="${id}" data-section-type="${options.type || 10}"></a><div class="study-status not-start">${options.status || '未开始'}</div></div><span class="title" title="${options.title || '课程名称'}">截断</span><span class="cont-class-type">${options.optional ? '选修' : '必修'}</span></div></li>`;
const result = (id, type) => `<div id="D42openDetail-${id}"><div class="search-page-title" title="候选${type}">截断</div><div class="special-box"><div class="section-left"><span>${type}</span></div></div></div>`;

test('专题重复控件按课程ID去重并保留专题路由上下文', () => {
  const page = readPage(dom(`<ul>${card('course-1')}${card('course-1')}${card('course-2', { optional: true, status: '已完成' })}</ul>`, subjectRoute).window.document, subjectRoute);
  assert.equal(page.kind, 'subject');
  assert.equal(page.subjectId, sid);
  assert.deepEqual(page.courses, [
    { id: 'course-1', title: '课程名称', status: 'not-started', required: true, route: courseRoute },
    { id: 'course-2', title: '课程名称', status: 'completed', required: false, route: `#/study/course/detail/subject-course/course-2/6/${sid}` },
  ]);
});

test('专题标题仅从已核验横幅标题读取以支持旧DOM校验', () => {
  for (const selectorClass of ['subject-banner', 'banner-info']) {
    const html = `<div class="${selectorClass}"><div class="title-row"><div class="h3 toverflow-three" title="当前专题完整标题">截断</div></div></div><h3>无关业务内容</h3>${card('course-1')}`;
    const page = readPage(dom(html, subjectRoute).window.document, subjectRoute);
    assert.equal(page.title, '当前专题完整标题');
    assert.equal(JSON.stringify(page).includes('无关业务内容'), false);
  }
});

test('自定义专题没有横幅时从站点设置的标签标题读取，须有已加载课程', () => {
  const w = dom(`<div class="subject-detail-page subject-detail-page-template2">${card('course-1')}</div>`, subjectRoute).window;
  w.document.title = '示例自定义专区';
  const page = readPage(w.document, subjectRoute);
  assert.equal(page.title, '示例自定义专区');
  assert.equal(page.subjectTitleSource, 'document');
  assert.equal(page.courses.length, 1);
  const diagnostic = createAdapter(w).diagnose();
  assert.equal(diagnostic.subjectTitleSource, 'document');
  assert.equal(JSON.stringify(diagnostic).includes('示例自定义专区'), false);
  w.close();
});

test('没有template2标记的专题也可读取标签标题，不能因模板类名阻断有效课程清单', () => {
  for (const html of [card('course-1'), `<div class="subject-detail-page">${card('course-1')}</div>`]) {
    const w = dom(html, subjectRoute).window; w.document.title = '示例自定义专区';
    const page = readPage(w.document, subjectRoute);
    assert.equal(page.courses.length, 1); assert.equal(page.title, '示例自定义专区');
    assert.equal(createAdapter(w).diagnose().subjectTitleSource, 'document'); w.close();
  }
});

test('标签标题不能覆盖横幅，非专题路由或尚无有效课程时不能回退标签标题', () => {
  for (const html of [card('external', { type: 3 }), '<div class="subject-detail-page subject-detail-page-template2"><h3>课程推荐</h3></div>']) {
    const w = dom(html, subjectRoute).window; w.document.title = '上一页标题';
    assert.equal(readPage(w.document, subjectRoute).title, ''); w.close();
  }
  const other = dom(card('course-1'), '#/search').window; other.document.title = '上一页标题';
  assert.equal(readPage(other.document, '#/search').title, ''); other.close();
  const w = dom(`<div class="subject-detail-page subject-detail-page-template2"><div class="subject-banner"><div class="title-row"><h3 class="h3">横幅专题</h3></div></div>${card('course-1')}</div>`, subjectRoute).window;
  w.document.title = '不同专题';
  assert.equal(readPage(w.document, subjectRoute).title, '横幅专题');
  assert.equal(readPage(w.document, subjectRoute).subjectTitleSource, 'banner');
  w.close();
});

test('占位外链不进入课程且诊断只保留类型和数量', () => {
  const page = readPage(dom(card('url-1', { type: 3, title: '内部业务占位内容' }), subjectRoute).window.document, subjectRoute);
  assert.deepEqual(page.courses, []);
  assert.ok(page.issues.length);
  assert.equal(JSON.stringify(page.issues).includes('内部业务'), false);
  assert.match(JSON.stringify(page.issues), /3/u);
});

test('未知专题路由变体不猜测课程上下文', () => {
  const route = '#/study/subject/detail/other/123';
  const page = readPage(dom(card('course-1'), route).window.document, route);
  assert.equal(page.kind, 'unknown');
  assert.deepEqual(page.courses, []);
  assert.ok(page.issues.length);
});

test('课节识别动态前缀、浏览器小写属性和活动状态', () => {
  const page = readPage(dom(chapters(section('section-1', { active: true, prefix: 'Drizzle999' }))).window.document, courseRoute);
  assert.equal(page.kind, 'course');
  assert.equal(page.subjectId, sid);
  assert.equal(page.courseId, 'course-1');
  assert.equal(page.title, '课程标题');
  assert.equal(page.activeSectionId, 'section-1');
  assert.deepEqual(page.sections, [{ id: 'section-1', courseId: 'course-1', title: '01:课节section-1', type: 2, status: 'not-started', required: true, active: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(page)), page);
});

test('只有选修标签表示选修，required类不决定范围', () => {
  const page = readPage(dom(chapters(section('optional', { optional: true }) + section('required'))).window.document, courseRoute);
  assert.deepEqual(page.sections.map(item => item.required), [false, true]);
});

test('课节状态来自精确控件，tips完成描述和未完成均不算完成', () => {
  const page = readPage(dom(chapters(section('one', { status: '学习中' }) + section('two', { status: '未完成' }) + section('three', { status: '已完成' }))).window.document, courseRoute);
  assert.deepEqual(page.sections.map(item => item.status), ['learning', 'unknown', 'completed']);
});

test('专题卡片未完成和未知状态不能猜测已完成', () => {
  const page = readPage(dom(card('one', { status: '未完成' }) + card('two', { status: '完成率100%' }), subjectRoute).window.document, subjectRoute);
  assert.deepEqual(page.courses.map(item => item.status), ['unknown', 'unknown']);
});

test('视频结束仅为媒体快照，不改变课节状态', () => {
  const { window } = dom(chapters(section('one', { active: true })) + '<video></video>');
  Object.defineProperty(window.document.querySelector('video'), 'ended', { value: true });
  const page = readPage(window.document, courseRoute);
  assert.deepEqual(page.media, { ended: true, paused: true });
  assert.equal(page.sections[0].status, 'not-started');
});

test('音视频活动课节未出现本页播放器时提示加载识别问题', () => {
  for (const type of [5, 6]) {
    const page = readPage(dom(chapters(section('one', { type, active: true })) + '<iframe src="about:blank"></iframe>').window.document, courseRoute);
    assert.equal(page.media, null);
    assert.ok(page.issues.includes('未识别本页媒体播放器'));
    assert.equal(page.sections[0].status, 'not-started');
  }
});

test('普通课程路由可识别且不伪造专题上下文', () => {
  const route = '#/study/course/detail/course-1/2';
  const page = readPage(dom(chapters(section('one')), route).window.document, route);
  assert.equal(page.kind, 'course');
  assert.equal(page.subjectId, null);
  assert.equal(page.courseId, 'course-1');
});

test('旧课程DOM不能作为新课程课节', () => {
  const page = readPage(dom(chapters(section('old', { courseId: 'other-course', status: '已完成', active: true }))).window.document, courseRoute);
  assert.deepEqual(page.sections, []);
  assert.equal(page.activeSectionId, null);
  assert.ok(page.issues.length);
});

test('混合搜索结果只收集专题且不读取历史搜索', () => {
  const html = `<ul id="Drizzle123all-list">${result(sid, '专题')}${result('article-1', '文章')}${result('course-1', '课程')}${result('live-1', '直播')}</ul><div class="history">历史业务内容</div>`;
  const page = readPage(dom(html, '#/search').window.document, '#/search');
  assert.deepEqual(page.candidates, [{ id: sid, title: '候选专题', route: subjectRoute }]);
  assert.equal(JSON.stringify(page).includes('历史业务内容'), false);
});

test('同域专题hash链接兼容，外域链接不能成为候选', () => {
  const html = `<ul id="D123all-list"><a href="https://wangda.chinamobile.com/${subjectRoute}" title="链接专题">链接</a><a href="https://other.example/${subjectRoute}">外域</a><a href="javascript:alert(1)">危险</a></ul>`;
  assert.deepEqual(readPage(dom(html, '#/search').window.document, '#/search').candidates, [{ id: sid, title: '链接专题', route: subjectRoute }]);
});

test('搜索结果外的历史、页头和导航专题链接不进入候选', () => {
  const route = (id) => `#/study/subject/detail/${id}`;
  const html = `<div class="history"><a href="${route('history-subject')}" title="历史业务标题">历史</a></div><header><a href="${route('header-subject')}" title="页头业务标题">页头</a></header><nav><a href="${route('nav-subject')}" title="导航业务标题">导航</a></nav><ul id="D777all-list"><a href="${subjectRoute}" title="真实结果">结果</a></ul>`;
  const page = readPage(dom(html, '#/search').window.document, '#/search');
  assert.deepEqual(page.candidates, [{ id: sid, title: '真实结果', route: subjectRoute }]);
  assert.equal(JSON.stringify(page).includes('业务标题'), false);
});

test('历史区即使使用openDetail专题结构也不进入候选', () => {
  const html = `<div class="history">${result('history-subject', '专题')}</div><ul id="all-list">${result(sid, '专题')}</ul>`;
  const page = readPage(dom(html, '#/search').window.document, '#/search');
  assert.deepEqual(page.candidates, [{ id: sid, title: '候选专题', route: subjectRoute }]);
});

test('安全导航同标签保留专题上下文，拒绝未知路由和外域', () => {
  const { window } = dom('', '#/home');
  const adapter = createAdapter(window);
  assert.equal(adapter.openSubject({ route: subjectRoute }), true);
  assert.equal(window.location.hash, subjectRoute);
  assert.equal(adapter.openCourse({ route: courseRoute }), true);
  assert.equal(window.location.hash, courseRoute);
  for (const route of ['javascript:alert(1)', `https://evil.example/${subjectRoute}`, '#/study/course/detail/subject-course/course-1/9/subject-1', '#/unknown', '#/study/subject/detail/x?token=secret']) {
    assert.equal(adapter.openSubject({ route }), false);
    assert.equal(adapter.openCourse({ route }), false);
    assert.equal(window.location.hash, courseRoute);
  }
});

test('搜索点击专题分类、原生设置输入并触发站点按钮', () => {
  const { window } = dom('<button id="D40searchType-4">专题</button><input id="D40searchContent" name="keyword"><i id="D40searchBtn"></i>', '#/search');
  const calls = [];
  const input = window.document.querySelector('input');
  window.document.querySelector('button').addEventListener('click', () => calls.push('type'));
  input.addEventListener('input', () => calls.push('input'));
  input.addEventListener('change', () => calls.push('change'));
  window.document.querySelector('i').addEventListener('click', () => calls.push('search'));
  const adapter = createAdapter(window);
  assert.equal(adapter.searchKeyword('专题目标'), true);
  assert.equal(input.value, '专题目标');
  assert.deepEqual(calls, ['type', 'input', 'change', 'search']);
  assert.equal(adapter.goSearch(), true);
  assert.equal(window.location.hash, '#/search');
});

test('没有搜索控件时返回false且不操作其他输入', () => {
  const { window } = dom('<input type="password"><input name="other">', '#/search');
  assert.equal(createAdapter(window).searchKeyword('目标'), false);
  assert.equal(window.document.querySelector('input[name="other"]').value, '');
});

test('选择折叠课节先展开章节再点击课节，并重新获取DOM', () => {
  const { window } = dom(chapters(section('one')));
  const adapter = createAdapter(window);
  const calls = [];
  window.document.querySelector('.list-title').addEventListener('click', () => {
    calls.push('expand');
    window.document.querySelector('.hidden').classList.remove('hidden');
  });
  window.document.querySelector('dl').addEventListener('click', () => calls.push('section'));
  assert.equal(adapter.selectSection('one'), true);
  assert.deepEqual(calls, ['expand', 'section']);
  window.document.querySelector('dl').remove();
  assert.equal(adapter.selectSection('one'), false);
});

test('旧课节和非课程页面不能选择课节', () => {
  const { window } = dom(chapters(section('one', { courseId: 'old' })));
  const adapter = createAdapter(window);
  assert.equal(adapter.selectSection('one'), false);
  window.location.hash = '#/home';
  assert.equal(adapter.selectSection('one'), false);
});

test('暂停本页原生媒体并离开课程页，不访问iframe媒体', () => {
  const { window } = dom('<video></video><audio></audio><iframe src="about:blank"></iframe>');
  const calls = [];
  for (const media of window.document.querySelectorAll('video,audio')) media.pause = () => calls.push(media.tagName);
  const adapter = createAdapter(window);
  assert.equal(adapter.leaveLearning(subjectRoute), true);
  assert.deepEqual(calls, ['VIDEO', 'AUDIO']);
  assert.equal(window.location.hash, subjectRoute);
  assert.equal(adapter.leaveLearning(subjectRoute), false);
  window.location.hash = courseRoute;
  assert.equal(adapter.leaveLearning('javascript:alert(1)'), true);
  assert.equal(window.location.hash, '#/home');
});

test('播放只对暂停且未结束媒体尝试一次，失败返回false', async () => {
  const { window } = dom('<video></video>');
  const media = window.document.querySelector('video');
  let plays = 0;
  media.play = async () => { plays += 1; };
  const adapter = createAdapter(window);
  assert.equal(await adapter.playCurrentMedia(), true);
  assert.equal(plays, 1);
  Object.defineProperty(media, 'ended', { configurable: true, value: true });
  assert.equal(await adapter.playCurrentMedia(), false);
  assert.equal(plays, 1);
  Object.defineProperty(media, 'ended', { configurable: true, value: false });
  Object.defineProperty(media, 'paused', { configurable: true, value: false });
  assert.equal(await adapter.playCurrentMedia(), false);
  assert.equal(plays, 1);
  Object.defineProperty(media, 'paused', { configurable: true, value: true });
  media.play = async () => { throw new Error('autoplay blocked'); };
  assert.equal(await adapter.playCurrentMedia(), false);
});

test('无原生媒体或非课程页不能尝试播放', async () => {
  assert.equal(await createAdapter(dom().window).playCurrentMedia(), false);
  assert.equal(await createAdapter(dom('<video></video>', '#/home').window).playCurrentMedia(), false);
});

test('诊断只返回计数与问题，不包含标题或业务ID', () => {
  const adapter = createAdapter(dom(chapters(section('sensitive-id', { status: '已完成', type: 6 }))).window);
  const diagnostic = adapter.diagnose();
  assert.equal(diagnostic.kind, 'course');
  assert.equal(diagnostic.sections, 1);
  assert.equal(diagnostic.types['6'], 1);
  assert.equal(diagnostic.statuses.completed, 1);
  assert.equal(JSON.stringify(diagnostic).includes('标题'), false);
  assert.equal(JSON.stringify(diagnostic).includes('sensitive-id'), false);
});

test('首页登录与未知页快照字段完整', () => {
  for (const [route, kind] of [['#/home', 'home'], ['#/login', 'login'], ['#/unrecognized', 'unknown']]) {
    const adapter = createAdapter(dom('<p>页面敏感业务内容</p>', route).window);
    const page = adapter.read();
    assert.equal(page.kind, kind);
    assert.equal(page.route, route);
    assert.deepEqual(page.sections, []);
    assert.equal(JSON.stringify(page).includes('敏感业务'), false);
  }
});

const relearnPrompt = (kind) => `您已经很久没有学习该${kind === 'subject' ? '专题' : '课程'}了，是否重新学习？`;
const archivedPage = (kind, options = {}) => `<div class="course-middle-banner banner"></div><div class="center"><section class="section"><div class="but-footer"><div class="h3 tips-m-l">${relearnPrompt(kind)}${options.updated ? `<span class="update-content-tips">（${kind === 'subject' ? '专题' : '课程'}内容可能更新，如有学习要求，建议重新学习）</span>` : ''}</div><div id="D42close" class="btn btn1">取消</div><div id="D42again" class="btn">重新学习</div></div></section></div>`;

test('归档专题中间页严格识别路由及SID并给出人工处理提示', () => {
  for (const clickType of [1, 9]) {
    const route = `#/study/subject-middle/synthetic-subject/${clickType}`;
    const w = dom(archivedPage('subject', { updated: true }), route).window;
    const page = createAdapter(w).read();
    assert.equal(page.kind, 'subject-relearn');
    assert.equal(page.route, route);
    assert.equal(page.subjectId, 'synthetic-subject');
    assert.equal(page.courseId, null);
    assert.deepEqual(page.relearn, { kind: 'subject', message: relearnPrompt('subject'), manualRequired: true, reason: '重新学习会调用平台归档恢复接口并打开新窗口，请先在平台核对记录后人工处理。' });
    assert.deepEqual(page.courses, []);
    assert.deepEqual(page.sections, []);
    w.close();
  }
});

test('归档课程中间页只识别源码使用的1或2且不伪造专题上下文', () => {
  for (const type of [1, 2]) {
    const route = `#/study/course-middle/synthetic-course/${type}`;
    const w = dom(archivedPage('course'), route).window;
    const page = createAdapter(w).read();
    assert.equal(page.kind, 'course-relearn');
    assert.equal(page.courseId, 'synthetic-course');
    assert.equal(page.subjectId, null);
    assert.equal(page.route, route);
    assert.equal(page.relearn.kind, 'course');
    assert.equal(page.relearn.message, relearnPrompt('course'));
    assert.equal(page.relearn.manualRequired, true);
    w.close();
  }
});

test('归档页未加载提示时仍按路由提示人工核对，不把任意正文读为提示', () => {
  const route = '#/study/subject-middle/synthetic-subject/9';
  const w = dom('<p>业务内容和账号信息</p>', route).window;
  const page = createAdapter(w).read();
  assert.equal(page.kind, 'subject-relearn');
  assert.equal(page.relearn.message, '');
  assert.equal(page.relearn.manualRequired, true);
  assert.equal(JSON.stringify(page).includes('业务内容'), false);
  w.close();
});

test('未知归档路由与缺少SID的中间页不猜测标识', () => {
  for (const route of ['#/study/subject-middle', '#/study/subject-middle/synthetic-subject/6', '#/study/subject-middle/synthetic-subject/09', '#/study/course-middle/synthetic-course/9', '#/study/subject-middle/../../other/9', '#/study/subject-middle/synthetic-subject/9?token=secret', '#/study/subject-middle/synthetic-subject/9/extra']) {
    const w = dom(archivedPage('subject'), route).window;
    const page = createAdapter(w).read();
    assert.equal(page.kind, 'unknown');
    assert.equal(page.subjectId, null);
    assert.equal(page.courseId, null);
    assert.equal(page.relearn, null);
    w.close();
  }
});

test('目标页可见对话框中的准确重学提示只报告人工处理，不点击按钮或调用confirm', () => {
  const w = dom('<div role="dialog"><p>该专题已完成，是否重新学习？</p><button>确定</button></div>', subjectRoute).window;
  let clicks = 0;
  let confirms = 0;
  w.document.querySelector('button').addEventListener('click', () => { clicks += 1; });
  w.confirm = () => { confirms += 1; return true; };
  const page = createAdapter(w).read();
  assert.equal(page.kind, 'subject');
  assert.equal(page.subjectId, sid);
  assert.ok(page.relearn);
  assert.equal(page.relearn.message, '该专题已完成，是否重新学习？');
  assert.equal(page.relearn.manualRequired, true);
  assert.equal(clicks, 0);
  assert.equal(confirms, 0);
  w.close();
});

test('普通正文、隐藏对话框、非目标页面及未知重学文案不作为确认提示', () => {
  const known = '该专题已完成，是否重新学习？';
  for (const [html, route] of [
    [`<p>${known}</p>`, subjectRoute],
    [`<div role="dialog" hidden><p>${known}</p></div>`, subjectRoute],
    [`<div style="display:none"><div role="dialog"><p>${known}</p></div></div>`, subjectRoute],
    [`<div role="dialog" style="visibility:hidden"><p>${known}</p></div>`, subjectRoute],
    [`<div role="dialog" aria-hidden="true"><p>${known}</p></div>`, subjectRoute],
    [`<dialog><p>${known}</p></dialog>`, subjectRoute],
    [`<div role="dialog"><p>${known}这将清空记录</p></div>`, subjectRoute],
    [`<div role="dialog"><p>该课程已完成，是否重新学习？</p></div>`, subjectRoute],
    [`<div role="dialog"><p>${known}</p></div>`, '#/search'],
  ]) {
    const w = dom(html, route).window;
    assert.equal(createAdapter(w).read().relearn, null);
    w.close();
  }
});

test('归档中间页的隐藏或不准确文案不会进入快照', () => {
  const route = '#/study/subject-middle/synthetic-subject/9';
  for (const html of [archivedPage('subject').replace('class="but-footer"', 'class="but-footer" hidden'), archivedPage('subject').replace(relearnPrompt('subject'), `${relearnPrompt('subject')}未知业务要求`)]) {
    const w = dom(html, route).window;
    const page = createAdapter(w).read();
    assert.ok(page.relearn);
    assert.equal(page.relearn.message, '');
    w.close();
  }
});
