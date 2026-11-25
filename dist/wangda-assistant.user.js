// ==UserScript==
// @name         网大助手
// @namespace    wangda-assistant
// @version      0.1.0-beta.22
// @updateURL    https://raw.githubusercontent.com/ka1er/wangda-assistant/refs/heads/beta-channel/dist/wangda-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/ka1er/wangda-assistant/refs/heads/beta-channel/dist/wangda-assistant.user.js
// @description  手动勾选课程、管理多专区任务队列，按平台完成状态连续学习，支持课程知识点导览与导图
// @match        https://wangda.chinamobile.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// ==/UserScript==

(function () {
'use strict';
const wdCoreAutomaticTypes = new Set([1, 2, 5, 6, 7, 20]);

function normalizeTitle(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '');
}

function wdCoreCleanTarget(value) {
  let result = value.trim().replace(/^[\s“”‘’「」『』《》"']+|[\s“”‘’「」『』《》"'。；;,]+$/gu, '');
  if (/^(?:不要|不用|无需|勿|禁止|不是|不学习|暂不|不要求)/u.test(result)) return '';
  result = result.replace(/(?:全部课程|所有课程|必修课程)(?:的)?(?:学习|培训)?$/u, '').trim();
  result = result.replace(/^(.+(?:专区|专题|课程|培训))(?:的)?学习$/u, '$1').trim();
  if (/^(?:(?:请|大家|全体|全部|所有|仅|只|按时|完成|参加|开展|进行|学习|课程|专区|专题|培训|的|要求)\s*)+$/u.test(result)) return '';
  return result.replace(/^[“”‘’「」『』《》"']+|[“”‘’「」『』《》"']+$/gu, '').trim();
}

function wdCoreNoticeTarget(lines) {
  const pathLine = lines.find(line => /中移网大\s*(?:→|➜|➔|⇒|->|>|›|»)/u.test(line));
  if (pathLine) {
    const path = pathLine.slice(pathLine.indexOf('中移网大') + 4);
    const parts = path.split(/→|➜|➔|⇒|->|>|›|»/u).map(wdCoreCleanTarget).filter(Boolean);
    const targets = parts.filter(part => !/^(?:首页|学习中心|我的学习|课程中心|专题中心|课程|专题|学习|进入|全部|必修)$/u.test(part));
    return targets.at(-1) || '';
  }
  const namedLine = lines.find(line => /^(?:网上大学|课程名称|专区名称|专题名称)\s*[:：]/u.test(line));
  if (namedLine) return wdCoreCleanTarget(namedLine.replace(/^[^:：]+[:：]\s*/u, ''));
  const firstLine = lines.find(line => !/^@/u.test(line)) || '';
  if (/[：:]|通知|参加人员|学习要求|请|要求|时间|时段/u.test(firstLine)) return '';
  if (!/(?:课程|专区|专题)/u.test(firstLine)) return '';
  return wdCoreCleanTarget(firstLine);
}

function wdCoreScope(text) {
  const positive = text.replace(/(?:不是|不(?:用|必|要|需要|要求|限|仅限)?|无需|非)\s*(?:只|仅)?\s*(?:学习|完成)?\s*(?:全部|所有|必修)课程/gu, '');
  if (/(?:只|仅)(?:需|要求)?(?:学习|完成)?\s*必修/u.test(positive)) return 'required';
  return /必修/u.test(positive) && !/(?:全部|所有)课程/u.test(positive) ? 'required' : 'all';
}

function wdCoreClockMinutes(value, allowMidnightEnd = false) {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(String(value ?? ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && (!allowMidnightEnd || minutes !== 0))) return null;
  return hours * 60 + minutes;
}

function wdCoreNoticeClock(marker, hourText, minuteText, isEnd) {
  let hours = Number(hourText);
  const minutes = Number(minuteText || 0);
  if (/晚|夜/u.test(marker) && hours >= 1 && hours <= 12) hours = hours === 12 ? 24 : hours + 12;
  else if (/下午|傍晚/u.test(marker) && hours >= 1 && hours < 12) hours += 12;
  else if (/凌晨/u.test(marker) && hours === 12) hours = 0;
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return wdCoreClockMinutes(clock, isEnd) === null ? null : clock;
}

function wdCoreNoticeWindow(text) {
  const token = '(凌晨|清晨|早上|早晨|早|上午|中午|午|下午|傍晚|晚上|晚|夜间|夜里|夜)?\\s*(\\d{1,2})(?:(?:[:：](\\d{1,2}))|(?:点|时)(?:(\\d{1,2})分?)?)?';
  const pattern = new RegExp(`(?<!\\d)${token}\\s*(?:至|到|[-—–~～－])\\s*(?:次日|翌日|第二天)?\\s*${token}(?!\\d)`, 'u');
  const match = pattern.exec(text);
  if (!match || !/[:：点时早午晚夜晨凌]/u.test(match[0])) {
    const incomplete = /(?:早|午|晚|上午|下午|凌晨)\s*\d|\d{1,2}[:：]\d{2}|\d+\s*(?:点|时)/u.test(text);
    return { window: { start: '09:00', end: '24:00' }, warning: incomplete ? '未能识别完整学习时段，请确认开始和结束时间。' : '未识别到学习时间，默认使用北京时间 09:00—24:00。', valid: !incomplete };
  }
  const start = wdCoreNoticeClock(match[1] || '', match[2], match[3] || match[4], false);
  const endMarker = match[5] || (/(?:次日|翌日|第二天)/u.test(match[0]) ? '' : match[1] || '');
  const end = wdCoreNoticeClock(endMarker, match[6], match[7] || match[8], true);
  if (!start || !end || start === end) {
    return { window: { start: '09:00', end: '24:00' }, warning: '学习时间无效，请确认开始和结束时间。', valid: false };
  }
  return { window: { start, end }, warning: '', valid: true };
}

function parseNotice(text) {
  const normalized = String(text ?? '').normalize('NFKC').replace(/\r\n?/gu, '\n');
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const target = wdCoreNoticeTarget(lines);
  const time = wdCoreNoticeWindow(normalized);
  const warnings = [];
  if (!target) warnings.push('未能明确识别课程或专区名称，请填写准确的学习目标。');
  if (time.warning) warnings.push(time.warning);
  return { target, scope: wdCoreScope(normalized), window: time.window, warnings, valid: Boolean(target) && time.valid };
}

function isWithinWindow(date, window) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return false;
  const start = wdCoreClockMinutes(window?.start);
  const end = wdCoreClockMinutes(window?.end, true);
  if (start === null || end === null || start === end) return false;
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const minute = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function wdCoreInScope(section, scope) {
  return scope !== 'required' || section.required === true;
}

function chooseNextSection(sections, scope = 'all') {
  return (Array.isArray(sections) ? sections : []).find(section => section && wdCoreInScope(section, scope) && section.status !== 'completed') || null;
}

function decideLearningAction(snapshot, task) {
  if (task?.status !== 'running') return { type: 'idle', reason: '任务未运行。' };
  if (snapshot?.kind === 'login') return { type: 'manual', reason: '请先完成登录。' };
  if (snapshot?.kind !== 'course') return { type: 'wait', reason: '等待进入目标课程。' };
  if (snapshot.sectionListReady === false) return { type: 'wait', reason: snapshot.sectionListReason || '等待课节清单加载完成。' };
  const sections = Array.isArray(snapshot.sections) ? snapshot.sections.filter(Boolean) : [];
  if (!sections.length) return { type: 'wait', reason: '等待识别课程课节。' };
  const active = snapshot.activeSectionId != null
    ? sections.find(section => section.id === snapshot.activeSectionId)
    : sections.find(section => section.active);
  if (snapshot.activeSectionId != null && !active) return { type: 'wait', reason: '等待确认当前课节。' };
  if (active && wdCoreInScope(active, task.scope) && active.status !== 'completed') {
    if (!wdCoreAutomaticTypes.has(active.type)) return { type: 'manual', sectionId: active.id, reason: '此课节需要人工处理。' };
    return { type: 'wait', sectionId: active.id, reason: '等待平台确认当前课节完成。' };
  }
  const next = chooseNextSection(sections, task.scope);
  if (!next) return { type: 'course-complete' };
  if (!wdCoreAutomaticTypes.has(next.type)) return { type: 'manual', sectionId: next.id, reason: '此课节需要人工处理。' };
  if (!['not-started', 'learning'].includes(next.status)) return { type: 'wait', sectionId: next.id, reason: '等待确认课节学习状态。' };
  return { type: 'select-section', sectionId: next.id };
}

const wdAdapterIdPattern = '[A-Za-z0-9_-]+';
const wdAdapterSubjectPattern = new RegExp(`^#/study/subject/detail/(${wdAdapterIdPattern})$`, 'u');
const wdAdapterContextCoursePattern = new RegExp(`^#/study/course/detail/subject-course/(${wdAdapterIdPattern})/6/(${wdAdapterIdPattern})$`, 'u');
const wdAdapterCoursePattern = new RegExp(`^#/study/course/detail/(${wdAdapterIdPattern})/(\\d+)$`, 'u');
const wdAdapterErrorPattern = new RegExp(`^#/study/errors/(${wdAdapterIdPattern})&([0-9]+)$`, 'u');
// Only the middle-page variants observed in the site's router and detail loaders.
const wdAdapterSubjectRelearnPattern = new RegExp(`^#/study/subject-middle/(${wdAdapterIdPattern})/(1|9)$`, 'u');
const wdAdapterCourseRelearnPattern = new RegExp(`^#/study/course-middle/(${wdAdapterIdPattern})/(1|2)$`, 'u');

const wdAdapterLegacyLayout = {
  name: 'legacy',
  card: '.content.new',
  controls: '.content.new .img.course-item [id*="studyBtns-"], .content.new .img.course-item [id*="studyBtn-"]',
  title: '.title',
  status: '.study-status',
  range: '.cont-class-type',
};
const wdAdapterCatalogLayouts = [
  {
    name: 'catalog-grid',
    groupClass: 'catalog-state-info2',
    card: '.item.course-item',
    controls: ':scope > .item.course-item > .img > .img-cont > a[id*="studyBtn-"]',
    title: ':scope > .title2 > .title-clamp-2',
  },
  {
    name: 'catalog-list',
    groupClass: 'catalog-state-info',
    card: '.item.course-item',
    controls: ':scope > .item.course-item > .operation > a[id*="studyBtn-"]',
    title: ':scope > .title > .text-overflow:first-child',
    titleText: '.title-wrapper > .text-overflow',
    status: ':scope > .class-type > span',
  },
];
const wdAdapterCatalogGroupSelector = '.subject-detail-page .subject-detail-main > section.section[data-dynamic-key="content"] '
  + '.subject-catalog > ul > li '
  + `:is(${wdAdapterCatalogLayouts.map(layout => `.${layout.groupClass}`).join(', ')})`;
const wdAdapterLoadingSelector = '.loading, .spinner, .skeleton, .el-loading-mask, .ant-spin, [aria-busy="true"], [data-loading="true"], [data-sections-ready="false"], [data-loaded="false"]';
const wdAdapterEmptySelector = '.empty, .no-data, .no-result, .no-course, .search-empty, [data-empty="true"]';
const wdAdapterLoadingTextPattern = /^(?:正在加载|加载中|数据加载中|努力加载中)[.。…]*$/u;
const wdAdapterEmptyTextPattern = /^(?:暂无(?:数据|结果|课程|内容|课节)|没有(?:找到|匹配|相关)?(?:数据|结果|课程|内容|课节)|未找到相关(?:专题|课程|内容)|搜索结果为空)[!！。.]*$/u;

function wdAdapterText(element) {
  return (element?.textContent || '').trim();
}

function wdAdapterTitle(element) {
  return (element?.getAttribute('title') || wdAdapterText(element)).trim();
}

function wdAdapterAttribute(element, name) {
  return element.getAttribute(`data-${name}`) ?? element.getAttribute(`data-${name.replace(/-/gu, '')}`);
}

function wdAdapterStatus(elements) {
  const statuses = [...elements].map(element => wdAdapterText(element));
  if (!statuses.length || statuses.some(value => value !== statuses[0])) return 'unknown';
  return { '未开始': 'not-started', '学习中': 'learning', '已完成': 'completed' }[statuses[0]] || 'unknown';
}

function wdAdapterRoute(hash) {
  const route = typeof hash === 'string' ? hash : '';
  const subject = wdAdapterSubjectPattern.exec(route);
  if (subject) return { kind: 'subject', route, subjectId: subject[1], courseId: null };
  const contextualCourse = wdAdapterContextCoursePattern.exec(route);
  if (contextualCourse) return { kind: 'course', route, subjectId: contextualCourse[2], courseId: contextualCourse[1] };
  const course = wdAdapterCoursePattern.exec(route);
  if (course) return { kind: 'course', route, subjectId: null, courseId: course[1] };
  const error = wdAdapterErrorPattern.exec(route);
  if (error) return { kind: 'study-error', route, subjectId: null, courseId: error[1], errorCode: error[2] };
  const subjectRelearn = wdAdapterSubjectRelearnPattern.exec(route);
  if (subjectRelearn) return { kind: 'subject-relearn', route, subjectId: subjectRelearn[1], courseId: null };
  const courseRelearn = wdAdapterCourseRelearnPattern.exec(route);
  if (courseRelearn) return { kind: 'course-relearn', route, subjectId: null, courseId: courseRelearn[1] };
  const kind = route === '#/search' ? 'search' : route === '#/login' ? 'login' : ['', '#/', '#/home'].includes(route) ? 'home' : 'unknown';
  return { kind, route, subjectId: null, courseId: null };
}

function wdAdapterSubjectCards(root, layout) {
  return [...root.querySelectorAll(layout.controls)].map(element => ({ element, card: element.closest(layout.card), layout }));
}

function wdAdapterCompareOrder(a, b) {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & 4) return -1;
  if (pos & 2) return 1;
  return 0;
}

function wdAdapterPositiveInt(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function wdAdapterHasTextIndicator(root, pattern) {
  if (!root) return false;
  const skipSelector = '#wangda-assistant, script, style, .qcontent, .title, .title2, .title-clamp-2, .title-wrapper, .text-overflow, .search-page-title';
  const nodes = [root, ...root.querySelectorAll('*')];
  for (const node of nodes) {
    if (!wdAdapterVisible(node) || node.closest(skipSelector)) continue;
    const hasBlockChild = [...node.children].some(child => wdAdapterVisible(child) && !['SPAN', 'I', 'SMALL', 'B', 'EM', 'STRONG'].includes(child.tagName));
    if (hasBlockChild) continue;
    const text = wdAdapterText(node);
    if (text && text.length <= 40 && pattern.test(text)) return true;
  }
  return false;
}

function wdAdapterHasLoadingIndicator(root) {
  if (!root) return false;
  if (root.matches?.(wdAdapterLoadingSelector) && wdAdapterVisible(root)) return true;
  for (const node of root.querySelectorAll(wdAdapterLoadingSelector)) {
    if (!node.closest('#wangda-assistant') && wdAdapterVisible(node)) return true;
  }
  return wdAdapterHasTextIndicator(root, wdAdapterLoadingTextPattern);
}

function wdAdapterHasEmptyIndicator(root) {
  if (!root) return false;
  if (root.matches?.(wdAdapterEmptySelector) && wdAdapterVisible(root)) return true;
  for (const node of root.querySelectorAll(wdAdapterEmptySelector)) {
    if (!node.closest('#wangda-assistant') && wdAdapterVisible(node)) return true;
  }
  return wdAdapterHasTextIndicator(root, wdAdapterEmptyTextPattern);
}

function wdAdapterHasUnrecognizedContent(root) {
  if (!root) return false;
  const skip = '#wangda-assistant, script, style, link, meta, title, .subject-banner, .banner-info, section[data-dynamic-key="introduce"]';
  for (const node of root.querySelectorAll('a, button, li, article, h1, h2, h3, h4, p, [class*="course"], [class*="item"], [class*="card"]')) {
    if (node.closest(skip) || !wdAdapterVisible(node)) continue;
    if (wdAdapterText(node) || ['A', 'BUTTON', 'IMG'].includes(node.tagName)) return true;
  }
  return false;
}

function wdAdapterSubjectCatalog(document) {
  const subjectPages = [...document.querySelectorAll('.subject-detail-page')].filter(wdAdapterVisible);
  const subjectMains = [...document.querySelectorAll('.subject-detail-page .subject-detail-main')].filter(wdAdapterVisible);
  const groups = [...document.querySelectorAll(wdAdapterCatalogGroupSelector)].filter(wdAdapterVisible);
  let introTitle = '';
  for (const main of subjectMains) {
    const intro = main.querySelector(':scope > section.section[data-dynamic-key="introduce"] > [data-region] > .title-row > .h3');
    if (intro && wdAdapterVisible(intro)) {
      introTitle = wdAdapterTitle(intro);
      if (introTitle) break;
    }
  }
  const catalogCards = [];
  const matchedLayouts = new Set();
  const hiddenCards = new Set();
  let emptyCatalogGroups = 0;
  for (const group of groups) {
    const layout = wdAdapterCatalogLayouts.find(item => group.classList.contains(item.groupClass));
    const found = wdAdapterSubjectCards(group, layout);
    const visible = [];
    for (const entry of found) {
      if (wdAdapterVisible(entry.card)) visible.push(entry);
      else if (entry.card) hiddenCards.add(entry.card);
    }
    if (!visible.length) {
      emptyCatalogGroups += 1;
      continue;
    }
    matchedLayouts.add(layout.name);
    catalogCards.push(...visible);
  }
  const scopedLegacyCards = [];
  const seenLegacyEl = new Set();
  for (const pageRoot of subjectPages) {
    for (const entry of wdAdapterSubjectCards(pageRoot, wdAdapterLegacyLayout)) {
      if (seenLegacyEl.has(entry.element)) continue;
      seenLegacyEl.add(entry.element);
      if (!wdAdapterVisible(entry.card)) { if (entry.card) hiddenCards.add(entry.card); continue; }
      scopedLegacyCards.push(entry);
    }
  }
  if (scopedLegacyCards.length) matchedLayouts.add(wdAdapterLegacyLayout.name);
  let cards = [...catalogCards, ...scopedLegacyCards].sort((a, b) => wdAdapterCompareOrder(a.element, b.element));
  if (!cards.length) {
    const docLegacy = wdAdapterSubjectCards(document, wdAdapterLegacyLayout);
    const visibleDocLegacy = [];
    for (const entry of docLegacy) {
      if (wdAdapterVisible(entry.card)) visibleDocLegacy.push(entry);
      else if (entry.card) hiddenCards.add(entry.card);
    }
    if (visibleDocLegacy.length) {
      cards = visibleDocLegacy;
      matchedLayouts.add(wdAdapterLegacyLayout.name);
    }
  }
  const hiddenCardCount = hiddenCards.size;
  const fallbackToLegacy = Boolean(groups.length && !catalogCards.length && cards.length);
  const hasCatalogContainer = Boolean(
    groups.length
    || [...document.querySelectorAll('.subject-detail-page .subject-detail-main > section.section[data-dynamic-key="content"], .subject-catalog')].some(wdAdapterVisible)
  );
  const hasSubjectPage = Boolean(subjectPages.length || subjectMains.length || hasCatalogContainer);
  return {
    cards,
    introTitle,
    catalogMeta: {
      layouts: [...matchedLayouts],
      catalogGroups: groups.length,
      emptyCatalogGroups,
      fallbackToLegacy,
      hiddenCardCount,
      hasSubjectPage,
      hasCatalogContainer,
    },
  };
}

function wdAdapterCourseTitle(card, layout) {
  const title = card.querySelector(layout.title);
  if (!layout.titleText) return wdAdapterTitle(title);
  return title?.getAttribute('title')?.trim() || wdAdapterText(title?.querySelector(layout.titleText));
}

function wdAdapterSectionElements(document) {
  return [...document.querySelectorAll('.chapter-list.chapter-all ul li dl[id*="show-sections"]')];
}

function wdAdapterSectionId(element) {
  const value = element.id.slice(element.id.lastIndexOf('show-sections') + 'show-sections'.length);
  return new RegExp(`^${wdAdapterIdPattern}$`, 'u').test(value) ? value : null;
}

function wdAdapterSafeSubjectLink(document, href) {
  if (typeof href !== 'string') return null;
  if (wdAdapterSubjectPattern.test(href)) return href;
  try {
    const target = new URL(href, document.location.href);
    const current = new URL(document.location.href);
    return target.origin === current.origin && target.pathname === current.pathname && !target.search && wdAdapterSubjectPattern.test(target.hash) ? target.hash : null;
  } catch {
    return null;
  }
}

function wdAdapterVisible(element) {
  if (!element) return false;
  const win = element.ownerDocument.defaultView;
  for (let current = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true' || current.classList.contains('hidden') || (current.tagName === 'DIALOG' && !current.hasAttribute('open'))) return false;
    const style = win?.getComputedStyle(current);
    if (style && (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0')) return false;
  }
  return element.isConnected;
}

function wdAdapterMediaBinding(media, attrName) {
  const docBody = media.ownerDocument?.body;
  for (let current = media; current && current !== docBody; current = current.parentElement) {
    const value = wdAdapterAttribute(current, attrName);
    if (value) return value;
  }
  return null;
}

const wdAdapterMediaStates = new WeakMap();
let wdAdapterNextPlayerId = 0;

function wdAdapterMediaState(media) {
  if (!wdAdapterMediaStates.has(media)) wdAdapterMediaStates.set(media, { id: ++wdAdapterNextPlayerId, seekRevision: 0 });
  return wdAdapterMediaStates.get(media);
}

const wdAdapterPlaybackControlSelector = 'button, [role="button"], [aria-label], [title]';

function wdAdapterControlAction(control) {
  for (const value of [control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent]) {
    const label = value?.trim().toLowerCase();
    if (/^(?:播放(?:视频)?|继续(?:播放)?|play|resume)$/u.test(label)) return 'play';
    if (/^(?:暂停(?:播放|视频)?|pause)$/u.test(label)) return 'pause';
  }
  return null;
}

function wdAdapterPlayerControls(media) {
  const controls = new Map();
  let group = media.parentElement;
  for (let level = 0; group && !group.matches('body,html') && level < 3; level += 1, group = group.parentElement) {
    if (group.querySelectorAll('video,audio').length !== 1) break;
    for (const control of group.querySelectorAll(wdAdapterPlaybackControlSelector)) {
      if (control === media || control.closest('#wangda-assistant')) continue;
      const binding = control.getAttribute('aria-controls');
      if (binding && binding !== media.id) continue;
      const action = wdAdapterControlAction(control);
      if (action && wdAdapterVisible(control)) controls.set(control, action);
    }
    if (controls.size) break;
  }
  return controls;
}

function wdAdapterResolveMedia(document, page) {
  const all = [...document.querySelectorAll('video,audio')];
  const visible = all.filter(wdAdapterVisible);
  const none = reason => ({ status: 'none', target: null, count: visible.length, totalCount: all.length, tag: null, reason });
  const resolved = (target, reason) => ({ status: 'resolved', target, count: visible.length, totalCount: all.length, tag: target.tagName.toLowerCase(), reason });
  if (!visible.length) return none(all.length ? 'only-hidden-media' : 'no-media');

  const activeId = page.kind === 'course' ? page.activeSectionId : null;
  const activeEl = activeId && wdAdapterSectionElements(document).find(element => wdAdapterSectionId(element) === activeId
    && wdAdapterAttribute(element, 'course-id') === page.courseId);
  const resourceId = activeEl ? wdAdapterAttribute(activeEl, 'resource-id') : null;
  const bindings = visible.map(target => ({
    target, section: wdAdapterMediaBinding(target, 'section-id'),
    resource: wdAdapterMediaBinding(target, 'resource-id'), course: wdAdapterMediaBinding(target, 'course-id'),
  }));
  const conflicts = (actual, expected) => Boolean(actual && expected && actual !== expected);
  const eligible = bindings.filter(item => !conflicts(item.section, activeId) && !conflicts(item.resource, resourceId)
    && !conflicts(item.course, page.courseId));
  if (!eligible.length) return none('binding-mismatch');

  const sectionBound = eligible.filter(item => (activeId && item.section === activeId) || (resourceId && item.resource === resourceId));
  if (sectionBound.length === 1) return resolved(sectionBound[0].target, 'section-bound');
  if (!sectionBound.length) {
    if (eligible.length === 1) return resolved(eligible[0].target, visible.length === 1 ? 'single-visible' : 'unique-compatible');
    const courseBound = eligible.filter(item => page.courseId && item.course === page.courseId);
    if (courseBound.length === 1) return resolved(courseBound[0].target, 'course-bound');
  }
  return { status: 'ambiguous', target: null, count: visible.length, totalCount: all.length, tag: null, reason: 'multiple-visible-media' };
}

function wdAdapterExpectedCount(element) {
  if (!element) return null;
  for (const name of ['section-count', 'total-sections', 'expected-sections']) {
    const value = wdAdapterAttribute(element, name);
    const parsed = wdAdapterPositiveInt(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function wdAdapterInspectSectionList(document, page, { stale, invalid, activeCount }) {
  const containers = [...document.querySelectorAll('.chapter-list.chapter-all')];
  const container = containers.find(wdAdapterVisible) || containers[0] || null;
  if (!container) {
    return {
      ready: false,
      confirmed: false,
      reason: '未找到课节目录容器（.chapter-list.chapter-all）',
      issue: '',
      meta: { hasContainer: false, chapters: 0, unloadedChapters: 0, unresolvedDls: 0, loadingIndicator: false, expectedSections: null, hasEmptyMarker: false },
    };
  }
  const side = container.closest('.course-side');
  const explicitReady = container.getAttribute('data-sections-ready') === 'true' || container.getAttribute('data-loaded') === 'true';
  const loadingIndicator = Boolean(wdAdapterHasLoadingIndicator(container) || (side && wdAdapterHasLoadingIndicator(side)));
  const hasEmptyMarker = wdAdapterHasEmptyIndicator(container);
  const chapterItems = [...container.querySelectorAll(':scope > ul > li')].filter(wdAdapterVisible);
  const unresolvedDls = [...container.querySelectorAll('ul li dl')].filter(dl => !dl.id.includes('show-sections')).length;
  let unloadedChapters = 0;
  let chapterExpectedMismatch = null;
  for (const li of chapterItems) {
    const validInChapter = [...li.querySelectorAll('dl[id*="show-sections"]')].filter(dl => {
      if (wdAdapterAttribute(dl, 'course-id') !== page.courseId) return false;
      const id = wdAdapterSectionId(dl);
      const type = Number(wdAdapterAttribute(dl, 'section-type'));
      return Boolean(id && Number.isInteger(type) && type > 0);
    }).length;
    if (validInChapter === 0) unloadedChapters += 1;
    const chapterExpected = wdAdapterExpectedCount(li);
    if (chapterExpected !== null && validInChapter < chapterExpected && !chapterExpectedMismatch) {
      chapterExpectedMismatch = { parsed: validInChapter, expected: chapterExpected };
    }
  }
  const containerExpected = wdAdapterExpectedCount(container) ?? wdAdapterExpectedCount(side);
  const totalMismatch = containerExpected !== null && page.sections.length < containerExpected;
  let ready = true;
  let reason = '';
  let issue = '';
  if (loadingIndicator) {
    ready = false;
    reason = '课节清单仍在加载中（检测到 .loading/[aria-busy="true"]/[data-sections-ready="false"]）';
    issue = reason;
  } else if (stale) {
    ready = false;
    reason = `课程页面内容尚未更新：不匹配课节 ${stale} 个`;
  } else if (invalid) {
    ready = false;
    reason = `课节标识或类型无法识别：${invalid} 个`;
  } else if (unresolvedDls) {
    ready = false;
    reason = `课节清单尚未完整加载：存在 ${unresolvedDls} 个未解析课节节点（缺少 id*="show-sections"）`;
    issue = reason;
  } else if (!chapterItems.length) {
    ready = false;
    reason = '课节目录尚无可见章节项（.chapter-list.chapter-all > ul > li）';
  } else if (unloadedChapters) {
    ready = false;
    reason = `课节清单尚未完整加载：${unloadedChapters} 个章节尚无有效课节条目`;
    issue = reason;
  } else if (totalMismatch) {
    ready = false;
    reason = `课节清单数量未齐（已解析 ${page.sections.length} / 预期 ${containerExpected}）`;
    issue = reason;
  } else if (chapterExpectedMismatch) {
    ready = false;
    reason = `章节课节数量未齐（已解析 ${chapterExpectedMismatch.parsed} / 预期 ${chapterExpectedMismatch.expected}）`;
    issue = reason;
  } else if (!page.sections.length) {
    ready = false;
    reason = '未解析到属于当前课程的课节（data-course-id 匹配 0 个）';
  } else if (activeCount > 1) {
    ready = false;
    reason = '检测到多个活动课节（.focus 不唯一）';
  }
  return {
    ready,
    confirmed: ready && explicitReady,
    reason,
    issue,
    meta: {
      hasContainer: true,
      chapters: chapterItems.length,
      unloadedChapters,
      unresolvedDls,
      loadingIndicator,
      expectedSections: containerExpected,
      hasEmptyMarker,
    },
  };
}

function wdAdapterRelearn(document, page) {
  const archived = ['subject-relearn', 'course-relearn'].includes(page.kind);
  const kind = page.kind.startsWith('subject') ? 'subject' : page.kind.startsWith('course') ? 'course' : null;
  if (!kind) return null;
  const label = kind === 'subject' ? '专题' : '课程';
  const prompt = `您已经很久没有学习该${label}了，是否重新学习？`;
  const update = `（${label}内容可能更新，如有学习要求，建议重新学习）`;
  const known = new Map([
    [prompt, prompt], [prompt + update, prompt],
    [`该${label}已完成，是否重新学习？`, `该${label}已完成，是否重新学习？`],
    ...(archived ? [[`该${label}已完成`, `该${label}已完成`]] : []),
  ]);
  const candidates = archived ? [...document.querySelectorAll('.but-footer > .h3')] : [];
  for (const dialog of document.querySelectorAll('[role="dialog"], dialog[open], .alertify-dialog')) {
    candidates.push(dialog, ...dialog.querySelectorAll('.h3, p, .alertify-message'));
  }
  let message = '';
  for (const element of candidates) {
    const exact = known.get(wdAdapterText(element).replace(/\s+/gu, ''));
    if (exact && wdAdapterVisible(element)) { message = exact; break; }
  }
  if (!archived && !message) return null;
  // The observed #again handler calls subject-back/course-back before opening a new window.
  // Reading the prompt must never invoke that handler or intercept native window.confirm.
  return { kind, message, manualRequired: true, reason: archived
    ? '重新学习会调用平台归档恢复接口并打开新窗口，请先在平台核对记录后人工处理。'
    : '尚未验证此提示对应按钮的处理逻辑，请先在平台核对记录后人工处理。' };
}

function readPage(document, hash) {
  const page = { ...wdAdapterRoute(hash), title: '', courses: [], candidates: [], sections: [], activeSectionId: null, media: null, relearn: null, issues: [] };
  if (page.kind === 'unknown') {
    page.issues.push('无法识别当前页面路由');
    page.recognition = {
      category: 'unsupported-structure',
      code: 'unknown-route',
      summary: '不支持的结构',
      basis: '路由未匹配已知专题/课程/搜索规则（需 #/study/subject/detail/<SID>、#/study/course/detail/... 或 #/search）',
    };
  }
  if (page.kind === 'subject') {
    page.title = wdAdapterTitle(document.querySelector('.subject-banner .title-row .h3, .banner-info .title-row .h3'));
    page.subjectTitleSource = page.title ? 'banner' : 'none';
    const { cards, introTitle, catalogMeta } = wdAdapterSubjectCatalog(document);
    page.catalogMeta = catalogMeta;
    if (!page.title && introTitle) {
      page.title = introTitle;
      page.subjectTitleSource = 'intro';
    }
    const seen = new Set();
    const ignored = new Map();
    for (const { element, card, layout } of cards) {
      const id = wdAdapterAttribute(element, 'resource-id');
      if (!id) continue;
      const type = wdAdapterAttribute(element, 'section-type');
      if (type !== '10') {
        const key = type || 'unknown';
        if (!ignored.has(key)) ignored.set(key, new Set());
        ignored.get(key).add(id);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      if (!new RegExp(`^${wdAdapterIdPattern}$`, 'u').test(id)) {
        page.issues.push('课程标识格式无法识别');
        continue;
      }
      page.courses.push({
        id, title: wdAdapterCourseTitle(card, layout),
        status: layout.status ? wdAdapterStatus(card.querySelectorAll(layout.status)) : 'unknown',
        required: !layout.range || wdAdapterText(card.querySelector(layout.range)) !== '选修',
        route: `#/study/course/detail/subject-course/${id}/6/${page.subjectId}`,
      });
    }
    // The subject loader sets document.title for every layout, including those without a banner.
    // Only use it on a recognized subject route with valid course cards; the controller still matches SID and title.
    if (!page.title && page.courses.length) {
      page.title = (document.title || '').trim();
      if (page.title) page.subjectTitleSource = 'document';
    }
    for (const [type, ids] of ignored) page.issues.push(`已忽略非课程资源：类型 ${/^\d+$/u.test(type) ? type : 'unknown'}，数量 ${ids.size}`);
    const scopeRoot = document.querySelector('.subject-detail-page') || document.body;
    const hasLoading = wdAdapterHasLoadingIndicator(scopeRoot);
    const hasEmpty = wdAdapterHasEmptyIndicator(scopeRoot);
    if (!page.courses.length && catalogMeta.emptyCatalogGroups > 0 && !ignored.size && !hasEmpty) {
      page.issues.push(`检测到空壳正文目录组（${catalogMeta.emptyCatalogGroups} 个），且旧卡片回退未发现有效课程`);
    }
    if (page.courses.length && page.title) {
      page.recognition = {
        category: 'ok',
        code: 'ok',
        summary: '已识别',
        basis: `命中目录布局（${catalogMeta.layouts.join('+') || 'legacy'}），标题来源：${page.subjectTitleSource}`,
      };
    } else if (page.courses.length && !page.title) {
      page.recognition = {
        category: 'not-ready',
        code: 'subject-missing-title',
        summary: '页面未就绪',
        basis: '已识别课程但未找到专题标题（检查 .subject-banner/.banner-info .title-row .h3、introduce .h3 与 document.title）',
      };
    } else if (hasLoading) {
      page.recognition = {
        category: 'not-ready',
        code: 'subject-loading',
        summary: '页面未就绪',
        basis: '专题目录仍在加载中（检测到 .loading/[aria-busy="true"]/[data-loading="true"]）',
      };
    } else if (ignored.size) {
      page.recognition = {
        category: 'zero-results',
        code: 'subject-only-non-course',
        summary: '零结果',
        basis: '已命中已知目录控件，但全部为非课程资源（data-section-type != "10"），可执行课程 0 门',
      };
    } else if (catalogMeta.emptyCatalogGroups > 0) {
      page.recognition = hasEmpty
        ? {
          category: 'zero-results',
          code: 'subject-zero-courses',
          summary: '零结果',
          basis: '已命中专题正文目录容器（.catalog-state-info2/.catalog-state-info），页面显示暂无课程且旧卡片回退（.content.new）为 0 门',
        }
        : {
          category: 'not-ready',
          code: 'subject-empty-catalog-shell',
          summary: '页面未就绪',
          basis: `检测到空壳正文目录组（.catalog-state-info2/.catalog-state-info 共 ${catalogMeta.emptyCatalogGroups} 个，内含 0 门课），且旧卡片回退（.content.new）为 0 门`,
        };
    } else if (hasEmpty) {
      page.recognition = {
        category: 'zero-results',
        code: 'subject-zero-courses',
        summary: '零结果',
        basis: '专题页面显示暂无课程（已知选择器 .catalog-state-info2、.catalog-state-info、.content.new 均 0 门）',
      };
    } else if (catalogMeta.hiddenCardCount > 0) {
      page.recognition = {
        category: 'not-ready',
        code: 'subject-cards-hidden',
        summary: '页面未就绪',
        basis: `仅检测到隐藏状态的课程卡片（${catalogMeta.hiddenCardCount} 张），尚无可见课程`,
      };
    } else if (wdAdapterHasUnrecognizedContent(scopeRoot)) {
      page.recognition = {
        category: 'unsupported-structure',
        code: 'subject-unsupported-structure',
        summary: '不支持的结构',
        basis: '页面已有可见内容，但未匹配已知专题目录选择器（.catalog-state-info2、.catalog-state-info 或 .content.new .img.course-item [id*="studyBtn"]）',
      };
    } else {
      page.recognition = {
        category: 'not-ready',
        code: 'subject-not-ready',
        summary: '页面未就绪',
        basis: '尚未检测到专题主体目录容器（.subject-detail-page/.subject-catalog）或课程卡片（.content.new）',
      };
    }
  }
  if (page.kind === 'course') {
    page.title = wdAdapterTitle(document.querySelector('.course-side-title-row .text-overflow'));
    let stale = 0;
    let invalid = 0;
    const seen = new Set();
    for (const element of wdAdapterSectionElements(document)) {
      if (wdAdapterAttribute(element, 'course-id') !== page.courseId) { stale += 1; continue; }
      const id = wdAdapterSectionId(element);
      const type = Number(wdAdapterAttribute(element, 'section-type'));
      if (!id || !Number.isInteger(type) || type <= 0) { invalid += 1; continue; }
      if (seen.has(id)) continue;
      seen.add(id);
      const active = element.classList.contains('focus');
      page.sections.push({
        id, courseId: page.courseId, title: wdAdapterTitle(element.querySelector('.qcontent')), type,
        status: wdAdapterStatus(element.querySelectorAll('dd .item.start.pointer > span, dd .item.continue.pointer > span')),
        required: ![...element.querySelectorAll('dt .required-tag')].some(tag => wdAdapterText(tag) === '选修'), active,
      });
    }
    if (stale) page.issues.push(`课程页面内容尚未更新：不匹配课节 ${stale} 个`);
    if (invalid) page.issues.push(`课节标识或类型无法识别：${invalid} 个`);
    const active = page.sections.filter(section => section.active);
    if (active.length === 1) page.activeSectionId = active[0].id;
    else if (active.length > 1) page.issues.push('检测到多个活动课节');
    const sectionList = wdAdapterInspectSectionList(document, page, { stale, invalid, activeCount: active.length });
    page.sectionListReady = sectionList.ready;
    page.sectionListConfirmed = sectionList.confirmed;
    page.sectionListReason = sectionList.reason;
    if (sectionList.issue) page.issues.push(sectionList.issue);
    const resolvedMedia = wdAdapterResolveMedia(document, page);
    page.mediaTarget = { status: resolvedMedia.status, count: resolvedMedia.count, tag: resolvedMedia.tag, reason: resolvedMedia.reason };
    if (resolvedMedia.status === 'resolved') {
      const media = resolvedMedia.target;
      const currentTime = media.currentTime, duration = media.duration;
      const player = wdAdapterMediaState(media);
      const controls = new Set(wdAdapterPlayerControls(media).values());
      page.player = { id: player.id, seekRevision: player.seekRevision, seeking: media.seeking, readyState: media.readyState,
        muted: Boolean(media.muted), control: controls.size > 1 ? 'mixed' : controls.values().next().value ?? null };
      // A source lets play() start loading even when the platform uses preload="none".
      page.mediaReady = !media.paused || media.ended || media.readyState >= media.HAVE_METADATA
        || Boolean(media.currentSrc || media.srcObject || media.getAttribute('src')?.trim()
          || [...media.querySelectorAll('source[src]')].some(source => source.getAttribute('src').trim()));
      page.media = {
        ended: Boolean(media.ended),
        paused: Boolean(media.paused),
        currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : null,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      };
    } else if (resolvedMedia.status === 'ambiguous') {
      page.media = { ended: false, paused: true, currentTime: null, duration: null };
      page.issues.push(`检测到多个原生媒体播放器（${resolvedMedia.count} 个），无法确定当前课节目标播放器`);
    } else if (active.some(section => [5, 6].includes(section.type))) {
      page.issues.push('未识别本页媒体播放器');
    }
    if (sectionList.ready) {
      if (resolvedMedia.status === 'ambiguous' && active.some(section => [5, 6].includes(section.type))) {
        page.recognition = {
          category: 'unsupported-structure',
          code: 'course-ambiguous-media',
          summary: '不支持的结构',
          basis: `检测到多个可见原生媒体播放器（video,audio 共 ${resolvedMedia.count} 个），且未通过 data-section-id/data-resource-id/data-course-id 绑定唯一目标`,
        };
      } else {
        page.recognition = {
          category: 'ok',
          code: 'ok',
          summary: '已识别',
          basis: '已匹配课节清单（.chapter-list.chapter-all ul li dl[id*="show-sections"]）且结构就绪',
        };
      }
    } else if (!sectionList.meta.hasContainer) {
      const hasLoading = wdAdapterHasLoadingIndicator(document.body);
      if (hasLoading || !wdAdapterHasUnrecognizedContent(document.body)) {
        page.recognition = {
          category: 'not-ready',
          code: 'course-not-ready',
          summary: '页面未就绪',
          basis: hasLoading ? '课程页仍在加载中（检测到 .loading/[aria-busy="true"]）' : '尚未出现课节目录容器（.chapter-list.chapter-all）',
        };
      } else {
        page.recognition = {
          category: 'unsupported-structure',
          code: 'course-unsupported-structure',
          summary: '不支持的结构',
          basis: '课程页已有可见内容，但未匹配已知课节目录容器（.chapter-list.chapter-all ul li dl[id*="show-sections"]）',
        };
      }
    } else if (!page.sections.length && sectionList.meta.hasEmptyMarker) {
      page.recognition = {
        category: 'zero-results',
        code: 'course-zero-sections',
        summary: '零结果',
        basis: '课节容器 .chapter-list.chapter-all 已就绪，但课程下无可用课节（0 个）',
      };
    } else {
      page.recognition = {
        category: 'not-ready',
        code: 'course-section-list-incomplete',
        summary: '页面未就绪',
        basis: sectionList.reason || '课节清单尚未完整加载（.chapter-list.chapter-all ul li dl[id*="show-sections"]）',
      };
    }
  }
  if (page.kind === 'search') {
    const seen = new Set();
    for (const element of document.querySelectorAll('[id$="all-list"] div[id*="openDetail-"]')) {
      const title = element.querySelector(':scope > .search-page-title');
      if (!title || ![...element.querySelectorAll('.special-box .section-left span')].some(span => wdAdapterText(span) === '专题')) continue;
      const id = element.id.slice(element.id.lastIndexOf('openDetail-') + 'openDetail-'.length);
      const route = `#/study/subject/detail/${id}`;
      if (!wdAdapterSubjectPattern.test(route) || seen.has(id)) continue;
      seen.add(id);
      page.candidates.push({ id, title: wdAdapterTitle(title), route });
    }
    for (const link of document.querySelectorAll('[id$="all-list"] a[href]')) {
      const route = wdAdapterSafeSubjectLink(document, link.getAttribute('href'));
      if (!route) continue;
      const id = wdAdapterSubjectPattern.exec(route)[1];
      if (seen.has(id)) continue;
      seen.add(id);
      page.candidates.push({ id, title: wdAdapterTitle(link), route });
    }
    const hasInput = Boolean(document.querySelector('input[id$="searchContent"][name="keyword"], input[name="searchContent"]'));
    const hasButton = Boolean(document.querySelector('i[id$="searchBtn"]'));
    const resultList = [...document.querySelectorAll('[id$="all-list"]')].find(wdAdapterVisible) || document.querySelector('[id$="all-list"]');
    const searchLoading = wdAdapterHasLoadingIndicator(resultList || document.body);
    const searchEmpty = wdAdapterHasEmptyIndicator(resultList || document.body);
    if (page.candidates.length) {
      page.recognition = {
        category: 'ok',
        code: 'ok',
        summary: '已识别',
        basis: '命中搜索结果容器 [id$="all-list"] 中的专题候选',
      };
    } else if (searchLoading) {
      page.recognition = {
        category: 'not-ready',
        code: 'search-loading',
        summary: '页面未就绪',
        basis: '搜索结果仍在加载中（检测到 .loading/[aria-busy="true"]）',
      };
    } else if (!hasInput || !hasButton) {
      if (resultList && searchEmpty) {
        page.recognition = {
          category: 'zero-results',
          code: 'search-zero-results',
          summary: '零结果',
          basis: '搜索结果容器 [id$="all-list"] 显示无匹配结果（0 项）',
        };
      } else {
        page.recognition = {
          category: 'not-ready',
          code: 'search-controls-missing',
          summary: '页面未就绪',
          basis: '未找到搜索控件（input[id$="searchContent"][name="keyword"] / input[name="searchContent"] 与 i[id$="searchBtn"]）',
        };
      }
    } else if (!resultList) {
      page.recognition = searchEmpty
        ? {
          category: 'zero-results',
          code: 'search-zero-results',
          summary: '零结果',
          basis: '页面显示无搜索结果，且未渲染结果列表 [id$="all-list"]（0 项）',
        }
        : {
          category: 'not-ready',
          code: 'search-results-container-missing',
          summary: '页面未就绪',
          basis: '尚未出现搜索结果容器（[id$="all-list"]）',
        };
    } else {
      const visibleChildren = [...resultList.children].filter(wdAdapterVisible);
      const rawMatchedNodes = resultList.querySelectorAll('div[id*="openDetail-"], a[href]').length;
      if (searchEmpty || !visibleChildren.length) {
        page.recognition = {
          category: 'zero-results',
          code: 'search-zero-results',
          summary: '零结果',
          basis: '搜索结果容器 [id$="all-list"] 已就绪，但返回 0 条专题候选',
        };
      } else if (rawMatchedNodes > 0) {
        page.recognition = {
          category: 'zero-results',
          code: 'search-no-subject-results',
          summary: '零结果',
          basis: '搜索结果容器 [id$="all-list"] 仅有非专题条目或非本域专题链接（需 .special-box .section-left span="专题" 或同源 #/study/subject/detail/<SID>），专题候选 0 项',
        };
      } else {
        page.recognition = {
          category: 'unsupported-structure',
          code: 'search-unsupported-results',
          summary: '不支持的结构',
          basis: '搜索结果容器 [id$="all-list"] 已有可见条目，但未匹配已知专题节点（div[id*="openDetail-"] 或同源 a[href]）',
        };
      }
    }
  }
  page.relearn = wdAdapterRelearn(document, page);
  return page;
}

function createAdapter(win) {
  const read = () => ({ ...readPage(win.document, win.location.hash), online: win.navigator.onLine !== false });
  const navigate = (route, kind) => {
    if (typeof route !== 'string' || wdAdapterRoute(route).kind !== kind) return false;
    win.location.hash = route;
    return true;
  };
  const visibility = () => win.document.visibilityState === 'visible' ? 'visible' : 'hidden';
  const userActivation = () => win.navigator.userActivation?.isActive ?? null;
  const markMediaCommand = (media, type, call, playback = null) => {
    const paused = media.paused;
    const result = call();
    if (media.paused !== paused) wdAdapterMediaState(media).command = { type, at: win.performance.now(), playback };
    return result;
  };
  const pauseMedia = () => {
    const page = read();
    if (page.kind !== 'course') return false;
    const resolved = wdAdapterResolveMedia(win.document, page);
    if (resolved.status !== 'resolved') return false;
    try { markMediaCommand(resolved.target, 'pause', () => resolved.target.pause()); return true; } catch { return false; }
  };
  return {
    read,
    visibility, userActivation,
    watchPlayback(listener) {
      const doc = win.document;
      const visibilityChange = () => listener('visibility');
      const route = event => listener('route', wdAdapterRoute(new URL(event.newURL || win.location.href).hash));
      const controlInput = event => {
        if (!event.isTrusted || wdAdapterRoute(win.location.hash).kind !== 'course') return;
        const control = event.composedPath().find(node => node.matches?.(wdAdapterPlaybackControlSelector) && wdAdapterControlAction(node));
        if (!control) return;
        const target = wdAdapterResolveMedia(doc, read()).target;
        if (!target) return;
        const type = wdAdapterPlayerControls(target).get(control);
        if (!type || target.paused !== (type === 'play')) return;
        const player = wdAdapterMediaState(target);
        const playback = { initiator: 'player-control', gesture: true, userActivation: userActivation(),
          pausedBefore: target.paused, visibilityBefore: visibility(), mutedBefore: target.muted };
        player.controlInput = { type, at: win.performance.now(), playback };
        listener('control-input', { id: player.id, source: 'user', action: type, trusted: true, playback });
      };
      const media = event => {
        if (!event.target?.matches?.('video,audio')) return;
        const target = event.target;
        const player = wdAdapterMediaState(target);
        const type = event.type;
        if (type === 'seeking') { player.seekRevision += 1; return; }
        const at = win.performance.now();
        if (type === 'timeupdate') {
          if (target.paused || at - (player.lastSampleAt ?? -Infinity) < 750) return;
          player.lastSampleAt = at;
          listener(type, { id: player.id });
          return;
        }
        let source = event.isTrusted ? 'platform-or-browser' : 'unattributed';
        let playback = null;
        const precedingPlay = player.playback?.initiator ?? null;
        if (type === 'playing') {
          source = player.playSource || source;
          playback = player.playback;
        } else {
          if (player.command?.type === type && at - player.command.at < 2000) {
            source = 'assistant';
            playback = player.command.playback;
          } else if (event.isTrusted && player.controlInput?.type === type && at - player.controlInput.at < 2000) {
            source = 'user';
            playback = player.controlInput.playback;
          }
          player.command = player.controlInput = null;
          player.playSource = type === 'play' ? source : null;
          if (type === 'play') {
            player.playback = playback;
            player.lastSampleAt = null;
          }
        }
        listener(type, { id: player.id, source, trusted: event.isTrusted, playback,
          pausedAfter: target.paused, visibilityAfter: visibility(), precedingPlay });
      };
      const mediaEvents = ['play', 'playing', 'pause', 'timeupdate', 'seeking'];
      doc.addEventListener('visibilitychange', visibilityChange);
      win.addEventListener('hashchange', route);
      doc.addEventListener('click', controlInput, true);
      for (const type of mediaEvents) doc.addEventListener(type, media, true);
      return () => {
        doc.removeEventListener('visibilitychange', visibilityChange);
        win.removeEventListener('hashchange', route);
        doc.removeEventListener('click', controlInput, true);
        for (const type of mediaEvents) doc.removeEventListener(type, media, true);
      };
    },
    goSearch() { return navigate('#/search', 'search'); },
    searchKeyword(text) {
      if (read().kind !== 'search' || typeof text !== 'string' || !text.trim()) return false;
      const input = win.document.querySelector('input[id$="searchContent"][name="keyword"], input[name="searchContent"]');
      const button = win.document.querySelector('i[id$="searchBtn"]');
      if (!input || !button) return false;
      const category = [...win.document.querySelectorAll('[id*="searchType-"]')].find(element => wdAdapterText(element) === '专题');
      if (category) category.click();
      const currentInput = win.document.querySelector('input[id$="searchContent"][name="keyword"], input[name="searchContent"]');
      const currentButton = win.document.querySelector('i[id$="searchBtn"]');
      if (!currentInput || !currentButton) return false;
      const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(currentInput, text.trim());
      currentInput.dispatchEvent(new win.Event('input', { bubbles: true }));
      currentInput.dispatchEvent(new win.Event('change', { bubbles: true }));
      currentButton.click();
      return true;
    },
    openSubject(candidate) { return navigate(candidate?.route, 'subject'); },
    openCourse(course) { return navigate(course?.route, 'course'); },
    selectSection(id) {
      const page = read();
      if (page.kind !== 'course' || !page.sections.some(section => section.id === id)) return false;
      const findElement = () => wdAdapterSectionElements(win.document).find(element => wdAdapterSectionId(element) === id && wdAdapterAttribute(element, 'course-id') === page.courseId);
      let element = findElement();
      if (!element) return false;
      const chapter = element.closest('li');
      const hidden = element.closest('.hidden, [hidden]');
      if (hidden && chapter?.contains(hidden)) {
        const title = chapter.querySelector('.list-title[id*="list-item-"]');
        if (!title) return false;
        title.click();
        if (read().courseId !== page.courseId) return false;
        element = findElement();
        if (!element) return false;
      }
      element.click();
      return true;
    },
    pauseMedia,
    watchCurrentMedia(check) {
      let active = true;
      const changed = event => { if (active && event.target?.matches?.('video,audio')) check(); };
      const events = ['loadstart', 'loadedmetadata', 'play', 'playing', 'volumechange'];
      for (const type of events) win.document.addEventListener(type, changed, true);
      const observer = typeof win.MutationObserver === 'function' ? new win.MutationObserver(records => {
        if (active && records.some(record => [...record.addedNodes].some(node => node.matches?.('video,audio') || node.querySelector?.('video,audio')))) check();
      }) : null;
      observer?.observe(win.document.documentElement, { childList: true, subtree: true });
      return () => { active = false; observer?.disconnect(); for (const type of events) win.document.removeEventListener(type, changed, true); };
    },
    muteCurrentMedia(course, runId) {
      const page = read(); const active = page.sections.find(section => section.id === page.activeSectionId);
      if (!runId || page.kind !== 'course' || page.courseId !== course?.id || page.route !== course.route || page.relearn?.manualRequired || !active || active.courseId !== course.id || ![5, 6].includes(active.type) || page.issues.some(issue => !issue.includes('未识别本页媒体播放器'))) return false;
      const resolved = wdAdapterResolveMedia(win.document, page);
      if (resolved.status !== 'resolved') return false;
      try { if (!resolved.target.muted) resolved.target.muted = true; return true; } catch { return false; }
    },
    leaveLearning(subjectRoute) {
      if (read().kind !== 'course') return false;
      pauseMedia();
      if (!navigate(subjectRoute, 'subject')) navigate('#/home', 'home');
      return true;
    },
    async playCurrentMedia(mute = true, expected = null) {
      const page = read();
      if (page.kind !== 'course') return false;
      if (expected && (page.route !== expected.route || page.activeSectionId !== expected.sectionId
        || page.player?.id !== expected.playerId || page.relearn?.manualRequired)) return false;
      const resolved = wdAdapterResolveMedia(win.document, page);
      if (resolved.status !== 'resolved') return false;
      const media = resolved.target;
      if (!media.paused || media.ended) return false;
      if (expected?.gesture && userActivation() === false) {
        expected.onNativeError?.('NotAllowedError');
        return false;
      }
      const playback = { initiator: expected?.initiator ?? 'queue-start', gesture: expected?.gesture === true,
        userActivation: userActivation(), pausedBefore: media.paused, visibilityBefore: visibility(), mutedBefore: media.muted };
      try {
        let pendingPlay;
        try {
          if (mute) media.muted = true;
          pendingPlay = markMediaCommand(media, 'play', () => media.play(), playback);
        } finally {
          expected?.onCall?.({ ...playback, pausedAfter: media.paused, visibilityAfter: visibility(), mutedAfter: media.muted });
        }
        await pendingPlay;
        return true;
      }
      catch (error) {
        const name = error?.name;
        expected?.onNativeError?.(['NotAllowedError', 'NotSupportedError', 'AbortError', 'SecurityError'].includes(name) ? name : 'OtherError');
        return false;
      }
    },
    diagnose() {
      const page = read();
      const types = {};
      const statuses = { 'not-started': 0, learning: 0, completed: 0, unknown: 0 };
      for (const item of [...page.courses, ...page.sections]) statuses[item.status] += 1;
      for (const section of page.sections) types[section.type] = (types[section.type] || 0) + 1;
      return {
        kind: page.kind, courses: page.courses.length, candidates: page.candidates.length, sections: page.sections.length, types, statuses, issues: page.issues,
        ...(page.recognition ? { recognition: page.recognition } : {}),
        ...(page.kind === 'subject' ? {
          subjectTitleSource: page.subjectTitleSource,
          catalogLayouts: page.catalogMeta?.layouts || [],
          emptyCatalogGroups: page.catalogMeta?.emptyCatalogGroups || 0,
          fallbackToLegacy: Boolean(page.catalogMeta?.fallbackToLegacy),
          hiddenCardCount: page.catalogMeta?.hiddenCardCount || 0,
        } : {}),
        ...(page.kind === 'course' ? {
          sectionListReady: page.sectionListReady,
          sectionListReason: page.sectionListReason || '',
          mediaTarget: page.mediaTarget,
        } : {}),
      };
    },
  };
}

const wdQueueStatuses = new Set(['completed', 'learning', 'not-started', 'unknown']);
const wdQueueId = /^[A-Za-z0-9_-]+$/u;
const wdQueueStrings = value => Array.isArray(value) && value.every(id => typeof id === 'string') && new Set(value).size === value.length;

function isTaskComplete(task) {
  if (!task?.subject) return false;
  const selected = task.courses.filter(course => course.selected && (task.scope === 'all' || course.required));
  return Boolean(selected.length && selected.every(course => task.done.includes(course.id) && !task.recheck?.includes(course.id)) && !task.skipped.length && !task.deferred?.length && !task.recheck?.length);
}

function validWindow(window) {
  const parse = (value, end) => {
    const match = /^(\d{1,2}):(\d{2})$/u.exec(value || '');
    return match && +match[2] < 60 && (+match[1] < 24 || (end && +match[1] === 24 && +match[2] === 0)) ? +match[1] * 60 + +match[2] : null;
  };
  const start = parse(window?.start, false), end = parse(window?.end, true);
  return start !== null && end !== null && start !== end;
}

function wdQueueSubject(subject) {
  return subject === null || (subject && typeof subject.id === 'string' && wdQueueId.test(subject.id) && typeof subject.title === 'string' && subject.title.trim() && subject.route === `#/study/subject/detail/${subject.id}`);
}
function wdQueueCourses(courses, subject, legacy = false) {
  return Array.isArray(courses) && new Set(courses.map(course => course?.id)).size === courses.length && courses.every(course => course && typeof course.id === 'string' && wdQueueId.test(course.id) && typeof course.title === 'string' && typeof course.required === 'boolean' && typeof course.selected === 'boolean' && (legacy || wdQueueStatuses.has(course.status)) && subject && course.route === `#/study/course/detail/subject-course/${course.id}/6/${subject.id}`);
}
function wdQueueTask(task, legacy = false) {
  const deferred = task?.deferred ?? [];
  if (task?.selectionMode !== undefined && !['all-pending', 'specific'].includes(task.selectionMode)) return false;
  if (task?.recheck !== undefined && (!wdQueueStrings(task.recheck) || !task.recheck.every(id => task.courses?.some(course => course.id === id)))) return false;
  return task && typeof task.id === 'string' && task.id && typeof task.target === 'string' && task.target.trim() && ['all', 'required'].includes(task.scope) && wdQueueSubject(task.subject) && wdQueueCourses(task.courses, task.subject, legacy) && wdQueueStrings(task.done) && wdQueueStrings(task.skipped) && (task.current === null || typeof task.current === 'string') && [...task.done, ...task.skipped, ...(task.current ? [task.current] : [])].every(id => task.courses.some(course => course.id === id)) && !task.done.some(id => task.skipped.includes(id) && !task.recheck?.includes(id)) && Array.isArray(deferred) && new Set(deferred.map(item => item?.courseId)).size === deferred.length && deferred.every(item => item && typeof item.courseId === 'string' && typeof item.reason === 'string' && item.reason.trim() && item.reason.length <= 500 && task.courses.some(course => course.id === item.courseId) && (!task.done.includes(item.courseId) || task.recheck?.includes(item.courseId)) && !task.skipped.includes(item.courseId));
}

function normalizeQueue(value) {
  if (value === undefined || value === null) return null;
  const error = () => { throw Error('本地任务版本或格式无法识别，已保留原数据，请先处理后再使用。'); };
  if (!value || typeof value.taskId !== 'string' || !value.taskId || !Number.isInteger(value.revision) || value.revision <= 0) return error();
  if (value.version === 1) {
    const task = { id: value.taskId, target: value.config?.target, scope: value.config?.scope, subject: value.subject, courses: value.courses, done: value.done, skipped: [], current: value.current };
    if (!validWindow(value.config?.window) || !wdQueueTask(task, true)) return error();
    return normalizeQueue({ version: 2, taskId: value.taskId, revision: value.revision, window: value.config.window, tasks: [{ ...task, courses: task.courses.map(course => ({ ...course, status: wdQueueStatuses.has(course.status) ? course.status : 'unknown' })) }], activeTaskId: task.id });
  }
  if (value.version !== 2 || !validWindow(value.window) || !Array.isArray(value.tasks) || !value.tasks.every(task => wdQueueTask(task)) || new Set(value.tasks.map(task => task.id)).size !== value.tasks.length || new Set(value.tasks.filter(task => task.subject).map(task => task.subject.id)).size !== value.tasks.filter(task => task.subject).length || !(value.activeTaskId === null || value.tasks.some(task => task.id === value.activeTaskId))) return error();
  if (value.automation !== undefined && (!value.automation || typeof value.automation.enabled !== 'boolean' || typeof value.automation.resumeOnReload !== 'boolean')) return error();
  if (value.automation?.mute !== undefined && typeof value.automation.mute !== 'boolean') return error();
  if (value.runRequested !== undefined && typeof value.runRequested !== 'boolean') return error();
  // Only the public queue schema is persisted; transient state and unrelated keys are excluded.
  return { version: 2, taskId: value.taskId, revision: value.revision, window: { start: value.window.start, end: value.window.end }, activeTaskId: value.activeTaskId,
    automation: { enabled: value.automation?.enabled === true, resumeOnReload: value.automation?.resumeOnReload === true, mute: value.automation?.mute !== false }, runRequested: value.automation?.enabled === true && value.runRequested === true,
    tasks: value.tasks.map(task => ({ id: task.id, target: task.target, scope: task.scope, selectionMode: task.selectionMode || 'all-pending', recheck: [...(task.recheck || [])], subject: task.subject ? { id: task.subject.id, title: task.subject.title, route: task.subject.route } : null, courses: task.courses.map(({ id, title, route, required, status, selected }) => ({ id, title, route, required, status, selected })), done: [...task.done], skipped: [...task.skipped], deferred: (task.deferred || []).map(({courseId, reason}) => ({courseId, reason})), current: task.current })) };
}

function mergeCourses(previous, incoming, selectionMode = 'all-pending') {
  const old = new Map(previous.map(course => [course.id, course]));
  const result = incoming.map(({ id, title, route, required, status }) => ({ id, title, route, required: required === true, status: wdQueueStatuses.has(status) ? status : 'unknown', selected: old.has(id) ? old.get(id).selected : selectionMode !== 'specific' && ['learning', 'not-started'].includes(status) }));
  const seen = new Set(result.map(course => course.id));
  for (const course of previous) if (!seen.has(course.id)) result.push({ ...course, status: 'unknown' });
  return result;
}

const wdPlaybackLogLimit = 400;

function wdPlaybackNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function createPlaybackLog(now) {
  let enabled = false;
  let route = null;
  let pageKind = null;
  let routeNumber = 0;
  let media = null;
  let next = 0;
  let total = 0;
  const entries = new Array(wdPlaybackLogLimit);

  const record = (event, { visibility, runnerStatus, courseRetries, resumeFailures }, details = {}) => {
    if (!enabled) return;
    entries[next] = {
      at: now().toISOString(), event, visibility, runnerStatus, page: pageKind, route: routeNumber || null,
      player: media?.id ?? null, paused: media?.paused ?? null, ended: media?.ended ?? null,
      currentTime: wdPlaybackNumber(media?.currentTime), readyState: media?.readyState ?? null,
      control: media?.control ?? null, muted: media?.muted ?? null, mediaTag: media?.tag ?? null,
      mediaTarget: media?.target ?? null, visiblePlayers: media?.count ?? null, courseRetries, resumeFailures, ...details,
    };
    next = (next + 1) % wdPlaybackLogLimit;
    total += 1;
  };

  return {
    get enabled() { return enabled; },
    setEnabled(value) { enabled = value; },
    observe(page, context) {
      if (!enabled) return;
      if (page.route === route && !Object.hasOwn(page, 'media')) return;
      media = page.media || page.mediaTarget ? { ...page.media, id: page.player?.id, readyState: page.player?.readyState,
        control: page.player?.control, muted: page.player?.muted, tag: page.mediaTarget?.tag,
        target: page.mediaTarget?.reason, count: page.mediaTarget?.count } : null;
      if (page.route === route) return;
      route = page.route;
      pageKind = page.kind;
      routeNumber += 1;
      record('route', context);
    },
    record,
    text() {
      if (!total) return '';
      const size = Math.min(total, wdPlaybackLogLimit);
      const lines = [`网大助手播放诊断｜保留 ${size} 条｜覆盖 ${total - size} 条`];
      for (let offset = 0; offset < size; offset += 1) {
        lines.push(JSON.stringify(entries[(next - size + offset + wdPlaybackLogLimit) % wdPlaybackLogLimit]));
      }
      return lines.join('\n');
    },
  };
}





const wdControllerTaskKey = 'wangda-assistant.task';
const wdControllerLeaseKey = 'wangda-assistant.lease';
const wdControllerLock = 'wangda-assistant.run';
const wdControllerEndedConfirmTimeout = 90000;
const wdControllerPauseGrace = 2000;
const wdControllerProgressTimeout = 8000;
const wdControllerPlayTimeout = 30000;
const wdControllerProgressDelta = 0.5;
const wdControllerResumeBackoff = [5000, 10000];

function wdControllerDescribeRecognitionFailure(page, { stage = 'subject', expectedSubject = null, timedOut = false } = {}) {
  const prefix = timedOut ? '加载超时' : '识别失败';
  if (!page || page.kind === 'unknown') {
    const basis = page?.recognition?.basis || '路由未匹配已知专区/课程/搜索规则（需 #/study/subject/detail/<SID>、#/study/course/detail/... 或 #/search）';
    return `${prefix}（不支持的结构）：当前页面路由无法识别。依据：${basis}。请点击“页面诊断”核对。`;
  }
  if (stage === 'search-page' || stage === 'results') {
    if (page.kind !== 'search') {
      return `${prefix}（页面未就绪）：尚未处于专区搜索页（当前类型：${page.kind}，需 #/search）。请手动打开专区后读取，或点击“页面诊断”核对。`;
    }
    const rec = page.recognition;
    if (rec?.category === 'zero-results') return `${timedOut ? '搜索结束' : '识别失败'}（零结果）：未找到匹配专区候选。依据：${rec.basis}。请核对关键词或手动打开专区后读取，可点击“页面诊断”核对。`;
    if (rec?.category === 'unsupported-structure') return `搜索识别失败（不支持的结构）：页面搜索结果结构暂不支持。依据：${rec.basis}。请点击“页面诊断”核对。`;
    const basis = rec?.basis || (stage === 'search-page'
      ? '未找到搜索控件（input[id$="searchContent"][name="keyword"] / input[name="searchContent"] 与 i[id$="searchBtn"]）'
      : '尚未出现搜索结果容器（[id$="all-list"]）或结果仍在加载');
    return `${prefix}（页面未就绪）：搜索页面或结果尚未就绪。依据：${basis}。请稍后重试或手动打开专区后读取，可点击“页面诊断”核对。`;
  }
  if (page.kind !== 'subject') {
    return `${prefix}（页面未就绪）：当前不在专区详情页（当前类型：${page.kind}，需 #/study/subject/detail/<SID>）。请进入对应专区页后读取，可点击“页面诊断”核对。`;
  }
  if (expectedSubject && page.subjectId !== expectedSubject.id) {
    return `${prefix}（页面未就绪）：当前专区标识与目标专区不一致（需匹配目标专区 SID）。请核对专区后重试，可点击“页面诊断”核对。`;
  }
  if (page.courses?.length) {
    if (!page.title?.trim()) {
      return '未识别当前专区标题（页面未就绪），已暂停。依据：未从 .subject-banner/.banner-info .title-row .h3、introduce .h3 或 document.title 读到标题。请查看页面诊断后重试读取。';
    }
    if (expectedSubject && normalizeTitle(page.title) !== normalizeTitle(expectedSubject.title)) {
      return '当前专区标题与所选结果不一致，已暂停。依据：专区标题规范化比对不匹配。请核对专区后重试。';
    }
  }
  const rec = page.recognition;
  if (rec?.category === 'zero-results') {
    return `${prefix}（零结果）：当前专区未读取到可执行课程。依据：${rec.basis}。请点击“页面诊断”核对。`;
  }
  if (rec?.category === 'unsupported-structure') {
    return `${prefix}（不支持的结构）：当前专区页面结构暂不支持。依据：${rec.basis}。请点击“页面诊断”查看详情。`;
  }
  const basis = rec?.basis || '尚未检测到可用专区课程列表（检查 .catalog-state-info2、.catalog-state-info 或 .content.new [id*="studyBtn"]）';
  return `${prefix}（页面未就绪）：专区标题或课程列表尚未加载完成。依据：${basis}。请等待加载完成后重试，或点击“页面诊断”核对。`;
}

function createController(options) {
  const { adapter, storage, locks } = options;
  const now = options.now || (() => new Date());
  const owner = options.owner || globalThis.crypto.randomUUID();
  const unique = () => `${owner}-${now().getTime()}-${++serial}`;
  const schedule = options.setInterval || globalThis.setInterval;
  const unschedule = options.clearInterval || globalThis.clearInterval;
  let serial = 0;
  let record = null;
  let task = null;
  let identity = null;
  let runTaskId = null;
  let draft = null;
  let target = '';
  let problem = null;
  let currentSectionTitle = '';
  let currentPlayback = null;
  const defaultWindow = { start: '09:00', end: '24:00' };
  const pendingNotice = '有待学课程，请手动点击开始继续。';
  let status = 'paused';
  let message = '已暂停，确认配置和课程后点击开始。';
  let candidates = [];
  let blocked = false;
  let destroyed = false;
  let held = false;
  let acquiring = false;
  let releaseLock = null;
  let lockRequest = null;
  let runId = null;
  let generation = 0;
  let timer = null;
  let preparing = null;
  let pending = null;
  let grace = null;
  let loading = null;
  let confirmWait = null;
  let sectionConfirm = null;
  let lastOwnedPage = null;
  let needOpen = false;
  let ticking = false;
  let mediaHealth = null;
  let gesturePlayback = null;
  let playbackAttention = null;
  let stopMediaWatch = null;
  let recovery = null;
  let restorePending = false;
  let visibility = adapter.visibility?.() || 'visible';
  let visibleSince = -Infinity;
  let attemptedWhileHidden = false;
  let lastDiagnosticTick = null;
  let stopPlaybackWatch = null;
  const playbackLog = createPlaybackLog(now);
  const retries = new Map();
  const defaultAutomation = { enabled: false, resumeOnReload: false, mute: true };
  const listeners = new Set();
  const copy = value => JSON.parse(JSON.stringify(value));
  const isDone = (item, id) => Boolean(item?.done?.includes(id) && !item.recheck?.includes(id));
  const isOnOwnedLearningPage = () => {
    if (destroyed || !task?.current || !task?.subject || record?.activeTaskId !== task.id) return false;
    if (typeof adapter?.read !== 'function') return false;
    try {
      const page = adapter.read();
      return page.kind === 'course' && task.current === page.courseId && task.subject.id === page.subjectId && task.courses.some(course => course.id === page.courseId && course.route === page.route);
    } catch {
      return Boolean(lastOwnedPage && lastOwnedPage.taskId === task.id && lastOwnedPage.courseId === task.current);
    }
  };
  const getState = () => ({ status, playGesture: Boolean(gesturePlayback?.ready && visibility === 'visible'), phase: restorePending ? 'resuming' : recovery?.network ? 'offline' : recovery ? 'retrying' : confirmWait ? 'confirming' : status, message, unavailable: blocked, onOwnedLearningPage: isOnOwnedLearningPage(), window: copy(record?.window || defaultWindow), automation: copy(record?.automation || defaultAutomation), tasks: copy(record?.tasks || []), activeTaskId: record?.activeTaskId || null, currentCourseId: task?.current || null, currentSectionTitle, currentPlayback: copy(currentPlayback), candidates: copy(candidates), draft: copy(draft), problem: copy(problem) });
  const emit = () => { const state = getState(); for (const listener of listeners) listener(state); };
  const tell = text => { message = text; emit(); return false; };
  const milliseconds = () => now().getTime();
  const retryKey = () => `${task?.id}:${task?.current}`;
  const logContext = () => ({ visibility, runnerStatus: status, courseRetries: retries.get(retryKey()) || 0, resumeFailures: mediaHealth?.failures || 0 });
  const logPlayback = (event, details) => {
    if (playbackLog.enabled) playbackLog.record(event, logContext(), details);
  };
  const observePlayback = page => {
    if (playbackLog.enabled) playbackLog.observe(page, logContext());
  };
  const refreshVisibility = () => {
    const next = adapter.visibility?.() || 'visible';
    if (next === visibility) return;
    const previous = visibility;
    visibility = next;
    if (next === 'visible') visibleSince = milliseconds();
    else attemptedWhileHidden = false;
    logPlayback('visibility', { previous });
  };
  const setPlaybackLogging = enabled => {
    if (destroyed || playbackLog.enabled === Boolean(enabled)) return;
    if (!enabled) {
      logPlayback('recording-stopped');
      playbackLog.setEnabled(false);
    } else {
      lastDiagnosticTick = null;
      refreshVisibility();
      playbackLog.setEnabled(true);
      try { observePlayback(adapter.read()); } catch { /* Logging remains available during page updates. */ }
      logPlayback('recording-started');
    }
  };
  const endMediaRequest = (outcome, reason) => {
    const request = mediaHealth?.request;
    if (!request) return;
    logPlayback('recovery-result', { mode: request.resume ? 'resume' : 'start', outcome, reason, playResult: request.result });
    mediaHealth.request = null;
  };
  const clearMediaHealth = reason => {
    endMediaRequest('cancelled', reason);
    const previous = mediaHealth?.failures;
    mediaHealth = null;
    if (previous) logPlayback('failure-count', { counter: 'resume', previous, reason });
    if (message.startsWith('播放已暂停，正在自动恢复播放')) message = '正在按平台课节状态连续学习。';
  };
  const endCourseRetry = outcome => {
    if (recovery?.attempt) logPlayback('retry-end', { attempt: recovery.attempt, outcome });
    recovery = null;
  };
  const clearCourseRetries = reason => {
    const previous = retries.get(retryKey());
    if (!previous) return;
    retries.delete(retryKey());
    logPlayback('failure-count', { counter: 'course', previous, reason });
  };
  const notify = text => { try { options.notify?.(text); } catch { /* Notifications are optional. */ } };
  const pauseOwnedMedia = reason => {
    logPlayback('pause-command', { source: 'assistant', reason });
    return adapter.pauseMedia();
  };
  const readStored = () => {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') throw Error('存储不可用，无法安全保存任务。');
    const value = storage.get(wdControllerTaskKey);
    return normalizeQueue(value);
  };
  const sameTask = value => identity ? value?.taskId === identity.taskId && value.revision === identity.revision : value === null;
  const ownLease = lease => lease?.owner === owner && lease.runId === runId && lease.taskId === runTaskId;
  const release = () => {
    if (!held) return;
    try { const value = storage.get(wdControllerLeaseKey); if (value?.owner === owner && value.runId === runId) storage.set(wdControllerLeaseKey, null); } catch { blocked = true; message = '本地存储写入失败，已停止。'; }
    held = false;
    const finish = releaseLock;
    releaseLock = null;
    runId = null;
    finish?.();
  };
  const ownsCurrentLearningPage = () => {
    if (!task?.current || !task?.subject || record?.activeTaskId !== task.id) return false;
    try {
      const page = adapter.read();
      const owned = page.kind === 'course' && task.current === page.courseId && task.subject.id === page.subjectId && task.courses.some(course => course.id === page.courseId && course.route === page.route);
      if (owned) lastOwnedPage = { taskId: task.id, courseId: task.current, route: page.route };
      else if (lastOwnedPage?.taskId === task.id && lastOwnedPage.courseId === task.current) lastOwnedPage = null;
      return owned;
    } catch {
      return Boolean(lastOwnedPage && lastOwnedPage.taskId === task.id && lastOwnedPage.courseId === task.current);
    }
  };
  const stop = (text, leave = false, complete = false, preserveRun = false) => {
    gesturePlayback = null;
    currentPlayback = null;
    const wasRunning = status === 'running';
    restorePending = false;
    // Write the stop intent only while this runner still owns both the task revision and lease.
    if (!preserveRun && record?.runRequested) {
      try {
        if (held && sameTask(readStored()) && ownLease(storage.get(wdControllerLeaseKey))) {
          const next = normalizeQueue({ ...record, runRequested: false, revision: identity.revision + 1 });
          storage.set(wdControllerTaskKey, next); record = next; identity = { taskId: next.taskId, revision: next.revision };
          task = record.tasks.find(item => item.id === record.activeTaskId) || null;
        }
      } catch { blocked = true; text += ' 停止状态保存失败，请关闭自动恢复后再使用。'; }
    }
    generation += 1;
    stopMediaWatch?.(); stopMediaWatch = null;
    if (timer !== null) unschedule(timer);
    timer = null;
    preparing = pending = grace = loading = confirmWait = sectionConfirm = null;
    if (wasRunning && !complete && task?.current && /人工|播放|媒体已暂停|课节|超时|页面操作未成功|页面读取或操作异常/u.test(text)) problem = { taskId: task.id, courseId: task.current, reason: text };
    if (wasRunning && !complete && !text.startsWith('已暂停，继续学习') && /人工|手动|播放|课节|超时|登录已失效|平台学习限制|待处理/u.test(text)) {
      logPlayback('manual-intervention', { trigger: playbackAttention?.trigger || 'runner-stop' });
    }
    endCourseRetry('stopped');
    clearMediaHealth('runner-stop');
    status = complete ? 'complete' : 'paused';
    message = text;
    if (wasRunning && ownsCurrentLearningPage()) {
      try {
        if (!playbackAttention || leave) pauseOwnedMedia('runner-stop');
        if (leave) {
          if (adapter.leaveLearning(task.subject.route) === false) message += ' 页面操作未能完成，请手动停止学习。';
          else lastOwnedPage = null;
        }
      } catch { message += ' 页面操作未能完成，请手动停止学习。'; }
    }
    release();
    emit();
  };
  const storageError = error => { blocked = true; stop(error.message?.includes('本地') || error.message?.includes('存储') ? error.message : '本地存储读写失败，已停止。', true); return false; };
  const verify = (requireLease = held) => {
    try {
      if (!sameTask(readStored())) { stop('任务已在其他标签更新，请刷新后确认新任务。', true); return false; }
      if (requireLease) {
        const lease = storage.get(wdControllerLeaseKey);
        // The held Web Lock remains exclusive even if background throttling delays lease renewal.
        if (!ownLease(lease)) { stop('执行权限已失效，已暂停；请重新确认任务。', true); return false; }
      }
      return true;
    } catch (error) { return storageError(error); }
  };
  const lease = () => storage.set(wdControllerLeaseKey, { owner, taskId: runTaskId, runId, expiresAt: milliseconds() + 5000 });
  const acquire = async () => {
    if (destroyed || blocked || acquiring) return false;
    if (held) return verify();
    if (!locks || typeof locks.request !== 'function') return tell('浏览器不支持同源执行锁，请使用新版 Chrome 或 Edge。');
    acquiring = true;
    const token = generation;
    return new Promise(resolve => {
      // A release resolves the lease holder before the browser finishes its lock request.
      lockRequest = Promise.resolve(lockRequest).then(() => locks.request(wdControllerLock, { mode: 'exclusive', ifAvailable: true }, async lock => {
        acquiring = false;
        if (!lock || destroyed || generation !== token) { resolve(tell('另一标签正在操作任务，请先在那里暂停。')); return; }
        try {
          if (!verify(false)) { resolve(false); return; }
          const foreign = storage.get(wdControllerLeaseKey);
          if (foreign && foreign.expiresAt > milliseconds() && foreign.owner !== owner) { resolve(tell('另一标签正在运行，请先在那里暂停。')); return; }
          held = true;
          runId = unique();
          runTaskId = record?.taskId || null;
          const lifetime = new Promise(finish => { releaseLock = finish; });
          lease();
          resolve(true);
          await lifetime;
        } catch (error) { acquiring = false; storageError(error); resolve(false); }
      })).catch(error => { acquiring = false; blocked = true; stop('无法获取浏览器执行锁，已停止。'); resolve(false); });
    });
  };
  const persist = () => {
    if (!held || !verify()) return false;
    try {
      const next = normalizeQueue({ ...record, revision: (identity?.revision || 0) + 1 });
      storage.set(wdControllerTaskKey, next);
      record = next; identity = { taskId: next.taskId, revision: next.revision };
      task = record.tasks.find(item => item.id === record.activeTaskId) || null;
      if (status === 'complete' && nextEntry()) { status = 'paused'; message = pendingNotice; }
      runTaskId = record.taskId; lease(); emit(); return true;
    } catch (error) { return storageError(error); }
  };
  const ensureRecord = () => { if (!record) record = { version: 2, taskId: unique(), revision: 0, window: copy(defaultWindow), tasks: [], activeTaskId: null }; };
  const watch = () => { if (timer === null) timer = schedule(() => { void tick(); }, 1000); };
  const editable = () => !destroyed && !blocked && !restorePending && !['running', 'preparing', 'waiting'].includes(status);
  const edit = async (fn, retainRun = false) => {
    if (!editable()) return tell('请先暂停，再修改任务。');
    const token = generation;
    if (!await acquire() || token !== generation || !held || !verify()) return false;
    try { return await fn(); } catch (error) { return storageError(error); }
    finally { if (!retainRun || !['running', 'waiting'].includes(status)) release(); }
  };
  const validPage = (page, subject = null) => page.kind === 'subject' && typeof page.subjectId === 'string' && page.title?.trim() && page.route === `#/study/subject/detail/${page.subjectId}` && page.courses?.length && (!subject || (page.subjectId === subject.id && normalizeTitle(page.title) === normalizeTitle(subject.title)));
  const collectPage = (page, refreshId = null) => {
    if (page.relearn?.manualRequired) return tell(`遇到“重新学习”提示。${page.relearn.reason} 处理后请重新读取专区。`);
    const existing = refreshId ? record?.tasks.find(item => item.id === refreshId) : null;
    if (!validPage(page, existing?.subject)) return tell(wdControllerDescribeRecognitionFailure(page, { stage: 'subject', expectedSubject: existing?.subject, timedOut: false }));
    if (refreshId) {
      if (!existing) return false;
      existing.courses = mergeCourses(existing.courses, page.courses, existing.selectionMode);
      if (!persist()) return false;
      message = '课程清单已刷新。' + (nextEntry() ? pendingNotice : ''); emit(); return true;
    }
    candidates = [];
    draft = { target: target || page.title, selectionMode: 'all-pending', subject: { id: page.subjectId, title: page.title, route: page.route }, courses: mergeCourses([], page.courses) };
    message = '已读取待添加清单，请核对课程勾选后添加。'; emit(); return true;
  };
  const collectDraft = async () => edit(() => { try { return collectPage(adapter.read()); } catch { return tell('当前页面读取失败，请稍后重试。'); } });
  const draftSetSelection = (id, selected) => {
    if (!editable() || !draft) return false;
    const course = draft.courses.find(item => item.id === id); if (!course) return false;
    course.selected = Boolean(selected); emit(); return true;
  };
  const selectCourses = (taskId, mode) => {
    if (!['unfinished', 'required', 'none', 'completed'].includes(mode) || !editable()) return false;
    const apply = (courses, item = null) => {
      for (const course of courses) course.selected = Boolean((mode === 'completed' ? course.selected || course.status === 'completed' || item?.done.includes(course.id) : mode !== 'none' && ['not-started', 'learning'].includes(course.status) && !isDone(item, course.id)) && (mode !== 'required' || course.required) && (item?.scope !== 'required' || course.required));
      emit(); return true;
    };
    if (taskId === null) return draft ? apply(draft.courses) : false;
    return edit(() => { const item = record?.tasks.find(item => item.id === taskId); return item ? apply(item.courses, item) && persist() : false; });
  };
  const discardDraft = () => { if (!editable()) return false; draft = null; candidates = []; target = ''; emit(); return true; };
  const addDraft = async () => edit(() => {
    if (!draft) return tell('请先读取待添加清单。');
    if (record?.tasks.some(item => item.subject?.id === draft.subject.id)) return tell('该专区已在任务队列中，请刷新已有清单。');
    ensureRecord(); const next = { id: unique(), ...copy(draft), scope: 'all', done: [], skipped: [], current: null };
    record.tasks.push(next); if (!record.activeTaskId) record.activeTaskId = next.id;
    if (!persist()) return false; draft = null; candidates = []; target = ''; message = '专区已加入队列。' + (nextEntry() ? pendingNotice : ''); emit(); return true;
  });
  const setSelection = async (taskId, id, selected) => edit(() => {
    const item = record?.tasks.find(item => item.id === taskId)?.courses.find(course => course.id === id); if (!item) return false;
    item.selected = Boolean(selected); return persist();
  });
  const setTaskMode = async (taskId, mode) => {
    if (!['all-pending', 'specific'].includes(mode) || !editable()) return false;
    const apply = item => {
      if (!item) return false;
      if (item.selectionMode === mode) return true;
      item.selectionMode = mode;
      for (const course of item.courses) course.selected = mode === 'all-pending' && ['not-started', 'learning'].includes(course.status) && !isDone(item, course.id) && (item.scope !== 'required' || course.required);
      return true;
    };
    if (taskId === null) { const changed = apply(draft); if (changed) emit(); return changed; }
    return edit(() => { const item = record?.tasks.find(item => item.id === taskId); return apply(item) && persist(); });
  };
  const recheckCompleted = async taskId => edit(() => {
    const item = record?.tasks.find(item => item.id === taskId);
    if (!item) return false;
    const ids = item.courses.filter(course => course.selected && (item.scope === 'all' || course.required) && (item.done.includes(course.id) || course.status === 'completed')).map(course => course.id);
    if (!ids.length) return tell('请先勾选需要复查的已完成课程。');
    item.recheck = [...new Set([...(item.recheck || []), ...ids])];
    item.skipped = item.skipped.filter(id => !ids.includes(id)); item.deferred = (item.deferred || []).filter(entry => !ids.includes(entry.courseId));
    if (!persist()) return false;
    message = `已安排 ${ids.length} 门课程复查。`; emit(); return true;
  });
  const removeTask = async taskId => edit(() => {
    if (!record?.tasks.some(item => item.id === taskId)) return false;
    record.tasks = record.tasks.filter(item => item.id !== taskId);
    if (record.activeTaskId === taskId) record.activeTaskId = record.tasks[0]?.id || null;
    if (problem?.taskId === taskId) problem = null;
    return persist();
  });
  const clearCompletedTasks = async () => {
    if (destroyed || blocked || restorePending || status === 'preparing') return false;
    const running = ['running', 'waiting'].includes(status);
    const clear = () => {
      const removed = new Set(record?.tasks.filter(item => isTaskComplete(item) && !(running && item.id === record.activeTaskId)).map(item => item.id));
      if (!removed.size) return false;
      record.tasks = record.tasks.filter(item => !removed.has(item.id));
      if (removed.has(record.activeTaskId)) { record.activeTaskId = record.tasks[0]?.id || null; currentSectionTitle = ''; currentPlayback = null; }
      if (removed.has(problem?.taskId)) problem = null;
      if (!persist()) return false;
      message = `已清除 ${removed.size} 个已完成专区。`; emit(); return true;
    };
    if (running) { try { return held && verify() ? clear() : false; } catch (error) { return storageError(error); } }
    return edit(clear);
  };
  const moveTask = async (taskId, index) => {
    if (destroyed || blocked || restorePending || status === 'preparing') return false;
    const move = () => {
      const from = record?.tasks.findIndex(item => item.id === taskId) ?? -1;
      if (from < 0 || !Number.isInteger(index) || index < 0 || index >= record.tasks.length) return false;
      if (from === index) return true;
      const [item] = record.tasks.splice(from, 1); record.tasks.splice(index, 0, item);
      return persist();
    };
    if (['running', 'waiting'].includes(status)) return held && verify() ? move() : false;
    return edit(move);
  };
  const setWindow = async window => {
    if (!validWindow(window)) return tell('请填写合法北京时间（结束时间可填24:00）。');
    return edit(() => { ensureRecord(); record.window = { start: window.start, end: window.end }; return persist(); });
  };
  const setAutomation = async value => {
    if (!value || typeof value.enabled !== 'boolean' || typeof value.resumeOnReload !== 'boolean' || (value.mute !== undefined && typeof value.mute !== 'boolean')) return false;
    return edit(() => { ensureRecord(); record.automation = { enabled: value.enabled, resumeOnReload: value.enabled && value.resumeOnReload, mute: value.mute ?? record.automation?.mute ?? true }; record.runRequested = false; return persist(); });
  };
  const prepareSubject = (candidate, refreshId = null) => {
    status = 'preparing'; preparing = { stage: 'subject', candidate, refreshId, since: milliseconds() }; message = '正在打开专区，请等待课程加载。'; watch(); emit();
    if (!adapter.openSubject(candidate)) { stop('无法打开专区，请手动打开后读取。'); return false; } return true;
  };
  const subjectTitleIssue = page => {
    if (preparing?.stage !== 'subject' || page.kind !== 'subject' || page.subjectId !== preparing.candidate.id || !page.courses?.length) return '';
    if (!page.title?.trim()) return '未识别当前专区标题（页面未就绪），已暂停。依据：未从 .subject-banner/.banner-info .title-row .h3、introduce .h3 或 document.title 读到标题。请查看页面诊断后重试读取。';
    if (normalizeTitle(page.title) !== normalizeTitle(preparing.candidate.title)) return '当前专区标题与所选结果不一致，已暂停。依据：专区标题规范化比对不匹配。请核对专区后重试。';
    return '';
  };
  const refreshTask = async taskId => {
    if (!editable()) return tell('请先暂停，再刷新任务。');
    const item = record?.tasks.find(item => item.id === taskId); if (!item?.subject) return false;
    const token = generation; if (!await acquire() || token !== generation || !held || !verify()) return false;
    return prepareSubject(item.subject, taskId);
  };
  const search = async value => {
    if (!editable() || typeof value !== 'string' || !value.trim()) return tell('请先暂停并填写专区名称。');
    const token = generation; if (!await acquire() || token !== generation || !held || !verify()) return false;
    target = value.trim(); draft = null; status = 'preparing'; candidates = []; preparing = { stage: 'search-page', since: milliseconds() }; message = '正在打开专区搜索。'; watch(); emit();
    if (!adapter.goSearch()) { stop('无法进入搜索页，请手动进入后重试。'); return false; } return true;
  };
  const chooseCandidate = async id => {
    if (!editable()) return false;
    const candidate = candidates.find(item => item.id === id), token = generation;
    if (!candidate || !await acquire() || token !== generation || !held || !verify()) return false;
    return prepareSubject(candidate);
  };
  const queue = (item = task) => item ? item.courses.filter(course => course.selected && (item.scope === 'all' || course.required)) : [];
  const nextEntry = () => {
    for (const item of record?.tasks || []) {
      const course = queue(item).find(course => !isDone(item, course.id) && !item.skipped.includes(course.id) && !item.deferred?.some(entry => entry.courseId === course.id));
      if (course) return { item, course };
    }
    return null;
  };
  const matchesCourse = (page, course) => page.kind === 'course' && page.courseId === course.id && page.subjectId === task.subject.id && page.route === course.route;
  const pauseForRelearn = (page, current) => {
    if (!page.relearn?.manualRequired || !(matchesCourse(page, current) || (page.kind === 'course-relearn' && page.courseId === current.id) || (['subject', 'subject-relearn'].includes(page.kind) && page.subjectId === task.subject.id))) return false;
    stop(`遇到“重新学习”提示。${page.relearn.reason} 处理后请手动继续队列。`); notify(message); return true;
  };
  const muteCourse = course => {
    if (status !== 'running' || !held || !runId || record?.automation?.mute === false) return;
    try { adapter.muteCurrentMedia?.(course, runId); } catch { /* Muting an unavailable player must not interrupt learning. */ }
  };
  const watchMedia = () => {
    stopMediaWatch?.(); stopMediaWatch = null;
    if (record?.automation?.mute === false) return;
    try {
      stopMediaWatch = adapter.watchCurrentMedia?.(() => {
        if (destroyed || status !== 'running' || !held || recovery) return;
        if (!isWithinWindow(now(), record.window)) { waitWindow(); return; }
        if (!verify()) return;
        const current = queue().find(course => course.id === task.current);
        if (current) muteCourse(current);
      }) || null;
    } catch { /* Polling still applies muting if media events cannot be watched. */ }
  };
  const start = async (preferred = null, initiator = null) => {
    if (!editable() || !record || !record.tasks.length) return tell('请先添加专区任务。');
    if (!isWithinWindow(now(), record.window) && !record.automation.enabled) return tell('当前不在允许的北京时间学习时段内。');
    const preferredTask = preferred && record.tasks.find(item => item.id === preferred.taskId);
    const preferredCourse = queue(preferredTask).find(course => course.id === preferred.courseId && course.selected && !isDone(preferredTask, course.id) && !preferredTask.skipped.includes(course.id) && !preferredTask.deferred?.some(entry => entry.courseId === course.id));
    const entry = preferredCourse ? { item: preferredTask, course: preferredCourse } : nextEntry();
    if (!entry || !entry.item.subject) return tell(record.tasks.some(item => item.deferred?.length) ? '仍有待处理课程，请在详情中重试。' : record.tasks.some(item => item.skipped.length) ? '仍有跳过课程未完成，请重试。' : '请勾选尚未核对的课程。');
    const token = generation;
    if (!await acquire() || token !== generation || !held || !verify()) return false;
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id; problem = null; currentSectionTitle = ''; currentPlayback = null;
    playbackAttention = null;
    gesturePlayback = ['panel-continue', 'panel-retry'].includes(initiator) ? { initiator } : null;
    if (gesturePlayback) logPlayback('gesture-prepare', { initiator });
    record.runRequested = record.automation.enabled;
    if (!persist()) return false;
    generation += 1; restorePending = false; status = isWithinWindow(now(), record.window) ? 'running' : 'waiting'; needOpen = true;
    if (retries.size) {
      const previous = retries.get(retryKey()) || 0;
      retries.clear();
      if (previous) logPlayback('failure-count', { counter: 'course', previous, reason: 'runner-start' });
    }
    clearMediaHealth('runner-start');
    pending = grace = loading = confirmWait = sectionConfirm = recovery = null;
    message = status === 'waiting' ? `等待学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。` : '正在按平台课节状态连续学习。';
    if (status === 'waiting') waitWindow();
    else { watchMedia(); muteCourse(entry.course); }
    watch(); emit();
    if (gesturePlayback && status === 'running') void tick();
    return true;
  };
  const pause = async () => {
    restorePending = false;
    if (!held && record?.runRequested && !await acquire()) { stop('无法暂停其他标签正在执行的任务，请到执行标签点击暂停。'); return false; }
    playbackAttention = null;
    if (status !== 'running' && status !== 'preparing' && ownsCurrentLearningPage()) {
      try {
        pauseOwnedMedia('assistant-paused');
        if (adapter.leaveLearning(task.subject.route) === false) { stop('页面未能停止，请手动退出学习页。'); return false; }
        lastOwnedPage = null;
      } catch { stop('页面未能停止，请手动退出学习页。'); return false; }
    }
    stop('已暂停，继续学习需手动点击开始。', true);
    clearCourseRetries('assistant-paused');
    return true;
  };
  const waitFor = (key, reason) => {
    if (loading?.key !== key) loading = { key, since: milliseconds() };
    const since = pending?.kind === 'course' ? pending.arrivedAt ?? loading.since : loading.since;
    if (visibility === 'visible' && milliseconds() - Math.max(since, visibleSince) >= 30000) recover(`${reason}，加载超时。`, { cause: 'load-timeout' });
  };
  const action = (fn, expectation) => {
    if (!verify() || status !== 'running') return;
    currentPlayback = null;
    if (!fn()) { recover('页面操作未成功。', { cause: 'page-action' }); return; }
    pending = { ...expectation, since: milliseconds() };
    loading = confirmWait = null;
    if (expectation.kind === 'course') { sectionConfirm = null; lastOwnedPage = null; }
  };
  const nextCourse = (page, leaveWhenDone = true) => {
    gesturePlayback = null;
    currentPlayback = null;
    const entry = nextEntry();
    if (!entry) {
      const count = record.tasks.reduce((n, item) => n + (item.deferred?.length || 0), 0);
      if (count) {
        stop(`队列已执行完，仍有 ${count} 门待处理课程${record.tasks.some(item => item.skipped.length) ? '及跳过课程' : ''}；请在详情中查看原因并重试。`, leaveWhenDone);
        if (!playbackAttention) notify(message);
        return;
      }
      if (record.tasks.some(item => item.skipped.length)) { stop('其他课程已核对，仍有跳过课程未完成，请重试。', true); return; }
      stop('所选课程已全部完成。', true, true); notify('所选课程已完成。'); return;
    }
    generation += 1;
    clearMediaHealth('course-changed');
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id;
    if (!persist()) return;
    grace = loading = confirmWait = sectionConfirm = recovery = null; lastOwnedPage = null; currentSectionTitle = '';
    if (matchesCourse(page, entry.course)) { pending = null; return; }
    action(() => adapter.openCourse(entry.course), { kind: 'course', id: entry.course.id, before: page.route });
  };
  const rememberPlaybackAttention = (page, trigger, deferredReason = null) => {
    playbackAttention = { taskId: task.id, courseId: task.current, route: page.route,
      sectionId: page.activeSectionId, playerId: page.player?.id, baseline: page.media.currentTime ?? null,
      seekRevision: page.player?.seekRevision, trigger, deferredReason };
  };
  const deferCurrent = (reason, leave = true, trigger = 'platform-or-course', playback = null) => {
    if (!verify() || status !== 'running') return;
    logPlayback('manual-intervention', { trigger, disposition: 'deferred' });
    generation += 1;
    endCourseRetry('deferred');
    clearMediaHealth('course-deferred');
    pending = grace = loading = confirmWait = sectionConfirm = null;
    const page = adapter.read();
    const owned = ownsCurrentLearningPage();
    if (owned) {
      if (!playback || leave) pauseOwnedMedia('course-deferred');
      if (leave && adapter.leaveLearning(task.subject.route) === false) { stop('未能退出当前学习页，请手动退出后继续。'); notify(message); return; }
      lastOwnedPage = null;
    }
    task.deferred = [...(task.deferred || []).filter(item => item.courseId !== task.current), { courseId: task.current, reason }];
    if (!persist()) return;
    if (playback && !leave && owned) {
      if (nextEntry()) pauseOwnedMedia('course-deferred');
      else rememberPlaybackAttention(playback, trigger, reason);
    }
    message = `课程已放入待处理：${reason} 继续后续课程。`; emit();
    nextCourse(page, leave);
  };
  const recover = (reason, { reopen = true, cause, playback } = {}) => {
    currentPlayback = null;
    if (!record?.automation.enabled) {
      if (playback && !reopen) rememberPlaybackAttention(playback, cause);
      stop(`${reason} ${reopen ? '已暂停并退出学习页，请人工确认。' : '请在当前页手动播放后再继续。'}`, reopen);
      return;
    }
    if (!verify() || status !== 'running') return;
    const key = retryKey(), previous = retries.get(key) || 0, attempt = previous + 1;
    if (attempt > 3) { deferCurrent(`${reason} 已重试三次。`, reopen, cause, playback); return; }
    generation += 1;
    if (playback && !reopen) endMediaRequest('cancelled', 'course-retry');
    else clearMediaHealth('course-retry');
    pending = grace = loading = confirmWait = sectionConfirm = null;
    retries.set(key, attempt);
    logPlayback('failure-count', { counter: 'course', previous, reason: cause });
    if (reopen && ownsCurrentLearningPage()) {
      pauseOwnedMedia('course-retry');
      if (adapter.leaveLearning(task.subject.route) === false) { stop('重试前未能退出学习页，请手动退出后继续。'); notify(message); return; }
      lastOwnedPage = null;
    }
    const delayMs = [5000, 10000, 20000][attempt - 1];
    recovery = { until: milliseconds() + delayMs, reopen, before: adapter.read().route, attempt };
    logPlayback('retry-start', { attempt, delayMs, mode: reopen ? 'reopen' : 'in-place', reason: cause });
    message = `${reason} 正在等待重试 ${attempt}/3。`; emit();
  };
  const waitWindow = () => {
    gesturePlayback = null;
    currentPlayback = null;
    stopMediaWatch?.(); stopMediaWatch = null;
    if (!record.automation.enabled) { stop('已到学习时段边界，已停止媒体并退出学习页。', true); return; }
    if (ownsCurrentLearningPage()) {
      try {
        pauseOwnedMedia('schedule-ended');
        if (adapter.leaveLearning(task.subject.route) === false) throw Error();
        lastOwnedPage = null;
      } catch { stop('学习时段结束，但未能退出学习页，请手动停止。', true); notify(message); return; }
    }
    generation += 1;
    endCourseRetry('schedule-ended');
    clearMediaHealth('schedule-ended');
    pending = grace = loading = confirmWait = sectionConfirm = null; needOpen = true;
    status = 'waiting'; message = `等待下次学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。`; emit();
  };
  const retry = async (taskId = problem?.taskId, courseId = problem?.courseId, initiator = null) => {
    logPlayback('retry-start', { mode: 'manual' });
    const started = await edit(() => {
      const item = record?.tasks.find(item => item.id === taskId);
      if (!item?.courses.some(course => course.id === courseId)) return false;
      item.skipped = item.skipped.filter(id => id !== courseId);
      if (!item.recheck?.includes(courseId)) item.done = item.done.filter(id => id !== courseId);
      item.deferred = (item.deferred || []).filter(entry => entry.courseId !== courseId);
      item.courses.find(course => course.id === courseId).selected = true;
      record.activeTaskId = item.id; item.current = courseId; problem = null;
      if (!persist()) return false;
      // Start under the lock already held by the queue edit.
      return start({ taskId, courseId }, initiator);
    }, true);
    logPlayback('retry-end', { mode: 'manual', outcome: started ? 'started' : 'not-started' });
    return started;
  };
  const skipCurrent = async () => {
    const skipped = await edit(() => {
      if (!problem) return false;
      const item = record?.tasks.find(item => item.id === problem.taskId);
      const course = item?.courses.find(course => course.id === problem.courseId); if (!course) return false;
      if (!item.skipped.includes(problem.courseId)) item.skipped.push(problem.courseId);
      if (!item.recheck?.includes(problem.courseId)) item.done = item.done.filter(id => id !== problem.courseId);
      problem = null;
      if (!persist()) return false;
      try {
        const page = adapter.read();
        const owned = page.kind === 'course' && page.courseId === course.id && page.subjectId === item.subject?.id && page.route === course.route;
        if (owned) {
          pauseOwnedMedia('course-skipped');
          if (adapter.leaveLearning(item.subject.route) === false) return tell('课程已跳过，但未能退出学习页，请手动退出后继续。');
        }
      } catch { return tell('课程已跳过，但页面操作未能完成，请手动退出学习页后继续。'); }
      return true;
    });
    if (!skipped) return false;
    if (!nextEntry()) { tell('仍有跳过课程未完成，请重试。'); return true; }
    return start();
  };
  const settleMediaRequest = (health, request, current, result) => {
    if (destroyed || status !== 'running' || mediaHealth !== health || health.request !== request) return;
    try {
      refreshVisibility();
      if (!isWithinWindow(now(), record.window)) { waitWindow(); return; }
      if (!verify()) return;
      const latest = adapter.read();
      if (pauseForRelearn(latest, current)) return;
      if (!matchesCourse(latest, current) || latest.activeSectionId !== request.sectionId || latest.player?.id !== health.playerId) return;
      request.result = result;
      observePlayback(latest);
      logPlayback('play-result', { mode: request.resume ? 'resume' : 'start', initiator: request.initiator,
        gesture: request.gesture, result, nativeError: request.nativeError ?? null,
        pausedAfter: latest.media?.paused ?? null, visibilityAfter: visibility });
    } catch {
      if (status === 'running' && mediaHealth === health) stop('页面读取或操作异常，已暂停并退出学习页，请人工确认。', true);
    }
  };
  const readProgress = (page, observation) => {
    const media = page.media;
    const time = Number.isFinite(media.currentTime) ? media.currentTime : null;
    const seeking = page.player?.seeking || observation.seekRevision !== page.player?.seekRevision;
    observation.seekRevision = page.player?.seekRevision;
    if (observation.baseline === null || seeking || (time !== null && time < observation.baseline)) observation.baseline = time;
    if (media.paused || media.ended || seeking || time === null) return 0;
    const delta = time - observation.baseline;
    if (delta < wdControllerProgressDelta) return 0;
    observation.baseline = time;
    return delta;
  };
  const observeProgress = (page, health) => {
    const delta = readProgress(page, health);
    if (!delta) return false;
    const source = health.source || 'unattributed';
    if (health.request || health.pauseSince !== null || recovery || milliseconds() >= health.sampleAt) {
      logPlayback('progress', { delta: Math.round(delta * 1000) / 1000, source });
      health.sampleAt = milliseconds() + 10000;
    }
    if (health.request) endMediaRequest('progress', 'current-time-advanced');
    else if (health.pauseSince !== null || recovery) {
      logPlayback('recovery-result', { mode: 'resume', outcome: 'progress', reason: 'observed-resume', source });
    }
    if (health.failures) {
      const previous = health.failures;
      health.failures = 0;
      logPlayback('failure-count', { counter: 'resume', previous, reason: 'current-time-advanced' });
    }
    clearCourseRetries('current-time-advanced');
    if (gesturePlayback) {
      gesturePlayback = null;
      message = '正在按平台课节状态连续学习。';
    }
    health.nextAt = 0;
    health.pauseSince = null;
    health.userPaused = false;
    if (recovery) endCourseRetry('playback-confirmed');
    if (message.startsWith('播放已暂停，正在自动恢复播放') || message.startsWith('播放器已手动暂停') || message.includes('正在等待重试')) {
      message = '正在按平台课节状态连续学习。';
    }
    return true;
  };
  const samePlayer = (page, tracked) => page.activeSectionId === tracked.sectionId && page.player?.id === tracked.playerId;
  const canObservePlayback = (page, current) => Boolean(
    matchesCourse(page, current) && !page.relearn?.manualRequired && page.sectionListReady !== false
    && page.media && page.mediaTarget?.status !== 'ambiguous' && page.mediaTarget?.status !== 'none'
    && !page.issues?.some(issue => !issue.includes('媒体播放器'))
    && page.sections.some(section => section.id === page.activeSectionId && section.courseId === current.id
      && (task.scope === 'all' || section.required) && [5, 6].includes(section.type) && ['learning', 'not-started'].includes(section.status))
  );
  const observeMediaSignal = (page, signal, tracked, recordEvent = true) => {
    if (!signal || !page.media || page.player?.id !== signal.id || signal.event === 'timeupdate') return;
    if (recordEvent && playbackLog.enabled) {
      const details = { mediaEvent: signal.event, source: signal.source, trusted: signal.trusted, action: signal.action,
        initiator: null, gesture: null, userActivation: null,
        ...signal.playback, pausedAfter: signal.pausedAfter, visibilityAfter: signal.visibilityAfter };
      if (signal.event === 'pause') {
        details.precedingPlay = signal.precedingPlay;
        details.pauseCause = ({ assistant: 'assistant-command', user: 'player-control' })[signal.source] || 'unattributed';
      }
      logPlayback(signal.event === 'control-input' ? 'control-input' : 'media-event', details);
    }
    if (!tracked || !samePlayer(page, tracked)) return;
    if (signal.event === 'pause' && page.media.paused) {
      tracked.pauseSource = signal.source;
      if (signal.source === 'user' && status === 'running') {
        tracked.userPaused = true;
        endMediaRequest('cancelled', 'player-control-paused');
        message = '播放器已手动暂停，点击播放器继续。';
      }
    } else if (['play', 'playing'].includes(signal.event) && !page.media.paused) {
      tracked.source = signal.source;
      if (signal.event === 'play' && signal.source === 'user' && tracked.request) tracked.request.since = milliseconds();
    }
  };
  const trackPlayer = (page, key, signal) => {
    if (mediaHealth?.key === key && samePlayer(page, mediaHealth)) return;
    clearMediaHealth('player-changed');
    mediaHealth = { key, sectionId: page.activeSectionId, playerId: page.player?.id, started: false, baseline: null,
      wasPaused: false, failures: 0, nextAt: 0, sampleAt: 0, request: null };
    observeMediaSignal(page, signal, mediaHealth, false);
  };
  const observePlaybackAttention = async (page, signal) => {
    const attention = playbackAttention;
    const current = task?.courses.find(course => course.id === attention?.courseId);
    if (!attention || attention.confirming || status !== 'paused' || task?.id !== attention.taskId || task.current !== attention.courseId
      || !current || !canObservePlayback(page, current) || !samePlayer(page, attention)) return;
    observeMediaSignal(page, signal, attention);
    const delta = readProgress(page, attention);
    if (!delta) return;
    attention.confirming = true;
    const source = attention.source || 'unattributed';
    logPlayback('progress', { delta: Math.round(delta * 1000) / 1000, source });
    if (attention.deferredReason) {
      const removed = await edit(() => {
        const latest = adapter.read();
        if (playbackAttention !== attention || !canObservePlayback(latest, current) || !samePlayer(latest, attention)
          || latest.media.paused || latest.media.ended) return false;
        const deferred = task.deferred.filter(item => item.courseId !== attention.courseId || item.reason !== attention.deferredReason);
        if (deferred.length === task.deferred.length) return false;
        task.deferred = deferred;
        return persist();
      });
      if (!removed) { logPlayback('attention-clear-blocked', { trigger: attention.trigger }); return; }
    }
    if (playbackAttention !== attention || status !== 'paused') return;
    playbackAttention = null;
    if (problem?.taskId === attention.taskId && problem.courseId === attention.courseId) problem = null;
    clearCourseRetries('manual-playback-confirmed');
    logPlayback('intervention-cleared', { trigger: attention.trigger, source });
    message = '播放器已恢复播放。助手队列仍暂停。';
    emit();
  };
  const beginPlayback = (page, current, health, initiator, gesture = false) => {
    const resume = health.started;
    const attempt = { sectionId: health.sectionId, since: milliseconds(), resume, result: 'pending', initiator, gesture };
    health.baseline = Number.isFinite(page.media.currentTime) ? page.media.currentTime : null;
    health.request = attempt;
    if (gesturePlayback) gesturePlayback.ready = null;
    if (gesture) message = '正在确认当前课节播放。';
    else if (resume && visibility === 'visible') message = `播放已暂停，正在自动恢复播放（${health.failures + 1}/3）。`;
    logPlayback('play-attempt', { mode: resume ? 'resume' : 'start', muteRequested: record.automation.mute,
      source: 'assistant', initiator, gesture });
    const expected = { route: page.route, sectionId: health.sectionId, playerId: health.playerId, initiator, gesture,
      onCall: fields => logPlayback('play-call', fields), onNativeError: name => { attempt.nativeError = name; } };
    // The adapter calls the native method before it awaits its Promise.
    Promise.resolve(adapter.playCurrentMedia(record.automation.mute, expected)).then(
      success => settleMediaRequest(health, attempt, current, success ? 'accepted' : 'refused'),
      () => settleMediaRequest(health, attempt, current, 'rejected'),
    );
  };
  const offerGesture = (page, health) => {
    if (visibility !== 'visible') return;
    gesturePlayback.ready = { playerId: health.playerId, sectionId: health.sectionId, route: page.route };
    if (gesturePlayback.announcedPlayer !== health.playerId || !gesturePlayback.announced) {
      gesturePlayback.announced = true;
      gesturePlayback.announcedPlayer = health.playerId;
      logPlayback('gesture-ready', { initiator: gesturePlayback.initiator });
    }
    message = '请点击「播放当前课节」，也可以直接操作播放器。';
  };
  const playFromGesture = event => {
    const offered = gesturePlayback?.ready;
    if (!offered || status !== 'running' || destroyed || recovery || !held || !mediaHealth || mediaHealth.request) return false;
    refreshVisibility();
    if (event?.isTrusted !== true || adapter.userActivation?.() === false || visibility !== 'visible') {
      logPlayback('gesture-ignored', { initiator: gesturePlayback.initiator, trusted: event?.isTrusted === true,
        userActivation: adapter.userActivation?.() ?? null });
      return false;
    }
    if (!isWithinWindow(now(), record.window)) { waitWindow(); return false; }
    if (!verify()) return false;
    const current = queue().find(course => course.id === task.current);
    if (!current) return false;
    const page = adapter.read();
    if (pauseForRelearn(page, current)) return false;
    if (page.route !== offered.route || !canObservePlayback(page, current) || !samePlayer(page, offered)
      || !samePlayer(page, mediaHealth) || page.mediaReady === false || page.online === false || page.media.ended) {
      gesturePlayback.ready = null;
      logPlayback('gesture-target-changed', { initiator: gesturePlayback.initiator });
      emit();
      return false;
    }
    observePlayback(page);
    if (!page.media.paused) { observeProgress(page, mediaHealth); emit(); return false; }
    beginPlayback(page, current, mediaHealth, gesturePlayback.initiator, true);
    emit();
    return true;
  };
  const checkPlayback = (page, current, health) => {
    const media = page.media;
    const at = milliseconds();
    if (media.paused && !health.wasPaused) {
      health.pauseSince = at;
      logPlayback('pause-detected', { mode: health.started ? 'resume' : 'start', source: health.pauseSource || 'unattributed' });
    }
    health.wasPaused = media.paused;
    if (!media.paused) {
      health.started = true;
      health.pauseSource = null;
      if (health.request) health.request.unpausedSince ??= at;
    } else if (health.request) health.request.unpausedSince = null;
    observeProgress(page, health);
    if (health.userPaused) return;
    if (page.online === false) return;
    const request = health.request;
    if (request) {
      if (visibility !== 'visible') return;
      const timeout = request.result === 'pending' || !media.paused ? wdControllerPlayTimeout : wdControllerProgressTimeout;
      if (at - Math.max(request.since, visibleSince, request.unpausedSince ?? -Infinity) < timeout) return;
      if (request.nativeError === 'NotAllowedError' && media.paused) {
        endMediaRequest('blocked', 'user-gesture-required');
        gesturePlayback ??= { initiator: 'panel-continue' };
        logPlayback('gesture-required', { initiator: request.initiator, nativeError: request.nativeError });
        offerGesture(page, health);
        return;
      }
      const reason = ({ pending: 'request-timeout', refused: 'play-refused', rejected: 'play-rejected' })[request.result] || 'no-progress';
      endMediaRequest('failed', reason);
      if (request.resume) {
        const previous = health.failures;
        health.failures += 1;
        logPlayback('failure-count', { counter: 'resume', previous, reason });
      }
      if (!media.paused) {
        rememberPlaybackAttention(page, 'stalled');
        stop('播放进度持续未推进，请在当前页检查播放器后继续。');
        return;
      }
      if (!request.resume) {
        const summary = ({ pending: '播放请求超时。', refused: '浏览器未能自动播放。', rejected: '播放失败。' })[request.result] || '播放未能推进。';
        recover(summary, { reopen: false, cause: reason, playback: page });
        return;
      }
      if (health.failures > wdControllerResumeBackoff.length) {
        rememberPlaybackAttention(page, 'resume-exhausted');
        stop('自动恢复播放连续 3 次未能推进，请在当前页检查播放器后继续。');
        return;
      }
      health.nextAt = at + wdControllerResumeBackoff[health.failures - 1];
      return;
    }
    if (!media.paused) {
      if (gesturePlayback) message = '正在确认当前课节播放。';
      return;
    }
    if (at < health.nextAt) return;
    if (gesturePlayback) { offerGesture(page, health); return; }
    if (visibility === 'hidden') {
      if (attemptedWhileHidden) return;
      attemptedWhileHidden = true;
    } else if (health.started && at - Math.max(health.pauseSince ?? at, visibleSince) < wdControllerPauseGrace) return;

    beginPlayback(page, current, health, health.started ? 'automatic-resume' : 'queue-start');
  };
  const tick = async (signal = null) => {
    refreshVisibility();
    if (restorePending && !destroyed) { restorePending = false; await start({ taskId: record.activeTaskId, courseId: task?.current }); if (status === 'paused' && timer !== null) { unschedule(timer); timer = null; } return; }
    // Boundary and ownership checks also run while a media.play promise is pending.
    if (destroyed || !['running', 'preparing', 'waiting'].includes(status)) return;
    if (status === 'running' && !isWithinWindow(now(), record.window)) { waitWindow(); return; }
    if (!verify()) return;
    try { lease(); } catch (error) { storageError(error); return; }
    if (ticking) return;
    ticking = true;
    if (gesturePlayback) gesturePlayback.ready = null;
    currentPlayback = null;
    try {
      const page = adapter.read();
      observePlayback(page);
      if (playbackLog.enabled) {
        const checkedAt = milliseconds();
        const gapMs = lastDiagnosticTick === null ? 0 : checkedAt - lastDiagnosticTick;
        if (gapMs >= 3000) logPlayback('tick-gap', { gapMs });
        lastDiagnosticTick = checkedAt;
      }
      if (page.kind === 'login' || page.kind === 'study-error') {
        logPlayback('platform-stop', { source: 'platform', trigger: page.kind === 'login' ? 'login' : page.errorCode === '1' ? 'other-window' : 'study-restriction' });
        stop(page.kind === 'login' ? '登录已失效，请重新登录后继续。' : page.errorCode === '1' ? '其他学习窗口已接管播放，请关闭其他窗口后手动继续。' : '平台学习限制提示，请在当前页面处理后继续。'); notify(message); return;
      }
      if (status === 'waiting') {
        if (isWithinWindow(now(), record.window)) { status = 'running'; needOpen = true; watchMedia(); message = '已进入学习时段，正在继续队列。'; emit(); }
        return;
      }
      if (status === 'running' && record.automation.enabled && page.online === false) {
        if (!recovery?.network) {
          generation += 1;
          endCourseRetry('offline');
          clearMediaHealth('offline');
          pending = grace = loading = confirmWait = sectionConfirm = null;
          if (ownsCurrentLearningPage()) {
            pauseOwnedMedia('offline');
            if (adapter.leaveLearning(task.subject.route) === false) { stop('断网后未能退出学习页，请手动退出。'); notify(message); return; }
            lastOwnedPage = null;
          }
          recovery = { network: true, before: adapter.read().route };
          message = '网络已断开，等待网络恢复后继续；当前课程未计为完成。'; emit();
        }
        return;
      }
      if (status === 'preparing') {
        if (preparing.stage === 'subject' && page.relearn?.manualRequired && page.subjectId === preparing.candidate.id && ['subject', 'subject-relearn'].includes(page.kind)) {
          stop(`遇到“重新学习”提示。${page.relearn.reason} 处理后请重新读取专区。`); notify(message); return;
        }
        if (milliseconds() - preparing.since >= 30000) {
          stop(subjectTitleIssue(page) || wdControllerDescribeRecognitionFailure(page, { stage: preparing.stage, expectedSubject: preparing.candidate || null, timedOut: true }));
          return;
        }
        if (preparing.stage === 'search-page' && page.kind === 'search') {
          if (adapter.searchKeyword(target)) preparing = { stage: 'results', since: milliseconds() };
        } else if (preparing.stage === 'results' && page.kind === 'search' && page.candidates?.length) {
          candidates = page.candidates.map(({ id, title, route }) => ({ id, title, route }));
          const exact = candidates.filter(item => normalizeTitle(item.title) === normalizeTitle(target));
          if (exact.length === 1) {
            preparing = { stage: 'subject', candidate: exact[0], since: milliseconds() };
            if (!adapter.openSubject(exact[0])) stop('无法打开专区，请手动打开后读取。');
          } else stop('请点击确认要学习的专区。');
          emit();
        } else if (preparing.stage === 'subject' && page.kind === 'subject' && page.subjectId === preparing.candidate.id && page.title && normalizeTitle(page.title) === normalizeTitle(preparing.candidate.title) && page.courses?.length) {
          if (collectPage(page, preparing.refreshId)) stop(message);
        }
        return;
      }
      const current = queue().find(course => course.id === task.current);
      if (!current) { stop('当前课程不在已选清单中。', true); return; }
      if (pauseForRelearn(page, current)) return;
      observeMediaSignal(page, signal, mediaHealth);
      if (recovery?.reopen === false && mediaHealth && mediaHealth.sectionId === page.activeSectionId && canObservePlayback(page, current)) {
        trackPlayer(page, mediaHealth.key, signal);
        observeProgress(page, mediaHealth);
        if (mediaHealth.userPaused) return;
      }
      if (recovery) {
        const onTarget = matchesCourse(page, current);
        const onExpectedSubject = recovery.reopen !== false && page.route === task.subject.route;
        if (page.route !== recovery.before && !onExpectedSubject && !onTarget) { stop('页面已离开目标课程，请确认后重新开始。'); return; }
        if (!recovery.network && (visibility !== 'visible' || milliseconds() < recovery.until)) return;
        endCourseRetry(onTarget ? 'in-place' : 'reopen');
        if (!onTarget) {
          message = '正在重新进入课程。';
          action(() => adapter.openCourse(current), { kind: 'course', id: current.id, before: page.route });
          return;
        }
        message = '正在按平台课节状态连续学习。';
      }
      if (needOpen) {
        needOpen = false;
        if (!matchesCourse(page, current)) { action(() => adapter.openCourse(current), { kind: 'course', id: current.id, before: page.route }); return; }
      }
      if (pending) {
        const onTarget = matchesCourse(page, current);
        if (onTarget && pending.kind === 'course') {
          // The hash changes before the SPA mounts the new course and its player.
          pending.arrivedAt ??= milliseconds();
        } else if (onTarget && page.activeSectionId === pending.id) {
          pending = null;
        } else {
          if (!onTarget && (pending.arrivedAt !== undefined || page.route !== pending.before)) { stop('页面已离开目标课程，请确认后重新开始。'); return; }
          if (visibility === 'visible' && milliseconds() - Math.max(pending.since, visibleSince) >= 30000) recover('页面切换超时。', { cause: 'navigation-timeout' });
          return;
        }
      }
      if (!matchesCourse(page, current)) {
        lastOwnedPage = null;
        sectionConfirm = null;
        confirmWait = null;
        const entry = nextEntry();
        const next = entry?.course;
        if (isDone(task, current.id) && next && page.subjectId === entry.item.subject?.id && page.courseId === next.id && page.route === next.route) { nextCourse(page); return; }
        const nativeNext = task.courses[task.courses.findIndex(course => course.id === current.id) + 1];
        if (isDone(task, current.id) && grace?.key === `course:${current.id}` && next && nativeNext && matchesCourse(page, nativeNext)) {
          // The site advanced within the just-completed course's subject before applying the new queue order.
          pauseOwnedMedia('course-changed'); nextCourse(page); return;
        }
        stop('页面已离开目标课程，请确认后重新开始。'); return;
      }
      lastOwnedPage = { taskId: task.id, courseId: current.id, route: page.route };
      muteCourse(current);
      if (isDone(task, current.id)) {
        if (!grace || milliseconds() - grace.since >= 6000) nextCourse(page);
        return;
      }
      const sections = page.sections || [];
      const structuralIssue = page.issues?.some(issue => !issue.includes('媒体播放器'));
      if (page.sectionListReady === false) {
        sectionConfirm = null;
        confirmWait = null;
        waitFor('section-list', page.sectionListReason || '课节清单尚未加载完成');
        return;
      }
      if (structuralIssue || !sections.length || sections.some(item => item.courseId !== current.id) || sections.filter(item => item.active).length > 1) {
        sectionConfirm = null;
        confirmWait = null;
        waitFor('structure', page.recognition?.basis || '课程课节尚未可靠加载');
        return;
      }
      const inScope = sections.filter(item => task.scope === 'all' || item.required);
      if (inScope.some(item => !['learning', 'not-started', 'completed'].includes(item.status))) {
        confirmWait = null;
        waitFor('status', '课节状态无法识别');
        return;
      }
      const sectionKey = `${task.id}:${current.id}`;
      const sectionIds = sections.map(item => item.id).join(',');
      if (sectionConfirm?.key === sectionKey && sectionConfirm.ids === sectionIds) sectionConfirm.ticks += 1;
      else sectionConfirm = { key: sectionKey, ids: sectionIds, ticks: 1 };
      const sectionListConfirmed = page.sectionListConfirmed === true || sectionConfirm.ticks >= 2;
      const active = sections.find(item => item.id === page.activeSectionId);
      if (active && (task.scope === 'all' || active.required) && [5, 6].includes(active.type) && page.media && page.mediaTarget?.status !== 'ambiguous') {
        currentPlayback = { taskId: task.id, courseId: current.id, sectionId: active.id, paused: Boolean(page.media.paused), ended: Boolean(page.media.ended),
          currentTime: Number.isFinite(page.media.currentTime) && page.media.currentTime >= 0 ? page.media.currentTime : null,
          duration: Number.isFinite(page.media.duration) && page.media.duration > 0 ? page.media.duration : null };
      }
      currentSectionTitle = active?.title || '';
      const decision = decideLearningAction(page, { status, scope: task.scope });
      if (page.activeSectionId && !active) { confirmWait = null; waitFor('focus', '当前课节无法确认'); return; }
      if ((decision.type === 'course-complete' || decision.type === 'select-section') && !sectionListConfirmed) {
        confirmWait = null;
        waitFor('section-list-confirm', '等待确认课节清单加载完成');
        return;
      }
      const needsPlayer = decision.type === 'wait' && active && [5, 6].includes(active.type);
      if (!needsPlayer || !page.media) clearMediaHealth('player-unavailable');
      if (pending?.kind === 'course' && (!needsPlayer || (page.media && page.mediaReady !== false))) {
        pending = null;
        if (message === '正在重新进入课程。') message = '正在按平台课节状态连续学习。';
      }
      if (decision.type === 'manual') { confirmWait = null; if (record.automation.enabled) deferCurrent('此课节需要人工处理，请完成后重试。'); else { stop('此课节需要人工处理，请在当前页面完成后再继续。'); notify(message); } return; }
      if (decision.type === 'course-complete') {
        confirmWait = null;
        if (!task.done.includes(current.id)) task.done.push(current.id);
        task.recheck = (task.recheck || []).filter(id => id !== current.id);
        if (!persist()) return;
        if (!nextEntry()) { nextCourse(page); return; }
        grace = { key: `course:${current.id}`, since: milliseconds() }; loading = null; return;
      }
      if (decision.type === 'select-section') {
        confirmWait = null;
        const key = `${current.id}:${active?.id || ''}:${decision.sectionId}`;
        if (active?.status === 'completed') {
          if (grace?.key !== key) { grace = { key, since: milliseconds() }; return; }
          if (milliseconds() - grace.since < 6000) return;
        }
        grace = null;
        action(() => adapter.selectSection(decision.sectionId), { kind: 'section', id: decision.sectionId, before: page.route }); return;
      }
      grace = null;
      if (active && ['learning', 'not-started'].includes(active.status)) {
        if ([5, 6].includes(active.type)) {
          if (page.mediaTarget?.status === 'ambiguous' || page.issues?.some(issue => issue.includes('多个原生媒体播放器'))) {
            confirmWait = null;
            loading = null;
            const countText = page.mediaTarget?.count ? `（${page.mediaTarget.count} 个）` : '';
            const reason = `检测到多个原生媒体播放器${countText}，无法确定当前课节目标播放器；已停止自动媒体操作，请检查页面后手动处理。`;
            if (record.automation.enabled) deferCurrent(reason);
            else { stop(reason, false); notify(message); }
            return;
          }
          if (!page.media) { confirmWait = null; waitFor(`player:${active.id}`, '未识别本页媒体播放器'); return; }
          const key = `${task.id}:${current.id}:${active.id}`;
          trackPlayer(page, key, signal);
          if (page.mediaReady === false && !mediaHealth.started && !mediaHealth.request) {
            confirmWait = null;
            waitFor(`player:${active.id}`, '媒体播放器尚未接入播放源');
            return;
          }
          loading = null;
          if (page.media.ended) {
            endMediaRequest('ended', 'media-ended');
            if (confirmWait?.key !== key) {
              confirmWait = { key, since: milliseconds() };
              message = '媒体播放已结束，正在等待平台确认课节完成。';
            } else if (milliseconds() - confirmWait.since >= wdControllerEndedConfirmTimeout) {
              const reason = '媒体播放结束后平台仍报未完成，等待平台确认超时（90秒）。';
              confirmWait = null;
              if (record.automation.enabled) deferCurrent(reason);
              else { stop(`${reason} 已暂停并退出学习页，请人工核对学时记录。`, true); notify(message); }
            }
            return;
          }
          if (confirmWait) {
            confirmWait = null;
            if (message === '媒体播放已结束，正在等待平台确认课节完成。') message = '正在按平台课节状态连续学习。';
          }
          checkPlayback(page, current, mediaHealth);
        } else {
          loading = null;
          if (confirmWait) {
            confirmWait = null;
            if (message === '媒体播放已结束，正在等待平台确认课节完成。') message = '正在按平台课节状态连续学习。';
          }
        }
      } else { confirmWait = null; waitFor('active', '等待平台确认当前课节'); }
    } catch { stop('页面读取或操作异常，已暂停，请人工确认。', true); }
    finally { ticking = false; emit(); }
  };
  try { record = readStored(); identity = record ? { taskId: record.taskId, revision: record.revision } : null; task = record?.tasks.find(item => item.id === record.activeTaskId) || null; } catch (error) { blocked = true; message = error.message?.includes('本地') || error.message?.includes('存储') ? error.message : '本地存储读取失败，无法启动。'; }
  stopPlaybackWatch = adapter.watchPlayback?.((event, detail) => {
    if (event === 'route') {
      observePlayback(detail);
      if (playbackAttention && detail.route !== playbackAttention.route) playbackAttention = null;
      return;
    }
    if (event === 'visibility') refreshVisibility();
    const signal = detail ? { event, ...detail } : null;
    const forPlayer = !mediaHealth || mediaHealth.playerId === signal?.id;
    const needsSample = recovery || gesturePlayback || mediaHealth?.request || mediaHealth?.pauseSince != null;
    const newPlayback = event === 'play' || event === 'playing';
    if (status === 'running' && (event === 'visibility' || newPlayback || (forPlayer && (event !== 'timeupdate' || needsSample)))) {
      void tick(signal);
    } else if (status === 'paused' && (playbackAttention || playbackLog.enabled) && (event !== 'timeupdate' || playbackAttention?.playerId === signal?.id)) {
      try {
        const page = adapter.read();
        observePlayback(page);
        if (playbackAttention) void observePlaybackAttention(page, signal).catch(() => logPlayback('attention-clear-blocked'));
        else observeMediaSignal(page, signal);
      } catch { /* A player update must never interrupt manual playback. */ }
    } else if (event === 'visibility' && ['preparing', 'waiting'].includes(status)) void tick();
  }) || null;
  if (!blocked && record?.automation.enabled && record.automation.resumeOnReload && record.runRequested) { restorePending = true; message = '正在准备恢复上次开始的队列。'; watch(); }
  return {
    getState, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    search, chooseCandidate, collectDraft, draftSetSelection, selectCourses, addDraft, discardDraft, setSelection, setTaskMode, recheckCompleted, refreshTask, removeTask, clearCompletedTasks, moveTask, setWindow, setAutomation,
    start, pause, retry, skipCurrent, playFromGesture, tick,
    setPlaybackLogging, getPlaybackLogText: playbackLog.text,
    diagnose() {
      const diagnostic = adapter.diagnose();
      if (preparing) {
        const page = adapter.read();
        const extra = { preparingStage: preparing.stage };
        if (preparing.stage === 'subject') {
          extra.subjectIdMatches = page.kind === 'subject' && page.subjectId === preparing.candidate.id;
          extra.subjectTitleMatches = Boolean(page.title?.trim()) && normalizeTitle(page.title) === normalizeTitle(preparing.candidate.title);
        }
        const failureHint = subjectTitleIssue(page) || (
          (preparing.stage === 'subject' && !validPage(page, preparing.candidate))
          || (preparing.stage !== 'subject' && !(page.kind === 'search' && page.candidates?.length))
            ? wdControllerDescribeRecognitionFailure(page, { stage: preparing.stage, expectedSubject: preparing.candidate || null, timedOut: false })
            : ''
        );
        return { ...diagnostic, ...extra, ...(failureHint ? { failureHint } : {}) };
      }
      return diagnostic;
    },
    destroy({ preserveRun = false } = {}) { if (destroyed) return; const keep = preserveRun && record?.automation.enabled && record.automation.resumeOnReload && ['running', 'waiting'].includes(status); stopPlaybackWatch?.(); stop('面板已关闭，任务已暂停。', true, false, keep); destroyed = true; listeners.clear(); },
  };
}

const WD_STORAGE_SCHEMA_VERSION = 1;
const WD_CACHE_SCHEMA_VERSION = 3;

const WD_LEGACY_STORAGE_KEYS = {
  config: 'wangda-assistant.ai.config',
  apiKey: 'wangda-assistant.ai.apiKey',
  cacheV1: 'wangda-assistant.ai.cache.v1',
  cacheV2: 'wangda-assistant.ai.cache.v2',
  qa: 'wangda-assistant.ai.qa.v1',
  quiz: 'wangda-assistant.ai.quiz.v1',
};

const WD_GM_STORAGE_KEYS = {
  config: 'wangda-assistant.gm.ai.config.v1',
  apiKey: 'wangda-assistant.gm.ai.apiKey.v1',
  assetIndex: 'wangda-assistant.gm.assets.index.v1',
  assetShardPrefix: 'wangda-assistant.gm.asset.v1.',
  migration: 'wangda-assistant.gm.migration.v1',
};

const WD_FALLBACK_STORAGE_KEYS = {
  config: WD_LEGACY_STORAGE_KEYS.config,
  apiKey: WD_LEGACY_STORAGE_KEYS.apiKey,
  assetIndex: 'wangda-assistant.fallback.assets.index.v1',
  assetShardPrefix: 'wangda-assistant.fallback.asset.v1.',
  migration: 'wangda-assistant.fallback.migration.v1',
};

const WD_CACHE_STORAGE_KEYS = {
  knowledge: 'wangda-assistant.ai.cache.v3',
  subtitles: 'wangda-assistant.cache.subtitles.v1',
};

const WD_ASSET_KINDS = ['qa', 'quiz', 'wrongQuestions', 'mastery', 'reviewPlan', 'notes'];

const WD_CACHE_LRU_DEFAULTS = {
  knowledge: {
    maxEntries: 40,
    maxBytes: 1536 * 1024, // 1.5 MB budget inside localStorage
    ttlMs: 14 * 24 * 60 * 60 * 1000, // 14 days
  },
  subtitles: {
    maxEntries: 60,
    maxBytes: 1024 * 1024, // 1.0 MB budget inside localStorage
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

const WD_IDB_CONFIG = {
  dbName: 'wangda-assistant-assets-v1',
  dbVersion: 1,
  storeName: 'course_shards',
};

const wdKstIdbCache = new WeakMap();
const wdKstRuntimeWarnings = new WeakMap();

function wdKstSafeCourseId(courseId) {
  return String(courseId || 'unknown').trim() || 'unknown';
}

function wdKstLocalStorage(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

function resolveGmStorage(win, explicitGmStorage = undefined) {
  if (explicitGmStorage === null) return null;
  if (explicitGmStorage && typeof explicitGmStorage.get === 'function' && typeof explicitGmStorage.set === 'function') {
    return explicitGmStorage;
  }
  if (win?.__wdGmStorage && typeof win.__wdGmStorage.get === 'function' && typeof win.__wdGmStorage.set === 'function') {
    return win.__wdGmStorage;
  }
  if (win && ('GM_getValue' in win || 'GM_setValue' in win)) {
    if (typeof win.GM_getValue === 'function' && typeof win.GM_setValue === 'function') {
      return {
        get: (key, fallback = undefined) => win.GM_getValue(key, fallback),
        set: (key, value) => win.GM_setValue(key, value),
      };
    }
    return null;
  }
  try {
    if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
      return {
        get: (key, fallback = undefined) => GM_getValue(key, fallback),
        set: (key, value) => GM_setValue(key, value),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function bindWindowGmStorage(win, gmStorage) {
  if (!win || typeof win !== 'object') return;
  try {
    win.__wdGmStorage = gmStorage || null;
  } catch { /* ignore non-extensible window */ }
}

function wdKstRecordWarning(win, warning) {
  if (!win || !warning) return;
  const list = wdKstRuntimeWarnings.get(win) || [];
  if (!list.includes(warning)) {
    list.push(warning);
    wdKstRuntimeWarnings.set(win, list);
  }
}

function getStorageStatus(win, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const ls = wdKstLocalStorage(win);
  const hasIdb = Boolean(win?.indexedDB && typeof win.indexedDB.open === 'function');
  const warnings = [...(wdKstRuntimeWarnings.get(win) || [])];
  if (!gm) {
    const degradeMsg = '当前环境未检测到 GM_setValue（非油猴环境或权限受限），API Key 与用户学习资产已自动降级保存到 localStorage，可能存在同源可读与容量限制风险。';
    if (!warnings.includes(degradeMsg)) warnings.unshift(degradeMsg);
  }
  return {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    cacheSchemaVersion: WD_CACHE_SCHEMA_VERSION,
    hasGm: Boolean(gm),
    hasLocalStorage: Boolean(ls),
    hasIndexedDb: hasIdb,
    degraded: !gm,
    backend: gm ? (hasIdb ? 'gm+indexeddb' : 'gm') : (ls ? (hasIdb ? 'localStorage-fallback+indexeddb' : 'localStorage-fallback') : 'memory-only'),
    cacheBackend: ls ? 'localStorage-lru' : 'unavailable',
    warnings,
    migration: readMigrationReceipt(win, options),
  };
}

function wdKstKvRead(win, key, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  if (gm) {
    try {
      const val = gm.get(key, undefined);
      return { ok: true, value: val === undefined ? null : val, backend: 'gm' };
    } catch (err) {
      return { ok: false, value: null, backend: 'gm', error: err?.message || String(err) };
    }
  }
  const ls = wdKstLocalStorage(win);
  if (!ls || typeof ls.getItem !== 'function') {
    return { ok: false, value: null, backend: 'unavailable', error: '本地存储不可用' };
  }
  try {
    const raw = ls.getItem(key);
    if (raw === null || raw === undefined) return { ok: true, value: null, backend: 'localStorage-fallback' };
    if (options.rawString) return { ok: true, value: raw, backend: 'localStorage-fallback' };
    return { ok: true, value: JSON.parse(raw), backend: 'localStorage-fallback' };
  } catch (err) {
    return { ok: false, value: null, backend: 'localStorage-fallback', error: err?.message || String(err) };
  }
}

function wdKstKvWrite(win, key, value, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  if (gm) {
    try {
      gm.set(key, value);
      return { ok: true, backend: 'gm' };
    } catch (err) {
      return { ok: false, backend: 'gm', error: err?.message || String(err) };
    }
  }
  wdKstRecordWarning(win, '当前环境未检测到 GM_setValue（非油猴环境或权限受限），API Key 与用户学习资产已自动降级保存到 localStorage，可能存在同源可读与容量限制风险。');
  const ls = wdKstLocalStorage(win);
  if (!ls || typeof ls.setItem !== 'function') {
    return { ok: false, backend: 'unavailable', error: '浏览器 localStorage 与 GM_setValue 均不可用。' };
  }
  try {
    if (value === null || value === undefined) {
      ls.removeItem?.(key);
    } else if (options.rawString) {
      ls.setItem(key, String(value));
    } else {
      ls.setItem(key, JSON.stringify(value));
    }
    return { ok: true, backend: 'localStorage-fallback', degraded: true };
  } catch (err) {
    return { ok: false, backend: 'localStorage-fallback', degraded: true, error: err?.message || String(err) };
  }
}

// ============================================================================
// Optional IndexedDB Shard Mirror (async, best-effort, never blocks sync APIs)
// ============================================================================

function wdKstOpenIdb(win) {
  if (!win?.indexedDB || typeof win.indexedDB.open !== 'function') return Promise.resolve(null);
  if (wdKstIdbCache.has(win)) return wdKstIdbCache.get(win);
  const promise = new Promise(resolve => {
    try {
      const req = win.indexedDB.open(WD_IDB_CONFIG.dbName, WD_IDB_CONFIG.dbVersion);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(WD_IDB_CONFIG.storeName)) {
            const store = db.createObjectStore(WD_IDB_CONFIG.storeName, { keyPath: 'shardKey' });
            store.createIndex('courseId', 'courseId', { unique: false });
            store.createIndex('kind', 'kind', { unique: false });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        } catch { /* ignore upgrade error */ }
      };
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  wdKstIdbCache.set(win, promise);
  return promise;
}

async function writeAssetShardToIdb(win, shardRecord) {
  const db = await wdKstOpenIdb(win);
  if (!db) return { ok: false, skipped: true };
  return new Promise(resolve => {
    try {
      const tx = db.transaction(WD_IDB_CONFIG.storeName, 'readwrite');
      const store = tx.objectStore(WD_IDB_CONFIG.storeName);
      store.put(shardRecord);
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => resolve({ ok: false, error: tx.error?.message || 'IndexedDB 写入失败' });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

async function readAssetShardFromIdb(win, courseId, kind) {
  const db = await wdKstOpenIdb(win);
  if (!db) return null;
  const shardKey = `${wdKstSafeCourseId(courseId)}::${kind}`;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(WD_IDB_CONFIG.storeName, 'readonly');
      const req = tx.objectStore(WD_IDB_CONFIG.storeName).get(shardKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function listAllIdbShards(win) {
  const db = await wdKstOpenIdb(win);
  if (!db) return [];
  return new Promise(resolve => {
    try {
      const tx = db.transaction(WD_IDB_CONFIG.storeName, 'readonly');
      const req = tx.objectStore(WD_IDB_CONFIG.storeName).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

// ============================================================================
// AI Config & Secret Storage (GM_setValue primary, localStorage fallback)
// ============================================================================

function readStoredAiConfig(win, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const key = gm ? WD_GM_STORAGE_KEYS.config : WD_FALLBACK_STORAGE_KEYS.config;
  const res = wdKstKvRead(win, key, options);
  if (res.ok && res.value && typeof res.value === 'object') {
    return { config: res.value, backend: res.backend };
  }
  if (res.ok && typeof res.value === 'string') {
    try {
      const parsed = JSON.parse(res.value);
      if (parsed && typeof parsed === 'object') return { config: parsed, backend: res.backend };
    } catch { /* ignore */ }
  }
  return { config: {}, backend: res.backend };
}

function writeStoredAiConfig(win, configObj, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const key = gm ? WD_GM_STORAGE_KEYS.config : WD_FALLBACK_STORAGE_KEYS.config;
  const payload = { ...configObj, schemaVersion: WD_STORAGE_SCHEMA_VERSION, updatedAt: Date.now() };
  return wdKstKvWrite(win, key, payload, options);
}

function readStoredAiApiKey(win, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const key = gm ? WD_GM_STORAGE_KEYS.apiKey : WD_FALLBACK_STORAGE_KEYS.apiKey;
  const res = wdKstKvRead(win, key, { ...options, rawString: !gm });
  if (!res.ok || res.value === null || res.value === undefined) return { apiKey: '', backend: res.backend };
  return { apiKey: String(res.value).trim(), backend: res.backend };
}

function writeStoredAiApiKey(win, apiKey, options = {}) {
  const gm = resolveGmStorage(win, options.gmStorage);
  const key = gm ? WD_GM_STORAGE_KEYS.apiKey : WD_FALLBACK_STORAGE_KEYS.apiKey;
  const clean = String(apiKey ?? '').trim();
  const res = wdKstKvWrite(win, key, clean || null, { ...options, rawString: !gm });
  // When stored safely in GM, ensure no lingering plaintext API key remains in host localStorage
  if (res.ok && gm) {
    try { wdKstLocalStorage(win)?.removeItem?.(WD_LEGACY_STORAGE_KEYS.apiKey); } catch { /* ignore */ }
  }
  return res;
}

// ============================================================================
// Durable User Asset Store (Per-Course Sharded + Master Index, Zero Eviction)
// ============================================================================

function wdKstAssetIndexKey(win, options = {}) {
  return resolveGmStorage(win, options.gmStorage)
    ? WD_GM_STORAGE_KEYS.assetIndex
    : WD_FALLBACK_STORAGE_KEYS.assetIndex;
}

function buildAssetShardKey(win, courseId, kind, options = {}) {
  const prefix = resolveGmStorage(win, options.gmStorage)
    ? WD_GM_STORAGE_KEYS.assetShardPrefix
    : WD_FALLBACK_STORAGE_KEYS.assetShardPrefix;
  return `${prefix}${encodeURIComponent(wdKstSafeCourseId(courseId))}.${kind}`;
}

function readAssetIndex(win, options = {}) {
  const res = wdKstKvRead(win, wdKstAssetIndexKey(win, options), options);
  const raw = res.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.courses && typeof raw.courses === 'object') {
    return {
      schemaVersion: Number(raw.schemaVersion) || WD_STORAGE_SCHEMA_VERSION,
      updatedAt: Number(raw.updatedAt) || 0,
      courses: { ...raw.courses },
    };
  }
  return { schemaVersion: WD_STORAGE_SCHEMA_VERSION, updatedAt: 0, courses: {} };
}

function wdKstWriteAssetIndex(win, indexObj, options = {}) {
  const next = {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    courses: indexObj.courses || {},
  };
  return wdKstKvWrite(win, wdKstAssetIndexKey(win, options), next, options);
}

function wdKstDefaultAssetData(kind) {
  if (kind === 'wrongQuestions') return { items: {} };
  if (kind === 'mastery') return { sections: {} };
  if (kind === 'reviewPlan') return { schemaVersion: WD_STORAGE_SCHEMA_VERSION, cards: [], schedule: { targetDate: null, dailyGoal: null } };
  if (kind === 'notes') return { sections: {} };
  return {};
}

function wdKstCountShardEntries(kind, data) {
  if (!data || typeof data !== 'object') return 0;
  if (kind === 'wrongQuestions') return Object.keys(data.items || {}).length;
  if (kind === 'mastery') return Object.keys(data.sections || {}).length;
  if (kind === 'reviewPlan') return Array.isArray(data.cards) ? data.cards.length : 0;
  if (kind === 'notes') {
    return Object.values(data.sections || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  }
  return Object.keys(data).length;
}

function readCourseAssetShard(win, courseId, kind, options = {}) {
  if (!WD_ASSET_KINDS.includes(kind)) throw new Error(`未知用户资产类型：${kind}`);
  const cid = wdKstSafeCourseId(courseId);
  const storageKey = buildAssetShardKey(win, cid, kind, options);
  const res = wdKstKvRead(win, storageKey, options);
  const raw = res.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data && typeof raw.data === 'object') {
    return {
      schemaVersion: Number(raw.schemaVersion) || WD_STORAGE_SCHEMA_VERSION,
      courseId: cid,
      kind,
      updatedAt: Number(raw.updatedAt) || 0,
      data: raw.data,
      backend: res.backend,
    };
  }
  return {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    courseId: cid,
    kind,
    updatedAt: 0,
    data: wdKstDefaultAssetData(kind),
    backend: res.backend,
  };
}

function writeCourseAssetShard(win, courseId, kind, data, options = {}) {
  if (!WD_ASSET_KINDS.includes(kind)) throw new Error(`未知用户资产类型：${kind}`);
  const cid = wdKstSafeCourseId(courseId);
  const now = Date.now();
  const storageKey = buildAssetShardKey(win, cid, kind, options);
  const record = {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    shardKey: `${cid}::${kind}`,
    courseId: cid,
    kind,
    updatedAt: now,
    data: data && typeof data === 'object' ? data : wdKstDefaultAssetData(kind),
  };
  const writeRes = wdKstKvWrite(win, storageKey, record, options);
  if (!writeRes.ok) return writeRes;

  const index = readAssetIndex(win, options);
  const prevCourse = index.courses[cid] || { courseId: cid, shards: [], counts: {}, updatedAt: 0 };
  const shards = Array.from(new Set([...(prevCourse.shards || []), kind]));
  const counts = { ...(prevCourse.counts || {}), [kind]: wdKstCountShardEntries(kind, record.data) };
  index.courses[cid] = { courseId: cid, shards, counts, updatedAt: now };
  wdKstWriteAssetIndex(win, index, options);

  // Best-effort async mirror into IndexedDB when available
  if (options.mirrorIdb !== false) {
    void writeAssetShardToIdb(win, record);
  }
  return { ...writeRes, record };
}

function listIndexedCourseIds(win, options = {}) {
  const index = readAssetIndex(win, options);
  return Object.keys(index.courses || {});
}

// High-level User Asset Helpers (Wrong Questions / Mastery / Review Plan / Notes)
function recordWrongQuestionAsset(win, courseId, entry, options = {}) {
  if (!entry || !entry.questionId) return { ok: false, error: '缺少错题标识' };
  const shard = readCourseAssetShard(win, courseId, 'wrongQuestions', options);
  const items = { ...(shard.data.items || {}) };
  const secId = String(entry.sectionId || 'current');
  const key = `${secId}::${entry.questionId}`;
  const prev = items[key];
  const now = Date.now();
  items[key] = {
    id: key,
    courseId: wdKstSafeCourseId(courseId),
    sectionId: secId,
    sectionTitle: String(entry.sectionTitle || prev?.sectionTitle || ''),
    questionId: String(entry.questionId),
    question: String(entry.question || prev?.question || ''),
    options: Array.isArray(entry.options) ? entry.options : (prev?.options || []),
    chosenIndex: Number.isInteger(entry.chosenIndex) ? entry.chosenIndex : null,
    correctIndex: Number.isInteger(entry.correctIndex) ? entry.correctIndex : (prev?.correctIndex ?? 0),
    answerLetter: String(entry.answerLetter || prev?.answerLetter || ''),
    explanation: String(entry.explanation || prev?.explanation || ''),
    citation: entry.citation || prev?.citation || null,
    wrongCount: (Number(prev?.wrongCount) || 0) + 1,
    firstWrongAt: prev?.firstWrongAt || now,
    lastWrongAt: now,
    mastered: false,
  };
  return writeCourseAssetShard(win, courseId, 'wrongQuestions', { items }, options);
}

function loadCourseWrongQuestions(win, courseId, options = {}) {
  const shard = readCourseAssetShard(win, courseId, 'wrongQuestions', options);
  return Object.values(shard.data.items || {}).sort((a, b) => (b.lastWrongAt || 0) - (a.lastWrongAt || 0));
}

function updateSectionMasteryAsset(win, courseId, sectionId, patch, options = {}) {
  const shard = readCourseAssetShard(win, courseId, 'mastery', options);
  const sections = { ...(shard.data.sections || {}) };
  const sid = String(sectionId || 'current');
  const prev = sections[sid] || { sectionId: sid, status: 'unseen', score: null, wrongCount: 0, reviewCount: 0 };
  sections[sid] = {
    ...prev,
    ...patch,
    sectionId: sid,
    updatedAt: Date.now(),
  };
  return writeCourseAssetShard(win, courseId, 'mastery', { sections }, options);
}

function loadCourseMastery(win, courseId, options = {}) {
  return readCourseAssetShard(win, courseId, 'mastery', options).data.sections || {};
}

function loadCourseReviewPlan(win, courseId, options = {}) {
  return readCourseAssetShard(win, courseId, 'reviewPlan', options).data;
}

function saveCourseReviewPlan(win, courseId, planData, options = {}) {
  const next = {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    cards: Array.isArray(planData?.cards) ? planData.cards : [],
    schedule: planData?.schedule && typeof planData.schedule === 'object'
      ? { targetDate: planData.schedule.targetDate || null, dailyGoal: planData.schedule.dailyGoal ?? null }
      : { targetDate: null, dailyGoal: null },
  };
  return writeCourseAssetShard(win, courseId, 'reviewPlan', next, options);
}

function loadSectionNotes(win, courseId, sectionId, options = {}) {
  const shard = readCourseAssetShard(win, courseId, 'notes', options);
  const sid = String(sectionId || 'current');
  const list = shard.data.sections?.[sid];
  return Array.isArray(list) ? list : [];
}

function saveSectionNote(win, courseId, sectionId, note, options = {}) {
  const shard = readCourseAssetShard(win, courseId, 'notes', options);
  const sections = { ...(shard.data.sections || {}) };
  const sid = String(sectionId || 'current');
  const prev = Array.isArray(sections[sid]) ? [...sections[sid]] : [];
  const now = Date.now();
  const nextNote = {
    id: note?.id || `note-${now}-${prev.length + 1}`,
    sectionId: sid,
    segId: note?.segId || null,
    seconds: Number.isFinite(note?.seconds) ? Math.floor(note.seconds) : null,
    content: String(note?.content || '').trim(),
    createdAt: note?.createdAt || now,
    updatedAt: now,
  };
  const existingIdx = prev.findIndex(item => item.id === nextNote.id);
  if (existingIdx >= 0) prev[existingIdx] = nextNote;
  else prev.push(nextNote);
  sections[sid] = prev;
  return writeCourseAssetShard(win, courseId, 'notes', { sections }, options);
}

// ============================================================================
// Rebuildable Cache Layer (localStorage LRU + TTL + Size Budget)
// ============================================================================

function wdKstEstimateBytes(obj) {
  try {
    return JSON.stringify(obj).length * 2;
  } catch {
    return 0;
  }
}

function readLruCacheMap(win, storageKey) {
  const ls = wdKstLocalStorage(win);
  if (!ls || typeof ls.getItem !== 'function') return {};
  try {
    const raw = ls.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLruCacheMap(win, storageKey, map, policy = {}) {
  const ls = wdKstLocalStorage(win);
  if (!ls || typeof ls.setItem !== 'function') return { ok: false, evicted: 0 };
  const now = Number.isFinite(policy.now) ? policy.now : Date.now();
  const maxEntries = Number.isFinite(policy.maxEntries) ? Math.max(1, policy.maxEntries) : 40;
  const maxBytes = Number.isFinite(policy.maxBytes) ? Math.max(4096, policy.maxBytes) : 1536 * 1024;
  const ttlMs = Number.isFinite(policy.ttlMs) ? Math.max(1000, policy.ttlMs) : 14 * 24 * 60 * 60 * 1000;

  let evicted = 0;
  const validEntries = [];
  for (const [k, v] of Object.entries(map || {})) {
    if (!v || typeof v !== 'object') { evicted += 1; continue; }
    const cachedAt = Number(v.cachedAt) || 0;
    if (cachedAt > 0 && now - cachedAt > ttlMs) {
      evicted += 1;
      continue;
    }
    validEntries.push([k, v]);
  }

  validEntries.sort((a, b) => {
    const ta = Number(a[1].lastAccessedAt || a[1].cachedAt) || 0;
    const tb = Number(b[1].lastAccessedAt || b[1].cachedAt) || 0;
    return tb - ta;
  });

  if (validEntries.length > maxEntries) {
    evicted += validEntries.length - maxEntries;
  }
  const kept = validEntries.slice(0, maxEntries);

  // Enforce byte budget from MRU to LRU
  while (kept.length > 1 && wdKstEstimateBytes(Object.fromEntries(kept)) > maxBytes) {
    kept.pop();
    evicted += 1;
  }

  // Handle QuotaExceededError cleanly by dropping least-recently-used entries
  for (let limit = kept.length; limit >= 0; limit -= 1) {
    try {
      const pruned = Object.fromEntries(kept.slice(0, limit));
      ls.setItem(storageKey, JSON.stringify(pruned));
      return { ok: true, kept: limit, evicted: evicted + (kept.length - limit), bytes: wdKstEstimateBytes(pruned) };
    } catch { /* quota exceeded -> evict oldest and retry */ }
  }
  return { ok: false, kept: 0, evicted: evicted + kept.length, bytes: 0 };
}

function getLruCacheEntry(win, storageKey, key, policy = {}) {
  if (!key) return null;
  const now = Number.isFinite(policy.now) ? policy.now : Date.now();
  const ttlMs = Number.isFinite(policy.ttlMs) ? Math.max(1000, policy.ttlMs) : 14 * 24 * 60 * 60 * 1000;
  const map = readLruCacheMap(win, storageKey);
  const entry = map[key];
  if (!entry || typeof entry !== 'object') return null;
  const cachedAt = Number(entry.cachedAt) || 0;
  if (cachedAt > 0 && now - cachedAt > ttlMs) {
    delete map[key];
    writeLruCacheMap(win, storageKey, map, { ...policy, now });
    return null;
  }
  if (typeof policy.schemaVersion === 'number' && entry.schemaVersion !== policy.schemaVersion) {
    return null;
  }
  // Touch LRU access timestamp
  map[key] = { ...entry, lastAccessedAt: now };
  writeLruCacheMap(win, storageKey, map, { ...policy, now });
  return map[key];
}

function setLruCacheEntry(win, storageKey, key, entry, policy = {}) {
  if (!key || !entry || typeof entry !== 'object') return false;
  const now = Number.isFinite(policy.now) ? policy.now : Date.now();
  const map = readLruCacheMap(win, storageKey);
  map[key] = {
    ...entry,
    cachedAt: Number(entry.cachedAt) || now,
    lastAccessedAt: now,
  };
  const res = writeLruCacheMap(win, storageKey, map, { ...policy, now });
  return Boolean(res.ok);
}

function clearLruCache(win, storageKey, key = null) {
  const ls = wdKstLocalStorage(win);
  if (!ls) return false;
  try {
    if (!key) {
      ls.removeItem(storageKey);
      return true;
    }
    const map = readLruCacheMap(win, storageKey);
    delete map[key];
    ls.setItem(storageKey, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

function loadSubtitleParseCache(win, courseId, sectionId, policy = {}) {
  const key = `${wdKstSafeCourseId(courseId)}::${String(sectionId || 'current')}`;
  return getLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.subtitles, key, {
    ...WD_CACHE_LRU_DEFAULTS.subtitles,
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    ...policy,
  });
}

function saveSubtitleParseCache(win, courseId, sectionId, payload, policy = {}) {
  const key = `${wdKstSafeCourseId(courseId)}::${String(sectionId || 'current')}`;
  return setLruCacheEntry(win, WD_CACHE_STORAGE_KEYS.subtitles, key, {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    courseId: wdKstSafeCourseId(courseId),
    sectionId: String(sectionId || 'current'),
    segments: Array.isArray(payload?.segments) ? payload.segments : [],
    durationSec: Number.isFinite(payload?.durationSec) ? payload.durationSec : null,
    source: payload?.source || '',
  }, { ...WD_CACHE_LRU_DEFAULTS.subtitles, ...policy });
}

// ============================================================================
// One-Time Legacy Migration (Never Loses Raw Data on Failure)
// ============================================================================

function wdKstMigrationReceiptKey(win, options = {}) {
  return resolveGmStorage(win, options.gmStorage)
    ? WD_GM_STORAGE_KEYS.migration
    : WD_FALLBACK_STORAGE_KEYS.migration;
}

function readMigrationReceipt(win, options = {}) {
  const res = wdKstKvRead(win, wdKstMigrationReceiptKey(win, options), options);
  return res.ok && res.value && typeof res.value === 'object' ? res.value : null;
}

function wdKstSplitLegacySectionKey(compoundKey) {
  const str = String(compoundKey || '');
  const idx = str.indexOf('::');
  if (idx < 0) return { courseId: 'unknown', sectionId: str || 'current' };
  return {
    courseId: str.slice(0, idx) || 'unknown',
    sectionId: str.slice(idx + 2) || 'current',
  };
}

function migrateLegacyStorage(win, options = {}) {
  const force = Boolean(options.force);
  const gm = resolveGmStorage(win, options.gmStorage);
  const ls = wdKstLocalStorage(win);
  const backend = gm ? 'gm' : (ls ? 'localStorage-fallback' : 'unavailable');
  const existingReceipt = readMigrationReceipt(win, options);
  if (
    !force
    && existingReceipt
    && existingReceipt.schemaVersion === WD_STORAGE_SCHEMA_VERSION
    && existingReceipt.backend === backend
    && ['migrated', 'noop', 'degraded'].includes(existingReceipt.status)
  ) {
    return existingReceipt;
  }
  const warnings = [];
  const items = {
    config: { status: 'skipped', count: 0 },
    apiKey: { status: 'skipped', count: 0 },
    qa: { status: 'skipped', count: 0 },
    quiz: { status: 'skipped', count: 0 },
    cache: { status: 'skipped', count: 0 },
  };

  if (!ls || typeof ls.getItem !== 'function') {
    const receipt = {
      schemaVersion: WD_STORAGE_SCHEMA_VERSION,
      completedAt: Date.now(),
      status: 'noop',
      backend,
      items,
      warnings: ['当前环境无 localStorage，跳过旧版数据迁移。'],
    };
    wdKstKvWrite(win, wdKstMigrationReceiptKey(win, options), receipt, options);
    return receipt;
  }

  let anyMigrated = false;
  let anyFailed = false;

  // 1. Migrate AI Config (only needs cross-backend move when GM is available)
  try {
    const rawConfig = ls.getItem(WD_LEGACY_STORAGE_KEYS.config);
    if (rawConfig) {
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(rawConfig);
      } catch (parseErr) {
        anyFailed = true;
        items.config = { status: 'failed', count: 0, preservedRaw: true, error: `配置 JSON 解析失败：${parseErr.message}` };
        warnings.push('旧版 AI 配置数据损坏，已保留原始 localStorage 数据未删除。');
      }
      if (parsedConfig && typeof parsedConfig === 'object' && !Array.isArray(parsedConfig)) {
        if (gm) {
          const existing = readStoredAiConfig(win, options).config;
          const hasExisting = existing && typeof existing.provider === 'string' && existing.updatedAt;
          if (!hasExisting) {
            const wRes = writeStoredAiConfig(win, parsedConfig, options);
            const verified = wRes.ok && Boolean(readStoredAiConfig(win, options).config?.provider || Object.keys(parsedConfig).length === 0);
            if (verified) {
              anyMigrated = true;
              items.config = { status: 'migrated', count: 1, cleanedLegacy: false };
            } else {
              anyFailed = true;
              items.config = { status: 'failed', count: 0, preservedRaw: true, error: wRes.error || 'GM 写入校验失败' };
              warnings.push('旧版 AI 配置迁入 GM_setValue 失败，已保留原始 localStorage 数据。');
            }
          } else {
            items.config = { status: 'skipped', count: 0, reason: 'target-exists' };
          }
        } else {
          items.config = { status: 'degraded-kept', count: 1, preservedRaw: true };
        }
      }
    }
  } catch (err) {
    anyFailed = true;
    items.config = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
    warnings.push('读取旧版 AI 配置失败，已保留原始数据。');
  }

  // 2. Migrate API Key to GM_setValue (and scrub plaintext from localStorage ONLY after GM read-back verification)
  try {
    const rawKey = ls.getItem(WD_LEGACY_STORAGE_KEYS.apiKey);
    if (rawKey && String(rawKey).trim()) {
      const trimmedKey = String(rawKey).trim();
      if (gm) {
        const existingKey = readStoredAiApiKey(win, options).apiKey;
        if (!existingKey) {
          const wRes = wdKstKvWrite(win, WD_GM_STORAGE_KEYS.apiKey, trimmedKey, options);
          const readBack = readStoredAiApiKey(win, options).apiKey;
          if (wRes.ok && readBack === trimmedKey) {
            anyMigrated = true;
            try { ls.removeItem(WD_LEGACY_STORAGE_KEYS.apiKey); } catch { /* ignore */ }
            items.apiKey = { status: 'migrated', count: 1, cleanedLegacy: true };
          } else {
            anyFailed = true;
            items.apiKey = { status: 'failed', count: 0, preservedRaw: true, error: wRes.error || 'GM API Key 回读校验失败' };
            warnings.push('API Key 迁移到 GM_setValue 失败，已保留原 localStorage 中的 Key 以防丢失。');
          }
        } else {
          // GM already holds a key; safe to scrub old plaintext copy
          try { ls.removeItem(WD_LEGACY_STORAGE_KEYS.apiKey); } catch { /* ignore */ }
          items.apiKey = { status: 'skipped', count: 0, reason: 'target-exists', cleanedLegacy: true };
        }
      } else {
        items.apiKey = { status: 'degraded-kept', count: 1, preservedRaw: true };
        warnings.push('当前非油猴环境无法迁移 API Key 至 GM_setValue，已暂留于 localStorage 并启用降级模式。');
      }
    }
  } catch (err) {
    anyFailed = true;
    items.apiKey = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
    warnings.push('API Key 迁移异常，已保留原始数据。');
  }

  // 3. Migrate Legacy Q&A History -> Per-Course Durable Shards (NO 30-entry cap!)
  try {
    const rawQa = ls.getItem(WD_LEGACY_STORAGE_KEYS.qa);
    if (rawQa) {
      let qaMap;
      try {
        qaMap = JSON.parse(rawQa);
      } catch (parseErr) {
        anyFailed = true;
        items.qa = { status: 'failed', count: 0, preservedRaw: true, error: `问答 JSON 解析失败：${parseErr.message}` };
        warnings.push('旧版问答记录解析失败，已保留原始 localStorage 数据未删除。');
      }
      if (qaMap && typeof qaMap === 'object' && !Array.isArray(qaMap)) {
        const byCourse = new Map();
        for (const [compoundKey, entry] of Object.entries(qaMap)) {
          if (!entry || !Array.isArray(entry.messages) || !entry.messages.length) continue;
          const { courseId, sectionId } = wdKstSplitLegacySectionKey(compoundKey);
          if (!byCourse.has(courseId)) byCourse.set(courseId, {});
          byCourse.get(courseId)[sectionId] = entry;
        }
        let migratedSections = 0;
        let qaFailed = false;
        for (const [courseId, secEntries] of byCourse.entries()) {
          const shard = readCourseAssetShard(win, courseId, 'qa', options);
          const merged = { ...(shard.data || {}) };
          for (const [secId, oldEntry] of Object.entries(secEntries)) {
            if (!merged[secId]) {
              const ts = Number(oldEntry.updatedAt) || Date.now();
              merged[secId] = {
                activeSessionId: 'default',
                updatedAt: ts,
                sessions: {
                  default: {
                    id: 'default',
                    title: '历史问答（已迁移）',
                    kind: 'general',
                    createdAt: ts,
                    updatedAt: ts,
                    messages: oldEntry.messages,
                  },
                },
              };
              migratedSections += 1;
            }
          }
          const wRes = writeCourseAssetShard(win, courseId, 'qa', merged, options);
          if (!wRes.ok) {
            qaFailed = true;
            anyFailed = true;
            warnings.push(`课程 ${courseId} 问答记录迁移失败（${wRes.error || '写入失败'}），原始数据已保留。`);
          }
        }
        if (qaFailed) {
          items.qa = { status: 'failed', count: migratedSections, preservedRaw: true };
        } else if (migratedSections > 0) {
          anyMigrated = true;
          items.qa = { status: 'migrated', count: migratedSections, courses: byCourse.size, preservedBackup: true };
        }
      }
    }
  } catch (err) {
    anyFailed = true;
    items.qa = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
    warnings.push('旧版问答记录迁移异常，已保留原始数据。');
  }

  // 4. Migrate Legacy Quiz Records -> Per-Course Durable Shards + Wrong Question Extraction
  try {
    const rawQuiz = ls.getItem(WD_LEGACY_STORAGE_KEYS.quiz);
    if (rawQuiz) {
      let quizMap;
      try {
        quizMap = JSON.parse(rawQuiz);
      } catch (parseErr) {
        anyFailed = true;
        items.quiz = { status: 'failed', count: 0, preservedRaw: true, error: `测验 JSON 解析失败：${parseErr.message}` };
        warnings.push('旧版测验记录解析失败，已保留原始 localStorage 数据未删除。');
      }
      if (quizMap && typeof quizMap === 'object' && !Array.isArray(quizMap)) {
        const byCourse = new Map();
        for (const [compoundKey, entry] of Object.entries(quizMap)) {
          if (!entry || !Array.isArray(entry.questions) || !entry.questions.length) continue;
          const { courseId, sectionId } = wdKstSplitLegacySectionKey(compoundKey);
          if (!byCourse.has(courseId)) byCourse.set(courseId, {});
          byCourse.get(courseId)[sectionId] = entry;
        }
        let migratedSections = 0;
        let migratedWrongs = 0;
        let quizFailed = false;
        for (const [courseId, secEntries] of byCourse.entries()) {
          const shard = readCourseAssetShard(win, courseId, 'quiz', options);
          const merged = { ...(shard.data || {}) };
          for (const [secId, oldQuiz] of Object.entries(secEntries)) {
            if (!merged[secId]) {
              merged[secId] = { ...oldQuiz, migratedAt: Date.now() };
              migratedSections += 1;
              // Extract any submitted wrong choice answers into durable wrongQuestions shard
              if (oldQuiz.attempt?.submitted && oldQuiz.attempt?.answers) {
                for (const q of oldQuiz.questions) {
                  if (q.type !== 'choice') continue;
                  const chosen = oldQuiz.attempt.answers[q.id];
                  if (Number.isInteger(chosen) && chosen !== q.correctIndex) {
                    const wr = recordWrongQuestionAsset(win, courseId, {
                      sectionId: secId,
                      sectionTitle: oldQuiz.sectionTitle || '',
                      questionId: q.id,
                      question: q.question,
                      options: q.options,
                      chosenIndex: chosen,
                      correctIndex: q.correctIndex,
                      answerLetter: q.answerLetter,
                      explanation: q.explanation,
                    }, options);
                    if (wr.ok) migratedWrongs += 1;
                  }
                }
              }
            }
          }
          const wRes = writeCourseAssetShard(win, courseId, 'quiz', merged, options);
          if (!wRes.ok) {
            quizFailed = true;
            anyFailed = true;
            warnings.push(`课程 ${courseId} 测验记录迁移失败（${wRes.error || '写入失败'}），原始数据已保留。`);
          }
        }
        if (quizFailed) {
          items.quiz = { status: 'failed', count: migratedSections, preservedRaw: true };
        } else if (migratedSections > 0) {
          anyMigrated = true;
          items.quiz = { status: 'migrated', count: migratedSections, wrongQuestions: migratedWrongs, courses: byCourse.size, preservedBackup: true };
        }
      }
    }
  } catch (err) {
    anyFailed = true;
    items.quiz = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
    warnings.push('旧版测验记录迁移异常，已保留原始数据。');
  }

  // 5. Inspect & Migrate Rebuildable Knowledge Cache (v2 -> v3 LRU metadata; never fails asset migration)
  try {
    const rawCacheV2 = ls.getItem(WD_LEGACY_STORAGE_KEYS.cacheV2);
    if (rawCacheV2) {
      let cacheMap;
      try {
        cacheMap = JSON.parse(rawCacheV2);
      } catch (parseErr) {
        anyFailed = true;
        items.cache = { status: 'failed', count: 0, preservedRaw: true, error: `缓存 JSON 解析失败：${parseErr.message}` };
        warnings.push('旧版知识缓存解析失败，已保留原始记录未删除。');
      }
      if (cacheMap && typeof cacheMap === 'object' && !Array.isArray(cacheMap)) {
        let migratedCacheCount = 0;
        const targetMap = readLruCacheMap(win, WD_CACHE_STORAGE_KEYS.knowledge);
        for (const [k, entry] of Object.entries(cacheMap)) {
          // Only migrate valid v2 entries (v1 / malformed entries intentionally skipped so stale ellipsis caches never return)
          if (!entry || typeof entry !== 'object' || entry.schemaVersion !== 2 || !entry.tree || typeof entry.markdown !== 'string') continue;
          if (!targetMap[k]) {
            targetMap[k] = {
              ...entry,
              schemaVersion: WD_CACHE_SCHEMA_VERSION,
              legacySchemaVersion: 2,
              migratedAt: Date.now(),
              lastAccessedAt: Number(entry.cachedAt) || Date.now(),
            };
            migratedCacheCount += 1;
          }
        }
        if (migratedCacheCount > 0) {
          const wRes = writeLruCacheMap(win, WD_CACHE_STORAGE_KEYS.knowledge, targetMap, WD_CACHE_LRU_DEFAULTS.knowledge);
          if (wRes.ok) {
            anyMigrated = true;
            items.cache = { status: 'migrated', count: migratedCacheCount, kept: wRes.kept, evicted: wRes.evicted };
          } else {
            anyFailed = true;
            items.cache = { status: 'failed', count: 0, preservedRaw: true, error: '写入新版 LRU 缓存失败' };
            warnings.push('旧版知识缓存迁移失败，原始缓存已保留。');
          }
        }
      }
    }
  } catch (err) {
    anyFailed = true;
    items.cache = { status: 'failed', count: 0, preservedRaw: true, error: err?.message || String(err) };
  }

  const finalStatus = anyFailed
    ? (anyMigrated ? 'partial' : 'failed')
    : anyMigrated
      ? (gm ? 'migrated' : 'degraded')
      : (gm ? 'noop' : 'degraded');

  const receipt = {
    schemaVersion: WD_STORAGE_SCHEMA_VERSION,
    completedAt: Date.now(),
    status: finalStatus,
    backend,
    items,
    warnings,
  };
  wdKstKvWrite(win, wdKstMigrationReceiptKey(win, options), receipt, options);
  return receipt;
}

function ensureStorageMigrated(win, options = {}) {
  return migrateLegacyStorage(win, { ...options, force: false });
}



const wdKvttAllowedVttHosts = host => typeof host === 'string' && (host === 'wangda.chinamobile.com' || host.endsWith('.wangda.chinamobile.com'));
const wdKvttCourseRoutePattern = /^#\/study\/course\/detail\/(?:subject-course\/)?([A-Za-z0-9_-]+)(?:\/(\d+)(?:\/([A-Za-z0-9_-]+))?)?$/u;
const wdKvttNoisePattern = /(?:\[音乐\]|\[掌声\]|\[笑声\]|\(音乐\)|\(掌声\)|（音乐）|（掌声）|[♪♫♬]+)/gu;
const wdKvttDiscoursePattern = /^(?:接下来|首先|其次|再次|第一|第二|第三|第四|最后|总结一下|总的来说|下面我们|那么下面|换句话说|另一方面|需要注意)/u;
const wdKvttStopWords = new Set([
  '我们', '你们', '他们', '自己', '这个', '那个', '这种', '这样', '那样', '就是', '然后', '所以', '因为',
  '可以', '一个', '一些', '这里', '那里', '大家', '其实', '如果', '那么', '什么', '怎么', '为什么',
  '进行', '通过', '以及', '或者', '已经', '现在', '目前', '今年', '上半年', '下半年', '时候', '时期',
  '问题', '方面', '内容', '课程', '课节', '第一门', '胶片', '一下', '一点', '不是', '没有', '需要',
  '非常', '比较', '可能', '应该', '还是', '也是', '都是', '其中', '主要', '相关', '具体', '基本', '总体',
  '一般', '首先', '其次', '接下来', '介绍', '学习', '今天', '关于', '里面', '上面', '下面', '之后', '之前',
  '以后', '以前', '开始', '结束', '第一', '第二', '第三', '第四', '最后', '另外', '此外', '还有', '而且',
  '同时', '并且', '从而', '进而', '但是', '不过', '比如', '比如说', '包括', '例如', '的话', '来说', '来讲',
  '来看', '而言', '过程', '情况', '东西', '事情', '地方', '方式', '方法', '工作', '大家看', '可以看到',
]);
const wdKvttStopAcronyms = new Set([
  'OK', 'PPT', 'PDF', 'URL', 'HTTP', 'HTTPS', 'HTML', 'CSS', 'JSON', 'VTT', 'WEBVTT',
  'ID', 'NO', 'VS', 'AM', 'PM', 'THE', 'AND', 'FOR', 'NOT', 'ALL', 'ARE', 'BUT', 'YOU', 'CAN', 'ONE', 'TWO', 'NEW',
]);
const wdKvttTrailingEllipsisPattern = /(?:\u2026|\u22ef|\u22ee|\.{2,}|·{3,})\s*[。！？!?)）\]】》」”'"]*$/u;
const wdKvttBoilerplatePrefixPattern = /^(?:课程提及|课程提到|本课提及|本节提及|视频提及|字幕提及|零\s*AI\s*提炼（首段摘要）|零\s*AI\s*提炼|零\s*AI\s*整课速览)[：:\s]*/u;
const wdKvttSpokenLeadPattern = /^(?:大家好|同学们好|各位好|各位同学好|欢迎大家|那么|然后|所以|因此|但是|不过|而且|另外|此外|就是说|就是|其实|这个呢就是|这个就是|这个呢|那个呢|还有就是|再一个就是|第一个就是|第二个就是|第三个就是|第一就是|第二就是|第三就是|在今年的上半年的时候|在今年的下半年的时候|在今年上半年的时候|大家看|我们可以看到|可以看到|接下来我们来看|接下来我们看|下面我们来看|下面我们看|首先我们来看|首先我们看|首先介绍|接下来介绍|下面介绍|接下来|首先|其次|今天我们|今天这节课我们|这节课我们|本节课我们|比如说像|比如说|比如)[，,、：:\s]*/u;
const wdKvttDanglingTailPattern = /(?:(?<!目|标)的|得|(?<!落|本|基|实|场|阵|高|洼|腹|领|各|多|异|原|湿|耕|林|土|工|绿|山)地|了|着|和|与|或|或者|及|以及|包括|比如|比如说|例如|像|把|将|被|因为|所以|但是|然后|而且|如果|并|并且|从而|进而|非常|比较|不是很|不是太|也不是很|也是|这个|那个|这种|这样|那样|这些|那些|的这|的那|的话|时候|面向|针对|关于|对于|通过|基于|围绕|按照|根据|随着|正在|在于|仍在|还在|用于|用来|属于|走向|迈向|在向|向着|成为|认为|视为|以为|较为|最为|就是|不是|还是|都是|只是|而是|却是|算是|便是|即是|没有|还有|只有|唯有|拥有|具有|含有|带有)$/u;
const wdKvttIntroMetaPattern = /(?:准备的胶片|时间(?:也)?比较短|欢迎来到|谢谢大家|感谢大家|今天就讲到这里|以上就是今天|第一门课程是.+的介绍|今天我们第一门课程)/u;
const wdKvttSensitiveQueryParams = new Set(['token', 'access_token', 'auth_key', 'sign', 'signature', 'key', 'secret', 'ticket', 'pwd', 'password']);

function hasTrailingEllipsis(text) {
  return wdKvttTrailingEllipsisPattern.test(String(text ?? '').trim());
}

function wdKvttHasUnbalancedBracket(str) {
  const pairs = [['(', ')'], ['（', '）'], ['《', '》'], ['「', '」'], ['“', '”'], ['[', ']'], ['【', '】']];
  for (const [open, close] of pairs) {
    let balance = 0;
    for (const ch of str) {
      if (ch === open) balance += 1;
      else if (ch === close) balance -= 1;
    }
    if (balance > 0) return true;
  }
  return false;
}

function isIncompleteFragment(text, options = {}) {
  const strict = Boolean(options.strict);
  const str = String(text ?? '').trim();
  if (!str) return true;
  if (hasTrailingEllipsis(str)) return true;
  if (/[，,、：:;；—\-/（(\[【《「“]$/u.test(str)) return true;
  if (wdKvttHasUnbalancedBracket(str)) return true;
  if (strict) {
    const core = str.replace(/[。！？!?]+$/u, '').trim();
    if (!core) return true;
    if (wdKvttDanglingTailPattern.test(core)) return true;
  }
  return false;
}

function wdKvttSplitSentenceUnits(text) {
  const str = String(text ?? '').replace(/\r?\n/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!str) return [];
  const raw = str.match(/[^。！？!?；;]+[。！？!?；;]?/gu) || [];
  return raw.map(s => s.trim()).filter(Boolean);
}

function wdKvttSplitClauseUnits(text) {
  const str = String(text ?? '').trim();
  if (!str) return [];
  // Prefer explicit Chinese/English clause punctuation first
  const byPunc = str.split(/[，,：:；;]+/u).map(s => s.trim()).filter(Boolean);
  if (byPunc.length > 1) return byPunc;
  // Next split on ASR whitespace pauses (only when space separates Chinese or clause chunks, not inside "AI 算力")
  const bySpace = str.split(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])|\s{2,}/u).map(s => s.trim()).filter(Boolean);
  if (bySpace.length > 1) return bySpace;
  // Finally split before natural Chinese spoken discourse connectors in unpunctuated ASR streams
  const marked = str.replace(/(?<=[\u4e00-\u9fa5A-Za-z0-9]{6})(?=(?:还有就是|第二个就是|第一个就是|第三个就是|也就是说|换句话说|总的来说|总结一下|与此同时|另一方面|一方面|但是|不过|因此|所以|然后|而且|同时|此外|另外|从而|进而|并且|这也是|这也证明|也是证明))/gu, '\u0000');
  const byDiscourse = marked.split('\u0000').map(s => s.trim()).filter(Boolean);
  return byDiscourse.length > 1 ? byDiscourse : [str];
}

function wdKvttStripSpokenFillers(text) {
  let out = String(text ?? '').replace(wdKvttBoilerplatePrefixPattern, '').trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = out.replace(wdKvttSpokenLeadPattern, '').trim();
    if (next === out) break;
    out = next;
  }
  // Smooth ASR internal pause spaces before Chinese clause continuations into a clean comma
  out = out.replace(/(?<=[\u4e00-\u9fa5A-Za-z0-9])\s+(?=(?:这也|也是|包括|同时|而且|并且|从而|进而|因此|所以|但是|不过|降低|提升|助力|推动|支持|实现|构建))/gu, '，');
  out = out.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[A-Z]{2,}(?:\s|[\u4e00-\u9fa5]))/gu, ' ');
  out = out.replace(/^[，,、：:；;\s]+/u, '').replace(/[啊呢吧哦嘛]+(?=[。！？!?]?$)/gu, '').trim();
  return out;
}

function sanitizeCompleteText(rawText, options = {}) {
  const maxLen = Number.isFinite(options.maxLen) ? options.maxLen : 64;
  const minLen = Number.isFinite(options.minLen) ? options.minLen : (options.allowShort ? 2 : 6);
  const stripPrefixes = options.stripPrefixes !== false;
  const stripSpoken = Boolean(options.stripSpoken);
  const ensurePeriod = Boolean(options.ensurePeriod);
  const strictFragment = Boolean(options.strictFragment);
  const allowClauseSplit = Boolean(options.allowClauseSplit);

  let str = String(rawText ?? '').replace(/\r?\n/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!str) return '';
  if (stripPrefixes) str = str.replace(wdKvttBoilerplatePrefixPattern, '').trim();
  if (stripSpoken) str = wdKvttStripSpokenFillers(str);
  if (!str) return '';

  // Never keep a truncated tail ending with ellipsis or dangling punctuation: salvage earlier complete sentences only
  if (hasTrailingEllipsis(str) || /[，,、：:；;—\-/（(\[【《「“]$/u.test(str) || wdKvttHasUnbalancedBracket(str)) {
    const completed = (str.match(/[^。！？!?；;]+[。！？!?；;]/gu) || [])
      .map(s => (stripSpoken ? wdKvttStripSpokenFillers(s) : s.trim()))
      .filter(s => s && !isIncompleteFragment(s, { strict: strictFragment }));
    if (!completed.length) return '';
    let acc = '';
    for (const s of completed) {
      if (acc && acc.length + s.length > maxLen) break;
      if (!acc && s.length > maxLen) break;
      acc += s;
    }
    str = acc.trim();
    if (!str) return '';
  }

  // Fit within maxLen ONLY at complete sentence or semantic clause boundaries — NEVER hard-slice or append "…"
  if (str.length > maxLen) {
    const units = wdKvttSplitSentenceUnits(str);
    let acc = '';
    for (const u of units) {
      const cleaned = stripSpoken ? wdKvttStripSpokenFillers(u) : u.trim();
      if (!cleaned || isIncompleteFragment(cleaned, { strict: strictFragment })) continue;
      if (acc && acc.length + cleaned.length > maxLen) break;
      if (!acc && cleaned.length > maxLen) {
        if (allowClauseSplit) {
          const clauses = wdKvttSplitClauseUnits(cleaned);
          if (clauses.length > 1) {
            let clauseAcc = '';
            for (const c of clauses) {
              const cClean = stripSpoken ? wdKvttStripSpokenFillers(c) : c.trim();
              if (!cClean) continue;
              const candidate = clauseAcc ? `${clauseAcc}，${cClean}` : cClean;
              if (candidate.length <= maxLen) {
                clauseAcc = candidate;
              } else {
                break;
              }
            }
            if (clauseAcc && !isIncompleteFragment(clauseAcc, { strict: true })) {
              acc = clauseAcc;
            }
          }
        }
        break;
      }
      acc += cleaned;
    }
    str = acc.trim();
  }

  if (!str) return '';
  str = str.replace(/[；;]+$/u, '。').trim();
  if (isIncompleteFragment(str, { strict: strictFragment })) return '';
  if (ensurePeriod && !/[。！？!?]$/u.test(str)) {
    if (str.length + 1 <= maxLen + 2) str = `${str}。`;
  }
  const coreLen = str.replace(/[。！？!?]+$/u, '').trim().length;
  if (coreLen < minLen) return '';
  if (hasTrailingEllipsis(str)) return '';
  return str;
}

const SUBTITLE_FALLBACK_ORDER = [
  { id: 'captionVtt', label: '1. 课节 captionVtt 直链（app._modules trackUrl / trackList）' },
  { id: 'videojs-textTracks', label: '2. Video.js textTracks（含切换 AI 字幕开关后再读）' },
  { id: 'other-sources', label: '3. 页面/接口其它字幕来源（caption 接口 / 原生 video.textTracks / DOM <track>）' },
];

function redactSubtitleUrl(rawUrl) {
  const str = String(rawUrl ?? '').trim();
  if (!str) return null;
  try {
    const parsed = new URL(str, 'https://wangda.chinamobile.com/');
    for (const param of [...parsed.searchParams.keys()]) {
      if (wdKvttSensitiveQueryParams.has(param.toLowerCase())) {
        parsed.searchParams.set(param, '***');
      }
    }
    return parsed.toString();
  } catch {
    return str.slice(0, 180);
  }
}

function formatSubtitleDiagnosticsText(diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  if (!list.length) return '暂无字幕抓取诊断记录。';
  return list.map((item, idx) => {
    const statusText = item.status !== null && item.status !== undefined ? `HTTP ${item.status}` : '非HTTP';
    const okTag = item.ok ? '成功' : '失败';
    const urlPart = item.url ? ` | url=${item.url}` : '';
    return `${idx + 1}. [${okTag}] 《${item.sectionTitle || item.sectionId || '当前课节'}》 ${item.pathLabel || item.path} | ${statusText} | cues=${item.cueCount ?? 0}${urlPart} | ${item.reason || ''}`;
  }).join('\n');
}

function formatTimestamp(seconds) {
  const num = Number(seconds);
  if (!Number.isFinite(num) || num < 0) return '00:00';
  const total = Math.floor(num);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function parseTimestampToSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value ?? '').trim().replace(/^[([【]+|[)\]】]+$/gu, '');
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/u.exec(text);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const ms = match[4] ? Number(match[4].padEnd(3, '0')) : 0;
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function escapeMarkdownText(text) {
  return String(text ?? '')
    .replace(/\r?\n/gu, ' ')
    .replace(/</gu, '＜')
    .replace(/>/gu, '＞')
    .replace(/\[/gu, '［')
    .replace(/\]/gu, '］')
    .replace(/\s+/gu, ' ')
    .trim();
}

function wdKvttStripCueText(raw) {
  return String(raw ?? '')
    .replace(/<\/?(?:c|v|i|b|u|ruby|rt|lang)(?:\.[^>\s]+)?(?:\s+[^>]*)?>/giu, '')
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/gu, '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(wdKvttNoisePattern, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseWebVtt(rawText) {
  const normalized = String(rawText ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  if (!normalized.trim()) return [];
  const blocks = normalized.split(/\n{2,}/u);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const head = lines[0];
    if (/^(?:WEBVTT|NOTE\b|STYLE\b|REGION\b)/iu.test(head)) continue;
    const timeLineIndex = lines.findIndex(line => line.includes('-->'));
    if (timeLineIndex < 0) continue;
    const id = timeLineIndex > 0 ? lines[timeLineIndex - 1] : null;
    const timeLine = lines[timeLineIndex];
    const parts = timeLine.split('-->');
    if (parts.length < 2) continue;
    const startSec = parseTimestampToSeconds(parts[0].trim());
    const endToken = parts[1].trim().split(/\s+/u)[0];
    const endSec = parseTimestampToSeconds(endToken);
    if (startSec === null || endSec === null) continue;
    const textLines = lines.slice(timeLineIndex + 1);
    const cleaned = wdKvttStripCueText(textLines.join(' '));
    if (!cleaned) continue;
    cues.push({
      index: cues.length + 1,
      id,
      startMs: Math.round(startSec * 1000),
      endMs: Math.round(Math.max(endSec, startSec) * 1000),
      startSec,
      endSec: Math.max(endSec, startSec),
      text: cleaned,
    });
  }
  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.text.localeCompare(b.text));
  return cues.map((cue, idx) => ({ ...cue, index: idx + 1 }));
}

function cleanAndSegmentCues(rawCues, options = {}) {
  const mergeGapMs = Number.isFinite(options.mergeGapMs) ? options.mergeGapMs : 500;
  const maxSegmentChars = Number.isFinite(options.maxSegmentChars) ? options.maxSegmentChars : 320;
  const minSegmentChars = Number.isFinite(options.minSegmentChars) ? options.minSegmentChars : 100;
  const pauseBreakMs = Number.isFinite(options.pauseBreakMs) ? options.pauseBreakMs : 1500;
  const sectionId = String(options.sectionId || 'current').trim() || 'current';
  const list = (Array.isArray(rawCues) ? rawCues : [])
    .map(cue => {
      const startMs = Number.isFinite(cue?.startMs) ? Math.round(cue.startMs) : Math.round((Number(cue?.startSec ?? cue?.startTime ?? 0) || 0) * 1000);
      const endMs = Number.isFinite(cue?.endMs) ? Math.round(cue.endMs) : Math.round((Number(cue?.endSec ?? cue?.endTime ?? startMs / 1000) || 0) * 1000);
      const text = wdKvttStripCueText(cue?.text ?? '');
      return { startMs: Math.max(0, startMs), endMs: Math.max(startMs, endMs), text };
    })
    .filter(cue => cue.text)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.text.localeCompare(b.text));

  // Step 1: Rolling-caption reverse dedup + exact dedup
  const deduped = [];
  for (const cue of list) {
    const prev = deduped.at(-1);
    if (!prev) { deduped.push({ ...cue }); continue; }
    if (cue.text === prev.text) {
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      continue;
    }
    if (cue.text.startsWith(prev.text) && cue.startMs - prev.endMs <= 2000) {
      prev.text = cue.text;
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      continue;
    }
    if (prev.text.endsWith(cue.text) && cue.startMs <= prev.endMs + 300) continue;
    deduped.push({ ...cue });
  }

  // Step 2: Merge adjacent broken-sentence cues (preserving original cue boundaries for zero-ellipsis extraction)
  const merged = [];
  for (const cue of deduped) {
    const subCue = {
      startMs: cue.startMs,
      endMs: cue.endMs,
      startSec: Math.floor(cue.startMs / 1000),
      timestamp: formatTimestamp(cue.startMs / 1000),
      text: cue.text,
    };
    const prev = merged.at(-1);
    if (prev && (cue.startMs - prev.endMs) <= mergeGapMs && !/[。！？!?；;]$/u.test(prev.text) && (prev.text.length + cue.text.length) <= 180) {
      const joiner = /[A-Za-z0-9]$/u.test(prev.text) && /^[A-Za-z0-9]/u.test(cue.text) ? ' ' : '';
      prev.text = `${prev.text}${joiner}${cue.text}`;
      prev.endMs = Math.max(prev.endMs, cue.endMs);
      prev.subCues.push(subCue);
    } else {
      merged.push({ ...cue, subCues: [subCue] });
    }
  }

  // Step 3: Paragraph segmentation
  const segments = [];
  let bucket = null;
  const flush = () => {
    if (!bucket) return;
    const text = bucket.texts.join(' ').replace(/\s+/gu, ' ').trim();
    if (text) {
      const index = segments.length + 1;
      const segId = `S${String(index).padStart(2, '0')}`;
      const startSec = Math.floor(bucket.startMs / 1000);
      const endSec = Math.max(startSec, Math.ceil(bucket.endMs / 1000));
      segments.push({
        index,
        segId,
        displayId: `[${segId}]`,
        sectionId,
        refKey: `${sectionId}#${segId}`,
        startMs: bucket.startMs,
        endMs: bucket.endMs,
        startSec,
        endSec,
        timestamp: formatTimestamp(bucket.startMs / 1000),
        endTimestamp: formatTimestamp(endSec),
        text,
        utterances: bucket.utterances,
        mergedItems: bucket.mergedItems,
      });
    }
    bucket = null;
  };

  for (const item of merged) {
    const mergedEntry = {
      startMs: item.startMs,
      endMs: item.endMs,
      startSec: Math.floor(item.startMs / 1000),
      timestamp: formatTimestamp(item.startMs / 1000),
      text: item.text,
      subCues: item.subCues || [],
    };
    if (!bucket) {
      bucket = {
        startMs: item.startMs,
        endMs: item.endMs,
        texts: [item.text],
        chars: item.text.length,
        utterances: [...(item.subCues || [])],
        mergedItems: [mergedEntry],
      };
      continue;
    }
    const gap = item.startMs - bucket.endMs;
    const shouldBreak = bucket.chars >= maxSegmentChars
      || (bucket.chars >= minSegmentChars && gap > pauseBreakMs)
      || (bucket.chars >= minSegmentChars && wdKvttDiscoursePattern.test(item.text));
    if (shouldBreak) {
      flush();
      bucket = {
        startMs: item.startMs,
        endMs: item.endMs,
        texts: [item.text],
        chars: item.text.length,
        utterances: [...(item.subCues || [])],
        mergedItems: [mergedEntry],
      };
    } else {
      bucket.texts.push(item.text);
      bucket.endMs = Math.max(bucket.endMs, item.endMs);
      bucket.chars += item.text.length;
      bucket.utterances.push(...(item.subCues || []));
      bucket.mergedItems.push(mergedEntry);
    }
  }
  flush();
  return { cues: deduped, merged, segments };
}

const wdKvttDomainSuffixPattern = /(?:网络|集群|平台|架构|机制|防护|备案|注入|投毒|标识|安全|调度|路由|模型|算法|协议|治理|系统|能力|技术|标准|认证|隔离|熔断|降级|策略|体系|互联|智算|算力|计算|服务|演进|转型|合规|监管|风险|隐患|危险源|智能体|大模型|数据中心)$/u;
const wdKvttEdgeFuncCharPattern = /^(?:的|了|着|在|是|有|和|与|或|对|把|将|被|从|向|给|为|这|那|个|些|很|也|都|就|还|要|会|能|可|不|没|已|再|更|最|所|因|但|而|并|及|等|上|下|中|里|内|外|前|后|时|年|月|日|第)|(?:的|了|着|在|是|有|和|与|或|对|把|将|被|从|向|给|为|这|那|个|些|很|也|都|就|还|要|会|能|可|不|没|已|再|更|最|所|因|但|而|并|及|等|里|第)$/u;
const wdKvttSubstantiveVerbPattern = /(?:核心|关键|本质|要求|目标|方向|趋势|挑战|风险|危害|解决|实现|构建|推进|推动|提出|形成|升级|演进|转型|保障|防范|落地|重点|需要|必须|应该|能够|通过|围绕|面向|提升|降低|支撑|驱动|带来|导致|意味着|表明|证明|发布|纳入|开展|实施|原则|策略|架构|机制|方案|流程|标准|规范|体系|平台|区别|步骤|覆盖|协同)/gu;
const wdKvttDefCuePattern = /(?:是指|指的是|即|也就是|平台|模型|技术|机制|方法|架构|系统|能力|方案|用来|用于|负责|核心|旨在|推动|支持|防范|解决|发布|标志着|证明|演进|攻关|认证|治理|分析|监管|专项)/u;

function wdKvttNormalizeCompare(text) {
  return String(text ?? '').toLowerCase().replace(/[\s，,。！？!?；;：:、（）()《》「」“”"'\[\]【】·\-—]+/gu, '');
}

function wdKvttBigrams(text) {
  const norm = wdKvttNormalizeCompare(text);
  const set = new Set();
  if (norm.length < 2) {
    if (norm) set.add(norm);
    return set;
  }
  for (let i = 0; i < norm.length - 1; i += 1) set.add(norm.slice(i, i + 2));
  return set;
}

function computeTextSimilarity(a, b) {
  const na = wdKvttNormalizeCompare(a);
  const nb = wdKvttNormalizeCompare(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 8 && longer.includes(shorter)) {
    return Math.max(0.85, shorter.length / longer.length);
  }
  const sa = wdKvttBigrams(na);
  const sb = wdKvttBigrams(nb);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

function wdKvttIsTitleDuplicate(sentence, title) {
  const cleanTitle = String(title ?? '').replace(/^第\s*\d+\s*[章节讲课]\s*/u, '').trim();
  if (!cleanTitle || cleanTitle.length < 4) return false;
  const ns = wdKvttNormalizeCompare(sentence);
  const nt = wdKvttNormalizeCompare(cleanTitle);
  if (!ns || !nt) return false;
  if (ns === nt) return true;
  if (ns.includes(nt) && ns.length - nt.length <= 5) return true;
  if (nt.includes(ns) && nt.length - ns.length <= 5) return true;
  return computeTextSimilarity(ns, nt) >= 0.78;
}

function wdKvttMatchTechnicalTerms(text) {
  const str = String(text ?? '');
  const found = [];
  const techMatches = str.match(/\b(?:[A-Z][A-Z0-9.+-]{1,11}|IPv[46]|5G|6G|Token|LLM|RAG|Agent|GPU|RDMA|Docker|Kubernetes|DevOps|Redis|Kafka|MySQL|Linux)\b/gu) || [];
  for (const m of techMatches) {
    if (!wdKvttStopAcronyms.has(m.toUpperCase())) found.push(m);
  }
  for (const m of str.matchAll(/[《「“]([\u4e00-\u9fa5A-Za-z0-9·]{2,12})[》」”]/gu)) {
    const quoted = m[1].trim();
    if (quoted && !wdKvttStopWords.has(quoted)) found.push(quoted);
  }
  return found;
}

const wdKvttWordSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-CN', { granularity: 'word' })
  : null;

function wdKvttSegmentChineseWords(text) {
  const str = String(text ?? '');
  if (!str) return [];
  if (wdKvttWordSegmenter) {
    const out = [];
    for (const seg of wdKvttWordSegmenter.segment(str)) {
      if (seg.isWordLike) out.push(seg.segment);
      else out.push('\u0000'); // preserve punctuation/space boundary so bigrams never cross clauses
    }
    return out;
  }
  // Fallback boundary split if Intl.Segmenter is unavailable
  return str
    .split(/[^\u4e00-\u9fa5A-Za-z0-9.+-]+|[的了着在是有和与或对把将被从向给为这那个些等中里及并而但因所以于之上]+/u)
    .filter(Boolean);
}

function wdKvttExtractKeywords(texts, limit = 6) {
  const list = (Array.isArray(texts) ? texts : [String(texts ?? '')])
    .map(t => String(t ?? '').trim())
    .filter(Boolean);
  if (!list.length) return [];
  const techCounts = new Map();
  const cjkCounts = new Map();
  const isCleanWord = w => Boolean(
    w
    && /^[\u4e00-\u9fa5]{2,6}$/u.test(w)
    && !wdKvttStopWords.has(w)
    && !wdKvttEdgeFuncCharPattern.test(w)
    && !/^[一二三四五六七八九十百千万亿]+$/u.test(w),
  );

  for (const t of list) {
    for (const term of wdKvttMatchTechnicalTerms(t)) {
      techCounts.set(term, (techCounts.get(term) || 0) + 1);
    }
    const tokens = wdKvttSegmentChineseWords(t);
    for (let i = 0; i < tokens.length; i += 1) {
      const w1 = tokens[i];
      if (w1 === '\u0000') continue;
      if (isCleanWord(w1)) {
        cjkCounts.set(w1, (cjkCounts.get(w1) || 0) + 1);
      }
      // Form natural 2-word Chinese compounds ONLY on genuine word boundaries (e.g. 算力 + 网络 -> 算力网络, 训练 + 集群 -> 训练集群)
      const w2 = tokens[i + 1];
      if (w2 && w2 !== '\u0000' && /^[\u4e00-\u9fa5]{1,3}$/u.test(w1) && /^[\u4e00-\u9fa5]{1,3}$/u.test(w2)) {
        const compound = `${w1}${w2}`;
        if (compound.length >= 3 && compound.length <= 6 && !wdKvttStopWords.has(w1) && !wdKvttStopWords.has(w2) && isCleanWord(compound)) {
          const hasDomainEnding = wdKvttDomainSuffixPattern.test(compound);
          if (hasDomainEnding || (w1.length >= 2 && w2.length >= 2)) {
            cjkCounts.set(compound, (cjkCounts.get(compound) || 0) + 1);
          }
        }
      }
    }
  }
  const scored = [];
  for (const [term, count] of techCounts.entries()) {
    const bonus = term.length >= 3 ? 2.6 : (count >= 2 ? 2.0 : 1.2);
    scored.push({ term, count, score: count * bonus + (count >= 2 ? 2.4 : 0.9), kind: 'tech' });
  }
  for (const [term, count] of cjkCounts.entries()) {
    const domainBonus = wdKvttDomainSuffixPattern.test(term);
    if (count < 2 && !(domainBonus && term.length >= 4)) continue;
    const lenWeight = term.length >= 4 ? 2.4 : term.length === 3 ? 1.7 : 1.1;
    scored.push({ term, count, score: count * lenWeight * (domainBonus ? 1.6 : 1.0), kind: 'cjk' });
  }
  scored.sort((a, b) => b.score - a.score || b.term.length - a.term.length);
  const picked = [];
  for (const item of scored) {
    const lower = item.term.toLowerCase();
    if (picked.some(p => {
      const pl = p.toLowerCase();
      if (pl.includes(lower) || (lower.includes(pl) && p.length >= 3)) return true;
      // Avoid sliding half-overlap like "模型服务" + "服务平台"
      if (p.length >= 4 && item.term.length >= 4 && (p.slice(-2) === item.term.slice(0, 2) || item.term.slice(-2) === p.slice(0, 2))) return true;
      return false;
    })) continue;
    picked.push(item.term);
    if (picked.length >= limit) break;
  }
  return picked;
}

function wdKvttExtractCandidatesFromSegment(seg, options = {}) {
  const maxLen = Number.isFinite(options.maxLen) ? options.maxLen : 48;
  const minLen = Number.isFinite(options.minLen) ? options.minLen : 6;
  const results = [];
  const pushClean = (rawPiece, startSec, timestamp, segIndex) => {
    const rawStr = String(rawPiece ?? '').trim();
    if (!rawStr) return;
    // Direct sentence try
    const direct = sanitizeCompleteText(rawStr, {
      maxLen,
      minLen,
      stripPrefixes: true,
      stripSpoken: true,
      ensurePeriod: true,
      strictFragment: true,
      allowClauseSplit: false,
    });
    if (direct) {
      results.push({ text: direct, raw: rawStr, seconds: startSec, timestamp, segIndex });
      return;
    }
    // If single unpunctuated run is > maxLen, try splitting into semantic clauses and grouping complete ones
    if (rawStr.length > maxLen) {
      const clauses = wdKvttSplitClauseUnits(rawStr);
      if (clauses.length > 1) {
        let acc = '';
        for (const clause of clauses) {
          const cleanClause = wdKvttStripSpokenFillers(clause);
          if (!cleanClause) continue;
          const next = acc ? `${acc}，${cleanClause}` : cleanClause;
          if (next.length <= maxLen - 1) {
            acc = next;
          } else {
            if (acc) {
              const finalized = sanitizeCompleteText(acc, { maxLen, minLen, stripPrefixes: true, stripSpoken: true, ensurePeriod: true, strictFragment: true });
              if (finalized) results.push({ text: finalized, raw: acc, seconds: startSec, timestamp, segIndex });
            }
            acc = cleanClause.length <= maxLen - 1 ? cleanClause : '';
          }
        }
        if (acc) {
          const finalized = sanitizeCompleteText(acc, { maxLen, minLen, stripPrefixes: true, stripSpoken: true, ensurePeriod: true, strictFragment: true });
          if (finalized) results.push({ text: finalized, raw: acc, seconds: startSec, timestamp, segIndex });
        }
      }
    }
  };

  const mergedItems = Array.isArray(seg?.mergedItems) && seg.mergedItems.length ? seg.mergedItems : null;
  if (mergedItems) {
    for (const item of mergedItems) {
      const sentUnits = wdKvttSplitSentenceUnits(item.text);
      const hasPunctBreak = sentUnits.length > 1 || /[。！？!?；;]$/u.test(item.text);
      if (hasPunctBreak) {
        for (const unit of sentUnits) pushClean(unit, item.startSec, item.timestamp, seg.index);
      } else if (item.text.length <= maxLen) {
        pushClean(item.text, item.startSec, item.timestamp, seg.index);
      } else if (Array.isArray(item.subCues) && item.subCues.length > 1) {
        // Unpunctuated long merged block: fall back to original ASR cue units & group up to maxLen without hard slicing
        let groupText = '';
        let groupSec = item.subCues[0].startSec;
        let groupTs = item.subCues[0].timestamp;
        for (const sub of item.subCues) {
          const subClean = String(sub.text || '').trim();
          if (!subClean) continue;
          const joiner = groupText && /[A-Za-z0-9]$/u.test(groupText) && /^[A-Za-z0-9]/u.test(subClean) ? ' ' : (groupText ? '，' : '');
          const candidate = groupText ? `${groupText}${joiner}${subClean}` : subClean;
          if (groupText && candidate.length > maxLen - 1) {
            pushClean(groupText, groupSec, groupTs, seg.index);
            groupText = subClean;
            groupSec = sub.startSec;
            groupTs = sub.timestamp;
          } else {
            if (!groupText) { groupSec = sub.startSec; groupTs = sub.timestamp; }
            groupText = candidate;
          }
        }
        if (groupText) pushClean(groupText, groupSec, groupTs, seg.index);
      } else {
        pushClean(item.text, item.startSec, item.timestamp, seg.index);
      }
    }
    return results;
  }

  // Fallback when caller supplied manual `segments` without `mergedItems`
  const units = wdKvttSplitSentenceUnits(seg?.text || '');
  for (const unit of units) {
    pushClean(unit, seg.startSec ?? 0, seg.timestamp || formatTimestamp(seg.startSec ?? 0), seg.index || 1);
  }
  return results;
}

function wdKvttScoreCandidate(cand, keywords, sectionTitle) {
  let score = 1;
  const text = cand.text;
  const raw = cand.raw || text;
  let kwHits = 0;
  for (const kw of keywords) {
    if (text.toLowerCase().includes(kw.toLowerCase())) kwHits += 1;
  }
  score += Math.min(10, kwHits * 2.5);
  const verbMatches = text.match(wdKvttSubstantiveVerbPattern) || [];
  score += Math.min(6, verbMatches.length * 1.6);
  const coreLen = text.replace(/[。！？!?]+$/u, '').length;
  if (coreLen >= 12 && coreLen <= 40) score += 2.2;
  else if (coreLen >= 8 && coreLen <= 46) score += 1.0;
  if (wdKvttIntroMetaPattern.test(raw) || wdKvttIntroMetaPattern.test(text)) score -= 9;
  if (wdKvttIsTitleDuplicate(text, sectionTitle)) score -= 6;
  return score;
}

function wdKvttPickBestTopicName(slice, sliceCandidates, groupIdx) {
  const sourceTexts = sliceCandidates.length ? sliceCandidates.map(c => c.text) : slice.map(s => s.text);
  const sliceKws = wdKvttExtractKeywords(sourceTexts, 2);
  if (sliceKws.length >= 2) {
    const joined = `${sliceKws[0]}与${sliceKws[1]}`;
    if (joined.length <= 16) return joined;
  }
  if (sliceKws.length >= 1 && sliceKws[0].length >= 2 && sliceKws[0].length <= 16) {
    return sliceKws[0];
  }
  for (const cand of sliceCandidates) {
    const clauses = wdKvttSplitClauseUnits(cand.text.replace(/[。！？!?]+$/u, ''));
    const fit = clauses.find(c => c.length >= 4 && c.length <= 16 && !isIncompleteFragment(c, { strict: true }));
    if (fit) return fit;
  }
  return `核心主题 ${groupIdx}`;
}

function wdKvttTermRegex(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const ascii = /^[A-Za-z0-9.+-]+$/u.test(term);
  const flags = term.length <= 3 && /^[A-Z0-9]+$/u.test(term) ? 'u' : 'iu';
  return ascii ? new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, flags) : new RegExp(escaped, flags);
}

function wdKvttExtractZeroAiGlossary(segments, sectionTitle = '', keyPoints = [], limit = 6) {
  const segList = Array.isArray(segments) ? segments : [];
  if (!segList.length) return [];

  // Extract a slightly wider pool of complete sentences (up to 64 chars) for clear contextual term explanations
  const sentencePool = [];
  for (const seg of segList) {
    const cands = wdKvttExtractCandidatesFromSegment(seg, { maxLen: 64, minLen: 8 });
    sentencePool.push(...cands);
  }
  if (!sentencePool.length) return [];

  // Gather candidate terms: technical acronyms/English terms, quoted concepts, and top domain Chinese nouns
  const termFreq = new Map();
  const addTerm = (term, kind) => {
    const clean = String(term || '').trim();
    if (!clean || clean.length < 2 || wdKvttStopWords.has(clean)) return;
    if (wdKvttIsTitleDuplicate(clean, sectionTitle)) return;
    const prev = termFreq.get(clean);
    if (prev) prev.count += 1;
    else termFreq.set(clean, { term: clean, count: 1, kind });
  };

  for (const seg of sentencePool) {
    for (const t of wdKvttMatchTechnicalTerms(seg.text || '')) addTerm(t, 'tech');
  }
  if (termFreq.size < 4) {
    const domainKws = wdKvttExtractKeywords(sentencePool.map(s => s.text || ''), 6);
    for (const kw of domainKws) {
      if (kw.length >= 3 && !termFreq.has(kw) && wdKvttDomainSuffixPattern.test(kw)) {
        addTerm(kw, 'domain');
      }
    }
  }

  const kpBlob = `${sectionTitle} ${(keyPoints || []).map(k => k.text).join(' ')}`.toLowerCase();
  const entries = [];
  for (const meta of termFreq.values()) {
    const re = wdKvttTermRegex(meta.term);
    const matching = sentencePool.filter(s => re.test(s.text));
    if (!matching.length) continue;

    // Pick the single most explanatory complete sentence containing this exact term
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < matching.length; i += 1) {
      const s = matching[i];
      let sc = 0;
      if (wdKvttDefCuePattern.test(s.text)) sc += 5;
      if (s.text.length >= 14 && s.text.length <= 54) sc += 3;
      if (wdKvttIntroMetaPattern.test(s.raw || s.text)) sc -= 8;
      if (i === 0) sc += 0.5;
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    if (!best) continue;

    // If best sentence is very short (< 14 chars), try pairing with adjacent complete sentence in the same segment
    let definition = best.text;
    if (definition.length < 14) {
      const idxInPool = sentencePool.indexOf(best);
      const next = sentencePool[idxInPool + 1];
      if (next && next.segIndex === best.segIndex && (definition.length + next.text.length) <= 64) {
        definition = `${definition}${next.text}`;
      }
    }
    definition = sanitizeCompleteText(definition, {
      maxLen: 64,
      minLen: 8,
      stripPrefixes: true,
      stripSpoken: true,
      ensurePeriod: true,
      strictFragment: true,
    });
    if (!definition) continue;

    const isCore = meta.count >= 2 || kpBlob.includes(meta.term.toLowerCase());
    const bestSeg = segList.find(s => s.index === best.segIndex) || null;
    entries.push({
      term: meta.term,
      definition,
      isCore,
      importance: isCore ? '本课重点' : '拓展提及',
      seconds: best.seconds,
      timestamp: best.timestamp,
      ...(bestSeg?.segId ? { segId: bestSeg.segId, refKey: bestSeg.refKey, citationStatus: 'verified' } : {}),
      _score: (isCore ? 10 : 0) + meta.count * 2 + (meta.kind === 'tech' ? 1.5 : 0),
    });
  }

  entries.sort((a, b) => b._score - a._score || (a.seconds ?? 0) - (b.seconds ?? 0));
  return entries.slice(0, limit).map(({ _score, ...rest }) => rest);
}

function estimateTextTokens(text) {
  const str = String(text ?? '');
  if (!str) return 0;
  const cjk = (str.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/gu) || []).length;
  const other = str.length - cjk;
  return Math.ceil(cjk * 0.75 + other * 0.3);
}

function estimateKnowledgeTokens(courseData, scope = 'course', options = {}) {
  const maxSectionChars = Number.isFinite(options.maxSectionChars) ? options.maxSectionChars : 12000;
  const allSections = Array.isArray(courseData?.sections) ? courseData.sections : [];
  const targetSections = scope === 'section'
    ? (courseData?.activeSectionId
      ? allSections.filter(sec => sec.sectionId === courseData.activeSectionId).slice(0, 1)
      : allSections.filter(sec => sec.active).slice(0, 1))
    : allSections;
  const chosen = targetSections.length ? targetSections : allSections.slice(0, 1);
  let totalChars = 0;
  let contentInputTokens = 0;
  let chunksCount = 0;
  let captionedSections = 0;
  for (const sec of chosen) {
    const segs = Array.isArray(sec.segments) && sec.segments.length
      ? sec.segments
      : cleanAndSegmentCues(sec.cues || []).segments;
    const text = segs.map(s => `[${s.timestamp}] ${s.text}`).join('\n');
    const chars = text.length;
    totalChars += chars;
    if (chars > 0) {
      captionedSections += 1;
      const chunks = Math.max(1, Math.ceil(chars / maxSectionChars));
      chunksCount += chunks;
      contentInputTokens += estimateTextTokens(text) + chunks * 360;
      if (chunks > 1) {
        chunksCount += 1; // section-level aggregation pass
        contentInputTokens += chunks * 240 + 260;
      }
    }
  }
  const aggregateInput = captionedSections > 1 ? Math.min(4000, captionedSections * 260 + 300) : 0;
  const inputTokens = contentInputTokens + aggregateInput;
  const outputTokens = chunksCount * 650 + (captionedSections > 1 ? 650 : 0);
  const totalTokens = inputTokens + outputTokens;
  const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const summaryText = captionedSections === 0
    ? `未检测到字幕正文（${chosen.length} 节），仅使用零 AI 占位导览（0 tokens）`
    : `预计分析 ${captionedSections}/${chosen.length} 节（${chunksCount + (captionedSections > 1 ? 1 : 0)} 次请求），约 ${totalChars.toLocaleString('en-US')} 字，粗略估算 ~${fmt(totalTokens)} tokens（输入 ~${fmt(inputTokens)} + 输出 ~${fmt(outputTokens)}）`;
  return {
    scope,
    sectionCount: chosen.length,
    captionedSections,
    chunksCount,
    totalChars,
    inputTokens,
    outputTokens,
    totalTokens,
    summaryText,
  };
}

function buildSeekHref(sectionId, seconds) {
  const secNum = Math.max(0, Math.floor(Number(seconds) || 0));
  const safeId = encodeURIComponent(String(sectionId || 'current'));
  return `#wd-seek-${safeId}-${secNum}`;
}

function parseSeekHref(href) {
  const match = /^#wd-seek-([^#]+)-(\d+)$/u.exec(String(href ?? '').trim());
  if (!match) return null;
  try {
    return { sectionId: decodeURIComponent(match[1]), seconds: Number(match[2]) };
  } catch {
    return { sectionId: match[1], seconds: Number(match[2]) };
  }
}

function buildKnowledgeMarkdown(tree, options = {}) {
  const includeExtras = options.includeExtras === true;
  const courseTitle = escapeMarkdownText(tree?.courseTitle || '未命名课程');
  const lines = [`# ${courseTitle}`];
  if (includeExtras && tree?.overview) {
    lines.push('', `> 一句话概览：${escapeMarkdownText(tree.overview)}`);
  }
  if (includeExtras && tree?.skippedSummary) {
    lines.push('', `> 无字幕跳过提示：${escapeMarkdownText(tree.skippedSummary)}`);
  }
  if (includeExtras && Array.isArray(tree?.courseKeyPoints) && tree.courseKeyPoints.length) {
    lines.push('', '## 全课核心要点');
    for (const kp of tree.courseKeyPoints) {
      const label = escapeMarkdownText(kp.text || '');
      if (!label) continue;
      if (Number.isFinite(kp.seconds) && kp.seconds >= 0) {
        lines.push(`- ${label} [${formatTimestamp(kp.seconds)}](${buildSeekHref(kp.sectionId || 'current', kp.seconds)})`);
      } else {
        lines.push(`- ${label}`);
      }
    }
  }
  const sections = Array.isArray(tree?.sections) ? tree.sections : [];
  if (!sections.length) {
    lines.push('', '## 暂无课节数据', '- 未检测到课节或字幕内容');
    return lines.join('\n');
  }
  for (const sec of sections) {
    const chapterPrefix = sec.chapterTitle ? `${escapeMarkdownText(sec.chapterTitle)} · ` : '';
    const secTitle = escapeMarkdownText(sec.title || `课节 ${sec.sectionIndex || ''}`.trim());
    const tag = sec.mode === 'ai' ? '' : sec.mode === 'highlight' ? '（平台看点）' : sec.mode === 'placeholder' ? '（占位）' : '';
    lines.push('', `## ${chapterPrefix}${secTitle}${tag}`);
    if (includeExtras && sec.summary) {
      lines.push('', `> 概览：${escapeMarkdownText(sec.summary)}`);
    }
    if (includeExtras && Array.isArray(sec.keyPoints) && sec.keyPoints.length) {
      lines.push('', '### 核心要点');
      for (const kp of sec.keyPoints) {
        const label = escapeMarkdownText(kp.text || '');
        if (!label) continue;
        if (Number.isFinite(kp.seconds) && kp.seconds >= 0) {
          lines.push(`- ${label} [${formatTimestamp(kp.seconds)}](${buildSeekHref(sec.sectionId || 'current', kp.seconds)})`);
        } else {
          lines.push(`- ${label}`);
        }
      }
    }
    const topics = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
    if (!topics.length) {
      lines.push('- 暂无字幕内容（课节标题占位）');
      continue;
    }
    for (const topic of topics) {
      const topicName = escapeMarkdownText(topic.name || '核心要点');
      lines.push(`### ${topicName}`);
      const points = Array.isArray(topic.points) ? topic.points : [];
      if (!points.length) {
        lines.push('- 暂无细分知识点');
        continue;
      }
      for (const pt of points) {
        const label = escapeMarkdownText(pt.text || '');
        if (!label) continue;
        if (Number.isFinite(pt.seconds) && pt.seconds >= 0) {
          const ts = formatTimestamp(pt.seconds);
          const href = buildSeekHref(sec.sectionId || 'current', pt.seconds);
          lines.push(`- ${label} [${ts}](${href})`);
        } else {
          lines.push(`- ${label}`);
        }
      }
    }
    if (includeExtras && Array.isArray(sec.quiz) && sec.quiz.length) {
      lines.push('', '### 自测问答');
      sec.quiz.forEach((q, idx) => {
        const tsPart = Number.isFinite(q.seconds) && q.seconds >= 0
          ? ` [${formatTimestamp(q.seconds)}](${buildSeekHref(sec.sectionId || 'current', q.seconds)})`
          : '';
        lines.push(`- **Q${idx + 1}：${escapeMarkdownText(q.question)}**${tsPart}`);
        if (q.answer) lines.push(`  - 参考答案：${escapeMarkdownText(q.answer)}`);
      });
    }
    if (includeExtras && Array.isArray(sec.glossary) && sec.glossary.length) {
      lines.push('', '### 术语卡片');
      for (const g of sec.glossary) {
        const tsPart = Number.isFinite(g.seconds) && g.seconds >= 0
          ? ` [${formatTimestamp(g.seconds)}](${buildSeekHref(sec.sectionId || 'current', g.seconds)})`
          : '';
        const impPart = g.importance ? `（${escapeMarkdownText(g.importance)}）` : '';
        lines.push(`- **${escapeMarkdownText(g.term)}**${impPart}：${escapeMarkdownText(g.definition)}${tsPart}`);
      }
    }
  }
  return lines.join('\n');
}

function buildZeroAiSectionTree(section, highlights = []) {
  const secId = String(section?.sectionId || 'current').trim() || 'current';
  const cues = Array.isArray(section?.cues) ? section.cues : [];
  const rawSegmented = Array.isArray(section?.segments) && section.segments.length
    ? section.segments
    : cleanAndSegmentCues(cues, { sectionId: secId }).segments;
  const segmented = rawSegmented.map((seg, idx) => {
    const index = idx + 1;
    const segId = seg.segId || `S${String(index).padStart(2, '0')}`;
    const startMs = Number.isFinite(seg.startMs) ? Math.round(seg.startMs) : Math.round((Number(seg.startSec) || 0) * 1000);
    const endMs = Number.isFinite(seg.endMs) ? Math.round(seg.endMs) : Math.max(startMs, Math.round((Number(seg.endSec ?? seg.startSec) || 0) * 1000));
    const startSec = Number.isFinite(seg.startSec) ? Math.floor(seg.startSec) : Math.floor(startMs / 1000);
    const endSec = Number.isFinite(seg.endSec) ? Math.max(startSec, Math.ceil(seg.endSec)) : Math.max(startSec, Math.ceil(endMs / 1000));
    return {
      ...seg,
      index,
      segId,
      displayId: `[${segId}]`,
      sectionId: secId,
      refKey: `${secId}#${segId}`,
      startMs,
      endMs,
      startSec,
      endSec,
      timestamp: seg.timestamp || formatTimestamp(startSec),
      endTimestamp: seg.endTimestamp || formatTimestamp(endSec),
    };
  });
  const segByIndex = new Map(segmented.map(s => [s.index, s]));
  const hasSubtitle = typeof section?.hasSubtitle === 'boolean' ? section.hasSubtitle : segmented.length > 0;
  const subtitleStatus = section?.subtitleStatus || (segmented.length > 0 ? 'ok' : 'no-subtitle');
  const subtitleReason = section?.subtitleReason || (segmented.length > 0 ? '' : '本课无字幕：该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。');

  const sectionTitle = section?.title || `课节 ${section?.sectionIndex || 1}`;
  const segCandidateMap = new Map();
  const rawCandidates = [];
  for (const seg of segmented) {
    const cands = wdKvttExtractCandidatesFromSegment(seg, { maxLen: 48, minLen: 6 });
    segCandidateMap.set(seg.index, cands);
    rawCandidates.push(...cands);
  }
  const keywordTexts = rawCandidates.length ? rawCandidates.map(c => c.text) : segmented.map(s => s.text || '');
  const sectionKeywords = wdKvttExtractKeywords(keywordTexts, 6);
  const allCandidates = [];
  for (const seg of segmented) {
    const scored = (segCandidateMap.get(seg.index) || [])
      .map(c => ({ ...c, segId: seg.segId, refKey: seg.refKey, score: wdKvttScoreCandidate(c, sectionKeywords, sectionTitle) }));
    segCandidateMap.set(seg.index, scored);
    allCandidates.push(...scored);
  }

  const timeline = segmented.map(seg => {
    const segCands = segCandidateMap.get(seg.index) || [];
    const bestSegCand = [...segCands].sort((a, b) => b.score - a.score)[0];
    return {
      index: seg.index,
      segId: seg.segId,
      displayId: seg.displayId,
      sectionId: secId,
      refKey: seg.refKey,
      startMs: seg.startMs,
      endMs: seg.endMs,
      startSec: seg.startSec,
      endSec: seg.endSec,
      timestamp: seg.timestamp,
      endTimestamp: seg.endTimestamp,
      headline: bestSegCand?.text || '',
      text: seg.text,
    };
  });
  const maxEndSec = segmented.reduce((mx, s) => Math.max(mx, s.endSec || s.startSec || 0), 0);

  const base = {
    sectionId: section?.sectionId || null,
    sectionIndex: section?.sectionIndex || 1,
    chapterTitle: section?.chapterTitle || '',
    title: sectionTitle,
    mode: 'zero-ai',
    source: section?.source || 'unavailable',
    hasSubtitle,
    subtitleStatus,
    subtitleReason,
    subtitleLogs: Array.isArray(section?.subtitleLogs) ? section.subtitleLogs : [],
    durationSec: Number.isFinite(section?.durationSec) && section.durationSec > 0 ? Math.max(section.durationSec, maxEndSec) : maxEndSec,
    summary: '',
    keyPoints: [],
    outline: [],
    topics: [],
    quiz: [],
    glossary: [],
    timeline,
  };

  if (segmented.length) {
    // 1. Select deduplicated, complete-sentence keyPoints (3~6 items, never truncated, never copying title)
    const substantivePool = allCandidates.filter(c => !wdKvttIntroMetaPattern.test(c.raw || c.text) && !wdKvttIsTitleDuplicate(c.text, sectionTitle));
    const fallbackPool = allCandidates.filter(c => !wdKvttIsTitleDuplicate(c.text, sectionTitle));
    const selectionPool = substantivePool.length ? substantivePool : (fallbackPool.length ? fallbackPool : allCandidates);

    const pickedKeyPoints = [];
    const tryAddKp = cand => {
      if (!cand?.text) return false;
      if (pickedKeyPoints.some(p => computeTextSimilarity(p.text, cand.text) >= 0.62)) return false;
      pickedKeyPoints.push(cand);
      return true;
    };

    // Spread across timeline buckets first so points cover the whole section rather than only the opening
    const maxGroups = Math.min(4, Math.max(1, Math.ceil(segmented.length / 2)));
    const groupSize = Math.ceil(segmented.length / maxGroups);
    for (let i = 0; i < segmented.length; i += groupSize) {
      const sliceSegIndices = new Set(segmented.slice(i, i + groupSize).map(s => s.index));
      const inSlice = selectionPool
        .filter(c => sliceSegIndices.has(c.segIndex))
        .sort((a, b) => b.score - a.score || a.seconds - b.seconds);
      if (inSlice[0]) tryAddKp(inSlice[0]);
    }
    // Fill up to 5 keyPoints (capped at 6) with highest-scored non-duplicate complete sentences
    const rankedAll = [...selectionPool].sort((a, b) => b.score - a.score || a.seconds - b.seconds);
    for (const cand of rankedAll) {
      if (pickedKeyPoints.length >= 5) break;
      tryAddKp(cand);
    }
    pickedKeyPoints.sort((a, b) => a.seconds - b.seconds);
    base.keyPoints = pickedKeyPoints.slice(0, 6).map(kp => {
      const refSeg = segByIndex.get(kp.segIndex) || null;
      return {
        text: kp.text,
        seconds: kp.seconds,
        timestamp: kp.timestamp,
        ...(refSeg ? { segId: refSeg.segId, refKey: refSeg.refKey, citationStatus: 'verified' } : {}),
      };
    });

    // 2. Build substantive complete-sentence summary (no "零 AI 提炼（首段摘要）：" prefix, no "…")
    const summaryPool = [...selectionPool].sort((a, b) => b.score - a.score || a.seconds - b.seconds);
    const chosenSummary = [];
    for (const cand of summaryPool) {
      if (chosenSummary.some(s => computeTextSimilarity(s.text, cand.text) >= 0.55)) continue;
      const totalLen = chosenSummary.reduce((sum, s) => sum + s.text.length, 0) + cand.text.length;
      if (!chosenSummary.length || (chosenSummary.length < 2 && totalLen <= 84)) {
        chosenSummary.push(cand);
      }
      if (chosenSummary.length >= 2) break;
    }
    chosenSummary.sort((a, b) => a.seconds - b.seconds);
    if (chosenSummary.length) {
      base.summary = chosenSummary.map(s => s.text).join('');
    } else if (sectionKeywords.length >= 2) {
      base.summary = `本节围绕${sectionKeywords.slice(0, 4).join('、')}展开讲解，可切换至细读时间轴查看完整字幕。`;
    } else {
      base.summary = '本节已提取字幕时间轴，可切换至细读标签查看完整讲稿。';
    }

    // 3. Build 2~4 compact topic groups with complete topic names and complete point sentences (no "…")
    for (let i = 0; i < segmented.length; i += groupSize) {
      const slice = segmented.slice(i, i + groupSize);
      const startTs = slice[0].timestamp;
      const endTs = formatTimestamp(slice.at(-1).endMs / 1000);
      const sliceCands = [];
      for (const seg of slice) {
        const list = segCandidateMap.get(seg.index) || [];
        sliceCands.push(...list);
      }
      const points = [];
      for (const seg of slice) {
        const segCands = segCandidateMap.get(seg.index) || [];
        const preferred = [...segCands].sort((a, b) => b.score - a.score || a.seconds - b.seconds);
        // Keep up to 2 best distinct complete sentences per segment (preserves accurate seek timestamps)
        let addedForSeg = 0;
        for (const cand of preferred) {
          if (points.some(p => computeTextSimilarity(p.text, cand.text) >= 0.65)) continue;
          points.push({
            text: cand.text,
            seconds: cand.seconds,
            timestamp: cand.timestamp,
            segId: seg.segId,
            refKey: seg.refKey,
            citationStatus: 'verified',
          });
          addedForSeg += 1;
          if (addedForSeg >= 2 || points.length >= 6) break;
        }
      }
      if (!points.length) continue;
      points.sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0));
      const topicLabel = wdKvttPickBestTopicName(slice, sliceCands, base.outline.length + 1);
      base.outline.push({
        name: `${topicLabel}（${startTs}–${endTs}）`,
        points,
      });
    }
    if (!base.outline.length) {
      const fallbackLabel = sectionKeywords.length >= 2
        ? `${sectionKeywords[0]}与${sectionKeywords[1]}`
        : (sectionKeywords[0] || '字幕时间轴导览');
      base.outline.push({
        name: `${fallbackLabel}（${segmented[0].timestamp}）`,
        points: [{ text: base.summary, seconds: segmented[0].startSec, timestamp: segmented[0].timestamp }],
      });
    }
    base.topics = base.outline;

    // 4. Contextual complete-sentence glossary (no "课程提及：" prefix, no "…", tagged with importance)
    base.glossary = wdKvttExtractZeroAiGlossary(segmented, sectionTitle, base.keyPoints, 6);

    // 5. Complete-sentence self-check quiz
    base.quiz = base.outline.slice(0, 3)
      .map(topic => {
        const cleanTopic = topic.name.replace(/（[^）]*）$/u, '').trim();
        const ans = topic.points.slice(0, 2).map(p => p.text).join('');
        if (!cleanTopic || !ans) return null;
        return {
          question: `关于「${cleanTopic}」，本节核心结论是什么？`,
          answer: ans,
          seconds: topic.points[0]?.seconds ?? null,
          timestamp: topic.points[0]?.timestamp || '',
          ...(topic.points[0]?.segId ? { segId: topic.points[0].segId, refKey: topic.points[0].refKey, citationStatus: 'verified' } : {}),
          zeroAi: true,
        };
      })
      .filter(Boolean);
    return base;
  }

  const usableHighlights = section?.active && Array.isArray(highlights) && highlights.length ? highlights : [];
  if (usableHighlights.length) {
    base.mode = 'highlight';
    base.summary = `基于平台 AI 看点整理（共 ${usableHighlights.length} 个主题分段）。`;
    base.keyPoints = usableHighlights.slice(0, 6).map(item => ({
      text: sanitizeCompleteText(item.title || item.desc, { maxLen: 44, allowShort: true, allowClauseSplit: true }) || '看点片段',
      seconds: Number.isFinite(item.seconds) ? item.seconds : null,
      timestamp: Number.isFinite(item.seconds) ? formatTimestamp(item.seconds) : (item.timeText || ''),
    })).filter(kp => kp.text);
    base.outline = [{
      name: '平台 AI 课程看点',
      points: usableHighlights.map(item => ({
        text: sanitizeCompleteText(item.title || item.desc, { maxLen: 44, allowShort: true, allowClauseSplit: true }) || '看点片段',
        seconds: Number.isFinite(item.seconds) ? item.seconds : null,
        timestamp: Number.isFinite(item.seconds) ? formatTimestamp(item.seconds) : (item.timeText || ''),
        excerpt: item.desc || '',
      })),
    }];
    base.topics = base.outline;
    base.timeline = usableHighlights.map((item, idx) => ({
      index: idx + 1,
      startSec: Number.isFinite(item.seconds) ? item.seconds : 0,
      timestamp: Number.isFinite(item.seconds) ? formatTimestamp(item.seconds) : (item.timeText || ''),
      headline: sanitizeCompleteText(item.title || item.desc, { maxLen: 44, allowShort: true, allowClauseSplit: true }) || '看点',
      text: item.desc || item.title || '',
    }));
    return base;
  }

  base.mode = 'placeholder';
  base.summary = `本课无字幕：课节「${base.title}」未检测到可用的 AI 字幕，无法生成时间轴导览、AI 问答与出题。`;
  base.outline = [{
    name: '课节目录占位',
    points: [{ text: `${base.title}（本节无 AI 字幕）`, seconds: null, timestamp: '' }],
  }];
  base.topics = base.outline;
  return base;
}

function buildScopeLabel(scope, sections) {
  const list = Array.isArray(sections) ? sections : [];
  const captioned = list.filter(s => s.hasSubtitle === true || (s.hasSubtitle !== false && s.mode !== 'placeholder' && (s.timeline?.length || s.outline?.length || s.topics?.length))).length;
  if (scope === 'section' || list.length <= 1) {
    const title = list[0]?.title || '当前课节';
    return list[0]?.hasSubtitle === false ? `当前课节（${title} · 无字幕）` : `当前课节（${title}）`;
  }
  return `整门课（共 ${list.length} 节，其中 ${captioned} 节含字幕）`;
}

function buildZeroAiGuide(courseData, options = {}) {
  const scope = options.scope === 'section' ? 'section' : 'course';
  const targetSectionId = options.sectionId || null;
  const allSections = Array.isArray(courseData?.sections) ? courseData.sections : [];
  const selected = scope === 'section'
    ? (targetSectionId
      ? allSections.filter(sec => sec.sectionId === targetSectionId).slice(0, 1)
      : allSections.filter(sec => sec.active || (courseData?.activeSectionId && sec.sectionId === courseData.activeSectionId)).slice(0, 1))
    : allSections;
  const targetSections = selected.length ? selected : allSections.slice(0, 1);
  const highlights = Array.isArray(courseData?.highlights) ? courseData.highlights : [];
  const sections = targetSections.map(sec => buildZeroAiSectionTree(sec, highlights));
  const captioned = sections.filter(s => s.hasSubtitle === true || (s.hasSubtitle !== false && s.mode !== 'placeholder'));
  const skippedNoSubtitleSections = sections
    .filter(s => s.hasSubtitle === false)
    .map(s => ({
      sectionId: s.sectionId,
      title: s.title,
      status: s.subtitleStatus || 'no-subtitle',
      reason: s.subtitleReason || '本课无字幕',
    }));
  const skippedSummary = skippedNoSubtitleSections.length && captioned.length > 0
    ? `以下 ${skippedNoSubtitleSections.length} 个无字幕课节已跳过导览生成：${skippedNoSubtitleSections.map(s => `《${s.title}》`).join('、')}。`
    : '';

  // Extract course-wide high-frequency themes from clean extracted sentences (avoiding raw unbreakable blobs)
  const cleanCourseTexts = captioned.flatMap(s => [
    s.summary || '',
    ...(s.keyPoints || []).map(k => k.text || ''),
    ...(s.outline || []).flatMap(o => (o.points || []).map(p => p.text || '')),
  ]).filter(Boolean);
  const courseThemes = wdKvttExtractKeywords(cleanCourseTexts.length ? cleanCourseTexts : captioned.flatMap(s => (s.timeline || []).map(t => t.text || '').filter(Boolean)), 5);

  // Merge & deduplicate key points across sections (keeping balanced section coverage, 3~6 items, never padded)
  const mergedCourseKps = [];
  const rawPool = [];
  for (const sec of captioned) {
    (sec.keyPoints || []).forEach((kp, idx) => {
      if (!kp?.text) return;
      rawPool.push({
        ...kp,
        sectionId: sec.sectionId || 'current',
        sectionIndex: sec.sectionIndex || 1,
        sectionTitle: sec.title,
        coveredSections: [sec.sectionIndex || 1],
        rankInSec: idx,
        score: wdKvttScoreCandidate({ text: kp.text, raw: kp.text }, courseThemes, sec.title) + (idx === 0 ? 1.5 : 0),
      });
    });
  }
  const dedupedPool = [];
  for (const item of rawPool) {
    const dup = dedupedPool.find(existing => computeTextSimilarity(existing.text, item.text) >= 0.55);
    if (dup) {
      if (!dup.coveredSections.includes(item.sectionIndex)) dup.coveredSections.push(item.sectionIndex);
      if (item.score > dup.score && item.text.length >= dup.text.length - 4) {
        dup.text = item.text;
        dup.score = item.score;
      }
      continue;
    }
    dedupedPool.push({ ...item });
  }
  // Pick at least 1 best unique point per captioned section first, then fill up to 6 by score
  const chosenIds = new Set();
  for (const sec of captioned) {
    const secBest = dedupedPool
      .filter(p => p.sectionId === (sec.sectionId || 'current') && !chosenIds.has(p))
      .sort((a, b) => b.score - a.score)[0];
    if (secBest && mergedCourseKps.length < 6) {
      chosenIds.add(secBest);
      mergedCourseKps.push(secBest);
    }
  }
  for (const cand of [...dedupedPool].sort((a, b) => b.score - a.score)) {
    if (mergedCourseKps.length >= 6) break;
    if (chosenIds.has(cand)) continue;
    chosenIds.add(cand);
    mergedCourseKps.push(cand);
  }
  mergedCourseKps.sort((a, b) => (a.sectionIndex - b.sectionIndex) || ((a.seconds ?? 0) - (b.seconds ?? 0)));
  const courseKeyPoints = mergedCourseKps.map(({ rankInSec, score, ...rest }) => rest);

  // Build substantive course-level overview (NOT a mechanical title list, ZERO ellipsis)
  let overview = '';
  if (sections.length === 1) {
    overview = sections[0].summary || '本节已提取字幕时间轴，可切换至细读标签查看完整讲稿。';
  } else if (captioned.length > 0) {
    const thesisSentences = [];
    for (const sec of captioned) {
      const units = [
        ...wdKvttSplitSentenceUnits(sec.summary || '').filter(u => u && !isIncompleteFragment(u, { strict: false })),
        ...(sec.keyPoints || []).map(k => k.text).filter(Boolean),
      ];
      const lead = units.find(u => !thesisSentences.some(t => computeTextSimilarity(t, u) >= 0.55)) || '';
      if (!lead) continue;
      thesisSentences.push(lead);
      if (thesisSentences.length >= 2) break;
    }
    if (thesisSentences.length >= 2 && (thesisSentences[0].length + thesisSentences[1].length) <= 110) {
      overview = `${thesisSentences[0]}${thesisSentences[1]}`;
    } else if (thesisSentences.length >= 1) {
      const first = thesisSentences[0];
      const themeNotCovered = courseThemes.filter(t => !first.toLowerCase().includes(t.toLowerCase())).slice(0, 3);
      overview = themeNotCovered.length >= 2 && (first.length + themeNotCovered.join('、').length + 10) <= 105
        ? `本课围绕${themeNotCovered.join('、')}等主线展开：${first}`
        : first;
    } else if (courseThemes.length >= 2) {
      overview = `本课围绕${courseThemes.slice(0, 4).join('、')}展开讲解，可在下方展开细读时间轴查看完整字幕。`;
    } else {
      overview = `本课已完成 ${captioned.length} 节字幕整理，可切换至细读标签查看完整时间轴。`;
    }
  } else {
    overview = `本课无字幕：共 ${sections.length} 节，均未检测到可用 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。`;
  }

  const tree = {
    mode: 'zero-ai',
    scope,
    scopeLabel: buildScopeLabel(scope, sections),
    courseId: courseData?.courseId || null,
    activeSectionId: courseData?.activeSectionId || sections[0]?.sectionId || null,
    courseTitle: courseData?.title || '当前课程',
    courseThemes,
    overview,
    courseKeyPoints,
    hasAnySubtitle: captioned.length > 0,
    noSubtitle: captioned.length === 0,
    skippedNoSubtitleSections,
    skippedSummary,
    subtitleDiagnostics: Array.isArray(courseData?.subtitleDiagnostics) ? courseData.subtitleDiagnostics : [],
    generatedAt: new Date().toISOString(),
    fallbackReason: options.fallbackReason || '',
    warnings: Array.isArray(courseData?.warnings) ? [...courseData.warnings] : [],
    sections,
  };
  const markdown = buildKnowledgeMarkdown(tree);
  return { tree, markdown };
}

function wdKvttToArray(list) {
  const out = [];
  if (list && typeof list.length === 'number') {
    for (let i = 0; i < list.length; i += 1) out.push(list[i]);
  }
  return out;
}

function wdKvttIsMetadataJsonCues(cues) {
  const sample = cues.filter(c => String(c?.text || '').trim()).slice(0, 3);
  if (!sample.length) return false;
  return sample.every(c => {
    const s = String(c.text).trim();
    if (!s.startsWith('{')) return false;
    try {
      const obj = JSON.parse(s);
      return Boolean(obj && typeof obj === 'object' && ('uri' in obj || 'timeline' in obj || 'bandwidth' in obj || 'playlist' in obj));
    } catch {
      return false;
    }
  });
}

function selectCaptionTrack(tracks) {
  const list = wdKvttToArray(tracks).filter(Boolean);
  const scored = [];
  for (const track of list) {
    const kind = String(track.kind || '').toLowerCase();
    const label = String(track.label || '');
    if (kind === 'metadata' || kind === 'chapters' || kind === 'descriptions') continue;
    if (/metadata/iu.test(label)) continue;
    if (kind && kind !== 'captions' && kind !== 'subtitles') continue;
    const cues = wdKvttToArray(track.cues);
    if (wdKvttIsMetadataJsonCues(cues)) continue;
    let score = 0;
    if (kind === 'captions') score += 100;
    else if (kind === 'subtitles') score += 60;
    if (cues.length > 0) score += 80;
    if (/开启|字幕|中文|zh|caption/iu.test(label)) score += 30;
    if (typeof track.src === 'string' && /\.vtt(?:$|\?)/iu.test(track.src)) score += 20;
    if (track.mode === 'showing') score += 10;
    scored.push({ track, cues, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function resolveActiveVjsPlayer(pageWin, doc) {
  const playersMap = pageWin?.videojs?.getPlayers?.();
  if (!playersMap || typeof playersMap !== 'object') return null;
  const visibleVideo = [...(doc?.querySelectorAll?.('video,audio') || [])].find(el => el.isConnected && !el.hidden);
  const candidates = [];
  for (const [key, player] of Object.entries(playersMap)) {
    if (!player) continue;
    if (typeof player.isDisposed === 'function' && player.isDisposed()) continue;
    const el = typeof player.el === 'function' ? player.el() : null;
    if (el && el.isConnected === false) continue;
    const tracks = [...new Set([...wdKvttToArray(player.textTracks?.()), ...wdKvttToArray(player.remoteTextTracks?.())])];
    const picked = selectCaptionTrack(tracks);
    let score = 0;
    if (visibleVideo && el && (el.contains(visibleVideo) || player.tech_?.el_ === visibleVideo)) score += 1000;
    if (el?.isConnected) score += 200;
    if (picked) score += 100;
    if (picked?.cues?.length) score += 50;
    candidates.push({ key, player, picked, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function readCourseHighlights(doc) {
  if (!doc?.querySelectorAll) return [];
  const items = [];
  for (const node of doc.querySelectorAll('.highlight-point-list > .highlight-point, .highlight-point')) {
    const timeEl = node.querySelector('[data-seconds]');
    const rawSec = timeEl?.getAttribute?.('data-seconds');
    const seconds = rawSec !== null && rawSec !== undefined && rawSec !== '' && Number.isFinite(Number(rawSec)) ? Number(rawSec) : null;
    const title = (node.querySelector('.highlight-point-title')?.textContent || '').trim();
    const desc = (node.querySelector('.highlight-point-desc')?.textContent || '').trim();
    if (!title && !desc) continue;
    items.push({
      seconds,
      timeText: seconds !== null ? formatTimestamp(seconds) : (timeEl?.textContent || '').trim(),
      title,
      desc,
    });
  }
  return items;
}

function wdKvttReadDomSections(doc, courseId) {
  if (!doc?.querySelectorAll) return [];
  const sections = [];
  const seen = new Set();
  for (const dl of doc.querySelectorAll('.chapter-list.chapter-all ul li dl[id*="show-sections"]')) {
    const dlCourseId = dl.getAttribute('data-course-id') ?? dl.getAttribute('data-courseid');
    if (courseId && dlCourseId && dlCourseId !== courseId) continue;
    const id = dl.id.slice(dl.id.lastIndexOf('show-sections') + 'show-sections'.length);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const chapterEl = dl.closest('li')?.querySelector('.list-title');
    const chapterTitle = (chapterEl?.getAttribute?.('title') || chapterEl?.textContent || '').trim();
    const titleEl = dl.querySelector('.qcontent');
    const title = (titleEl?.getAttribute?.('title') || titleEl?.textContent || '').trim() || `课节 ${sections.length + 1}`;
    const resourceId = dl.getAttribute('data-resource-id') ?? dl.getAttribute('data-resourceid') ?? null;
    sections.push({
      sectionId: id,
      sectionIndex: sections.length + 1,
      chapterTitle,
      title,
      resourceId,
      attachmentId: resourceId,
      active: dl.classList.contains('focus'),
      captionVtt: null,
      cues: [],
      segments: [],
      source: 'unavailable',
    });
  }
  return sections;
}

function wdKvttFindCourseModule(pageWin, courseId) {
  const mods = pageWin?.app?._modules;
  if (!mods || typeof mods !== 'object') return null;
  const entries = Object.entries(mods).filter(([key]) => key.startsWith('study/course/detail--'));
  if (!entries.length) return null;
  const matched = courseId
    ? entries.filter(([, mod]) => {
      const modId = mod?.store?.models?.course?.data?.id ?? mod?.renderOptions?.id ?? null;
      return String(modId || '') === String(courseId);
    })
    : entries;
  const pool = matched.length ? matched : entries;
  const connected = pool.filter(([, mod]) => mod?._el?.isConnected === true);
  return (connected.at(-1) || pool.at(-1))?.[1] || null;
}

function wdKvttCuesFromTrack(cues) {
  return wdKvttToArray(cues).map((c, idx) => {
    const startSec = Number(c?.startTime ?? c?.startSec ?? 0);
    const endSec = Number(c?.endTime ?? c?.endSec ?? startSec);
    const text = wdKvttStripCueText(c?.text ?? '');
    return {
      index: idx + 1,
      id: c?.id ? String(c.id) : null,
      startMs: Math.round(Math.max(0, startSec) * 1000),
      endMs: Math.round(Math.max(endSec, startSec, 0) * 1000),
      startSec: Math.max(0, startSec),
      endSec: Math.max(endSec, startSec, 0),
      text,
    };
  }).filter(c => c.text);
}

function parseCourseHash(hash) {
  const match = wdKvttCourseRoutePattern.exec(String(hash ?? ''));
  if (!match) return { isCourse: false, courseId: null, subjectId: null };
  return { isCourse: true, courseId: match[1], subjectId: match[3] || null };
}

function probeCourseSubtitleHints(pageWin, doc) {
  const hints = {};
  const route = parseCourseHash(pageWin?.location?.hash || doc?.defaultView?.location?.hash || '');
  const activeMod = wdKvttFindCourseModule(pageWin, route.courseId);
  if (!activeMod) return hints;
  const courseModel = activeMod?.store?.models?.course?.data || null;
  const trackModel = activeMod?.store?.models?.trackList;
  const trackList = Array.isArray(trackModel?.data) ? trackModel.data : [];
  const chapters = Array.isArray(courseModel?.courseChapters) ? courseModel.courseChapters : [];
  const trackByAttachment = new Map();
  for (const item of trackList) {
    if (item?.attachmentId && item?.captionVtt) trackByAttachment.set(String(item.attachmentId), String(item.captionVtt));
  }
  const anyTrackLoaded = trackList.length > 0 || chapters.some(ch => (ch?.courseChapterSections || []).some(s => Boolean(s?.trackUrl) || s?.showTrackStatus !== undefined));
  if (!anyTrackLoaded) return hints;
  for (const ch of chapters) {
    for (const sec of (Array.isArray(ch?.courseChapterSections) ? ch.courseChapterSections : [])) {
      const sectionId = String(sec?.id ?? sec?.sectionId ?? '');
      if (!sectionId) continue;
      const attachmentId = sec?.attachmentId ? String(sec.attachmentId) : (sec?.resourceId ? String(sec.resourceId) : null);
      const url = sec?.trackUrl || (attachmentId ? trackByAttachment.get(attachmentId) : null) || '';
      if (url) {
        hints[sectionId] = { hasSubtitle: true, status: 'known-vtt', captionVtt: String(url), reason: '' };
      } else {
        hints[sectionId] = { hasSubtitle: false, status: 'no-subtitle', captionVtt: null, reason: '课程字幕清单中未包含本课节 captionVtt' };
      }
    }
  }
  return hints;
}

function createSubtitleAvailabilityProber({ win, pageWin = win, httpGet, maxConcurrency = 2 } = {}) {
  const limit = Math.max(1, Number.isFinite(maxConcurrency) ? Math.floor(maxConcurrency) : 2);
  const urlCache = new Map();
  const inFlight = new Map();
  const confirmedBySection = new Map();
  const courseApiCache = new Map();
  const queue = [];
  let running = 0;
  let destroyed = false;
  let activeAbort = typeof AbortController === 'function' ? new AbortController() : null;

  const lookupSectionModuleInfo = (courseId, sectionId, resourceId) => {
    const doc = win?.document;
    const route = parseCourseHash(win?.location?.hash || pageWin?.location?.hash || doc?.defaultView?.location?.hash || '');
    const effectiveCourseId = courseId || route.courseId || null;
    const activeMod = wdKvttFindCourseModule(pageWin, effectiveCourseId);
    const courseModel = activeMod?.store?.models?.course?.data || null;
    const trackList = Array.isArray(activeMod?.store?.models?.trackList?.data) ? activeMod.store.models.trackList.data : [];
    const trackByAttachment = new Map();
    for (const item of trackList) {
      if (item?.attachmentId && item?.captionVtt) trackByAttachment.set(String(item.attachmentId), String(item.captionVtt));
    }
    let matchedSection = null;
    for (const ch of (Array.isArray(courseModel?.courseChapters) ? courseModel.courseChapters : [])) {
      for (const sec of (Array.isArray(ch?.courseChapterSections) ? ch.courseChapterSections : [])) {
        const sid = String(sec?.id ?? sec?.sectionId ?? '');
        const att = sec?.attachmentId ? String(sec.attachmentId) : (sec?.resourceId ? String(sec.resourceId) : null);
        if ((sectionId && sid === String(sectionId)) || (resourceId && att === String(resourceId))) {
          matchedSection = sec;
          break;
        }
      }
      if (matchedSection) break;
    }
    const attachmentId = matchedSection?.attachmentId
      ? String(matchedSection.attachmentId)
      : (matchedSection?.resourceId ? String(matchedSection.resourceId) : (resourceId ? String(resourceId) : null));
    let captionVtt = matchedSection?.trackUrl || (attachmentId ? trackByAttachment.get(attachmentId) : null) || null;
    if (!captionVtt && sectionId) {
      const bySec = trackList.find(item => item?.sectionId && String(item.sectionId) === String(sectionId) && item?.captionVtt);
      if (bySec) captionVtt = String(bySec.captionVtt);
    }
    const anyTrackLoaded = trackList.length > 0 || Boolean(matchedSection?.trackUrl) || matchedSection?.showTrackStatus !== undefined;
    return {
      courseId: effectiveCourseId || (courseModel?.id ? String(courseModel.id) : null),
      attachmentId,
      captionVtt: captionVtt ? String(captionVtt).trim() : null,
      matchedSection,
      anyTrackLoaded,
    };
  };

  const hasLiveVideojsCaptionCues = () => {
    const doc = win?.document;
    const vjsMatch = resolveActiveVjsPlayer(pageWin, doc);
    if (!vjsMatch?.player) return false;
    const tracks = [...new Set([...wdKvttToArray(vjsMatch.player.textTracks?.()), ...wdKvttToArray(vjsMatch.player.remoteTextTracks?.())])];
    const captionOnly = tracks.filter(t => String(t?.kind || '').toLowerCase() === 'captions');
    const picked = selectCaptionTrack(captionOnly);
    if (!picked?.cues?.length) return false;
    return wdKvttCuesFromTrack(picked.cues).length > 0;
  };

  const pump = () => {
    if (destroyed) return;
    while (running < limit && queue.length > 0) {
      const task = queue.shift();
      running += 1;
      Promise.resolve()
        .then(() => task.run())
        .then(task.resolve, task.reject)
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  const enqueue = fn => new Promise((resolve, reject) => {
    if (destroyed) { resolve({ available: false, source: 'destroyed' }); return; }
    queue.push({ run: fn, resolve, reject });
    pump();
  });

  const loadCourseApiOnce = async courseId => {
    if (!courseId || typeof httpGet !== 'function') return [];
    if (courseApiCache.has(courseId)) return courseApiCache.get(courseId);
    const p = enqueue(async () => {
      if (destroyed) return [];
      const rawRoot = String(pageWin?.app?.options?.urlRoot || '/api/v1').replace(/\/+$/u, '');
      const apiPath = `${rawRoot.startsWith('/') ? rawRoot : `/${rawRoot}`}/course-study/caption/${encodeURIComponent(courseId)}`;
      let parsedApi;
      try {
        parsedApi = new URL(apiPath, win?.location?.origin || 'https://wangda.chinamobile.com');
      } catch {
        return [];
      }
      if (parsedApi.protocol !== 'https:' || !wdKvttAllowedVttHosts(parsedApi.hostname)) return [];
      try {
        const res = await httpGet(parsedApi.toString(), { signal: activeAbort?.signal, sameOrigin: parsedApi.origin === win?.location?.origin });
        const status = typeof res === 'object' && res !== null && Number.isFinite(Number(res.status)) ? Number(res.status) : 200;
        if (status < 200 || status >= 300) return [];
        const text = typeof res === 'string' ? res : String(res?.text ?? '');
        if (!text.trim()) return [];
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
      } catch {
        return [];
      }
    });
    courseApiCache.set(courseId, p);
    return p;
  };

  const probeVttUrl = rawUrl => {
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl, win?.location?.href || 'https://wangda.chinamobile.com/');
    } catch {
      return Promise.resolve({ available: false, source: 'invalid-url', failed: true });
    }
    const fullUrl = parsedUrl.toString();
    if (parsedUrl.protocol !== 'https:' || !wdKvttAllowedVttHosts(parsedUrl.hostname)) {
      const blocked = { available: false, source: 'disallowed-host', failed: true };
      urlCache.set(fullUrl, blocked);
      return Promise.resolve(blocked);
    }
    if (urlCache.has(fullUrl)) return Promise.resolve(urlCache.get(fullUrl));
    if (inFlight.has(fullUrl)) return inFlight.get(fullUrl);
    if (typeof httpGet !== 'function') {
      return Promise.resolve({ available: false, source: 'no-http-channel', failed: false });
    }
    const job = enqueue(async () => {
      if (destroyed) return { available: false, source: 'destroyed' };
      try {
        const res = await httpGet(fullUrl, { signal: activeAbort?.signal, sameOrigin: parsedUrl.origin === win?.location?.origin });
        const status = typeof res === 'object' && res !== null && Number.isFinite(Number(res.status)) ? Number(res.status) : 200;
        const text = typeof res === 'string' ? res : String(res?.text ?? '');
        if (status < 200 || status >= 300 || !text.trim()) {
          const failRes = { available: false, source: status === 404 ? 'vtt-404' : 'vtt-empty', status, failed: true };
          urlCache.set(fullUrl, failRes);
          return failRes;
        }
        const cues = parseWebVtt(text);
        const out = cues.length > 0
          ? { available: true, source: 'captionVtt', status, cueCount: cues.length, failed: false }
          : { available: false, source: 'vtt-zero-cues', status, cueCount: 0, failed: true };
        urlCache.set(fullUrl, out);
        return out;
      } catch (err) {
        const status = wdKvttExtractHttpStatus(err);
        const failRes = { available: false, source: status === 404 ? 'vtt-404' : 'vtt-error', status, failed: true };
        urlCache.set(fullUrl, failRes);
        return failRes;
      } finally {
        inFlight.delete(fullUrl);
      }
    });
    inFlight.set(fullUrl, job);
    return job;
  };

  const getCached = ({ courseId, sectionId, resourceId, active }) => {
    const secKey = courseId ? `${courseId}::${sectionId}` : null;
    if (secKey && confirmedBySection.has(secKey)) return confirmedBySection.get(secKey);
    if (!courseId && confirmedBySection.has(String(sectionId))) return confirmedBySection.get(String(sectionId));
    if (active && hasLiveVideojsCaptionCues()) return { available: true, source: 'vjs-captions', failed: false };
    const info = lookupSectionModuleInfo(courseId, sectionId, resourceId);
    if (info.captionVtt) {
      try {
        const fullUrl = new URL(info.captionVtt, win?.location?.href || 'https://wangda.chinamobile.com/').toString();
        if (urlCache.has(fullUrl)) return urlCache.get(fullUrl);
      } catch { /* ignore */ }
    } else if (info.anyTrackLoaded) {
      return { available: false, source: 'no-caption', failed: true };
    }
    return null;
  };

  const probeSection = async ({ courseId, sectionId, resourceId, active }) => {
    if (destroyed) return { available: false, source: 'destroyed' };
    const cached = getCached({ courseId, sectionId, resourceId, active });
    if (cached) return cached;
    const info = lookupSectionModuleInfo(courseId, sectionId, resourceId);
    if (info.captionVtt) {
      return probeVttUrl(info.captionVtt);
    }
    if (active && hasLiveVideojsCaptionCues()) {
      return { available: true, source: 'vjs-captions', failed: false };
    }
    // Only if platform trackList has NOT loaded yet, try at most one cached course caption API call
    if (!info.anyTrackLoaded && info.courseId && typeof httpGet === 'function') {
      const items = await loadCourseApiOnce(info.courseId);
      const match = items.find(item =>
        (info.attachmentId && item?.attachmentId && String(item.attachmentId) === String(info.attachmentId))
        || (sectionId && item?.sectionId && String(item.sectionId) === String(sectionId))
      );
      if (match?.captionVtt) {
        return probeVttUrl(String(match.captionVtt));
      }
    }
    return { available: false, source: 'no-caption', failed: true };
  };

  const setConfirmed = (sectionId, available, courseId = null) => {
    if (!sectionId || typeof available !== 'boolean') return;
    const val = { available, source: 'confirmed', failed: !available };
    if (courseId) confirmedBySection.set(`${courseId}::${sectionId}`, val);
    else confirmedBySection.set(String(sectionId), val);
  };

  const resetPending = () => {
    try { activeAbort?.abort?.(); } catch { /* ignore */ }
    activeAbort = typeof AbortController === 'function' ? new AbortController() : null;
    while (queue.length) {
      const item = queue.shift();
      item.resolve({ available: false, source: 'cancelled' });
    }
    inFlight.clear();
  };

  return {
    lookupSectionModuleInfo,
    getCached,
    probeSection,
    setConfirmed,
    resetPending,
    destroy() {
      destroyed = true;
      resetPending();
      urlCache.clear();
      confirmedBySection.clear();
      courseApiCache.clear();
    },
  };
}

function wdKvttExtractHttpStatus(err) {
  if (!err) return null;
  if (Number.isFinite(Number(err.status)) && Number(err.status) > 0) return Number(err.status);
  if (Number.isFinite(Number(err.httpStatus)) && Number(err.httpStatus) > 0) return Number(err.httpStatus);
  const m = /\bHTTP\s+(\d{3})\b/iu.exec(String(err.message || err));
  return m ? Number(m[1]) : null;
}

function wdKvttWaitMs(ms, signal) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function wdKvttReadVjsCaptionSnapshot(pageWin, doc) {
  const vjsMatch = resolveActiveVjsPlayer(pageWin, doc);
  if (!vjsMatch) return { player: null, picked: null, cues: [], trackUrl: null };
  const player = vjsMatch.player;
  const tracks = [...new Set([...wdKvttToArray(player.textTracks?.()), ...wdKvttToArray(player.remoteTextTracks?.())])];
  const picked = selectCaptionTrack(tracks);
  const cues = picked?.cues?.length ? wdKvttCuesFromTrack(picked.cues) : [];
  const trackUrl = typeof picked?.track?.src === 'string' && picked.track.src.trim() ? picked.track.src.trim() : null;
  return { player, picked, cues, trackUrl };
}

async function wdKvttFetchAndParseVtt({ rawUrl, baseHref, origin, httpGet, signal, path, pathLabel, sec, logFn }) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl, baseHref || 'https://wangda.chinamobile.com/');
  } catch {
    logFn({ path, pathLabel, ok: false, reason: '字幕 URL 格式非法', url: redactSubtitleUrl(rawUrl), status: null, cueCount: 0 });
    return { ok: false, failureKind: 'fetch-error', triedUrl: rawUrl };
  }
  const fullUrl = parsedUrl.toString();
  const safeUrl = redactSubtitleUrl(fullUrl);
  if (parsedUrl.protocol !== 'https:' || !wdKvttAllowedVttHosts(parsedUrl.hostname)) {
    logFn({ path, pathLabel, ok: false, reason: '非网大域名字幕链接，已按安全白名单跳过', url: safeUrl, status: null, cueCount: 0 });
    return { ok: false, failureKind: 'fetch-error', triedUrl: fullUrl, skippedDomain: true };
  }
  if (typeof httpGet !== 'function') {
    logFn({ path, pathLabel, ok: false, reason: '当前环境未提供字幕请求通道（httpGet 不可用）', url: safeUrl, status: null, cueCount: 0 });
    return { ok: false, failureKind: 'fetch-error', triedUrl: fullUrl };
  }
  try {
    const res = await httpGet(fullUrl, { signal, sameOrigin: parsedUrl.origin === origin });
    const httpStatus = typeof res === 'object' && res !== null && Number.isFinite(Number(res.status)) ? Number(res.status) : 200;
    const rawText = typeof res === 'string' ? res : String(res?.text ?? '');
    if (httpStatus < 200 || httpStatus >= 300) {
      const kind = httpStatus === 404 ? 'fetch-404' : 'fetch-error';
      logFn({
        path,
        pathLabel,
        ok: false,
        reason: httpStatus === 404 ? '字幕直链返回 HTTP 404（字幕文件不存在）' : `字幕直链返回 HTTP ${httpStatus}`,
        url: safeUrl,
        status: httpStatus,
        cueCount: 0,
      });
      return { ok: false, failureKind: kind, triedUrl: fullUrl, status: httpStatus };
    }
    if (!rawText.trim()) {
      logFn({ path, pathLabel, ok: false, reason: '字幕直链返回空内容（0 字节）', url: safeUrl, status: httpStatus, cueCount: 0 });
      return { ok: false, failureKind: 'empty-vtt', triedUrl: fullUrl, status: httpStatus };
    }
    const parsedCues = parseWebVtt(rawText);
    if (!parsedCues.length) {
      logFn({ path, pathLabel, ok: false, reason: '字幕文件解析出 0 条有效 cue', url: safeUrl, status: httpStatus, cueCount: 0 });
      return { ok: false, failureKind: 'zero-cues', triedUrl: fullUrl, status: httpStatus };
    }
    logFn({ path, pathLabel, ok: true, reason: `成功解析 ${parsedCues.length} 条字幕`, url: safeUrl, status: httpStatus, cueCount: parsedCues.length });
    return { ok: true, cues: parsedCues, triedUrl: fullUrl, status: httpStatus };
  } catch (err) {
    if (signal?.aborted) return { ok: false, aborted: true, triedUrl: fullUrl };
    const status = wdKvttExtractHttpStatus(err);
    const kind = status === 404 ? 'fetch-404' : 'fetch-error';
    const reason = status === 404
      ? '字幕直链返回 HTTP 404（字幕文件不存在）'
      : status
        ? `字幕直链请求失败（HTTP ${status}）`
        : `字幕直链请求异常（${err?.message || '网络错误'}）`;
    logFn({ path, pathLabel, ok: false, reason, url: safeUrl, status, cueCount: 0 });
    return { ok: false, failureKind: kind, triedUrl: fullUrl, status };
  }
}

function wdKvttBuildSubtitleReason(failureKinds) {
  if (failureKinds.includes('fetch-404')) {
    return '本课无字幕：字幕直链返回 HTTP 404，且播放器 textTracks 及页面接口均无可用字幕，因此无法生成时间轴导览、AI 问答与出题。';
  }
  if (failureKinds.includes('empty-vtt')) {
    return '本课无字幕：字幕文件内容为空，且播放器 textTracks 及页面接口均无可用字幕，因此无法生成时间轴导览、AI 问答与出题。';
  }
  if (failureKinds.includes('zero-cues')) {
    return '本课无字幕：字幕文件解析出 0 条有效 cue，且播放器 textTracks 及页面接口均无可用字幕，因此无法生成时间轴导览、AI 问答与出题。';
  }
  if (failureKinds.includes('fetch-error')) {
    return '本课无字幕：字幕拉取失败且播放器 textTracks 与页面接口均无可用字幕，因此无法生成时间轴导览、AI 问答与出题。';
  }
  return '本课无字幕：未检测到 captionVtt 直链，播放器 textTracks 及页面接口均无可用 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。';
}

async function collectCourseSubtitles({ win, pageWin = win, scope = 'course', sectionId = null, httpGet, signal, allowToggleCaptions = true, toggleWaitMs = 240 } = {}) {
  const doc = win?.document;
  const route = parseCourseHash(win?.location?.hash || '');
  const warnings = [];
  const subtitleDiagnostics = [];
  const highlights = readCourseHighlights(doc);
  const domTitle = (doc?.querySelector?.('.course-side-title-row .text-overflow')?.getAttribute?.('title')
    || doc?.querySelector?.('.course-side-title-row .text-overflow')?.textContent || '').trim();
  const domSections = wdKvttReadDomSections(doc, route.courseId);
  const activeDomSection = domSections.find(s => s.active) || null;

  // Read app._modules trackList + courseChapters
  const activeMod = wdKvttFindCourseModule(pageWin, route.courseId);
  const courseModel = activeMod?.store?.models?.course?.data || null;
  const trackList = Array.isArray(activeMod?.store?.models?.trackList?.data) ? activeMod.store.models.trackList.data : [];
  const trackByAttachment = new Map();
  for (const item of trackList) {
    if (item?.attachmentId && item?.captionVtt) trackByAttachment.set(String(item.attachmentId), String(item.captionVtt));
  }

  const sections = [];
  const chapters = Array.isArray(courseModel?.courseChapters) ? courseModel.courseChapters : [];
  const anyModuleTrackKnown = trackList.length > 0 || chapters.some(ch => (ch?.courseChapterSections || []).some(s => Boolean(s?.trackUrl) || s?.showTrackStatus !== undefined));
  if (chapters.length) {
    let idx = 0;
    for (const ch of chapters) {
      const chapterTitle = String(ch?.name || ch?.title || '').trim();
      for (const sec of (Array.isArray(ch?.courseChapterSections) ? ch.courseChapterSections : [])) {
        idx += 1;
        const sid = String(sec?.id ?? sec?.sectionId ?? `sec-${idx}`);
        const attachmentId = sec?.attachmentId ? String(sec.attachmentId) : (sec?.resourceId ? String(sec.resourceId) : null);
        const captionVtt = sec?.trackUrl || (attachmentId ? trackByAttachment.get(attachmentId) : null) || null;
        const domMatch = domSections.find(d => d.sectionId === sid || (attachmentId && d.resourceId === attachmentId));
        sections.push({
          sectionId: sid,
          sectionIndex: idx,
          chapterTitle: chapterTitle || domMatch?.chapterTitle || '',
          title: String(sec?.name || sec?.title || domMatch?.title || `课节 ${idx}`).trim(),
          attachmentId,
          active: Boolean(domMatch?.active || (activeDomSection && activeDomSection.sectionId === sid)),
          captionVtt,
          cues: [],
          segments: [],
          source: 'unavailable',
          hasSubtitle: captionVtt ? null : (anyModuleTrackKnown ? false : null),
          subtitleStatus: captionVtt ? 'pending' : (anyModuleTrackKnown ? 'no-subtitle' : 'pending'),
          subtitleReason: '',
          subtitleChecked: false,
          subtitleLogs: [],
        });
      }
    }
  } else if (domSections.length) {
    for (const sec of domSections) {
      const captionVtt = (sec.attachmentId ? trackByAttachment.get(sec.attachmentId) : null) || null;
      sections.push({
        ...sec,
        captionVtt,
        hasSubtitle: captionVtt ? null : (anyModuleTrackKnown ? false : null),
        subtitleStatus: captionVtt ? 'pending' : (anyModuleTrackKnown ? 'no-subtitle' : 'pending'),
        subtitleReason: '',
        subtitleChecked: false,
        subtitleLogs: [],
      });
    }
  } else if (trackList.length) {
    trackList.forEach((item, idx) => {
      sections.push({
        sectionId: String(item?.sectionId || item?.attachmentId || `track-${idx + 1}`),
        sectionIndex: idx + 1,
        chapterTitle: '',
        title: String(item?.name || item?.title || `课节 ${idx + 1}`),
        attachmentId: item?.attachmentId ? String(item.attachmentId) : null,
        active: idx === 0,
        captionVtt: item?.captionVtt ? String(item.captionVtt) : null,
        cues: [],
        segments: [],
        source: 'unavailable',
        hasSubtitle: item?.captionVtt ? null : false,
        subtitleStatus: item?.captionVtt ? 'pending' : 'no-subtitle',
        subtitleReason: '',
        subtitleChecked: false,
        subtitleLogs: [],
      });
    });
  } else {
    // Even on pages with no DOM sections and no cues yet, keep a current section stub so UI clearly shows "本课无字幕" instead of empty/loading
    sections.push({
      sectionId: 'current',
      sectionIndex: 1,
      chapterTitle: '',
      title: domTitle || '当前课节',
      attachmentId: null,
      active: true,
      captionVtt: null,
      cues: [],
      segments: [],
      source: 'unavailable',
      hasSubtitle: null,
      subtitleStatus: 'pending',
      subtitleReason: '',
      subtitleChecked: false,
      subtitleLogs: [],
    });
  }

  if (sections.length && !sections.some(s => s.active)) {
    sections[0].active = true;
  }

  const courseId = route.courseId || (courseModel?.id ? String(courseModel.id) : null);
  const activeSec = sections.find(s => s.active) || sections[0] || null;
  const focusedSec = sectionId ? (sections.find(s => s.sectionId === sectionId) || activeSec) : activeSec;
  const targets = scope === 'section' ? (focusedSec ? [focusedSec] : []) : sections;

  // Shared Path 3a caption-API lookup (in-flight deduplicated; executed at most once per course even under concurrency)
  let captionApiPromise = null;
  const loadCaptionApiOnce = () => {
    if (captionApiPromise) return captionApiPromise;
    captionApiPromise = (async () => {
      if (!courseId) {
        return { ok: false, url: null, status: null, reason: '当前页面未解析到 courseId，无法请求课程字幕接口', items: [] };
      }
      const rawRoot = String(pageWin?.app?.options?.urlRoot || '/api/v1').replace(/\/+$/u, '');
      const apiPath = `${rawRoot.startsWith('/') ? rawRoot : `/${rawRoot}`}/course-study/caption/${encodeURIComponent(courseId)}`;
      const apiUrl = new URL(apiPath, win?.location?.origin || 'https://wangda.chinamobile.com').toString();
      const safeApiUrl = redactSubtitleUrl(apiUrl);
      if (typeof httpGet !== 'function') {
        return { ok: false, url: safeApiUrl, status: null, reason: '当前环境未提供字幕接口请求通道（httpGet 不可用）', items: [] };
      }
      try {
        const parsedApi = new URL(apiUrl);
        if (parsedApi.protocol !== 'https:' || !wdKvttAllowedVttHosts(parsedApi.hostname)) {
          return { ok: false, url: safeApiUrl, status: null, reason: '字幕接口域名不在网大白名单内', items: [] };
        }
        const res = await httpGet(apiUrl, { signal, sameOrigin: parsedApi.origin === win?.location?.origin });
        const status = typeof res === 'object' && res !== null && Number.isFinite(Number(res.status)) ? Number(res.status) : 200;
        const text = typeof res === 'string' ? res : String(res?.text ?? '');
        if (status < 200 || status >= 300) {
          return { ok: false, url: safeApiUrl, status, reason: `课程字幕接口返回 HTTP ${status}`, items: [] };
        }
        if (!text.trim()) {
          return { ok: false, url: safeApiUrl, status, reason: '课程字幕接口返回空响应', items: [] };
        }
        let parsed;
        try { parsed = JSON.parse(text); } catch {
          return { ok: false, url: safeApiUrl, status, reason: '课程字幕接口返回非 JSON 内容', items: [] };
        }
        const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
        return { ok: true, url: safeApiUrl, status, reason: items.length ? `接口返回 ${items.length} 条字幕记录` : '课程字幕接口返回空列表（该课程无 AI 字幕）', items };
      } catch (err) {
        const status = wdKvttExtractHttpStatus(err);
        return {
          ok: false,
          url: safeApiUrl,
          status,
          reason: status ? `课程字幕接口请求失败（HTTP ${status}）` : `课程字幕接口请求异常（${err?.message || '网络错误'}）`,
          items: [],
        };
      }
    })();
    return captionApiPromise;
  };

  const resolveSectionSubtitles = async sec => {
    if (signal?.aborted) return;
    sec.subtitleChecked = true;
    const isActiveSection = Boolean(sec.active || (activeSec && sec.sectionId === activeSec.sectionId));
    const triedUrls = new Set();
    const failureKinds = [];
    const log = entry => {
      const rec = {
        timestamp: new Date().toISOString(),
        sectionId: sec.sectionId,
        sectionTitle: sec.title,
        ...entry,
      };
      sec.subtitleLogs.push(rec);
      subtitleDiagnostics.push(rec);
    };

    // ===== Path 1: 课节 captionVtt 直链 =====
    if (sec.captionVtt) {
      const r1 = await wdKvttFetchAndParseVtt({
        rawUrl: sec.captionVtt,
        baseHref: win?.location?.href,
        origin: win?.location?.origin,
        httpGet,
        signal,
        path: 'captionVtt',
        pathLabel: '1. 课节 captionVtt 直链',
        sec,
        logFn: log,
      });
      if (r1.aborted) return;
      if (r1.triedUrl) triedUrls.add(r1.triedUrl);
      if (r1.skippedDomain) warnings.push(`已跳过非网大域名字幕链接：${sec.title}`);
      if (r1.ok) {
        sec.cues = r1.cues;
        sec.segments = cleanAndSegmentCues(r1.cues).segments;
        sec.source = 'vtt-url';
        sec.hasSubtitle = true;
        sec.subtitleStatus = 'ok';
        sec.subtitleReason = '';
        return;
      }
      if (r1.failureKind) failureKinds.push(r1.failureKind);
    } else {
      log({
        path: 'captionVtt',
        pathLabel: '1. 课节 captionVtt 直链',
        ok: false,
        reason: '课节 captionVtt 缺失（trackUrl 与 trackList 均无直链）',
        url: null,
        status: null,
        cueCount: 0,
      });
    }

    // ===== Path 2: Video.js textTracks（含切换 AI 字幕开关后再读） =====
    let vjsTrackUrl = null;
    if (isActiveSection) {
      const snap = wdKvttReadVjsCaptionSnapshot(pageWin, doc);
      vjsTrackUrl = snap.trackUrl;
      if (snap.cues.length) {
        sec.cues = snap.cues;
        sec.segments = cleanAndSegmentCues(snap.cues).segments;
        sec.source = 'vjs-cues';
        sec.hasSubtitle = true;
        sec.subtitleStatus = 'ok';
        sec.subtitleReason = '';
        log({
          path: 'videojs-textTracks',
          pathLabel: '2. Video.js textTracks',
          ok: true,
          reason: `从播放器内存 captions 轨读取 ${snap.cues.length} 条字幕`,
          url: redactSubtitleUrl(snap.trackUrl),
          status: null,
          cueCount: snap.cues.length,
        });
        return;
      }
      log({
        path: 'videojs-textTracks',
        pathLabel: '2. Video.js textTracks',
        ok: false,
        reason: !snap.player
          ? '页面未检测到已挂载的 Video.js 播放器实例'
          : !snap.picked
            ? '播放器 textTracks 无可用 captions/subtitles 轨（已排除 metadata 轨）'
            : '播放器存在字幕轨但当前 cues 为 0 条（可能未开启 AI 字幕或尚未加载）',
        url: redactSubtitleUrl(snap.trackUrl),
        status: null,
        cueCount: 0,
      });

      // Path 2b: Try toggling AI subtitle switch / track.mode then re-read
      if (allowToggleCaptions && snap.player) {
        let attempted = false;
        const track = snap.picked?.track || null;
        const prevMode = track ? track.mode : null;
        try {
          if (track && track.mode !== 'showing' && track.mode !== 'hidden') {
            track.mode = 'hidden';
            attempted = true;
          }
        } catch { /* ignore */ }
        let afterToggle = wdKvttReadVjsCaptionSnapshot(pageWin, doc);
        if (!afterToggle.cues.length && track && track.mode !== 'showing') {
          try {
            track.mode = 'showing';
            attempted = true;
          } catch { /* ignore */ }
          afterToggle = wdKvttReadVjsCaptionSnapshot(pageWin, doc);
        }
        if (!afterToggle.cues.length) {
          const playerEl = typeof snap.player.el === 'function' ? snap.player.el() : null;
          const scopeEl = playerEl || doc;
          const menuItems = [...(scopeEl?.querySelectorAll?.('.vjs-captions-button .vjs-menu-item, .vjs-subtitles-button .vjs-menu-item') || [])];
          const enableItem = menuItems.find(el => {
            const txt = String(el.textContent || '').trim();
            return /开启|字幕|中文|caption/iu.test(txt) && !/关闭|off/iu.test(txt);
          });
          const toggleBtn = enableItem || scopeEl?.querySelector?.('.vjs-captions-button button, .vjs-captions-button');
          if (toggleBtn && typeof toggleBtn.click === 'function') {
            try {
              toggleBtn.click();
              attempted = true;
            } catch { /* ignore */ }
          }
          afterToggle = wdKvttReadVjsCaptionSnapshot(pageWin, doc);
        }
        if (!afterToggle.cues.length && attempted && toggleWaitMs > 0) {
          const deadline = Date.now() + toggleWaitMs;
          while (!afterToggle.cues.length && Date.now() < deadline && !signal?.aborted) {
            await wdKvttWaitMs(50, signal);
            afterToggle = wdKvttReadVjsCaptionSnapshot(pageWin, doc);
          }
        }
        if (afterToggle.trackUrl && !vjsTrackUrl) vjsTrackUrl = afterToggle.trackUrl;
        if (track && prevMode === 'disabled') {
          try { track.mode = prevMode; } catch { /* ignore */ }
        }
        if (afterToggle.cues.length) {
          sec.cues = afterToggle.cues;
          sec.segments = cleanAndSegmentCues(afterToggle.cues).segments;
          sec.source = 'vjs-cues-after-toggle';
          sec.hasSubtitle = true;
          sec.subtitleStatus = 'ok';
          sec.subtitleReason = '';
          log({
            path: 'videojs-toggle-captions',
            pathLabel: '2b. Video.js 切换 AI 字幕开关后重读',
            ok: true,
            reason: `切换字幕开关/轨模式后读出 ${afterToggle.cues.length} 条字幕`,
            url: redactSubtitleUrl(afterToggle.trackUrl),
            status: null,
            cueCount: afterToggle.cues.length,
          });
          return;
        }
        log({
          path: 'videojs-toggle-captions',
          pathLabel: '2b. Video.js 切换 AI 字幕开关后重读',
          ok: false,
          reason: attempted
            ? '已尝试切换 AI 字幕开关/轨模式，但仍未读到有效 cues（0 条）'
            : '未检测到可切换的 AI 字幕轨或 .vjs-captions-button 开关',
          url: redactSubtitleUrl(afterToggle.trackUrl || vjsTrackUrl),
          status: null,
          cueCount: 0,
        });
      }
    } else {
      log({
        path: 'videojs-textTracks',
        pathLabel: '2. Video.js textTracks',
        ok: false,
        reason: '非当前播放课节，跳过播放器实时 textTracks 读取',
        url: null,
        status: null,
        cueCount: 0,
      });
    }

    // ===== Path 3: 页面/接口其它可取得的字幕来源 =====
    // 3a. 课程字幕接口 /api/v1/course-study/caption/{courseId}
    const apiRes = await loadCaptionApiOnce();
    if (signal?.aborted) return;
    if (!apiRes.ok) {
      log({
        path: 'caption-api',
        pathLabel: '3a. 课程字幕接口',
        ok: false,
        reason: apiRes.reason,
        url: apiRes.url,
        status: apiRes.status,
        cueCount: 0,
      });
    } else {
      const apiMatch = apiRes.items.find(item =>
        (sec.attachmentId && item?.attachmentId && String(item.attachmentId) === String(sec.attachmentId))
        || (sec.sectionId && item?.sectionId && String(item.sectionId) === String(sec.sectionId))
      );
      const apiVtt = apiMatch?.captionVtt ? String(apiMatch.captionVtt).trim() : '';
      if (!apiVtt) {
        log({
          path: 'caption-api',
          pathLabel: '3a. 课程字幕接口',
          ok: false,
          reason: apiRes.items.length ? '课程字幕接口返回记录中无本课节对应的 captionVtt' : apiRes.reason,
          url: apiRes.url,
          status: apiRes.status,
          cueCount: 0,
        });
      } else {
        let normalizedApiVtt = apiVtt;
        try { normalizedApiVtt = new URL(apiVtt, win?.location?.href || 'https://wangda.chinamobile.com/').toString(); } catch { /* keep raw */ }
        if (triedUrls.has(normalizedApiVtt)) {
          log({
            path: 'caption-api',
            pathLabel: '3a. 课程字幕接口',
            ok: false,
            reason: '字幕接口返回的直链与路径 1 相同且已失败，不再重复请求',
            url: redactSubtitleUrl(normalizedApiVtt),
            status: apiRes.status,
            cueCount: 0,
          });
        } else {
          const rApi = await wdKvttFetchAndParseVtt({
            rawUrl: normalizedApiVtt,
            baseHref: win?.location?.href,
            origin: win?.location?.origin,
            httpGet,
            signal,
            path: 'caption-api',
            pathLabel: '3a. 课程字幕接口直链',
            sec,
            logFn: log,
          });
          if (rApi.aborted) return;
          if (rApi.triedUrl) triedUrls.add(rApi.triedUrl);
          if (rApi.ok) {
            sec.captionVtt = normalizedApiVtt;
            sec.cues = rApi.cues;
            sec.segments = cleanAndSegmentCues(rApi.cues).segments;
            sec.source = 'caption-api-vtt';
            sec.hasSubtitle = true;
            sec.subtitleStatus = 'ok';
            sec.subtitleReason = '';
            return;
          }
          if (rApi.failureKind) failureKinds.push(rApi.failureKind);
        }
      }
    }

    // 3b. 原生 <video>/<audio>.textTracks（仅当前播放课节）
    if (isActiveSection && doc?.querySelectorAll) {
      let nativeFound = false;
      for (const media of doc.querySelectorAll('video,audio')) {
        const picked = selectCaptionTrack(media.textTracks);
        if (picked?.cues?.length) {
          const cues = wdKvttCuesFromTrack(picked.cues);
          if (cues.length) {
            sec.cues = cues;
            sec.segments = cleanAndSegmentCues(cues).segments;
            sec.source = 'native-cues';
            sec.hasSubtitle = true;
            sec.subtitleStatus = 'ok';
            sec.subtitleReason = '';
            log({
              path: 'native-textTracks',
              pathLabel: '3b. 原生 video.textTracks',
              ok: true,
              reason: `从原生媒体 textTracks 读取 ${cues.length} 条字幕`,
              url: null,
              status: null,
              cueCount: cues.length,
            });
            nativeFound = true;
            return;
          }
        }
      }
      if (!nativeFound) {
        log({
          path: 'native-textTracks',
          pathLabel: '3b. 原生 video.textTracks',
          ok: false,
          reason: '原生 <video>/<audio>.textTracks 中无可用字幕轨',
          url: null,
          status: null,
          cueCount: 0,
        });
      }

      // 3c. DOM <track> 标签或播放器 track.src 兜底直链
      const domTrackUrls = [];
      for (const tr of doc.querySelectorAll('track[src]')) {
        const kind = String(tr.getAttribute('kind') || '').toLowerCase();
        const src = String(tr.getAttribute('src') || '').trim();
        if (!src) continue;
        if (!kind || kind === 'captions' || kind === 'subtitles' || /\.vtt(?:$|\?)/iu.test(src)) {
          domTrackUrls.push(src);
        }
      }
      if (vjsTrackUrl) domTrackUrls.push(vjsTrackUrl);
      const uniqueDomUrls = [...new Set(domTrackUrls)].filter(u => {
        try { return !triedUrls.has(new URL(u, win?.location?.href || 'https://wangda.chinamobile.com/').toString()); }
        catch { return !triedUrls.has(u); }
      });
      if (uniqueDomUrls.length) {
        for (const candidateUrl of uniqueDomUrls) {
          const rDom = await wdKvttFetchAndParseVtt({
            rawUrl: candidateUrl,
            baseHref: win?.location?.href,
            origin: win?.location?.origin,
            httpGet,
            signal,
            path: 'dom-track-element',
            pathLabel: '3c. 页面 <track> / 轨直链',
            sec,
            logFn: log,
          });
          if (rDom.aborted) return;
          if (rDom.triedUrl) triedUrls.add(rDom.triedUrl);
          if (rDom.ok) {
            sec.cues = rDom.cues;
            sec.segments = cleanAndSegmentCues(rDom.cues).segments;
            sec.source = 'dom-track-vtt';
            sec.hasSubtitle = true;
            sec.subtitleStatus = 'ok';
            sec.subtitleReason = '';
            return;
          }
          if (rDom.failureKind) failureKinds.push(rDom.failureKind);
        }
      } else {
        log({
          path: 'dom-track-element',
          pathLabel: '3c. 页面 <track> / 轨直链',
          ok: false,
          reason: '页面 DOM 中无未尝试的 <track> 字幕源',
          url: null,
          status: null,
          cueCount: 0,
        });
      }
    }

    // All paths failed -> explicitly classify as no-subtitle (NEVER throw or hang)
    sec.hasSubtitle = false;
    sec.source = 'unavailable';
    sec.subtitleStatus = failureKinds.includes('fetch-404') ? 'fetch-404'
      : failureKinds.includes('empty-vtt') ? 'empty-vtt'
        : failureKinds.includes('zero-cues') ? 'zero-cues'
          : failureKinds.includes('fetch-error') ? 'fetch-error'
            : 'no-subtitle';
    sec.subtitleReason = wdKvttBuildSubtitleReason(failureKinds);
  };

  // Run target sections with bounded concurrency <= 2
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      if (signal?.aborted) return;
      const sec = targets[cursor++];
      await resolveSectionSubtitles(sec);
    }
  };
  if (targets.length > 1) await Promise.all([worker(), worker()]);
  else if (targets.length === 1) await resolveSectionSubtitles(targets[0]);

  for (const sec of sections) {
    const sid = sec.sectionId || 'current';
    if (sec.cues.length && !sec.segments.length) {
      sec.segments = cleanAndSegmentCues(sec.cues, { sectionId: sid }).segments;
    } else if (sec.segments.length) {
      sec.segments = sec.segments.map((seg, idx) => {
        const segId = seg.segId || `S${String(idx + 1).padStart(2, '0')}`;
        const startSec = Number.isFinite(seg.startSec) ? Math.floor(seg.startSec) : Math.floor((Number(seg.startMs) || 0) / 1000);
        const endSec = Number.isFinite(seg.endSec) ? Math.max(startSec, Math.ceil(seg.endSec)) : Math.max(startSec, Math.ceil((Number(seg.endMs) || startSec * 1000) / 1000));
        return { ...seg, index: idx + 1, segId, displayId: `[${segId}]`, sectionId: sid, refKey: `${sid}#${segId}`, startSec, endSec, endTimestamp: seg.endTimestamp || formatTimestamp(endSec) };
      });
    }
    const maxEndSec = sec.segments.reduce((mx, seg) => Math.max(mx, seg.endSec || seg.startSec || 0), 0);
    if (maxEndSec > 0) sec.durationSec = Math.max(Number(sec.durationSec) || 0, maxEndSec);
    if (win && courseId && sec.sectionId && sec.segments.length) {
      saveSubtitleParseCache(win, courseId, sec.sectionId, {
        segments: sec.segments.map(s => ({
          index: s.index,
          segId: s.segId,
          refKey: s.refKey,
          startMs: s.startMs,
          endMs: s.endMs,
          startSec: s.startSec,
          endSec: s.endSec,
          timestamp: s.timestamp,
          endTimestamp: s.endTimestamp,
          text: s.text,
        })),
        durationSec: sec.durationSec || maxEndSec,
        source: sec.source,
      });
    }
  }

  const title = String(courseModel?.name || courseModel?.title || domTitle || '当前课程').trim();
  const captionedSections = sections.filter(s => s.cues.length > 0).length;
  const skippedNoSubtitleSections = sections
    .filter(s => s.hasSubtitle === false)
    .map(s => ({
      sectionId: s.sectionId,
      title: s.title,
      status: s.subtitleStatus || 'no-subtitle',
      reason: s.subtitleReason || '本课无字幕',
    }));
  return {
    isCourse: route.isCourse,
    courseId,
    subjectId: route.subjectId,
    title,
    activeSectionId: activeSec?.sectionId || null,
    sections,
    highlights,
    captionedSections,
    hasAnySubtitle: captionedSections > 0,
    skippedNoSubtitleSections,
    subtitleDiagnostics,
    fallbackOrder: SUBTITLE_FALLBACK_ORDER,
    warnings,
  };
}

function seekCourseTime({ win, pageWin = win, adapter, sectionId, seconds, queueRunning = false, unmute = false, autoMuteEnabled = false, expectedCourseId = null } = {}) {
  const secNum = Number(seconds);
  if (!Number.isFinite(secNum) || secNum < 0) {
    return { ok: false, degraded: true, message: '无效的时间点，无法定位。' };
  }
  const timeText = formatTimestamp(secNum);
  const doc = win?.document;
  const page = typeof adapter?.read === 'function' ? adapter.read() : null;
  if (page && page.kind && page.kind !== 'course') {
    return {
      ok: false,
      notOnSection: true,
      degraded: true,
      message: `当前页面不是课程播放页，无法定位至 ${timeText}；请先进入对应课程与课节。`,
    };
  }
  if (expectedCourseId && page?.courseId && String(page.courseId) !== String(expectedCourseId)) {
    return {
      ok: false,
      notOnSection: true,
      degraded: true,
      message: `当前播放器不在目标课程中，无法定位至 ${timeText}；请先切换到对应课程。`,
    };
  }
  const currentSectionId = page?.activeSectionId || null;
  const isDifferentSection = Boolean(sectionId && sectionId !== 'current' && currentSectionId && String(sectionId) !== String(currentSectionId));

  if (isDifferentSection) {
    if (queueRunning) {
      return {
        ok: false,
        notOnSection: true,
        degraded: true,
        message: `当前播放器不在本课节，且自动学习运行中不自动切节；请暂停后切换到对应课节定位至 ${timeText}。`,
      };
    }
    if (typeof adapter?.selectSection === 'function' && adapter.selectSection(sectionId)) {
      return {
        ok: true,
        switchedSection: true,
        notOnSection: true,
        degraded: true,
        message: `当前播放器不在本课节，已切换至目标课节，待播放器加载后可定位至 ${timeText}（如未自动跳转请再点一次「跳播并开声」）。`,
      };
    }
    return {
      ok: false,
      notOnSection: true,
      degraded: true,
      message: `当前播放器不在本课节（目标时间点 ${timeText} 位于其他课节），请手动切节后再定位至 ${timeText}。`,
    };
  }

  const applyUnmuteIfRequested = () => {
    if (!unmute) return { unmuted: false, muteProtected: false, suffix: '' };
    // Never break silent hang-course state machine while auto queue is running with auto-mute enabled!
    if (queueRunning && autoMuteEnabled) {
      return {
        unmuted: false,
        muteProtected: true,
        suffix: '；自动静音挂课运行中，为保护挂课策略已保持静音（如需听声请先暂停挂课或关闭自动静音）',
      };
    }
    let didUnmute = false;
    try {
      const vjs = resolveActiveVjsPlayer(pageWin, doc)?.player;
      if (vjs) {
        if (typeof vjs.muted === 'function') { vjs.muted(false); didUnmute = true; }
        if (typeof vjs.volume === 'function' && Number(vjs.volume()) === 0) vjs.volume(0.8);
        if (typeof vjs.paused === 'function' && vjs.paused() && typeof vjs.play === 'function') {
          Promise.resolve(vjs.play()).catch(() => {});
        }
      }
    } catch { /* ignore */ }
    try {
      const media = [...(doc?.querySelectorAll?.('video,audio') || [])].find(el => el.isConnected && !el.hidden);
      if (media) {
        media.muted = false;
        if (Number(media.volume) === 0) media.volume = 0.8;
        didUnmute = true;
        if (media.paused && typeof media.play === 'function') {
          Promise.resolve(media.play()).catch(() => {});
        }
      }
    } catch { /* ignore */ }
    return didUnmute
      ? { unmuted: true, muteProtected: false, suffix: '并已开声' }
      : { unmuted: false, muteProtected: false, suffix: '（未检测到可开声媒体，请手动取消静音）' };
  };

  // 1. Platform native askbar event bus (verified in study.js: seekHighlightPoint -> study.player.seek)
  try {
    if (typeof pageWin?.app?.askbar?.trigger === 'function') {
      pageWin.app.askbar.trigger('study.player.seek', secNum);
      const audio = applyUnmuteIfRequested();
      return { ok: true, method: 'askbar', unmuted: audio.unmuted, muteProtected: audio.muteProtected, message: `已定位播放至 ${timeText}${audio.suffix}` };
    }
  } catch { /* fall through */ }

  // 2. Active in-DOM Video.js player instance
  try {
    const vjs = resolveActiveVjsPlayer(pageWin, doc)?.player;
    if (vjs && typeof vjs.currentTime === 'function') {
      vjs.currentTime(secNum);
      const audio = applyUnmuteIfRequested();
      return { ok: true, method: 'videojs', unmuted: audio.unmuted, muteProtected: audio.muteProtected, message: `已定位播放器至 ${timeText}${audio.suffix}` };
    }
  } catch { /* fall through */ }

  // 3. Visible native HTMLMediaElement
  try {
    const media = [...(doc?.querySelectorAll?.('video,audio') || [])].find(el => el.isConnected && !el.hidden);
    if (media && Number.isFinite(media.duration || 0)) {
      media.currentTime = secNum;
      const audio = applyUnmuteIfRequested();
      return { ok: true, method: 'html5-media', unmuted: audio.unmuted, muteProtected: audio.muteProtected, message: `已定位媒体至 ${timeText}${audio.suffix}` };
    }
  } catch { /* fall through */ }

  return { ok: false, degraded: true, message: `当前页未检测到可定位播放器，时间点：${timeText}` };
}



const WD_CITATION_DEFAULTS = {
  quoteSimilarityThreshold: 0.35,
  claimSimilarityThreshold: 0.20,
  minQuoteCheckChars: 2,
  minClaimCheckChars: 4,
  timeToleranceSec: 2,
};

const wdKcitFunctionChars = new Set([
  '的', '了', '是', '在', '和', '与', '为', '有', '这', '那', '不', '个', '中', '上', '下',
  '大', '要', '就', '也', '都', '很', '可', '会', '能', '着', '过', '把', '将', '被', '从',
  '向', '给', '之', '而', '但', '并', '及', '等', '于', '以', '对', '到', '说', '去', '来',
  '一', '二', '三', '四', '五', '第', '本', '该', '其', '所', '使', '让', '由', '按',
]);

function formatSegmentId(index) {
  const num = Math.max(1, Math.floor(Number(index) || 1));
  return `S${String(num).padStart(2, '0')}`;
}

function formatSegmentDisplayId(segId) {
  const norm = normalizeSegmentId(segId);
  return norm ? `[${norm.segId}]` : String(segId || '');
}

function buildSegmentRefKey(sectionId, segId) {
  const safeSec = String(sectionId || 'current').trim() || 'current';
  const norm = normalizeSegmentId(segId);
  const canonicalId = norm ? norm.segId : String(segId || '').trim();
  return `${safeSec}#${canonicalId}`;
}

function wdKcitToHalfWidth(str) {
  return String(str ?? '')
    .replace(/[\uFF01-\uFF5E]/gu, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/gu, ' ')
    .replace(/[【「『]/gu, '[')
    .replace(/[】」』]/gu, ']');
}

function normalizeSegmentId(raw) {
  if (raw === null || raw === undefined) return null;
  const original = String(raw).trim();
  if (!original) return null;
  let cleaned = wdKcitToHalfWidth(original).trim();
  // Strip outer brackets/parens/quotes repeatedly
  cleaned = cleaned.replace(/^[\[\(\{\s"'`]+|[\]\)\}\s"'`]+$/gu, '').trim();
  if (!cleaned) return null;

  let sectionId = null;
  const hashIdx = cleaned.lastIndexOf('#');
  if (hashIdx > 0) {
    const prefix = cleaned.slice(0, hashIdx).trim();
    const suffix = cleaned.slice(hashIdx + 1).trim();
    if (prefix && suffix) {
      sectionId = prefix;
      cleaned = suffix.replace(/^[\[\(\{\s]+|[\]\)\}\s]+$/gu, '').trim();
    }
  } else if (hashIdx === 0) {
    cleaned = cleaned.slice(1).trim();
  }

  // Match S01 / S1 / s01 / S-01 / S_1 / SEG01 / seg1 (positive integers only)
  const match = /^(?:SEG|S)[_-]?0*(\d{1,5})$/iu.exec(cleaned);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isInteger(num) || num <= 0) return null;
  const segId = formatSegmentId(num);
  return {
    segId,
    displayId: `[${segId}]`,
    index: num,
    sectionId,
    raw: original,
  };
}

function assignStableSegmentIds(rawSegments, sectionId = 'current') {
  const safeSec = String(sectionId || 'current').trim() || 'current';
  const list = Array.isArray(rawSegments) ? rawSegments : [];
  return list.map((seg, idx) => {
    const index = idx + 1;
    const segId = formatSegmentId(index);
    const startMs = Number.isFinite(seg?.startMs)
      ? Math.max(0, Math.round(seg.startMs))
      : Math.max(0, Math.round((Number(seg?.startSec ?? seg?.seconds ?? 0) || 0) * 1000));
    const hasExplicitEnd = Number.isFinite(seg?.endMs) || Number.isFinite(seg?.endSec);
    const rawEndMs = Number.isFinite(seg?.endMs)
      ? Math.round(seg.endMs)
      : Number.isFinite(seg?.endSec)
        ? Math.round(seg.endSec * 1000)
        : null;
    const nextRaw = list[idx + 1];
    const nextStartMs = nextRaw
      ? (Number.isFinite(nextRaw.startMs) ? Math.round(nextRaw.startMs) : Math.round((Number(nextRaw.startSec ?? nextRaw.seconds ?? 0) || 0) * 1000))
      : null;
    const endMs = rawEndMs !== null
      ? Math.max(startMs, rawEndMs)
      : (nextStartMs !== null && nextStartMs >= startMs ? nextStartMs : startMs + 60000);
    const startSec = Math.floor(startMs / 1000);
    const endSec = Math.max(startSec, Math.ceil(endMs / 1000));
    return {
      ...seg,
      index,
      segId,
      displayId: `[${segId}]`,
      sectionId: safeSec,
      refKey: `${safeSec}#${segId}`,
      startMs,
      endMs,
      hasExplicitEnd,
      startSec,
      endSec,
      timestamp: seg?.timestamp || formatTimestamp(startSec),
      endTimestamp: formatTimestamp(endSec),
      text: String(seg?.text ?? seg?.headline ?? '').trim(),
    };
  });
}

function buildSegmentIndex(sectionOrSegments, options = {}) {
  const isArray = Array.isArray(sectionOrSegments);
  const section = isArray ? null : (sectionOrSegments && typeof sectionOrSegments === 'object' ? sectionOrSegments : null);
  const sectionId = String(options.sectionId || section?.sectionId || 'current').trim() || 'current';

  let rawSegments = [];
  if (isArray) {
    rawSegments = sectionOrSegments;
  } else if (Array.isArray(section?.segments) && section.segments.length) {
    rawSegments = section.segments;
  } else if (Array.isArray(section?.timeline) && section.timeline.length && section.mode !== 'highlight' && section.mode !== 'placeholder') {
    rawSegments = section.timeline;
  } else if (Array.isArray(section?.cues) && section.cues.length) {
    rawSegments = cleanAndSegmentCues(section.cues, { sectionId }).segments;
  } else if (Array.isArray(section?.timeline) && section.timeline.length) {
    rawSegments = section.timeline;
  }

  const segments = assignStableSegmentIds(rawSegments, sectionId);
  const byId = new Map();
  const byRefKey = new Map();
  let computedMaxEndSec = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    byId.set(seg.segId, seg);
    byRefKey.set(seg.refKey, seg);
    if (seg.endSec > computedMaxEndSec) computedMaxEndSec = seg.endSec;
    if (seg.startSec > computedMaxEndSec) computedMaxEndSec = seg.startSec;
  }

  const explicitDuration = Number.isFinite(options.durationSec) && options.durationSec > 0
    ? Number(options.durationSec)
    : (Number.isFinite(section?.durationSec) && section.durationSec > 0 ? Number(section.durationSec) : null);
  const maxEndSec = explicitDuration !== null ? explicitDuration : computedMaxEndSec;

  const getNeighbors = segId => {
    const norm = normalizeSegmentId(segId);
    if (!norm) return { prev: null, current: null, next: null };
    const current = byId.get(norm.segId) || null;
    if (!current) return { prev: null, current: null, next: null };
    const idx = current.index - 1;
    const prev = idx > 0 ? segments[idx - 1] : null;
    const next = idx + 1 < segments.length ? segments[idx + 1] : null;
    return { prev, current, next };
  };

  const findSegmentBySeconds = (seconds, toleranceSec = WD_CITATION_DEFAULTS.timeToleranceSec) => {
    const sec = Number(seconds);
    if (!Number.isFinite(sec) || sec < 0 || !segments.length) return null;
    // Exact range hit first
    for (const seg of segments) {
      if (sec >= seg.startSec && sec <= seg.endSec) return seg;
    }
    // Nearest segment within tolerance or preceding segment before next start
    let best = null;
    let bestDist = Infinity;
    for (const seg of segments) {
      const dist = sec < seg.startSec ? (seg.startSec - sec) : (sec > seg.endSec ? (sec - seg.endSec) : 0);
      if (dist < bestDist) {
        bestDist = dist;
        best = seg;
      }
    }
    if (best && bestDist <= Math.max(toleranceSec, 15)) return best;
    return null;
  };

  return {
    sectionId,
    sectionTitle: String(section?.title || options.sectionTitle || '').trim(),
    segments,
    byId,
    byRefKey,
    maxEndSec,
    durationSec: explicitDuration,
    getNeighbors,
    findSegmentBySeconds,
  };
}

function buildCourseSegmentIndex(sections = []) {
  const bySection = new Map();
  const byRefKey = new Map();
  const list = Array.isArray(sections) ? sections : [];
  for (const sec of list) {
    if (!sec) continue;
    const idx = buildSegmentIndex(sec);
    bySection.set(idx.sectionId, idx);
    for (const [k, seg] of idx.byRefKey.entries()) {
      byRefKey.set(k, seg);
    }
  }
  return {
    isCourseIndex: true,
    bySection,
    byRefKey,
    resolveSection(sectionId) {
      if (sectionId && bySection.has(String(sectionId))) return bySection.get(String(sectionId));
      if (bySection.size === 1) return [...bySection.values()][0];
      return null;
    },
    resolveRefKey(refKey) {
      return byRefKey.get(String(refKey || '')) || null;
    },
  };
}

function normalizeCitationCompareText(text) {
  return wdKcitToHalfWidth(String(text ?? ''))
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function computeCitationLiteralOverlap(excerpt, sourceText) {
  const nq = normalizeCitationCompareText(excerpt);
  const ns = normalizeCitationCompareText(sourceText);
  if (!nq || !ns) {
    return { score: 0, bigramRecall: 0, charRecall: 0, normalizedQueryLen: nq.length, normalizedSourceLen: ns.length };
  }
  if (nq.length === 1) {
    const hit = ns.includes(nq) ? 1 : 0;
    return { score: hit, bigramRecall: hit, charRecall: hit, normalizedQueryLen: 1, normalizedSourceLen: ns.length };
  }
  if (ns.includes(nq)) {
    return { score: 1, bigramRecall: 1, charRecall: 1, normalizedQueryLen: nq.length, normalizedSourceLen: ns.length };
  }

  // Bigram recall: fraction of query bigrams present in source
  const sourceBigrams = new Set();
  for (let i = 0; i < ns.length - 1; i += 1) sourceBigrams.add(ns.slice(i, i + 2));
  let matchedBigrams = 0;
  const totalBigrams = nq.length - 1;
  for (let i = 0; i < totalBigrams; i += 1) {
    if (sourceBigrams.has(nq.slice(i, i + 2))) matchedBigrams += 1;
  }
  const bigramRecall = totalBigrams > 0 ? matchedBigrams / totalBigrams : 0;

  // Content-char multiset recall (filtering common Chinese function chars to prevent accidental inflation)
  const sourceCounts = new Map();
  for (const ch of ns) sourceCounts.set(ch, (sourceCounts.get(ch) || 0) + 1);
  const queryChars = [...nq];
  const contentQueryChars = queryChars.filter(ch => !wdKcitFunctionChars.has(ch));
  const targetChars = contentQueryChars.length >= 2 ? contentQueryChars : queryChars;
  const usedCounts = new Map();
  let matchedChars = 0;
  for (const ch of targetChars) {
    const avail = sourceCounts.get(ch) || 0;
    const used = usedCounts.get(ch) || 0;
    if (used < avail) {
      usedCounts.set(ch, used + 1);
      matchedChars += 1;
    }
  }
  const charRecall = targetChars.length > 0 ? matchedChars / targetChars.length : 0;

  const score = Math.round(Math.min(1, bigramRecall * 0.65 + charRecall * 0.35) * 10000) / 10000;
  return {
    score,
    bigramRecall: Math.round(bigramRecall * 10000) / 10000,
    charRecall: Math.round(charRecall * 10000) / 10000,
    normalizedQueryLen: nq.length,
    normalizedSourceLen: ns.length,
  };
}

function wdKcitDetectRawTime(rawTime) {
  if (rawTime === null || rawTime === undefined || rawTime === '') return { present: false, negative: false, seconds: null, raw: '' };
  if (typeof rawTime === 'number') {
    if (!Number.isFinite(rawTime)) return { present: true, negative: false, seconds: null, raw: String(rawTime) };
    if (rawTime < 0) return { present: true, negative: true, seconds: rawTime, raw: String(rawTime) };
    return { present: true, negative: false, seconds: rawTime, raw: String(rawTime) };
  }
  const str = wdKcitToHalfWidth(String(rawTime)).trim();
  if (!str) return { present: false, negative: false, seconds: null, raw: '' };
  if (/^-\s*\d/u.test(str)) {
    const unsigned = str.replace(/^-\s*/u, '');
    const numMatch = /^(\d+(?:\.\d+)?)$/u.exec(unsigned);
    if (numMatch) return { present: true, negative: true, seconds: -Number(numMatch[1]), raw: str };
    const tsNeg = parseTimestampToSeconds(unsigned);
    return { present: true, negative: true, seconds: tsNeg !== null ? -tsNeg : -1, raw: str };
  }
  if (/^\d+(?:\.\d+)?$/u.test(str)) {
    return { present: true, negative: false, seconds: Number(str), raw: str };
  }
  const parsed = parseTimestampToSeconds(str);
  if (parsed !== null) return { present: true, negative: false, seconds: parsed, raw: str };
  return { present: false, negative: false, seconds: null, raw: str };
}

function wdKcitBuildUnverified({ reasonCode, reason, rawRef, rawQuote = '', rawNote = '', sourceKind = 'segId', sectionId = 'current', segId = null, displayId = '', refKey = null, claimedSeconds = null, excerpt = '', prevSegment = null, nextSegment = null, similarity = null, threshold = null }) {
  return {
    status: 'unverified',
    verified: false,
    reasonCode,
    reason,
    rawRef: String(rawRef || ''),
    rawQuote: String(rawQuote || ''),
    rawNote: String(rawNote || ''),
    sourceKind,
    sectionId: String(sectionId || 'current'),
    segId,
    displayId: displayId || (segId ? `[${segId}]` : String(rawRef || '未核实')),
    refKey,
    seconds: null,
    endSec: null,
    claimedSeconds: Number.isFinite(claimedSeconds) ? claimedSeconds : null,
    timestamp: '',
    endTimestamp: '',
    minuteLabel: '',
    excerpt: String(excerpt || ''),
    prevSegment: prevSegment || null,
    nextSegment: nextSegment || null,
    similarity,
    threshold,
    note: String(rawNote || ''),
  };
}

function verifyCitation(rawInput, indexOrCourseIndex, options = {}) {
  const isObj = Boolean(rawInput && typeof rawInput === 'object');
  const rawIdCandidate = isObj
    ? (rawInput.segId ?? rawInput.seg_id ?? rawInput.segmentId ?? rawInput.ref ?? rawInput.refId ?? rawInput.id ?? null)
    : (typeof rawInput === 'string' ? rawInput : null);
  const rawTimeCandidate = isObj
    ? (rawInput.seconds ?? rawInput.time ?? rawInput.timestamp ?? null)
    : (typeof rawInput === 'number' || typeof rawInput === 'string' ? rawInput : null);
  const rawQuote = isObj ? String(rawInput.quote ?? rawInput.excerpt ?? '').trim() : String(options.quote ?? '').trim();
  const rawNote = isObj ? String(rawInput.note ?? rawInput.reason ?? '').trim() : String(options.note ?? '').trim();
  const claimText = String(options.claimText ?? (isObj ? (rawInput.text || rawInput.note || '') : '')).trim();

  const normId = normalizeSegmentId(rawIdCandidate);
  const requestedSectionId = normId?.sectionId || (isObj && rawInput.sectionId ? String(rawInput.sectionId) : null) || options.sectionId || null;

  let secIdx = null;
  if (indexOrCourseIndex?.isCourseIndex) {
    secIdx = indexOrCourseIndex.resolveSection(requestedSectionId);
  } else if (indexOrCourseIndex && indexOrCourseIndex.byId instanceof Map) {
    secIdx = indexOrCourseIndex;
  } else if (Array.isArray(indexOrCourseIndex) || (indexOrCourseIndex && typeof indexOrCourseIndex === 'object')) {
    secIdx = buildSegmentIndex(indexOrCourseIndex, { sectionId: requestedSectionId || 'current', durationSec: options.durationSec });
  }

  const sectionId = secIdx?.sectionId || requestedSectionId || 'current';
  const timeToleranceSec = Number.isFinite(options.timeToleranceSec) ? options.timeToleranceSec : WD_CITATION_DEFAULTS.timeToleranceSec;
  const quoteThreshold = Number.isFinite(options.similarityThreshold)
    ? options.similarityThreshold
    : (Number.isFinite(options.quoteSimilarityThreshold) ? options.quoteSimilarityThreshold : WD_CITATION_DEFAULTS.quoteSimilarityThreshold);
  const claimThreshold = Number.isFinite(options.similarityThreshold)
    ? options.similarityThreshold
    : (Number.isFinite(options.claimSimilarityThreshold) ? options.claimSimilarityThreshold : WD_CITATION_DEFAULTS.claimSimilarityThreshold);
  const minQuoteCheckChars = Number.isFinite(options.minQuoteCheckChars) ? options.minQuoteCheckChars : WD_CITATION_DEFAULTS.minQuoteCheckChars;
  const minClaimCheckChars = Number.isFinite(options.minClaimCheckChars) ? options.minClaimCheckChars : WD_CITATION_DEFAULTS.minClaimCheckChars;

  if (!secIdx || !secIdx.segments.length) {
    return wdKcitBuildUnverified({
      reasonCode: 'missing_source',
      reason: '缺少本课节原字幕分段表，无法核验引用。',
      rawRef: rawIdCandidate ?? rawTimeCandidate ?? '',
      rawQuote,
      rawNote,
      sectionId,
    });
  }

  const ceiling = Number.isFinite(options.durationSec) && options.durationSec > 0
    ? Number(options.durationSec)
    : secIdx.maxEndSec;

  const timeCheck = wdKcitDetectRawTime(rawTimeCandidate);

  const checkTextMatch = (seg, sourceKind, verifiedSeconds) => {
    const qNormLen = normalizeCitationCompareText(rawQuote).length;
    const cNormLen = normalizeCitationCompareText(claimText).length;
    let textToCheck = '';
    let usedThreshold = quoteThreshold;
    let checkKind = 'none';

    if (qNormLen >= minQuoteCheckChars) {
      textToCheck = rawQuote;
      usedThreshold = quoteThreshold;
      checkKind = 'quote';
    } else if (cNormLen >= minClaimCheckChars) {
      textToCheck = claimText;
      usedThreshold = claimThreshold;
      checkKind = 'claim';
    }

    const neighbors = secIdx.getNeighbors(seg.segId);
    let similarity = null;
    if (checkKind !== 'none') {
      const overlap = computeCitationLiteralOverlap(textToCheck, seg.text);
      similarity = overlap.score;
      if (overlap.score < usedThreshold) {
        return wdKcitBuildUnverified({
          reasonCode: 'text_mismatch',
          reason: `AI 引述与原字幕 ${seg.displayId} 原文严重不符（字面重合度 ${Math.round(overlap.score * 100)}% < 阈值 ${Math.round(usedThreshold * 100)}%）`,
          rawRef: normId ? normId.raw : (timeCheck.raw || seg.displayId),
          rawQuote: textToCheck,
          rawNote,
          sourceKind,
          sectionId: secIdx.sectionId,
          segId: seg.segId,
          displayId: seg.displayId,
          refKey: seg.refKey,
          claimedSeconds: verifiedSeconds,
          excerpt: seg.text,
          prevSegment: neighbors.prev,
          nextSegment: neighbors.next,
          similarity: overlap.score,
          threshold: usedThreshold,
        });
      }
    }

    const floorSec = Math.floor(verifiedSeconds);
    return {
      status: 'verified',
      verified: true,
      reasonCode: null,
      reason: '',
      rawRef: normId ? normId.raw : (timeCheck.raw || seg.displayId),
      rawQuote,
      rawNote,
      sourceKind,
      sectionId: secIdx.sectionId,
      segId: seg.segId,
      displayId: seg.displayId,
      refKey: seg.refKey,
      seconds: floorSec,
      segStartSec: seg.startSec,
      endSec: seg.endSec,
      claimedSeconds: floorSec,
      timestamp: formatTimestamp(floorSec),
      endTimestamp: seg.endTimestamp,
      minuteLabel: `约第 ${Math.floor(floorSec / 60) + 1} 分钟`,
      excerpt: seg.text,
      prevSegment: neighbors.prev,
      nextSegment: neighbors.next,
      similarity,
      threshold: checkKind === 'none' ? null : usedThreshold,
      note: rawNote,
    };
  };

  // Path A: Segment ID citation (primary contract)
  if (normId) {
    const seg = secIdx.byId.get(normId.segId);
    if (!seg) {
      return wdKcitBuildUnverified({
        reasonCode: 'id_not_found',
        reason: `引用的段落编号 ${normId.displayId} 不存在于本课节字幕中（共 ${secIdx.segments.length} 段）`,
        rawRef: normId.raw,
        rawQuote,
        rawNote,
        sourceKind: 'segId',
        sectionId: secIdx.sectionId,
        segId: normId.segId,
        displayId: normId.displayId,
      });
    }
    // Bounds check on segment start time (and any co-supplied explicit time)
    if (seg.startSec < 0 || (ceiling > 0 && seg.startSec > ceiling + timeToleranceSec)) {
      return wdKcitBuildUnverified({
        reasonCode: 'time_out_of_bounds',
        reason: `段落 ${seg.displayId} 对应时间点（${seg.timestamp}）超出本课节时长范围（00:00–${formatTimestamp(ceiling)}）`,
        rawRef: normId.raw,
        rawQuote,
        rawNote,
        sourceKind: 'segId',
        sectionId: secIdx.sectionId,
        segId: seg.segId,
        displayId: seg.displayId,
        refKey: seg.refKey,
        claimedSeconds: seg.startSec,
        excerpt: seg.text,
      });
    }
    if (timeCheck.present && (timeCheck.negative || (timeCheck.seconds !== null && ceiling > 0 && timeCheck.seconds > ceiling + timeToleranceSec))) {
      return wdKcitBuildUnverified({
        reasonCode: 'time_out_of_bounds',
        reason: `AI 附带的时间点（${timeCheck.raw}）越界（有效范围 00:00–${formatTimestamp(ceiling)}）`,
        rawRef: `${normId.displayId} (${timeCheck.raw})`,
        rawQuote,
        rawNote,
        sourceKind: 'segId',
        sectionId: secIdx.sectionId,
        segId: seg.segId,
        displayId: seg.displayId,
        refKey: seg.refKey,
        claimedSeconds: timeCheck.seconds,
        excerpt: seg.text,
      });
    }
    return checkTextMatch(seg, 'segId', seg.startSec);
  }

  // Path B: Legacy timestamp citation — MUST go through the exact same bounds + segment lookup + text check!
  if (timeCheck.present) {
    if (timeCheck.negative) {
      return wdKcitBuildUnverified({
        reasonCode: 'time_out_of_bounds',
        reason: `AI 输出的时间戳为负值（${timeCheck.raw}），超出合法播放范围`,
        rawRef: timeCheck.raw,
        rawQuote,
        rawNote,
        sourceKind: 'legacy-time',
        sectionId: secIdx.sectionId,
        claimedSeconds: timeCheck.seconds,
      });
    }
    if (timeCheck.seconds === null) {
      return wdKcitBuildUnverified({
        reasonCode: 'invalid_ref',
        reason: `无法解析 AI 给出的引用格式（${timeCheck.raw}）`,
        rawRef: timeCheck.raw,
        rawQuote,
        rawNote,
        sourceKind: 'legacy-time',
        sectionId: secIdx.sectionId,
      });
    }
    if (ceiling > 0 && timeCheck.seconds > ceiling + timeToleranceSec) {
      return wdKcitBuildUnverified({
        reasonCode: 'time_out_of_bounds',
        reason: `AI 输出的时间点 ${formatTimestamp(timeCheck.seconds)} 超出本课节时长（最大 ${formatTimestamp(ceiling)}）`,
        rawRef: timeCheck.raw,
        rawQuote,
        rawNote,
        sourceKind: 'legacy-time',
        sectionId: secIdx.sectionId,
        claimedSeconds: Math.floor(timeCheck.seconds),
      });
    }
    const seg = secIdx.findSegmentBySeconds(timeCheck.seconds, timeToleranceSec);
    if (!seg) {
      return wdKcitBuildUnverified({
        reasonCode: 'time_out_of_bounds',
        reason: `时间点 ${formatTimestamp(timeCheck.seconds)} 未命中本课节任何有效字幕分段`,
        rawRef: timeCheck.raw,
        rawQuote,
        rawNote,
        sourceKind: 'legacy-time',
        sectionId: secIdx.sectionId,
        claimedSeconds: Math.floor(timeCheck.seconds),
      });
    }
    return checkTextMatch(seg, 'legacy-time', timeCheck.seconds);
  }

  return wdKcitBuildUnverified({
    reasonCode: 'invalid_ref',
    reason: rawIdCandidate ? `无法识别的引用编号格式（${rawIdCandidate}）` : '缺少有效的字幕段落引用编号',
    rawRef: rawIdCandidate ?? '',
    rawQuote,
    rawNote,
    sourceKind: 'segId',
    sectionId: secIdx.sectionId,
  });
}

function extractSegmentIdsFromText(text) {
  const str = String(text ?? '');
  const found = [];
  const seen = new Set();
  // Match bracketed/parenthesized groups like [S01], [S1], ［Ｓ０１］, 【S01、S02】, (S01)
  const bracketRe = /[\[［【(（]((?:\s*(?:[A-Za-z0-9_-]+[#＃])?(?:SEG|S|Ｓ)[_-]?[0-9０-９]{1,5}\s*[,，、;；]?\s*)+)[\]］】)）]/giu;
  let m;
  while ((m = bracketRe.exec(str)) !== null) {
    const parts = m[1].split(/[,，、;；\s]+/u).filter(Boolean);
    for (const part of parts) {
      const norm = normalizeSegmentId(part);
      if (!norm) continue;
      const key = `${norm.sectionId || ''}#${norm.segId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(norm);
    }
  }
  return found;
}

function tokenizeTextWithCitations(text) {
  const str = String(text ?? '');
  if (!str) return [];
  const tokens = [];
  // Match either bracketed/parenthesized segment IDs ([S01], ［Ｓ１］, 【S01, S02】, (S01)) or negative/positive timestamps (-01:20, 01:20, 1:02:03)
  const combinedRe = /([\[［【(（](?:\s*(?:[A-Za-z0-9_-]+[#＃])?(?:SEG|S|Ｓ)[_-]?[0-9０-９]{1,5}\s*[,，、;；]?\s*)+[\]］】)）])|((?<![A-Za-z0-9:])-?\d{1,2}:\d{2}(?::\d{2})?(?!\d))/giu;
  let last = 0;
  let m;
  while ((m = combinedRe.exec(str)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', text: str.slice(last, m.index) });
    if (m[1]) {
      const inner = m[1].slice(1, -1);
      const segRefs = inner.split(/[,，、;；\s]+/u).map(normalizeSegmentId).filter(Boolean);
      if (segRefs.length) {
        tokens.push({ type: 'segRef', raw: m[1], refs: segRefs });
      } else {
        tokens.push({ type: 'text', text: m[1] });
      }
    } else if (m[2]) {
      const rawTime = m[2];
      const negative = rawTime.startsWith('-');
      const sec = negative ? -1 : parseTimestampToSeconds(rawTime);
      if (negative || sec !== null) {
        tokens.push({ type: 'timeRef', raw: rawTime, negative, seconds: sec });
      } else {
        tokens.push({ type: 'text', text: rawTime });
      }
    }
    last = combinedRe.lastIndex;
  }
  if (last < str.length) tokens.push({ type: 'text', text: str.slice(last) });
  return tokens;
}





const WD_AI_CACHE_SCHEMA_VERSION = WD_CACHE_SCHEMA_VERSION;

const WD_AI_STORAGE_KEYS = {
  config: WD_GM_STORAGE_KEYS.config,
  apiKey: WD_GM_STORAGE_KEYS.apiKey,
  cache: WD_CACHE_STORAGE_KEYS.knowledge,
  legacyConfig: WD_LEGACY_STORAGE_KEYS.config,
  legacyApiKey: WD_LEGACY_STORAGE_KEYS.apiKey,
};

const WD_AI_PRIVACY_NOTICE = '安全说明：油猴环境下 API Key 与配置保存在扩展隔离存储 GM_setValue（宿主页面不可读取），学习资产按课分片持久保存；非油猴环境自动降级至 localStorage 并告警。仅存本地、不上传、不经过任何我们自己的服务器；仅在您主动点击分析时直连您配置的 Base URL。';

const WD_AI_PROVIDERS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    note: '支持浏览器 CORS 且国内可直连（GM 与页面 fetch 均可）。',
  },
  {
    id: 'dashscope',
    label: '通义千问 (DashScope)',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    note: '阿里云百炼 OpenAI 兼容模式，支持浏览器 CORS 且国内可直连。',
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    note: '支持浏览器 CORS 且国内可直连。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 (SiliconFlow)',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    note: '支持浏览器 CORS 且国内可直连。',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    modelsEndpointHint: 'GET /models',
    corsMode: 'relay-needed',
    corsBadge: '需中转 URL 或 GM 通道',
    requiresApiKey: true,
    note: '浏览器跨域下对话接口 /chat/completions 无 CORS 放行头，页面 fetch 会失败；请使用油猴 GM 通道或改填支持 CORS 的中转 URL。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    modelsEndpointHint: 'GET /models',
    corsMode: 'direct',
    corsBadge: '浏览器可直连',
    requiresApiKey: true,
    publicModelList: true,
    note: '原生支持浏览器 CORS 且可直连（线路波动可换中转）；/models 接口公开，建议选定模型后再测连接以校验 Key。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    modelsEndpointHint: 'GET /models',
    corsMode: 'proxy-or-relay',
    corsBadge: '国内需中转 URL 或代理',
    requiresApiKey: true,
    note: '官方支持 CORS，但国内无代理无法直连（连接重置/超时）；请开启代理或改填中转 Base URL。',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    modelsEndpointHint: 'GET /v1beta/models',
    corsMode: 'proxy-or-relay',
    corsBadge: '国内需中转 URL 或代理',
    requiresApiKey: true,
    note: '使用 Gemini 原生端点（亦兼容 /v1beta/openai）。官方放行 CORS，但国内无代理会超时，需代理或填中转 Base URL。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    modelsEndpointHint: 'GET /v1/models',
    corsMode: 'proxy-or-relay',
    corsBadge: '国内需中转 URL 或代理',
    requiresApiKey: true,
    note: '使用 Anthropic 原生端点（带浏览器直连头）。国内无代理会被 403 拦截，请开启代理或改填中转 Base URL。',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
    modelsEndpointHint: 'GET /models',
    corsMode: 'local',
    corsBadge: '本机回环（需开 CORS 或 GM）',
    requiresApiKey: false,
    note: '本机回环服务；页面 fetch 需设置 OLLAMA_ORIGINS=*，或通过油猴 GM 通道访问。',
  },
  {
    id: 'custom',
    label: 'OpenAI 兼容 / 自定义',
    protocol: 'openai',
    baseUrl: '',
    model: '',
    modelsEndpointHint: 'GET {base}/models',
    corsMode: 'custom',
    corsBadge: '自定义 · Base URL 必填',
    requiresApiKey: false,
    note: '兼容任意 OpenAI 协议中转站（One API / New API / LiteLLM 等），Base URL 必填（通常以 /v1 结尾）。',
  },
];

const wdKaiDefaultConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  transport: 'auto',
};

const wdKaiAnthropicVersion = '2023-06-01';

function wdKaiLocalStorage(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

function getAiProviderPreset(providerId) {
  return WD_AI_PROVIDERS.find(item => item.id === providerId)
    || WD_AI_PROVIDERS.find(item => item.id === wdKaiDefaultConfig.provider)
    || WD_AI_PROVIDERS[0];
}

function loadAiSettings(win, options = {}) {
  ensureStorageMigrated(win, options);
  const { config: parsed } = readStoredAiConfig(win, options);
  const provider = WD_AI_PROVIDERS.some(p => p.id === parsed.provider) ? parsed.provider : wdKaiDefaultConfig.provider;
  const preset = getAiProviderPreset(provider);
  const transport = ['auto', 'gm', 'fetch'].includes(parsed.transport) ? parsed.transport : 'auto';
  const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : preset.baseUrl;
  const model = typeof parsed.model === 'string' ? parsed.model.trim() : preset.model;
  const { apiKey } = readStoredAiApiKey(win, options);
  return { provider, baseUrl, model, transport, apiKey };
}

function saveAiSettings(win, input, options = {}) {
  ensureStorageMigrated(win, options);
  const current = loadAiSettings(win, options);
  const provider = WD_AI_PROVIDERS.some(p => p.id === input?.provider) ? input.provider : current.provider;
  const baseUrl = typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : current.baseUrl;
  const model = typeof input?.model === 'string' ? input.model.trim() : current.model;
  const transport = ['auto', 'gm', 'fetch'].includes(input?.transport) ? input.transport : current.transport;
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : current.apiKey;
  const cfgRes = writeStoredAiConfig(win, { provider, baseUrl, model, transport }, options);
  if (!cfgRes.ok) {
    return { ok: false, error: cfgRes.error || '写入 AI 配置失败，请检查存储权限。' };
  }
  const keyRes = writeStoredAiApiKey(win, apiKey, options);
  if (!keyRes.ok) {
    return { ok: false, error: keyRes.error || '写入 API Key 失败，请检查存储权限。' };
  }
  return {
    ok: true,
    backend: keyRes.backend || cfgRes.backend,
    degraded: Boolean(keyRes.degraded || cfgRes.degraded),
    settings: { provider, baseUrl, model, transport, apiKey },
  };
}

function clearAiApiKey(win, options = {}) {
  const res = writeStoredAiApiKey(win, '', options);
  try { wdKaiLocalStorage(win)?.removeItem?.(WD_LEGACY_STORAGE_KEYS.apiKey); } catch { /* ignore */ }
  if (!res.ok) return { ok: false, error: res.error || '清空本地 Key 失败。' };
  return { ok: true, backend: res.backend };
}

function buildKnowledgeCacheKey(courseId, scope = 'course', sectionId = null) {
  const cid = String(courseId || 'unknown').trim() || 'unknown';
  if (scope === 'section') {
    const sid = String(sectionId || 'current').trim() || 'current';
    return `${cid}::section::${sid}`;
  }
  return `${cid}::course`;
}

function loadKnowledgeCache(win, key, policy = {}) {
  if (!key) return null;
  const entry = getLruCacheEntry(win, WD_AI_STORAGE_KEYS.cache, key, {
    ...WD_CACHE_LRU_DEFAULTS.knowledge,
    schemaVersion: WD_AI_CACHE_SCHEMA_VERSION,
    ...policy,
  });
  if (!entry || typeof entry !== 'object' || !entry.tree || typeof entry.markdown !== 'string') return null;
  if (entry.schemaVersion !== WD_AI_CACHE_SCHEMA_VERSION) return null;
  return entry;
}

function saveKnowledgeCache(win, key, entry, policy = {}) {
  if (!key || !entry?.tree) return false;
  return setLruCacheEntry(win, WD_AI_STORAGE_KEYS.cache, key, {
    schemaVersion: WD_AI_CACHE_SCHEMA_VERSION,
    cachedAt: Number(entry.cachedAt) || Date.now(),
    provider: entry.provider || '',
    model: entry.model || '',
    scope: entry.scope || 'course',
    tree: entry.tree,
    markdown: entry.markdown || buildKnowledgeMarkdown(entry.tree),
    usedAi: Boolean(entry.usedAi),
    fallback: Boolean(entry.fallback),
    failedSections: Array.isArray(entry.failedSections) ? entry.failedSections : [],
    channel: entry.channel || null,
  }, { ...WD_CACHE_LRU_DEFAULTS.knowledge, ...policy });
}

function clearKnowledgeCache(win, key = null) {
  return clearLruCache(win, WD_AI_STORAGE_KEYS.cache, key);
}

function redactAiSecret(text, apiKey = '') {
  let out = String(text ?? '');
  const cleanKey = String(apiKey ?? '').trim();
  if (cleanKey.length >= 6) {
    out = out.split(cleanKey).join('[已脱敏]');
  }
  out = out.replace(/\b(?:sk-[a-zA-Z0-9_-]{8,}|AIza[0-9A-Za-z_-]{16,}|Bearer\s+[a-zA-Z0-9._-]{12,})\b/gu, '[已脱敏]');
  return out;
}

function normalizeAiBaseUrl(baseUrl) {
  const raw = String(baseUrl ?? '').trim();
  if (!raw) throw new Error('未填写 Base URL');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Base URL 格式非法，请以 https:// 开头');
  }
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('Base URL 仅支持 https://（或本机 http://127.0.0.1 / localhost）');
  }
  return url;
}

function resolveAiProtocol(settings = {}) {
  const providerId = String(settings?.provider || '').trim();
  const rawUrl = String(settings?.baseUrl || '').trim();
  const preset = WD_AI_PROVIDERS.find(item => item.id === providerId);
  if (preset?.protocol === 'anthropic') {
    if (/\/chat\/completions\/?$/iu.test(rawUrl)) return 'openai';
    return 'anthropic';
  }
  if (preset?.protocol === 'gemini') {
    if (/\/openai(?:\/|$)/iu.test(rawUrl) || /\/chat\/completions\/?$/iu.test(rawUrl)) return 'openai';
    return 'gemini';
  }
  return 'openai';
}

function buildChatCompletionsUrl(baseUrl) {
  const url = normalizeAiBaseUrl(baseUrl);
  const cleanPath = url.pathname.replace(/\/+$/u, '');
  url.pathname = /\/chat\/completions$/iu.test(cleanPath) ? cleanPath : `${cleanPath}/chat/completions`;
  return url.toString();
}

function buildModelsUrl(baseUrl, protocol = 'openai') {
  const url = normalizeAiBaseUrl(baseUrl);
  let cleanPath = url.pathname.replace(/\/+$/u, '');
  if (protocol === 'gemini') {
    cleanPath = cleanPath
      .replace(/\/models\/[^/]+(?::[a-zA-Z]+)?$/iu, '')
      .replace(/\/models$/iu, '');
    url.pathname = cleanPath ? `${cleanPath}/models` : '/v1beta/models';
    url.searchParams.delete('key');
    if (!url.searchParams.has('pageSize')) url.searchParams.set('pageSize', '200');
    return url.toString();
  }
  if (protocol === 'anthropic') {
    cleanPath = cleanPath.replace(/\/messages$/iu, '').replace(/\/models$/iu, '');
    url.pathname = cleanPath ? `${cleanPath}/models` : '/v1/models';
    return url.toString();
  }
  cleanPath = cleanPath
    .replace(/\/chat\/completions$/iu, '')
    .replace(/\/completions$/iu, '')
    .replace(/\/responses$/iu, '')
    .replace(/\/models$/iu, '');
  url.pathname = `${cleanPath}/models`;
  return url.toString();
}

function buildChatEndpointUrl(baseUrl, protocol = 'openai', model = '') {
  if (protocol === 'gemini') {
    const url = normalizeAiBaseUrl(baseUrl);
    const cleanModel = String(model || '').trim().replace(/^models\//iu, '');
    if (!cleanModel) throw new Error('未填写模型名');
    let cleanPath = url.pathname.replace(/\/+$/u, '');
    cleanPath = cleanPath
      .replace(/\/models\/[^/]+(?::[a-zA-Z]+)?$/iu, '')
      .replace(/\/models$/iu, '');
    const prefix = cleanPath || '/v1beta';
    url.pathname = `${prefix}/models/${encodeURIComponent(cleanModel)}:generateContent`;
    url.searchParams.delete('key');
    return url.toString();
  }
  if (protocol === 'anthropic') {
    const url = normalizeAiBaseUrl(baseUrl);
    let cleanPath = url.pathname.replace(/\/+$/u, '');
    cleanPath = cleanPath.replace(/\/messages$/iu, '').replace(/\/models$/iu, '');
    url.pathname = cleanPath ? `${cleanPath}/messages` : '/v1/messages';
    return url.toString();
  }
  return buildChatCompletionsUrl(baseUrl);
}

function validateAiEndpoint(settings = {}) {
  const protocol = resolveAiProtocol(settings);
  normalizeAiBaseUrl(settings?.baseUrl);
  if (protocol === 'openai') buildChatCompletionsUrl(settings?.baseUrl);
  return { ok: true, protocol };
}

function wdKaiExtractErrorDetail(bodyText, apiKey = '') {
  const raw = String(bodyText ?? '').trim();
  if (!raw) return { detail: '', code: '', type: '', isHtml: false };
  const isHtml = /^<!doctype html|^<html[\s>]/iu.test(raw);
  try {
    const parsed = JSON.parse(raw);
    const detail = parsed?.error?.message || parsed?.message || parsed?.detail || (typeof parsed?.error === 'string' ? parsed.error : '');
    const code = String(parsed?.error?.code || parsed?.code || parsed?.error?.status || '');
    const type = String(parsed?.error?.type || parsed?.type || '');
    return {
      detail: redactAiSecret(String(detail || '').trim(), apiKey),
      code,
      type,
      isHtml: false,
    };
  } catch {
    return { detail: '', code: '', type: '', isHtml };
  }
}

function classifyAiHttpError({ status, bodyText = '', action = 'chat', protocol = 'openai', apiKey = '', model = '' } = {}) {
  const { detail, code, type, isHtml } = wdKaiExtractErrorDetail(bodyText, apiKey);
  const combined = `${detail} ${code} ${type}`.toLowerCase();
  const shortDetail = detail ? detail.slice(0, 100) : '';
  const suffix = shortDetail ? `：${shortDetail}` : '';

  const looksLikeInvalidKey = /api[_ ]?key[_ ]?(?:not[_ ]?valid|invalid|expired|missing)|incorrect api key|invalid[_ ]?api[_ ]?key|invalid[_ ]?x-api-key|authentication|unauthenticated|令牌已过期|令牌无效|鉴权失败|密钥无效/iu.test(combined);
  const looksLikeModelNotFound = /model[_ ]?not[_ ]?found|unknown model|invalid model|unsupported model|does not exist|not_found_error|is not found for api version|模型不存在|无权访问.*模型|not found/iu.test(combined);
  const looksLikeRateLimit = /rate[_ ]?limit|too many requests|quota|insufficient[_ ]?quota|credit|balance|余额不足|额度/iu.test(combined);

  if (status === 401 || (status === 400 && looksLikeInvalidKey)) {
    return {
      category: 'invalid_key',
      label: 'Key 无效',
      statusCode: status,
      message: `API Key 无效或已过期（HTTP ${status}${suffix}）`,
      hint: '请检查 API Key 是否复制完整、未包含多余空格，且与当前选择的服务商匹配。',
    };
  }
  if (status === 403) {
    return {
      category: 'invalid_key',
      label: action === 'fetch-models' ? '无权限' : 'Key 无效',
      statusCode: status,
      message: `API Key 无权限或访问被拒（HTTP 403${suffix}）`,
      hint: '可能是当前 Key 缺少权限、账号未开通该接口或所在地区受限；如为海外服务商，请尝试开启代理或使用中转 Base URL。',
    };
  }
  if (status === 402 || status === 429 || (status === 400 && looksLikeRateLimit)) {
    const isQuota = status === 402 || /quota|balance|credit|余额|额度/iu.test(combined);
    return {
      category: 'rate_limited',
      label: '限流',
      statusCode: status,
      message: isQuota
        ? `账户余额不足或额度已耗尽（HTTP ${status}${suffix}）`
        : `请求过于频繁或触发限流（HTTP ${status}${suffix}）`,
      hint: isQuota ? '请检查服务商控制台余额与配额后再试。' : '触发服务商频率限制，请稍等片刻后重试或切换模型。',
    };
  }
  if (status === 404) {
    if (action === 'fetch-models') {
      return {
        category: 'endpoint_not_found',
        label: '路径不对',
        statusCode: status,
        message: `模型列表接口不存在（HTTP 404${suffix}）`,
        hint: '请检查 Base URL 是否缺少或多余路径（如 /v1）；部分中转未开放 /models 接口，可直接手动填写模型名。',
      };
    }
    if (model && !isHtml && (looksLikeModelNotFound || protocol === 'gemini' || protocol === 'anthropic' || !detail)) {
      return {
        category: 'model_not_found',
        label: '模型不存在',
        statusCode: status,
        message: `模型「${model}」不存在或不可用（HTTP 404${suffix}）`,
        hint: '请点击「获取模型」重新选取可用模型；若确定模型名无误，请检查 Base URL 路径是否正确。',
      };
    }
    return {
      category: 'model_not_found',
      label: '模型或路径不存在',
      statusCode: status,
      message: `接口地址或模型不存在（HTTP 404${suffix}），请检查 Base URL 与模型名`,
      hint: '请核对 Base URL 路径与模型名称，或点击「获取模型」重新选取。',
    };
  }
  if (status === 400 && action !== 'fetch-models' && looksLikeModelNotFound) {
    return {
      category: 'model_not_found',
      label: '模型不存在',
      statusCode: status,
      message: `模型「${model || '当前所选'}」不存在或不受支持（HTTP 400${suffix}）`,
      hint: '请点击「获取模型」重新选取支持对话的模型，或核对模型 ID 拼写。',
    };
  }
  if (status >= 500) {
    return {
      category: 'server_error',
      label: '服务异常',
      statusCode: status,
      message: `服务商暂时异常（HTTP ${status}${suffix}）`,
      hint: '服务商端返回 5xx 错误，请稍后重试。',
    };
  }
  return {
    category: 'bad_request',
    label: '请求失败',
    statusCode: status,
    message: `接口返回错误（HTTP ${status}${suffix}）`,
    hint: '请检查所选服务商协议、Base URL 与模型配置是否一致。',
  };
}

function classifyAiNetworkError(err, { transport = 'auto', hadGm = false } = {}) {
  const msg = redactAiSecret(err?.message || String(err || '网络请求失败'));
  if (err?.wdAborted || /已取消|已中止/u.test(msg)) {
    return {
      category: 'aborted',
      label: '已取消',
      aborted: true,
      message: '已取消请求',
      hint: '',
    };
  }
  if (err?.wdTimeout || /超时/u.test(msg)) {
    return {
      category: 'network_error',
      label: '网络不通',
      isTimeout: true,
      message: msg,
      hint: '请求超时，服务商响应过慢或当前网络无法直连（如海外官方接口），建议开启代理或填写可直连的中转 Base URL。',
    };
  }
  const channel = err?.wdChannel || (transport === 'fetch' || !hadGm ? 'fetch' : 'gm');
  if (channel === 'fetch') {
    return {
      category: 'network_error',
      label: '网络不通',
      isCorsLikely: true,
      message: '网络请求失败，可能被浏览器 CORS 跨域策略或宿主页面 CSP 拦截',
      hint: '当前走了页面 fetch 通道：若服务商未放行跨域 CORS 或页面存在 CSP 限制会被浏览器拦截。请切换为「自动 / GM_xmlhttpRequest」通道，或改填支持 CORS 的中转 Base URL。',
    };
  }
  return {
    category: 'network_error',
    label: '网络不通',
    isCorsLikely: true,
    message: `网络不通或请求被拦截（${msg}）`,
    hint: '可能是网络不可达、代理未通、被 CORS/CSP 限制，或 Tampermonkey 尚未放行该域名（首次访问新域名请在油猴弹窗点击「允许」）；也可改填可直连的中转 Base URL。',
  };
}

function wdKaiMapHttpError(status, bodyText, extra = {}) {
  return classifyAiHttpError({ status, bodyText, ...extra }).message;
}

function wdKaiGmRequest(gmRequest, { url, method = 'GET', headers = {}, body = null, timeoutMs = 45000, signal, anonymous = true }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('用户已取消请求');
      e.wdAborted = true;
      e.wdChannel = 'gm';
      reject(e);
      return;
    }
    let settled = false;
    let handle = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      try { handle?.abort?.(); } catch { /* ignore */ }
      const e = new Error('用户已取消请求');
      e.wdAborted = true;
      e.wdChannel = 'gm';
      finish(reject, e);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      handle = gmRequest({
        method,
        url,
        headers,
        data: body ?? undefined,
        timeout: timeoutMs,
        anonymous,
        onload: res => finish(resolve, { status: Number(res?.status || 0), text: String(res?.responseText ?? ''), channel: 'gm' }),
        onerror: err => {
          const e = new Error(`GM_xmlhttpRequest 网络错误${err?.error ? `（${err.error}）` : ''}`);
          e.wdNetwork = true;
          e.wdChannel = 'gm';
          finish(reject, e);
        },
        ontimeout: () => {
          const e = new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`);
          e.wdTimeout = true;
          e.wdNetwork = true;
          e.wdChannel = 'gm';
          finish(reject, e);
        },
        onabort: () => {
          const e = new Error('请求已中止');
          e.wdAborted = true;
          e.wdChannel = 'gm';
          finish(reject, e);
        },
      });
    } catch (err) {
      const e = new Error(`GM_xmlhttpRequest 调用失败：${err?.message || err}`);
      e.wdNetwork = true;
      e.wdChannel = 'gm';
      finish(reject, e);
    }
  });
}

async function wdKaiFetchRequest(fetchFn, { url, method = 'GET', headers = {}, body = null, timeoutMs = 45000, signal, credentials = 'omit' }) {
  if (typeof fetchFn !== 'function') {
    const e = new Error('当前环境不支持页面 fetch');
    e.wdNetwork = true;
    e.wdChannel = 'fetch';
    throw e;
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  const onParentAbort = () => controller?.abort();
  signal?.addEventListener?.('abort', onParentAbort, { once: true });
  const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      method,
      headers,
      body: body ?? undefined,
      credentials,
      signal: controller?.signal || signal,
    });
    const text = await res.text();
    return { status: res.status, text, channel: 'fetch' };
  } catch (err) {
    if (timedOut) {
      const e = new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`);
      e.wdTimeout = true;
      e.wdNetwork = true;
      e.wdChannel = 'fetch';
      throw e;
    }
    if (signal?.aborted) {
      const e = new Error('用户已取消请求');
      e.wdAborted = true;
      e.wdChannel = 'fetch';
      throw e;
    }
    const e = new Error(`页面 fetch 失败（可能是 CORS 拦截或网络不可达）：${err?.message || err}`);
    e.wdNetwork = true;
    e.wdChannel = 'fetch';
    throw e;
  } finally {
    if (timer !== null) clearTimeout(timer);
    signal?.removeEventListener?.('abort', onParentAbort);
  }
}

async function sendAiHttpRequest(options) {
  const { transport = 'auto', gmRequest, fetchFn, url, method = 'POST', headers = {}, body = null, timeoutMs = 45000, signal } = options;
  const hasGm = typeof gmRequest === 'function';
  const hasFetch = typeof fetchFn === 'function';
  if (transport === 'gm') {
    if (!hasGm) {
      const e = new Error('当前环境未提供 GM_xmlhttpRequest，请在设置中切换为「自动」或「页面 fetch」');
      e.wdNetwork = true;
      e.wdChannel = 'gm';
      throw e;
    }
    return wdKaiGmRequest(gmRequest, { url, method, headers, body, timeoutMs, signal, anonymous: true });
  }
  if (transport === 'fetch') {
    return wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
  }
  if (hasGm) {
    try {
      return await wdKaiGmRequest(gmRequest, { url, method, headers, body, timeoutMs, signal, anonymous: true });
    } catch (gmErr) {
      if (signal?.aborted || gmErr?.wdAborted || !hasFetch) throw gmErr;
      try {
        return await wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
      } catch {
        throw gmErr;
      }
    }
  }
  return wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
}

function buildAiAuthHeaders(settings = {}, protocol = 'openai', { includeContentType = true } = {}) {
  const headers = {};
  if (includeContentType) headers['Content-Type'] = 'application/json';
  const apiKey = String(settings?.apiKey ?? '').trim();
  if (protocol === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = wdKaiAnthropicVersion;
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return headers;
  }
  if (protocol === 'gemini') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
    return headers;
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function wdKaiBuildChatRequestPayload(protocol, { model, messages, temperature = 0.2, maxTokens = null, useMaxCompletionTokens = false }) {
  const list = Array.isArray(messages) ? messages : [];
  if (protocol === 'anthropic') {
    const systemParts = [];
    const conv = [];
    for (const m of list) {
      if (!m || !m.content) continue;
      if (m.role === 'system') systemParts.push(String(m.content));
      else conv.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) });
    }
    if (!conv.length) conv.push({ role: 'user', content: 'hi' });
    const payload = {
      model,
      max_tokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
      messages: conv,
    };
    if (systemParts.length) payload.system = systemParts.join('\n\n');
    if (typeof temperature === 'number' && Number.isFinite(temperature)) payload.temperature = temperature;
    return payload;
  }
  if (protocol === 'gemini') {
    const systemParts = [];
    const contents = [];
    for (const m of list) {
      if (!m || !m.content) continue;
      if (m.role === 'system') systemParts.push(String(m.content));
      else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content) }],
        });
      }
    }
    if (!contents.length) contents.push({ role: 'user', parts: [{ text: 'hi' }] });
    const generationConfig = {};
    if (typeof temperature === 'number' && Number.isFinite(temperature)) generationConfig.temperature = temperature;
    if (Number.isInteger(maxTokens) && maxTokens > 0) generationConfig.maxOutputTokens = maxTokens;
    const payload = { contents };
    if (systemParts.length) payload.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
    if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;
    return payload;
  }
  const payload = { model, messages: list };
  if (typeof temperature === 'number' && Number.isFinite(temperature)) payload.temperature = temperature;
  if (Number.isInteger(maxTokens) && maxTokens > 0) {
    if (useMaxCompletionTokens) payload.max_completion_tokens = maxTokens;
    else payload.max_tokens = maxTokens;
  }
  return payload;
}

function wdKaiExtractChatContent(envelope, protocol = 'openai', { allowEmptyText = false } = {}) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('接口响应体不是合法 JSON 对象');
  }
  if (protocol === 'anthropic') {
    const blocks = Array.isArray(envelope.content) ? envelope.content : null;
    if (!blocks) throw new Error('接口响应缺少 content 字段（请确认 Base URL 为 Anthropic 兼容端点）');
    const text = blocks
      .filter(b => b && (b.type === 'text' || typeof b.text === 'string'))
      .map(b => String(b.text || ''))
      .join('')
      .trim();
    if (!text && !allowEmptyText && !blocks.length) throw new Error('模型未返回有效文本内容');
    return text;
  }
  if (protocol === 'gemini') {
    const candidates = Array.isArray(envelope.candidates) ? envelope.candidates : null;
    if (!candidates || !candidates.length) throw new Error('接口响应缺少 candidates 字段（请确认 Base URL 为 Gemini 原生端点）');
    const parts = Array.isArray(candidates[0]?.content?.parts) ? candidates[0].content.parts : [];
    const text = parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
    if (!text && !allowEmptyText) throw new Error('模型未返回有效文本内容');
    return text;
  }
  const msgContent = envelope?.choices?.[0]?.message?.content;
  let text = '';
  if (typeof msgContent === 'string') {
    text = msgContent.trim();
  } else if (Array.isArray(msgContent)) {
    text = msgContent.map(part => (typeof part === 'string' ? part : String(part?.text || ''))).join('').trim();
  } else if (allowEmptyText && Array.isArray(envelope?.choices) && envelope.choices.length > 0) {
    text = '';
  } else {
    throw new Error('接口响应缺少 choices[0].message.content');
  }
  if (!text && !allowEmptyText) {
    throw new Error('接口响应缺少 choices[0].message.content');
  }
  return text;
}

async function invokeAiChat({
  settings,
  messages,
  temperature = 0.2,
  maxTokens = null,
  gmRequest,
  fetchFn,
  signal,
  timeoutMs = 45000,
  allowEmptyText = false,
  action = 'chat',
} = {}) {
  const protocol = resolveAiProtocol(settings);
  const model = String(settings?.model || '').trim();
  if (!model) throw new Error('未填写模型名');
  const endpoint = buildChatEndpointUrl(settings?.baseUrl, protocol, model);
  const headers = buildAiAuthHeaders(settings, protocol, { includeContentType: true });
  const payload = JSON.stringify(wdKaiBuildChatRequestPayload(protocol, { model, messages, temperature, maxTokens }));
  const res = await sendAiHttpRequest({
    transport: settings?.transport || 'auto',
    gmRequest,
    fetchFn,
    url: endpoint,
    method: 'POST',
    headers,
    body: payload,
    timeoutMs,
    signal,
  });
  if (res.status < 200 || res.status >= 300) {
    const classified = classifyAiHttpError({
      status: res.status,
      bodyText: res.text,
      action,
      protocol,
      apiKey: settings?.apiKey || '',
      model,
    });
    const err = new Error(classified.message);
    err.wdClassified = classified;
    err.status = res.status;
    err.wdChannel = res.channel;
    throw err;
  }
  let envelope;
  try {
    envelope = JSON.parse(res.text);
  } catch {
    const err = new Error('接口响应体不是合法 JSON（请检查 Base URL 是否指向兼容对话端点）');
    err.wdCategory = 'invalid_response';
    err.wdChannel = res.channel;
    throw err;
  }
  const content = wdKaiExtractChatContent(envelope, protocol, { allowEmptyText });
  return { content, channel: res.channel, protocol, endpoint, status: res.status };
}

const wdKaiNonChatModelRe = /(?:^|[/:-])(embedding|embed|text-embedding|bge-|rerank|whisper|tts|speech|audio|dall-e|imagen|flux|stable-diffusion|midjourney|moderation|omni-moderation|realtime|transcribe|sora|veo)(?:$|[/:-])/iu;

function parseModelsListResponse(text, protocol = 'openai', providerId = '') {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('模型列表响应不是合法 JSON（请检查 Base URL 或网关是否返回了网页）');
  }
  let rawItems = [];
  if (protocol === 'gemini' && Array.isArray(parsed?.models)) {
    const hasMethodInfo = parsed.models.some(m => Array.isArray(m?.supportedGenerationMethods));
    rawItems = parsed.models
      .filter(m => !hasMethodInfo || !Array.isArray(m?.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent'))
      .map(m => {
        const rawName = String(m?.name || m?.id || '').trim();
        const id = rawName.replace(/^models\//iu, '');
        const label = String(m?.displayName || '').trim();
        return {
          id,
          label: label && label !== id ? label : '',
          ownedBy: 'google',
          created: 0,
        };
      });
  } else if (protocol === 'anthropic' && Array.isArray(parsed?.data)) {
    rawItems = parsed.data.map(m => {
      const id = String(m?.id || '').trim();
      const label = String(m?.display_name || m?.name || '').trim();
      const created = m?.created_at ? Date.parse(m.created_at) || 0 : 0;
      return {
        id,
        label: label && label !== id ? label : '',
        ownedBy: 'anthropic',
        created,
      };
    });
  } else {
    const list = Array.isArray(parsed?.data) ? parsed.data
      : Array.isArray(parsed?.models) ? parsed.models
      : Array.isArray(parsed) ? parsed : null;
    if (!list) {
      throw new Error('模型列表响应缺少 data/models 数组（该接口可能不符合标准模型列表格式）');
    }
    rawItems = list.map(m => {
      if (typeof m === 'string') return { id: m.trim(), label: '', ownedBy: '', created: 0 };
      const id = String(m?.id || m?.name || m?.model || '').trim().replace(/^models\//iu, '');
      const label = String(m?.display_name || m?.displayName || (m?.name && m.name !== id ? m.name : '') || '').trim();
      return {
        id,
        label: label && label !== id ? label : '',
        ownedBy: String(m?.owned_by || m?.provider || '').trim(),
        created: Number(m?.created) || 0,
      };
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const item of rawItems) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push({
      ...item,
      nonChat: wdKaiNonChatModelRe.test(item.id),
    });
  }
  const presetDefaultModel = WD_AI_PROVIDERS.find(p => p.id === providerId)?.model || '';
  deduped.sort((a, b) => {
    if (a.id === presetDefaultModel && b.id !== presetDefaultModel) return -1;
    if (b.id === presetDefaultModel && a.id !== presetDefaultModel) return 1;
    if (a.nonChat !== b.nonChat) return a.nonChat ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
  return deduped;
}

async function fetchAiModels(settings = {}, options = {}) {
  const startedAt = Date.now();
  const providerId = String(settings?.provider || wdKaiDefaultConfig.provider);
  const preset = WD_AI_PROVIDERS.find(p => p.id === providerId) || getAiProviderPreset(providerId);
  const protocol = resolveAiProtocol(settings);
  const apiKey = String(settings?.apiKey ?? '').trim();
  const transport = ['auto', 'gm', 'fetch'].includes(settings?.transport) ? settings.transport : 'auto';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;

  if (!String(settings?.baseUrl ?? '').trim()) {
    return {
      ok: false,
      models: [],
      category: 'config_error',
      label: '配置不完整',
      message: '请先填写 Base URL 再获取模型列表',
      hint: '选择预置服务商会自动填充 Base URL；自定义模式请填写完整 https:// 接口地址。',
      latencyMs: 0,
    };
  }
  let endpoint;
  try {
    endpoint = buildModelsUrl(settings.baseUrl, protocol);
  } catch (err) {
    return {
      ok: false,
      models: [],
      category: 'config_error',
      label: '地址非法',
      message: err?.message || 'Base URL 格式非法',
      hint: '请以 https:// 开头（本机回环支持 http://127.0.0.1 或 localhost）。',
      latencyMs: 0,
    };
  }
  if (preset?.requiresApiKey && !apiKey) {
    return {
      ok: false,
      models: [],
      category: 'config_error',
      label: '缺少 Key',
      message: '请先输入 API Key 再点击「获取模型」',
      hint: '密钥仅保存在本地隔离存储，不经过第三方服务器。',
      latencyMs: 0,
    };
  }

  const headers = buildAiAuthHeaders({ ...settings, apiKey }, protocol, { includeContentType: false });
  try {
    const res = await sendAiHttpRequest({
      transport,
      gmRequest: options.gmRequest,
      fetchFn: options.fetchFn,
      url: endpoint,
      method: 'GET',
      headers,
      body: null,
      timeoutMs,
      signal: options.signal,
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (res.status < 200 || res.status >= 300) {
      const classified = classifyAiHttpError({
        status: res.status,
        bodyText: res.text,
        action: 'fetch-models',
        protocol,
        apiKey,
      });
      return {
        ok: false,
        models: [],
        ...classified,
        latencyMs,
        channel: res.channel,
        endpoint,
        protocol,
      };
    }
    const models = parseModelsListResponse(res.text, protocol, providerId);
    if (!models.length) {
      return {
        ok: false,
        models: [],
        category: 'empty_models',
        label: '无可用模型',
        statusCode: res.status,
        message: '接口返回成功，但模型列表为空',
        hint: '该 Key 可能暂未分配可用模型，或可尝试直接手动填写模型名。',
        latencyMs,
        channel: res.channel,
        endpoint,
        protocol,
      };
    }
    return {
      ok: true,
      models,
      total: models.length,
      latencyMs,
      channel: res.channel,
      endpoint,
      protocol,
      publicModelList: Boolean(preset?.publicModelList),
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const classified = classifyAiNetworkError(err, {
      transport,
      hadGm: typeof options.gmRequest === 'function',
    });
    return {
      ok: false,
      models: [],
      ...classified,
      latencyMs,
      endpoint,
      protocol,
    };
  }
}

async function testAiConnection(settings = {}, options = {}) {
  const startedAt = Date.now();
  const providerId = String(settings?.provider || wdKaiDefaultConfig.provider);
  const preset = WD_AI_PROVIDERS.find(p => p.id === providerId) || getAiProviderPreset(providerId);
  const protocol = resolveAiProtocol(settings);
  const apiKey = String(settings?.apiKey ?? '').trim();
  const model = String(settings?.model ?? '').trim();
  const transport = ['auto', 'gm', 'fetch'].includes(settings?.transport) ? settings.transport : 'auto';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000;

  if (!String(settings?.baseUrl ?? '').trim()) {
    return {
      ok: false,
      category: 'config_error',
      statusLabel: '配置不完整',
      badgeStatus: 'error',
      testedScope: model ? 'model' : 'endpoint',
      model,
      latencyMs: 0,
      message: '请先填写 Base URL',
      hint: '选择预置服务商会自动填入默认地址；自定义档必须填写 Base URL。',
    };
  }
  try {
    normalizeAiBaseUrl(settings.baseUrl);
  } catch (err) {
    return {
      ok: false,
      category: 'config_error',
      statusLabel: '地址非法',
      badgeStatus: 'error',
      testedScope: model ? 'model' : 'endpoint',
      model,
      latencyMs: 0,
      message: err?.message || 'Base URL 格式非法',
      hint: '请检查地址协议（仅支持 https:// 或本机回环）。',
    };
  }
  if (preset?.requiresApiKey && !apiKey) {
    return {
      ok: false,
      category: 'invalid_key',
      statusLabel: 'Key 未填写',
      badgeStatus: 'unconfigured',
      testedScope: model ? 'model' : 'endpoint',
      model,
      latencyMs: 0,
      message: '请先输入 API Key 后再测试连接',
      hint: '留空将保持零 AI 档（仅使用本地字幕规则摘要）。',
    };
  }

  // Degraded mode when no model is chosen yet: test endpoint + key connectivity via /models
  if (!model) {
    const listRes = await fetchAiModels({ ...settings, apiKey, transport }, { ...options, timeoutMs });
    if (listRes.aborted) {
      return {
        ok: false,
        aborted: true,
        category: 'aborted',
        statusLabel: '已取消',
        badgeStatus: 'idle',
        testedScope: 'endpoint',
        model: '',
        latencyMs: listRes.latencyMs,
        message: '已取消连接测试',
        hint: '',
      };
    }
    if (listRes.ok) {
      const testedWhat = preset?.publicModelList
        ? `已测：接口连通性与模型列表（获取到 ${listRes.models.length} 个模型；注意该服务商 /models 公开，未校验 Key 鉴权）`
        : `已测：接口连通性与 API Key 鉴权（获取到 ${listRes.models.length} 个模型）`;
      const notTestedWhat = '未测：尚未选择模型，未发起对话推理，无法确认具体模型权限与账户余额';
      return {
        ok: true,
        degradedScope: true,
        category: 'ok',
        statusLabel: '端点可用（未测模型）',
        badgeStatus: 'ok',
        testedScope: 'endpoint',
        model: '',
        modelCount: listRes.models.length,
        models: listRes.models,
        latencyMs: listRes.latencyMs,
        channel: listRes.channel,
        protocol: listRes.protocol,
        testedWhat,
        notTestedWhat,
        message: `端点连通（未选模型） · ${listRes.latencyMs}ms`,
        hint: '建议从上方下拉选择一个模型后再次点击「测试连接」，完成端到端推理校验。',
      };
    }
    const categoryMap = {
      invalid_key: { category: 'invalid_key', statusLabel: 'Key 无效' },
      rate_limited: { category: 'rate_limited', statusLabel: '限流' },
      network_error: { category: 'network_error', statusLabel: '网络不通' },
      endpoint_not_found: { category: 'network_error', statusLabel: '端点不可达' },
    };
    const mapped = categoryMap[listRes.category] || { category: listRes.category || 'other_error', statusLabel: listRes.label || '不可用' };
    return {
      ok: false,
      category: mapped.category,
      statusLabel: mapped.statusLabel,
      badgeStatus: 'error',
      testedScope: 'endpoint',
      model: '',
      statusCode: listRes.statusCode || null,
      latencyMs: listRes.latencyMs,
      channel: listRes.channel || null,
      protocol: listRes.protocol || protocol,
      testedWhat: '尝试探测模型列表端点与 Key 鉴权（尚未选择具体模型）',
      notTestedWhat: '未测试具体模型推理',
      message: listRes.message,
      hint: listRes.hint || '',
    };
  }

  // Full minimal real chat request (1-token scale) with the selected model
  const attemptTest = async (useFallbackMaxCompletion = false) => {
    const endpoint = buildChatEndpointUrl(settings.baseUrl, protocol, model);
    const headers = buildAiAuthHeaders({ ...settings, apiKey }, protocol, { includeContentType: true });
    const payloadObj = wdKaiBuildChatRequestPayload(protocol, {
      model,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: useFallbackMaxCompletion ? null : 0,
      maxTokens: useFallbackMaxCompletion ? 16 : 1,
      useMaxCompletionTokens: useFallbackMaxCompletion,
    });
    const res = await sendAiHttpRequest({
      transport,
      gmRequest: options.gmRequest,
      fetchFn: options.fetchFn,
      url: endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify(payloadObj),
      timeoutMs,
      signal: options.signal,
    });
    return { res, endpoint };
  };

  try {
    let { res, endpoint } = await attemptTest(false);
    // Compatibility fallback for reasoning models (e.g. o1/o3/gpt-5) rejecting max_tokens or temperature=0
    if (protocol === 'openai' && res.status === 400 && /max_tokens|max_completion_tokens|temperature/iu.test(res.text)) {
      const retry = await attemptTest(true);
      res = retry.res;
      endpoint = retry.endpoint;
    }
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (res.status < 200 || res.status >= 300) {
      const classified = classifyAiHttpError({
        status: res.status,
        bodyText: res.text,
        action: 'test-model',
        protocol,
        apiKey,
        model,
      });
      const statusLabel = classified.category === 'invalid_key' ? 'Key 无效'
        : classified.category === 'model_not_found' ? '模型不存在'
        : classified.category === 'rate_limited' ? '限流'
        : classified.label || '不可用';
      return {
        ok: false,
        category: classified.category,
        statusLabel,
        badgeStatus: 'error',
        testedScope: 'model',
        model,
        statusCode: res.status,
        latencyMs,
        channel: res.channel,
        protocol,
        endpoint,
        message: classified.message,
        hint: classified.hint,
      };
    }
    try {
      const envelope = JSON.parse(res.text);
      wdKaiExtractChatContent(envelope, protocol, { allowEmptyText: true });
    } catch (parseErr) {
      return {
        ok: false,
        category: 'invalid_response',
        statusLabel: '响应异常',
        badgeStatus: 'error',
        testedScope: 'model',
        model,
        statusCode: res.status,
        latencyMs,
        channel: res.channel,
        protocol,
        endpoint,
        message: parseErr?.message || '接口返回了无法识别的响应格式',
        hint: '请检查 Base URL 与所选服务商协议是否匹配。',
      };
    }
    return {
      ok: true,
      category: 'ok',
      statusLabel: '可用',
      badgeStatus: 'ok',
      testedScope: 'model',
      model,
      statusCode: res.status,
      latencyMs,
      channel: res.channel,
      protocol,
      endpoint,
      testedWhat: `已使用模型 ${model} 完成最小对话请求（1 token 量级），验证了端点、Key 鉴权与模型推理可用`,
      notTestedWhat: '未验证长上下文响应与结构化 JSON 稳定度',
      message: `可用 · ${model} · ${latencyMs}ms`,
      hint: '',
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const classified = classifyAiNetworkError(err, {
      transport,
      hadGm: typeof options.gmRequest === 'function',
    });
    if (classified.aborted) {
      return {
        ok: false,
        aborted: true,
        category: 'aborted',
        statusLabel: '已取消',
        badgeStatus: 'idle',
        testedScope: 'model',
        model,
        latencyMs,
        message: '已取消连接测试',
        hint: '',
      };
    }
    return {
      ok: false,
      category: 'network_error',
      statusLabel: '网络不通',
      badgeStatus: 'error',
      testedScope: 'model',
      model,
      latencyMs,
      protocol,
      message: classified.message,
      hint: classified.hint,
    };
  }
}

function buildSectionPrompt(courseTitle, section, segments, chunkInfo = null) {
  const isChunk = Boolean(chunkInfo && chunkInfo.total > 1);
  const chunkHint = isChunk ? `（第 ${chunkInfo.index}/${chunkInfo.total} 分段）` : '';
  const safeSegments = (Array.isArray(segments) ? segments : []).map((seg, idx) => ({
    ...seg,
    segId: seg?.segId || `S${String(seg?.index || idx + 1).padStart(2, '0')}`,
  }));
  const transcript = safeSegments.map(seg => `[${seg.segId}] ${seg.text}`).join('\n');
  const system = [
    '你是资深企业课程学习教练。请根据带分段编号 [S01]、[S02]… 的课程字幕，产出一份让学员「花 2 分钟就能看懂、且每条结论均可对照原字幕核验」的结构化学习卡片。',
    '只输出合法 JSON，不要任何前言、解释或额外文字。',
    'JSON Schema：',
    '{"summary":"1~2句完整陈述句，讲清本节针对什么问题与核心结论(20~80字，禁止省略号、禁止复述课节标题)","keyPoints":[{"text":"一句完整、包含主谓宾的自足陈述句(8~40字，禁止省略号结尾、禁止复制字幕原话片段、禁止把课节标题当内容)","segId":"S01","quote":"对应原字幕关键词或短句(6~24字)"}],"outline":[{"name":"二级主题短语(<=16字，完整无省略号，收敛为2~5组)","points":[{"text":"完整知识点陈述(8~36字，无省略号)","segId":"S01","quote":"对应原字幕短句"}]}],"quiz":[{"question":"基于核心要点的完整自测问题？","answer":"1~2句完整简洁参考答案","segId":"S01","quote":"对应原字幕短句"}],"glossary":[{"term":"专有名词/缩写","definition":"一句完整的白话解释(12~55字，禁止以「课程提及：」开头，禁止省略号)","isCore":true,"importance":"本课重点","segId":"S01","quote":"对应原字幕短句"}]}',
    '约束：',
    isChunk
      ? '1. 当前为长课节的子分段：summary 用 1~2 句完整句概括本段核心结论；keyPoints 给 2~3 条（宁少不凑）；outline 给 1~3 组主题；quiz 给 1~2 题；glossary 抽取本段专有名词（无则空数组）；'
      : '1. keyPoints 严格 3~6 条（宁少不凑），每条必须是「一句完整、包含主谓宾的自足陈述句，8–40 字」，严禁以省略号（… / ...）结尾、严禁复制字幕口语原话片段、严禁把课节标题当内容；outline 收敛为 2~5 个二级主题，每组 2~6 条完整知识点；quiz 给 3~5 个检验是否学会的问题；glossary 抽取 0~6 个关键专有名词；',
    '2. glossary 每条释义必须为「一句完整的白话解释」，并用 isCore（布尔）与 importance（"本课重点" 或 "拓展提及"）明确标注是否属于本课重点；严禁使用「课程提及：」「课程提到：」等前缀，严禁出现省略号截断；',
    '3. 所有出处只能引用输入字幕中给出的分段编号 segId（例如 "S01"、"S02"），严禁自行估算或编造时间戳，严禁编造不存在的编号，并附带该段对应的原话关键词短句 quote（供程序自动核验，不得杜撰）；',
    '4. 严格忠于字幕原文，禁止编造原文未提及的概念或结论；禁止出现「其他/杂项」。',
  ].join('\n');
  const user = `课程：《${courseTitle || '当前课程'}》\n课节：第 ${section.sectionIndex || 1} 节《${section.title || '当前课节'}》${chunkHint}\n\n带编号字幕分段：\n${transcript}`;
  return { system, user };
}

function buildSectionChunkAggregationPrompt(courseTitle, section, chunkPayloads) {
  const formatRef = p => (p?.segId ? `[${p.segId}]` : (p?.timestamp ? `(${p.timestamp})` : ''));
  const digest = chunkPayloads.map((c, idx) => {
    const pts = (c.keyPoints || []).map(p => `${p.text}${formatRef(p)}`).join('；');
    const topics = (c.outline || []).map(t => `${t.name}: ${(t.points || []).map(p => `${p.text}${formatRef(p)}`).join('、')}`).join(' | ');
    return `分段${idx + 1} 摘要：${c.summary || ''}\n  要点：${pts}\n  主题：${topics}`;
  }).join('\n');
  const system = [
    '你是课程学习卡片聚合助手。下面是一节较长课程各个分段的初步提炼结果，请合并重复知识点并收敛为一份完整、易速览的单节学习 JSON（不要任何额外说明）。',
    'JSON Schema：{"summary":"整节1~2句完整核心结论(20~80字，禁止省略号与标题复述)","keyPoints":[{"text":"一句完整、包含主谓宾的自足陈述句(8~40字，禁止省略号/原话片段/标题复述)","segId":"S01","quote":"对应原话短句"}],"outline":[{"name":"二级主题(<=16字，完整无省略号，收敛为3~5组)","points":[{"text":"完整知识点陈述(8~36字，无省略号)","segId":"S01","quote":"对应原话短句"}]}],"quiz":[{"question":"完整自测问题？","answer":"完整简洁参考答案","segId":"S01","quote":"对应原话短句"}],"glossary":[{"term":"术语","definition":"一句完整白话解释(禁止「课程提及：」前缀与省略号)","isCore":true,"importance":"本课重点","segId":"S01","quote":"对应原话短句"}]}',
    '要求：keyPoints 严格 3~6 条（宁少不凑），合并同类要点；quiz 收敛为 3~5 题；glossary 标注 isCore 与 importance（"本课重点" 或 "拓展提及"）；所有出处只引用输入中已有的分段编号 segId（如 "S01"），严禁编造编号或时间戳；所有字段严禁以省略号结尾。',
  ].join('\n');
  return { system, user: `课程：《${courseTitle}》\n课节：《${section.title}》\n\n各分段结果：\n${digest}` };
}

function buildCourseAggregationPrompt(courseTitle, sectionTrees) {
  const formatRef = p => (p?.segId ? `[${p.segId}]` : (p?.timestamp ? `(${p.timestamp})` : ''));
  const digest = sectionTrees.map(sec => {
    const kps = (sec.keyPoints || []).slice(0, 4).map(p => `${p.text}${formatRef(p)}`).join('；');
    const lines = (sec.outline || sec.topics || []).map(t => `  - ${t.name}: ${(t.points || []).map(p => `${p.text}${formatRef(p)}`).join('；')}`);
    return `课节ID=${sec.sectionId} 《${sec.title}》\n  一句话概览：${sec.summary || ''}\n  核心要点：${kps}\n${lines.join('\n')}`;
  }).join('\n');
  const system = [
    '你是课程知识体系聚合助手。下面是一门课各课节的提炼结果，请输出整门课级总览与去重后的知识地图 JSON（只输出 JSON）。',
    'JSON 格式：{"overview":"1~2句完整陈述句讲清整门课核心问题与关键结论(25~90字，禁止罗列课节标题充数，禁止省略号)","keyPoints":[{"text":"一句完整、包含主谓宾的自足陈述句(8~40字，禁止省略号/原话片段/标题复述)","sectionId":"原sectionId","segId":"S01","quote":"对应原话短句"}],"sections":[{"sectionId":"原sectionId","summary":"该节完整核心结论(禁止省略号)","outline":[{"name":"二级主题(无省略号)","points":[{"text":"完整知识点陈述(无省略号)","segId":"S01","quote":"对应原话短句"}]}]}]}',
    '要求：全课 keyPoints 选 3~6 条（宁少不凑），同一知识点在不同课节重复出现时必须合并去重；所有出处只引用输入中出现的原 sectionId 与分段编号 segId（如 "S01"），严禁编造编号或时间戳；所有输出字段严禁以省略号结尾。',
  ].join('\n');
  return { system, user: `课程：《${courseTitle}》\n\n各课节摘要与要点：\n${digest}` };
}

function parseStrictJsonContent(rawContent) {
  const text = String(rawContent ?? '').replace(/^\uFEFF/u, '').trim();
  if (!text) throw new Error('模型返回内容为空');
  const candidates = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/iu.exec(text);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(text);
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
  }
  for (const raw of candidates) {
    for (const attempt of [
      raw,
      raw.replace(/,\s*([}\]])/gu, '$1'),
      raw.replace(/\/\/[^\n]*/gu, '').replace(/,\s*([}\]])/gu, '$1'),
    ]) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch { /* try next relaxed variant */ }
    }
  }
  throw new Error('模型返回的不是合法 JSON');
}

function wdKaiResolveItemCitation(rawItem, claimText, verifyOpts = {}) {
  const hasRef = Boolean(
    rawItem && typeof rawItem === 'object' && (
      rawItem.segId !== undefined && rawItem.segId !== null && rawItem.segId !== ''
      || rawItem.seg_id !== undefined && rawItem.seg_id !== null && rawItem.seg_id !== ''
      || rawItem.segmentId !== undefined && rawItem.segmentId !== null && rawItem.segmentId !== ''
      || rawItem.ref !== undefined && rawItem.ref !== null && rawItem.ref !== ''
      || rawItem.time !== undefined && rawItem.time !== null && rawItem.time !== ''
      || rawItem.timestamp !== undefined && rawItem.timestamp !== null && rawItem.timestamp !== ''
      || rawItem.seconds !== undefined && rawItem.seconds !== null && rawItem.seconds !== ''
    ),
  );
  if (!hasRef) {
    return { seconds: null, timestamp: '', segId: null, refKey: null, citationStatus: 'none', citation: null };
  }
  const segmentIndex = verifyOpts.segmentIndex || null;
  if (segmentIndex) {
    const verified = verifyCitation(rawItem, segmentIndex, {
      claimText,
      sectionId: rawItem.sectionId || verifyOpts.sectionId,
      similarityThreshold: verifyOpts.similarityThreshold,
      durationSec: verifyOpts.durationSec,
    });
    return {
      seconds: verified.verified ? verified.seconds : null,
      timestamp: verified.verified ? verified.timestamp : '',
      segId: verified.segId || null,
      refKey: verified.refKey || null,
      citationStatus: verified.status,
      citation: verified,
    };
  }
  // Standalone normalization without segment table (fallback parse only)
  const normId = normalizeSegmentId(rawItem.segId ?? rawItem.seg_id ?? rawItem.segmentId ?? rawItem.ref);
  const sec = parseTimestampToSeconds(rawItem.time ?? rawItem.timestamp ?? rawItem.seconds);
  return {
    seconds: sec === null ? null : Math.floor(sec),
    timestamp: sec === null ? '' : formatTimestamp(sec),
    segId: normId?.segId || null,
    refKey: normId ? `${rawItem.sectionId || verifyOpts.sectionId || 'current'}#${normId.segId}` : null,
    citationStatus: normId || sec !== null ? 'unverified' : 'none',
    citation: null,
  };
}

function wdKaiNormalizePoint(pt, verifyOpts = {}) {
  if (typeof pt === 'string') {
    const text = sanitizeCompleteText(pt, { maxLen: 60, allowShort: true, stripPrefixes: true });
    return text ? { text, seconds: null, timestamp: '' } : null;
  }
  if (!pt || typeof pt !== 'object') return null;
  const rawText = String(pt.text || pt.point || pt.content || pt.title || pt.summary || '').trim();
  const text = sanitizeCompleteText(rawText, { maxLen: 60, allowShort: true, stripPrefixes: true });
  if (!text) return null;
  const cite = wdKaiResolveItemCitation(pt, text, verifyOpts);
  const sectionId = pt.sectionId ? String(pt.sectionId) : (cite.citation?.sectionId && verifyOpts.segmentIndex?.isCourseIndex ? cite.citation.sectionId : undefined);
  return {
    text,
    seconds: cite.seconds,
    timestamp: cite.timestamp,
    ...(cite.segId ? { segId: cite.segId } : {}),
    ...(cite.refKey ? { refKey: cite.refKey } : {}),
    ...(cite.citationStatus !== 'none' ? { citationStatus: cite.citationStatus } : {}),
    ...(cite.citation ? { citation: cite.citation } : {}),
    ...(sectionId ? { sectionId } : {}),
  };
}

function wdKaiNormalizeOutline(rawTopics, verifyOpts = {}) {
  if (!Array.isArray(rawTopics)) return [];
  const topics = [];
  for (const item of rawTopics) {
    if (!item || typeof item !== 'object') continue;
    const rawName = String(item.name || item.title || item.topic || item.chapter || '').trim();
    const name = sanitizeCompleteText(rawName, { maxLen: 36, allowShort: true, stripPrefixes: true });
    const rawPoints = Array.isArray(item.points) ? item.points
      : Array.isArray(item.items) ? item.items
      : Array.isArray(item.children) ? item.children : [];
    const points = rawPoints.map(pt => wdKaiNormalizePoint(pt, verifyOpts)).filter(Boolean);
    if (name && points.length) topics.push({ name, points });
    else if (name) topics.push({ name, points: [{ text: name, seconds: null, timestamp: '' }] });
  }
  return topics;
}

function wdKaiNormalizeQuiz(rawQuiz, verifyOpts = {}) {
  if (!Array.isArray(rawQuiz)) return [];
  const items = [];
  for (const q of rawQuiz) {
    if (!q || typeof q !== 'object') continue;
    const question = sanitizeCompleteText(q.question || q.q || q.prompt || '', { maxLen: 120, allowShort: true, stripPrefixes: true });
    const answer = sanitizeCompleteText(q.answer || q.a || q.explanation || '', { maxLen: 220, allowShort: true, stripPrefixes: true });
    if (!question || !answer) continue;
    const cite = wdKaiResolveItemCitation(q, `${question} ${answer}`, verifyOpts);
    items.push({
      question,
      answer,
      seconds: cite.seconds,
      timestamp: cite.timestamp,
      ...(cite.segId ? { segId: cite.segId } : {}),
      ...(cite.refKey ? { refKey: cite.refKey } : {}),
      ...(cite.citationStatus !== 'none' ? { citationStatus: cite.citationStatus } : {}),
      ...(cite.citation ? { citation: cite.citation } : {}),
    });
  }
  return items.slice(0, 6);
}

function wdKaiNormalizeGlossary(rawGlossary, verifyOpts = {}) {
  if (!Array.isArray(rawGlossary)) return [];
  const seen = new Set();
  const items = [];
  for (const g of rawGlossary) {
    if (!g || typeof g !== 'object') continue;
    const term = sanitizeCompleteText(g.term || g.name || g.word || g.concept || '', { maxLen: 32, allowShort: true, stripPrefixes: true });
    const definition = sanitizeCompleteText(g.definition || g.desc || g.explain || g.meaning || '', { maxLen: 80, allowShort: true, stripPrefixes: true });
    if (!term || !definition || seen.has(term)) continue;
    seen.add(term);
    const cite = wdKaiResolveItemCitation(g, `${term} ${definition}`, verifyOpts);
    const rawImportance = String(g.importance || g.level || g.priority || '').trim();
    const explicitCore = typeof g.isCore === 'boolean' ? g.isCore
      : typeof g.is_core === 'boolean' ? g.is_core
      : typeof g.core === 'boolean' ? g.core
      : typeof g.isKey === 'boolean' ? g.isKey : null;
    const inferredCore = explicitCore !== null
      ? explicitCore
      : (rawImportance ? /重点|核心|必学|关键/u.test(rawImportance) : null);
    const importance = inferredCore === true ? '本课重点'
      : inferredCore === false ? '拓展提及'
      : (rawImportance && !/省略/u.test(rawImportance) ? rawImportance : '');
    items.push({
      term,
      definition,
      ...(inferredCore !== null ? { isCore: inferredCore } : {}),
      ...(importance ? { importance } : {}),
      seconds: cite.seconds,
      timestamp: cite.timestamp,
      ...(cite.segId ? { segId: cite.segId } : {}),
      ...(cite.refKey ? { refKey: cite.refKey } : {}),
      ...(cite.citationStatus !== 'none' ? { citationStatus: cite.citationStatus } : {}),
      ...(cite.citation ? { citation: cite.citation } : {}),
    });
  }
  return items.slice(0, 8);
}

function normalizeSectionStudyPayload(data, options = {}) {
  if (!data || typeof data !== 'object') throw new Error('模型返回结构无效');
  const sectionTitle = String(options.sectionTitle || '').replace(/^第\s*\d+\s*[章节讲课]\s*/u, '').trim();
  const isTitleCopy = txt => Boolean(sectionTitle && sectionTitle.length >= 4 && computeTextSimilarity(txt, sectionTitle) >= 0.85);
  const segmentIndex = options.segmentIndex
    || (Array.isArray(options.segments) && options.segments.length ? buildSegmentIndex(options.segments, { sectionId: options.sectionId, durationSec: options.durationSec }) : null);
  const verifyOpts = {
    segmentIndex,
    sectionId: options.sectionId || segmentIndex?.sectionId || 'current',
    similarityThreshold: options.similarityThreshold,
    durationSec: options.durationSec,
  };
  const outline = wdKaiNormalizeOutline(data.outline ?? data.topics ?? data.chapters, verifyOpts);
  const rawKeyPoints = Array.isArray(data.keyPoints) ? data.keyPoints
    : Array.isArray(data.key_points) ? data.key_points
    : Array.isArray(data.highlights) ? data.highlights
    : Array.isArray(data.takeaways) ? data.takeaways : [];
  const normalizedKps = rawKeyPoints.map(kp => wdKaiNormalizePoint(kp, verifyOpts)).filter(Boolean);
  const nonTitleKps = normalizedKps.filter(kp => !isTitleCopy(kp.text));
  const kpSource = nonTitleKps.length ? nonTitleKps : normalizedKps;
  const keyPoints = [];
  for (const kp of kpSource) {
    if (keyPoints.some(existing => computeTextSimilarity(existing.text, kp.text) >= 0.72)) continue;
    keyPoints.push(kp);
    if (keyPoints.length >= 6) break;
  }
  const quiz = wdKaiNormalizeQuiz(data.quiz ?? data.questions ?? data.qa ?? data.selfCheck, verifyOpts);
  const glossary = wdKaiNormalizeGlossary(data.glossary ?? data.terms ?? data.concepts, verifyOpts);
  let summary = sanitizeCompleteText(data.summary || data.oneLineSummary || data.overview || '', { maxLen: 120, allowShort: true, stripPrefixes: true });

  if (!outline.length && !keyPoints.length && !summary) {
    throw new Error('模型未返回有效的完整摘要、要点或大纲内容');
  }
  if (!keyPoints.length && outline.length) {
    for (const topic of outline) {
      const first = topic.points[0];
      if (first && !keyPoints.some(k => computeTextSimilarity(k.text, first.text) >= 0.72)) {
        keyPoints.push({ ...first });
      }
      if (keyPoints.length >= 5) break;
    }
  }
  if (!outline.length && keyPoints.length) {
    outline.push({ name: '核心知识点', points: keyPoints.map(k => ({ ...k })) });
  }
  if (!summary) {
    summary = keyPoints.slice(0, 2).map(k => k.text).join('；') || outline.slice(0, 2).map(t => t.name).join('、');
  }
  return { summary, keyPoints, outline, quiz, glossary };
}

function splitSegmentsIntoChunks(segments, maxChars = 12000) {
  const list = Array.isArray(segments) ? segments : [];
  if (!list.length) return [];
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const seg of list) {
    const len = (seg.text || '').length + 12;
    if (current.length && chars + len > maxChars) {
      chunks.push(current);
      current = [seg];
      chars = len;
    } else {
      current.push(seg);
      chars += len;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function wdKaiCallChatJson({ settings, messages, gmRequest, fetchFn, signal, timeoutMs = 45000 }) {
  const { content, channel } = await invokeAiChat({
    settings,
    messages,
    temperature: 0.2,
    gmRequest,
    fetchFn,
    signal,
    timeoutMs,
  });
  return { data: parseStrictJsonContent(content), channel };
}

function wdKaiMergeChunkFallback(chunkPayloads) {
  const chunkSummaries = chunkPayloads.map((c, idx) => ({
    chunkIndex: idx + 1,
    summary: c.summary || c.keyPoints?.[0]?.text || c.outline?.[0]?.name || '',
    seconds: c.keyPoints?.[0]?.seconds ?? c.outline?.[0]?.points?.[0]?.seconds ?? null,
    timestamp: c.keyPoints?.[0]?.timestamp || c.outline?.[0]?.points?.[0]?.timestamp || '',
  })).filter(x => x.summary);
  const summary = chunkSummaries.map(c => c.summary).slice(0, 2).join('；');
  const keyPoints = [];
  const outline = [];
  const quiz = [];
  const glossary = [];
  const seenTerms = new Set();
  for (const c of chunkPayloads) {
    for (const kp of (c.keyPoints || [])) {
      if (keyPoints.length < 6 && !keyPoints.some(x => x.text === kp.text)) keyPoints.push(kp);
    }
    outline.push(...(c.outline || []));
    for (const q of (c.quiz || [])) {
      if (quiz.length < 5) quiz.push(q);
    }
    for (const g of (c.glossary || [])) {
      if (glossary.length < 8 && !seenTerms.has(g.term)) { seenTerms.add(g.term); glossary.push(g); }
    }
  }
  return { summary, keyPoints, outline, quiz, glossary, chunkSummaries };
}

async function summarizeCourseWithAi(courseData, settings, options = {}) {
  const scope = options.scope === 'section' ? 'section' : 'course';
  const targetSectionId = options.sectionId || null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const signal = options.signal;
  const maxSectionChars = Number.isFinite(options.maxSectionChars) ? options.maxSectionChars : 12000;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 45000;

  const allSections = Array.isArray(courseData?.sections) ? courseData.sections : [];
  const selected = scope === 'section'
    ? (targetSectionId
      ? allSections.filter(sec => sec.sectionId === targetSectionId).slice(0, 1)
      : allSections.filter(sec => sec.active || (courseData?.activeSectionId && sec.sectionId === courseData.activeSectionId)).slice(0, 1))
    : allSections;
  const targetSections = selected.length ? selected : allSections.slice(0, 1);

  // Short-circuit cleanly when target section(s) have NO AI subtitles at all (0 LLM calls, never crash/hang)
  const targetCaptioned = targetSections.filter(sec => {
    if (sec?.hasSubtitle === false) return false;
    const segs = Array.isArray(sec?.segments) && sec.segments.length ? sec.segments : cleanAndSegmentCues(sec?.cues || []).segments;
    return segs.length > 0;
  });
  if (targetCaptioned.length === 0) {
    const noSubReason = scope === 'section'
      ? (targetSections[0]?.subtitleReason || '本课无字幕：该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。')
      : '本课无字幕：整门课所有课节均未检测到可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。';
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: noSubReason });
    return {
      ...zero,
      usedAi: false,
      fallback: false,
      noSubtitle: true,
      skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
      failedSections: [],
      channel: null,
    };
  }

  if (!settings?.apiKey?.trim()) {
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: '未配置 API Key，当前展示本地摘要（未使用 AI）。' });
    return {
      ...zero,
      usedAi: false,
      fallback: false,
      noSubtitle: false,
      skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
      failedSections: [],
      channel: null,
    };
  }
  try {
    validateAiEndpoint(settings);
  } catch (err) {
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: `AI 配置无效（${err.message}），已自动降级为本地摘要。` });
    return {
      ...zero,
      usedAi: false,
      fallback: true,
      noSubtitle: false,
      skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
      failedSections: [],
      channel: null,
    };
  }
  if (!settings.model?.trim()) {
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: '未填写模型名，已自动降级为本地摘要。' });
    return {
      ...zero,
      usedAi: false,
      fallback: true,
      noSubtitle: false,
      skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
      failedSections: [],
      channel: null,
    };
  }

  const highlights = Array.isArray(courseData?.highlights) ? courseData.highlights : [];

  const resultSections = [];
  const failedSections = [];
  const skippedNoSubtitleSections = [];
  const warnings = Array.isArray(courseData?.warnings) ? [...courseData.warnings] : [];
  let aiSuccessCount = 0;
  let lastChannel = null;
  let firstError = '';

  for (let i = 0; i < targetSections.length; i += 1) {
    if (signal?.aborted) {
      return {
        ...buildZeroAiGuide(courseData, { scope, fallbackReason: '已取消 AI 分析，当前展示零 AI 导览。' }),
        usedAi: false,
        fallback: true,
        aborted: true,
        noSubtitle: false,
        skippedNoSubtitleSections,
        failedSections,
        channel: lastChannel,
      };
    }
    const sec = targetSections[i];
    const rawSegments = Array.isArray(sec.segments) && sec.segments.length
      ? sec.segments
      : cleanAndSegmentCues(sec.cues || [], { sectionId: sec.sectionId || 'current' }).segments;
    const segments = assignStableSegmentIds(rawSegments, sec.sectionId || 'current');
    const secWithSegs = { ...sec, segments };
    const secSegmentIndex = buildSegmentIndex(secWithSegs);
    const zeroSec = buildZeroAiSectionTree(secWithSegs, highlights);

    if (sec.hasSubtitle === false || !segments.length) {
      skippedNoSubtitleSections.push({
        sectionId: sec.sectionId || null,
        title: sec.title || `课节 ${i + 1}`,
        status: sec.subtitleStatus || 'no-subtitle',
        reason: sec.subtitleReason || '本课无字幕',
      });
      resultSections.push(zeroSec);
      continue;
    }

    onProgress({ done: i, total: targetSections.length, stage: 'section', title: sec.title });
    const chunks = splitSegmentsIntoChunks(segments, maxSectionChars);
    const chunkPayloads = [];
    let sectionError = '';
    for (let c = 0; c < chunks.length; c += 1) {
      const prompt = buildSectionPrompt(courseData.title, secWithSegs, chunks[c], { index: c + 1, total: chunks.length });
      try {
        const { data, channel } = await wdKaiCallChatJson({
          settings,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          gmRequest: options.gmRequest,
          fetchFn: options.fetchFn,
          signal,
          timeoutMs,
        });
        lastChannel = channel;
        chunkPayloads.push(normalizeSectionStudyPayload(data, {
          sectionTitle: sec.title,
          sectionId: sec.sectionId || 'current',
          segmentIndex: secSegmentIndex,
          similarityThreshold: options.similarityThreshold,
        }));
      } catch (err) {
        sectionError = err?.message || String(err);
        if (!firstError) firstError = sectionError;
        break;
      }
    }

    if (chunkPayloads.length > 0 && (!sectionError || chunkPayloads.length >= 1)) {
      let finalPayload = chunkPayloads[0];
      let chunkSummaries = [];
      if (chunks.length > 1) {
        const mergedFallback = wdKaiMergeChunkFallback(chunkPayloads);
        chunkSummaries = mergedFallback.chunkSummaries;
        if (!sectionError && chunkPayloads.length > 1 && !signal?.aborted) {
          try {
            onProgress({ done: i, total: targetSections.length, stage: 'section-aggregate', title: `正在收敛课节《${sec.title}》分段要点…` });
            const aggPrompt = buildSectionChunkAggregationPrompt(courseData.title, secWithSegs, chunkPayloads);
            const { data } = await wdKaiCallChatJson({
              settings,
              messages: [
                { role: 'system', content: aggPrompt.system },
                { role: 'user', content: aggPrompt.user },
              ],
              gmRequest: options.gmRequest,
              fetchFn: options.fetchFn,
              signal,
              timeoutMs,
            });
            finalPayload = normalizeSectionStudyPayload(data, {
              sectionTitle: sec.title,
              sectionId: sec.sectionId || 'current',
              segmentIndex: secSegmentIndex,
              similarityThreshold: options.similarityThreshold,
            });
          } catch (aggErr) {
            warnings.push(`长课节「${sec.title}」二次聚合失败（${aggErr?.message || aggErr}），已保留每段一句话摘要与分段要点`);
            finalPayload = mergedFallback;
          }
        } else {
          if (sectionError) warnings.push(`长课节「${sec.title}」部分分段失败（${sectionError}），已保留已完成分段的每段一句话摘要`);
          finalPayload = mergedFallback;
        }
      }
      aiSuccessCount += 1;
      resultSections.push({
        sectionId: sec.sectionId || null,
        sectionIndex: sec.sectionIndex || (i + 1),
        chapterTitle: sec.chapterTitle || '',
        title: sec.title || `课节 ${i + 1}`,
        mode: 'ai',
        source: sec.source || 'vtt-url',
        hasSubtitle: true,
        subtitleStatus: 'ok',
        subtitleReason: '',
        subtitleLogs: Array.isArray(sec.subtitleLogs) ? sec.subtitleLogs : [],
        durationSec: secSegmentIndex.maxEndSec,
        summary: finalPayload.summary,
        keyPoints: finalPayload.keyPoints,
        outline: finalPayload.outline,
        topics: finalPayload.outline,
        quiz: finalPayload.quiz,
        glossary: finalPayload.glossary,
        timeline: zeroSec.timeline,
        ...(chunkSummaries.length ? { chunkSummaries } : {}),
      });
    } else {
      const failReason = sectionError || 'AI 解析失败';
      failedSections.push({ sectionId: sec.sectionId, title: sec.title, reason: failReason });
      warnings.push(`课节「${sec.title}」AI 解读失败（${failReason}），已降级为本地摘要`);
      resultSections.push({ ...zeroSec, fallbackReason: failReason });
    }
  }

  const skippedSummary = skippedNoSubtitleSections.length
    ? `批量处理已跳过 ${skippedNoSubtitleSections.length} 个无字幕课节：${skippedNoSubtitleSections.map(s => `《${s.title}》`).join('、')}。`
    : '';
  if (skippedSummary && !warnings.includes(skippedSummary)) warnings.push(skippedSummary);

  // If NO section succeeded with AI at all, cleanly return full zero-AI fallback with reason
  if (aiSuccessCount === 0) {
    const reason = firstError
      ? `AI 解读失败（${firstError}），已自动降级为本地摘要。`
      : '本课无字幕：当前范围暂无可用 AI 字幕正文，无法生成时间轴导览、问答与出题。';
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: reason });
    zero.tree.failedSections = failedSections;
    // Keep non-duplicate course warnings without repeating identical per-section error lines
    const nonRedundantWarnings = warnings.filter(w => !firstError || !w.includes(firstError));
    if (nonRedundantWarnings.length) zero.tree.warnings = [...new Set([...zero.tree.warnings, ...nonRedundantWarnings])];
    return {
      ...zero,
      usedAi: false,
      fallback: Boolean(firstError),
      noSubtitle: !firstError,
      skippedNoSubtitleSections,
      failedSections,
      channel: lastChannel,
    };
  }

  // Course-level aggregation when multiple sections succeeded with AI
  const captionedResultSections = resultSections.filter(s => s.hasSubtitle !== false);
  let overview = resultSections.length === 1
    ? (resultSections[0].summary || '')
    : captionedResultSections.filter(s => s.summary).map(s => s.summary).slice(0, 2).join('；');
  let courseKeyPoints = [];
  for (const sec of captionedResultSections) {
    if (sec.keyPoints?.[0]) {
      const kp = sec.keyPoints[0];
      if (!courseKeyPoints.some(existing => computeTextSimilarity(existing.text, kp.text) >= 0.55)) {
        courseKeyPoints.push({ ...kp, sectionId: sec.sectionId || 'current', sectionIndex: sec.sectionIndex || 1, sectionTitle: sec.title });
      }
    }
    if (courseKeyPoints.length >= 6) break;
  }

  if (scope === 'course' && aiSuccessCount > 1 && !signal?.aborted) {
    onProgress({ done: targetSections.length, total: targetSections.length, stage: 'aggregate', title: '正在聚合整门课知识地图与总览…' });
    try {
      const aiOnly = resultSections.filter(s => s.mode === 'ai');
      const aggPrompt = buildCourseAggregationPrompt(courseData.title, aiOnly);
      const { data } = await wdKaiCallChatJson({
        settings,
        messages: [
          { role: 'system', content: aggPrompt.system },
          { role: 'user', content: aggPrompt.user },
        ],
        gmRequest: options.gmRequest,
        fetchFn: options.fetchFn,
        signal,
        timeoutMs,
      });
      const cleanOverview = sanitizeCompleteText(data.overview || '', { maxLen: 140, allowShort: true, stripPrefixes: true });
      if (cleanOverview) overview = cleanOverview;
      const courseSegIndex = buildCourseSegmentIndex(resultSections);
      const rawCourseKps = Array.isArray(data.keyPoints)
        ? data.keyPoints.map(kp => wdKaiNormalizePoint(kp, { segmentIndex: courseSegIndex, similarityThreshold: options.similarityThreshold })).filter(Boolean)
        : [];
      const dedupCourseKps = [];
      for (const kp of rawCourseKps) {
        if (dedupCourseKps.some(existing => computeTextSimilarity(existing.text, kp.text) >= 0.55)) continue;
        const matchedSec = kp.sectionId ? resultSections.find(s => String(s.sectionId) === String(kp.sectionId)) : null;
        dedupCourseKps.push({
          ...kp,
          ...(matchedSec ? { sectionIndex: matchedSec.sectionIndex || 1, sectionTitle: matchedSec.title } : {}),
        });
        if (dedupCourseKps.length >= 6) break;
      }
      if (dedupCourseKps.length) courseKeyPoints = dedupCourseKps;
      if (Array.isArray(data.sections)) {
        const byId = new Map(data.sections.map(s => [String(s?.sectionId || ''), s]));
        for (const sec of resultSections) {
          if (sec.mode !== 'ai') continue;
          const updated = byId.get(String(sec.sectionId || ''));
          const cleanSecSummary = sanitizeCompleteText(updated?.summary || '', { maxLen: 120, allowShort: true, stripPrefixes: true });
          if (cleanSecSummary) sec.summary = cleanSecSummary;
          const secSegIdx = courseSegIndex.resolveSection(sec.sectionId);
          const nextOutline = wdKaiNormalizeOutline(updated?.outline ?? updated?.topics, {
            segmentIndex: secSegIdx,
            sectionId: sec.sectionId,
            similarityThreshold: options.similarityThreshold,
          });
          if (nextOutline.length) {
            sec.outline = nextOutline;
            sec.topics = nextOutline;
          }
        }
      }
    } catch (err) {
      warnings.push(`整门课聚合总览未完成（${err?.message || err}），已保留各课节一句话摘要与完整要点`);
    }
  }

  const tree = {
    mode: failedSections.length ? 'ai-partial' : 'ai',
    scope,
    scopeLabel: buildScopeLabel(scope, resultSections),
    courseId: courseData?.courseId || null,
    activeSectionId: courseData?.activeSectionId || resultSections[0]?.sectionId || null,
    courseTitle: courseData?.title || '当前课程',
    overview,
    courseKeyPoints,
    hasAnySubtitle: true,
    noSubtitle: false,
    skippedNoSubtitleSections,
    skippedSummary,
    subtitleDiagnostics: Array.isArray(courseData?.subtitleDiagnostics) ? courseData.subtitleDiagnostics : [],
    generatedAt: new Date().toISOString(),
    fallbackReason: failedSections.length ? `部分课节（${failedSections.length} 节）AI 解读失败，已局部降级为本地摘要。` : '',
    failedSections,
    warnings,
    sections: resultSections,
  };
  const markdown = buildKnowledgeMarkdown(tree);
  onProgress({ done: targetSections.length, total: targetSections.length, stage: 'done', title: '完成' });
  return {
    tree,
    markdown,
    usedAi: true,
    fallback: failedSections.length > 0,
    noSubtitle: false,
    skippedNoSubtitleSections,
    failedSections,
    channel: lastChannel,
  };
}

function createKnowledgeService({ win, pageWin = win, controller, adapter, gmStorage = undefined, gmRequest, fetchFn } = {}) {
  if (gmStorage !== undefined) bindWindowGmStorage(win, gmStorage);
  ensureStorageMigrated(win, { gmStorage });
  const resolveFetch = () => {
    if (typeof fetchFn === 'function') return fetchFn;
    if (typeof pageWin?.fetch === 'function') return pageWin.fetch.bind(pageWin);
    if (typeof win?.fetch === 'function') return win.fetch.bind(win);
    return null;
  };
  const wdKaiHttpStatusError = status => {
    const err = new Error(`HTTP ${status}`);
    err.status = status;
    return err;
  };
  const httpGetVtt = async (url, { signal, sameOrigin = true } = {}) => {
    const nativeFetch = resolveFetch();
    if (sameOrigin && nativeFetch) {
      const res = await wdKaiFetchRequest(nativeFetch, { url, method: 'GET', timeoutMs: 15000, signal, credentials: 'same-origin' });
      if (res.status >= 200 && res.status < 300) return { status: res.status, text: res.text };
      if (typeof gmRequest !== 'function') throw wdKaiHttpStatusError(res.status);
    }
    if (typeof gmRequest === 'function') {
      const res = await wdKaiGmRequest(gmRequest, { url, method: 'GET', timeoutMs: 15000, signal, anonymous: false });
      if (res.status >= 200 && res.status < 300) return { status: res.status, text: res.text };
      throw wdKaiHttpStatusError(res.status);
    }
    if (nativeFetch) {
      const res = await wdKaiFetchRequest(nativeFetch, { url, method: 'GET', timeoutMs: 15000, signal, credentials: 'omit' });
      if (res.status >= 200 && res.status < 300) return { status: res.status, text: res.text };
      throw wdKaiHttpStatusError(res.status);
    }
    throw new Error('无可用请求通道');
  };

  let activeAbort = null;
  let modelsAbort = null;
  let testAbort = null;
  let lastCourseData = null;
  const settingsListeners = new Set();
  const emitSettingsChange = nextSettings => {
    for (const fn of settingsListeners) {
      try { fn(nextSettings); } catch { /* ignore listener error */ }
    }
  };

  const findCachedForData = (data, preferredScope = null, sectionId = null, matchSettings = null) => {
    if (!data?.courseId) return null;
    const focusSecId = sectionId || data.activeSectionId;
    const keys = preferredScope === 'section'
      ? [buildKnowledgeCacheKey(data.courseId, 'section', focusSecId)]
      : preferredScope === 'course'
        ? [buildKnowledgeCacheKey(data.courseId, 'course')]
        : sectionId
          ? [buildKnowledgeCacheKey(data.courseId, 'section', sectionId), buildKnowledgeCacheKey(data.courseId, 'course')]
          : [
            buildKnowledgeCacheKey(data.courseId, 'course'),
            buildKnowledgeCacheKey(data.courseId, 'section', focusSecId),
          ];
    for (const key of keys) {
      const hit = loadKnowledgeCache(win, key);
      if (!hit?.usedAi) continue;
      if (matchSettings) {
        const sameProvider = !hit.provider || !matchSettings.provider || hit.provider === matchSettings.provider;
        const sameModel = !hit.model || !matchSettings.model || hit.model === matchSettings.model;
        if (!sameProvider || !sameModel) continue;
      }
      return { key, hit };
    }
    return null;
  };

  return {
    providers: WD_AI_PROVIDERS,
    privacyNotice: WD_AI_PRIVACY_NOTICE,
    storageKeys: WD_AI_STORAGE_KEYS,
    hasGmTransport: () => typeof gmRequest === 'function',
    getPageWin: () => pageWin,
    httpGetSubtitle: httpGetVtt,
    getTransportDeps: () => ({ gmRequest, fetchFn: resolveFetch() }),
    getLastDiagnostics: () => lastCourseData ? {
      courseId: lastCourseData.courseId,
      courseTitle: lastCourseData.title,
      totalSections: lastCourseData.sections?.length || 0,
      captionedSections: lastCourseData.captionedSections || 0,
      hasAnySubtitle: Boolean(lastCourseData.hasAnySubtitle),
      skippedNoSubtitleSections: lastCourseData.skippedNoSubtitleSections || [],
      fallbackOrder: lastCourseData.fallbackOrder || [],
      logs: lastCourseData.subtitleDiagnostics || [],
    } : null,
    getSettings: () => loadAiSettings(win, { gmStorage }),
    saveSettings: next => {
      const res = saveAiSettings(win, next, { gmStorage });
      if (res.ok) emitSettingsChange(res.settings);
      return res;
    },
    clearApiKey: () => {
      const res = clearAiApiKey(win, { gmStorage });
      if (res.ok) emitSettingsChange(loadAiSettings(win, { gmStorage }));
      return res;
    },
    onSettingsChange: fn => {
      if (typeof fn !== 'function') return () => {};
      settingsListeners.add(fn);
      return () => { settingsListeners.delete(fn); };
    },
    clearCache: key => clearKnowledgeCache(win, key),
    getStorageStatus: () => getStorageStatus(win, { gmStorage }),
    getMigrationReceipt: () => readMigrationReceipt(win, { gmStorage }),
    migrateStorage: opts => migrateLegacyStorage(win, { gmStorage, ...(opts || {}) }),
    abortFetchModels() {
      try { modelsAbort?.abort?.(); } catch { /* ignore */ }
      modelsAbort = null;
    },
    abortTestConnection() {
      try { testAbort?.abort?.(); } catch { /* ignore */ }
      testAbort = null;
    },
    async fetchModels(overrideSettings = null, opts = {}) {
      this.abortFetchModels();
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      modelsAbort = ac;
      const baseCfg = loadAiSettings(win, { gmStorage });
      const effectiveCfg = overrideSettings ? { ...baseCfg, ...overrideSettings } : baseCfg;
      try {
        return await fetchAiModels(effectiveCfg, {
          gmRequest,
          fetchFn: resolveFetch(),
          signal: opts.signal || ac?.signal,
          timeoutMs: opts.timeoutMs,
        });
      } finally {
        if (modelsAbort === ac) modelsAbort = null;
      }
    },
    async testConnection(overrideSettings = null, opts = {}) {
      this.abortTestConnection();
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      testAbort = ac;
      const baseCfg = loadAiSettings(win, { gmStorage });
      const effectiveCfg = overrideSettings ? { ...baseCfg, ...overrideSettings } : baseCfg;
      try {
        return await testAiConnection(effectiveCfg, {
          gmRequest,
          fetchFn: resolveFetch(),
          signal: opts.signal || ac?.signal,
          timeoutMs: opts.timeoutMs,
        });
      } finally {
        if (testAbort === ac) testAbort = null;
      }
    },
    abort() {
      try { activeAbort?.abort?.(); } catch { /* ignore */ }
      activeAbort = null;
      this.abortFetchModels();
      this.abortTestConnection();
    },
    async collect(scope = 'course', sectionId = null) {
      const data = await collectCourseSubtitles({ win, pageWin, scope, sectionId, httpGet: httpGetVtt });
      lastCourseData = data;
      return {
        courseData: data,
        estimates: {
          section: estimateKnowledgeTokens(data, 'section'),
          course: estimateKnowledgeTokens(data, 'course'),
        },
        zeroAi: buildZeroAiGuide(data, { scope, sectionId }),
      };
    },
    async analyze({ scope = 'section', sectionId = null, useAi = false, forceRefresh = false, preferCacheOnOpen = false, onProgress } = {}) {
      try { activeAbort?.abort?.(); } catch { /* ignore */ }
      activeAbort = null;
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      activeAbort = ac;
      try {
        const effectiveScope = sectionId && scope === 'section' ? 'section' : scope;
        const collectScope = preferCacheOnOpen && !sectionId ? 'course' : effectiveScope;
        const data = await collectCourseSubtitles({ win, pageWin, scope: collectScope, sectionId, httpGet: httpGetVtt, signal: ac?.signal });
        lastCourseData = data;
        const focusSecId = sectionId || data.activeSectionId;
        const estimates = {
          section: estimateKnowledgeTokens({ ...data, activeSectionId: focusSecId }, 'section'),
          course: estimateKnowledgeTokens(data, 'course'),
        };

        const currentSettings = loadAiSettings(win, { gmStorage });
        // Instant open from localStorage cache when available (when actively running AI, require model/provider match so model switch takes effect immediately)
        const targetScopeHasSubtitle = effectiveScope === 'section'
          ? Boolean(data.sections.find(s => s.sectionId === focusSecId)?.hasSubtitle !== false && data.captionedSections > 0)
          : data.captionedSections > 0;
        if (!forceRefresh && targetScopeHasSubtitle && (useAi || preferCacheOnOpen)) {
          const cached = findCachedForData(
            data,
            useAi ? effectiveScope : (sectionId ? 'section' : null),
            focusSecId,
            useAi ? currentSettings : null,
          );
          if (cached) {
            const mergedTree = {
              ...cached.hit.tree,
              subtitleDiagnostics: data.subtitleDiagnostics || [],
              skippedNoSubtitleSections: cached.hit.tree.skippedNoSubtitleSections || data.skippedNoSubtitleSections || [],
              hasAnySubtitle: data.hasAnySubtitle,
            };
            return {
              courseData: data,
              estimates,
              tree: mergedTree,
              markdown: cached.hit.markdown,
              usedAi: cached.hit.usedAi,
              fallback: cached.hit.fallback,
              noSubtitle: false,
              skippedNoSubtitleSections: mergedTree.skippedNoSubtitleSections,
              failedSections: cached.hit.failedSections || [],
              channel: cached.hit.channel,
              fromCache: true,
              cachedAt: cached.hit.cachedAt,
              cacheKey: cached.key,
            };
          }
        }

        if (!useAi) {
          const zero = buildZeroAiGuide(data, { scope: effectiveScope, sectionId: focusSecId });
          return {
            courseData: data,
            estimates,
            ...zero,
            usedAi: false,
            fallback: false,
            noSubtitle: Boolean(zero.tree.noSubtitle),
            skippedNoSubtitleSections: zero.tree.skippedNoSubtitleSections || [],
            failedSections: [],
            fromCache: false,
          };
        }

        const settings = currentSettings;
        const result = await summarizeCourseWithAi(data, settings, {
          scope: effectiveScope,
          sectionId: focusSecId,
          onProgress,
          signal: ac?.signal,
          gmRequest,
          fetchFn: resolveFetch(),
        });

        let cacheKey = null;
        if (result.usedAi && !result.aborted && data.courseId) {
          cacheKey = buildKnowledgeCacheKey(data.courseId, effectiveScope, focusSecId);
          saveKnowledgeCache(win, cacheKey, {
            ...result,
            scope: effectiveScope,
            provider: settings.provider,
            model: settings.model,
          });
        }

        return {
          courseData: data,
          estimates,
          ...result,
          fromCache: false,
          cachedAt: cacheKey ? Date.now() : null,
          cacheKey,
        };
      } finally {
        if (activeAbort === ac) activeAbort = null;
      }
    },
    getLastCourseData: () => lastCourseData,
    seek({ sectionId, seconds, unmute = false, expectedCourseId = null }) {
      const state = controller?.getState?.();
      const queueRunning = Boolean(state && ['running', 'preparing', 'waiting'].includes(state.status));
      const autoMuteEnabled = state?.automation?.mute !== false;
      return seekCourseTime({
        win,
        pageWin,
        adapter,
        sectionId,
        seconds,
        queueRunning,
        unmute,
        autoMuteEnabled,
        expectedCourseId: expectedCourseId || lastCourseData?.courseId || null,
      });
    },
  };
}






function sectionHasSubtitle(section) {
  if (!section) return false;
  if (section.hasSubtitle === false) return false;
  if (section.hasSubtitle === true) return true;
  if (Array.isArray(section.cues) && section.cues.length > 0) return true;
  if (Array.isArray(section.segments) && section.segments.length > 0) return true;
  if (Array.isArray(section.timeline) && section.timeline.length > 0 && section.mode !== 'highlight' && section.mode !== 'placeholder') return true;
  return false;
}

const WD_TUTOR_STORAGE_KEYS = {
  qa: WD_LEGACY_STORAGE_KEYS.qa,
  quiz: WD_LEGACY_STORAGE_KEYS.quiz,
};

const wdKtutMaxMessagesPerSession = 60;
const wdKtutHistoryTurnsForPrompt = 6;
const wdKtutStyleId = 'wd-section-guide-entry-style';
let wdKtutSessionSeq = 0;

function buildTutorSectionKey(courseId, sectionId) {
  const cid = String(courseId || 'unknown').trim() || 'unknown';
  const sid = String(sectionId || 'current').trim() || 'current';
  return `${cid}::${sid}`;
}

function wdKtutNormalizeSectionChatEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') {
    const now = Date.now();
    return {
      activeSessionId: 'default',
      updatedAt: null,
      sessions: {
        default: { id: 'default', title: '默认问答', kind: 'general', createdAt: now, updatedAt: null, messages: [] },
      },
    };
  }
  // Legacy shape: { updatedAt, messages: [...] }
  if (Array.isArray(rawEntry.messages) && !rawEntry.sessions) {
    const ts = Number(rawEntry.updatedAt) || Date.now();
    return {
      activeSessionId: 'default',
      updatedAt: rawEntry.updatedAt || null,
      sessions: {
        default: { id: 'default', title: '默认问答', kind: 'general', createdAt: ts, updatedAt: ts, messages: rawEntry.messages },
      },
    };
  }
  const rawSessions = rawEntry.sessions && typeof rawEntry.sessions === 'object' ? rawEntry.sessions : {};
  const sessions = {};
  for (const [id, sess] of Object.entries(rawSessions)) {
    if (!sess || typeof sess !== 'object') continue;
    sessions[id] = {
      id: String(sess.id || id),
      title: String(sess.title || (id === 'default' ? '默认问答' : '问答会话')),
      kind: sess.kind === 'deepdive' ? 'deepdive' : 'general',
      quizQuestionId: sess.quizQuestionId || null,
      createdAt: Number(sess.createdAt) || Date.now(),
      updatedAt: Number(sess.updatedAt) || null,
      messages: Array.isArray(sess.messages) ? sess.messages : [],
    };
  }
  if (!Object.keys(sessions).length) {
    const now = Date.now();
    sessions.default = { id: 'default', title: '默认问答', kind: 'general', createdAt: now, updatedAt: null, messages: [] };
  }
  const activeSessionId = rawEntry.activeSessionId && sessions[rawEntry.activeSessionId]
    ? rawEntry.activeSessionId
    : Object.keys(sessions)[0];
  return {
    activeSessionId,
    updatedAt: Number(rawEntry.updatedAt) || sessions[activeSessionId]?.updatedAt || null,
    sessions,
  };
}

function loadSectionChat(win, courseId, sectionId, sessionId = null) {
  ensureStorageMigrated(win);
  const key = buildTutorSectionKey(courseId, sectionId);
  const sid = String(sectionId || 'current').trim() || 'current';
  const shard = readCourseAssetShard(win, courseId, 'qa');
  const container = wdKtutNormalizeSectionChatEntry(shard.data?.[sid]);
  const targetId = sessionId && container.sessions[sessionId] ? sessionId : container.activeSessionId;
  const session = container.sessions[targetId];
  const sessionList = Object.values(container.sessions)
    .sort((a, b) => (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0));
  return {
    key,
    activeSessionId: targetId,
    session,
    sessions: sessionList,
    messages: Array.isArray(session?.messages) ? session.messages : [],
    updatedAt: session?.updatedAt || container.updatedAt || null,
  };
}

function createSectionChatSession(win, courseId, sectionId, options = {}) {
  ensureStorageMigrated(win);
  const sid = String(sectionId || 'current').trim() || 'current';
  const shard = readCourseAssetShard(win, courseId, 'qa');
  const map = { ...(shard.data || {}) };
  const container = wdKtutNormalizeSectionChatEntry(map[sid]);
  wdKtutSessionSeq += 1;
  const kind = options.kind === 'deepdive' ? 'deepdive' : 'general';
  const now = Date.now();
  const newId = options.sessionId || `${kind === 'deepdive' ? 'dd' : 'chat'}-${now}-${wdKtutSessionSeq}`;
  const title = String(options.title || (kind === 'deepdive' ? '错题深挖会话' : `新会话 ${Object.keys(container.sessions).length + 1}`)).trim();
  const session = {
    id: newId,
    title,
    kind,
    quizQuestionId: options.quizQuestionId || null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  container.sessions[newId] = session;
  container.activeSessionId = newId;
  container.updatedAt = now;
  map[sid] = container;
  const writeRes = writeCourseAssetShard(win, courseId, 'qa', map);
  return { ok: Boolean(writeRes.ok), sessionId: newId, session };
}

function switchSectionChatSession(win, courseId, sectionId, sessionId) {
  ensureStorageMigrated(win);
  const sid = String(sectionId || 'current').trim() || 'current';
  const shard = readCourseAssetShard(win, courseId, 'qa');
  const map = { ...(shard.data || {}) };
  const container = wdKtutNormalizeSectionChatEntry(map[sid]);
  if (!sessionId || !container.sessions[sessionId]) return false;
  container.activeSessionId = sessionId;
  container.updatedAt = Date.now();
  map[sid] = container;
  return Boolean(writeCourseAssetShard(win, courseId, 'qa', map).ok);
}

function saveSectionChat(win, courseId, sectionId, messages, sessionId = null) {
  ensureStorageMigrated(win);
  const sid = String(sectionId || 'current').trim() || 'current';
  const shard = readCourseAssetShard(win, courseId, 'qa');
  const map = { ...(shard.data || {}) };
  const container = wdKtutNormalizeSectionChatEntry(map[sid]);
  const targetId = sessionId || container.activeSessionId || 'default';
  const now = Date.now();
  const trimmed = (Array.isArray(messages) ? messages : []).slice(-wdKtutMaxMessagesPerSession);
  const prevSession = container.sessions[targetId] || {
    id: targetId,
    title: targetId === 'default' ? '默认问答' : '问答会话',
    kind: targetId.startsWith('dd-') ? 'deepdive' : 'general',
    quizQuestionId: null,
    createdAt: now,
  };
  container.sessions[targetId] = { ...prevSession, updatedAt: now, messages: trimmed };
  container.activeSessionId = targetId;
  container.updatedAt = now;
  map[sid] = container;
  return Boolean(writeCourseAssetShard(win, courseId, 'qa', map).ok);
}

function clearSectionChat(win, courseId, sectionId, sessionId = null) {
  ensureStorageMigrated(win);
  const sid = String(sectionId || 'current').trim() || 'current';
  const shard = readCourseAssetShard(win, courseId, 'qa');
  const map = { ...(shard.data || {}) };
  if (!map[sid]) return true;
  if (!sessionId || sessionId === '*') {
    delete map[sid];
  } else {
    const container = wdKtutNormalizeSectionChatEntry(map[sid]);
    if (container.sessions[sessionId]) {
      container.sessions[sessionId].messages = [];
      container.sessions[sessionId].updatedAt = Date.now();
    }
    map[sid] = container;
  }
  return Boolean(writeCourseAssetShard(win, courseId, 'qa', map).ok);
}

function loadSectionQuiz(win, courseId, sectionId) {
  ensureStorageMigrated(win);
  const sid = String(sectionId || 'current').trim() || 'current';
  const shard = readCourseAssetShard(win, courseId, 'quiz');
  const entry = shard.data?.[sid];
  if (!entry || !Array.isArray(entry.questions) || !entry.questions.length) return null;
  return entry;
}

function saveSectionQuiz(win, courseId, sectionId, quizRecord) {
  ensureStorageMigrated(win);
  const sid = String(sectionId || 'current').trim() || 'current';
  const shard = readCourseAssetShard(win, courseId, 'quiz');
  const map = { ...(shard.data || {}) };
  map[sid] = { ...quizRecord, updatedAt: Date.now() };
  return Boolean(writeCourseAssetShard(win, courseId, 'quiz', map).ok);
}

function clearSectionQuiz(win, courseId, sectionId) {
  ensureStorageMigrated(win);
  const sid = String(sectionId || 'current').trim() || 'current';
  const shard = readCourseAssetShard(win, courseId, 'quiz');
  const map = { ...(shard.data || {}) };
  delete map[sid];
  return Boolean(writeCourseAssetShard(win, courseId, 'quiz', map).ok);
}

function submitSectionQuizAttempt(win, courseId, sectionId, quizRecord, answers = {}) {
  const questions = Array.isArray(quizRecord?.questions) ? quizRecord.questions : [];
  const graded = gradeSectionQuiz(questions, answers);
  const nextAttempt = {
    answers: { ...(answers || {}) },
    submitted: true,
    submittedAt: Date.now(),
    choiceTotal: graded.choiceTotal,
    choiceCorrect: graded.choiceCorrect,
  };
  const updatedRecord = { ...quizRecord, attempt: nextAttempt };
  saveSectionQuiz(win, courseId, sectionId, updatedRecord);

  const wrongQuestions = [];
  for (const q of questions) {
    if (q.type !== 'choice') continue;
    const detail = graded.details[q.id];
    if (detail && !detail.correct) {
      wrongQuestions.push(q);
      recordWrongQuestionAsset(win, courseId, {
        sectionId,
        sectionTitle: quizRecord?.sectionTitle || '',
        questionId: q.id,
        question: q.question,
        options: q.options,
        chosenIndex: detail.chosen,
        correctIndex: q.correctIndex,
        answerLetter: q.answerLetter,
        explanation: q.explanation,
        citation: q.citation || (q.segId ? { segId: q.segId, refKey: q.refKey, seconds: q.seconds, timestamp: q.timestamp } : null),
      });
    }
  }

  const masteryStatus = graded.choiceTotal > 0
    ? (wrongQuestions.length === 0 ? 'mastered' : 'weak')
    : 'reviewed';
  updateSectionMasteryAsset(win, courseId, sectionId, {
    status: masteryStatus,
    score: graded.percent,
    wrongCount: wrongQuestions.length,
    lastQuizAt: nextAttempt.submittedAt,
  });

  return { graded, attempt: nextAttempt, wrongQuestions, quiz: updatedRecord };
}

function buildWrongQuestionDeepDivePrompt({ question, chosenIndex = null, section = null, segmentIndex = null } = {}) {
  if (!question || typeof question !== 'object') return '';
  const segIdx = segmentIndex || (section ? buildSegmentIndex(section) : null);
  const optionsText = Array.isArray(question.options) && question.options.length
    ? question.options.join(' / ')
    : '';
  const chosenText = Number.isInteger(chosenIndex) && Array.isArray(question.options) && question.options[chosenIndex]
    ? question.options[chosenIndex]
    : '未作答';
  const correctText = question.type === 'choice'
    ? (question.options?.[question.correctIndex] || question.answerLetter || '')
    : (question.referenceAnswer || '');

  let citePart = '';
  const cite = question.citation || null;
  if (cite?.verified && cite.segId) {
    const excerpt = cite.excerpt || segIdx?.byId?.get?.(cite.segId)?.text || '';
    citePart = `引用依据：${cite.displayId || `[${cite.segId}]`}（${cite.timestamp || formatTimestamp(cite.seconds || 0)}）原字幕：「${excerpt.slice(0, 180)}」`;
  } else if (question.segId && segIdx?.byId?.has?.(question.segId)) {
    const seg = segIdx.byId.get(question.segId);
    citePart = `引用依据：[${seg.segId}]（${seg.timestamp}）原字幕：「${seg.text.slice(0, 180)}」`;
  } else if (Number.isFinite(question.seconds) && segIdx) {
    const seg = segIdx.findSegmentBySeconds(question.seconds);
    if (seg) citePart = `引用依据：[${seg.segId}]（${seg.timestamp}）原字幕：「${seg.text.slice(0, 180)}」`;
  } else if (cite && !cite.verified) {
    citePart = `引用状态：原题标注 ${cite.rawRef || '无编号'} 未通过原文核验（${cite.reason || '待核实'}），请严格依据本节原字幕编号作答`;
  }

  const parts = [
    `【错题深挖】题干：${question.question}`,
    optionsText ? `选项：${optionsText}` : '',
    question.type === 'choice' ? `我的错选：${chosenText}` : '',
    `正确答案：${correctText}`,
    question.explanation ? `题目解析：${question.explanation}` : '',
    citePart,
    '请帮我深挖这道题：1）为什么我的选择不对；2）正确答案的关键逻辑是什么；3）结合原字幕段落编号 [Sxx] 举一个易懂的例子帮助巩固。',
  ].filter(Boolean);
  return parts.join('；');
}

function wdKtutExtractQueryTerms(query) {
  const text = String(query ?? '').toLowerCase();
  const terms = new Set();
  for (const m of text.matchAll(/[a-z0-9_-]{2,}/gu)) terms.add(m[0]);
  for (const m of text.matchAll(/[\u4e00-\u9fa5]{2,}/gu)) {
    const chunk = m[0];
    if (chunk.length <= 4) terms.add(chunk);
    for (let i = 0; i < chunk.length - 1; i += 1) {
      terms.add(chunk.slice(i, i + 2));
      if (i + 3 <= chunk.length) terms.add(chunk.slice(i, i + 3));
    }
  }
  const targetMinutes = [];
  for (const m of text.matchAll(/第\s*(\d{1,3})\s*分/gu)) targetMinutes.push(Number(m[1]) * 60);
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})\b/gu)) targetMinutes.push(Number(m[1]) * 60 + Number(m[2]));
  return { terms: [...terms], targetMinutes };
}

function selectRelevantSectionContext(section, query = '', options = {}) {
  const maxContextChars = Number.isFinite(options.maxContextChars) ? options.maxContextChars : 7500;
  const segmentIndex = buildSegmentIndex(section, {
    sectionId: section?.sectionId || 'current',
    durationSec: section?.durationSec,
  });
  const rawSegments = segmentIndex.segments;

  const headerLines = [];
  if (section?.summary) headerLines.push(`【课节概览】${section.summary}`);
  if (Array.isArray(section?.keyPoints) && section.keyPoints.length) {
    headerLines.push(`【核心要点】${section.keyPoints.map(k => `${k.text}${k.segId ? `[${k.segId}]` : (k.timestamp ? `(${k.timestamp})` : '')}`).join('；')}`);
  }
  const outline = Array.isArray(section?.outline) && section.outline.length ? section.outline : (section?.topics || []);
  if (outline.length) {
    headerLines.push(`【知识点大纲】${outline.map(t => `${t.name}: ${(t.points || []).map(p => `${p.text}${p.segId ? `[${p.segId}]` : (p.timestamp ? `(${p.timestamp})` : '')}`).join('、')}`).join(' | ')}`);
  }
  const headerText = headerLines.join('\n').slice(0, Math.floor(maxContextChars * 0.25));
  const segBudget = Math.max(800, maxContextChars - headerText.length - 80);

  const formatted = rawSegments.map((seg, idx) => {
    const startSec = Number.isFinite(seg.startSec) ? Math.floor(seg.startSec) : Math.floor((Number(seg.startMs) || 0) / 1000);
    const ts = seg.timestamp || formatTimestamp(startSec);
    const minute = Math.floor(startSec / 60) + 1;
    const line = `[${seg.segId}] [${ts} · 约第${minute}分钟] ${String(seg.text || '').trim()}`;
    return { idx, segId: seg.segId, startSec, ts, line, textLower: String(seg.text || '').toLowerCase() };
  });

  const totalChars = formatted.reduce((sum, s) => sum + s.line.length + 1, 0);
  let chosen = formatted;
  let truncated = false;

  if (totalChars > segBudget && formatted.length > 0) {
    truncated = true;
    const { terms, targetMinutes } = wdKtutExtractQueryTerms(query);
    const scored = formatted.map(item => {
      let score = 0;
      for (const term of terms) {
        if (item.textLower.includes(term)) score += term.length >= 3 ? 4 : 1.5;
      }
      for (const targetSec of targetMinutes) {
        const dist = Math.abs(item.startSec - targetSec);
        if (dist <= 60) score += 12;
        else if (dist <= 180) score += 5;
      }
      if (item.idx === 0) score += 1;
      if (item.idx === formatted.length - 1) score += 0.5;
      return { item, score };
    });

    const hasSignal = scored.some(s => s.score > 1.5);
    const pickedIndices = new Set();
    let usedChars = 0;

    if (hasSignal) {
      scored.sort((a, b) => b.score - a.score || a.item.idx - b.item.idx);
      for (const { item } of scored) {
        const candidates = [item.idx];
        if (item.idx > 0) candidates.push(item.idx - 1);
        if (item.idx + 1 < formatted.length) candidates.push(item.idx + 1);
        for (const cIdx of candidates) {
          if (pickedIndices.has(cIdx)) continue;
          const len = formatted[cIdx].line.length + 1;
          if (usedChars + len <= segBudget) {
            pickedIndices.add(cIdx);
            usedChars += len;
          }
        }
        if (usedChars >= segBudget * 0.92) break;
      }
    } else {
      // Uniformly sample across timeline when no query keywords (e.g., quiz generation on long transcript)
      const step = Math.max(1, Math.ceil(totalChars / segBudget));
      for (let i = 0; i < formatted.length; i += step) {
        const len = formatted[i].line.length + 1;
        if (usedChars + len <= segBudget) {
          pickedIndices.add(i);
          usedChars += len;
        }
      }
      // Fill remaining budget greedily from start
      for (let i = 0; i < formatted.length && usedChars < segBudget * 0.85; i += 1) {
        if (pickedIndices.has(i)) continue;
        const len = formatted[i].line.length + 1;
        if (usedChars + len <= segBudget) { pickedIndices.add(i); usedChars += len; }
      }
    }
    chosen = [...pickedIndices].sort((a, b) => a - b).map(i => formatted[i]);
  }

  const transcriptBlock = chosen.length
    ? chosen.map(c => c.line).join('\n')
    : '（本课节暂无字幕原文，仅可依据上方标题或知识点作答）';
  const contextText = [headerText, '【带分段编号的字幕原文（引用时只写编号如 [S01]）】', transcriptBlock].filter(Boolean).join('\n\n');
  return {
    contextText,
    segmentIndex,
    totalSegments: formatted.length,
    selectedSegments: chosen.length,
    truncated,
    totalChars,
    selectedChars: chosen.reduce((sum, s) => sum + s.line.length + 1, 0),
  };
}

function extractTimestampsFromText(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text ?? '').matchAll(/(?<!\d)(-?\d{1,2}:\d{2}(?::\d{2})?)(?!\d)/gu)) {
    const raw = m[1];
    const isNeg = raw.startsWith('-');
    const sec = isNeg ? -1 : parseTimestampToSeconds(raw);
    if (!isNeg && sec === null) continue;
    const floorSec = isNeg ? -1 : Math.floor(sec);
    const key = isNeg ? raw : String(floorSec);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rawTime: raw,
      seconds: floorSec,
      timestamp: isNeg ? raw : formatTimestamp(floorSec),
      minuteLabel: isNeg ? '非法负时间' : `约第 ${Math.floor(floorSec / 60) + 1} 分钟`,
      note: '',
    });
  }
  return out;
}

function normalizeAndVerifyQaCitations(rawCitations, answerText, segmentIndex, options = {}) {
  const out = [];
  const seen = new Set();
  const pushVerified = cite => {
    if (!cite) return;
    const dedupeKey = cite.verified
      ? `v:${cite.refKey || cite.segId || cite.seconds}`
      : `u:${cite.reasonCode}:${cite.rawRef || cite.segId || cite.claimedSeconds || ''}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push(cite);
  };

  if (Array.isArray(rawCitations)) {
    for (const c of rawCitations) {
      if (!c) continue;
      const cleanNote = typeof c === 'object'
        ? sanitizeCompleteText(c.note || c.reason || '', { maxLen: 40, allowShort: true, allowClauseSplit: true })
        : '';
      const rawObj = typeof c === 'object' ? { ...c, note: cleanNote } : c;
      const verified = verifyCitation(rawObj, segmentIndex, {
        claimText: typeof c === 'object' ? (c.note || c.reason || '') : '',
        similarityThreshold: options.similarityThreshold,
      });
      pushVerified(verified);
    }
  }

  // Inline [S01] / ［S1］ references in answerText must also pass lookup verification!
  for (const ref of extractSegmentIdsFromText(answerText)) {
    const alreadyCovered = out.some(item => item.segId === ref.segId);
    if (alreadyCovered) continue;
    const verified = verifyCitation({ segId: ref.raw, sectionId: ref.sectionId }, segmentIndex, {
      similarityThreshold: options.similarityThreshold,
    });
    pushVerified(verified);
  }

  // Legacy inline mm:ss timestamps in answerText must ALSO pass the exact same verification (never bypass)!
  for (const item of extractTimestampsFromText(answerText)) {
    const alreadyCovered = out.some(c => c.verified && (c.seconds === item.seconds || (c.segStartSec <= item.seconds && item.seconds <= c.endSec)));
    if (alreadyCovered) continue;
    const verified = verifyCitation({ time: item.rawTime }, segmentIndex, {
      similarityThreshold: options.similarityThreshold,
    });
    pushVerified(verified);
  }
  return out.slice(0, 8);
}

function buildSectionQaMessages({ courseTitle, section, contextText, history = [], question }) {
  const system = [
    '你是网大课程的课节级学习问答助教。请严格依据下方提供的「本课节知识点与带编号字幕分段」回答学员问题。',
    '核心要求：',
    '1. 严禁凭空编造课程未讲过的内容；若字幕中未提及，请直接说明「本课节字幕未提及该内容」，不要瞎编；',
    '2. 所有出处只能引用下方字幕提供的分段编号（在文内使用 [S01]、[S02] 格式标注），严禁自行估算或编造时间点，严禁引用不存在的编号；',
    '3. 优先输出合法 JSON（无多余前后缀）：{"answer":"简明易懂的中文回答，文内只用 [S01] 形式标注出处","citations":[{"segId":"S01","quote":"对应原字幕关键词或短句(6~28字，用于核验)","note":"依据简述(<=24字)"}]}；',
    `当前课程：《${courseTitle || '当前课程'}》`,
    `当前课节：《${section?.title || '当前课节'}》`,
    '',
    contextText,
  ].join('\n');

  const trimmedHistory = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-wdKtutHistoryTurnsForPrompt)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 1200) }));

  return [
    { role: 'system', content: system },
    ...trimmedHistory,
    { role: 'user', content: String(question ?? '').trim() },
  ];
}

async function wdKtutInvokeLlm({ settings, messages, gmRequest, fetchFn, signal, timeoutMs = 45000 }) {
  const { content, channel } = await invokeAiChat({
    settings,
    messages,
    temperature: 0.25,
    gmRequest,
    fetchFn,
    signal,
    timeoutMs,
  });
  return { content: content.trim(), channel };
}

async function askSectionQuestion({ win, courseTitle, courseId, section, question, sessionId = null, settings, gmRequest, fetchFn, signal, maxContextChars = 7500, timeoutMs = 45000, similarityThreshold } = {}) {
  const qText = String(question ?? '').trim();
  if (!qText) return { ok: false, error: '请输入你想提问的内容。' };
  if (!sectionHasSubtitle(section)) {
    return {
      ok: false,
      noSubtitle: true,
      error: section?.subtitleReason || '本课无字幕：该课节没有 AI 字幕，因此无法基于字幕进行 AI 问答。',
    };
  }
  const cfg = settings || loadAiSettings(win);
  if (!cfg?.apiKey?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先点击「AI 设置」填写 Provider、Base URL 与 API Key。' };
  }
  try { validateAiEndpoint(cfg); } catch (err) {
    return { ok: false, needsAiConfig: true, error: `AI 配置无效（${err.message}），请检查「AI 设置」。` };
  }
  if (!cfg.model?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先在「AI 设置」中填写模型名。' };
  }

  const sectionId = section?.sectionId || 'current';
  const stored = loadSectionChat(win, courseId, sectionId, sessionId);
  const targetSessionId = sessionId || stored.activeSessionId;
  const ctx = selectRelevantSectionContext(section, qText, { maxContextChars });
  const messages = buildSectionQaMessages({
    courseTitle,
    section,
    contextText: ctx.contextText,
    history: stored.messages,
    question: qText,
  });

  try {
    const { content, channel } = await wdKtutInvokeLlm({ settings: cfg, messages, gmRequest, fetchFn, signal, timeoutMs });
    let answer = content;
    let rawCitations = [];
    try {
      const parsed = parseStrictJsonContent(content);
      if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
        answer = parsed.answer.trim();
        rawCitations = parsed.citations || parsed.evidence || parsed.references || [];
      }
    } catch {
      // Graceful plain-text fallback: keep full answer text & extract/verify [Sxx] / mm:ss
    }
    const citations = normalizeAndVerifyQaCitations(rawCitations, answer, ctx.segmentIndex, { similarityThreshold });
    const nowTs = Date.now();
    const userMsg = { id: `u-${nowTs}`, role: 'user', content: qText, createdAt: nowTs };
    const assistantMsg = {
      id: `a-${nowTs + 1}`,
      role: 'assistant',
      content: answer,
      citations,
      createdAt: nowTs + 1,
      contextMeta: {
        selectedSegments: ctx.selectedSegments,
        totalSegments: ctx.totalSegments,
        truncated: ctx.truncated,
      },
    };
    const nextMessages = [...stored.messages, userMsg, assistantMsg].slice(-wdKtutMaxMessagesPerSession);
    saveSectionChat(win, courseId, sectionId, nextMessages, targetSessionId);
    return { ok: true, sessionId: targetSessionId, message: assistantMsg, messages: nextMessages, contextMeta: assistantMsg.contextMeta, channel };
  } catch (err) {
    return { ok: false, error: `AI 提问失败：${err?.message || err}` };
  }
}

function buildSectionQuizPrompt({ courseTitle, section, contextText }) {
  const system = [
    '你是企业培训课程出题教练。请严格根据下方本课节知识点与带分段编号 [S01]、[S02]… 的字幕原文，出 4 道高质量自测题（默认 2~3 道单选题 + 1~2 道简答题，总题数 3~5 题）。',
    '只输出合法 JSON，不要任何前言或解释。',
    'JSON Schema：',
    '{"questions":[{"type":"choice","question":"单选题干？","options":["A. 选项一","B. 选项二","C. 选项三","D. 选项四"],"correctIndex":0,"explanation":"结合依据 [S01] 说明解析","segId":"S01","quote":"对应原字幕关键词或短句(6~24字)"},{"type":"short","question":"简答题干？","referenceAnswer":"简洁参考答案要点","explanation":"结合依据 [S01] 说明解析","segId":"S01","quote":"对应原字幕关键词或短句(6~24字)"}]}',
    '规则：',
    '1. 题目必须紧扣本课节核心知识点，不得编造字幕未提及的考点；',
    '2. 每道选择题必须恰好 4 个清晰选项且 correctIndex 为 0~3 的整数；',
    '3. 每道题的出处只能引用输入字幕中存在的分段编号 segId（如 "S01"）并附原话短句 quote，在 explanation 中用 [S01] 标注依据，严禁编造不存在的编号或时间戳。',
  ].join('\n');
  const user = `课程：《${courseTitle || '当前课程'}》\n课节：《${section?.title || '当前课节'}》\n\n${contextText}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function wdKtutParseChoiceIndex(raw, optionsLen) {
  if (Number.isInteger(raw) && raw >= 0 && raw < optionsLen) return raw;
  const s = String(raw ?? '').trim().toUpperCase();
  if (/^\d+$/u.test(s)) {
    const n = Number(s);
    if (n >= 0 && n < optionsLen) return n;
  }
  const letter = /^[A-D]/u.exec(s);
  if (letter) {
    const idx = letter[0].charCodeAt(0) - 65;
    if (idx >= 0 && idx < optionsLen) return idx;
  }
  return 0;
}

function normalizeQuizPaper(data, options = {}) {
  const rawList = Array.isArray(data?.questions) ? data.questions
    : Array.isArray(data?.quiz) ? data.quiz
    : Array.isArray(data?.items) ? data.items : [];
  const segmentIndex = options.segmentIndex
    || (options.section ? buildSegmentIndex(options.section) : null);
  const questions = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const qText = String(item.question || item.q || item.prompt || '').trim();
    if (!qText) continue;
    const rawOpts = Array.isArray(item.options) ? item.options.map(o => String(o ?? '').trim()).filter(Boolean) : [];
    const declaredType = String(item.type || '').toLowerCase();
    const isChoice = declaredType === 'choice' || declaredType === 'single' || declaredType === 'mcq' || rawOpts.length >= 2;
    const explanation = String(item.explanation || item.analysis || item.reason || '').trim();

    // Verify citation via unified lookup table (both segId and legacy time MUST pass verification)
    let citation = null;
    let floorSec = null;
    let ts = '';
    let segId = null;
    let refKey = null;
    let citationStatus = 'none';
    const inlineIds = extractSegmentIdsFromText(explanation);
    const hasExplicitRef = Boolean(
      item.segId !== undefined && item.segId !== null && item.segId !== ''
      || item.seg_id !== undefined && item.seg_id !== null && item.seg_id !== ''
      || item.ref !== undefined && item.ref !== null && item.ref !== ''
      || item.time !== undefined && item.time !== null && item.time !== ''
      || item.timestamp !== undefined && item.timestamp !== null && item.timestamp !== ''
      || item.seconds !== undefined && item.seconds !== null && item.seconds !== ''
      || inlineIds.length > 0,
    );
    if (hasExplicitRef) {
      const refCandidate = {
        ...item,
        segId: item.segId ?? item.seg_id ?? item.ref ?? (inlineIds[0]?.raw || undefined),
      };
      if (segmentIndex) {
        const claimForCheck = `${qText} ${explanation}`;
        citation = verifyCitation(refCandidate, segmentIndex, {
          claimText: claimForCheck,
          similarityThreshold: options.similarityThreshold,
        });
        citationStatus = citation.status;
        segId = citation.segId;
        refKey = citation.refKey;
        if (citation.verified) {
          floorSec = citation.seconds;
          ts = citation.timestamp;
        }
      } else {
        const normId = normalizeSegmentId(refCandidate.segId);
        const sec = parseTimestampToSeconds(item.time ?? item.timestamp ?? item.seconds);
        segId = normId?.segId || null;
        floorSec = sec === null ? null : Math.floor(sec);
        ts = floorSec === null ? '' : formatTimestamp(floorSec);
        citationStatus = segId || floorSec !== null ? 'unverified' : 'none';
      }
    }

    if (isChoice && rawOpts.length >= 2) {
      const optionsList = rawOpts.slice(0, 4).map((opt, idx) => {
        const prefix = `${String.fromCharCode(65 + idx)}. `;
        return /^[A-D][.、:：\s]/iu.test(opt) ? opt : `${prefix}${opt}`;
      });
      const correctIndex = wdKtutParseChoiceIndex(item.correctIndex ?? item.answerIndex ?? item.answer, optionsList.length);
      questions.push({
        id: `q-${questions.length + 1}`,
        type: 'choice',
        question: qText,
        options: optionsList,
        correctIndex,
        answerLetter: String.fromCharCode(65 + correctIndex),
        explanation: explanation || `正确答案为 ${optionsList[correctIndex]}${segId ? `（参见 [${segId}]）` : (ts ? `（参见 ${ts}）` : '')}。`,
        seconds: floorSec,
        timestamp: ts,
        ...(segId ? { segId } : {}),
        ...(refKey ? { refKey } : {}),
        ...(citationStatus !== 'none' ? { citationStatus } : {}),
        ...(citation ? { citation } : {}),
      });
    } else {
      const referenceAnswer = String(item.referenceAnswer || item.answer || item.a || explanation || '').trim();
      if (!referenceAnswer) continue;
      questions.push({
        id: `q-${questions.length + 1}`,
        type: 'short',
        question: qText,
        referenceAnswer,
        explanation: explanation || (segId ? `详见依据 [${segId}]${ts ? `（${ts}）` : ''}讲解。` : (ts ? `详见视频约第 ${Math.floor(floorSec / 60) + 1} 分钟（${ts}）讲解。` : '')),
        seconds: floorSec,
        timestamp: ts,
        ...(segId ? { segId } : {}),
        ...(refKey ? { refKey } : {}),
        ...(citationStatus !== 'none' ? { citationStatus } : {}),
        ...(citation ? { citation } : {}),
      });
    }
    if (questions.length >= 5) break;
  }
  if (!questions.length) throw new Error('模型未返回有效题目列表');
  return questions;
}

function gradeSectionQuiz(questions, answers = {}) {
  const list = Array.isArray(questions) ? questions : [];
  let choiceTotal = 0;
  let choiceCorrect = 0;
  let shortTotal = 0;
  const details = {};
  for (const q of list) {
    if (q.type === 'choice') {
      choiceTotal += 1;
      const chosen = answers[q.id];
      const validChosen = Number.isInteger(chosen) ? chosen : null;
      const isCorrect = validChosen !== null && validChosen === q.correctIndex;
      if (isCorrect) choiceCorrect += 1;
      details[q.id] = { type: 'choice', chosen: validChosen, correct: isCorrect, correctIndex: q.correctIndex };
    } else {
      shortTotal += 1;
      details[q.id] = { type: 'short', text: String(answers[q.id] ?? '').trim(), autoGraded: false };
    }
  }
  const percent = choiceTotal > 0 ? Math.round((choiceCorrect / choiceTotal) * 100) : null;
  return { choiceTotal, choiceCorrect, shortTotal, percent, details };
}

async function generateSectionQuiz({ win, courseTitle, courseId, section, settings, forceRefresh = false, gmRequest, fetchFn, signal, maxContextChars = 7500, timeoutMs = 45000 }) {
  const sectionId = section?.sectionId || 'current';
  if (!sectionHasSubtitle(section)) {
    return {
      ok: false,
      noSubtitle: true,
      error: section?.subtitleReason || '本课无字幕：该课节没有 AI 字幕，因此无法基于字幕用 AI 出题。',
    };
  }
  const cfg = settings || loadAiSettings(win);
  if (!forceRefresh) {
    const cached = loadSectionQuiz(win, courseId, sectionId);
    if (cached) {
      const sameProvider = !cached.provider || !cfg?.provider || cached.provider === cfg.provider;
      const sameModel = !cached.model || !cfg?.model || cached.model === cfg.model;
      if (!cfg?.apiKey?.trim() || (sameProvider && sameModel)) {
        return { ok: true, quiz: cached, fromCache: true };
      }
    }
  }
  if (!cfg?.apiKey?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先点击「AI 设置」填写 Provider、Base URL 与 API Key 后再使用「用 AI 出题」。' };
  }
  try { validateAiEndpoint(cfg); } catch (err) {
    return { ok: false, needsAiConfig: true, error: `AI 配置无效（${err.message}），请检查「AI 设置」。` };
  }
  if (!cfg.model?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先在「AI 设置」中填写模型名。' };
  }

  const ctx = selectRelevantSectionContext(section, '', { maxContextChars });
  if (ctx.totalSegments === 0 && !(section?.keyPoints?.length || section?.outline?.length)) {
    return { ok: false, error: '当前课节暂无可用字幕或知识点，无法出题。' };
  }
  const messages = buildSectionQuizPrompt({ courseTitle, section, contextText: ctx.contextText });
  try {
    const { content, channel } = await wdKtutInvokeLlm({ settings: cfg, messages, gmRequest, fetchFn, signal, timeoutMs });
    const parsed = parseStrictJsonContent(content);
    const questions = normalizeQuizPaper(parsed, { segmentIndex: ctx.segmentIndex });
    const quizRecord = {
      cachedAt: Date.now(),
      sectionId,
      sectionTitle: section?.title || '当前课节',
      provider: cfg.provider,
      model: cfg.model,
      questions,
      attempt: { answers: {}, submitted: false, submittedAt: null },
      contextMeta: { selectedSegments: ctx.selectedSegments, totalSegments: ctx.totalSegments, truncated: ctx.truncated },
    };
    saveSectionQuiz(win, courseId, sectionId, quizRecord);
    return { ok: true, quiz: quizRecord, fromCache: false, channel };
  } catch (err) {
    return { ok: false, error: `AI 出题失败：${err?.message || err}` };
  }
}

function wdKtutNormalizeStatusLabel(raw) {
  const txt = String(raw ?? '').trim();
  if (txt === '已完成' || txt === 'completed') return 'completed';
  if (txt === '学习中' || txt === 'learning') return 'learning';
  if (txt === '未开始' || txt === 'not-started') return 'not-started';
  return 'unknown';
}

function wdKtutParseProgressNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?%?$/u.test(trimmed)) {
      const n = Number(trimmed.replace(/%$/u, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
  }
  return null;
}

function evaluateSectionStudyStatus({ domStatus = 'unknown', modelFinishStatus = null, progress = null, active = false, isPlaying = false } = {}) {
  const domState = wdKtutNormalizeStatusLabel(domStatus);
  const modelState = wdKtutNormalizeStatusLabel(modelFinishStatus);
  const pct = wdKtutParseProgressNumber(progress);

  // 1. Verified completed
  if (domState === 'completed') return { eligible: true, state: 'completed', reason: 'DOM 状态：已完成' };
  if (domState === 'unknown' && (modelState === 'completed' || (pct !== null && pct >= 100))) {
    return { eligible: true, state: 'completed', reason: '模型/进度状态：已完成' };
  }

  // 2. Verified learning
  if (domState === 'learning') return { eligible: true, state: 'learning', reason: 'DOM 状态：学习中' };
  if (domState === 'unknown' && (modelState === 'learning' || (pct !== null && pct > 0 && pct < 100))) {
    return { eligible: true, state: 'learning', reason: '模型/进度状态：学习中' };
  }

  // 3. Explicit not-started: only allow when this exact section is actively playing right now
  if (domState === 'not-started' || modelState === 'not-started') {
    if (active && isPlaying) return { eligible: true, state: 'learning', reason: '当前选中课节正在播放中' };
    return { eligible: false, state: 'not-started', reason: '课节未开始，不显示 AI 导览标识' };
  }

  // 4. Conservative fallback when platform status is missing / conflicting / unclear
  return { eligible: false, state: 'unknown', reason: '无法可靠判定学习状态，按保守策略不显示' };
}

function shouldShowSectionGuide({ hasSubtitle, studyStatus } = {}) {
  const subOk = hasSubtitle === true;
  const studyOk = Boolean(studyStatus && studyStatus.eligible === true);
  return subOk && studyOk;
}

function readSectionDomStudyStatus(dl, modelSection = null, doc = null) {
  // Exact same selector and consensus rule as adapter.js (L56-L60, L565)
  const spans = [...(dl?.querySelectorAll?.('dd .item.start.pointer > span, dd .item.continue.pointer > span') || [])];
  const texts = spans.map(el => (el?.textContent || '').trim());
  let domStatus = 'unknown';
  if (texts.length > 0 && texts.every(v => v === texts[0])) {
    domStatus = wdKtutNormalizeStatusLabel(texts[0]);
  }
  const active = Boolean(dl?.classList?.contains?.('focus'));
  let isPlaying = false;
  if (active && doc?.querySelectorAll) {
    const visibleMedia = [...doc.querySelectorAll('video,audio')].filter(el => el.isConnected && !el.hidden);
    if (visibleMedia.length === 1) {
      const m = visibleMedia[0];
      isPlaying = Boolean((!m.paused && !m.ended) || (Number.isFinite(m.currentTime) && m.currentTime > 0));
    }
  }
  const modelFinishStatus = modelSection?.finishStatus ?? null;
  const progress = modelSection?.completedRate ?? modelSection?.progress ?? null;
  return evaluateSectionStudyStatus({ domStatus, modelFinishStatus, progress, active, isPlaying });
}

function mountSectionGuideButtons({ win, pageWin = win, httpGet = null, maxConcurrency = 2, onOpenSection } = {}) {
  const doc = win?.document;
  if (!doc || typeof onOpenSection !== 'function') {
    return { refresh() { return 0; }, setSubtitleStatuses() {}, flushProbes() { return Promise.resolve(); }, destroy() {} };
  }
  let destroyed = false;
  let scheduled = false;
  let lastRouteCourseId = null;
  const pendingPromises = new Set();
  const prober = createSubtitleAvailabilityProber({ win, pageWin, httpGet, maxConcurrency });

  const ensureStyle = () => {
    if (doc.getElementById(wdKtutStyleId)) return;
    const style = doc.createElement('style');
    style.id = wdKtutStyleId;
    style.textContent = [
      '.wd-sec-guide-btn{display:inline-flex;align-items:center;gap:3px;margin-left:8px;padding:2px 8px;min-height:22px;line-height:16px;font-size:11px;font-weight:600;letter-spacing:-0.01em;font-family:-apple-system,BlinkMacSystemFont,"Inter","PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1d4ed8;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.26);border-radius:999px;cursor:pointer;vertical-align:middle;position:relative;z-index:2;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .12s ease;}',
      '.wd-sec-guide-btn:hover{background:rgba(37,99,235,.15);border-color:rgba(37,99,235,.48);color:#1e40af;}',
      '.wd-sec-guide-btn:active{transform:scale(.97);}',
      '.wd-sec-guide-btn:focus-visible{outline:2px solid #2563eb;outline-offset:2px;}',
      '@media (prefers-color-scheme:dark){.wd-sec-guide-btn{color:#93c5fd;background:rgba(59,130,246,.16);border-color:rgba(96,165,250,.36);}.wd-sec-guide-btn:hover{background:rgba(59,130,246,.28);border-color:rgba(96,165,250,.6);color:#dbeafe;}}',
    ].join('');
    (doc.head || doc.documentElement).append(style);
  };

  const extractSectionId = dl => {
    const id = String(dl?.id || '');
    const pos = id.lastIndexOf('show-sections');
    if (pos < 0) return null;
    const raw = id.slice(pos + 'show-sections'.length);
    return /^[A-Za-z0-9_-]+$/u.test(raw) ? raw : null;
  };

  const stopAll = ev => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
  };

  const removeGuideFromDl = dl => {
    const existing = dl.querySelector(':scope > dd > button[data-wd-section-guide], :scope > button[data-wd-section-guide]');
    if (existing) existing.remove();
  };

  const ensureGuideOnDl = (dl, sectionId) => {
    ensureStyle();
    let btn = dl.querySelector(':scope > dd > button[data-wd-section-guide], :scope > button[data-wd-section-guide]');
    if (btn) {
      btn.dataset.wdSectionGuide = sectionId;
      return;
    }
    btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'wd-sec-guide-btn';
    btn.dataset.wdSectionGuide = sectionId;
    btn.textContent = '💡 AI 导览';
    btn.title = '打开本课节 AI 导览（总结 / 时间轴 / 问答 / 出题）';
    btn.setAttribute('aria-label', '打开课节 AI 导览');
    btn.addEventListener('mousedown', stopAll);
    btn.addEventListener('pointerdown', stopAll);
    btn.addEventListener('click', ev => {
      stopAll(ev);
      const titleEl = dl.querySelector('.qcontent');
      const title = (titleEl?.getAttribute?.('title') || titleEl?.textContent || '').trim();
      const courseId = dl.getAttribute('data-course-id') ?? dl.getAttribute('data-courseid') ?? null;
      onOpenSection({ sectionId, title, courseId });
    });
    const host = dl.querySelector(':scope > dd') || dl;
    host.append(btn);
  };

  const refresh = () => {
    if (destroyed) return 0;
    const dls = [...doc.querySelectorAll('.chapter-list.chapter-all ul li dl[id*="show-sections"]')];
    if (!dls.length) return 0;
    const firstCourseId = dls[0].getAttribute('data-course-id') ?? dls[0].getAttribute('data-courseid') ?? null;
    if (lastRouteCourseId && firstCourseId && lastRouteCourseId !== firstCourseId) {
      prober.resetPending();
    }
    if (firstCourseId) lastRouteCourseId = firstCourseId;

    let eligibleMounted = 0;
    for (const dl of dls) {
      const sectionId = extractSectionId(dl);
      if (!sectionId) continue;
      const courseId = dl.getAttribute('data-course-id') ?? dl.getAttribute('data-courseid') ?? null;
      const resourceId = dl.getAttribute('data-resource-id') ?? dl.getAttribute('data-resourceid') ?? null;
      const active = dl.classList.contains('focus');
      const modInfo = prober.lookupSectionModuleInfo(courseId, sectionId, resourceId);
      const study = readSectionDomStudyStatus(dl, modInfo.matchedSection, doc);

      // Gate 1: Must be explicitly learning or completed; unstarted / unknown never shows & never triggers network probe!
      if (!study.eligible) {
        removeGuideFromDl(dl);
        continue;
      }

      // Gate 2: Must have usable subtitles (captionVtt or Video.js captions cues); lazy + bounded concurrency + cached!
      const cached = prober.getCached({ courseId, sectionId, resourceId, active });
      if (cached) {
        if (shouldShowSectionGuide({ hasSubtitle: cached.available, studyStatus: study })) {
          ensureGuideOnDl(dl, sectionId);
          eligibleMounted += 1;
        } else {
          removeGuideFromDl(dl);
        }
        continue;
      }

      // Do not render placeholder while probing; probe lazily in background and update asynchronously
      removeGuideFromDl(dl);
      const probePromise = prober.probeSection({ courseId, sectionId, resourceId, active }).then(res => {
        if (destroyed || !dl.isConnected) return;
        const latestModInfo = prober.lookupSectionModuleInfo(courseId, sectionId, resourceId);
        const latestStudy = readSectionDomStudyStatus(dl, latestModInfo.matchedSection, doc);
        if (shouldShowSectionGuide({ hasSubtitle: res?.available === true, studyStatus: latestStudy })) {
          ensureGuideOnDl(dl, sectionId);
        } else {
          removeGuideFromDl(dl);
        }
      });
      pendingPromises.add(probePromise);
      probePromise.finally(() => pendingPromises.delete(probePromise));
    }
    return eligibleMounted;
  };

  const setSubtitleStatuses = (statusMap, courseId = null) => {
    if (destroyed || !statusMap || typeof statusMap !== 'object') return;
    for (const [sid, info] of Object.entries(statusMap)) {
      if (!sid) continue;
      if (info && typeof info.hasSubtitle === 'boolean') {
        prober.setConfirmed(String(sid), info.hasSubtitle, courseId || lastRouteCourseId);
      }
    }
    refresh();
  };

  const scheduleRefresh = () => {
    if (destroyed || scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      refresh();
    });
  };

  const onHashChange = () => {
    prober.resetPending();
    scheduleRefresh();
  };

  const onMediaPlay = ev => {
    if (destroyed) return;
    const target = ev?.target;
    if (target && (target.tagName === 'VIDEO' || target.tagName === 'AUDIO')) {
      scheduleRefresh();
    }
  };

  const observer = typeof win.MutationObserver === 'function'
    ? new win.MutationObserver(records => {
      if (destroyed) return;
      for (const rec of records) {
        if (rec.type === 'attributes') {
          if (rec.target?.nodeType === 1 && !rec.target.closest?.('#wangda-assistant') && rec.target.matches?.('dl[id*="show-sections"]')) {
            scheduleRefresh();
            return;
          }
          continue;
        }
        for (const node of rec.addedNodes) {
          if (node.nodeType === 1 && node.id !== wdKtutStyleId && !node.matches?.('[data-wd-section-guide]') && !node.closest?.('#wangda-assistant')) {
            scheduleRefresh();
            return;
          }
          if (node.nodeType === 3 && node.parentElement?.closest?.('dl[id*="show-sections"]')) {
            scheduleRefresh();
            return;
          }
        }
      }
    })
    : null;
  if (observer && doc.body) observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  win.addEventListener?.('hashchange', onHashChange);
  doc.addEventListener?.('play', onMediaPlay, true);
  refresh();

  return {
    refresh,
    setSubtitleStatuses,
    flushProbes: async () => {
      while (pendingPromises.size > 0) {
        await Promise.allSettled([...pendingPromises]);
      }
    },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      win.removeEventListener?.('hashchange', onHashChange);
      doc.removeEventListener?.('play', onMediaPlay, true);
      prober.destroy();
      for (const btn of doc.querySelectorAll('button[data-wd-section-guide]')) btn.remove();
      doc.getElementById(wdKtutStyleId)?.remove();
    },
  };
}



const wdKmapCdnPairs = [
  ['https://cdn.jsdelivr.net/npm/markmap-lib@0.18.13/+esm', 'https://cdn.jsdelivr.net/npm/markmap-view@0.18.13/+esm'],
  ['https://fastly.jsdelivr.net/npm/markmap-lib@0.18.13/+esm', 'https://fastly.jsdelivr.net/npm/markmap-view@0.18.13/+esm'],
  ['https://esm.sh/markmap-lib@0.18.13', 'https://esm.sh/markmap-view@0.18.13'],
];

let wdKmapCachedEngine = null;

function wdKmapTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDN 加载超时')), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

async function loadMarkmapEngine({ importer, timeoutMs = 4500 } = {}) {
  if (!importer && wdKmapCachedEngine) return wdKmapCachedEngine;
  const doImport = typeof importer === 'function' ? importer : (url => import(url));
  const tryPair = async ([libUrl, viewUrl]) => {
    const [lib, view] = await Promise.all([doImport(libUrl), doImport(viewUrl)]);
    if (typeof lib?.Transformer === 'function' && typeof view?.Markmap?.create === 'function') {
      return { Transformer: lib.Transformer, Markmap: view.Markmap, source: libUrl };
    }
    throw new Error('markmap 导出不完整');
  };
  try {
    const engine = await wdKmapTimeout(Promise.any(wdKmapCdnPairs.map(tryPair)), timeoutMs);
    if (!importer) wdKmapCachedEngine = engine;
    return engine;
  } catch {
    return null;
  }
}

function parseMarkdownOutline(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/gu, '\n').split('\n');
  const root = { label: '课程导览', depth: 0, seek: null, children: [] };
  const stack = [root];
  const parsePoint = raw => {
    const match = /^(.*?)\s*\[([0-9:]+)\]\((#wd-seek-[^)]+)\)\s*$/u.exec(raw);
    if (!match) return { label: raw.trim(), seek: null, timeText: '' };
    return { label: match[1].trim(), timeText: match[2], seek: parseSeekHref(match[3]) };
  };
  let rootUsed = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const hMatch = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (hMatch) {
      const depth = hMatch[1].length;
      const text = hMatch[2].trim();
      if (depth === 1 && !rootUsed) {
        root.label = text;
        rootUsed = true;
        stack.length = 1;
        continue;
      }
      while (stack.length > 1 && stack.at(-1).depth >= depth) stack.pop();
      const node = { label: text, depth, seek: null, timeText: '', children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
      continue;
    }
    const liMatch = /^[-*+]\s+(.+)$/u.exec(line);
    if (liMatch) {
      const info = parsePoint(liMatch[1]);
      const depth = (stack.at(-1)?.depth || 1) + 1;
      stack.at(-1).children.push({ label: info.label, timeText: info.timeText, seek: info.seek, depth, children: [] });
    }
  }
  return root;
}

function wdKmapRenderFallbackSvg(svg, markdown, onSeek) {
  const doc = svg.ownerDocument;
  const NS = 'http://www.w3.org/2000/svg';
  const createSvg = (tag, attrs = {}) => {
    const node = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const tree = parseMarkdownOutline(markdown);
  const collapsed = new Set();
  let scale = 1;
  let panX = 24;
  let panY = 24;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  const colors = ['#176ac2', '#1c7ed6', '#2b8a3e', '#5f3dc4', '#c92a2a'];

  const draw = () => {
    svg.replaceChildren();
    const viewport = createSvg('g', { transform: `translate(${panX},${panY}) scale(${scale})` });
    svg.append(viewport);
    const colWidths = [210, 250, 250, 290, 280];
    const rowHeight = 46;
    let nextY = 0;

    const layout = (node, level, idPath) => {
      const isCollapsed = collapsed.has(idPath);
      const kids = isCollapsed ? [] : node.children;
      const x = colWidths.slice(0, level).reduce((a, b) => a + b, 0);
      let y;
      const childCoords = [];
      if (!kids.length) {
        y = nextY * rowHeight + 20;
        nextY += 1;
      } else {
        for (let i = 0; i < kids.length; i += 1) {
          childCoords.push(layout(kids[i], level + 1, `${idPath}.${i}`));
        }
        y = (childCoords[0].y + childCoords.at(-1).y) / 2;
      }
      const color = colors[Math.min(level, colors.length - 1)];
      for (const child of childCoords) {
        const midX = x + (colWidths[level] || 220) - 24;
        const path = createSvg('path', {
          d: `M ${x + 150} ${y} C ${midX} ${y}, ${midX} ${child.y}, ${child.x} ${child.y}`,
          fill: 'none',
          stroke: color,
          'stroke-opacity': '0.45',
          'stroke-width': '1.6',
        });
        viewport.append(path);
      }
      const group = createSvg('g', { class: 'wd-fallback-node', 'data-node-id': idPath, transform: `translate(${x},${y})` });
      const rawLabel = String(node.label || '').replace(/(?:\u2026|\.{2,})\s*$/u, '').trim() || node.label || '';
      const wrapLabelLines = (str, maxUnits = 20) => {
        const lines = [];
        let cur = '';
        let units = 0;
        for (const ch of str) {
          const w = /[\u2e80-\uffff]/u.test(ch) ? 1 : 0.6;
          if (cur && units + w > maxUnits) {
            lines.push(cur);
            cur = ch;
            units = w;
          } else {
            cur += ch;
            units += w;
          }
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [str];
      };
      const labelLines = wrapLabelLines(rawLabel, 20);
      const maxLineUnits = Math.max(...labelLines.map(line => [...line].reduce((s, ch) => s + (/[\u2e80-\uffff]/u.test(ch) ? 12 : 7), 0)));
      const boxWidth = Math.min(268, Math.max(96, Math.ceil(maxLineUnits) + (node.timeText ? 54 : 20)));
      const lineHeight = 15;
      const boxHeight = Math.max(24, labelLines.length * lineHeight + 10);
      const rect = createSvg('rect', {
        x: 0,
        y: -Math.round(boxHeight / 2),
        width: boxWidth,
        height: boxHeight,
        rx: 5,
        fill: level === 0 ? '#176ac2' : '#f4f9ff',
        stroke: color,
        'stroke-width': level === 0 ? '0' : '1',
      });
      const text = createSvg('text', {
        x: 8,
        y: labelLines.length === 1 ? 4 : -Math.round(((labelLines.length - 1) * lineHeight) / 2) + 4,
        fill: level === 0 ? '#ffffff' : '#17344d',
        'font-size': level === 0 ? '13' : '12',
        'font-family': 'system-ui,"Microsoft YaHei",sans-serif',
      });
      if (labelLines.length === 1) {
        text.textContent = labelLines[0];
      } else {
        labelLines.forEach((line, idx) => {
          const tspan = createSvg('tspan', { x: 8, dy: idx === 0 ? 0 : lineHeight });
          tspan.textContent = line;
          text.append(tspan);
        });
      }
      group.append(rect, text);

      if (node.seek && node.timeText) {
        const link = createSvg('a', { href: `#wd-seek-${encodeURIComponent(node.seek.sectionId)}-${node.seek.seconds}`, 'data-seek-time': node.timeText });
        const badge = createSvg('text', {
          x: boxWidth - 42,
          y: 4,
          fill: '#176ac2',
          'font-size': '11',
          'font-weight': '600',
          style: 'cursor:pointer;text-decoration:underline;',
        });
        badge.textContent = node.timeText;
        link.append(badge);
        link.addEventListener('click', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          onSeek?.(node.seek);
        });
        group.append(link);
      }

      if (node.children.length) {
        const toggle = createSvg('circle', {
          cx: boxWidth + 7,
          cy: 0,
          r: 6,
          fill: isCollapsed ? color : '#ffffff',
          stroke: color,
          'stroke-width': '1.5',
          style: 'cursor:pointer;',
          'data-toggle-node': idPath,
        });
        toggle.addEventListener('click', ev => {
          ev.stopPropagation();
          if (collapsed.has(idPath)) collapsed.delete(idPath);
          else collapsed.add(idPath);
          draw();
        });
        group.append(toggle);
      }
      viewport.append(group);
      return { x, y };
    };

    layout(tree, 0, '0');
    const totalHeight = Math.max(320, nextY * rowHeight + 60);
    svg.setAttribute('viewBox', `0 0 1080 ${totalHeight}`);
  };

  const onWheel = ev => {
    ev.preventDefault();
    scale = Math.min(2.2, Math.max(0.45, scale * (ev.deltaY > 0 ? 0.9 : 1.1)));
    draw();
  };
  const onPointerDown = ev => {
    if (ev.target?.closest?.('a,circle')) return;
    dragging = true; startX = ev.clientX - panX; startY = ev.clientY - panY;
  };
  const onPointerMove = ev => {
    if (!dragging) return;
    panX = ev.clientX - startX; panY = ev.clientY - startY; draw();
  };
  const onPointerUp = () => { dragging = false; };
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('mousedown', onPointerDown);
  svg.addEventListener('mousemove', onPointerMove);
  svg.addEventListener('mouseup', onPointerUp);
  svg.addEventListener('mouseleave', onPointerUp);
  draw();
  return {
    engine: 'fallback-svg',
    fit() { scale = 1; panX = 24; panY = 24; draw(); },
    destroy() {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('mousedown', onPointerDown);
      svg.removeEventListener('mousemove', onPointerMove);
      svg.removeEventListener('mouseup', onPointerUp);
      svg.removeEventListener('mouseleave', onPointerUp);
    },
  };
}

async function renderKnowledgeMindmap({ svg, markdown, onSeek, importer, skipCdn = false } = {}) {
  if (!svg) return { engine: 'none', fit() {}, destroy() {} };
  const handleLinkClick = ev => {
    const anchor = ev.target?.closest?.('a[href^="#wd-seek-"]');
    if (!anchor) return;
    const parsed = parseSeekHref(anchor.getAttribute('href'));
    if (!parsed) return;
    ev.preventDefault();
    ev.stopPropagation();
    onSeek?.(parsed);
  };

  if (!skipCdn) {
    const engine = await loadMarkmapEngine({ importer });
    if (engine) {
      try {
        svg.replaceChildren();
        const transformer = new engine.Transformer();
        const { root } = transformer.transform(String(markdown ?? ''));
        const mm = engine.Markmap.create(svg, { autoFit: true, duration: 200 }, root);
        svg.addEventListener('click', handleLinkClick);
        return {
          engine: 'markmap',
          source: engine.source,
          fit() { try { mm?.fit?.(); } catch { /* ignore */ } },
          destroy() {
            svg.removeEventListener('click', handleLinkClick);
            try { mm?.destroy?.(); } catch { /* ignore */ }
          },
        };
      } catch {
        // Fall through to built-in SVG fallback
      }
    }
  }
  return wdKmapRenderFallbackSvg(svg, markdown, onSeek);
}









function createPanel(win, controller, version, knowledge = null) {
  const document = win.document;
  const existing = document.getElementById('wangda-assistant');
  if (existing?.wdPanel) return existing.wdPanel;
  const kg = knowledge || createKnowledgeService({ win, pageWin: win, controller });
  const host = document.createElement('div');
  host.id = 'wangda-assistant';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  const wdUiThemeKey = 'wangda-assistant.ui.theme';
  const loadUiTheme = () => {
    try {
      const val = win.localStorage?.getItem?.(wdUiThemeKey);
      return ['auto', 'light', 'dark'].includes(val) ? val : 'auto';
    } catch { return 'auto'; }
  };
  const applyUiTheme = mode => {
    const valid = ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto';
    host.dataset.theme = valid;
    try { win.localStorage?.setItem?.(wdUiThemeKey, valid); } catch { /* ignore */ }
    return valid;
  };
  host.dataset.theme = loadUiTheme();
  const element = (tag, text = '', parent = root) => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  element('style', [
    ':host{all:initial;--bg:#ffffff;--surface:#f8fafc;--surface-2:#f1f5f9;--surface-hover:#e9eef5;--border:rgba(15,23,42,.10);--border-strong:rgba(15,23,42,.18);--text:#0f172a;--text-2:#475569;--text-3:#64748b;--accent:#2563eb;--accent-hover:#1d4ed8;--accent-soft:rgba(37,99,235,.08);--accent-border:rgba(37,99,235,.26);--accent-text:#1d4ed8;--success:#15803d;--success-soft:#ecfdf5;--success-border:#a7f3d0;--warn:#9a3412;--warn-soft:#fff7ed;--warn-border:#fed7aa;--danger:#dc2626;--danger-hover:#b91c1c;--danger-soft:#fef2f2;--danger-border:#fecaca;--cache:#6d28d9;--cache-soft:#f5f3ff;--ring:rgba(37,99,235,.32);--radius-xs:6px;--radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-pill:999px;--shadow-panel:0 12px 36px rgba(15,23,42,.14),0 2px 8px rgba(15,23,42,.06);--shadow-modal:0 24px 64px rgba(2,6,23,.32),0 4px 16px rgba(2,6,23,.14);color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Inter","PingFang SC","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}',
    '@media (prefers-color-scheme:dark){:host(:not([data-theme="light"])){--bg:#0f172a;--surface:#162032;--surface-2:#1e293b;--surface-hover:#263449;--border:rgba(148,163,184,.18);--border-strong:rgba(148,163,184,.30);--text:#f1f5f9;--text-2:#cbd5e1;--text-3:#94a3b8;--accent:#3b82f6;--accent-hover:#60a5fa;--accent-soft:rgba(59,130,246,.16);--accent-border:rgba(96,165,250,.36);--accent-text:#93c5fd;--success:#4ade80;--success-soft:rgba(34,197,94,.14);--success-border:rgba(74,222,128,.32);--warn:#fdba74;--warn-soft:rgba(249,115,22,.14);--warn-border:rgba(251,146,60,.34);--danger:#f87171;--danger-hover:#ef4444;--danger-soft:rgba(239,68,68,.15);--danger-border:rgba(248,113,113,.34);--cache:#c4b5fd;--cache-soft:rgba(139,92,246,.18);--ring:rgba(96,165,250,.45);--shadow-panel:0 14px 40px rgba(0,0,0,.48),0 2px 10px rgba(0,0,0,.32);--shadow-modal:0 28px 72px rgba(0,0,0,.64),0 6px 20px rgba(0,0,0,.4)}}',
    ':host([data-theme="dark"]){--bg:#0f172a;--surface:#162032;--surface-2:#1e293b;--surface-hover:#263449;--border:rgba(148,163,184,.18);--border-strong:rgba(148,163,184,.30);--text:#f1f5f9;--text-2:#cbd5e1;--text-3:#94a3b8;--accent:#3b82f6;--accent-hover:#60a5fa;--accent-soft:rgba(59,130,246,.16);--accent-border:rgba(96,165,250,.36);--accent-text:#93c5fd;--success:#4ade80;--success-soft:rgba(34,197,94,.14);--success-border:rgba(74,222,128,.32);--warn:#fdba74;--warn-soft:rgba(249,115,22,.14);--warn-border:rgba(251,146,60,.34);--danger:#f87171;--danger-hover:#ef4444;--danger-soft:rgba(239,68,68,.15);--danger-border:rgba(248,113,113,.34);--cache:#c4b5fd;--cache-soft:rgba(139,92,246,.18);--ring:rgba(96,165,250,.45);--shadow-panel:0 14px 40px rgba(0,0,0,.48),0 2px 10px rgba(0,0,0,.32);--shadow-modal:0 28px 72px rgba(0,0,0,.64),0 6px 20px rgba(0,0,0,.4)}',
    '*{box-sizing:border-box}[hidden]{display:none!important}button,input,select{font:inherit}',
    'button{cursor:pointer;border:1px solid var(--border-strong);background:var(--surface);border-radius:var(--radius-sm);padding:4px 10px;min-height:30px;color:var(--text);font-size:12.5px;font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:4px;transition:background .14s ease,border-color .14s ease,color .14s ease,transform .1s ease}',
    'button:hover:not(:disabled){background:var(--surface-hover);border-color:var(--border-strong)}button:active:not(:disabled){transform:scale(.98)}button:disabled{opacity:.46;cursor:not-allowed;filter:grayscale(.3)}',
    'button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.primary:hover:not(:disabled){background:var(--accent-hover);border-color:var(--accent-hover)}',
    'button.soft{background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border)}button.soft:hover:not(:disabled){background:var(--accent-border)}',
    'button.danger{color:var(--danger);border-color:var(--danger-border);background:var(--danger-soft)}button.danger:hover:not(:disabled){background:var(--danger-border)}',
    'button.danger-confirm{background:var(--danger);color:#fff;border-color:var(--danger)}button.danger-confirm:hover:not(:disabled){background:var(--danger-hover)}',
    'button.ghost{background:transparent;border-color:var(--border);color:var(--text-2)}button.ghost:hover:not(:disabled){background:var(--surface-2);color:var(--text)}',
    'section{width:372px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;max-height:calc(100dvh - 32px);background:var(--bg);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-panel);overflow:hidden}',
    'header{flex-shrink:0;padding:12px 14px 10px;background:var(--surface);border-bottom:1px solid var(--border)}',
    'header strong{font-size:14px;font-weight:600;letter-spacing:-0.01em;color:var(--text)}.brand-wrap{display:flex;align-items:center;gap:7px}.brand-dot{width:8px;height:8px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);flex-shrink:0}',
    '.headline,.buttons,.row{display:flex;align-items:center;gap:6px}.headline{justify-content:space-between}.buttons{flex-wrap:wrap;margin:8px 0}.detail-actions{justify-content:space-between}.leave-bar{margin:0 0 10px}.row{align-items:flex-start}.row label{flex:1;min-width:0}',
    'small,.muted{font-size:12px;color:var(--text-3)}.progress{margin-top:6px;font-size:12px;color:var(--text-2);font-variant-numeric:tabular-nums}',
    '.body{padding:12px 14px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:2px}.body>*{flex-shrink:0}',
    '.quick-bar{display:flex;align-items:center;gap:6px;margin-bottom:8px}.quick-bar button{flex:1;min-height:32px}',
    '.status,.problem,.ui-error{padding:9px 11px;background:var(--accent-soft);color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12.5px;border:1px solid var(--accent-border)}',
    '.problem{background:var(--warn-soft);border-color:var(--warn-border);color:var(--warn)}',
    '.ui-error{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger);display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.ui-error button{min-width:24px;min-height:24px;padding:0 6px;line-height:1;flex-shrink:0}',
    'h2{font-size:13px;font-weight:600;margin:6px 0;color:var(--text-2);letter-spacing:-0.01em}p{margin:5px 0;overflow-wrap:anywhere}label{display:block;margin-bottom:8px;font-size:12px;color:var(--text-2)}',
    'input[type=text],input[type=password],input[type=search],select{width:100%;border:1px solid var(--border-strong);border-radius:var(--radius-xs);background:var(--bg);color:var(--text);padding:6px 8px;min-height:30px;font-size:12.5px;transition:border-color .14s ease,box-shadow .14s ease}',
    'input[type=text]:hover,input[type=password]:hover,input[type=search]:hover,select:hover{border-color:var(--accent-border)}',
    'input[type=checkbox]{margin:3px 0;flex-shrink:0;accent-color:var(--accent)}',
    'input:focus-visible,button:focus-visible,summary:focus-visible,select:focus-visible{outline:none;box-shadow:0 0 0 2.5px var(--ring)}',
    'article{border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;margin:6px 0;background:var(--surface);transition:border-color .15s ease,background .15s ease}article h3{font-size:13px;font-weight:600;margin:0 0 4px;overflow-wrap:anywhere;color:var(--text)}',
    '.course{display:flex;align-items:flex-start;gap:7px;margin:0;padding:7px 0;border-bottom:1px solid var(--border);color:var(--text)}.course:last-child{border-bottom:0}.course span{flex:1;overflow-wrap:anywhere}.course small{display:block}.course button{font-size:12px;min-height:26px;padding:2px 8px;flex-shrink:0}',
    'details{margin:6px 0}summary{cursor:pointer;color:var(--text-2);font-weight:500;font-size:12.5px;list-style:none}summary::-webkit-details-marker{display:none}',
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:6px 0;padding:8px 10px;background:var(--surface-2);color:var(--text-2);border:1px solid var(--border);border-radius:var(--radius-xs)}',
    '.candidate{width:100%;text-align:left;justify-content:flex-start;overflow-wrap:anywhere;margin:4px 0}',
    '.separator{border-top:1px solid var(--border);margin-top:8px;padding-top:8px}',
    'details[data-settings]{margin:8px 0 0;padding:0;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);overflow:hidden}',
    'details[data-settings]>summary{padding:9px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--text);font-size:12.5px;font-weight:500;transition:background .14s ease}',
    'details[data-settings]>summary:hover{background:var(--surface-2)}',
    'details[data-settings]>summary::after{content:"▸";color:var(--text-3);font-size:11px}details[data-settings][open]>summary::after{content:"▾"}',
    'details[data-settings][open]>summary{border-bottom:1px solid var(--border);background:var(--surface-2)}',
    '.settings-sheet{padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px;background:var(--bg)}',
    '.settings-group{margin:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}',
    '.settings-group label:last-child{margin-bottom:0}',
    '.settings-title{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.02em;color:var(--text-3);margin:0 0 8px}',
    '.check-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer;color:var(--text);font-size:12.5px}',
    '.diag-bar{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:6px}.diag-actions{display:flex;gap:6px;align-items:center}.diag-actions button{min-height:26px;padding:2px 8px;font-size:12px}',
    '.version-meta{font-size:11.5px;color:var(--text-3);display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}',
  ].join(''));
  element('style', [
    '.ai-privacy{font-size:11px;line-height:1.45;color:var(--accent-text);background:var(--accent-soft);border:1px solid var(--accent-border);border-radius:var(--radius-xs);padding:6px 8px;margin:0 0 9px}',
    '.ai-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px}',
    '.ai-card-head .settings-title{margin:0}',
    '.ai-status-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:var(--radius-pill);font-size:11px;font-weight:600;border:1px solid var(--border);background:var(--surface-2);color:var(--text-3);white-space:nowrap;flex-shrink:0}',
    '.ai-status-dot{width:6px;height:6px;border-radius:999px;background:currentColor;flex-shrink:0}',
    '.ai-status-pill[data-status="idle"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-status-pill[data-status="testing"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-status-pill[data-status="testing"] .ai-status-dot{animation:wdAiPulse 1.1s ease-in-out infinite}',
    '.ai-status-pill[data-status="ok"]{background:var(--success-soft);border-color:var(--success-border);color:var(--success)}',
    '.ai-status-pill[data-status="error"]{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '@keyframes wdAiPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.75)}}',
    '@keyframes wdAiSpin{to{transform:rotate(360deg)}}',
    '.ai-spinner{width:11px;height:11px;border:1.8px solid currentColor;border-right-color:transparent;border-radius:999px;display:inline-block;animation:wdAiSpin .7s linear infinite;flex-shrink:0}',
    '.ai-form-stack{display:flex;flex-direction:column;gap:10px}',
    '.ai-field{display:flex;flex-direction:column;gap:4px}',
    '.ai-field-head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}',
    '.ai-field-label{font-size:12px;font-weight:500;color:var(--text-2);margin:0;display:inline-flex;align-items:center;gap:5px}',
    '.ai-proto-chip{font-size:10.5px;font-weight:500;padding:1px 6px;border-radius:var(--radius-pill);background:var(--surface-2);border:1px solid var(--border);color:var(--text-3)}',
    '.ai-req-tag{font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:var(--radius-pill);background:var(--warn-soft);border:1px solid var(--warn-border);color:var(--warn)}',
    '.ai-cors-card{padding:7px 9px;border-radius:var(--radius-xs);border:1px solid var(--border);background:var(--bg);display:flex;flex-direction:column;gap:4px;margin-top:2px}',
    '.ai-cors-card[data-cors="direct"]{border-color:var(--success-border);background:var(--success-soft)}',
    '.ai-cors-card[data-cors="relay-needed"],.ai-cors-card[data-cors="proxy-or-relay"]{border-color:var(--warn-border);background:var(--warn-soft)}',
    '.ai-cors-card[data-cors="custom"],.ai-cors-card[data-cors="local"]{border-color:var(--accent-border);background:var(--accent-soft)}',
    '.ai-cors-head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}',
    '.ai-cors-badge{font-size:11px;font-weight:600;color:var(--text)}',
    '.ai-cors-card[data-cors="direct"] .ai-cors-badge{color:var(--success)}',
    '.ai-cors-card[data-cors="relay-needed"] .ai-cors-badge,.ai-cors-card[data-cors="proxy-or-relay"] .ai-cors-badge{color:var(--warn)}',
    '.ai-cors-card[data-cors="custom"] .ai-cors-badge,.ai-cors-card[data-cors="local"] .ai-cors-badge{color:var(--accent-text)}',
    '.ai-cors-endpoint{font-size:10.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text-3)}',
    '.ai-note{display:block;margin:0;font-size:11.5px;line-height:1.45;color:var(--text-2)}',
    '.ai-key-box{display:flex;align-items:center;border:1px solid var(--border-strong);border-radius:var(--radius-xs);background:var(--bg);transition:border-color .14s ease,box-shadow .14s ease;overflow:hidden}',
    '.ai-key-box:hover{border-color:var(--accent-border)}',
    '.ai-key-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 2.5px var(--ring)}',
    '.ai-key-box input{flex:1;min-width:0;border:0;border-radius:0;background:transparent;padding:6px 8px;min-height:32px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
    '.ai-key-box input:focus-visible{box-shadow:none}',
    '.ai-icon-btn{border:0;border-left:1px solid var(--border);border-radius:0;background:transparent;color:var(--text-2);min-width:34px;min-height:32px;padding:0 8px;flex-shrink:0}',
    '.ai-icon-btn:hover:not(:disabled){background:var(--surface-2);color:var(--text);border-color:var(--border)}',
    '.ai-icon-btn:focus-visible{box-shadow:inset 0 0 0 2px var(--ring)}',
    '.ai-eye-glyph{position:relative;display:inline-block;width:16px;height:10px;border:1.5px solid currentColor;border-radius:75% 75% 75% 75% / 90% 90% 90% 90%}',
    '.ai-eye-glyph::before{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;border-radius:999px;background:currentColor;transform:translate(-50%,-50%)}',
    '.ai-icon-btn[data-visible="false"] .ai-eye-glyph::after{content:"";position:absolute;left:-2px;top:50%;width:18px;height:1.6px;background:currentColor;transform:translateY(-50%) rotate(-32deg);border-radius:2px}',
    '.ai-url-input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
    '.ai-field-error{font-size:11.5px;color:var(--danger);line-height:1.45;margin:0}',
    '.ai-inline-actions{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}',
    '.ai-compact-btn{min-height:26px;padding:2px 9px;font-size:11.5px;border-radius:var(--radius-xs)}',
    '.ai-model-combo{position:relative;display:flex;flex-direction:column;gap:0}',
    '.ai-model-input-wrap{display:flex;align-items:center;border:1px solid var(--border-strong);border-radius:var(--radius-xs);background:var(--bg);transition:border-color .14s ease,box-shadow .14s ease;overflow:hidden}',
    '.ai-model-input-wrap:hover{border-color:var(--accent-border)}',
    '.ai-model-input-wrap:focus-within{border-color:var(--accent);box-shadow:0 0 0 2.5px var(--ring)}',
    '.ai-model-input-wrap input{flex:1;min-width:0;border:0;border-radius:0;background:transparent;padding:6px 8px;min-height:32px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
    '.ai-model-input-wrap input:focus-visible{box-shadow:none}',
    '.ai-model-toggle-btn{border:0;border-left:1px solid var(--border);border-radius:0;background:transparent;color:var(--text-2);min-width:30px;min-height:32px;padding:0 7px;font-size:11px;flex-shrink:0}',
    '.ai-model-toggle-btn:hover:not(:disabled){background:var(--surface-2);color:var(--text);border-color:var(--border)}',
    '.ai-model-current-pill{font-size:11px;color:var(--text-3);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ai-model-dropdown{margin-top:5px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg);box-shadow:var(--shadow-panel);overflow:hidden;display:flex;flex-direction:column}',
    '.ai-model-search-bar{display:flex;align-items:center;gap:6px;padding:6px 7px;border-bottom:1px solid var(--border);background:var(--surface)}',
    '.ai-model-search-bar input{flex:1;min-width:0;min-height:26px;padding:3px 7px;font-size:12px}',
    '.ai-model-count{font-size:11px;color:var(--text-3);white-space:nowrap;font-variant-numeric:tabular-nums;flex-shrink:0}',
    '.ai-model-list{max-height:176px;overflow-y:auto;padding:4px;display:flex;flex-direction:column;gap:2px;overscroll-behavior:contain}',
    '.ai-model-option{width:100%;min-height:28px;padding:5px 8px;border:1px solid transparent;border-radius:var(--radius-xs);background:transparent;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;font-weight:400}',
    '.ai-model-option:hover:not(:disabled),.ai-model-option[data-focused="true"]{background:var(--surface-2);border-color:var(--border)}',
    '.ai-model-option[aria-selected="true"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-model-opt-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
    '.ai-model-opt-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ai-model-opt-sub{font-size:10.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ai-model-opt-tag{font-size:10px;padding:0 5px;border-radius:var(--radius-pill);background:var(--surface-2);border:1px solid var(--border);color:var(--text-3);flex-shrink:0}',
    '.ai-model-opt-check{font-size:12px;font-weight:700;color:var(--accent-text);flex-shrink:0}',
    '.ai-model-empty{padding:10px 8px;text-align:center;font-size:12px;color:var(--text-3);display:flex;flex-direction:column;gap:6px;align-items:center}',
    '.ai-model-drop-foot{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 8px;border-top:1px solid var(--border);background:var(--surface);font-size:11px;color:var(--text-3)}',
    '.ai-inline-feedback{margin-top:4px;padding:8px 10px;border-radius:var(--radius-xs);border:1px solid var(--border);background:var(--surface-2);color:var(--text-2);font-size:11.5px;line-height:1.5;display:flex;flex-direction:column;gap:4px}',
    '.ai-inline-feedback[data-tone="error"]{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '.ai-inline-feedback[data-tone="warn"]{background:var(--warn-soft);border-color:var(--warn-border);color:var(--warn)}',
    '.ai-inline-feedback[data-tone="ok"]{background:var(--success-soft);border-color:var(--success-border);color:var(--success)}',
    '.ai-inline-feedback[data-tone="info"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-fb-head{display:flex;align-items:center;justify-content:space-between;gap:6px;font-weight:600;flex-wrap:wrap}',
    '.ai-fb-hint{font-size:11.5px;line-height:1.45;opacity:.92;color:var(--text-2)}',
    '.ai-inline-feedback[data-tone="error"] .ai-fb-hint{color:var(--danger)}',
    '.ai-inline-feedback[data-tone="warn"] .ai-fb-hint{color:var(--warn)}',
    '.ai-test-card{padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);display:flex;flex-direction:column;gap:7px}',
    '.ai-test-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.ai-test-result{padding:7px 9px;border-radius:var(--radius-xs);border:1px solid var(--border);background:var(--surface);font-size:11.5px;line-height:1.5;color:var(--text-2);display:flex;flex-direction:column;gap:3px}',
    '.ai-test-result[data-tone="ok"]{background:var(--success-soft);border-color:var(--success-border);color:var(--success)}',
    '.ai-test-result[data-tone="partial"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-test-result[data-tone="error"]{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '.ai-test-result[data-tone="info"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-test-summary{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;font-weight:600}',
    '.ai-test-meta{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.88}',
    '.ai-test-detail{font-size:11.5px;line-height:1.45;color:var(--text-2);overflow-wrap:anywhere}',
    '.ai-test-result[data-tone="error"] .ai-test-detail{color:var(--danger)}',
    '.ai-advanced{margin:0;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--bg);padding:6px 9px}',
    '.ai-advanced>summary{font-size:11.5px;color:var(--text-3);display:flex;align-items:center;justify-content:space-between;gap:6px}',
    '.ai-advanced>summary::after{content:"▸";font-size:10px}.ai-advanced[open]>summary::after{content:"▾"}',
    '.ai-advanced-body{margin-top:8px;display:flex;flex-direction:column;gap:6px}',
    '.ai-footer-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:2px}',
    '.ai-save-status{display:block;font-size:11.5px;color:var(--text-3);min-height:16px}',
    '.kg-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.52);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.kg-dialog{width:min(960px,95vw);height:min(760px,90vh);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-modal);overflow:hidden}',
    '.kg-head{flex-shrink:0;padding:12px 16px 10px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px}',
    '.kg-head-top{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    '.kg-title-wrap{display:flex;align-items:center;gap:7px;min-width:0;flex:1;flex-wrap:wrap}',
    '.kg-title-wrap h2{margin:0;font-size:15px;font-weight:600;color:var(--text);line-height:1.35;white-space:normal;overflow:visible;overflow-wrap:anywhere}',
    '.kg-head-controls{display:flex;align-items:center;gap:6px;flex-shrink:0}',
    '.kg-head-row2{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-badge{font-size:11px;font-weight:500;padding:2px 8px;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);flex-shrink:0}',
    '.kg-badge[data-tone=ai]{background:var(--success-soft);color:var(--success);border:1px solid var(--success-border);font-weight:600}',
    '.kg-badge[data-tone=local]{background:var(--surface-2);color:var(--text-2);border:1px solid var(--border-strong);font-weight:600}',
    '.kg-badge[data-tone=fallback]{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn-border);font-weight:600}',
    '.kg-badge[data-tone=cache]{background:var(--cache-soft);color:var(--cache)}',
    '.kg-badge[data-tone=scope]{background:var(--surface-2);color:var(--text-2)}',
    '.kg-badge[data-tone=nosub]{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn-border)}',
    '.kg-source-callout{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:11px 14px;border-radius:var(--radius-md);background:var(--warn-soft);border:1px solid var(--warn-border);color:var(--warn)}',
    '.kg-source-callout[data-tone=local]{background:var(--bg);border:1px solid var(--accent-border);border-left:3.5px solid var(--accent);color:var(--text)}',
    '.kg-source-callout[data-tone=fallback]{background:var(--warn-soft);border:1px solid var(--warn-border);border-left:3.5px solid var(--warn);color:var(--warn)}',
    '.kg-source-callout-body{flex:1;min-width:210px;display:flex;flex-direction:column;gap:3px}',
    '.kg-source-callout-title{font-size:13px;font-weight:600;line-height:1.45;color:inherit;overflow-wrap:anywhere}',
    '.kg-source-callout-desc{font-size:12px;line-height:1.5;color:var(--text-2);overflow-wrap:anywhere}',
    '.kg-source-callout[data-tone=fallback] .kg-source-callout-desc{color:var(--warn)}',
    '.kg-source-callout-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;align-self:center}',
    '.kg-card-head-right{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap}',
    '.kg-sec-fallback-note{margin:0 0 10px;padding:7px 10px;border-radius:var(--radius-xs);background:var(--warn-soft);border:1px solid var(--warn-border);color:var(--warn);font-size:12px;line-height:1.5;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-meta-fold{flex-shrink:0;margin:0;border-bottom:1px solid var(--border);background:var(--bg);font-size:12px}',
    '.kg-meta-fold>summary{padding:5px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--text-3);font-weight:500}',
    '.kg-meta-fold>summary:hover{background:var(--surface);color:var(--text-2)}',
    '.kg-meta-fold>summary::after{content:"▸";font-size:10px}.kg-meta-fold[open]>summary::after{content:"▾"}',
    '.kg-meta-body{padding:6px 16px 10px;border-top:1px dashed var(--border);display:flex;flex-direction:column;gap:6px;background:var(--surface)}',
    '.kg-estimate{font-size:11.5px;color:var(--text-2);display:flex;flex-direction:column;gap:2px}',
    '.kg-banner{flex-shrink:0;font-size:12px;padding:7px 16px;background:var(--warn-soft);border-bottom:1px solid var(--warn-border);color:var(--warn);white-space:pre-wrap}',
    '.kg-banner[data-tone=info]{background:var(--accent-soft);border-bottom-color:var(--accent-border);color:var(--accent-text)}',
    '.kg-toolbar{flex-shrink:0;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--bg);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:var(--radius-sm);background:var(--surface-2);border:1px solid var(--border)}',
    '.kg-tabs button{min-height:26px;padding:2px 10px;border:0;background:transparent;color:var(--text-2);border-radius:var(--radius-xs);font-size:12px}',
    '.kg-tabs button:hover:not(:disabled){color:var(--text);background:var(--surface-hover)}',
    '.kg-tabs button[aria-selected=true]{background:var(--bg);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.10)}',
    '.kg-body{flex:1;min-height:0;overflow:auto;position:relative;background:var(--surface)}',
    '.kg-pane{height:100%;width:100%;display:flex;flex-direction:column}',
    '.kg-svg-wrap{flex:1;min-height:0;position:relative;overflow:hidden;background:var(--bg)}.kg-svg-wrap svg{width:100%;height:100%;display:block}.kg-svg-wrap .markmap-node a{color:var(--accent-text);text-decoration:underline;cursor:pointer;font-weight:600}',
    '.kg-engine-foot{font-size:11px;color:var(--text-3);padding:6px 14px;border-top:1px solid var(--border);background:var(--surface)}',
    '.kg-scroll{padding:16px 20px;display:flex;flex-direction:column;gap:14px}',
    '.kg-card{border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 16px;background:var(--bg);box-shadow:0 1px 2px rgba(15,23,42,.03)}',
    '.kg-card-course{border-color:var(--accent-border)}',
    '.kg-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}',
    '.kg-card-head h3{margin:0;font-size:14px;font-weight:600;color:var(--text);letter-spacing:-0.01em}',
    '.kg-one-line{margin:0 0 10px;padding:10px 12px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:13px;color:var(--text);font-weight:500;line-height:1.6;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word}',
    '.kg-theme-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:0 0 10px}.kg-theme-label{font-size:11.5px;color:var(--text-3);font-weight:500}.kg-theme-chip{font-size:11.5px;padding:2px 8px;border-radius:var(--radius-pill);background:var(--surface-2);border:1px solid var(--border);color:var(--text-2);font-weight:500}',
    '.kg-subhead{font-size:12px;font-weight:600;color:var(--text-3);margin:12px 0 6px;display:flex;align-items:center;justify-content:space-between}',
    '.kg-kp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
    '.kg-kp-item{display:flex;align-items:flex-start;flex-wrap:wrap;gap:9px;padding:8px 11px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;color:var(--text);line-height:1.55;transition:background .15s ease,border-color .15s ease}',
    '.kg-kp-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-top:1px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);font-size:11px;font-weight:600;flex-shrink:0}',
    '.kg-kp-text{flex:1;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word;line-height:1.55}',
    '.kg-kp-meta{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}',
    '.kg-kp-sec-tag{font-size:11px;padding:1px 7px;border-radius:var(--radius-pill);background:var(--surface-2);color:var(--text-3);border:1px solid var(--border);white-space:nowrap}',
    '.kg-fold-list{display:flex;flex-direction:column;gap:6px}',
    '.kg-topic-fold{margin:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);padding:7px 11px}',
    '.kg-topic-fold>summary{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;font-size:13px;color:var(--text);font-weight:500;line-height:1.45}',
    '.kg-topic-fold>summary>span:first-child{flex:1;min-width:0;white-space:normal;overflow:visible;overflow-wrap:anywhere}',
    '.kg-topic-fold>summary::before{content:"▸ ";font-size:11px;color:var(--accent);flex-shrink:0}.kg-topic-fold[open]>summary::before{content:"▾ "}',
    '.kg-topic-count{font-size:11px;color:var(--text-3);font-weight:400;margin-left:auto;flex-shrink:0}',
    '.kg-points{list-style:none;margin:6px 0 2px;padding:0}',
    '.kg-points li{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:6px 4px;border-top:1px dashed var(--border);font-size:12.5px;color:var(--text-2);line-height:1.5;border-radius:var(--radius-xs);transition:background .15s ease}',
    '.kg-points li>span{flex:1;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word}',
    '.kg-quiz-list{display:flex;flex-direction:column;gap:8px}',
    '.kg-quiz-item{border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;background:var(--surface)}',
    '.kg-quiz-q{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;font-size:13px;font-weight:500;color:var(--text);line-height:1.5}',
    '.kg-quiz-q>span{flex:1;min-width:0;overflow-wrap:anywhere}',
    '.kg-quiz-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}',
    '.kg-quiz-ans{margin-top:8px;padding:7px 10px;background:var(--success-soft);border-left:3px solid var(--success);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:12.5px;color:var(--success);line-height:1.55;overflow-wrap:anywhere}',
    '.kg-glossary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));gap:10px}',
    '.kg-term-card{border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;background:var(--surface);display:flex;flex-direction:column;gap:5px;min-width:0}',
    '.kg-term-head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}.kg-term-title-wrap{display:inline-flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}.kg-term-head strong{font-size:13px;color:var(--text);overflow-wrap:anywhere}',
    '.kg-term-tag{font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:var(--radius-pill);background:var(--surface-2);color:var(--text-3);border:1px solid var(--border)}',
    '.kg-term-tag[data-core="true"]{background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border)}',
    '.kg-term-def{font-size:12.5px;color:var(--text-2);margin:0;line-height:1.55;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word}',
    '.kg-timeline-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px dashed var(--border);font-size:12.5px}.kg-timeline-item:last-child{border-bottom:0}',
    '.kg-timeline-text{flex:1;min-width:0;color:var(--text-2);overflow-wrap:anywhere;line-height:1.55}',
    '.kg-time-btn{min-height:24px;padding:1px 8px;font-size:11px;font-variant-numeric:tabular-nums;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border);flex-shrink:0}',
    '.kg-mini-btn{min-height:24px;padding:2px 8px;font-size:11.5px;flex-shrink:0}',
    '.kg-md-pane{padding:14px 18px}.kg-md-pane pre{margin:0;max-height:100%;overflow:auto}',
    '.kg-sec-picker-wrap{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.kg-sec-picker{width:100%;max-width:300px;min-width:0;padding:3px 8px;font-size:12px;min-height:28px}',
    '@media (max-width:600px){.kg-backdrop{padding:8px}.kg-dialog{width:100vw;height:94dvh;border-radius:var(--radius-md)}.kg-scroll{padding:12px}.kg-sec-picker-wrap{flex:1 1 100%}.kg-sec-picker{max-width:100%}.kg-kp-item{flex-wrap:wrap}.kg-glossary-grid{grid-template-columns:1fr}}',
    '.kg-qa-dock{flex-shrink:0;border-top:1px solid var(--border);background:var(--bg);display:flex;flex-direction:column}',
    '.kg-qa-bar{padding:7px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--surface);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-2)}.kg-qa-bar strong{font-size:12.5px;color:var(--text);font-weight:600}',
    '.kg-qa-thread{max-height:210px;overflow-y:auto;padding:10px 16px;display:flex;flex-direction:column;gap:8px;background:var(--surface);border-bottom:1px solid var(--border)}',
    '.kg-qa-msg{padding:8px 12px;border-radius:var(--radius-md);font-size:12.5px;line-height:1.55;max-width:88%;overflow-wrap:anywhere}',
    '.kg-qa-msg[data-role=user]{align-self:flex-end;background:var(--accent);color:#fff}',
    '.kg-qa-msg[data-role=assistant]{align-self:flex-start;background:var(--bg);border:1px solid var(--border);color:var(--text)}',
    '.kg-qa-cites{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}',
    '.kg-qa-cite{display:inline-flex;align-items:center;gap:4px;font-size:11px;min-height:22px;padding:1px 8px;border-radius:var(--radius-pill);background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.kg-inline-time{display:inline;min-height:0;padding:0 5px;margin:0 2px;font-size:11.5px;font-weight:600;border-radius:4px;vertical-align:baseline;background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.kg-qa-meta{font-size:11px;color:var(--text-3);margin-top:4px}',
    '.kg-qa-noai{padding:6px 16px;background:var(--warn-soft);border-bottom:1px solid var(--warn-border);color:var(--warn);font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.kg-qa-nosub{padding:6px 16px;background:var(--surface-2);border-bottom:1px solid var(--border);color:var(--text-3);font-size:12px}',
    '.kg-qa-input-row{padding:8px 16px;display:flex;align-items:center;gap:8px;background:var(--bg)}.kg-qa-input-row input{flex:1;min-width:0;padding:6px 10px}.kg-qa-input-row input:disabled{background:var(--surface-2);color:var(--text-3);cursor:not-allowed}',
    '.kg-score-bar{padding:10px 14px;border-radius:var(--radius-sm);background:var(--success-soft);border:1px solid var(--success-border);color:var(--success);font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-opt-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}',
    '.kg-opt-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer;margin:0;font-size:12.5px;color:var(--text);transition:border-color .14s ease,background .14s ease}',
    '.kg-opt-row:hover{border-color:var(--accent-border);background:var(--surface-hover)}',
    '.kg-opt-row[data-grade=correct]{background:var(--success-soft);border-color:var(--success-border);color:var(--success)}',
    '.kg-opt-row[data-grade=wrong]{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '.kg-short-input{margin:8px 0 4px}',
    '.kg-explain-fold{margin:8px 0 0;border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 10px;background:var(--surface)}.kg-explain-fold summary{font-size:12px;color:var(--text-2)}.kg-explain-body{margin-top:6px;font-size:12.5px;color:var(--text-2);display:flex;flex-direction:column;gap:5px}',
    '.kg-nosub-box{padding:12px 14px;border-radius:var(--radius-sm);background:var(--warn-soft);border:1px solid var(--warn-border);color:var(--warn);font-size:12.5px;line-height:1.55;margin:4px 0}.kg-nosub-box strong{display:block;font-size:13px;margin-bottom:3px}',
    '.kg-skipped-box{margin-top:8px;padding:7px 10px;border-radius:var(--radius-xs);background:var(--surface);border:1px solid var(--border);color:var(--text-2);font-size:12px}',
    '.kg-diag-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}.kg-diag-pre{max-height:130px;overflow:auto;margin:4px 0 0;font-size:11px}',
    '.kg-cite-btn{min-height:24px;padding:1px 8px;font-size:11px;font-variant-numeric:tabular-nums;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border);flex-shrink:0}',
    '.kg-cite-btn[data-cite-active="true"],.kg-inline-cite[data-cite-active="true"]{background:#fef08a;border-color:#ca8a04;color:#713f12;font-weight:600}',
    '.kg-cite-unverified,.kg-inline-cite.kg-cite-unverified{background:var(--warn-soft);border:1px dashed var(--warn-border);color:var(--warn);font-weight:600}',
    '.kg-cite-unverified:hover:not(:disabled){background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '.kg-inline-cite{display:inline;min-height:0;padding:0 5px;margin:0 2px;font-size:11.5px;font-weight:600;border-radius:4px;vertical-align:baseline;background:var(--accent-soft);border:1px solid var(--accent-border);color:var(--accent-text)}',
    '[data-cite-highlighted="true"]{background:rgba(254,240,138,.42)!important;border-color:#eab308!important}',
    '.kg-evidence-slot{flex:1 0 100%;width:100%;margin-top:6px}',
    '.kg-evidence-card{border:1px solid #eab308;border-left:3.5px solid #ca8a04;border-radius:var(--radius-sm);background:#fefce8;color:#422006;padding:9px 11px;font-size:12px;line-height:1.55;display:flex;flex-direction:column;gap:6px}',
    ':host([data-theme="dark"]) .kg-evidence-card{background:rgba(234,179,8,.14);border-color:rgba(250,204,21,.45);color:#fef9c3}',
    ':host([data-theme="dark"]) [data-cite-highlighted="true"]{background:rgba(234,179,8,.18)!important;border-color:rgba(250,204,21,.55)!important}',
    '@media (prefers-color-scheme:dark){:host(:not([data-theme="light"])) .kg-evidence-card{background:rgba(234,179,8,.14);border-color:rgba(250,204,21,.45);color:#fef9c3}:host(:not([data-theme="light"])) [data-cite-highlighted="true"]{background:rgba(234,179,8,.18)!important;border-color:rgba(250,204,21,.55)!important}}',
    '.kg-evidence-card.kg-evidence-unverified{background:var(--warn-soft);border:1px dashed var(--warn-border);border-left:3.5px solid var(--danger);color:var(--warn)}',
    '.kg-ev-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11.5px;font-weight:600}',
    '.kg-ev-neighbor{padding:5px 8px;border-radius:var(--radius-xs);background:rgba(15,23,42,.04);color:var(--text-3);font-size:11.5px;line-height:1.5}',
    '.kg-ev-neighbor span{display:block;font-size:10.5px;font-weight:600;margin-bottom:2px}',
    '.kg-ev-current{padding:7px 9px;border-radius:var(--radius-xs);background:rgba(254,240,138,.72);border:1px solid rgba(202,138,4,.45);color:#422006;font-size:12.5px;line-height:1.6}',
    ':host([data-theme="dark"]) .kg-ev-current{background:rgba(250,204,21,.22);color:#fefce8}',
    '@media (prefers-color-scheme:dark){:host(:not([data-theme="light"])) .kg-ev-current{background:rgba(250,204,21,.22);color:#fefce8}}',
    '.kg-ev-current span{display:block;font-size:11px;font-weight:600;margin-bottom:2px;opacity:.85}',
    '.kg-ev-current mark{background:#fde047;color:#422006;padding:0 2px;border-radius:3px;font-weight:600}',
    '.kg-ev-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px}',
    '.kg-ev-unverified-detail{padding:6px 8px;border-radius:var(--radius-xs);background:var(--bg);border:1px solid var(--border);color:var(--text-2);font-size:11.5px;line-height:1.5;display:flex;flex-direction:column;gap:3px}',
    '.kg-timeline-item{display:flex;align-items:flex-start;flex-wrap:wrap;gap:8px;padding:7px 6px;border-bottom:1px dashed var(--border);font-size:12.5px;border-radius:var(--radius-xs)}',
    '.kg-timeline-seg-badge{font-size:11px;font-weight:600;padding:1px 7px;border-radius:var(--radius-pill);background:var(--surface-2);color:var(--text-2);border:1px solid var(--border);font-variant-numeric:tabular-nums;flex-shrink:0}',
    '.kg-qa-session-wrap{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.kg-qa-session-select{width:auto;max-width:190px;min-height:24px;padding:1px 6px;font-size:11.5px}',
    '.kg-wrong-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:6px}',
    '.ai-storage-warn{font-size:11.5px;line-height:1.5;color:var(--warn);background:var(--warn-soft);border:1px solid var(--warn-border);border-radius:var(--radius-xs);padding:6px 9px;margin:0 0 8px}',
  ].join(''));
  const shell = element('section'); shell.setAttribute('aria-label', '网大助手');
  element('style', [
    '.task-head{display:flex;align-items:flex-start;gap:7px}.task-head h3{flex:1;min-width:0}.sort-actions{display:flex;gap:4px;flex-shrink:0}.sort-actions button{min-width:26px;min-height:26px;padding:2px 6px;font-size:12px;line-height:1}.sort-handle{cursor:grab}.sort-handle:active{cursor:grabbing}article[data-drop=before]{border-top:2px solid var(--accent)}article[data-drop=after]{border-bottom:2px solid var(--accent)}article[data-dragging]{opacity:.55}',
    '.filter-input{margin:0 0 6px}',
    'article[data-state=active]{background:var(--accent-soft);border-color:var(--accent-border);box-shadow:inset 3px 0 var(--accent)}article[data-state=completed]{background:var(--surface-2);border-color:var(--border);color:var(--text-3)}article[data-state=attention]{background:var(--warn-soft);border-color:var(--warn-border)}',
    '.task-priority{margin:2px 0 4px}.task-current{font-size:12px;color:var(--accent-text);white-space:pre-wrap;margin:6px 0}',
    '.course[data-state=active]{background:var(--accent-soft);border-radius:var(--radius-xs);padding:8px;border-left:3px solid var(--accent)}.course[data-state=active]>span>span,.course[data-state=active] small{color:var(--accent-text)}.course[data-state=active]>span>span{font-weight:600}.course[data-state=completed]{color:var(--text-3)}.course[data-state=attention] small{color:var(--warn)}',
    'progress{display:block;width:100%;height:4px;margin:6px 0 8px;border:0;border-radius:999px;overflow:hidden;background:var(--surface-2);accent-color:var(--accent)}progress::-webkit-progress-bar{background:var(--surface-2)}progress::-webkit-progress-value{background:var(--accent);border-radius:999px}progress::-moz-progress-bar{background:var(--accent)}article[data-state=completed] progress{accent-color:var(--text-3)}article[data-state=completed] progress::-webkit-progress-value{background:var(--text-3)}.course progress{margin-bottom:2px}.playback-time{margin-top:4px;font-variant-numeric:tabular-nums}.completed-actions{margin:6px 0}',
    '.compact-course,.course-caption,.current-name,.task-head h3{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.course>span{min-width:0}.one-line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.current-name{font-weight:600}.task-current small{color:inherit}.compact-notice{margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere}.task-current .playback-time{margin-top:3px}.task-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}.task-meta p{margin:0;flex:1;min-width:0;font-size:12px;color:var(--text-2)}.detail-toggle{min-height:26px;padding:2px 8px;font-size:12px;flex-shrink:0}',
  ].join(''));
  const header = element('header', '', shell);
  const headline = element('div', '', header); headline.className = 'headline';
  const title = element('div', '', headline); title.className = 'brand-wrap';
  element('span', '', title).className = 'brand-dot';
  element('strong', '网大助手', title);
  const headerButtons = element('div', '', headline); headerButtons.className = 'row';
  const busy = new Set(); const editors = new Set(); let adding = false; let starting = false; let reordering = false; let draggedTaskId = null;
  let pendingRemoveId = null; let pendingRemoveTimer = null; let windowSavedTimer = null; let copyDiagTimer = null;
  let latest = controller.getState();
  const clearRemoveConfirm = () => { if (pendingRemoveTimer !== null) { win.clearTimeout(pendingRemoveTimer); pendingRemoveTimer = null; } pendingRemoveId = null; };
  const clearTimers = () => {
    clearRemoveConfirm();
    if (windowSavedTimer !== null) { win.clearTimeout(windowSavedTimer); windowSavedTimer = null; }
    if (copyDiagTimer !== null) { win.clearTimeout(copyDiagTimer); copyDiagTimer = null; }
  };
  const body = element('div', '', shell); body.className = 'body'; body.hidden = true;
  const uiErrorBox = element('div', '', body); uiErrorBox.className = 'ui-error'; uiErrorBox.setAttribute('role', 'alert'); uiErrorBox.hidden = true;
  const uiErrorText = element('span', '', uiErrorBox);
  const closeUiError = element('button', '×', uiErrorBox); closeUiError.type = 'button'; closeUiError.className = 'ghost'; closeUiError.setAttribute('aria-label', '关闭提示');
  closeUiError.addEventListener('click', () => { uiErrorBox.hidden = true; uiErrorText.textContent = ''; });
  const showUiError = text => { uiErrorText.textContent = text; uiErrorBox.hidden = false; body.scrollTop = 0; };
  const button = (action, text, parent, handler, edit = true) => {
    const node = element('button', text, parent); node.type = 'button'; node.dataset.action = action;
    if (edit) editors.add(node);
    node.addEventListener('click', async event => {
      if (node.disabled || busy.has(node)) return;
      busy.add(node); node.disabled = true;
      try { await handler(event); } catch { showUiError('操作未完成，请查看当前状态后重试。'); }
      finally { busy.delete(node); node.disabled = false; render(controller.getState()); }
    });
    return node;
  };
  const isRunning = state => ['running', 'preparing', 'waiting'].includes(state.status) || state.phase === 'resuming';
  const runButton = button('run-toggle', '开始', headerButtons, () => isRunning(controller.getState()) ? controller.pause() : startQueue(), false);
  const toggle = button('toggle', '展开', headerButtons, () => setOpen(body.hidden), false); toggle.setAttribute('aria-expanded', 'false');
  const playGesture = button('play-current', '播放当前课节', header, event => controller.playFromGesture(event), false);
  playGesture.className = 'primary';
  playGesture.style.marginTop = '8px';
  const progress = element('div', '', header); progress.className = 'progress'; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
  const compact = element('div', '', header); compact.className = 'muted compact-course';
  const compactTime = element('div', '', header); compactTime.className = 'muted playback-time'; compactTime.dataset.playbackTime = '';
  const compactNotice = element('div', '', header); compactNotice.className = 'muted compact-notice';
  const execution = element('div', '', body); execution.className = 'status';
  const message = element('div', '', execution);
  const problemBox = element('div', '', body); problemBox.className = 'problem'; problemBox.dataset.problem = '';
  const problemText = element('div', '', problemBox); const problemActions = element('div', '', problemBox); problemActions.className = 'buttons';
  button('retry', '重试本课程', problemActions, () => controller.retry(latest.problem?.taskId, latest.problem?.courseId, 'panel-retry'));
  button('skip', '跳过并继续', problemActions, () => controller.skipCurrent());
  const leaveBar = element('div', '', body); leaveBar.className = 'buttons leave-bar'; leaveBar.hidden = true;
  const leaveLearningButton = button('stop-learning', '退出学习页', leaveBar, () => controller.pause(), false);
  const quickBar = element('div', '', body); quickBar.className = 'quick-bar'; quickBar.dataset.quickBar = '';
  const guideTrigger = button('knowledge-open', '💡 AI 导览', quickBar, () => openKnowledgeModal(), false);
  guideTrigger.className = 'soft';
  const queueView = element('div', '', body); queueView.dataset.view = 'queue';
  const queueHeading = element('div', '', queueView); queueHeading.className = 'headline'; element('h2', '任务队列', queueHeading);
  const queueHeaderActions = element('div', '', queueHeading); queueHeaderActions.className = 'row';
  const clearCompleted = button('clear-completed', '清除已完成', queueHeaderActions, () => controller.clearCompletedTasks(), false);
  clearCompleted.className = 'ghost';
  clearCompleted.title = '清理已完成专区，保留执行中、未完成和待处理任务。';
  const addButton = button('add', '添加专区', queueHeaderActions, () => { adding = true; clearRemoveConfirm(); render(controller.getState()); target.focus(); });
  const empty = element('p', '暂无学习任务', queueView); empty.className = 'muted';
  const taskList = element('div', '', queueView);
  const addView = element('div', '', body); addView.dataset.view = 'add';
  const exitAddView = async () => { if (await controller.discardDraft() !== false) { adding = false; target.value = ''; } };
  const addHeading = element('div', '', addView); addHeading.className = 'headline';
  element('h2', '添加专区', addHeading);
  const backButton = button('back', '← 返回', addHeading, exitAddView); backButton.className = 'ghost';
  const searchBox = element('div', '', addView);
  const labelInput = (caption, name, parent) => { const label = element('label', caption, parent); const input = element('input', '', label); input.type = 'text'; input.name = name; input.id = `wd-${name}`; label.htmlFor = input.id; editors.add(input); return input; };
  const target = labelInput('专区名称', 'target', searchBox);
  target.placeholder = '输入名称后按回车搜索';
  const searchActions = element('div', '', searchBox); searchActions.className = 'buttons';
  const searchButton = button('search', '搜索', searchActions, () => controller.search(target.value.trim())); searchButton.className = 'primary';
  button('collect', '读取当前页', searchActions, () => controller.collectDraft());
  target.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchButton.click(); } });
  const candidates = element('div', '', addView); candidates.dataset.candidates = '';
  const draftBox = element('div', '', addView); draftBox.dataset.draft = '';
  const draftTitle = element('h3', '', draftBox);
  const draftCourses = createCourseList(draftBox);
  const addActions = element('div', '', draftBox); addActions.className = 'buttons';
  const addDraftButton = button('add-draft', '加入队列', addActions, async () => { if (await controller.addDraft()) { adding = false; target.value = ''; } }); addDraftButton.className = 'primary';
  const cancelDraftButton = button('cancel-draft', '取消', addActions, exitAddView); cancelDraftButton.className = 'ghost';
  const settingsBox = element('details', '', body); settingsBox.dataset.settings = '';
  const settingsSummary = element('summary', '⚙ 设置', settingsBox);
  const settingsSheet = element('div', '', settingsBox); settingsSheet.className = 'settings-sheet';
  const runningEditHint = element('p', '运行中仅可查看，暂停后可修改。', settingsSheet); runningEditHint.className = 'muted'; runningEditHint.hidden = true;

  // Group 1: 挂课与学习
  const windowGroup = element('div', '', settingsSheet); windowGroup.className = 'settings-group'; windowGroup.dataset.settingsGroup = 'study';
  element('p', '挂课与时段（北京时间）', windowGroup).className = 'settings-title';
  const windowRow = element('div', '', windowGroup); windowRow.className = 'row';
  const fields = { start: labelInput('开始时间', 'start', windowRow), end: labelInput('结束时间', 'end', windowRow) };
  fields.start.placeholder = '09:00'; fields.end.placeholder = '24:00';
  const dirty = new Set(); for (const [name, field] of Object.entries(fields)) field.addEventListener('input', () => dirty.add(name));
  const windowActions = element('div', '', windowGroup); windowActions.className = 'buttons';
  const saveWindowButton = button('save-window', '保存', windowActions, async () => {
    if (await saveWindow()) {
      saveWindowButton.textContent = '已保存';
      if (windowSavedTimer !== null) win.clearTimeout(windowSavedTimer);
      windowSavedTimer = win.setTimeout(() => { windowSavedTimer = null; saveWindowButton.textContent = '保存'; }, 2000);
    }
  });
  saveWindowButton.className = 'primary';
  const resetWindowButton = button('reset-window', '恢复默认', windowActions, async () => {
    fields.start.value = '09:00';
    fields.end.value = '24:00';
    dirty.clear();
    if (await controller.setWindow({ start: '09:00', end: '24:00' })) {
      resetWindowButton.textContent = '已恢复';
      if (windowSavedTimer !== null) win.clearTimeout(windowSavedTimer);
      windowSavedTimer = win.setTimeout(() => { windowSavedTimer = null; resetWindowButton.textContent = '恢复默认'; }, 2000);
    }
  });
  resetWindowButton.className = 'ghost';
  function automaticInput(name, caption, parent) {
    const label = element('label', '', parent); label.className = 'check-row';
    const input = element('input', '', label); input.type = 'checkbox'; input.name = name; editors.add(input);
    element('span', caption, label);
    input.addEventListener('change', async () => {
      if (input.disabled) return;
      busy.add(input); input.disabled = true;
      try { await controller.setAutomation({ enabled: automatic.checked, resumeOnReload: automatic.checked && resumeOnReload.checked, mute: mute.checked }); }
      catch { showUiError('自动设置保存失败，请重试。'); }
      finally { busy.delete(input); render(controller.getState()); }
    }); return input;
  }
  const mute = automaticInput('mute', '自动静音课程', windowGroup);
  mute.title = '开启期间持续静音；需要声音时请暂停后关闭。';
  const automatic = automaticInput('automatic', '异常自动重试并跳过人工课', windowGroup);
  const resumeOnReload = automaticInput('resumeOnReload', '刷新页面后自动恢复队列', windowGroup);
  const autoHint = element('small', '需保持页面打开；手动暂停将停止续学。', windowGroup); autoHint.className = 'muted'; autoHint.hidden = true;

  // Group 2: 外观
  const themeGroup = element('div', '', settingsSheet); themeGroup.className = 'settings-group'; themeGroup.dataset.settingsGroup = 'appearance';
  element('p', '外观', themeGroup).className = 'settings-title';
  const uiThemeLabel = element('label', '主题', themeGroup);
  const uiThemeSelect = element('select', '', uiThemeLabel); uiThemeSelect.name = 'ui-theme'; uiThemeSelect.id = 'wd-ui-theme'; uiThemeLabel.htmlFor = uiThemeSelect.id;
  for (const [val, txt] of [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']]) {
    const opt = element('option', txt, uiThemeSelect); opt.value = val;
  }
  uiThemeSelect.value = host.dataset.theme || 'auto';
  uiThemeSelect.addEventListener('change', () => { applyUiTheme(uiThemeSelect.value); });

  // Group 3: AI 导览模型（现代嵌入配置卡片：Provider → API Key → 获取并选择模型 → 测试连接）
  const aiGroup = element('div', '', settingsSheet); aiGroup.className = 'settings-group'; aiGroup.dataset.aiSettings = ''; aiGroup.dataset.settingsGroup = 'ai';
  const aiCardHead = element('div', '', aiGroup); aiCardHead.className = 'ai-card-head';
  element('p', 'AI 模型配置（选填）', aiCardHead).className = 'settings-title';
  const aiTopStatusPill = element('span', '', aiCardHead);
  aiTopStatusPill.className = 'ai-status-pill';
  aiTopStatusPill.dataset.aiStatusPill = '';
  aiTopStatusPill.dataset.status = 'unconfigured';
  element('span', '', aiTopStatusPill).className = 'ai-status-dot';
  const aiTopStatusText = element('span', '未配置', aiTopStatusPill);

  const aiPrivacy = element('p', kg.privacyNotice || WD_AI_PRIVACY_NOTICE, aiGroup); aiPrivacy.className = 'ai-privacy'; aiPrivacy.dataset.aiPrivacy = '';
  const aiStorageWarn = element('p', '', aiGroup); aiStorageWarn.className = 'ai-storage-warn'; aiStorageWarn.dataset.aiStorageWarn = ''; aiStorageWarn.hidden = true;
  const syncStorageWarning = () => {
    const st = kg.getStorageStatus ? kg.getStorageStatus() : getStorageStatus(win);
    const msgs = [];
    if (st?.degraded) msgs.push('⚠ 当前非油猴环境（GM_setValue 不可用），API Key 与学习资产已降级存至 localStorage。');
    if (st?.migration?.status === 'failed' || st?.migration?.status === 'partial') {
      msgs.push(`⚠ 旧数据迁移存在未完成项（已保留原始 localStorage 数据未丢弃）：${(st.migration.warnings || []).join('；')}`);
    }
    aiStorageWarn.textContent = msgs.join('\n');
    aiStorageWarn.hidden = msgs.length === 0;
  };
  syncStorageWarning();

  const aiFormStack = element('div', '', aiGroup); aiFormStack.className = 'ai-form-stack';

  // 1. Provider selector + CORS direct-connection card
  const aiProviderField = element('div', '', aiFormStack); aiProviderField.className = 'ai-field';
  const aiProviderHead = element('div', '', aiProviderField); aiProviderHead.className = 'ai-field-head';
  const aiProviderLabel = element('label', '服务商 (Provider)', aiProviderHead); aiProviderLabel.className = 'ai-field-label';
  const aiProtoChip = element('span', 'OpenAI 兼容', aiProviderHead); aiProtoChip.className = 'ai-proto-chip'; aiProtoChip.dataset.aiProtoChip = '';
  const aiProvider = element('select', '', aiProviderField); aiProvider.name = 'ai-provider'; aiProvider.id = 'wd-ai-provider'; aiProviderLabel.htmlFor = aiProvider.id;
  for (const preset of (kg.providers || WD_AI_PROVIDERS)) {
    const opt = element('option', preset.label, aiProvider); opt.value = preset.id;
  }
  const aiCorsCard = element('div', '', aiProviderField); aiCorsCard.className = 'ai-cors-card'; aiCorsCard.dataset.aiCorsCard = ''; aiCorsCard.dataset.cors = 'direct';
  const aiCorsHead = element('div', '', aiCorsCard); aiCorsHead.className = 'ai-cors-head';
  const aiCorsBadge = element('span', '', aiCorsHead); aiCorsBadge.className = 'ai-cors-badge'; aiCorsBadge.dataset.aiCorsBadge = '';
  const aiCorsEndpoint = element('span', '', aiCorsHead); aiCorsEndpoint.className = 'ai-cors-endpoint';
  const aiProviderNote = element('small', '', aiCorsCard); aiProviderNote.className = 'ai-note'; aiProviderNote.dataset.aiProviderNote = '';

  // 2. API Key (integrated password box + pure-CSS eye visibility toggle)
  const aiKeyField = element('div', '', aiFormStack); aiKeyField.className = 'ai-field';
  const aiKeyHead = element('div', '', aiKeyField); aiKeyHead.className = 'ai-field-head';
  const aiKeyLabel = element('label', 'API Key', aiKeyHead); aiKeyLabel.className = 'ai-field-label';
  element('span', '本地隔离保存', aiKeyHead).className = 'muted';
  const aiKeyBox = element('div', '', aiKeyField); aiKeyBox.className = 'ai-key-box';
  const aiApiKey = element('input', '', aiKeyBox); aiApiKey.type = 'password'; aiApiKey.name = 'ai-api-key'; aiApiKey.id = 'wd-ai-api-key'; aiKeyLabel.htmlFor = aiApiKey.id;
  aiApiKey.autocomplete = 'off'; aiApiKey.spellcheck = false; aiApiKey.placeholder = '输入对应服务商的 API Key（留空为零 AI 档）';
  const aiToggleKey = element('button', '', aiKeyBox);
  aiToggleKey.type = 'button';
  aiToggleKey.className = 'ai-icon-btn';
  aiToggleKey.dataset.action = 'ai-toggle-key';
  aiToggleKey.dataset.visible = 'false';
  aiToggleKey.setAttribute('aria-label', '显示 API Key');
  aiToggleKey.setAttribute('aria-pressed', 'false');
  aiToggleKey.title = '显示 API Key';
  const aiEyeGlyph = element('span', '', aiToggleKey); aiEyeGlyph.className = 'ai-eye-glyph'; aiEyeGlyph.setAttribute('aria-hidden', 'true');
  const setKeyVisible = visible => {
    aiApiKey.type = visible ? 'text' : 'password';
    aiToggleKey.dataset.visible = visible ? 'true' : 'false';
    aiToggleKey.setAttribute('aria-pressed', String(visible));
    aiToggleKey.setAttribute('aria-label', visible ? '隐藏 API Key' : '显示 API Key');
    aiToggleKey.title = visible ? '隐藏 API Key' : '显示 API Key';
  };
  aiToggleKey.addEventListener('click', () => setKeyVisible(aiApiKey.type === 'password'));

  // 3. Base URL (auto-filled by provider, editable, required on custom)
  const aiBaseUrlField = element('div', '', aiFormStack); aiBaseUrlField.className = 'ai-field';
  const aiBaseUrlHead = element('div', '', aiBaseUrlField); aiBaseUrlHead.className = 'ai-field-head';
  const aiBaseUrlLabel = element('label', 'Base URL', aiBaseUrlHead); aiBaseUrlLabel.className = 'ai-field-label';
  const aiBaseUrlTag = element('span', '可改填中转地址', aiBaseUrlHead); aiBaseUrlTag.className = 'muted'; aiBaseUrlTag.dataset.aiBaseUrlTag = '';
  const aiBaseUrl = element('input', '', aiBaseUrlField); aiBaseUrl.type = 'text'; aiBaseUrl.className = 'ai-url-input'; aiBaseUrl.name = 'ai-base-url'; aiBaseUrl.id = 'wd-ai-base-url'; aiBaseUrlLabel.htmlFor = aiBaseUrl.id;
  aiBaseUrl.spellcheck = false;
  aiBaseUrl.placeholder = 'https://api.deepseek.com/v1';
  const aiBaseUrlError = element('p', '', aiBaseUrlField); aiBaseUrlError.className = 'ai-field-error'; aiBaseUrlError.dataset.aiBaseUrlError = ''; aiBaseUrlError.hidden = true;

  // 4. Model Picker (Fetch Models + Searchable Dropdown + Manual Input Fallback)
  const aiModelField = element('div', '', aiFormStack); aiModelField.className = 'ai-field';
  const aiModelHead = element('div', '', aiModelField); aiModelHead.className = 'ai-field-head';
  const aiModelLabelWrap = element('div', '', aiModelHead); aiModelLabelWrap.className = 'ai-inline-actions';
  const aiModelLabel = element('label', '模型', aiModelLabelWrap); aiModelLabel.className = 'ai-field-label';
  const aiModelCurrentPill = element('span', '', aiModelLabelWrap); aiModelCurrentPill.className = 'ai-model-current-pill'; aiModelCurrentPill.dataset.aiModelCurrent = '';
  const aiModelActions = element('div', '', aiModelHead); aiModelActions.className = 'ai-inline-actions';
  const aiFetchModelsBtn = element('button', '获取模型', aiModelActions);
  aiFetchModelsBtn.type = 'button'; aiFetchModelsBtn.className = 'soft ai-compact-btn'; aiFetchModelsBtn.dataset.action = 'ai-fetch-models';
  const aiFetchModelsCancelBtn = element('button', '取消', aiModelActions);
  aiFetchModelsCancelBtn.type = 'button'; aiFetchModelsCancelBtn.className = 'ghost ai-compact-btn'; aiFetchModelsCancelBtn.dataset.action = 'ai-fetch-models-cancel'; aiFetchModelsCancelBtn.hidden = true;

  const aiModelCombo = element('div', '', aiModelField); aiModelCombo.className = 'ai-model-combo'; aiModelCombo.dataset.aiModelCombo = '';
  const aiModelInputWrap = element('div', '', aiModelCombo); aiModelInputWrap.className = 'ai-model-input-wrap';
  const aiModel = element('input', '', aiModelInputWrap); aiModel.type = 'text'; aiModel.name = 'ai-model'; aiModel.id = 'wd-ai-model'; aiModelLabel.htmlFor = aiModel.id;
  aiModel.autocomplete = 'off'; aiModel.spellcheck = false; aiModel.placeholder = '点击「获取模型」选取，或手动填写模型名';
  const aiModelDropdownToggle = element('button', '▾', aiModelInputWrap);
  aiModelDropdownToggle.type = 'button'; aiModelDropdownToggle.className = 'ai-model-toggle-btn'; aiModelDropdownToggle.dataset.action = 'ai-model-dropdown-toggle';
  aiModelDropdownToggle.setAttribute('aria-label', '展开或收起模型列表'); aiModelDropdownToggle.setAttribute('aria-expanded', 'false');

  const aiModelDropdown = element('div', '', aiModelCombo); aiModelDropdown.className = 'ai-model-dropdown'; aiModelDropdown.dataset.aiModelDropdown = ''; aiModelDropdown.hidden = true;
  const aiModelSearchBar = element('div', '', aiModelDropdown); aiModelSearchBar.className = 'ai-model-search-bar';
  const aiModelSearch = element('input', '', aiModelSearchBar); aiModelSearch.type = 'search'; aiModelSearch.name = 'ai-model-search'; aiModelSearch.dataset.aiModelSearch = '';
  aiModelSearch.placeholder = '搜索模型名称…'; aiModelSearch.setAttribute('aria-label', '搜索可用模型');
  const aiModelCount = element('span', '0 个', aiModelSearchBar); aiModelCount.className = 'ai-model-count'; aiModelCount.dataset.aiModelCount = '';
  const aiModelList = element('div', '', aiModelDropdown); aiModelList.className = 'ai-model-list'; aiModelList.setAttribute('role', 'listbox'); aiModelList.dataset.aiModelList = '';
  const aiModelDropFoot = element('div', '', aiModelDropdown); aiModelDropFoot.className = 'ai-model-drop-foot';
  const aiModelDropMeta = element('span', '点击选择模型', aiModelDropFoot); aiModelDropMeta.dataset.aiModelDropMeta = '';
  const aiModelManualBtn = element('button', '手动输入', aiModelDropFoot);
  aiModelManualBtn.type = 'button'; aiModelManualBtn.className = 'ghost ai-compact-btn'; aiModelManualBtn.dataset.action = 'ai-model-manual';

  const aiModelsFeedback = element('div', '', aiModelField); aiModelsFeedback.className = 'ai-inline-feedback'; aiModelsFeedback.dataset.aiModelsFeedback = ''; aiModelsFeedback.hidden = true;

  // 5. Test Connection Card (inline badge + latency + model + categorized feedback)
  const aiTestCard = element('div', '', aiFormStack); aiTestCard.className = 'ai-test-card'; aiTestCard.dataset.aiTestCard = '';
  const aiTestHead = element('div', '', aiTestCard); aiTestHead.className = 'ai-test-head';
  const aiTestActions = element('div', '', aiTestHead); aiTestActions.className = 'ai-inline-actions';
  const aiTestBtn = element('button', '测试连接', aiTestActions);
  aiTestBtn.type = 'button'; aiTestBtn.className = 'ai-compact-btn'; aiTestBtn.dataset.action = 'ai-test-connection';
  const aiTestCancelBtn = element('button', '取消', aiTestActions);
  aiTestCancelBtn.type = 'button'; aiTestCancelBtn.className = 'ghost ai-compact-btn'; aiTestCancelBtn.dataset.action = 'ai-test-cancel'; aiTestCancelBtn.hidden = true;
  const aiTestBadge = element('span', '', aiTestHead); aiTestBadge.className = 'ai-status-pill'; aiTestBadge.dataset.aiTestBadge = ''; aiTestBadge.dataset.status = 'unconfigured';
  element('span', '', aiTestBadge).className = 'ai-status-dot';
  const aiTestBadgeText = element('span', '未配置', aiTestBadge);
  const aiTestResult = element('div', '', aiTestCard); aiTestResult.className = 'ai-test-result'; aiTestResult.dataset.aiTestResult = '';

  // 6. Advanced Transport Fold
  const aiAdvanced = element('details', '', aiFormStack); aiAdvanced.className = 'ai-advanced'; aiAdvanced.dataset.aiAdvanced = '';
  element('summary', '高级选项 · 请求通道', aiAdvanced);
  const aiAdvancedBody = element('div', '', aiAdvanced); aiAdvancedBody.className = 'ai-advanced-body';
  const aiTransportLabel = element('label', '请求通道', aiAdvancedBody); aiTransportLabel.className = 'ai-field-label';
  const aiTransport = element('select', '', aiAdvancedBody); aiTransport.name = 'ai-transport'; aiTransport.id = 'wd-ai-transport'; aiTransportLabel.htmlFor = aiTransport.id;
  for (const [val, txt] of [['auto', '自动 (优先 GM_xmlhttpRequest → 回退 fetch)'], ['gm', '仅 GM_xmlhttpRequest（绕过浏览器 CORS）'], ['fetch', '仅页面 fetch（需端点放行 CORS）']]) {
    const opt = element('option', txt, aiTransport); opt.value = val;
  }
  element('small', '默认优先走油猴 GM 通道以绕过页面 CORS 限制；非油猴环境自动回退页面 fetch。', aiAdvancedBody).className = 'muted';

  // 7. Footer Actions
  const aiActions = element('div', '', aiFormStack); aiActions.className = 'ai-footer-bar';
  const aiSaveStatus = element('small', '', aiFormStack); aiSaveStatus.className = 'ai-save-status'; aiSaveStatus.dataset.aiSaveStatus = ''; aiSaveStatus.setAttribute('role', 'status');

  // State for fetched model picker & connection status
  let aiFetchedModels = [];
  let aiFetchedMeta = '';
  let aiDropdownOpen = false;
  let aiDropdownFocusedIdx = -1;
  let aiFetchingModels = false;
  let aiTestingConnection = false;
  let aiLastProviderId = null;

  const readAiFormValues = () => ({
    provider: aiProvider.value,
    baseUrl: aiBaseUrl.value.trim(),
    model: aiModel.value.trim(),
    apiKey: aiApiKey.value.trim(),
    transport: aiTransport.value,
  });

  const protoLabelOf = proto => (proto === 'gemini' ? 'Gemini 原生' : proto === 'anthropic' ? 'Anthropic 原生' : 'OpenAI 兼容');
  const channelLabelOf = ch => (ch === 'gm' ? 'GM' : ch === 'fetch' ? 'fetch' : '');

  const setAiConnBadge = (status, label) => {
    const map = { unconfigured: '未配置', idle: '待检测', testing: '检测中', ok: '可用', error: '不可用' };
    const safeStatus = map[status] ? status : 'idle';
    const text = label || map[safeStatus];
    aiTopStatusPill.dataset.status = safeStatus;
    aiTopStatusText.textContent = text;
    aiTestBadge.dataset.status = safeStatus;
    aiTestBadgeText.textContent = text;
  };

  const renderAiTestPlaceholder = () => {
    const vals = readAiFormValues();
    const preset = getAiProviderPreset(vals.provider);
    aiTestResult.replaceChildren();
    delete aiTestResult.dataset.tone;
    if (preset?.requiresApiKey && !vals.apiKey) {
      setAiConnBadge('unconfigured', '未配置');
      element('div', '未填写 API Key（当前为零 AI 本地摘要档）。填好 Key 后可点「获取模型」与「测试连接」。', aiTestResult).className = 'ai-test-detail';
    } else if (!vals.baseUrl) {
      setAiConnBadge('idle', '待配置');
      element('div', '请先填写 Base URL 后再测试连接。', aiTestResult).className = 'ai-test-detail';
    } else if (!vals.model) {
      setAiConnBadge('idle', '待检测');
      element('div', '尚未选择模型。点「测试连接」将先验证端点与 Key 连通性，建议先「获取模型」选取具体模型。', aiTestResult).className = 'ai-test-detail';
    } else {
      setAiConnBadge('idle', '待检测');
      element('div', `当前模型：${vals.model} · 点击「测试连接」验证 Key、端点与模型推理是否可用。`, aiTestResult).className = 'ai-test-detail';
    }
  };

  const syncAiCurrentModelPill = () => {
    const m = aiModel.value.trim();
    aiModelCurrentPill.textContent = m ? `当前：${m}` : '未选模型';
    aiModelCurrentPill.title = m || '尚未选择或填写模型';
  };

  const validateAiBaseUrlField = () => {
    const vals = readAiFormValues();
    const isCustom = vals.provider === 'custom';
    aiBaseUrlTag.textContent = isCustom ? '必填' : '可改填中转地址';
    aiBaseUrlTag.className = isCustom ? 'ai-req-tag' : 'muted';
    if (!vals.baseUrl) {
      if (isCustom) {
        aiBaseUrlError.textContent = '自定义模式必须填写 Base URL（如 https://your-relay.example/v1）';
        aiBaseUrlError.hidden = false;
      } else {
        aiBaseUrlError.hidden = true;
      }
      return false;
    }
    try {
      normalizeAiBaseUrl(vals.baseUrl);
      aiBaseUrlError.hidden = true;
      return true;
    } catch (err) {
      aiBaseUrlError.textContent = err?.message || 'Base URL 格式非法';
      aiBaseUrlError.hidden = false;
      return false;
    }
  };

  const syncProviderMetaUi = () => {
    const vals = readAiFormValues();
    const preset = getAiProviderPreset(vals.provider);
    const proto = resolveAiProtocol(vals);
    aiProtoChip.textContent = protoLabelOf(proto);
    aiCorsCard.dataset.cors = preset?.corsMode || 'custom';
    const prefix = preset?.corsMode === 'direct' ? '✓ ' : (preset?.corsMode === 'relay-needed' || preset?.corsMode === 'proxy-or-relay') ? '⚠ ' : '';
    aiCorsBadge.textContent = `${prefix}${preset?.corsBadge || '自定义端点'}`;
    aiCorsEndpoint.textContent = preset?.modelsEndpointHint || '';
    aiProviderNote.textContent = preset?.note || '';
    aiBaseUrl.placeholder = preset?.baseUrl || 'https://your-openai-compatible-relay.example/v1';
    validateAiBaseUrlField();
  };

  const showAiModelsFeedback = ({ tone = 'info', title = '', hint = '', allowManualFocus = false } = {}) => {
    aiModelsFeedback.replaceChildren();
    if (!title && !hint) {
      aiModelsFeedback.hidden = true;
      return;
    }
    aiModelsFeedback.dataset.tone = tone;
    aiModelsFeedback.hidden = false;
    if (title) {
      const head = element('div', '', aiModelsFeedback); head.className = 'ai-fb-head';
      element('span', title, head);
    }
    if (hint) element('div', hint, aiModelsFeedback).className = 'ai-fb-hint';
    if (allowManualFocus) {
      const fallbackRow = element('div', '', aiModelsFeedback); fallbackRow.className = 'ai-inline-actions';
      const manualBtn = element('button', '改为手动填写模型名', fallbackRow);
      manualBtn.type = 'button'; manualBtn.className = 'ghost ai-compact-btn'; manualBtn.dataset.action = 'ai-manual-fallback';
      manualBtn.addEventListener('click', () => {
        setModelDropdownOpen(false);
        aiModel.focus();
        try { aiModel.select?.(); } catch { /* ignore */ }
      });
    }
  };

  const setModelDropdownOpen = open => {
    aiDropdownOpen = Boolean(open);
    aiModelDropdown.hidden = !aiDropdownOpen;
    aiModelDropdownToggle.setAttribute('aria-expanded', String(aiDropdownOpen));
    aiModelDropdownToggle.textContent = aiDropdownOpen ? '▴' : '▾';
    if (aiDropdownOpen) {
      renderAiModelOptions();
    }
  };

  const selectAiModelId = (modelId, { persist = true, closeDropdown = true } = {}) => {
    const clean = String(modelId || '').trim();
    if (!clean) return;
    const changed = aiModel.value.trim() !== clean;
    aiModel.value = clean;
    syncAiCurrentModelPill();
    if (closeDropdown) setModelDropdownOpen(false);
    showAiModelsFeedback({});
    if (persist) {
      persistAiSettings(changed ? `已选择模型 ${clean} 并保存` : `已保存模型 ${clean}`);
    }
    if (changed) renderAiTestPlaceholder();
  };

  const getFilteredModelItems = () => {
    const rawQuery = aiModelSearch.value.trim().toLowerCase();
    const tokens = rawQuery ? rawQuery.split(/\s+/u).filter(Boolean) : [];
    const currentVal = aiModel.value.trim();
    const list = [...aiFetchedModels];
    if (currentVal && !list.some(item => item.id === currentVal)) {
      list.unshift({ id: currentVal, label: '当前已填（手动/历史配置）', ownedBy: '', nonChat: false, isCurrentCustom: true });
    }
    if (!tokens.length) return list;
    return list.filter(item => {
      const hay = `${item.id} ${item.label || ''} ${item.ownedBy || ''}`.toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
  };

  const renderAiModelOptions = () => {
    aiModelList.replaceChildren();
    const filtered = getFilteredModelItems();
    const total = aiFetchedModels.length;
    aiModelCount.textContent = total > 0
      ? (aiModelSearch.value.trim() ? `${filtered.length} / ${total}` : `共 ${total} 个`)
      : '未拉取';
    aiModelDropMeta.textContent = aiFetchedMeta || '点「获取模型」拉取远程列表';

    if (!filtered.length) {
      const emptyBox = element('div', '', aiModelList); emptyBox.className = 'ai-model-empty';
      const q = aiModelSearch.value.trim();
      if (q) {
        element('span', `未匹配到「${q}」`, emptyBox);
        const useManual = element('button', `直接使用「${q}」`, emptyBox);
        useManual.type = 'button'; useManual.className = 'soft ai-compact-btn'; useManual.dataset.action = 'ai-model-use-query';
        useManual.addEventListener('click', () => selectAiModelId(q));
      } else {
        element('span', '暂无已拉取的模型列表，请先点「获取模型」或在上方直接输入模型名。', emptyBox);
      }
      aiDropdownFocusedIdx = -1;
      return;
    }

    const currentVal = aiModel.value.trim();
    if (aiDropdownFocusedIdx >= filtered.length) aiDropdownFocusedIdx = filtered.length - 1;
    filtered.forEach((item, idx) => {
      const opt = element('button', '', aiModelList);
      opt.type = 'button';
      opt.className = 'ai-model-option';
      opt.setAttribute('role', 'option');
      opt.dataset.modelId = item.id;
      const isSelected = item.id === currentVal;
      opt.setAttribute('aria-selected', String(isSelected));
      if (idx === aiDropdownFocusedIdx) opt.dataset.focused = 'true';

      const main = element('span', '', opt); main.className = 'ai-model-opt-main';
      element('span', item.id, main).className = 'ai-model-opt-id';
      if (item.label) element('span', item.label, main).className = 'ai-model-opt-sub';
      if (item.isCurrentCustom) {
        element('span', '当前', opt).className = 'ai-model-opt-tag';
      } else if (item.nonChat) {
        element('span', '非对话', opt).className = 'ai-model-opt-tag';
      }
      if (isSelected) element('span', '✓', opt).className = 'ai-model-opt-check';

      opt.addEventListener('click', () => selectAiModelId(item.id));
    });
  };

  const persistAiSettings = (customOkText = '') => {
    const vals = readAiFormValues();
    const res = kg.saveSettings(vals);
    if (res.ok) {
      if (customOkText) {
        aiSaveStatus.textContent = customOkText;
      } else {
        aiSaveStatus.textContent = res.settings.apiKey
          ? (res.backend === 'gm' ? '已保存到 GM_setValue 隔离存储' : '已保存到本地 localStorage（非油猴降级模式）')
          : '已保存（零 AI 档）';
      }
    } else {
      aiSaveStatus.textContent = res.error || '保存失败';
    }
    syncStorageWarning();
    return res;
  };

  const setFetchModelsLoading = loading => {
    aiFetchingModels = loading;
    aiFetchModelsBtn.disabled = loading;
    aiFetchModelsCancelBtn.hidden = !loading;
    aiFetchModelsBtn.replaceChildren();
    if (loading) {
      element('span', '', aiFetchModelsBtn).className = 'ai-spinner';
      element('span', '获取中…', aiFetchModelsBtn);
    } else {
      aiFetchModelsBtn.textContent = '获取模型';
    }
  };

  const setTestConnLoading = loading => {
    aiTestingConnection = loading;
    aiTestBtn.disabled = loading;
    aiTestCancelBtn.hidden = !loading;
    aiTestBtn.replaceChildren();
    if (loading) {
      element('span', '', aiTestBtn).className = 'ai-spinner';
      element('span', '检测中…', aiTestBtn);
      setAiConnBadge('testing', '检测中');
    } else {
      aiTestBtn.textContent = '测试连接';
    }
  };

  const handleFetchModels = async () => {
    if (aiFetchingModels) return;
    if (typeof kg.fetchModels !== 'function') {
      showAiModelsFeedback({ tone: 'error', title: '当前服务未启用模型拉取能力', hint: '请直接手动填写模型名。', allowManualFocus: true });
      return;
    }
    const vals = readAiFormValues();
    setFetchModelsLoading(true);
    showAiModelsFeedback({ tone: 'info', title: '正在请求模型列表…', hint: '等待服务商返回，可随时点「取消」中断。' });
    try {
      const res = await kg.fetchModels(vals);
      if (res.aborted) {
        showAiModelsFeedback({ tone: 'warn', title: '已取消获取模型', hint: '可稍后重新获取或直接手动填写模型名。' });
        return;
      }
      if (!res.ok) {
        const statusPart = res.statusCode ? `（HTTP ${res.statusCode}）` : '';
        const title = `${res.label || '获取失败'}${statusPart}：${res.message || '无法拉取模型列表'}`;
        showAiModelsFeedback({
          tone: 'error',
          title,
          hint: `${res.hint || ''}（您仍可随时回退到手动填写模型名）`.trim(),
          allowManualFocus: true,
        });
        return;
      }
      aiFetchedModels = Array.isArray(res.models) ? res.models : [];
      const chText = channelLabelOf(res.channel);
      aiFetchedMeta = `${chText ? `${chText} · ` : ''}${res.latencyMs}ms · 共 ${aiFetchedModels.length} 个`;
      aiModelSearch.value = '';
      aiDropdownFocusedIdx = 0;
      setModelDropdownOpen(true);
      showAiModelsFeedback({
        tone: 'ok',
        title: `已获取 ${aiFetchedModels.length} 个模型（${res.latencyMs}ms）`,
        hint: '请在上方下拉框中搜索并点选模型；选定后自动写入并同步生效。',
      });
      try { aiModelSearch.focus(); } catch { /* ignore */ }
    } catch (err) {
      showAiModelsFeedback({
        tone: 'error',
        title: `获取模型异常：${err?.message || err}`,
        hint: '请检查网络配置或直接手动填写模型名。',
        allowManualFocus: true,
      });
    } finally {
      setFetchModelsLoading(false);
    }
  };

  const renderAiTestResult = res => {
    aiTestResult.replaceChildren();
    if (!res) {
      renderAiTestPlaceholder();
      return;
    }
    if (res.aborted) {
      delete aiTestResult.dataset.tone;
      setAiConnBadge('idle', '已取消');
      element('div', '已取消本次连接测试。', aiTestResult).className = 'ai-test-detail';
      return;
    }
    const chLabel = channelLabelOf(res.channel);
    const metaParts = [];
    if (res.model) metaParts.push(res.model);
    if (Number.isFinite(res.latencyMs) && res.latencyMs > 0) metaParts.push(`${res.latencyMs}ms`);
    if (chLabel) metaParts.push(chLabel);

    if (res.ok) {
      const isDegraded = Boolean(res.degradedScope);
      aiTestResult.dataset.tone = isDegraded ? 'partial' : 'ok';
      setAiConnBadge('ok', isDegraded ? '端点可用' : '可用');
      const sum = element('div', '', aiTestResult); sum.className = 'ai-test-summary';
      element('span', isDegraded ? '✓ 端点可用（未测模型）' : '✓ 可用', sum);
      if (metaParts.length) element('span', metaParts.join(' · '), sum).className = 'ai-test-meta';
      if (res.testedWhat) element('div', res.testedWhat, aiTestResult).className = 'ai-test-detail';
      if (res.notTestedWhat) element('div', res.notTestedWhat, aiTestResult).className = 'ai-test-detail';
      if (res.hint) element('div', res.hint, aiTestResult).className = 'ai-test-detail';
      return;
    }

    aiTestResult.dataset.tone = 'error';
    setAiConnBadge(res.badgeStatus === 'unconfigured' ? 'unconfigured' : 'error', res.statusLabel || '不可用');
    const sum = element('div', '', aiTestResult); sum.className = 'ai-test-summary';
    element('span', `✕ ${res.statusLabel || '不可用'}`, sum);
    if (metaParts.length) element('span', metaParts.join(' · '), sum).className = 'ai-test-meta';
    if (res.message) element('div', res.message, aiTestResult).className = 'ai-test-detail';
    if (res.hint) element('div', res.hint, aiTestResult).className = 'ai-test-detail';
    if (res.testedWhat) element('div', `范围：${res.testedWhat}${res.notTestedWhat ? `；${res.notTestedWhat}` : ''}`, aiTestResult).className = 'ai-test-detail';
  };

  const handleTestConnection = async () => {
    if (aiTestingConnection) return;
    if (typeof kg.testConnection !== 'function') {
      renderAiTestResult({ ok: false, statusLabel: '不可用', message: '当前服务未启用连接测试能力' });
      return;
    }
    const vals = readAiFormValues();
    setTestConnLoading(true);
    aiTestResult.replaceChildren();
    aiTestResult.dataset.tone = 'info';
    element('div', vals.model ? `正在向模型「${vals.model}」发送极小测试请求…` : '尚未选择模型，正在探测端点与 Key 连通性…', aiTestResult).className = 'ai-test-detail';
    try {
      const res = await kg.testConnection(vals);
      renderAiTestResult(res);
      if (res.ok) {
        if (Array.isArray(res.models) && res.models.length && !aiFetchedModels.length) {
          aiFetchedModels = res.models;
          aiFetchedMeta = `${channelLabelOf(res.channel) ? `${channelLabelOf(res.channel)} · ` : ''}${res.latencyMs}ms · 共 ${res.models.length} 个`;
        }
        persistAiSettings(res.degradedScope ? '端点连通并已保存配置（建议再选定模型复测）' : `连接可用（${res.latencyMs}ms），配置已自动保存`);
      }
    } catch (err) {
      renderAiTestResult({ ok: false, category: 'network_error', statusLabel: '网络不通', message: err?.message || String(err) });
    } finally {
      setTestConnLoading(false);
    }
  };

  const syncAiForm = () => {
    const cfg = kg.getSettings();
    aiProvider.value = cfg.provider;
    aiLastProviderId = cfg.provider;
    aiBaseUrl.value = cfg.baseUrl;
    aiModel.value = cfg.model;
    aiApiKey.value = cfg.apiKey;
    aiTransport.value = cfg.transport;
    syncProviderMetaUi();
    syncAiCurrentModelPill();
    renderAiTestPlaceholder();
  };

  aiProvider.addEventListener('change', () => {
    const prevPreset = getAiProviderPreset(aiLastProviderId);
    const nextPreset = getAiProviderPreset(aiProvider.value);
    aiLastProviderId = aiProvider.value;
    if (nextPreset) {
      if (nextPreset.id === 'custom') {
        if (prevPreset && aiBaseUrl.value.trim() === prevPreset.baseUrl) aiBaseUrl.value = '';
      } else if (nextPreset.baseUrl) {
        aiBaseUrl.value = nextPreset.baseUrl;
      }
      if (nextPreset.id !== 'custom') {
        const curModel = aiModel.value.trim();
        if (!curModel || (prevPreset && curModel === prevPreset.model)) {
          aiModel.value = nextPreset.model || '';
        }
      }
    }
    aiFetchedModels = [];
    aiFetchedMeta = '';
    setModelDropdownOpen(false);
    showAiModelsFeedback({});
    syncProviderMetaUi();
    syncAiCurrentModelPill();
    renderAiTestPlaceholder();
    persistAiSettings('已切换服务商并保存');
  });

  aiBaseUrl.addEventListener('input', () => {
    syncProviderMetaUi();
  });
  aiBaseUrl.addEventListener('change', () => {
    syncProviderMetaUi();
    renderAiTestPlaceholder();
    persistAiSettings('已更新 Base URL 并保存');
  });

  aiApiKey.addEventListener('input', () => {
    if (!aiTestingConnection) renderAiTestPlaceholder();
  });
  aiApiKey.addEventListener('change', () => {
    renderAiTestPlaceholder();
    persistAiSettings();
  });

  aiModel.addEventListener('input', () => {
    syncAiCurrentModelPill();
    if (aiDropdownOpen) renderAiModelOptions();
  });
  aiModel.addEventListener('change', () => {
    syncAiCurrentModelPill();
    renderAiTestPlaceholder();
    persistAiSettings();
  });
  aiModel.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' && !aiDropdownOpen && aiFetchedModels.length) {
      ev.preventDefault();
      setModelDropdownOpen(true);
      try { aiModelSearch.focus(); } catch { /* ignore */ }
    } else if (ev.key === 'Escape' && aiDropdownOpen) {
      ev.preventDefault();
      setModelDropdownOpen(false);
    }
  });

  aiModelDropdownToggle.addEventListener('click', () => {
    setModelDropdownOpen(!aiDropdownOpen);
    if (aiDropdownOpen) {
      try { aiModelSearch.focus(); } catch { /* ignore */ }
    }
  });
  shell.addEventListener('click', ev => {
    if (!aiDropdownOpen) return;
    if (aiModelCombo.contains(ev.target) || aiFetchModelsBtn.contains(ev.target)) return;
    setModelDropdownOpen(false);
  });
  aiModelManualBtn.addEventListener('click', () => {
    setModelDropdownOpen(false);
    aiModel.focus();
    try { aiModel.select?.(); } catch { /* ignore */ }
  });
  aiModelSearch.addEventListener('input', () => {
    aiDropdownFocusedIdx = 0;
    renderAiModelOptions();
  });
  aiModelSearch.addEventListener('keydown', ev => {
    const items = getFilteredModelItems();
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (items.length) {
        aiDropdownFocusedIdx = (aiDropdownFocusedIdx + 1) % items.length;
        renderAiModelOptions();
      }
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (items.length) {
        aiDropdownFocusedIdx = aiDropdownFocusedIdx <= 0 ? items.length - 1 : aiDropdownFocusedIdx - 1;
        renderAiModelOptions();
      }
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const targetItem = items[aiDropdownFocusedIdx] || items[0];
      if (targetItem) selectAiModelId(targetItem.id);
      else if (aiModelSearch.value.trim()) selectAiModelId(aiModelSearch.value.trim());
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      setModelDropdownOpen(false);
      aiModel.focus();
    }
  });

  aiTransport.addEventListener('change', () => {
    persistAiSettings('已更新请求通道并保存');
  });

  aiFetchModelsBtn.addEventListener('click', () => { void handleFetchModels(); });
  aiFetchModelsCancelBtn.addEventListener('click', () => { kg.abortFetchModels?.(); });
  aiTestBtn.addEventListener('click', () => { void handleTestConnection(); });
  aiTestCancelBtn.addEventListener('click', () => { kg.abortTestConnection?.(); });

  const aiSaveBtn = button('ai-save', '保存配置', aiActions, () => {
    persistAiSettings();
  }, false);
  aiSaveBtn.className = 'primary';
  const aiResetBtn = button('ai-reset', '恢复默认', aiActions, () => {
    const def = getAiProviderPreset('deepseek');
    aiProvider.value = def.id;
    aiLastProviderId = def.id;
    aiBaseUrl.value = def.baseUrl;
    aiModel.value = def.model;
    aiTransport.value = 'auto';
    aiFetchedModels = [];
    aiFetchedMeta = '';
    setModelDropdownOpen(false);
    showAiModelsFeedback({});
    syncProviderMetaUi();
    syncAiCurrentModelPill();
    const res = kg.saveSettings({
      provider: def.id,
      baseUrl: def.baseUrl,
      model: def.model,
      apiKey: aiApiKey.value,
      transport: 'auto',
    });
    aiSaveStatus.textContent = res.ok ? '已恢复默认模型配置（API Key 保留）' : (res.error || '恢复失败');
    renderAiTestPlaceholder();
  }, false);
  aiResetBtn.className = 'ghost';
  const aiClearBtn = button('ai-clear-key', '清空 Key', aiActions, () => {
    const res = kg.clearApiKey();
    aiApiKey.value = '';
    setKeyVisible(false);
    aiFetchedModels = [];
    aiFetchedMeta = '';
    setModelDropdownOpen(false);
    showAiModelsFeedback({});
    aiSaveStatus.textContent = res.ok ? '已清空本地 API Key' : (res.error || '清空失败');
    renderAiTestPlaceholder();
  }, false);
  aiClearBtn.className = 'danger';
  syncAiForm();

  const unsubscribeAiSettings = kg.onSettingsChange ? kg.onSettingsChange(() => {
    if (kgModal) {
      syncSubtitleControls();
      renderQaDock();
      renderQuizPane();
    }
  }) : () => {};

  // Group 4: 诊断与版本（收进设置，默认不露在首屏）
  const diagGroup = element('div', '', settingsSheet); diagGroup.className = 'settings-group'; diagGroup.dataset.settingsGroup = 'diagnostics';
  element('p', '诊断与版本', diagGroup).className = 'settings-title';
  const versionRow = element('div', '', diagGroup); versionRow.className = 'version-meta'; versionRow.dataset.versionInfo = '';
  element('span', `网大助手 ${version}`, versionRow);
  element('span', 'beta-channel · 本地存储', versionRow);
  const diagBar = element('div', '', diagGroup); diagBar.className = 'diag-bar';
  const diagTrigger = button('diagnose', '页面诊断', diagBar, () => {
    const baseDiag = controller.diagnose();
    const subDiag = kg.getLastDiagnostics?.() || null;
    const payload = subDiag && baseDiag && typeof baseDiag === 'object' ? { ...baseDiag, subtitleDiagnostics: subDiag } : baseDiag;
    diagnostic.textContent = JSON.stringify(payload, null, 2);
    diagnosticBox.hidden = false;
  }, false);
  diagTrigger.className = 'ghost';
  const diagnosticBox = element('div', '', diagGroup); diagnosticBox.dataset.diagnosticBox = ''; diagnosticBox.hidden = true;
  const diagControls = element('div', '', diagnosticBox); diagControls.className = 'diag-bar';
  element('small', '诊断快照', diagControls);
  const diagActions = element('div', '', diagControls); diagActions.className = 'diag-actions';
  const copyDiagButton = button('copy-diagnose', '复制', diagActions, async () => {
    if (!diagnostic.textContent) return;
    if (win.navigator?.clipboard?.writeText) {
      await win.navigator.clipboard.writeText(diagnostic.textContent);
      copyDiagButton.textContent = '已复制';
      if (copyDiagTimer !== null) win.clearTimeout(copyDiagTimer);
      copyDiagTimer = win.setTimeout(() => { copyDiagTimer = null; copyDiagButton.textContent = '复制'; }, 2000);
    }
  }, false);
  copyDiagButton.className = 'ghost';
  const closeDiagButton = button('close-diagnose', '收起', diagActions, () => { diagnosticBox.hidden = true; }, false);
  closeDiagButton.className = 'ghost';
  const diagnostic = element('pre', '', diagnosticBox);
  const playbackDiagnostics = element('details', '', diagGroup); playbackDiagnostics.className = 'separator';
  element('summary', '播放诊断日志', playbackDiagnostics);
  const recordingLabel = element('label', '', playbackDiagnostics); recordingLabel.className = 'check-row';
  const recording = element('input', '', recordingLabel); recording.type = 'checkbox'; recording.name = 'playback-log';
  element('span', '记录播放诊断', recordingLabel);
  const logActions = element('div', '', playbackDiagnostics); logActions.className = 'buttons';
  let logText = null;
  const copyPlaybackLogBtn = button('copy-playback-log', '复制诊断日志', logActions, async () => {
    const text = controller.getPlaybackLogText();
    logText?.remove();
    logText = null;
    if (!text) { logFeedback.textContent = '暂无日志，请先开启记录并复现问题。'; return; }
    try {
      await win.navigator.clipboard.writeText(text);
      logFeedback.textContent = '诊断日志已复制。';
    } catch {
      logText = element('textarea', '', playbackDiagnostics);
      logText.style.cssText = 'width:100%;font:inherit;'; logText.rows = 6; logText.readOnly = true;
      logText.setAttribute('aria-label', '播放诊断日志文本');
      logText.value = text;
      logText.focus();
      logText.select();
      logFeedback.textContent = '浏览器未允许直接复制，日志已选中，可按 Ctrl+C 或 ⌘C 复制。';
    }
  }, false);
  copyPlaybackLogBtn.className = 'ghost';
  const logFeedback = element('p', '默认关闭。日志保留在当前标签页，刷新前请先复制。', playbackDiagnostics);
  logFeedback.className = 'muted'; logFeedback.setAttribute('role', 'status');
  recording.addEventListener('change', () => {
    controller.setPlaybackLogging(recording.checked);
    logFeedback.textContent = recording.checked ? '正在记录。复现后可复制诊断日志。' : '已停止记录，仍可复制已有日志。';
  });

  let kgModal = null;
  let kgMapHandle = null;
  let kgLastResult = null;
  let kgActiveTab = 'quick';
  let kgRunning = false;
  let kgLastScope = 'course';
  let kgLastUsedAi = false;
  let kgMapRenderedFor = null;
  const destroyKgMap = () => { try { kgMapHandle?.destroy?.(); } catch { /* ignore */ } kgMapHandle = null; kgMapRenderedFor = null; };
  const closeKnowledgeModal = () => {
    kg.abort();
    try { kgQaAbort?.abort?.(); } catch { /* ignore */ }
    try { kgQuizAbort?.abort?.(); } catch { /* ignore */ }
    kgRunning = false;
    kgQaBusy = false;
    kgQuizBusy = false;
    destroyKgMap();
    if (kgModal) { kgModal.backdrop.remove(); kgModal = null; }
  };
  const getSectionSegmentIndex = sectionId => {
    const list = getAllCourseSections();
    const target = list.find(s => String(s.sectionId || 'current') === String(sectionId || 'current'))
      || resolveFocusedSection()
      || list[0]
      || null;
    if (!target) return null;
    return buildSegmentIndex(target, { sectionId: target.sectionId || sectionId || 'current', durationSec: target.durationSec });
  };

  const appendHighlightedExcerpt = (container, sourceText, quoteText = '') => {
    const src = String(sourceText || '');
    const rawQuote = String(quoteText || '').trim();
    if (!src) return;
    const cleanQuote = normalizeCitationCompareText(rawQuote);
    // Find best matching substring in sourceText (verbatim or 3+ char keyword chunks) safely using text nodes
    const ranges = [];
    if (rawQuote.length >= 2) {
      const exactIdx = src.toLowerCase().indexOf(rawQuote.toLowerCase());
      if (exactIdx >= 0) {
        ranges.push([exactIdx, exactIdx + rawQuote.length]);
      } else if (cleanQuote.length >= 3) {
        const keywords = rawQuote.split(/[\s，,。！？!?；;：:、（）()《》「」“”"'\[\]【】]+/u).filter(w => w.length >= 2);
        for (const kw of keywords.slice(0, 6)) {
          const idx = src.toLowerCase().indexOf(kw.toLowerCase());
          if (idx >= 0) ranges.push([idx, idx + kw.length]);
        }
      }
    }
    if (!ranges.length) {
      container.append(document.createTextNode(src));
      return;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [s, e] of ranges) {
      const prev = merged.at(-1);
      if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e);
      else merged.push([s, e]);
    }
    let pos = 0;
    for (const [s, e] of merged) {
      if (s > pos) container.append(document.createTextNode(src.slice(pos, s)));
      const mark = document.createElement('mark');
      mark.textContent = src.slice(s, e);
      container.append(mark);
      pos = e;
    }
    if (pos < src.length) container.append(document.createTextNode(src.slice(pos)));
  };

  const shortUnverifiedTag = reasonCode => {
    if (reasonCode === 'id_not_found') return 'ID不存在';
    if (reasonCode === 'time_out_of_bounds') return '时间越界';
    if (reasonCode === 'text_mismatch') return '原文不符';
    if (reasonCode === 'missing_source') return '无原字幕';
    return '待核实';
  };

  const focusDetailTimelineRow = refKey => {
    if (!kgModal || !refKey) return;
    switchKgTab('detail');
    const prevActive = kgModal.detailPane.querySelectorAll('[data-cite-highlighted="true"]');
    for (const node of prevActive) delete node.dataset.citeHighlighted;
    const row = [...kgModal.detailPane.querySelectorAll('[data-timeline-ref-key]')].find(el => el.dataset.timelineRefKey === refKey);
    if (row) {
      row.dataset.citeHighlighted = 'true';
      try { row.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    }
  };

  const toggleInlineEvidence = ({ hostEl, triggerBtn, citation, sectionId, segIdx, onSeek }) => {
    if (!hostEl || !citation) return;
    const existingSlot = hostEl.querySelector(':scope > .kg-evidence-slot');
    const sameTrigger = Boolean(existingSlot && triggerBtn?.dataset?.citeActive === 'true');
    // Clear previous active buttons inside this host
    for (const btn of hostEl.querySelectorAll('[data-cite-active="true"]')) delete btn.dataset.citeActive;
    if (existingSlot) existingSlot.remove();
    delete hostEl.dataset.citeHighlighted;
    if (sameTrigger) return;

    hostEl.dataset.citeHighlighted = 'true';
    if (triggerBtn) triggerBtn.dataset.citeActive = 'true';

    const slot = element('div', '', hostEl);
    slot.className = 'kg-evidence-slot';

    const closeSelf = () => {
      slot.remove();
      delete hostEl.dataset.citeHighlighted;
      if (triggerBtn) delete triggerBtn.dataset.citeActive;
    };

    if (citation.verified) {
      const resolvedSecId = citation.sectionId || sectionId || 'current';
      const resolvedIdx = segIdx || getSectionSegmentIndex(resolvedSecId);
      const neighbors = citation.segId && resolvedIdx ? resolvedIdx.getNeighbors(citation.segId) : { prev: citation.prevSegment || null, current: null, next: citation.nextSegment || null };
      const prevSeg = neighbors.prev || citation.prevSegment || null;
      const nextSeg = neighbors.next || citation.nextSegment || null;
      const curText = neighbors.current?.text || citation.excerpt || '';
      const displayId = citation.displayId || (citation.segId ? `[${citation.segId}]` : '');
      const timeRange = citation.endTimestamp && citation.endTimestamp !== citation.timestamp
        ? `${citation.timestamp}–${citation.endTimestamp}`
        : (citation.timestamp || formatTimestamp(citation.seconds || 0));

      const card = element('div', '', slot);
      card.className = 'kg-evidence-card';
      card.dataset.kgEvidenceCard = '';
      card.dataset.citeStatus = 'verified';
      if (citation.segId) card.dataset.segId = citation.segId;
      if (citation.refKey) card.dataset.refKey = citation.refKey;

      const head = element('div', '', card); head.className = 'kg-ev-head';
      element('span', `原字幕证据 · ${displayId ? `${displayId} · ` : ''}${timeRange}（已核对）`, head);
      const closeBtn = element('button', '收起', head);
      closeBtn.type = 'button'; closeBtn.className = 'kg-mini-btn ghost'; closeBtn.dataset.action = 'kg-evidence-close';
      closeBtn.addEventListener('click', ev => { ev.stopPropagation(); closeSelf(); });

      if (prevSeg && prevSeg.text) {
        const prevBox = element('div', '', card); prevBox.className = 'kg-ev-neighbor'; prevBox.dataset.evNeighbor = 'prev';
        element('span', `上一段 ${prevSeg.displayId || `[${prevSeg.segId}]`} · ${prevSeg.timestamp || formatTimestamp(prevSeg.startSec || 0)}`, prevBox);
        element('div', prevSeg.text, prevBox);
      }

      const curBox = element('div', '', card); curBox.className = 'kg-ev-current'; curBox.dataset.evCurrent = '';
      element('span', `命中原字幕 ${displayId} · ${timeRange}`, curBox);
      const curBody = element('div', '', curBox);
      appendHighlightedExcerpt(curBody, curText || '（原字幕片段已匹配）', citation.rawQuote || citation.rawNote || '');

      if (nextSeg && nextSeg.text) {
        const nextBox = element('div', '', card); nextBox.className = 'kg-ev-neighbor'; nextBox.dataset.evNeighbor = 'next';
        element('span', `下一段 ${nextSeg.displayId || `[${nextSeg.segId}]`} · ${nextSeg.timestamp || formatTimestamp(nextSeg.startSec || 0)}`, nextBox);
        element('div', nextSeg.text, nextBox);
      }

      const actions = element('div', '', card); actions.className = 'kg-ev-actions';
      const seekUnmuteBtn = element('button', '▶ 跳播并开声', actions);
      seekUnmuteBtn.type = 'button'; seekUnmuteBtn.className = 'kg-mini-btn primary';
      seekUnmuteBtn.dataset.action = 'kg-evidence-seek-unmute';
      seekUnmuteBtn.dataset.seekSeconds = String(Math.floor(citation.seconds || 0));
      seekUnmuteBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        (onSeek || handleKgSeek)({ sectionId: resolvedSecId, seconds: Math.floor(citation.seconds || 0), unmute: true });
      });

      const seekMutedBtn = element('button', '仅跳播', actions);
      seekMutedBtn.type = 'button'; seekMutedBtn.className = 'kg-mini-btn ghost';
      seekMutedBtn.dataset.action = 'kg-evidence-seek-only';
      seekMutedBtn.dataset.seekSeconds = String(Math.floor(citation.seconds || 0));
      seekMutedBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        (onSeek || handleKgSeek)({ sectionId: resolvedSecId, seconds: Math.floor(citation.seconds || 0), unmute: false });
      });

      if (citation.refKey) {
        const gotoDetailBtn = element('button', '在细读中定位', actions);
        gotoDetailBtn.type = 'button'; gotoDetailBtn.className = 'kg-mini-btn ghost';
        gotoDetailBtn.dataset.action = 'kg-evidence-goto-detail';
        gotoDetailBtn.addEventListener('click', ev => {
          ev.stopPropagation();
          focusDetailTimelineRow(citation.refKey);
        });
      }
      return;
    }

    // Unverified / untrusted citation inspection panel (NEVER shown as verified evidence!)
    const card = element('div', '', slot);
    card.className = 'kg-evidence-card kg-evidence-unverified';
    card.dataset.kgUnverifiedCard = '';
    card.dataset.citeStatus = 'unverified';
    if (citation.reasonCode) card.dataset.reasonCode = citation.reasonCode;

    const head = element('div', '', card); head.className = 'kg-ev-head';
    element('span', `⚠ 不可信 / 未核实引用（${shortUnverifiedTag(citation.reasonCode)}）`, head);
    const closeBtn = element('button', '收起', head);
    closeBtn.type = 'button'; closeBtn.className = 'kg-mini-btn ghost'; closeBtn.dataset.action = 'kg-evidence-close';
    closeBtn.addEventListener('click', ev => { ev.stopPropagation(); closeSelf(); });

    element('div', `核验失败原因：${citation.reason || '该引用未能与本课节原字幕核对一致，请勿当作已核实依据。'}`, card);

    const detailBox = element('div', '', card); detailBox.className = 'kg-ev-unverified-detail';
    element('div', `AI 原始引用：${citation.rawRef || citation.displayId || '（未提供有效编号）'}`, detailBox);
    if (citation.rawQuote) element('div', `AI 引述内容：「${citation.rawQuote}」`, detailBox);
    if (citation.rawNote && citation.rawNote !== citation.rawQuote) element('div', `AI 依据说明：${citation.rawNote}`, detailBox);
    if (citation.excerpt) {
      element('div', `该编号 ${citation.displayId || ''} 对应的实际原字幕：「${citation.excerpt}」`, detailBox);
    }
  };

  const resolveCitationForItem = (item, sectionId) => {
    if (!item || typeof item !== 'object') return null;
    if (item.citation && typeof item.citation === 'object') return item.citation;
    const segIdx = getSectionSegmentIndex(sectionId);
    const hasRef = Boolean(item.segId || (Number.isFinite(item.seconds) && item.seconds >= 0));
    if (!hasRef) return null;
    if (segIdx && segIdx.segments.length) {
      return verifyCitation({
        segId: item.segId,
        seconds: item.seconds,
        quote: item.quote,
        sectionId,
      }, segIdx, { claimText: item.text || item.question || item.definition || '', minClaimCheckChars: 9999 });
    }
    if (Number.isFinite(item.seconds) && item.seconds >= 0) {
      const floorSec = Math.floor(item.seconds);
      return {
        status: 'verified',
        verified: true,
        segId: item.segId || null,
        displayId: item.segId ? `[${item.segId}]` : formatTimestamp(floorSec),
        refKey: item.refKey || null,
        sectionId: sectionId || 'current',
        seconds: floorSec,
        timestamp: formatTimestamp(floorSec),
        endTimestamp: formatTimestamp(floorSec),
        minuteLabel: `约第 ${Math.floor(floorSec / 60) + 1} 分钟`,
        excerpt: item.excerpt || item.text || '',
        rawQuote: '',
      };
    }
    return null;
  };

  const createCitationBtn = (parent, { item, sectionId, hostEl, onSeek, labelPrefix = '' } = {}) => {
    const citation = resolveCitationForItem(item, sectionId);
    if (!citation) return null;
    const btn = element('button', '', parent);
    btn.type = 'button';
    btn.dataset.citeStatus = citation.verified ? 'verified' : 'unverified';
    if (citation.verified) {
      const idPart = citation.segId ? `[${citation.segId}] ` : '';
      const tsPart = citation.timestamp || formatTimestamp(citation.seconds || 0);
      btn.textContent = `${labelPrefix}${idPart}${tsPart}`;
      btn.className = 'kg-cite-btn';
      if (citation.segId) btn.dataset.segId = citation.segId;
      if (citation.refKey) btn.dataset.refKey = citation.refKey;
      btn.dataset.seekSeconds = String(Math.floor(citation.seconds || 0));
      btn.title = '点击原地标黄并展开原字幕证据（再决定是否跳播开声）';
    } else {
      btn.textContent = `⚠ 未核实 · ${shortUnverifiedTag(citation.reasonCode)}`;
      btn.className = 'kg-cite-btn kg-cite-unverified';
      if (citation.reasonCode) btn.dataset.reasonCode = citation.reasonCode;
      btn.title = '该引用未通过原字幕核验，点击查看详情与 AI 原始表述';
    }
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const segIdx = getSectionSegmentIndex(citation.sectionId || sectionId);
      toggleInlineEvidence({
        hostEl: hostEl || parent,
        triggerBtn: btn,
        citation,
        sectionId: citation.sectionId || sectionId || 'current',
        segIdx,
        onSeek,
      });
    });
    return btn;
  };
  const cleanDisplayText = (text, maxLen = 140) => sanitizeCompleteText(text, { maxLen, allowShort: true, stripPrefixes: true });

  const resolveSectionSourceBadge = (sec, resultMeta = {}) => {
    if (sec?.hasSubtitle === false) {
      return sec.mode === 'highlight'
        ? { text: '本地摘要（平台看点）', tone: 'local', source: 'local' }
        : { text: '无字幕', tone: 'nosub', source: 'nosub' };
    }
    if (sec?.mode === 'ai') return { text: 'AI 生成', tone: 'ai', source: 'ai' };
    if (sec?.mode === 'highlight') return { text: '本地摘要（平台看点）', tone: 'local', source: 'local' };
    if (sec?.mode === 'placeholder') return { text: '目录占位', tone: 'local', source: 'local' };
    if (sec?.fallbackReason || resultMeta?.fallback) {
      return { text: '本地摘要（降级）', tone: 'fallback', source: 'fallback' };
    }
    return { text: '本地摘要', tone: 'local', source: 'local' };
  };

  const renderSourceCallout = (container, tree, resultMeta = {}) => {
    if (!tree || tree.noSubtitle || resultMeta.noSubtitle) return;
    const usedAi = Boolean(resultMeta.usedAi ?? (tree.mode === 'ai' || tree.mode === 'ai-partial'));
    const failedList = Array.isArray(resultMeta.failedSections) && resultMeta.failedSections.length
      ? resultMeta.failedSections
      : (Array.isArray(tree.failedSections) ? tree.failedSections : []);
    const isFallback = Boolean(resultMeta.fallback || failedList.length > 0 || tree.mode === 'ai-partial');
    // Pure AI mode: keep existing clean AI reading experience completely untouched!
    if (usedAi && !isFallback) return;

    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    const isPartial = usedAi && isFallback;
    const callout = element('div', '', container);
    callout.className = 'kg-source-callout';
    callout.dataset.kgSourceCallout = '';
    callout.dataset.tone = isFallback ? 'fallback' : 'local';
    callout.dataset.sourceState = isPartial
      ? 'partial-fallback'
      : isFallback
        ? 'fallback-error'
        : hasKey
          ? 'local-ready'
          : 'local-no-key';

    const bodyBox = element('div', '', callout); bodyBox.className = 'kg-source-callout-body';
    const titleText = isPartial
      ? '部分课节为本地摘要（未使用 AI），开启/修复 AI 解读可获得完整讲解'
      : '当前为本地摘要（未使用 AI），开启/修复 AI 解读可获得完整讲解';
    const titleEl = element('div', titleText, bodyBox);
    titleEl.className = 'kg-source-callout-title';
    titleEl.dataset.kgSourceCalloutTitle = '';

    let descText = '';
    if (isPartial) {
      const detail = failedList.slice(0, 2).map(f => `《${f.title || '课节'}》（${f.reason || '调用失败'}）`).join('、');
      descText = detail
        ? `降级原因：${detail}${failedList.length > 2 ? ` 等 ${failedList.length} 节` : ''}调用失败，已自动降级为本地摘要；其余课节为 AI 生成。`
        : (tree.fallbackReason || '部分课节 AI 解读失败，已局部降级为本地摘要。');
    } else if (isFallback) {
      const rawReason = String(failedList[0]?.reason || tree.fallbackReason || 'AI 调用失败').trim();
      descText = rawReason.startsWith('降级原因') ? rawReason : `降级原因：${rawReason}`;
    } else if (!hasKey) {
      descText = '当前尚未配置 API Key，下方内容由本地字幕规则提炼（不消耗 token）；配置后即可使用 AI 解读。';
    } else {
      descText = '已检测到本地 AI 配置，当前展示为默认本地摘要（0 token）；点击「立即 AI 解读」即可生成完整讲解。';
    }
    const descEl = element('div', descText, bodyBox);
    descEl.className = 'kg-source-callout-desc';
    descEl.dataset.kgSourceCalloutDesc = '';

    const actions = element('div', '', callout); actions.className = 'kg-source-callout-actions';
    if (!isFallback && hasKey) {
      const runAiBtn = element('button', '立即 AI 解读', actions);
      runAiBtn.type = 'button'; runAiBtn.className = 'kg-mini-btn primary';
      runAiBtn.dataset.action = 'kg-callout-run-ai';
      runAiBtn.addEventListener('click', () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }));
      const cfgBtn = element('button', '前往 AI 设置', actions);
      cfgBtn.type = 'button'; cfgBtn.className = 'kg-mini-btn ghost';
      cfgBtn.dataset.action = 'kg-callout-settings';
      cfgBtn.addEventListener('click', openAiSettingsFromModal);
    } else {
      const cfgBtn = element('button', isFallback ? '修复 AI 设置' : '前往 AI 设置', actions);
      cfgBtn.type = 'button'; cfgBtn.className = 'kg-mini-btn primary';
      cfgBtn.dataset.action = 'kg-callout-settings';
      cfgBtn.addEventListener('click', openAiSettingsFromModal);
      if (isFallback && hasKey) {
        const retryBtn = element('button', '重试 AI 解读', actions);
        retryBtn.type = 'button'; retryBtn.className = 'kg-mini-btn ghost';
        retryBtn.dataset.action = 'kg-callout-retry-ai';
        retryBtn.addEventListener('click', () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: true, forceRefresh: true }));
      }
    }
  };

  const renderKnowledgeQuick = (container, tree, onSeek, onSwitchTab, resultMeta = {}) => {
    container.replaceChildren();
    const sections = Array.isArray(tree?.sections) ? tree.sections : [];
    if (!sections.length) { element('p', '暂无可展示的课节或字幕内容。', container).className = 'muted'; return; }

    renderSourceCallout(container, tree, resultMeta);

    const usedAi = Boolean(resultMeta.usedAi ?? (tree.mode === 'ai' || tree.mode === 'ai-partial'));
    const isFallback = Boolean(resultMeta.fallback || tree.mode === 'ai-partial');

    // Course-level overview card when multiple sections are present
    if (sections.length > 1) {
      const courseCard = element('div', '', container); courseCard.className = 'kg-card kg-card-course'; courseCard.dataset.kgCourseOverview = '';
      const head = element('div', '', courseCard); head.className = 'kg-card-head';
      element('h3', `整门课总览 · ${tree.scopeLabel || `共 ${sections.length} 节`}`, head);
      const headRight = element('div', '', head); headRight.className = 'kg-card-head-right';
      const courseSource = tree.noSubtitle
        ? { text: '无字幕', tone: 'nosub', source: 'nosub' }
        : (usedAi && !isFallback)
          ? { text: 'AI 生成', tone: 'ai', source: 'ai' }
          : (usedAi && isFallback)
            ? { text: 'AI 生成 · 局部降级', tone: 'fallback', source: 'fallback' }
            : isFallback
              ? { text: '本地摘要（降级）', tone: 'fallback', source: 'fallback' }
              : { text: '本地摘要', tone: 'local', source: 'local' };
      const courseSourceBadge = element('span', courseSource.text, headRight);
      courseSourceBadge.className = 'kg-badge';
      courseSourceBadge.dataset.tone = courseSource.tone;
      courseSourceBadge.dataset.kgSourceBadge = courseSource.source;
      const mapJump = element('button', '查看全课导图 →', headRight); mapJump.type = 'button'; mapJump.className = 'kg-mini-btn ghost';
      mapJump.addEventListener('click', () => onSwitchTab('map'));
      const themes = Array.isArray(tree.courseThemes) ? tree.courseThemes.map(t => cleanDisplayText(t, 24)).filter(Boolean) : [];
      if (themes.length) {
        const themeBar = element('div', '', courseCard); themeBar.className = 'kg-theme-bar'; themeBar.dataset.kgCourseThemes = '';
        element('span', '核心主题', themeBar).className = 'kg-theme-label';
        for (const t of themes.slice(0, 5)) {
          element('span', t, themeBar).className = 'kg-theme-chip';
        }
      }
      const cleanOverview = cleanDisplayText(tree.overview || '', 160);
      if (cleanOverview) {
        const lead = element('p', cleanOverview, courseCard); lead.className = 'kg-one-line'; lead.dataset.kgOverview = '';
      }
      const cleanCourseKps = (Array.isArray(tree.courseKeyPoints) ? tree.courseKeyPoints : [])
        .map(kp => ({ ...kp, text: cleanDisplayText(kp?.text || '', 80) }))
        .filter(kp => kp.text);
      if (cleanCourseKps.length) {
        element('div', `全课核心要点 · ${cleanCourseKps.length}`, courseCard).className = 'kg-subhead';
        const ol = element('ol', '', courseCard); ol.className = 'kg-kp-list'; ol.dataset.kgCourseKeypoints = '';
        cleanCourseKps.forEach((kp, idx) => {
          const li = element('li', '', ol); li.className = 'kg-kp-item';
          element('span', String(idx + 1), li).className = 'kg-kp-num';
          const textWrap = element('span', kp.text, li); textWrap.className = 'kg-kp-text';
          const meta = element('span', '', li); meta.className = 'kg-kp-meta';
          const secIdx = Number.isFinite(kp.sectionIndex) ? kp.sectionIndex
            : (sections.findIndex(s => String(s.sectionId) === String(kp.sectionId)) + 1 || null);
          if (Array.isArray(kp.coveredSections) && kp.coveredSections.length > 1) {
            const tag = element('span', `跨 ${kp.coveredSections.length} 节`, meta);
            tag.className = 'kg-kp-sec-tag';
            tag.title = `覆盖第 ${kp.coveredSections.join('、')} 节`;
          } else if (secIdx) {
            const tag = element('span', `第 ${secIdx} 节`, meta);
            tag.className = 'kg-kp-sec-tag';
            if (kp.sectionTitle) tag.title = kp.sectionTitle;
          }
          createCitationBtn(meta, { item: kp, sectionId: kp.sectionId || 'current', hostEl: li, onSeek });
        });
      }
      if (Array.isArray(tree.skippedNoSubtitleSections) && tree.skippedNoSubtitleSections.length) {
        const skipBox = element('div', '', courseCard); skipBox.className = 'kg-skipped-box'; skipBox.dataset.kgSkippedList = '';
        const names = tree.skippedNoSubtitleSections.map(s => `《${s.title}》`).join('、');
        skipBox.textContent = `已静默跳过 ${tree.skippedNoSubtitleSections.length} 个无字幕课节：${names}`;
      }
    }

    const silentSkipMixed = sections.length > 1 && tree?.hasAnySubtitle === true;
    for (const sec of sections) {
      const isNoSub = sec.hasSubtitle === false;
      if (isNoSub && silentSkipMixed && sec.mode !== 'highlight') continue;
      const card = element('div', '', container); card.className = 'kg-card'; card.dataset.kgSectionCard = sec.sectionId || '';
      const head = element('div', '', card); head.className = 'kg-card-head';
      const titleText = `${sec.chapterTitle ? `${sec.chapterTitle} · ` : ''}${sec.title || '课节'}`;
      element('h3', titleText, head);
      const srcInfo = resolveSectionSourceBadge(sec, resultMeta);
      const secBadge = element('span', srcInfo.text, head);
      secBadge.className = 'kg-badge';
      secBadge.dataset.tone = srcInfo.tone;
      secBadge.dataset.kgSourceBadge = srcInfo.source;

      if (isNoSub) {
        const noSubBox = element('div', '', card); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgNoSubtitle = sec.sectionId || 'current';
        element('strong', '本课无字幕', noSubBox);
        const detailReason = String(sec.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
        element('div', detailReason, noSubBox);
        if (sec.mode !== 'highlight') continue;
      }

      if (usedAi && sec.mode !== 'ai' && sec.fallbackReason) {
        const secNote = element('div', '', card); secNote.className = 'kg-sec-fallback-note'; secNote.dataset.kgSecFallbackNote = sec.sectionId || '';
        element('span', `本节 AI 解读失败（${sec.fallbackReason}），已降级为本地摘要。`, secNote);
        const fixBtn = element('button', 'AI 设置', secNote); fixBtn.type = 'button'; fixBtn.className = 'kg-mini-btn ghost';
        fixBtn.addEventListener('click', openAiSettingsFromModal);
      }

      // 1. Section summary (guarded against truncated ellipsis fragments)
      const cleanSecSummary = cleanDisplayText(sec.summary || '', 140);
      if (cleanSecSummary) {
        const sum = element('p', cleanSecSummary, card); sum.className = 'kg-one-line'; sum.dataset.kgSectionSummary = '';
      }

      // 2. Core Key Points Card (drop truncated fragments cleanly)
      const cleanSecKps = (Array.isArray(sec.keyPoints) ? sec.keyPoints : [])
        .map(kp => ({ ...kp, text: cleanDisplayText(kp?.text || '', 80) }))
        .filter(kp => kp.text);
      if (cleanSecKps.length) {
        element('div', `核心要点 · ${cleanSecKps.length}`, card).className = 'kg-subhead';
        const ol = element('ol', '', card); ol.className = 'kg-kp-list'; ol.dataset.kgKeypoints = '';
        cleanSecKps.forEach((kp, idx) => {
          const li = element('li', '', ol); li.className = 'kg-kp-item';
          element('span', String(idx + 1), li).className = 'kg-kp-num';
          element('span', kp.text, li).className = 'kg-kp-text';
          createCitationBtn(li, { item: kp, sectionId: sec.sectionId || 'current', hostEl: li, onSeek });
        });
      }

      // Chunk summaries shown when long-section aggregation degraded
      if (Array.isArray(sec.chunkSummaries) && sec.chunkSummaries.length > 1) {
        const cleanChunks = sec.chunkSummaries
          .map(cs => ({ ...cs, summary: cleanDisplayText(cs?.summary || '', 120) }))
          .filter(cs => cs.summary);
        if (cleanChunks.length > 1) {
          element('div', `分段摘要 · ${cleanChunks.length}`, card).className = 'kg-subhead';
          const ul = element('ul', '', card); ul.className = 'kg-points'; ul.dataset.kgChunkSummaries = '';
          for (const cs of cleanChunks) {
            const li = element('li', '', ul);
            element('span', `第 ${cs.chunkIndex} 段：${cs.summary}`, li);
            createCitationBtn(li, { item: cs, sectionId: sec.sectionId || 'current', hostEl: li, onSeek });
          }
        }
      }

      // 3. 3-level Hierarchical Outline (default collapsed at 3rd level)
      const outline = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
      const cleanOutline = outline
        .map(topic => ({
          name: cleanDisplayText(topic?.name || '主题', 40) || '主题',
          points: (Array.isArray(topic?.points) ? topic.points : [])
            .map(pt => ({ ...pt, text: cleanDisplayText(pt?.text || '', 80) }))
            .filter(pt => pt.text),
        }))
        .filter(topic => topic.points.length > 0);
      if (cleanOutline.length) {
        element('div', '知识大纲', card).className = 'kg-subhead';
        const foldList = element('div', '', card); foldList.className = 'kg-fold-list'; foldList.dataset.kgOutline = '';
        for (const topic of cleanOutline) {
          const details = element('details', '', foldList); details.className = 'kg-topic-fold'; details.open = false;
          const summary = element('summary', '', details);
          element('span', topic.name, summary);
          element('span', `${topic.points.length}`, summary).className = 'kg-topic-count';
          const ul = element('ul', '', details); ul.className = 'kg-points';
          for (const pt of topic.points) {
            const li = element('li', '', ul);
            element('span', pt.text, li);
            createCitationBtn(li, { item: pt, sectionId: sec.sectionId || 'current', hostEl: li, onSeek });
          }
        }
      }

      // 4. Q&A Self-Check
      const cleanQuiz = (Array.isArray(sec.quiz) ? sec.quiz : [])
        .map(item => ({
          ...item,
          question: cleanDisplayText(item?.question || '', 120),
          answer: cleanDisplayText(item?.answer || '', 220),
        }))
        .filter(item => item.question && item.answer);
      if (cleanQuiz.length) {
        element('div', `自测 · ${cleanQuiz.length}`, card).className = 'kg-subhead';
        const qList = element('div', '', card); qList.className = 'kg-quiz-list'; qList.dataset.kgQuiz = '';
        cleanQuiz.forEach((item, idx) => {
          const qCard = element('div', '', qList); qCard.className = 'kg-quiz-item';
          const qTop = element('div', '', qCard); qTop.className = 'kg-quiz-q';
          element('span', `Q${idx + 1}. ${item.question}`, qTop);
          const qActions = element('div', '', qTop); qActions.className = 'kg-quiz-actions';
          createCitationBtn(qActions, { item, sectionId: sec.sectionId || 'current', hostEl: qCard, onSeek });
          const ansBox = element('div', item.answer, qCard); ansBox.className = 'kg-quiz-ans'; ansBox.dataset.kgQuizAnswer = ''; ansBox.hidden = true;
          const revealBtn = element('button', '答案', qActions); revealBtn.type = 'button'; revealBtn.className = 'kg-mini-btn ghost'; revealBtn.dataset.action = `kg-quiz-toggle-${sec.sectionIndex || 1}-${idx}`;
          revealBtn.addEventListener('click', () => {
            ansBox.hidden = !ansBox.hidden;
            revealBtn.textContent = ansBox.hidden ? '答案' : '收起';
          });
        });
      }

      // 5. Glossary / Term Cards (complete plain-language definitions + importance tag, never truncated)
      const cleanGlossary = (Array.isArray(sec.glossary) ? sec.glossary : [])
        .map(g => ({
          ...g,
          term: cleanDisplayText(g?.term || '', 32),
          definition: cleanDisplayText(g?.definition || '', 90),
        }))
        .filter(g => g.term && g.definition);
      if (cleanGlossary.length) {
        element('div', `术语 · ${cleanGlossary.length}`, card).className = 'kg-subhead';
        const grid = element('div', '', card); grid.className = 'kg-glossary-grid'; grid.dataset.kgGlossary = '';
        for (const g of cleanGlossary) {
          const tCard = element('div', '', grid); tCard.className = 'kg-term-card';
          const tHead = element('div', '', tCard); tHead.className = 'kg-term-head';
          const tTitleWrap = element('span', '', tHead); tTitleWrap.className = 'kg-term-title-wrap';
          element('strong', g.term, tTitleWrap);
          if (g.importance) {
            const tag = element('span', g.importance, tTitleWrap);
            tag.className = 'kg-term-tag';
            tag.dataset.core = String(g.isCore === true || g.importance === '本课重点');
          }
          createCitationBtn(tHead, { item: g, sectionId: sec.sectionId || 'current', hostEl: tCard, onSeek });
          element('p', g.definition, tCard).className = 'kg-term-def';
        }
      }
    }
  };

  const renderKnowledgeDetail = (container, tree, onSeek, resultMeta = {}) => {
    container.replaceChildren();
    const sections = Array.isArray(tree?.sections) ? tree.sections : [];
    if (!sections.length) { element('p', '暂无课节内容。', container).className = 'muted'; return; }
    renderSourceCallout(container, tree, resultMeta);
    const silentSkipMixed = sections.length > 1 && tree?.hasAnySubtitle === true;
    for (const sec of sections) {
      if (sec.hasSubtitle === false && silentSkipMixed && sec.mode !== 'highlight') continue;
      const card = element('div', '', container); card.className = 'kg-card';
      const head = element('div', '', card); head.className = 'kg-card-head';
      element('h3', `${sec.chapterTitle ? `${sec.chapterTitle} · ` : ''}${sec.title || '课节'}`, head);
      const srcInfo = resolveSectionSourceBadge(sec, resultMeta);
      const badge = element('span', srcInfo.text, head);
      badge.className = 'kg-badge';
      badge.dataset.tone = srcInfo.tone;
      badge.dataset.kgSourceBadge = srcInfo.source;
      if (sec.hasSubtitle === false) {
        const noSubBox = element('div', '', card); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgNoSubtitleDetail = sec.sectionId || 'current';
        element('strong', '本课无字幕', noSubBox);
        const detailReason = String(sec.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
        element('div', detailReason, noSubBox);
        if (sec.mode !== 'highlight') continue;
      }
      const cleanSecSummary = cleanDisplayText(sec.summary || '', 140);
      if (cleanSecSummary) element('p', cleanSecSummary, card).className = 'kg-one-line';

      const outline = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
      const cleanOutline = outline
        .map(topic => ({
          name: cleanDisplayText(topic?.name || '主题', 40) || '主题',
          points: (Array.isArray(topic?.points) ? topic.points : [])
            .map(pt => ({ ...pt, text: cleanDisplayText(pt?.text || '', 80) }))
            .filter(pt => pt.text),
        }))
        .filter(topic => topic.points.length > 0);
      if (cleanOutline.length) {
        element('div', '完整知识点', card).className = 'kg-subhead';
        for (const topic of cleanOutline) {
          const tHead = element('div', topic.name, card); tHead.className = 'settings-title';
          const ul = element('ul', '', card); ul.className = 'kg-points';
          for (const pt of topic.points) {
            const li = element('li', '', ul);
            element('span', pt.text, li);
            createCitationBtn(li, { item: pt, sectionId: sec.sectionId || 'current', hostEl: li, onSeek });
          }
        }
      }

      if (Array.isArray(sec.timeline) && sec.timeline.length) {
        element('div', `字幕时间轴 · ${sec.timeline.length}`, card).className = 'kg-subhead';
        const tlBox = element('div', '', card); tlBox.dataset.kgTimeline = '';
        sec.timeline.forEach((item, idx) => {
          const segId = item.segId || `S${String(item.index || idx + 1).padStart(2, '0')}`;
          const secId = sec.sectionId || 'current';
          const refKey = item.refKey || `${secId}#${segId}`;
          const row = element('div', '', tlBox);
          row.className = 'kg-timeline-item';
          row.dataset.timelineSegId = segId;
          row.dataset.timelineRefKey = refKey;
          const secNum = Number.isFinite(item.startSec) ? Math.floor(item.startSec) : 0;
          const badgeBtn = element('span', `[${segId}] ${item.timestamp || formatTimestamp(secNum)}`, row);
          badgeBtn.className = 'kg-timeline-seg-badge';
          element('div', item.text || item.headline || '', row).className = 'kg-timeline-text';
          const playBtn = element('button', '▶ 跳播并开声', row);
          playBtn.type = 'button'; playBtn.className = 'kg-mini-btn ghost';
          playBtn.dataset.action = 'kg-timeline-seek-unmute';
          playBtn.dataset.seekSeconds = String(secNum);
          playBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            onSeek({ sectionId: secId, seconds: secNum, unmute: true });
          });
        });
      }
    }
  };

  const ensureKgMapRendered = async () => {
    if (!kgModal || !kgLastResult?.markdown) return;
    const token = `${kgLastResult.tree?.generatedAt || ''}:${kgLastResult.markdown.length}`;
    const fitSoon = () => {
      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => kgMapHandle?.fit?.());
      else kgMapHandle?.fit?.();
      if (typeof win.setTimeout === 'function') win.setTimeout(() => kgMapHandle?.fit?.(), 120);
    };
    if (kgMapRenderedFor === token && kgMapHandle) {
      if (kgActiveTab === 'map') fitSoon();
      return;
    }
    destroyKgMap();
    kgModal.engineFoot.textContent = '正在渲染交互导图…';
    kgMapHandle = await renderKnowledgeMindmap({
      svg: kgModal.svg,
      markdown: kgLastResult.markdown,
      onSeek: handleKgSeek,
      ...(kg.mapOptions || {}),
    });
    kgMapRenderedFor = token;
    if (kgModal) {
      kgModal.engineFoot.textContent = kgMapHandle.engine === 'markmap'
        ? '导图引擎：markmap（支持滚轮缩放、拖拽、点击节点折叠及点击 mm:ss 跳播）'
        : '导图引擎：内置交互 SVG 导图（markmap CDN 未加载或离线降级，支持缩放/拖拽/折叠/点击 mm:ss 跳播）';
      if (kgActiveTab === 'map') fitSoon();
    }
  };

  let kgFocusSectionId = null;
  let kgActiveChatSessionId = null;
  let kgQaExpanded = false;
  let kgQaBusy = false;
  let kgQuizBusy = false;
  let kgQaAbort = null;
  let kgQuizAbort = null;

  const getAllCourseSections = () => {
    const raw = Array.isArray(kgLastResult?.courseData?.sections) ? kgLastResult.courseData.sections : [];
    const treeSecs = Array.isArray(kgLastResult?.tree?.sections) ? kgLastResult.tree.sections : [];
    const merged = [];
    const byId = new Map();
    for (const s of raw) {
      const id = String(s.sectionId || 'current');
      const copySec = { ...s };
      byId.set(id, copySec);
      merged.push(copySec);
    }
    for (const t of treeSecs) {
      const id = String(t.sectionId || 'current');
      const hit = byId.get(id);
      if (hit) {
        Object.assign(hit, {
          hasSubtitle: typeof hit.hasSubtitle === 'boolean' ? hit.hasSubtitle : t.hasSubtitle,
          subtitleStatus: hit.subtitleStatus && hit.subtitleStatus !== 'pending' ? hit.subtitleStatus : t.subtitleStatus,
          subtitleReason: hit.subtitleReason || t.subtitleReason || '',
          subtitleLogs: hit.subtitleLogs?.length ? hit.subtitleLogs : (t.subtitleLogs || []),
          summary: t.summary || hit.summary || '',
          keyPoints: t.keyPoints || hit.keyPoints || [],
          outline: t.outline || t.topics || hit.outline || [],
          topics: t.topics || t.outline || hit.topics || [],
          timeline: t.timeline?.length ? t.timeline : hit.timeline,
        });
      } else {
        const copyTree = { ...t };
        byId.set(id, copyTree);
        merged.push(copyTree);
      }
    }
    return merged;
  };

  const resolveFocusedSection = () => {
    const list = getAllCourseSections();
    if (!list.length) return null;
    if (kgFocusSectionId) {
      const match = list.find(s => String(s.sectionId) === String(kgFocusSectionId));
      if (match) return match;
    }
    return list.find(s => s.active) || list[0];
  };

  const getCurrentCourseId = () => kgLastResult?.courseData?.courseId || kgLastResult?.tree?.courseId || 'unknown';

  const openAiSettingsFromModal = () => {
    closeKnowledgeModal();
    setOpen(true);
    settingsBox.open = true;
    syncAiForm();
    try { aiGroup.scrollIntoView?.({ block: 'nearest' }); } catch { /* ignore */ }
    if (aiApiKey.value.trim()) aiModel.focus();
    else aiApiKey.focus();
  };

  const renderTextWithCitations = (container, text, sectionId, hostEl, onSeek, knownCitations = []) => {
    container.replaceChildren();
    const tokens = tokenizeTextWithCitations(text);
    const segIdx = getSectionSegmentIndex(sectionId);
    const knownBySeg = new Map();
    for (const c of (Array.isArray(knownCitations) ? knownCitations : [])) {
      if (c?.segId && !knownBySeg.has(c.segId)) knownBySeg.set(c.segId, c);
    }

    const mountInlineCite = cite => {
      const btn = element('button', '', container);
      btn.type = 'button';
      btn.dataset.citeStatus = cite.verified ? 'verified' : 'unverified';
      if (cite.verified) {
        btn.className = 'kg-inline-cite';
        btn.textContent = cite.displayId || `[${cite.segId}]`;
        if (cite.segId) btn.dataset.segId = cite.segId;
        if (cite.refKey) btn.dataset.refKey = cite.refKey;
        btn.dataset.seekSeconds = String(Math.floor(cite.seconds || 0));
        btn.title = `点击原地标黄并展开原字幕 ${cite.displayId || ''}（${cite.timestamp}）`;
      } else {
        btn.className = 'kg-inline-cite kg-cite-unverified';
        btn.textContent = `⚠ 未核实(${cite.rawRef || cite.displayId || '?'})`;
        if (cite.reasonCode) btn.dataset.reasonCode = cite.reasonCode;
        btn.title = '该引用未通过原字幕核验，点击查看核验详情';
      }
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        toggleInlineEvidence({
          hostEl: hostEl || container,
          triggerBtn: btn,
          citation: cite,
          sectionId: cite.sectionId || sectionId || 'current',
          segIdx,
          onSeek,
        });
      });
    };

    for (const tok of tokens) {
      if (tok.type === 'text') {
        container.append(document.createTextNode(tok.text));
      } else if (tok.type === 'segRef') {
        for (const ref of tok.refs) {
          const matchedKnown = knownBySeg.get(ref.segId);
          const verified = matchedKnown || verifyCitation({ segId: ref.raw, sectionId: ref.sectionId || sectionId }, segIdx);
          mountInlineCite(verified);
        }
      } else if (tok.type === 'timeRef') {
        const verified = verifyCitation({ time: tok.raw, sectionId }, segIdx);
        mountInlineCite(verified);
      }
    }
  };

  const hasAnyCourseSubtitleCandidate = () => {
    const raw = Array.isArray(kgLastResult?.courseData?.sections) ? kgLastResult.courseData.sections : [];
    if (!raw.length) return false;
    if ((kgLastResult?.courseData?.captionedSections || 0) > 0) return true;
    return raw.some(s => s.hasSubtitle === true || (!s.subtitleChecked && s.hasSubtitle !== false));
  };

  const syncSectionPicker = () => {
    if (!kgModal) return;
    const list = getAllCourseSections();
    const focused = resolveFocusedSection();
    kgModal.secPicker.replaceChildren();
    for (const sec of list) {
      const noSubTag = sec.hasSubtitle === false ? ' [无字幕]' : '';
      const opt = element('option', `${sec.sectionIndex || ''}${sec.sectionIndex ? '. ' : ''}${sec.title || '课节'}${noSubTag}`, kgModal.secPicker);
      opt.value = String(sec.sectionId || 'current');
    }
    if (focused) {
      kgFocusSectionId = String(focused.sectionId || 'current');
      kgModal.secPicker.value = kgFocusSectionId;
    }
    kgModal.secPickerWrap.hidden = list.length === 0;
  };

  const syncSubtitleDiagnosticsView = () => {
    if (!kgModal) return;
    const logs = kgLastResult?.courseData?.subtitleDiagnostics || kgLastResult?.tree?.subtitleDiagnostics || [];
    const hasLogs = logs.length > 0;
    const failCount = logs.filter(item => !item.ok).length;
    const okCount = logs.length - failCount;
    kgModal.subDiagWrap.hidden = !hasLogs;
    kgModal.subDiagPre.textContent = hasLogs ? formatSubtitleDiagnosticsText(logs) : '';
    const estCourse = kgLastResult?.estimates?.course;
    const tokenHint = estCourse && estCourse.totalTokens > 0
      ? `~${estCourse.totalTokens >= 1000 ? `${(estCourse.totalTokens / 1000).toFixed(1)}k` : estCourse.totalTokens} tokens`
      : '0 tokens';
    kgModal.metaSummary.textContent = hasLogs
      ? (okCount === 0
        ? `ⓘ 估算与诊断 · ${tokenHint} · 字幕 ${logs.length} 路未命中`
        : `ⓘ 估算与诊断 · ${tokenHint} · 诊断 ${logs.length} 条`)
      : `ⓘ 预估 · ${tokenHint}`;
  };

  const syncSubtitleControls = () => {
    if (!kgModal) return;
    const focused = resolveFocusedSection();
    const focusedHasSub = sectionHasSubtitle(focused);
    const courseCanAnalyze = hasAnyCourseSubtitleCandidate();
    const noSubTip = '本课无字幕：该课节没有 AI 字幕，无法生成时间轴导览/问答/出题';
    const courseNoSubTip = '本课无字幕：整门课未检测到可用 AI 字幕';

    kgModal.secAiBtn.disabled = kgRunning || !focusedHasSub;
    kgModal.secAiBtn.title = !focusedHasSub ? noSubTip : '仅使用 AI 分析当前选中的课节';
    kgModal.quizAiBtn.disabled = kgRunning || kgQuizBusy || !focusedHasSub;
    kgModal.quizAiBtn.title = !focusedHasSub ? noSubTip : '依据当前课节字幕用 AI 出题';
    kgModal.courseAiBtn.disabled = kgRunning || !courseCanAnalyze;
    kgModal.courseAiBtn.title = !courseCanAnalyze ? courseNoSubTip : '按课节分段分析整门课（自动跳过无字幕课节）';
    const canRegen = kgLastScope === 'section' ? focusedHasSub : courseCanAnalyze;
    kgModal.regenBtn.disabled = kgRunning || !canRegen;
    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    kgModal.qaInput.disabled = kgQaBusy || !focusedHasSub;
    kgModal.qaSendBtn.disabled = kgQaBusy || !hasKey || !focusedHasSub;
  };

  const renderQaDock = () => {
    if (!kgModal) return;
    const focused = resolveFocusedSection();
    const focusedHasSub = sectionHasSubtitle(focused);
    const courseId = getCurrentCourseId();
    const sectionId = focused?.sectionId || 'current';
    const sectionTitle = focused?.title || '当前课节';
    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    const stored = loadSectionChat(win, courseId, sectionId, kgActiveChatSessionId);
    kgActiveChatSessionId = stored.activeSessionId;
    const messages = stored.messages || [];
    const sessions = stored.sessions || [];
    const curSession = stored.session || null;

    kgModal.qaTitle.textContent = `💬 问答 · 《${sectionTitle}》${focusedHasSub ? ` (${messages.length})` : ''}`;
    if (kgModal.qaSessionSelect) {
      kgModal.qaSessionSelect.replaceChildren();
      for (const s of sessions) {
        const prefix = s.kind === 'deepdive' ? '[深挖] ' : '';
        const opt = element('option', `${prefix}${s.title} (${s.messages?.length || 0})`, kgModal.qaSessionSelect);
        opt.value = s.id;
      }
      kgModal.qaSessionSelect.value = kgActiveChatSessionId;
      kgModal.qaSessionSelect.hidden = sessions.length <= 1 && curSession?.kind !== 'deepdive';
    }
    kgModal.qaToggleBtn.textContent = kgQaExpanded ? '收起 ▾' : `对话 (${messages.length}) ▴`;
    kgModal.qaClearBtn.hidden = messages.length === 0;
    kgModal.qaNoSub.hidden = focusedHasSub;
    if (!focusedHasSub) {
      kgModal.qaNoSub.textContent = '本课无字幕，暂不可提问';
    }
    kgModal.qaNoAi.hidden = !focusedHasSub || hasKey;
    kgModal.qaInput.placeholder = !focusedHasSub
      ? '本课无字幕，暂不可提问'
      : hasKey
        ? (curSession?.kind === 'deepdive'
          ? '独立错题深挖会话（确认预填内容后按回车或点发送）'
          : `针对《${sectionTitle}》提问（回车发送）`)
        : '需先配置 AI';
    kgModal.qaSendBtn.disabled = kgQaBusy || !hasKey || !focusedHasSub;
    kgModal.qaSendBtn.title = !focusedHasSub ? '本课无字幕，无法基于字幕提问' : '';
    kgModal.qaInput.disabled = kgQaBusy || !focusedHasSub;

    kgModal.qaThread.hidden = !kgQaExpanded;
    kgModal.qaThread.replaceChildren();
    if (kgQaExpanded) {
      const segIdx = getSectionSegmentIndex(sectionId);
      if (!messages.length) {
        const emptyHint = !focusedHasSub
          ? '本课无字幕，暂不可提问。'
          : hasKey
            ? (curSession?.kind === 'deepdive'
              ? `当前为全新独立错题深挖会话「${curSession.title}」（不会混入历史对话），确认下方预填提问后点击「发送」。`
              : '暂无对话，输入问题后 AI 将只引用本节字幕编号 [Sxx] 并支持原地展开核验。')
            : '需先配置 AI 后方可提问。';
        element('p', emptyHint, kgModal.qaThread).className = 'muted';
      } else {
        for (const msg of messages) {
          const bubble = element('div', '', kgModal.qaThread);
          bubble.className = 'kg-qa-msg';
          bubble.dataset.role = msg.role;
          if (msg.role === 'assistant') {
            const textDiv = element('div', '', bubble);
            renderTextWithCitations(textDiv, msg.content, sectionId, bubble, handleKgSeek, msg.citations || []);
            if (Array.isArray(msg.citations) && msg.citations.length) {
              const citeWrap = element('div', '', bubble); citeWrap.className = 'kg-qa-cites';
              for (const rawC of msg.citations) {
                const c = typeof rawC?.verified === 'boolean'
                  ? rawC
                  : verifyCitation(rawC, segIdx, { claimText: rawC?.note || '' });
                const chip = element('button', '', citeWrap);
                chip.type = 'button';
                chip.dataset.citeStatus = c.verified ? 'verified' : 'unverified';
                if (c.verified) {
                  const idLabel = c.segId ? `[${c.segId}]` : '';
                  chip.textContent = `依据 ${idLabel} ${c.timestamp}${c.note ? ` · ${c.note}` : ''}`.trim();
                  chip.className = 'kg-qa-cite';
                  if (c.segId) chip.dataset.segId = c.segId;
                  if (c.refKey) chip.dataset.refKey = c.refKey;
                  chip.dataset.seekSeconds = String(Math.floor(c.seconds || 0));
                  chip.title = '点击原地标黄并展开原字幕证据';
                } else {
                  chip.textContent = `⚠ 未核实 · ${shortUnverifiedTag(c.reasonCode)} (${c.rawRef || '?'})`;
                  chip.className = 'kg-qa-cite kg-cite-unverified';
                  if (c.reasonCode) chip.dataset.reasonCode = c.reasonCode;
                  chip.title = '该引用未通过原字幕查表校验，点击查看详情';
                }
                chip.addEventListener('click', ev => {
                  ev.stopPropagation();
                  toggleInlineEvidence({
                    hostEl: bubble,
                    triggerBtn: chip,
                    citation: c,
                    sectionId: c.sectionId || sectionId,
                    segIdx,
                    onSeek: handleKgSeek,
                  });
                });
              }
            }
            if (msg.contextMeta?.truncated) {
              element('div', `上下文：超长课节已按相关性精选 ${msg.contextMeta.selectedSegments}/${msg.contextMeta.totalSegments} 段字幕`, bubble).className = 'kg-qa-meta';
            }
          } else {
            bubble.textContent = msg.content;
          }
        }
        kgModal.qaThread.scrollTop = kgModal.qaThread.scrollHeight;
      }
    }
  };

  const handleQaSend = async () => {
    if (!kgModal || kgQaBusy) return;
    const focused = resolveFocusedSection();
    if (!focused) {
      setKgBanner('当前未识别到课节上下文，无法提问。', 'warn');
      return;
    }
    if (!sectionHasSubtitle(focused)) {
      setKgBanner(focused.subtitleReason || '本课无字幕：该课节没有 AI 字幕，因此无法基于字幕进行 AI 问答。', 'warn');
      renderQaDock();
      return;
    }
    const question = kgModal.qaInput.value.trim();
    if (!question) return;
    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    if (!hasKey) {
      setKgBanner('需先配置 AI：请先点击「AI 设置」填写 Provider、Base URL 与 API Key 后再向 AI 提问。', 'warn');
      renderQaDock();
      return;
    }
    kgQaBusy = true;
    kgQaExpanded = true;
    renderQaDock();
    setKgBanner(`正在结合《${focused.title}》带编号字幕向 AI 提问…`, 'info');
    try {
      kgQaAbort?.abort?.();
      kgQaAbort = typeof AbortController === 'function' ? new AbortController() : null;
      const deps = kg.getTransportDeps ? kg.getTransportDeps() : {};
      const res = await askSectionQuestion({
        win,
        courseTitle: kgLastResult?.tree?.courseTitle || '当前课程',
        courseId: getCurrentCourseId(),
        section: focused,
        question,
        sessionId: kgActiveChatSessionId,
        settings: kg.getSettings(),
        gmRequest: deps.gmRequest,
        fetchFn: deps.fetchFn,
        signal: kgQaAbort?.signal,
      });
      if (!kgModal) return;
      if (res.ok) {
        if (res.sessionId) kgActiveChatSessionId = res.sessionId;
        kgModal.qaInput.value = '';
        const unverifiedCount = (res.message?.citations || []).filter(c => c && !c.verified).length;
        setKgBanner(unverifiedCount > 0
          ? `已回答，检测到 ${unverifiedCount} 条未通过原字幕核验的引用（已标为「未核实」，点击可查看核验详情）。`
          : (res.contextMeta?.truncated
            ? `已回答（超长课节按相关性选取 ${res.contextMeta.selectedSegments}/${res.contextMeta.totalSegments} 段字幕，点击引用可先原地核对原字幕再决定跳播）。`
            : '已回答，点击引用编号可先原地标黄展开原字幕，再决定是否跳播并开声。'), unverifiedCount > 0 ? 'warn' : 'info');
      } else {
        setKgBanner(res.error || 'AI 提问失败。', 'warn');
      }
    } finally {
      kgQaBusy = false;
      renderQaDock();
    }
  };

  const startWrongQuestionDeepDive = (question, chosenIndex, focusedSection) => {
    if (!kgModal || !question) return;
    const courseId = getCurrentCourseId();
    const sectionId = focusedSection?.sectionId || 'current';
    const segIdx = getSectionSegmentIndex(sectionId);
    const shortLabel = String(question.question || '').slice(0, 16);
    const created = createSectionChatSession(win, courseId, sectionId, {
      kind: 'deepdive',
      title: `深挖：${shortLabel}`,
      quizQuestionId: question.id || null,
    });
    kgActiveChatSessionId = created.sessionId;
    const prefill = buildWrongQuestionDeepDivePrompt({
      question,
      chosenIndex,
      section: focusedSection,
      segmentIndex: segIdx,
    });
    kgQaExpanded = true;
    renderQaDock();
    kgModal.qaInput.value = prefill;
    try { kgModal.qaInput.focus(); } catch { /* ignore */ }
    setKgBanner('已创建独立错题深挖会话（不复用旧对话）并预填题干、选项、正确答案、解析与原字幕依据，确认后按回车或点击「发送」开始深挖。', 'info');
  };

  const renderQuizPane = () => {
    if (!kgModal) return;
    const container = kgModal.quizPane;
    container.replaceChildren();
    const focused = resolveFocusedSection();
    const focusedHasSub = sectionHasSubtitle(focused);
    const courseId = getCurrentCourseId();
    const sectionId = focused?.sectionId || 'current';
    const sectionTitle = focused?.title || '当前课节';
    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    const stored = loadSectionQuiz(win, courseId, sectionId);

    const headCard = element('div', '', container); headCard.className = 'kg-card';
    const headRow = element('div', '', headCard); headRow.className = 'kg-card-head';
    element('h3', `课节出题自测 · 《${sectionTitle}》`, headRow);
    const actions = element('div', '', headRow); actions.className = 'diag-actions';
    const genBtn = element('button', stored ? '重新出题' : '用 AI 出题', actions);
    genBtn.type = 'button'; genBtn.className = stored ? 'ghost' : 'primary';
    genBtn.dataset.action = stored ? 'kg-quiz-regenerate' : 'kg-quiz-generate';
    genBtn.disabled = kgQuizBusy || !focusedHasSub;
    if (!focusedHasSub) genBtn.title = '本课无字幕，无法基于字幕出题';
    genBtn.addEventListener('click', () => runSectionQuiz({ forceRefresh: Boolean(stored) }));

    if (!focusedHasSub) {
      const noSubBox = element('div', '', headCard); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgQuizNosub = '';
      element('strong', '本课无字幕', noSubBox);
      const detailReason = String(focused?.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
      element('div', detailReason, noSubBox);
      if (!stored) return;
    }

    if (stored) {
      const tm = formatCacheClock(stored.cachedAt);
      const badge = element('span', `本地缓存试题${tm ? ` · ${tm}` : ''}（0 token）`, headCard);
      badge.className = 'kg-badge'; badge.dataset.tone = 'cache'; badge.dataset.kgQuizCache = '';
    }

    if (!hasKey && !stored) {
      const noAi = element('div', '', headCard); noAi.className = 'kg-qa-noai'; noAi.dataset.kgQuizNoai = '';
      element('span', '需先配置 AI 才可出题', noAi);
      const goCfg = element('button', '去设置', noAi); goCfg.type = 'button'; goCfg.className = 'kg-mini-btn primary';
      goCfg.addEventListener('click', openAiSettingsFromModal);
      return;
    }

    if (!stored) {
      element('p', '点击右上角「用 AI 出题」，依据本节字幕生成 3–5 道自测题并缓存。', headCard).className = 'muted';
      return;
    }

    const attempt = stored.attempt || { answers: {}, submitted: false };
    const answers = { ...(attempt.answers || {}) };
    const persistAttempt = nextAttempt => {
      stored.attempt = nextAttempt;
      saveSectionQuiz(win, courseId, sectionId, stored);
    };

    if (attempt.submitted) {
      const graded = gradeSectionQuiz(stored.questions, answers);
      const scoreBar = element('div', '', container); scoreBar.className = 'kg-score-bar'; scoreBar.dataset.kgQuizScore = '';
      const scoreText = graded.choiceTotal > 0
        ? `选择题得分：${graded.choiceCorrect} / ${graded.choiceTotal}（${graded.percent}%）${graded.shortTotal ? ` · 含 ${graded.shortTotal} 道简答题（供对照自评，不自动判分）` : ''}`
        : `共 ${graded.shortTotal} 道简答题（供对照自评，不做自动判分）`;
      element('span', scoreText, scoreBar);
      const resetAns = element('button', '重做本题组', scoreBar); resetAns.type = 'button'; resetAns.className = 'kg-mini-btn ghost';
      resetAns.addEventListener('click', () => {
        persistAttempt({ answers: {}, submitted: false, submittedAt: null });
        renderQuizPane();
      });
    }

    const gradedMap = attempt.submitted ? gradeSectionQuiz(stored.questions, answers).details : {};
    stored.questions.forEach((q, idx) => {
      const qCard = element('div', '', container); qCard.className = 'kg-card'; qCard.dataset.kgQuizItem = q.id;
      const qHead = element('div', '', qCard); qHead.className = 'kg-card-head';
      const typeLabel = q.type === 'choice' ? '选择题' : '简答题';
      element('h3', `${idx + 1}. [${typeLabel}] ${q.question}`, qHead);
      createCitationBtn(qHead, { item: q, sectionId, hostEl: qCard, onSeek: handleKgSeek });

      if (q.type === 'choice') {
        const optList = element('div', '', qCard); optList.className = 'kg-opt-list';
        const gInfo = gradedMap[q.id];
        q.options.forEach((optText, optIdx) => {
          const label = element('label', '', optList); label.className = 'kg-opt-row';
          const radio = element('input', '', label);
          radio.type = 'radio'; radio.name = `wd-quiz-${sectionId}-${q.id}`; radio.value = String(optIdx);
          radio.checked = answers[q.id] === optIdx;
          radio.disabled = Boolean(attempt.submitted);
          radio.addEventListener('change', () => {
            answers[q.id] = optIdx;
            persistAttempt({ ...attempt, answers });
          });
          element('span', optText, label);
          if (gInfo) {
            if (optIdx === q.correctIndex) label.dataset.grade = 'correct';
            else if (optIdx === gInfo.chosen && !gInfo.correct) label.dataset.grade = 'wrong';
          }
        });
        if (gInfo) {
          const fbRow = element('div', '', qCard); fbRow.className = 'kg-wrong-bar';
          const fb = element('p', gInfo.correct ? '✅ 回答正确' : `❌ 回答有误（正确答案：${q.answerLetter}）`, fbRow);
          fb.className = gInfo.correct ? 'muted' : 'status';
          if (!gInfo.correct) {
            const deepBtn = element('button', '🔍 深挖这道题', fbRow);
            deepBtn.type = 'button';
            deepBtn.className = 'kg-mini-btn soft';
            deepBtn.dataset.action = 'kg-quiz-deepdive';
            deepBtn.dataset.questionId = q.id;
            deepBtn.title = '新建独立深挖会话并预填本题题干、选项、解析与原字幕依据';
            deepBtn.addEventListener('click', () => startWrongQuestionDeepDive(q, gInfo.chosen, focused));
          }
        }
      } else {
        const shortInput = element('input', '', qCard);
        shortInput.type = 'text'; shortInput.className = 'kg-short-input';
        shortInput.name = `wd-short-${q.id}`;
        shortInput.placeholder = '在此记录你的简答思路（自动保存，提交后对照参考答案自评）';
        shortInput.value = String(answers[q.id] ?? '');
        shortInput.addEventListener('input', () => {
          answers[q.id] = shortInput.value;
          persistAttempt({ ...attempt, answers });
        });
        element('small', '简答题不做自动判分，展开下方参考答案与解析自行核对。', qCard).className = 'muted';
      }

      const expFold = element('details', '', qCard); expFold.className = 'kg-explain-fold'; expFold.open = Boolean(attempt.submitted);
      element('summary', q.type === 'choice' ? '查看答案与解析' : '查看参考答案与解析', expFold);
      const expBody = element('div', '', expFold); expBody.className = 'kg-explain-body';
      if (q.type === 'choice') {
        element('div', `正确答案：${q.options[q.correctIndex] || q.answerLetter}`, expBody);
      } else {
        element('div', `参考答案：${q.referenceAnswer}`, expBody);
      }
      if (q.explanation) {
        const expText = element('div', '', expBody);
        renderTextWithCitations(expText, `解析：${q.explanation}`, sectionId, expBody, handleKgSeek, q.citation ? [q.citation] : []);
      }
      if (q.citation || (Number.isFinite(q.seconds) && q.seconds >= 0)) {
        const jumpRow = element('div', '', expBody); jumpRow.className = 'row';
        const isVerified = q.citation ? q.citation.verified : true;
        element('small', isVerified ? `原字幕依据：${q.segId ? `[${q.segId}] ` : ''}${Number.isFinite(q.seconds) ? `约第 ${Math.floor(q.seconds / 60) + 1} 分钟` : ''}` : '原字幕依据：未通过核验', jumpRow).className = 'muted';
        createCitationBtn(jumpRow, { item: q, sectionId, hostEl: expBody, onSeek: handleKgSeek });
      }
    });

    if (!attempt.submitted) {
      const footer = element('div', '', container); footer.className = 'buttons';
      const submitBtn = element('button', '提交作答并判分', footer);
      submitBtn.type = 'button'; submitBtn.className = 'primary'; submitBtn.dataset.action = 'kg-quiz-submit';
      submitBtn.addEventListener('click', () => {
        const res = submitSectionQuizAttempt(win, courseId, sectionId, stored, answers);
        stored.attempt = res.attempt;
        renderQuizPane();
      });
    }
  };

  const runSectionQuiz = async ({ forceRefresh = false } = {}) => {
    if (!kgModal || kgQuizBusy) return;
    const focused = resolveFocusedSection();
    if (!focused) { setKgBanner('当前未识别到课节，无法出题。', 'warn'); return; }
    if (!sectionHasSubtitle(focused)) {
      switchKgTab('quiz');
      setKgBanner(focused.subtitleReason || '本课无字幕：该课节没有 AI 字幕，因此无法基于字幕出题。', 'warn');
      return;
    }
    switchKgTab('quiz');
    kgQuizBusy = true;
    renderQuizPane();
    setKgBanner(forceRefresh ? `正在为《${focused.title}》重新生成题目…` : `正在加载或生成《${focused.title}》自测题…`, 'info');
    try {
      kgQuizAbort?.abort?.();
      kgQuizAbort = typeof AbortController === 'function' ? new AbortController() : null;
      const deps = kg.getTransportDeps ? kg.getTransportDeps() : {};
      const res = await generateSectionQuiz({
        win,
        courseTitle: kgLastResult?.tree?.courseTitle || '当前课程',
        courseId: getCurrentCourseId(),
        section: focused,
        settings: kg.getSettings(),
        forceRefresh,
        gmRequest: deps.gmRequest,
        fetchFn: deps.fetchFn,
        signal: kgQuizAbort?.signal,
      });
      if (!kgModal) return;
      if (res.ok) {
        setKgBanner(res.fromCache
          ? `已加载《${focused.title}》本地缓存试题（0 token）；可继续作答或点「重新出题」。`
          : `已为《${focused.title}》生成 ${res.quiz.questions.length} 道自测题并缓存到本地。`, 'info');
      } else {
        setKgBanner(res.error || 'AI 出题失败。', 'warn');
      }
    } finally {
      kgQuizBusy = false;
      renderQuizPane();
    }
  };

  const openKnowledgeModal = async ({ targetSectionId = null, scope = null, initialTab = 'quick' } = {}) => {
    if (!kgModal) {
      const backdrop = element('div', '', root); backdrop.className = 'kg-backdrop'; backdrop.dataset.knowledgeModal = '';
      const dialog = element('div', '', backdrop); dialog.className = 'kg-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', '课程知识点导览与导图');
      const head = element('div', '', dialog); head.className = 'kg-head';
      const headTop = element('div', '', head); headTop.className = 'kg-head-top';
      const titleWrap = element('div', '', headTop); titleWrap.className = 'kg-title-wrap';
      const kgTitle = element('h2', 'AI 导览', titleWrap); kgTitle.dataset.kgTitle = '';
      const kgBadge = element('span', '本地摘要（未使用 AI）', titleWrap); kgBadge.className = 'kg-badge'; kgBadge.dataset.tone = 'local'; kgBadge.dataset.kgMode = '';
      const kgScopeBadge = element('span', '', titleWrap); kgScopeBadge.className = 'kg-badge'; kgScopeBadge.dataset.tone = 'scope'; kgScopeBadge.dataset.kgScope = ''; kgScopeBadge.hidden = true;
      const kgCacheBadge = element('span', '', titleWrap); kgCacheBadge.className = 'kg-badge'; kgCacheBadge.dataset.tone = 'cache'; kgCacheBadge.dataset.kgCache = ''; kgCacheBadge.hidden = true;
      const headControls = element('div', '', headTop); headControls.className = 'kg-head-controls';
      const cfgBtn = button('kg-open-settings', '⚙ 设置', headControls, openAiSettingsFromModal, false); cfgBtn.className = 'ghost kg-mini-btn'; cfgBtn.title = 'AI 设置';
      const closeBtn = button('kg-close', '✕', headControls, () => closeKnowledgeModal(), false); closeBtn.className = 'ghost kg-mini-btn'; closeBtn.setAttribute('aria-label', '关闭');

      const headRow2 = element('div', '', head); headRow2.className = 'kg-head-row2';
      const secPickerWrap = element('div', '', headRow2); secPickerWrap.className = 'kg-sec-picker-wrap'; secPickerWrap.hidden = true;
      const secPicker = element('select', '', secPickerWrap); secPicker.className = 'kg-sec-picker'; secPicker.dataset.kgSectionPicker = ''; secPicker.setAttribute('aria-label', '选择当前查看与问答的课节');
      secPicker.addEventListener('change', async () => {
        kgFocusSectionId = secPicker.value || null;
        kgActiveChatSessionId = null;
        await runKnowledge({ scope: 'section', sectionId: kgFocusSectionId, useAi: false, preferCacheOnOpen: true });
      });
      const triggerRow = element('div', '', headRow2); triggerRow.className = 'diag-actions';
      const secAiBtn = button('kg-ai-section', 'AI 解读本节', triggerRow, () => runKnowledge({ scope: 'section', sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }), false); secAiBtn.className = 'primary';
      const courseAiBtn = button('kg-ai-course', 'AI 解读全课', triggerRow, () => runKnowledge({ scope: 'course', sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }), false);
      const quizAiBtn = button('kg-ai-quiz', '出题', triggerRow, () => runSectionQuiz({ forceRefresh: false }), false);
      const zeroBtn = button('kg-zero-ai', '本地摘要', triggerRow, () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: false, forceRefresh: false }), false); zeroBtn.className = 'ghost'; zeroBtn.title = '切换为本地字幕规则摘要（不消耗 AI token）';
      const regenBtn = button('kg-regenerate', '重生成', triggerRow, () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: true, forceRefresh: true }), false); regenBtn.className = 'ghost'; regenBtn.hidden = true;
      const abortBtn = button('kg-abort', '停止', triggerRow, () => { kg.abort(); kgQaAbort?.abort?.(); kgQuizAbort?.abort?.(); }, false); abortBtn.className = 'danger'; abortBtn.hidden = true;

      const metaFold = element('details', '', dialog); metaFold.className = 'kg-meta-fold'; metaFold.dataset.kgMetaFold = ''; metaFold.open = false;
      const metaSummary = element('summary', 'ⓘ 估算与诊断', metaFold); metaSummary.dataset.kgMetaSummary = '';
      const metaBody = element('div', '', metaFold); metaBody.className = 'kg-meta-body';
      const estimateBar = element('div', '', metaBody); estimateBar.className = 'kg-estimate'; estimateBar.dataset.kgEstimate = '';
      const subDiagWrap = element('div', '', metaBody); subDiagWrap.dataset.kgSubDiag = ''; subDiagWrap.hidden = true;
      const subDiagHead = element('div', '', subDiagWrap); subDiagHead.className = 'kg-diag-head';
      element('small', '字幕诊断（captionVtt → Video.js → 课程接口）', subDiagHead).className = 'muted';
      const copySubDiagBtn = button('kg-copy-sub-diag', '复制诊断', subDiagHead, async () => {
        const text = subDiagPre.textContent;
        if (!text) return;
        if (win.navigator?.clipboard?.writeText) {
          await win.navigator.clipboard.writeText(text);
          setKgBanner('已复制诊断日志', 'info');
        }
      }, false); copySubDiagBtn.className = 'kg-mini-btn ghost';
      const subDiagPre = element('pre', '', subDiagWrap); subDiagPre.className = 'kg-diag-pre'; subDiagPre.dataset.kgSubDiagLog = '';

      const banner = element('div', '', dialog); banner.className = 'kg-banner'; banner.dataset.kgBanner = ''; banner.hidden = true;
      const toolbar = element('div', '', dialog); toolbar.className = 'kg-toolbar';
      const tabs = element('div', '', toolbar); tabs.className = 'kg-tabs';
      const tabButtons = {};
      for (const [id, label] of [['quick', '速览'], ['detail', '细读'], ['quiz', '自测'], ['map', '导图'], ['md', 'MD']]) {
        const tb = button(`kg-tab-${id}`, label, tabs, () => switchKgTab(id), false);
        tb.setAttribute('aria-selected', String(id === kgActiveTab));
        tabButtons[id] = tb;
      }
      const toolRight = element('div', '', toolbar); toolRight.className = 'diag-actions';
      const fitBtn = button('kg-fit', '适应', toolRight, () => kgMapHandle?.fit?.(), false); fitBtn.className = 'ghost';
      const copyMdBtn = button('kg-copy-md', '复制', toolRight, async () => {
        const fullMd = kgLastResult?.tree ? buildKnowledgeMarkdown(kgLastResult.tree, { includeExtras: true }) : kgLastResult?.markdown;
        if (!fullMd) return;
        if (win.navigator?.clipboard?.writeText) {
          await win.navigator.clipboard.writeText(fullMd);
          setKgBanner('已复制 Markdown', 'info');
        } else {
          setKgBanner('请切至 MD 标签手动复制', 'info');
        }
      }, false); copyMdBtn.className = 'ghost';
      const dlMdBtn = button('kg-download-md', '导出', toolRight, () => {
        const fullMd = kgLastResult?.tree ? buildKnowledgeMarkdown(kgLastResult.tree, { includeExtras: true }) : kgLastResult?.markdown;
        if (!fullMd || typeof win.Blob !== 'function' || typeof win.URL?.createObjectURL !== 'function') return;
        const blob = new win.Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
        const url = win.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = String(kgLastResult.tree?.courseTitle || '课程导览').replace(/[\\/:*?"<>|\x00-\x1f]+/gu, '_').slice(0, 60);
        a.href = url; a.download = `${safeName}-知识点导览.md`; a.click();
        win.URL.revokeObjectURL(url);
      }, false); dlMdBtn.className = 'ghost';
      const kgBody = element('div', '', dialog); kgBody.className = 'kg-body';
      const quickPane = element('div', '', kgBody); quickPane.className = 'kg-scroll'; quickPane.dataset.kgPane = 'quick';
      const detailPane = element('div', '', kgBody); detailPane.className = 'kg-scroll'; detailPane.dataset.kgPane = 'detail'; detailPane.hidden = true;
      const quizPane = element('div', '', kgBody); quizPane.className = 'kg-scroll'; quizPane.dataset.kgPane = 'quiz'; quizPane.hidden = true;
      const mapPane = element('div', '', kgBody); mapPane.className = 'kg-pane'; mapPane.dataset.kgPane = 'map'; mapPane.hidden = true;
      const svgWrap = element('div', '', mapPane); svgWrap.className = 'kg-svg-wrap';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.dataset.kgSvg = ''; svgWrap.append(svg);
      const engineFoot = element('div', '导图加载中…', mapPane); engineFoot.className = 'kg-engine-foot'; engineFoot.dataset.kgEngine = '';
      const mdPane = element('div', '', kgBody); mdPane.className = 'kg-md-pane'; mdPane.dataset.kgPane = 'md'; mdPane.hidden = true;
      const mdPre = element('pre', '', mdPane); mdPre.dataset.kgMd = '';

      // Persistent bottom section-level AI Q&A dock
      const qaDock = element('div', '', dialog); qaDock.className = 'kg-qa-dock'; qaDock.dataset.kgQaDock = '';
      const qaBar = element('div', '', qaDock); qaBar.className = 'kg-qa-bar';
      const qaTitleWrap = element('div', '', qaBar); qaTitleWrap.className = 'kg-qa-session-wrap';
      const qaTitle = element('strong', '💬 问答', qaTitleWrap); qaTitle.dataset.kgQaTitle = '';
      const qaSessionSelect = element('select', '', qaTitleWrap); qaSessionSelect.className = 'kg-qa-session-select'; qaSessionSelect.dataset.kgQaSession = ''; qaSessionSelect.setAttribute('aria-label', '选择问答会话'); qaSessionSelect.hidden = true;
      qaSessionSelect.addEventListener('change', () => {
        const sec = resolveFocusedSection();
        kgActiveChatSessionId = qaSessionSelect.value || null;
        switchSectionChatSession(win, getCurrentCourseId(), sec?.sectionId || 'current', kgActiveChatSessionId);
        renderQaDock();
      });
      const qaBarActions = element('div', '', qaBar); qaBarActions.className = 'diag-actions';
      const qaNewSessionBtn = button('kg-qa-new-session', '+ 新会话', qaBarActions, () => {
        const sec = resolveFocusedSection();
        const created = createSectionChatSession(win, getCurrentCourseId(), sec?.sectionId || 'current', { kind: 'general' });
        kgActiveChatSessionId = created.sessionId;
        kgQaExpanded = true;
        renderQaDock();
      }, false); qaNewSessionBtn.className = 'ghost';
      const qaToggleBtn = button('kg-qa-toggle', '对话 ▴', qaBarActions, () => { kgQaExpanded = !kgQaExpanded; renderQaDock(); }, false); qaToggleBtn.className = 'ghost';
      const qaClearBtn = button('kg-qa-clear', '清空', qaBarActions, () => {
        const sec = resolveFocusedSection();
        clearSectionChat(win, getCurrentCourseId(), sec?.sectionId || 'current', kgActiveChatSessionId);
        renderQaDock();
      }, false); qaClearBtn.className = 'ghost'; qaClearBtn.hidden = true;
      const qaNoSub = element('div', '', qaDock); qaNoSub.className = 'kg-qa-nosub'; qaNoSub.dataset.kgQaNosub = ''; qaNoSub.hidden = true;
      const qaNoAi = element('div', '', qaDock); qaNoAi.className = 'kg-qa-noai'; qaNoAi.dataset.kgQaNoai = ''; qaNoAi.hidden = true;
      element('span', '需先配置 AI 才可提问', qaNoAi);
      const qaGoCfg = button('kg-qa-go-settings', '去设置', qaNoAi, openAiSettingsFromModal, false); qaGoCfg.className = 'kg-mini-btn primary';
      const qaThread = element('div', '', qaDock); qaThread.className = 'kg-qa-thread'; qaThread.dataset.kgQaThread = ''; qaThread.hidden = true;
      const qaInputRow = element('div', '', qaDock); qaInputRow.className = 'kg-qa-input-row';
      const qaInput = element('input', '', qaInputRow); qaInput.type = 'text'; qaInput.name = 'kg-qa-input'; qaInput.dataset.kgQaInput = ''; qaInput.setAttribute('aria-label', '向 AI 提问');
      qaInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); void handleQaSend(); } });
      const qaSendBtn = button('kg-qa-send', '发送', qaInputRow, () => handleQaSend(), false); qaSendBtn.className = 'primary';

      kgModal = { backdrop, kgTitle, kgBadge, kgScopeBadge, kgCacheBadge, zeroBtn, secAiBtn, courseAiBtn, quizAiBtn, regenBtn, abortBtn, secPickerWrap, secPicker, metaFold, metaSummary, estimateBar, banner, subDiagWrap, subDiagPre, tabButtons, fitBtn, quickPane, detailPane, quizPane, mapPane, svg, engineFoot, mdPane, mdPre, qaDock, qaTitle, qaSessionSelect, qaNewSessionBtn, qaToggleBtn, qaClearBtn, qaNoSub, qaNoAi, qaThread, qaInput, qaSendBtn };
    }
    kgFocusSectionId = targetSectionId || null;
    kgActiveChatSessionId = null;
    kgActiveTab = initialTab || 'quick';
    const openScope = scope || (targetSectionId ? 'section' : 'course');
    await runKnowledge({ scope: openScope, sectionId: targetSectionId, useAi: false, preferCacheOnOpen: true });
  };
  const setKgBanner = (text, tone = 'warn') => {
    if (!kgModal) return;
    kgModal.banner.textContent = text || '';
    kgModal.banner.dataset.tone = tone;
    kgModal.banner.hidden = !text;
  };
  const switchKgTab = id => {
    kgActiveTab = id;
    if (!kgModal) return;
    for (const [k, btn] of Object.entries(kgModal.tabButtons)) btn.setAttribute('aria-selected', String(k === id));
    kgModal.quickPane.hidden = id !== 'quick';
    kgModal.detailPane.hidden = id !== 'detail';
    kgModal.quizPane.hidden = id !== 'quiz';
    kgModal.mapPane.hidden = id !== 'map';
    kgModal.mdPane.hidden = id !== 'md';
    kgModal.fitBtn.hidden = id !== 'map';
    if (id === 'quiz') renderQuizPane();
    if (id === 'map') void ensureKgMapRendered();
  };
  const handleKgSeek = targetSeek => {
    const res = kg.seek(targetSeek);
    setKgBanner(res.message, res.ok && !res.degraded ? 'info' : 'warn');
  };
  const setKgBusy = active => {
    kgRunning = active;
    if (!kgModal) return;
    kgModal.zeroBtn.disabled = active;
    kgModal.secAiBtn.disabled = active;
    kgModal.courseAiBtn.disabled = active;
    kgModal.quizAiBtn.disabled = active;
    kgModal.regenBtn.disabled = active;
    kgModal.abortBtn.hidden = !active;
    if (!active) syncSubtitleControls();
  };
  const formatCacheClock = ts => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
  };
  const runKnowledge = async ({ scope, sectionId = null, useAi, forceRefresh = false, preferCacheOnOpen = false }) => {
    if (!kgModal || kgRunning) return;
    setKgBusy(true);
    setKgBanner(useAi ? (forceRefresh ? '正在重新请求 AI 生成结构化学习卡片…' : '正在读取课程字幕并生成 AI 学习卡片…') : '正在读取课程字幕并加载速览…', 'info');
    try {
      const result = await kg.analyze({
        scope,
        sectionId,
        useAi,
        forceRefresh,
        preferCacheOnOpen,
        onProgress: p => {
          if (!kgModal) return;
          if (p.stage === 'section') setKgBanner(`AI 分段分析进度：${p.done + 1}/${p.total} · ${p.title || ''}`, 'info');
          else if (p.stage === 'section-aggregate') setKgBanner(p.title || '正在收敛长课节要点…', 'info');
          else if (p.stage === 'aggregate') setKgBanner(p.title || '正在聚合整门课知识地图与总览…', 'info');
        },
      });
      if (!kgModal) return;
      kgLastResult = result;
      kgLastScope = result.tree?.scope || scope;
      kgLastUsedAi = Boolean(result.usedAi);
      if (sectionId) kgFocusSectionId = String(sectionId);
      else if (!kgFocusSectionId && result.tree?.activeSectionId) kgFocusSectionId = String(result.tree.activeSectionId);

      kgModal.kgTitle.textContent = result.tree?.courseTitle || '课程知识点导览';
      const isViewNoSubtitle = Boolean(result.noSubtitle || result.tree?.noSubtitle);
      if (isViewNoSubtitle) {
        kgModal.kgBadge.textContent = '本课无字幕';
        kgModal.kgBadge.dataset.tone = 'nosub';
      } else if (result.usedAi && !result.fallback) {
        kgModal.kgBadge.textContent = 'AI 生成';
        kgModal.kgBadge.dataset.tone = 'ai';
      } else if (result.fallback) {
        kgModal.kgBadge.textContent = result.usedAi ? 'AI 生成 · 局部降级本地摘要' : '本地摘要 · AI 失败已回退';
        kgModal.kgBadge.dataset.tone = 'fallback';
      } else {
        kgModal.kgBadge.textContent = '本地摘要（未使用 AI）';
        kgModal.kgBadge.dataset.tone = 'local';
      }
      const scopeText = result.tree?.scopeLabel || '';
      kgModal.kgScopeBadge.textContent = scopeText ? `范围：${scopeText}` : '';
      kgModal.kgScopeBadge.hidden = !scopeText;
      if (result.fromCache) {
        const tm = formatCacheClock(result.cachedAt);
        kgModal.kgCacheBadge.textContent = `本地缓存${tm ? ` · ${tm}` : ''}（0 token）`;
        kgModal.kgCacheBadge.hidden = false;
      } else {
        kgModal.kgCacheBadge.hidden = true;
      }
      kgModal.regenBtn.hidden = !(result.fromCache || result.usedAi);

      kgModal.estimateBar.replaceChildren();
      if (result.estimates?.section) element('div', `当前课节预估：${result.estimates.section.summaryText}`, kgModal.estimateBar);
      if (result.estimates?.course) element('div', `整门课程预估：${result.estimates.course.summaryText}`, kgModal.estimateBar);
      const notices = [];
      if (result.fromCache) notices.push('已秒开本地缓存结果，未消耗 token；如需刷新请点「重新生成」。');
      if (isViewNoSubtitle) {
        notices.push('本课无字幕 · 已禁用 AI 分析、问答与出题');
      } else if (result.tree?.fallbackReason) {
        notices.push(result.tree.fallbackReason);
      }
      if (result.tree?.skippedSummary && !notices.includes(result.tree.skippedSummary)) notices.push(result.tree.skippedSummary);
      if (result.tree?.warnings?.length) {
        for (const w of result.tree.warnings.slice(0, 2)) {
          if (!notices.includes(w)) notices.push(w);
        }
      }
      setKgBanner(notices.join('\n'), (result.fallback || isViewNoSubtitle) ? 'warn' : 'info');

      // Sync confirmed subtitle availability back to section-list "AI 导览" gate
      const statusMap = {};
      for (const sec of (result.courseData?.sections || [])) {
        if (sec.sectionId && (sec.subtitleChecked || sec.hasSubtitle === false)) {
          statusMap[sec.sectionId] = { hasSubtitle: Boolean(sec.hasSubtitle), status: sec.subtitleStatus, reason: sec.subtitleReason };
        }
      }
      sectionGuideEntries.setSubtitleStatuses(statusMap, result.courseData?.courseId || null);

      syncSectionPicker();
      syncSubtitleDiagnosticsView();
      kgModal.mdPre.textContent = result.tree ? buildKnowledgeMarkdown(result.tree, { includeExtras: true }) : (result.markdown || '');
      const renderMeta = {
        usedAi: Boolean(result.usedAi),
        fallback: Boolean(result.fallback),
        noSubtitle: isViewNoSubtitle,
        failedSections: result.failedSections || result.tree?.failedSections || [],
      };
      renderKnowledgeQuick(kgModal.quickPane, result.tree, handleKgSeek, switchKgTab, renderMeta);
      renderKnowledgeDetail(kgModal.detailPane, result.tree, handleKgSeek, renderMeta);
      renderQuizPane();
      renderQaDock();
      switchKgTab(kgActiveTab);
      setKgBusy(false);
      void ensureKgMapRendered();
    } catch (err) {
      setKgBanner(`导览生成异常：${err?.message || err}`, 'warn');
    } finally {
      setKgBusy(false);
    }
  };
  const taskNodes = new Map(); let candidateSignature = ''; let draftSubjectId = null;
  const setOpen = open => { body.hidden = !open; toggle.textContent = open ? '收起' : '展开'; toggle.setAttribute('aria-expanded', String(open)); render(controller.getState()); };
  const eligible = task => task.courses.filter(course => course.selected && (task.scope === 'all' || course.required));
  const isDone = (task, id) => Boolean(task?.done.includes(id) && !task.recheck?.includes(id));
  const counts = task => { const selected = eligible(task); return { selected: selected.length, done: selected.filter(course => isDone(task, course.id)).length, skipped: selected.filter(course => task.skipped.includes(course.id)).length, deferred: task.deferred?.length || 0 }; };
  const completeTask = isTaskComplete;
  const currentTask = (task, state = latest) => {
    if (!task?.subject || task.id !== state.activeTaskId || completeTask(task) || ['complete', 'preparing'].includes(state.status)) return false;
    const selected = eligible(task);
    return Boolean(selected.length && (state.currentCourseId ? selected.some(course => course.id === state.currentCourseId && (state.status === 'running' || !isDone(task, course.id)) && !task.skipped.includes(course.id) && !task.deferred?.some(entry => entry.courseId === course.id)) : ['running', 'waiting'].includes(state.status) || state.phase === 'resuming'));
  };
  const sortableTasks = () => latest.tasks.filter(task => !completeTask(task));
  const phaseLabels = { paused: '已暂停', preparing: '正在准备', running: '学习中', complete: '已完成', retrying: '正在重试', waiting: '等待学习时段', offline: '等待网络', resuming: '正在恢复', confirming: '等待平台确认' };
  const phaseLabel = state => phaseLabels[state.phase || state.status] || '等待确认';
  const playbackFor = (item, courseId) => {
    const value = latest.currentPlayback;
    return currentTask(item) && latest.status === 'running' && !['retrying', 'offline', 'resuming'].includes(latest.phase) && value?.taskId === item.id && value.courseId === courseId ? value : null;
  };
  const executionLabel = (item, courseId = latest.currentCourseId) => {
    if (latest.status !== 'running' || ['retrying', 'offline', 'resuming'].includes(latest.phase)) return latest.status === 'paused' ? '当前' : phaseLabel(latest);
    if (isDone(item, courseId)) return '正在切换课程';
    const playback = playbackFor(item, courseId);
    if (playback) return playback.ended ? '等待平台确认完成' : playback.paused ? '正在准备播放' : '正在播放';
    return latest.currentSectionTitle ? '学习中' : '正在进入课程';
  };
  const clock = value => { const seconds = Math.floor(value); const minutes = Math.floor(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  const playbackText = value => Number.isFinite(value?.currentTime) && Number.isFinite(value?.duration) && value.currentTime >= 0 && value.duration > 0 ? `${clock(Math.min(value.currentTime, value.duration))} / ${clock(value.duration)}` : '';
  const quietMessages = new Set([
    '已暂停', '已完成', '执行中', '学习中',
    '已暂停，确认配置和课程后点击开始。', '已暂停，继续学习需手动点击开始。',
    '正在按平台课节状态连续学习。', '等待平台确认当前课节完成。',
    '所选课程已全部完成。', '已进入学习时段，正在继续队列。', '正在重新进入课程。',
    '已读取待添加清单，请核对课程勾选后添加。',
    '请点击确认要学习的专题。', '请点击确认要学习的专区。',
    '有待学课程，请手动点击开始继续。',
  ]);
  const saveWindow = async () => {
    const next = { start: fields.start.value.trim(), end: fields.end.value.trim() };
    if (JSON.stringify(next) !== JSON.stringify(controller.getState().window) && !await controller.setWindow(next)) return false;
    dirty.clear(); return true;
  };
  const hasRunHistory = state => Boolean(state.currentCourseId) || state.tasks.some(item => item.current || item.done.length || item.skipped.length || item.deferred?.length);
  const startQueue = async () => {
    if (starting) return;
    starting = true; render(controller.getState());
    const continuing = hasRunHistory(controller.getState());
    try {
      if (await saveWindow()) {
        if (continuing) await controller.start(null, 'panel-continue');
        else await controller.start();
      }
    }
    finally { starting = false; render(controller.getState()); }
  };
  const canSort = () => !reordering && !starting && !latest.unavailable && latest.status !== 'preparing' && latest.phase !== 'resuming';
  const moveDisplayedTask = async (id, index) => {
    if (!canSort()) return;
    reordering = true; render(controller.getState());
    try { if (!await controller.moveTask(id, index)) showUiError('顺序未保存，请查看当前提示后重试。'); }
    finally { reordering = false; render(controller.getState()); }
  };
  const movePriority = (id, offset) => {
    const ordered = sortableTasks(); const index = ordered.findIndex(task => task.id === id); const neighbor = ordered[index + offset];
    if (index < 0 || !neighbor) return;
    return moveDisplayedTask(id, latest.tasks.findIndex(task => task.id === neighbor.id));
  };
  const clearDrag = () => {
    draggedTaskId = null;
    for (const node of taskList.children) { delete node.dataset.drop; delete node.dataset.dragging; }
  };
  function createCourseList(parent, taskId = null) {
    const scopeId = taskId || 'draft';
    const modeLabel = element('label', '学习范围', parent); const mode = element('select', '', modeLabel); mode.name = `course-mode-${scopeId}`; mode.title = '切换范围将重设当前勾选'; editors.add(mode);
    for (const [value, text] of [['all-pending', '全部待学'], ['specific', '仅学指定课程']]) { const option = element('option', text, mode); option.value = value; }
    mode.addEventListener('change', async () => {
      if (mode.disabled) return; busy.add(mode); mode.disabled = true;
      try { await controller.setTaskMode(taskId, mode.value); } catch { showUiError('学习范围未保存，请重试。'); }
      finally { busy.delete(mode); render(controller.getState()); }
    });
    const filter = element('input', '', parent); filter.type = 'search'; filter.className = 'filter-input'; filter.name = `course-filter-${scopeId}`; filter.setAttribute('aria-label', '筛选课程名称'); filter.placeholder = '筛选课程名称';
    filter.addEventListener('input', () => render(controller.getState()));
    const selection = element('p', '', parent); selection.className = 'muted';
    const controls = element('div', '', parent); controls.className = 'buttons';
    for (const [modeName, caption] of [['unfinished', '全选待学'], ['required', '仅选必修'], ['none', '清空']]) {
      const btn = button(`select-${modeName}-${scopeId}`, caption, controls, () => controller.selectCourses(taskId, modeName));
      if (modeName === 'none') btn.className = 'ghost';
    }
    const pending = element('div', '', parent); const completed = element('details', '', parent); completed.dataset.completed = '';
    const summary = element('summary', '已完成课程', completed);
    const completedActions = element('div', '', completed); completedActions.className = 'buttons completed-actions';
    button(`select-completed-${scopeId}`, '全选已完成', completedActions, () => controller.selectCourses(taskId, 'completed'));
    if (taskId !== null) button(`recheck-${taskId}`, '复查已选', completedActions, () => controller.recheckCompleted(taskId));
    const completeList = element('div', '', completed);
    const noMatches = element('p', '没有匹配的课程。', parent); noMatches.dataset.noMatches = ''; noMatches.className = 'muted';
    return { pending, completed, summary, completeList, nodes: new Map(), mode, filter, selection, noMatches };
  }
  function updateCourses(view, courses, item = null) {
    const ids = new Set(courses.map(course => course.id));
    for (const [id, row] of view.nodes) if (!ids.has(id)) { editors.delete(row.input); if (row.retry) editors.delete(row.retry); row.label.remove(); view.nodes.delete(id); }
    let completedCount = 0, visibleCount = 0, matchedCompleted = 0, selectedCount = 0, hiddenSelectedCount = 0;
    const query = view.filter.value.trim().toLocaleLowerCase();
    view.mode.value = (item || latest.draft)?.selectionMode || 'all-pending';
    for (const course of courses) {
      let row = view.nodes.get(course.id);
      if (!row) {
        const label = element('label', '', view.pending); label.className = 'course';
        const input = element('input', '', label); input.type = 'checkbox'; input.dataset.course = course.id; editors.add(input);
        const text = element('span', '', label); const caption = element('span', '', text); caption.className = 'course-caption'; const meta = element('small', '', text);
        const section = element('small', '', text); section.className = 'one-line';
        const time = element('small', '', text); time.className = 'playback-time'; const playback = element('progress', '', text); playback.setAttribute('aria-label', '当前课节播放进度');
        input.addEventListener('change', async () => {
          if (input.disabled) return;
          busy.add(input); input.disabled = true;
          try { if (item) await controller.setSelection(item.id, course.id, input.checked); else controller.draftSetSelection(course.id, input.checked); }
          catch { showUiError('勾选未能保存，请重试。'); }
          finally { busy.delete(input); render(controller.getState()); }
        });
        const retry = item ? button(`retry-${item.id}-${course.id}`, '重试', label, () => controller.retry(item.id, course.id, 'panel-retry')) : null;
        row = { label, input, caption, meta, section, retry, time, playback }; view.nodes.set(course.id, row);
      }
      const recheck = item?.recheck?.includes(course.id);
      const current = item && currentTask(item) && latest.currentCourseId === course.id && !isDone(item, course.id);
      const done = !current && !recheck && (isDone(item, course.id) || course.status === 'completed'); const skipped = item?.skipped.includes(course.id);
      const deferred = item?.deferred?.find(entry => entry.courseId === course.id);
      const status = deferred ? `待处理：${deferred.reason.replace(/[。.]$/u, '')}` : skipped ? '已跳过' : current ? (latest.status === 'paused' ? '当前课程' : executionLabel(item, course.id)) : recheck ? '待复查课节' : isDone(item, course.id) ? '已完成' : ({ completed: '已完成', learning: '学习中', 'not-started': '未开始', unknown: '待确认' }[course.status] || '待确认');
      row.label.dataset.state = current ? 'active' : deferred || skipped ? 'attention' : done ? 'completed' : 'pending';
      const playback = current ? playbackFor(item, course.id) : null; const timeText = playbackText(playback);
      row.time.textContent = timeText; row.time.hidden = !timeText; row.playback.hidden = !timeText;
      row.playback.max = timeText ? playback.duration : 1; row.playback.value = timeText ? Math.min(playback.currentTime, playback.duration) : 0;
      row.caption.textContent = course.title; row.caption.title = course.title;
      const reqTag = course.required ? '必修' : '选修';
      row.meta.textContent = deferred ? `${reqTag} · ${status}` : `${status} · ${reqTag}`; row.input.checked = course.selected;
      row.section.textContent = current && latest.currentSectionTitle ? `课节 · ${latest.currentSectionTitle}` : ''; row.section.title = latest.currentSectionTitle || ''; row.section.hidden = !row.section.textContent;
      row.input.disabled = latest.unavailable || ['running', 'preparing', 'waiting'].includes(latest.status) || Boolean(item?.scope === 'required' && !course.required);
      row.input.dataset.legacyDisabled = String(Boolean(item?.scope === 'required' && !course.required));
      if (row.retry) row.retry.hidden = !skipped && !deferred;
      const container = done && !skipped && !deferred ? view.completeList : view.pending;
      if (row.label.parentNode !== container) container.append(row.label);
      if (done && !skipped && !deferred) completedCount += 1;
      row.label.hidden = Boolean(query && !course.title.toLocaleLowerCase().includes(query));
      const isSelected = Boolean(course.selected && (item?.scope !== 'required' || course.required));
      if (isSelected) { selectedCount += 1; if (row.label.hidden) hiddenSelectedCount += 1; }
      if (!row.label.hidden) { visibleCount += 1; if (container === view.completeList) matchedCompleted += 1; }
    }
    view.selection.textContent = query && hiddenSelectedCount
      ? `已选 ${selectedCount}/${courses.length} 门（含 ${hiddenSelectedCount} 门未显示）`
      : `已选 ${selectedCount}/${courses.length} 门`;
    view.completed.hidden = completedCount === 0; view.summary.textContent = `已完成课程（${completedCount}）`;
    if (query && matchedCompleted) view.completed.open = true;
    view.noMatches.hidden = visibleCount > 0;
  }
  function updateTasks(state) {
    const ids = new Set(state.tasks.map(task => task.id));
    for (const [id, view] of taskNodes) if (!ids.has(id)) { for (const control of view.article.querySelectorAll('button,input,select')) editors.delete(control); view.article.remove(); taskNodes.delete(id); }
    for (const item of state.tasks) {
      let view = taskNodes.get(item.id);
      if (!view) {
        const article = element('article', '', taskList); article.dataset.taskId = item.id;
        const heading = element('div', '', article); heading.className = 'task-head'; const title = element('h3', '', heading);
        const sorting = element('div', '', heading); sorting.className = 'sort-actions';
        const handle = element('button', '↕', sorting); handle.type = 'button'; handle.className = 'sort-handle'; handle.dataset.dragTask = item.id; handle.title = '拖动调整专区顺序';
        const up = button(`move-up-${item.id}`, '↑', sorting, () => movePriority(item.id, -1), false);
        const down = button(`move-down-${item.id}`, '↓', sorting, () => movePriority(item.id, 1), false);
        handle.addEventListener('dragstart', event => {
          if (!canSort() || handle.disabled || completeTask(latest.tasks.find(task => task.id === item.id))) { event.preventDefault(); return; }
          clearDrag(); draggedTaskId = item.id; article.dataset.dragging = '';
          if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }
        });
        handle.addEventListener('dragend', clearDrag);
        const after = event => { const box = article.getBoundingClientRect(); return event.clientY >= box.top + box.height / 2; };
        article.addEventListener('dragover', event => {
          if (!draggedTaskId || !canSort() || completeTask(latest.tasks.find(task => task.id === item.id))) return;
          event.preventDefault(); for (const node of taskList.children) delete node.dataset.drop;
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          if (draggedTaskId !== item.id) article.dataset.drop = after(event) ? 'after' : 'before';
        });
        article.addEventListener('dragleave', event => { if (!article.contains(event.relatedTarget)) delete article.dataset.drop; });
        article.addEventListener('drop', async event => {
          if (!draggedTaskId || !canSort() || completeTask(latest.tasks.find(task => task.id === item.id))) { clearDrag(); return; }
          event.preventDefault(); const id = draggedTaskId;
          const from = latest.tasks.findIndex(task => task.id === id), targetIdx = latest.tasks.findIndex(task => task.id === item.id);
          const insertion = targetIdx + Number(after(event)); clearDrag();
          if (from < 0 || targetIdx < 0 || id === item.id || completeTask(latest.tasks[from])) return;
          try { await moveDisplayedTask(id, insertion - Number(from < insertion)); }
          catch { showUiError('顺序未保存，请查看当前提示后重试。'); }
        });
        const priority = element('p', '', article); priority.className = 'task-priority muted';
        const metaRow = element('div', '', article); metaRow.className = 'task-meta';
        const summary = element('p', '', metaRow); summary.dataset.taskSummary = item.id;
        const detailButton = button(`detail-${item.id}`, '详情 ▾', metaRow, () => { detail.hidden = !detail.hidden; detailButton.textContent = detail.hidden ? '详情 ▾' : '收起 ▴'; detailButton.setAttribute('aria-expanded', String(!detail.hidden)); }, false); detailButton.className = 'ghost detail-toggle'; detailButton.setAttribute('aria-expanded', 'false');
        const completion = element('progress', '', article); completion.dataset.taskProgress = item.id;
        const current = element('div', '', article); current.className = 'task-current';
        const currentName = element('div', '', current); currentName.className = 'current-name';
        const currentSection = element('small', '', current); currentSection.className = 'one-line';
        const currentTime = element('small', '', current); currentTime.className = 'playback-time';
        const detail = element('div', '', article); detail.dataset.taskDetail = item.id; detail.hidden = true;
        const legacy = element('p', '旧任务仅执行必修课程和课节；需要包含选修可移出后重新添加专区。', detail); legacy.className = 'muted';
        const courses = createCourseList(detail, item.id); const actions = element('div', '', detail); actions.className = 'buttons detail-actions';
        const refresh = button(`refresh-${item.id}`, '刷新课程', actions, () => controller.refreshTask(item.id));
        const remove = button(`remove-${item.id}`, '移出队列', actions, async () => {
          if (pendingRemoveId !== item.id) {
            clearRemoveConfirm();
            pendingRemoveId = item.id;
            pendingRemoveTimer = win.setTimeout(() => { clearRemoveConfirm(); render(controller.getState()); }, 3000);
            return;
          }
          clearRemoveConfirm();
          await controller.removeTask(item.id);
        });
        remove.className = 'danger';
        view = { article, title, sorting, priority, summary, completion, current, currentName, currentSection, currentTime, detail, legacy, courses, refresh, remove, handle, up, down }; taskNodes.set(item.id, view);
      }
      const subjectTitle = item.subject?.title || item.target;
      view.title.textContent = subjectTitle; view.title.title = subjectTitle;
      view.handle.setAttribute('aria-label', `拖动排序：${subjectTitle}`);
      view.up.setAttribute('aria-label', `上移：${subjectTitle}`);
      view.down.setAttribute('aria-label', `下移：${subjectTitle}`);
      const sortable = sortableTasks(); const priorityIndex = sortable.findIndex(task => task.id === item.id); const completed = completeTask(item), current = currentTask(item, state);
      const showSort = !completed && sortable.length >= 2;
      view.sorting.hidden = !showSort;
      view.handle.disabled = !canSort() || !showSort; view.handle.draggable = !view.handle.disabled;
      view.up.disabled = !canSort() || !showSort || priorityIndex <= 0; view.down.disabled = !canSort() || !showSort || priorityIndex === sortable.length - 1;
      view.up.title = '上移优先级（当前课程继续）'; view.down.title = '下移优先级（当前课程继续）';
      const confirmingRemove = pendingRemoveId === item.id && !isRunning(state) && !state.unavailable;
      view.remove.textContent = confirmingRemove ? '确认移出？' : '移出队列';
      view.remove.className = confirmingRemove ? 'danger danger-confirm' : 'danger';
      const total = counts(item);
      const issues = [['待处理', total.deferred], ['跳过', item.skipped.length], ['待复查', item.recheck?.length || 0]].filter(([, count]) => count).map(([name, count]) => `${name} ${count}`);
      view.article.dataset.state = current ? 'active' : completed ? 'completed' : issues.length ? 'attention' : 'pending';
      view.priority.textContent = `优先级 ${priorityIndex + 1}`; view.priority.hidden = completed || sortable.length < 2;
      if (!item.subject) view.summary.textContent = '尚未读取专区，请移出后重新添加';
      else if (!total.selected) view.summary.textContent = '尚未选择课程';
      else if (completed) view.summary.textContent = `已完成 ${total.selected} 门`;
      else if (current) view.summary.textContent = `${executionLabel(item)} · 完成 ${total.done}/${total.selected} 门${issues.length ? ` · ${issues.join(' · ')}` : ''}`;
      else if (issues.length) view.summary.textContent = `完成 ${total.done}/${total.selected} 门 · ${issues.join(' · ')}`;
      else view.summary.textContent = `待学习 · 完成 ${total.done}/${total.selected} 门`;
      view.completion.max = total.selected || 1; view.completion.value = total.done; view.completion.hidden = !total.selected; view.completion.setAttribute('aria-label', `专区已完成 ${total.done} / ${total.selected} 门`);
      view.currentName.textContent = current ? item.courses.find(course => course.id === state.currentCourseId)?.title || '正在确认课程' : ''; view.currentName.title = view.currentName.textContent;
      view.currentSection.textContent = current && state.currentSectionTitle ? `课节 · ${state.currentSectionTitle}` : ''; view.currentSection.title = state.currentSectionTitle || ''; view.currentSection.hidden = !view.currentSection.textContent;
      view.currentTime.textContent = current ? playbackText(playbackFor(item, state.currentCourseId)) : ''; view.currentTime.hidden = !view.currentTime.textContent;
      view.legacy.hidden = item.scope !== 'required'; view.refresh.dataset.legacyDisabled = String(!item.subject); updateCourses(view.courses, item.courses, item);
      const activeRow = view.courses.nodes.get(state.currentCourseId)?.label; const folded = activeRow?.closest('details[data-completed]');
      const rowVisible = !view.detail.hidden && activeRow && !activeRow.hidden && (!folded || folded.open);
      view.current.hidden = !current || Boolean(rowVisible);
    }
    const display = [...state.tasks.filter(item => currentTask(item, state)), ...state.tasks.filter(item => !currentTask(item, state) && !completeTask(item)), ...state.tasks.filter(completeTask)];
    for (const [index, item] of display.entries()) { const node = taskNodes.get(item.id).article; if (taskList.children[index] !== node) taskList.insertBefore(node, taskList.children[index] || null); }
  }
  function render(state) {
    latest = state;
    const running = isRunning(state);
    const active = state.tasks.find(item => item.id === state.activeTaskId);
    const all = state.tasks.reduce((sum, task) => { const c = counts(task); return { done: sum.done + c.done, selected: sum.selected + c.selected, deferred: sum.deferred + c.deferred }; }, { done: 0, selected: 0, deferred: 0 });
    progress.textContent = `${phaseLabels[state.phase || state.status] || state.status} · 总完成 ${all.done}/${all.selected} 门${all.deferred ? ` · 待处理 ${all.deferred}` : ''}`;
    compact.textContent = active?.courses.find(course => course.id === state.currentCourseId)?.title || ''; compact.title = compact.textContent; compact.hidden = !body.hidden || !compact.textContent;
    compactTime.textContent = active ? playbackText(playbackFor(active, state.currentCourseId)) : ''; compactTime.hidden = !body.hidden || !compactTime.textContent;
    const rawNotice = quietMessages.has(state.message) ? '' : String(state.message || '').replace(/有待学课程，请手动点击开始继续。$/u, '').trim();
    const notice = quietMessages.has(rawNotice) ? '' : rawNotice;
    message.textContent = notice; execution.hidden = !notice || notice === state.problem?.reason;
    compactNotice.textContent = notice || state.problem?.reason || ''; compactNotice.hidden = !body.hidden || !compactNotice.textContent;
    problemBox.hidden = !state.problem;
    if (state.problem) { const item = state.tasks.find(task => task.id === state.problem.taskId); problemText.textContent = `${item?.subject?.title || item?.target || '专区'} · ${item?.courses.find(course => course.id === state.problem.courseId)?.title || '课程'}\n${state.problem.reason}`; }
    if (state.draft) adding = true;
    else if (draftSubjectId && state.tasks.some(item => item.subject?.id === draftSubjectId)) adding = false;
    draftSubjectId = state.draft?.subject.id || null;
    queueView.hidden = adding; addView.hidden = !adding; searchBox.hidden = Boolean(state.draft); draftBox.hidden = !state.draft;
    quickBar.hidden = adding;
    settingsBox.hidden = adding;
    empty.hidden = state.tasks.length > 0;
    for (const [name, field] of Object.entries(fields)) if (!dirty.has(name) && root.activeElement !== field) field.value = state.window[name];
    updateTasks(state);
    const signature = JSON.stringify(state.candidates);
    if (candidateSignature !== signature) { candidateSignature = signature; for (const control of candidates.querySelectorAll('button')) editors.delete(control); candidates.replaceChildren(); if (state.candidates.length) element('p', '选择要添加的专区：', candidates); for (const item of state.candidates) { const candidate = button(`candidate-${item.id}`, item.title, candidates, () => controller.chooseCandidate(item.id)); candidate.className = 'candidate'; } }
    candidates.hidden = !adding || Boolean(state.draft) || running || !state.candidates.length;
    if (state.draft) { draftTitle.textContent = state.draft.subject.title; updateCourses(draftCourses, state.draft.courses); }
    for (const control of editors) control.disabled = running || state.unavailable || control.dataset.legacyDisabled === 'true';
    automatic.checked = state.automation?.enabled === true; resumeOnReload.checked = state.automation?.resumeOnReload === true; mute.checked = state.automation?.mute !== false;
    resumeOnReload.disabled ||= !automatic.checked;
    autoHint.hidden = !automatic.checked;
    runningEditHint.hidden = !running;
    settingsSummary.textContent = `⚙ 设置 · ${state.window.start}–${state.window.end}${automatic.checked ? ' · 自动' : ''}${mute.checked ? ' · 已静音' : ''}`;
    for (const control of problemActions.querySelectorAll('button')) if (control !== leaveLearningButton) control.disabled ||= adding;
    const showLeave = !running && !adding && Boolean(state.onOwnedLearningPage);
    if (showLeave) {
      const targetParent = state.problem ? problemActions : leaveBar;
      if (leaveLearningButton.parentNode !== targetParent) targetParent.append(leaveLearningButton);
    }
    leaveLearningButton.hidden = !showLeave;
    leaveLearningButton.disabled = !showLeave || state.unavailable;
    leaveBar.hidden = !showLeave || Boolean(state.problem);
    if (running || state.unavailable) clearRemoveConfirm();
    const hasPending = state.tasks.some(item => item.subject && eligible(item).some(course => !isDone(item, course.id) && !item.skipped.includes(course.id) && !item.deferred?.some(entry => entry.courseId === course.id)));
    const cannotStart = starting || state.unavailable || adding || Boolean(state.draft) || !hasPending;
    const hasStarted = hasRunHistory(state);
    const completedCount = state.tasks.filter(item => completeTask(item) && !(running && item.id === state.activeTaskId)).length;
    clearCompleted.textContent = `清除已完成（${completedCount}）`;
    clearCompleted.hidden = !completedCount;
    clearCompleted.disabled = !completedCount || state.unavailable || state.status === 'preparing' || state.phase === 'resuming';
    addButton.className = state.tasks.length === 0 ? 'primary' : '';
    addButton.title = running ? '暂停后可添加专区' : '';
    runButton.textContent = running ? '暂停' : state.status === 'complete' ? '已完成' : hasStarted ? '继续' : '开始';
    runButton.className = !running && state.status !== 'complete' ? 'primary' : '';
    runButton.disabled = starting || (!running && cannotStart); toggle.disabled = false;
    playGesture.hidden = !state.playGesture;
    playGesture.disabled = !state.playGesture;
    if (kgModal) syncSubtitleControls();
    for (const control of busy) control.disabled = true;
  }
  const sectionGuideEntries = mountSectionGuideButtons({
    win,
    pageWin: kg.getPageWin?.() || win,
    httpGet: kg.httpGetSubtitle || null,
    onOpenSection: ({ sectionId }) => openKnowledgeModal({ targetSectionId: sectionId, scope: 'section', initialTab: 'quick' }),
  });
  const unsubscribe = controller.subscribe(render);
  const panel = { open() { setOpen(true); }, destroy() { unsubscribeAiSettings(); kg.abortFetchModels?.(); kg.abortTestConnection?.(); sectionGuideEntries.destroy(); closeKnowledgeModal(); clearTimers(); unsubscribe(); host.remove(); } };
  host.wdPanel = panel; document.documentElement.append(host); render(controller.getState());
  return panel;
}






const wdMainVersion = "0.1.0-beta.22";

function wdMainBootstrap(win) {
  if (win.location.protocol !== 'https:' || win.location.hostname !== 'wangda.chinamobile.com' || win.top !== win.self) return;
  if (win.__wangdaAssistantInstance) return;
  const pageWin = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : win;
  const adapter = createAdapter(win);
  const storage = typeof GM_getValue === 'function' && typeof GM_setValue === 'function'
    ? { get: key => GM_getValue(key), set: (key, value) => GM_setValue(key, value) } : null;
  const controller = createController({ adapter, storage, locks: win.navigator.locks,
    setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win),
    notify: text => { if (typeof GM_notification === 'function') GM_notification({ title: '网大助手', text }); },
  });
  const knowledge = createKnowledgeService({
    win,
    pageWin,
    controller,
    adapter,
    gmStorage: storage,
    gmRequest: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
  });
  const panel = createPanel(win, controller, wdMainVersion, knowledge);
  const destroy = event => { knowledge.abort(); controller.destroy({ preserveRun: event?.type === 'beforeunload' }); panel.destroy(); win.removeEventListener('beforeunload', destroy); delete win.__wangdaAssistantInstance; };
  win.__wangdaAssistantInstance = { destroy };
  win.addEventListener('beforeunload', destroy);
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('打开网大助手', () => panel.open());
}

if (typeof window !== 'undefined') wdMainBootstrap(window);

})();
