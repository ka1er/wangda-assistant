// ==UserScript==
// @name         网大助手
// @namespace    wangda-assistant
// @version      0.1.0-beta.16
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

function wdAdapterMediaHasBinding(media, attrName, expected) {
  if (!media || !expected) return false;
  const docBody = media.ownerDocument?.body;
  for (let current = media; current && current !== docBody; current = current.parentElement) {
    const value = wdAdapterAttribute(current, attrName);
    if (value !== null && value === expected) return true;
  }
  return false;
}

function wdAdapterResolveMedia(document, page) {
  const all = [...document.querySelectorAll('video,audio')];
  const visible = all.filter(wdAdapterVisible);
  if (!visible.length) return { status: 'none', target: null, count: 0, totalCount: all.length, tag: null, reason: all.length ? 'only-hidden-media' : 'no-media' };
  if (visible.length === 1) return { status: 'resolved', target: visible[0], count: 1, totalCount: all.length, tag: visible[0].tagName.toLowerCase(), reason: 'single-visible' };
  if (page?.kind === 'course') {
    const activeId = page.activeSectionId;
    const activeEl = activeId ? wdAdapterSectionElements(document).find(element => wdAdapterSectionId(element) === activeId && wdAdapterAttribute(element, 'course-id') === page.courseId) : null;
    const activeResourceId = activeEl ? wdAdapterAttribute(activeEl, 'resource-id') : null;
    if (activeId || activeResourceId) {
      const sectionBound = visible.filter(media => wdAdapterMediaHasBinding(media, 'section-id', activeId) || wdAdapterMediaHasBinding(media, 'resource-id', activeResourceId));
      if (sectionBound.length === 1) {
        return { status: 'resolved', target: sectionBound[0], count: visible.length, totalCount: all.length, tag: sectionBound[0].tagName.toLowerCase(), reason: 'section-bound' };
      }
    }
    if (page.courseId) {
      const courseBound = visible.filter(media => wdAdapterMediaHasBinding(media, 'course-id', page.courseId));
      if (courseBound.length === 1) {
        return { status: 'resolved', target: courseBound[0], count: visible.length, totalCount: all.length, tag: courseBound[0].tagName.toLowerCase(), reason: 'course-bound' };
      }
    }
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
  const pauseMedia = () => {
    const page = read();
    if (page.kind !== 'course') return false;
    const resolved = wdAdapterResolveMedia(win.document, page);
    if (resolved.status !== 'resolved') return false;
    try { resolved.target.pause(); return true; } catch { return false; }
  };
  return {
    read,
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
    async playCurrentMedia(mute = true) {
      const page = read();
      if (page.kind !== 'course') return false;
      const resolved = wdAdapterResolveMedia(win.document, page);
      if (resolved.status !== 'resolved') return false;
      const media = resolved.target;
      if (!media.paused || media.ended) return false;
      try { if (mute) media.muted = true; await media.play(); return true; } catch { return false; }
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




const wdControllerTaskKey = 'wangda-assistant.task';
const wdControllerLeaseKey = 'wangda-assistant.lease';
const wdControllerLock = 'wangda-assistant.run';
const wdControllerEndedConfirmTimeout = 90000;

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
  let mediaPending = null;
  let stopMediaWatch = null;
  let resumeNoticeKey = null;
  let recovery = null;
  let restorePending = false;
  const retries = new Map();
  const defaultAutomation = { enabled: false, resumeOnReload: false, mute: true };
  const played = new Set();
  const seenPlaying = new Set();
  const resumeAttempts = new Map();
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
  const getState = () => ({ status, phase: restorePending ? 'resuming' : recovery?.network ? 'offline' : recovery ? 'retrying' : confirmWait ? 'confirming' : status, message, unavailable: blocked, onOwnedLearningPage: isOnOwnedLearningPage(), window: copy(record?.window || defaultWindow), automation: copy(record?.automation || defaultAutomation), tasks: copy(record?.tasks || []), activeTaskId: record?.activeTaskId || null, currentCourseId: task?.current || null, currentSectionTitle, currentPlayback: copy(currentPlayback), candidates: copy(candidates), draft: copy(draft), problem: copy(problem) });
  const emit = () => { const state = getState(); for (const listener of listeners) listener(state); };
  const tell = text => { message = text; emit(); return false; };
  const milliseconds = () => now().getTime();
  const notify = text => { try { options.notify?.(text); } catch { /* Notifications are optional. */ } };
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
    preparing = pending = grace = loading = confirmWait = sectionConfirm = recovery = null;
    mediaPending = null;
    if (wasRunning && !complete && task?.current && /人工|播放|媒体已暂停|课节|超时|页面操作未成功|页面读取或操作异常/u.test(text)) problem = { taskId: task.id, courseId: task.current, reason: text };
    status = complete ? 'complete' : 'paused';
    message = text;
    if (wasRunning && ownsCurrentLearningPage()) {
      try {
        adapter.pauseMedia();
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
      Promise.resolve().then(() => locks.request(wdControllerLock, { mode: 'exclusive', ifAvailable: true }, async lock => {
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
  const edit = async fn => {
    if (!editable()) return tell('请先暂停，再修改任务。');
    const token = generation;
    if (!await acquire() || token !== generation || !held || !verify()) return false;
    try { return await fn(); } catch (error) { return storageError(error); } finally { release(); }
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
  const start = async (preferred = null) => {
    if (!editable() || !record || !record.tasks.length) return tell('请先添加专区任务。');
    if (!isWithinWindow(now(), record.window) && !record.automation.enabled) return tell('当前不在允许的北京时间学习时段内。');
    const preferredTask = preferred && record.tasks.find(item => item.id === preferred.taskId);
    const preferredCourse = queue(preferredTask).find(course => course.id === preferred.courseId && course.selected && !isDone(preferredTask, course.id) && !preferredTask.skipped.includes(course.id) && !preferredTask.deferred?.some(entry => entry.courseId === course.id));
    const entry = preferredCourse ? { item: preferredTask, course: preferredCourse } : nextEntry();
    if (!entry || !entry.item.subject) return tell(record.tasks.some(item => item.deferred?.length) ? '仍有待处理课程，请在详情中重试。' : record.tasks.some(item => item.skipped.length) ? '仍有跳过课程未完成，请重试。' : '请勾选尚未核对的课程。');
    const token = generation;
    if (!await acquire() || token !== generation || !held || !verify()) return false;
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id; problem = null; currentSectionTitle = ''; currentPlayback = null;
    record.runRequested = record.automation.enabled;
    if (!persist()) return false;
    generation += 1; restorePending = false; status = isWithinWindow(now(), record.window) ? 'running' : 'waiting'; needOpen = true; played.clear(); seenPlaying.clear(); resumeAttempts.clear(); retries.clear(); pending = grace = loading = confirmWait = sectionConfirm = recovery = null;
    message = status === 'waiting' ? `等待学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。` : '正在按平台课节状态连续学习。';
    if (status === 'waiting') waitWindow();
    else { watchMedia(); muteCourse(entry.course); }
    watch(); emit(); return true;
  };
  const pause = async () => {
    restorePending = false;
    if (!held && record?.runRequested && !await acquire()) { stop('无法暂停其他标签正在执行的任务，请到执行标签点击暂停。'); return false; }
    if (status !== 'running' && status !== 'preparing' && ownsCurrentLearningPage()) {
      try {
        adapter.pauseMedia();
        if (adapter.leaveLearning(task.subject.route) === false) { stop('页面未能停止，请手动退出学习页。'); return false; }
        lastOwnedPage = null;
      } catch { stop('页面未能停止，请手动退出学习页。'); return false; }
    }
    stop('已暂停，继续学习需手动点击开始。', true); return true;
  };
  const waitFor = (key, reason) => {
    if (loading?.key !== key) loading = { key, since: milliseconds() };
    const since = pending?.kind === 'course' ? pending.arrivedAt ?? loading.since : loading.since;
    if (milliseconds() - since >= 30000) recover(`${reason}，加载超时。`);
  };
  const action = (fn, expectation) => {
    if (!verify() || status !== 'running') return;
    currentPlayback = null;
    if (!fn()) { recover('页面操作未成功。'); return; }
    pending = { ...expectation, since: milliseconds() };
    loading = confirmWait = null;
    if (expectation.kind === 'course') { sectionConfirm = null; lastOwnedPage = null; }
  };
  const nextCourse = (page, leaveWhenDone = true) => {
    currentPlayback = null;
    const entry = nextEntry();
    if (!entry) {
      const count = record.tasks.reduce((n, item) => n + (item.deferred?.length || 0), 0);
      if (count) { stop(`队列已执行完，仍有 ${count} 门待处理课程${record.tasks.some(item => item.skipped.length) ? '及跳过课程' : ''}；请在详情中查看原因并重试。`, leaveWhenDone); notify(message); return; }
      if (record.tasks.some(item => item.skipped.length)) { stop('其他课程已核对，仍有跳过课程未完成，请重试。', true); return; }
      stop('所选课程已全部完成。', true, true); notify('所选课程已完成。'); return;
    }
    generation += 1; mediaPending = null;
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id;
    if (!persist()) return;
    grace = loading = confirmWait = sectionConfirm = recovery = null; lastOwnedPage = null; currentSectionTitle = '';
    if (matchesCourse(page, entry.course)) { pending = null; return; }
    action(() => adapter.openCourse(entry.course), { kind: 'course', id: entry.course.id, before: page.route });
  };
  const deferCurrent = (reason, leave = true) => {
    if (!verify() || status !== 'running') return;
    generation += 1; mediaPending = null; pending = grace = loading = confirmWait = sectionConfirm = recovery = null;
    const page = adapter.read();
    if (ownsCurrentLearningPage()) {
      adapter.pauseMedia();
      if (leave && adapter.leaveLearning(task.subject.route) === false) { stop('未能退出当前学习页，请手动退出后继续。'); notify(message); return; }
      lastOwnedPage = null;
    }
    task.deferred = [...(task.deferred || []).filter(item => item.courseId !== task.current), { courseId: task.current, reason }];
    if (!persist()) return;
    message = `课程已放入待处理：${reason} 继续后续课程。`; emit();
    nextCourse(page, leave);
  };
  const recover = (reason, { reopen = true } = {}) => {
    currentPlayback = null;
    if (!record?.automation.enabled) {
      stop(`${reason} ${reopen ? '已暂停并退出学习页，请人工确认。' : '请在当前页手动播放后再继续。'}`, reopen);
      if (!reopen) notify(message);
      return;
    }
    if (!verify() || status !== 'running') return;
    const key = `${task.id}:${task.current}`, attempt = (retries.get(key) || 0) + 1;
    if (attempt > 3) { deferCurrent(`${reason} 已重试三次。`, reopen); return; }
    generation += 1; mediaPending = null; pending = grace = loading = confirmWait = sectionConfirm = null;
    retries.set(key, attempt);
    if (reopen && ownsCurrentLearningPage()) {
      adapter.pauseMedia();
      if (adapter.leaveLearning(task.subject.route) === false) { stop('重试前未能退出学习页，请手动退出后继续。'); notify(message); return; }
      lastOwnedPage = null;
    }
    recovery = { until: milliseconds() + [5000, 10000, 20000][attempt - 1], reopen, before: adapter.read().route };
    message = `${reason} 正在等待重试 ${attempt}/3。`; emit();
  };
  const waitWindow = () => {
    currentPlayback = null;
    stopMediaWatch?.(); stopMediaWatch = null;
    if (!record.automation.enabled) { stop('已到学习时段边界，已停止媒体并退出学习页。', true); return; }
    if (ownsCurrentLearningPage()) {
      try {
        adapter.pauseMedia();
        if (adapter.leaveLearning(task.subject.route) === false) throw Error();
        lastOwnedPage = null;
      } catch { stop('学习时段结束，但未能退出学习页，请手动停止。', true); notify(message); return; }
    }
    generation += 1; mediaPending = null; pending = grace = loading = confirmWait = sectionConfirm = recovery = null; needOpen = true;
    played.clear(); seenPlaying.clear(); resumeAttempts.clear();
    status = 'waiting'; message = `等待下次学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。`; emit();
  };
  const retry = async (taskId = problem?.taskId, courseId = problem?.courseId) => {
    const changed = await edit(() => {
      const item = record?.tasks.find(item => item.id === taskId);
      if (!item?.courses.some(course => course.id === courseId)) return false;
      item.skipped = item.skipped.filter(id => id !== courseId);
      if (!item.recheck?.includes(courseId)) item.done = item.done.filter(id => id !== courseId);
      item.deferred = (item.deferred || []).filter(entry => entry.courseId !== courseId);
      item.courses.find(course => course.id === courseId).selected = true;
      record.activeTaskId = item.id; item.current = courseId; problem = null; return persist();
    });
    return changed ? start({ taskId, courseId }) : false;
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
          adapter.pauseMedia();
          if (adapter.leaveLearning(item.subject.route) === false) return tell('课程已跳过，但未能退出学习页，请手动退出后继续。');
        }
      } catch { return tell('课程已跳过，但页面操作未能完成，请手动退出学习页后继续。'); }
      return true;
    });
    if (!skipped) return false;
    if (!nextEntry()) { tell('仍有跳过课程未完成，请重试。'); return true; }
    return start();
  };
  const tick = async () => {
    if (restorePending && !destroyed) { restorePending = false; await start({ taskId: record.activeTaskId, courseId: task?.current }); if (status === 'paused' && timer !== null) { unschedule(timer); timer = null; } return; }
    // Boundary and ownership checks also run while a media.play promise is pending.
    if (destroyed || !['running', 'preparing', 'waiting'].includes(status)) return;
    if (status === 'running' && !isWithinWindow(now(), record.window)) { waitWindow(); return; }
    if (!verify()) return;
    try { lease(); } catch (error) { storageError(error); return; }
    if (ticking) return;
    ticking = true;
    currentPlayback = null;
    try {
      const page = adapter.read();
      if (resumeNoticeKey && (resumeNoticeKey !== `${task?.id}:${page.courseId}:${page.activeSectionId}` || !page.media?.paused || page.media.ended || page.sections?.some(item => item.id === page.activeSectionId && item.status === 'completed'))) {
        resumeNoticeKey = null;
        if (message.startsWith('播放已暂停，正在自动恢复播放')) message = '正在按平台课节状态连续学习。';
      }
      if (page.kind === 'login' || page.kind === 'study-error') {
        stop(page.kind === 'login' ? '登录已失效，请重新登录后继续。' : page.errorCode === '1' ? '其他学习窗口已接管播放，请关闭其他窗口后手动继续。' : '平台学习限制提示，请在当前页面处理后继续。'); notify(message); return;
      }
      if (status === 'waiting') {
        if (isWithinWindow(now(), record.window)) { status = 'running'; needOpen = true; watchMedia(); message = '已进入学习时段，正在继续队列。'; emit(); }
        return;
      }
      if (status === 'running' && record.automation.enabled && page.online === false) {
        if (!recovery?.network) {
          generation += 1; mediaPending = null; pending = grace = loading = confirmWait = sectionConfirm = null;
          if (ownsCurrentLearningPage()) {
            adapter.pauseMedia();
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
      if (recovery) {
        const onTarget = matchesCourse(page, current);
        const onExpectedSubject = recovery.reopen !== false && page.route === task.subject.route;
        if (page.route !== recovery.before && !onExpectedSubject && !onTarget) { stop('页面已离开目标课程，请确认后重新开始。'); return; }
        if (!recovery.network && milliseconds() < recovery.until) return;
        recovery = null; played.clear(); seenPlaying.clear();
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
          if (milliseconds() - pending.since >= 30000) recover('页面切换超时。');
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
          adapter.pauseMedia(); nextCourse(page); return;
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
          if (page.mediaReady === false && !seenPlaying.has(key)) {
            confirmWait = null;
            waitFor(`player:${active.id}`, '媒体播放器尚未接入播放源');
            return;
          }
          loading = null;
          if (page.media.ended) {
            if (mediaPending?.key === key) mediaPending = null;
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
          if (!page.media.paused) {
            seenPlaying.add(key);
            // Observed playback supersedes any unresolved play request for this section.
            if (mediaPending?.key === key) mediaPending = null;
            const resume = resumeAttempts.get(key);
            if (resume) resume.pausedAt = null;
          }
          if (page.media.paused && !page.media.ended) {
            if (mediaPending?.key === key) {
              if (milliseconds() - mediaPending.since >= 30000) {
                if (mediaPending.resume) { stop('自动恢复播放超时，请检查播放器后继续。'); notify(message); }
                else recover('播放请求超时。');
              }
              return;
            }
            const resuming = seenPlaying.has(key);
            if (resuming) {
              // Ordinary pauses recover in place, with a bounded budget per section.
              let resume = resumeAttempts.get(key);
              if (!resume || (resume.pausedAt === null && milliseconds() - resume.windowStart >= 60000)) {
                resume = { windowStart: milliseconds(), count: 0, pausedAt: milliseconds(), nextAt: milliseconds() + 2000 };
                resumeAttempts.set(key, resume);
              } else if (resume.pausedAt === null) {
                resume.pausedAt = milliseconds(); resume.nextAt = Math.max(resume.nextAt, milliseconds() + 2000);
              }
              if (milliseconds() < resume.nextAt || page.online === false) return;
              if (resume.count >= 3) { stop('自动恢复播放已尝试 3 次，仍反复暂停，请检查播放器后继续。'); notify(message); return; }
              resume.count += 1;
              resume.nextAt = milliseconds() + [5000, 10000, 10000][resume.count - 1];
              message = `播放已暂停，正在自动恢复播放（${resume.count}/3）。`;
              resumeNoticeKey = key;
            } else if (played.has(key)) { recover('媒体未能开始播放。', { reopen: false }); return; }
            played.add(key);
            const request = { key, since: milliseconds(), resume: resuming };
            mediaPending = request;
            const token = generation;
            // muteCourse and media events enforce the option; resume leaves volume unchanged.
            Promise.resolve(adapter.playCurrentMedia(resuming ? false : record.automation.mute)).then(success => {
              try {
                if (destroyed || generation !== token || status !== 'running' || mediaPending !== request || !verify()) return;
                if (!isWithinWindow(now(), record.window)) { waitWindow(); return; }
                const latest = adapter.read();
                if (pauseForRelearn(latest, current)) return;
                if (!matchesCourse(latest, current) || latest.activeSectionId !== active.id) return;
                mediaPending = null;
                if (success) seenPlaying.add(key);
                if (resuming) return;
                if (!success) recover('浏览器未能自动播放。', { reopen: false });
              } catch { if (generation === token && status === 'running') stop('页面读取或操作异常，已暂停并退出学习页，请人工确认。', true); }
            }, () => {
              // Only a native play rejection can use the manual-play pause path.
              try {
                if (destroyed || generation !== token || status !== 'running' || mediaPending !== request || !verify()) return;
                if (!isWithinWindow(now(), record.window)) { waitWindow(); return; }
                const latest = adapter.read();
                if (pauseForRelearn(latest, current)) return;
                if (!matchesCourse(latest, current) || latest.activeSectionId !== active.id) return;
                mediaPending = null;
                if (resuming) return;
                recover('播放失败。', { reopen: false });
              } catch { if (generation === token && status === 'running') stop('页面读取或操作异常，已暂停并退出学习页，请人工确认。', true); }
            });
          }
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
  if (!blocked && record?.automation.enabled && record.automation.resumeOnReload && record.runRequested) { restorePending = true; message = '正在准备恢复上次开始的队列。'; watch(); }
  return {
    getState, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    search, chooseCandidate, collectDraft, draftSetSelection, selectCourses, addDraft, discardDraft, setSelection, setTaskMode, recheckCompleted, refreshTask, removeTask, clearCompletedTasks, moveTask, setWindow, setAutomation,
    start, pause, retry, skipCurrent, tick,
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
    destroy({ preserveRun = false } = {}) { if (destroyed) return; const keep = preserveRun && record?.automation.enabled && record.automation.resumeOnReload && ['running', 'waiting'].includes(status); stop('面板已关闭，任务已暂停。', true, false, keep); destroyed = true; listeners.clear(); },
  };
}

const wdKvttAllowedVttHosts = host => typeof host === 'string' && (host === 'wangda.chinamobile.com' || host.endsWith('.wangda.chinamobile.com'));
const wdKvttCourseRoutePattern = /^#\/study\/course\/detail\/(?:subject-course\/)?([A-Za-z0-9_-]+)(?:\/(\d+)(?:\/([A-Za-z0-9_-]+))?)?$/u;
const wdKvttNoisePattern = /(?:\[音乐\]|\[掌声\]|\[笑声\]|\(音乐\)|\(掌声\)|（音乐）|（掌声）|[♪♫♬]+)/gu;
const wdKvttDiscoursePattern = /^(?:接下来|首先|其次|再次|第一|第二|第三|第四|最后|总结一下|总的来说|下面我们|那么下面|换句话说|另一方面|需要注意)/u;
const wdKvttStopWords = new Set(['我们', '你们', '他们', '这个', '那个', '就是', '然后', '所以', '因为', '可以', '一个', '一些', '这里', '那里', '大家', '其实', '如果', '那么', '什么', '怎么', '这样', '那样', '进行', '通过', '以及', '或者', '已经', '现在', '时候', '问题', '方面', '内容', '课程', '一下', '不是', '没有', '需要', '非常', '比较', '首先', '接下来', '介绍', '学习', '今天', '关于', '里面']);
const wdKvttSensitiveQueryParams = new Set(['token', 'access_token', 'auth_key', 'sign', 'signature', 'key', 'secret', 'ticket', 'pwd', 'password']);

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
  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return cues.map((cue, idx) => ({ ...cue, index: idx + 1 }));
}

function cleanAndSegmentCues(rawCues, options = {}) {
  const mergeGapMs = Number.isFinite(options.mergeGapMs) ? options.mergeGapMs : 500;
  const maxSegmentChars = Number.isFinite(options.maxSegmentChars) ? options.maxSegmentChars : 320;
  const minSegmentChars = Number.isFinite(options.minSegmentChars) ? options.minSegmentChars : 100;
  const pauseBreakMs = Number.isFinite(options.pauseBreakMs) ? options.pauseBreakMs : 1500;
  const list = (Array.isArray(rawCues) ? rawCues : [])
    .map(cue => {
      const startMs = Number.isFinite(cue?.startMs) ? Math.round(cue.startMs) : Math.round((Number(cue?.startSec ?? cue?.startTime ?? 0) || 0) * 1000);
      const endMs = Number.isFinite(cue?.endMs) ? Math.round(cue.endMs) : Math.round((Number(cue?.endSec ?? cue?.endTime ?? startMs / 1000) || 0) * 1000);
      const text = wdKvttStripCueText(cue?.text ?? '');
      return { startMs: Math.max(0, startMs), endMs: Math.max(startMs, endMs), text };
    })
    .filter(cue => cue.text)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

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

  // Step 2: Merge adjacent broken-sentence cues
  const merged = [];
  for (const cue of deduped) {
    const prev = merged.at(-1);
    if (prev && (cue.startMs - prev.endMs) <= mergeGapMs && !/[。！？!?；;]$/u.test(prev.text) && (prev.text.length + cue.text.length) <= 180) {
      const joiner = /[A-Za-z0-9]$/u.test(prev.text) && /^[A-Za-z0-9]/u.test(cue.text) ? ' ' : '';
      prev.text = `${prev.text}${joiner}${cue.text}`;
      prev.endMs = Math.max(prev.endMs, cue.endMs);
    } else {
      merged.push({ ...cue });
    }
  }

  // Step 3: Paragraph segmentation
  const segments = [];
  let bucket = null;
  const flush = () => {
    if (!bucket) return;
    const text = bucket.texts.join(' ').replace(/\s+/gu, ' ').trim();
    if (text) {
      segments.push({
        index: segments.length + 1,
        startMs: bucket.startMs,
        endMs: bucket.endMs,
        startSec: Math.floor(bucket.startMs / 1000),
        timestamp: formatTimestamp(bucket.startMs / 1000),
        text,
      });
    }
    bucket = null;
  };

  for (const item of merged) {
    if (!bucket) {
      bucket = { startMs: item.startMs, endMs: item.endMs, texts: [item.text], chars: item.text.length };
      continue;
    }
    const gap = item.startMs - bucket.endMs;
    const shouldBreak = bucket.chars >= maxSegmentChars
      || (bucket.chars >= minSegmentChars && gap > pauseBreakMs)
      || (bucket.chars >= minSegmentChars && wdKvttDiscoursePattern.test(item.text));
    if (shouldBreak) {
      flush();
      bucket = { startMs: item.startMs, endMs: item.endMs, texts: [item.text], chars: item.text.length };
    } else {
      bucket.texts.push(item.text);
      bucket.endMs = Math.max(bucket.endMs, item.endMs);
      bucket.chars += item.text.length;
    }
  }
  flush();
  return { cues: deduped, merged, segments };
}

function wdKvttFirstSentence(text, maxLen = 25) {
  const cleaned = String(text ?? '')
    .replace(/^(?:大家好|同学们好|各位好|那么|然后|所以|因此|但是|就是|其实|大家看|我们可以看到|接下来我们看|下面我们看|首先我们看|首先我们来看|首先介绍|接下来介绍)[，,、：:\s]*/u, '')
    .trim();
  const sentence = cleaned.split(/[。！？!?；;\n]/u).map(s => s.trim()).find(s => s.length >= 4) || cleaned;
  const trimmed = sentence.replace(/^[的了呢吧啊哦嘛]+|[的了呢吧啊哦嘛]+$/gu, '').trim() || sentence;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed;
}

function wdKvttTopicPhrase(text, maxLen = 16) {
  const sentence = wdKvttFirstSentence(text, 40);
  const clause = sentence.split(/[，,：:]/u).map(s => s.trim()).find(s => s.length >= 5) || sentence;
  return clause.length > maxLen ? `${clause.slice(0, maxLen - 1)}…` : clause;
}

function wdKvttExtractZeroAiGlossary(segments, limit = 5) {
  const terms = new Map();
  for (const seg of segments) {
    const text = String(seg.text || '');
    // Match uppercase technical acronyms (2-10 chars) or explicitly quoted concepts 《》「」“”
    const matches = [
      ...(text.match(/\b[A-Z][A-Z0-9-]{1,9}\b/gu) || []),
      ...[...text.matchAll(/[《「“]([\u4e00-\u9fa5A-Za-z0-9]{2,12})[》」”]/gu)].map(m => m[1]),
    ];
    for (const term of matches) {
      if (terms.has(term)) continue;
      terms.set(term, {
        term,
        definition: `课程提及：${wdKvttFirstSentence(text, 34)}`,
        seconds: seg.startSec,
        timestamp: seg.timestamp,
      });
      if (terms.size >= limit) return [...terms.values()];
    }
  }
  return [...terms.values()];
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
        lines.push(`- **${escapeMarkdownText(g.term)}**：${escapeMarkdownText(g.definition)}${tsPart}`);
      }
    }
  }
  return lines.join('\n');
}

function buildZeroAiSectionTree(section, highlights = []) {
  const cues = Array.isArray(section?.cues) ? section.cues : [];
  const segmented = Array.isArray(section?.segments) && section.segments.length
    ? section.segments
    : cleanAndSegmentCues(cues).segments;
  const hasSubtitle = typeof section?.hasSubtitle === 'boolean' ? section.hasSubtitle : segmented.length > 0;
  const subtitleStatus = section?.subtitleStatus || (segmented.length > 0 ? 'ok' : 'no-subtitle');
  const subtitleReason = section?.subtitleReason || (segmented.length > 0 ? '' : '本课无字幕：该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。');
  const timeline = segmented.map(seg => ({
    index: seg.index,
    startSec: seg.startSec,
    timestamp: seg.timestamp,
    headline: wdKvttFirstSentence(seg.text, 25),
    text: seg.text,
  }));
  const base = {
    sectionId: section?.sectionId || null,
    sectionIndex: section?.sectionIndex || 1,
    chapterTitle: section?.chapterTitle || '',
    title: section?.title || `课节 ${section?.sectionIndex || 1}`,
    mode: 'zero-ai',
    source: section?.source || 'unavailable',
    hasSubtitle,
    subtitleStatus,
    subtitleReason,
    subtitleLogs: Array.isArray(section?.subtitleLogs) ? section.subtitleLogs : [],
    summary: '',
    keyPoints: [],
    outline: [],
    topics: [],
    quiz: [],
    glossary: [],
    timeline,
  };

  if (segmented.length) {
    // Converge into 2~4 compact topic groups rather than dumping every raw cue
    const maxGroups = Math.min(4, Math.max(1, Math.ceil(segmented.length / 2)));
    const groupSize = Math.ceil(segmented.length / maxGroups);
    const opening = wdKvttFirstSentence(segmented[0].text, 44);
    base.summary = `零 AI 提炼（首段摘要）：${opening}`;

    for (let i = 0; i < segmented.length; i += groupSize) {
      const slice = segmented.slice(i, i + groupSize);
      const startTs = slice[0].timestamp;
      const endTs = formatTimestamp(slice.at(-1).endMs / 1000);
      const phrase = wdKvttTopicPhrase(slice[0].text, 16);
      const topicName = phrase
        ? `${phrase}（${startTs}–${endTs}）`
        : `分段主题 ${base.outline.length + 1}（${startTs}–${endTs}）`;
      const firstSummary = wdKvttFirstSentence(slice[0].text, 25);
      base.keyPoints.push({
        text: firstSummary,
        seconds: slice[0].startSec,
        timestamp: slice[0].timestamp,
      });
      const topicObj = {
        name: topicName,
        points: slice.map(seg => ({
          text: wdKvttFirstSentence(seg.text, 25),
          seconds: seg.startSec,
          timestamp: seg.timestamp,
          excerpt: seg.text.slice(0, 140),
        })),
      };
      base.outline.push(topicObj);
    }
    // If fewer than 3 keyPoints and more segments exist, supplement up to 4
    if (base.keyPoints.length < 3 && segmented.length > base.keyPoints.length) {
      for (const seg of segmented.slice(1)) {
        if (base.keyPoints.length >= 4) break;
        const txt = wdKvttFirstSentence(seg.text, 25);
        if (!base.keyPoints.some(kp => kp.text === txt)) {
          base.keyPoints.push({ text: txt, seconds: seg.startSec, timestamp: seg.timestamp });
        }
      }
    }
    base.keyPoints = base.keyPoints.slice(0, 6);
    base.topics = base.outline;
    base.glossary = wdKvttExtractZeroAiGlossary(segmented, 5);
    base.quiz = base.outline.slice(0, 3).map(topic => ({
      question: `关于「${topic.name.replace(/（[^）]*）$/u, '')}」，本节核心讲了什么？`,
      answer: topic.points.slice(0, 2).map(p => p.text).join('；'),
      seconds: topic.points[0]?.seconds ?? null,
      timestamp: topic.points[0]?.timestamp || '',
      zeroAi: true,
    }));
    return base;
  }

  const usableHighlights = section?.active && Array.isArray(highlights) && highlights.length ? highlights : [];
  if (usableHighlights.length) {
    base.mode = 'highlight';
    base.summary = `基于平台 AI 看点整理（共 ${usableHighlights.length} 个主题分段）。`;
    base.keyPoints = usableHighlights.slice(0, 6).map(item => ({
      text: (item.title || wdKvttFirstSentence(item.desc, 25) || '看点片段').slice(0, 25),
      seconds: Number.isFinite(item.seconds) ? item.seconds : null,
      timestamp: Number.isFinite(item.seconds) ? formatTimestamp(item.seconds) : (item.timeText || ''),
    }));
    base.outline = [{
      name: '平台 AI 课程看点',
      points: usableHighlights.map(item => ({
        text: item.title || wdKvttFirstSentence(item.desc, 24) || '看点片段',
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
      headline: item.title || '看点',
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
  const overview = sections.length === 1
    ? (sections[0].summary || `零 AI 提炼：${sections[0].title}`)
    : captioned.length
      ? `零 AI 整课速览：共 ${sections.length} 节（${captioned.length} 节含字幕${skippedNoSubtitleSections.length ? `，${skippedNoSubtitleSections.length} 节无字幕已跳过` : ''}），主线覆盖 ${captioned.slice(0, 3).map(s => `《${s.title}》`).join('、')}${captioned.length > 3 ? '等' : ''}。`
      : `本课无字幕：共 ${sections.length} 节，均未检测到可用 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。`;
  const courseKeyPoints = [];
  for (const sec of captioned) {
    const top = sec.keyPoints[0];
    if (top) courseKeyPoints.push({ ...top, sectionId: sec.sectionId || 'current', sectionTitle: sec.title });
    if (courseKeyPoints.length >= 6) break;
  }
  const tree = {
    mode: 'zero-ai',
    scope,
    scopeLabel: buildScopeLabel(scope, sections),
    courseId: courseData?.courseId || null,
    activeSectionId: courseData?.activeSectionId || sections[0]?.sectionId || null,
    courseTitle: courseData?.title || '当前课程',
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

  // Shared Path 3a caption-API lookup (executed at most once per course if any section misses Paths 1 & 2)
  let captionApiCache = null;
  const loadCaptionApiOnce = async () => {
    if (captionApiCache) return captionApiCache;
    if (!courseId) {
      captionApiCache = { ok: false, url: null, status: null, reason: '当前页面未解析到 courseId，无法请求课程字幕接口', items: [] };
      return captionApiCache;
    }
    const rawRoot = String(pageWin?.app?.options?.urlRoot || '/api/v1').replace(/\/+$/u, '');
    const apiPath = `${rawRoot.startsWith('/') ? rawRoot : `/${rawRoot}`}/course-study/caption/${encodeURIComponent(courseId)}`;
    const apiUrl = new URL(apiPath, win?.location?.origin || 'https://wangda.chinamobile.com').toString();
    const safeApiUrl = redactSubtitleUrl(apiUrl);
    if (typeof httpGet !== 'function') {
      captionApiCache = { ok: false, url: safeApiUrl, status: null, reason: '当前环境未提供字幕接口请求通道（httpGet 不可用）', items: [] };
      return captionApiCache;
    }
    try {
      const parsedApi = new URL(apiUrl);
      if (parsedApi.protocol !== 'https:' || !wdKvttAllowedVttHosts(parsedApi.hostname)) {
        captionApiCache = { ok: false, url: safeApiUrl, status: null, reason: '字幕接口域名不在网大白名单内', items: [] };
        return captionApiCache;
      }
      const res = await httpGet(apiUrl, { signal, sameOrigin: parsedApi.origin === win?.location?.origin });
      const status = typeof res === 'object' && res !== null && Number.isFinite(Number(res.status)) ? Number(res.status) : 200;
      const text = typeof res === 'string' ? res : String(res?.text ?? '');
      if (status < 200 || status >= 300) {
        captionApiCache = { ok: false, url: safeApiUrl, status, reason: `课程字幕接口返回 HTTP ${status}`, items: [] };
        return captionApiCache;
      }
      if (!text.trim()) {
        captionApiCache = { ok: false, url: safeApiUrl, status, reason: '课程字幕接口返回空响应', items: [] };
        return captionApiCache;
      }
      let parsed;
      try { parsed = JSON.parse(text); } catch {
        captionApiCache = { ok: false, url: safeApiUrl, status, reason: '课程字幕接口返回非 JSON 内容', items: [] };
        return captionApiCache;
      }
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
      captionApiCache = { ok: true, url: safeApiUrl, status, reason: items.length ? `接口返回 ${items.length} 条字幕记录` : '课程字幕接口返回空列表（该课程无 AI 字幕）', items };
      return captionApiCache;
    } catch (err) {
      const status = wdKvttExtractHttpStatus(err);
      captionApiCache = {
        ok: false,
        url: safeApiUrl,
        status,
        reason: status ? `课程字幕接口请求失败（HTTP ${status}）` : `课程字幕接口请求异常（${err?.message || '网络错误'}）`,
        items: [],
      };
      return captionApiCache;
    }
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
    if (sec.cues.length && !sec.segments.length) {
      sec.segments = cleanAndSegmentCues(sec.cues).segments;
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

function seekCourseTime({ win, pageWin = win, adapter, sectionId, seconds, queueRunning = false } = {}) {
  const secNum = Number(seconds);
  if (!Number.isFinite(secNum) || secNum < 0) {
    return { ok: false, degraded: true, message: '无效的时间点，无法定位。' };
  }
  const timeText = formatTimestamp(secNum);
  const doc = win?.document;
  const page = typeof adapter?.read === 'function' ? adapter.read() : null;
  const currentSectionId = page?.activeSectionId || null;
  const isDifferentSection = Boolean(sectionId && sectionId !== 'current' && currentSectionId && sectionId !== currentSectionId);

  if (isDifferentSection) {
    if (queueRunning) {
      return { ok: false, degraded: true, message: `自动学习运行中不自动切节；请暂停后切换到对应课节定位至 ${timeText}。` };
    }
    if (typeof adapter?.selectSection === 'function' && adapter.selectSection(sectionId)) {
      return { ok: true, switchedSection: true, degraded: true, message: `已切换至目标课节，待播放器加载后可定位至 ${timeText}（如未自动跳转请再点一次时间戳）。` };
    }
    return { ok: false, degraded: true, message: `目标时间点 ${timeText} 位于其他课节，请手动切节后定位至 ${timeText}。` };
  }

  // 1. Platform native askbar event bus (verified in study.js: seekHighlightPoint -> study.player.seek)
  try {
    if (typeof pageWin?.app?.askbar?.trigger === 'function') {
      pageWin.app.askbar.trigger('study.player.seek', secNum);
      return { ok: true, method: 'askbar', message: `已尝试定位播放至 ${timeText}` };
    }
  } catch { /* fall through */ }

  // 2. Active in-DOM Video.js player instance
  try {
    const vjs = resolveActiveVjsPlayer(pageWin, doc)?.player;
    if (vjs && typeof vjs.currentTime === 'function') {
      vjs.currentTime(secNum);
      return { ok: true, method: 'videojs', message: `已定位播放器至 ${timeText}` };
    }
  } catch { /* fall through */ }

  // 3. Visible native HTMLMediaElement
  try {
    const media = [...(doc?.querySelectorAll?.('video,audio') || [])].find(el => el.isConnected && !el.hidden);
    if (media && Number.isFinite(media.duration || 0)) {
      media.currentTime = secNum;
      return { ok: true, method: 'html5-media', message: `已定位媒体至 ${timeText}` };
    }
  } catch { /* fall through */ }

  return { ok: false, degraded: true, message: `当前页未检测到可定位播放器，时间点：${timeText}` };
}



const WD_AI_STORAGE_KEYS = {
  config: 'wangda-assistant.ai.config',
  apiKey: 'wangda-assistant.ai.apiKey',
  cache: 'wangda-assistant.ai.cache.v1',
};

const WD_AI_PRIVACY_NOTICE = '安全说明：API Key 仅保存在当前浏览器 localStorage（wangda-assistant.ai.apiKey），仅存本地、不上传、不经过任何我们自己的服务器；仅在您主动点击分析时直连您配置的 Base URL。';

const WD_AI_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: '实测：支持 CORS 且国内直连可用' },
  { id: 'dashscope', label: '通义千问 (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', note: '实测：支持 CORS 且国内直连可用' },
  { id: 'openai', label: 'OpenAI (官方/兼容)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', note: '实测：支持 CORS，但国内无代理超时，建议填中转 Base URL' },
  { id: 'gemini', label: 'Gemini (OpenAI兼容)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', note: '实测：支持 CORS，但国内无代理超时，建议填中转 Base URL' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', note: '实测：支持 CORS 且可直连；线路波动时可换中转' },
  { id: 'moonshot', label: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', note: '实测：支持 CORS 且国内直连可用' },
  { id: 'siliconflow', label: 'SiliconFlow (硅基流动)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', note: '实测：支持 CORS 且国内直连可用' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', note: '实测：官方端拦截页面 CORS，需走 GM_xmlhttpRequest 或自填中转 URL' },
  { id: 'ollama', label: '本地 Ollama / 兼容网关', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', note: '实测：HTTPS 页面允许回环 127.0.0.1，需开启 CORS 或走 GM 通道' },
  { id: 'custom', label: '自定义 OpenAI 兼容中转', baseUrl: '', model: '', note: '自行填写中转 Base URL 与模型名（兼容 /v1 或完整 /chat/completions）' },
];

const wdKaiDefaultConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  transport: 'auto',
};
const wdKaiMaxCacheEntries = 20;

function wdKaiLocalStorage(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

function getAiProviderPreset(providerId) {
  return WD_AI_PROVIDERS.find(item => item.id === providerId) || WD_AI_PROVIDERS[0];
}

function loadAiSettings(win) {
  const ls = wdKaiLocalStorage(win);
  let parsed = {};
  try {
    const raw = ls?.getItem?.(WD_AI_STORAGE_KEYS.config);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') parsed = obj;
    }
  } catch {
    parsed = {};
  }
  const provider = WD_AI_PROVIDERS.some(p => p.id === parsed.provider) ? parsed.provider : wdKaiDefaultConfig.provider;
  const preset = getAiProviderPreset(provider);
  const transport = ['auto', 'gm', 'fetch'].includes(parsed.transport) ? parsed.transport : 'auto';
  const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : preset.baseUrl;
  const model = typeof parsed.model === 'string' ? parsed.model.trim() : preset.model;
  let apiKey = '';
  try {
    apiKey = String(ls?.getItem?.(WD_AI_STORAGE_KEYS.apiKey) || '').trim();
  } catch {
    apiKey = '';
  }
  return { provider, baseUrl, model, transport, apiKey };
}

function saveAiSettings(win, input) {
  const ls = wdKaiLocalStorage(win);
  if (!ls || typeof ls.setItem !== 'function') return { ok: false, error: '浏览器 localStorage 不可用。' };
  const current = loadAiSettings(win);
  const provider = WD_AI_PROVIDERS.some(p => p.id === input?.provider) ? input.provider : current.provider;
  const baseUrl = typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : current.baseUrl;
  const model = typeof input?.model === 'string' ? input.model.trim() : current.model;
  const transport = ['auto', 'gm', 'fetch'].includes(input?.transport) ? input.transport : current.transport;
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : current.apiKey;
  try {
    ls.setItem(WD_AI_STORAGE_KEYS.config, JSON.stringify({ provider, baseUrl, model, transport }));
    if (apiKey) ls.setItem(WD_AI_STORAGE_KEYS.apiKey, apiKey);
    else ls.removeItem(WD_AI_STORAGE_KEYS.apiKey);
    return { ok: true, settings: { provider, baseUrl, model, transport, apiKey } };
  } catch {
    return { ok: false, error: '写入 localStorage 失败，请检查浏览器存储权限。' };
  }
}

function clearAiApiKey(win) {
  const ls = wdKaiLocalStorage(win);
  try {
    ls?.removeItem?.(WD_AI_STORAGE_KEYS.apiKey);
    return { ok: true };
  } catch {
    return { ok: false, error: '清空本地 Key 失败。' };
  }
}

function buildKnowledgeCacheKey(courseId, scope = 'course', sectionId = null) {
  const cid = String(courseId || 'unknown').trim() || 'unknown';
  if (scope === 'section') {
    const sid = String(sectionId || 'current').trim() || 'current';
    return `${cid}::section::${sid}`;
  }
  return `${cid}::course`;
}

function wdKaiReadCacheMap(win) {
  const ls = wdKaiLocalStorage(win);
  try {
    const raw = ls?.getItem?.(WD_AI_STORAGE_KEYS.cache);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function wdKaiWriteCacheMap(win, map) {
  const ls = wdKaiLocalStorage(win);
  if (!ls || typeof ls.setItem !== 'function') return false;
  const entries = Object.entries(map)
    .filter(([, v]) => v && typeof v === 'object' && v.tree)
    .sort((a, b) => (Number(b[1].cachedAt) || 0) - (Number(a[1].cachedAt) || 0));
  for (let limit = Math.min(entries.length, wdKaiMaxCacheEntries); limit >= 1; limit -= 1) {
    try {
      const pruned = Object.fromEntries(entries.slice(0, limit));
      ls.setItem(WD_AI_STORAGE_KEYS.cache, JSON.stringify(pruned));
      return true;
    } catch { /* quota exceeded -> evict oldest and retry */ }
  }
  return false;
}

function loadKnowledgeCache(win, key) {
  if (!key) return null;
  const map = wdKaiReadCacheMap(win);
  const entry = map[key];
  if (!entry || typeof entry !== 'object' || !entry.tree || typeof entry.markdown !== 'string') return null;
  return entry;
}

function saveKnowledgeCache(win, key, entry) {
  if (!key || !entry?.tree) return false;
  const map = wdKaiReadCacheMap(win);
  map[key] = {
    cachedAt: Date.now(),
    provider: entry.provider || '',
    model: entry.model || '',
    scope: entry.scope || 'course',
    tree: entry.tree,
    markdown: entry.markdown || buildKnowledgeMarkdown(entry.tree),
    usedAi: Boolean(entry.usedAi),
    fallback: Boolean(entry.fallback),
    failedSections: Array.isArray(entry.failedSections) ? entry.failedSections : [],
    channel: entry.channel || null,
  };
  return wdKaiWriteCacheMap(win, map);
}

function clearKnowledgeCache(win, key = null) {
  const ls = wdKaiLocalStorage(win);
  if (!ls) return false;
  try {
    if (!key) { ls.removeItem(WD_AI_STORAGE_KEYS.cache); return true; }
    const map = wdKaiReadCacheMap(win);
    delete map[key];
    ls.setItem(WD_AI_STORAGE_KEYS.cache, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

function buildChatCompletionsUrl(baseUrl) {
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
  const cleanPath = url.pathname.replace(/\/+$/u, '');
  url.pathname = /\/chat\/completions$/iu.test(cleanPath) ? cleanPath : `${cleanPath}/chat/completions`;
  return url.toString();
}

function wdKaiMapHttpError(status, bodyText) {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.message || '';
  } catch {
    detail = '';
  }
  if (status === 401 || status === 403) return `API Key 无效或无权限（HTTP ${status}${detail ? `：${detail.slice(0, 80)}` : ''}）`;
  if (status === 402) return `账户余额不足或额度已耗尽（HTTP 402${detail ? `：${detail.slice(0, 80)}` : ''}）`;
  if (status === 429) return `请求受限或额度耗尽（HTTP 429${detail ? `：${detail.slice(0, 80)}` : ''}）`;
  if (status === 404) return `接口地址或模型不存在（HTTP 404），请检查 Base URL 与模型名`;
  if (status >= 500) return `服务商暂时异常（HTTP ${status}）`;
  return `接口返回错误（HTTP ${status}${detail ? `：${detail.slice(0, 80)}` : ''}）`;
}

function wdKaiGmRequest(gmRequest, { url, method = 'GET', headers = {}, body = null, timeoutMs = 45000, signal, anonymous = true }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('用户已取消请求')); return; }
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
      finish(reject, new Error('用户已取消请求'));
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
        onerror: err => finish(reject, new Error(`GM_xmlhttpRequest 网络错误${err?.error ? `（${err.error}）` : ''}`)),
        ontimeout: () => finish(reject, new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`)),
        onabort: () => finish(reject, new Error('请求已中止')),
      });
    } catch (err) {
      finish(reject, new Error(`GM_xmlhttpRequest 调用失败：${err?.message || err}`));
    }
  });
}

async function wdKaiFetchRequest(fetchFn, { url, method = 'GET', headers = {}, body = null, timeoutMs = 45000, signal, credentials = 'omit' }) {
  if (typeof fetchFn !== 'function') throw new Error('当前环境不支持页面 fetch');
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
    if (timedOut) throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`);
    if (signal?.aborted) throw new Error('用户已取消请求');
    throw new Error(`页面 fetch 失败（可能是 CORS 拦截或网络不可达）：${err?.message || err}`);
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
    if (!hasGm) throw new Error('当前环境未提供 GM_xmlhttpRequest，请在设置中切换为「自动」或「页面 fetch」');
    return wdKaiGmRequest(gmRequest, { url, method, headers, body, timeoutMs, signal, anonymous: true });
  }
  if (transport === 'fetch') {
    return wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
  }
  if (hasGm) {
    try {
      return await wdKaiGmRequest(gmRequest, { url, method, headers, body, timeoutMs, signal, anonymous: true });
    } catch (gmErr) {
      if (signal?.aborted || !hasFetch) throw gmErr;
      try {
        return await wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
      } catch {
        throw gmErr;
      }
    }
  }
  return wdKaiFetchRequest(fetchFn, { url, method, headers, body, timeoutMs, signal, credentials: 'omit' });
}

function buildSectionPrompt(courseTitle, section, segments, chunkInfo = null) {
  const isChunk = Boolean(chunkInfo && chunkInfo.total > 1);
  const chunkHint = isChunk ? `（第 ${chunkInfo.index}/${chunkInfo.total} 分段）` : '';
  const transcript = segments.map(seg => `[${seg.timestamp}] ${seg.text}`).join('\n');
  const system = [
    '你是资深企业课程学习教练。请根据带时间戳的课程字幕，产出一份让学员「花 2 分钟就能看懂并自检是否学会」的结构化学习卡片。',
    '只输出合法 JSON，不要任何前言、解释或额外文字。',
    'JSON Schema：',
    '{"summary":"一句话讲清本节核心结论与收获(<=50字)","keyPoints":[{"text":"白话结论要点(<=25字，不要复述标题)","time":"mm:ss"}],"outline":[{"name":"二级主题(<=16字，收敛为2~5组)","points":[{"text":"三级知识点短语(<=20字)","time":"mm:ss"}]}],"quiz":[{"question":"基于核心要点的自测问题？","answer":"1~2句简洁参考答案","time":"mm:ss"}],"glossary":[{"term":"专有名词/缩写","definition":"一句话通俗解释(<=35字)","time":"mm:ss"}]}',
    '约束：',
    isChunk
      ? '1. 当前为长课节的子分段：summary 写本段一句话核心结论；keyPoints 给 2~3 条；outline 给 1~3 组主题；quiz 给 1~2 题；glossary 抽取本段专有名词（无则空数组）；'
      : '1. keyPoints 严格 3~6 条白话结论（每条 <=25 字，讲清结论不要目录式复述标题）；outline 收敛为 2~5 个二级主题，每组 2~6 条知识点；quiz 给 3~5 个检验是否学会的问题；glossary 抽取 0~6 个关键专有名词；',
    '2. 所有 time 必须取自输入字幕首次出现的时间戳（mm:ss 或 hh:mm:ss）；',
    '3. 严格忠于字幕原文，禁止编造原文未提及的概念或结论；禁止出现「其他/杂项」。',
  ].join('\n');
  const user = `课程：《${courseTitle || '当前课程'}》\n课节：第 ${section.sectionIndex || 1} 节《${section.title || '当前课节'}》${chunkHint}\n\n字幕分段：\n${transcript}`;
  return { system, user };
}

function buildSectionChunkAggregationPrompt(courseTitle, section, chunkPayloads) {
  const digest = chunkPayloads.map((c, idx) => {
    const pts = (c.keyPoints || []).map(p => `${p.text}(${p.timestamp || ''})`).join('；');
    const topics = (c.outline || []).map(t => `${t.name}: ${(t.points || []).map(p => `${p.text}(${p.timestamp || ''})`).join('、')}`).join(' | ');
    return `分段${idx + 1} 摘要：${c.summary || ''}\n  要点：${pts}\n  主题：${topics}`;
  }).join('\n');
  const system = [
    '你是课程学习卡片聚合助手。下面是一节较长课程各个分段的初步提炼结果，请去重收敛为一份完整、易速览的单节学习 JSON（不要任何额外说明）。',
    'JSON Schema：{"summary":"整节一句话核心结论(<=50字)","keyPoints":[{"text":"核心结论要点(<=25字)","time":"mm:ss"}],"outline":[{"name":"二级主题(<=16字，收敛为3~5组)","points":[{"text":"三级知识点(<=20字)","time":"mm:ss"}]}],"quiz":[{"question":"自测问题？","answer":"简洁参考答案","time":"mm:ss"}],"glossary":[{"term":"术语","definition":"一句话解释(<=35字)","time":"mm:ss"}]}',
    '要求：keyPoints 收敛为 3~6 条；quiz 收敛为 3~5 题；保留原 mm:ss 时间戳。',
  ].join('\n');
  return { system, user: `课程：《${courseTitle}》\n课节：《${section.title}》\n\n各分段结果：\n${digest}` };
}

function buildCourseAggregationPrompt(courseTitle, sectionTrees) {
  const digest = sectionTrees.map(sec => {
    const kps = (sec.keyPoints || []).slice(0, 4).map(p => `${p.text}(${p.timestamp || ''})`).join('；');
    const lines = (sec.outline || sec.topics || []).map(t => `  - ${t.name}: ${(t.points || []).map(p => `${p.text}(${p.timestamp || ''})`).join('；')}`);
    return `课节ID=${sec.sectionId} 《${sec.title}》\n  一句话概览：${sec.summary || ''}\n  核心要点：${kps}\n${lines.join('\n')}`;
  }).join('\n');
  const system = [
    '你是课程知识体系聚合助手。下面是一门课各课节的提炼结果，请输出整门课级总览与去重后的知识地图 JSON（只输出 JSON）。',
    'JSON 格式：{"overview":"一句话全课核心概要(<=60字)","keyPoints":[{"text":"全课核心结论(<=25字)","sectionId":"原sectionId","time":"mm:ss"}],"sections":[{"sectionId":"原sectionId","summary":"该节一句话概览","outline":[{"name":"二级主题","points":[{"text":"知识点短语(<=20字)","time":"mm:ss"}]}]}]}',
    '要求：全课 keyPoints 选 3~6 条最核心结论并保留原 sectionId 与 mm:ss 时间戳。',
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

function wdKaiNormalizePoint(pt) {
  if (typeof pt === 'string') {
    const text = pt.trim();
    return text ? { text, seconds: null, timestamp: '' } : null;
  }
  if (!pt || typeof pt !== 'object') return null;
  const text = String(pt.text || pt.point || pt.content || pt.title || pt.summary || '').trim();
  if (!text) return null;
  const sec = parseTimestampToSeconds(pt.time ?? pt.timestamp ?? pt.seconds);
  const sectionId = pt.sectionId ? String(pt.sectionId) : undefined;
  return {
    text,
    seconds: sec === null ? null : Math.floor(sec),
    timestamp: sec === null ? '' : formatTimestamp(sec),
    ...(sectionId ? { sectionId } : {}),
  };
}

function wdKaiNormalizeOutline(rawTopics) {
  if (!Array.isArray(rawTopics)) return [];
  const topics = [];
  for (const item of rawTopics) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || item.title || item.topic || item.chapter || '').trim();
    const rawPoints = Array.isArray(item.points) ? item.points
      : Array.isArray(item.items) ? item.items
      : Array.isArray(item.children) ? item.children : [];
    const points = rawPoints.map(wdKaiNormalizePoint).filter(Boolean);
    if (name && points.length) topics.push({ name, points });
    else if (name) topics.push({ name, points: [{ text: name, seconds: null, timestamp: '' }] });
  }
  return topics;
}

function wdKaiNormalizeQuiz(rawQuiz) {
  if (!Array.isArray(rawQuiz)) return [];
  const items = [];
  for (const q of rawQuiz) {
    if (!q || typeof q !== 'object') continue;
    const question = String(q.question || q.q || q.prompt || '').trim();
    const answer = String(q.answer || q.a || q.explanation || '').trim();
    if (!question || !answer) continue;
    const sec = parseTimestampToSeconds(q.time ?? q.timestamp ?? q.seconds);
    items.push({
      question,
      answer,
      seconds: sec === null ? null : Math.floor(sec),
      timestamp: sec === null ? '' : formatTimestamp(sec),
    });
  }
  return items.slice(0, 6);
}

function wdKaiNormalizeGlossary(rawGlossary) {
  if (!Array.isArray(rawGlossary)) return [];
  const seen = new Set();
  const items = [];
  for (const g of rawGlossary) {
    if (!g || typeof g !== 'object') continue;
    const term = String(g.term || g.name || g.word || g.concept || '').trim();
    const definition = String(g.definition || g.desc || g.explain || g.meaning || '').trim();
    if (!term || !definition || seen.has(term)) continue;
    seen.add(term);
    const sec = parseTimestampToSeconds(g.time ?? g.timestamp ?? g.seconds);
    items.push({
      term,
      definition,
      seconds: sec === null ? null : Math.floor(sec),
      timestamp: sec === null ? '' : formatTimestamp(sec),
    });
  }
  return items.slice(0, 8);
}

function normalizeSectionStudyPayload(data) {
  if (!data || typeof data !== 'object') throw new Error('模型返回结构无效');
  const outline = wdKaiNormalizeOutline(data.outline ?? data.topics ?? data.chapters);
  const rawKeyPoints = Array.isArray(data.keyPoints) ? data.keyPoints
    : Array.isArray(data.key_points) ? data.key_points
    : Array.isArray(data.highlights) ? data.highlights
    : Array.isArray(data.takeaways) ? data.takeaways : [];
  let keyPoints = rawKeyPoints.map(wdKaiNormalizePoint).filter(Boolean).slice(0, 6);
  const quiz = wdKaiNormalizeQuiz(data.quiz ?? data.questions ?? data.qa ?? data.selfCheck);
  const glossary = wdKaiNormalizeGlossary(data.glossary ?? data.terms ?? data.concepts);
  let summary = String(data.summary || data.oneLineSummary || data.overview || '').trim();

  if (!outline.length && !keyPoints.length && !summary) {
    throw new Error('模型未返回有效的摘要、要点或大纲内容');
  }
  if (!keyPoints.length && outline.length) {
    for (const topic of outline) {
      const first = topic.points[0];
      if (first) keyPoints.push({ text: first.text.slice(0, 25), seconds: first.seconds, timestamp: first.timestamp });
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
  const endpoint = buildChatCompletionsUrl(settings.baseUrl);
  if (!settings.model) throw new Error('未填写模型名');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };
  const payload = JSON.stringify({
    model: settings.model,
    temperature: 0.2,
    messages,
  });
  const res = await sendAiHttpRequest({
    transport: settings.transport,
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
    throw new Error(wdKaiMapHttpError(res.status, res.text));
  }
  let envelope;
  try {
    envelope = JSON.parse(res.text);
  } catch {
    throw new Error('接口响应体不是合法 JSON（请检查 Base URL 是否指向兼容 /chat/completions 端点）');
  }
  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('接口响应缺少 choices[0].message.content');
  }
  return { data: parseStrictJsonContent(content), channel: res.channel };
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
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: '未配置 API Key，已使用零 AI 默认导览。' });
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
    buildChatCompletionsUrl(settings.baseUrl);
  } catch (err) {
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: `AI 配置无效（${err.message}），已回退到零 AI 导览。` });
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
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: '未填写模型名，已回退到零 AI 导览。' });
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
    const segments = Array.isArray(sec.segments) && sec.segments.length
      ? sec.segments
      : cleanAndSegmentCues(sec.cues || []).segments;
    const zeroSec = buildZeroAiSectionTree(sec, highlights);

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
      const prompt = buildSectionPrompt(courseData.title, sec, chunks[c], { index: c + 1, total: chunks.length });
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
        chunkPayloads.push(normalizeSectionStudyPayload(data));
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
            const aggPrompt = buildSectionChunkAggregationPrompt(courseData.title, sec, chunkPayloads);
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
            finalPayload = normalizeSectionStudyPayload(data);
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
      failedSections.push({ sectionId: sec.sectionId, title: sec.title, reason: sectionError || 'AI 解析失败' });
      warnings.push(`课节「${sec.title}」AI 分析失败（${sectionError}），已回退零 AI 速览`);
      resultSections.push(zeroSec);
    }
  }

  const skippedSummary = skippedNoSubtitleSections.length
    ? `批量处理已跳过 ${skippedNoSubtitleSections.length} 个无字幕课节：${skippedNoSubtitleSections.map(s => `《${s.title}》`).join('、')}。`
    : '';
  if (skippedSummary && !warnings.includes(skippedSummary)) warnings.push(skippedSummary);

  // If NO section succeeded with AI at all, cleanly return full zero-AI fallback with reason
  if (aiSuccessCount === 0) {
    const reason = firstError
      ? `AI 分析失败（${firstError}），已自动回退到零 AI 导览。`
      : '本课无字幕：当前范围暂无可用 AI 字幕正文，无法生成时间轴导览、问答与出题。';
    const zero = buildZeroAiGuide(courseData, { scope, sectionId: targetSectionId, fallbackReason: reason });
    if (targetSections.length > 1) zero.tree.warnings = [...new Set([...zero.tree.warnings, ...warnings])];
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
    : captionedResultSections.filter(s => s.summary).map(s => `《${s.title}》${s.summary}`).slice(0, 2).join('；');
  let courseKeyPoints = [];
  for (const sec of captionedResultSections) {
    if (sec.keyPoints?.[0]) {
      courseKeyPoints.push({ ...sec.keyPoints[0], sectionId: sec.sectionId || 'current', sectionTitle: sec.title });
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
      if (typeof data.overview === 'string' && data.overview.trim()) overview = data.overview.trim();
      const rawCourseKps = Array.isArray(data.keyPoints) ? data.keyPoints.map(wdKaiNormalizePoint).filter(Boolean).slice(0, 6) : [];
      if (rawCourseKps.length) courseKeyPoints = rawCourseKps;
      if (Array.isArray(data.sections)) {
        const byId = new Map(data.sections.map(s => [String(s?.sectionId || ''), s]));
        for (const sec of resultSections) {
          if (sec.mode !== 'ai') continue;
          const updated = byId.get(String(sec.sectionId || ''));
          if (typeof updated?.summary === 'string' && updated.summary.trim()) sec.summary = updated.summary.trim();
          const nextOutline = wdKaiNormalizeOutline(updated?.outline ?? updated?.topics);
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
    fallbackReason: failedSections.length ? `部分课节（${failedSections.length} 节）AI 失败，已局部回退零 AI 速览。` : '',
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

function createKnowledgeService({ win, pageWin = win, controller, adapter, gmRequest, fetchFn } = {}) {
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
  let lastCourseData = null;

  const findCachedForData = (data, preferredScope = null, sectionId = null) => {
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
      if (hit?.usedAi) return { key, hit };
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
    getSettings: () => loadAiSettings(win),
    saveSettings: next => saveAiSettings(win, next),
    clearApiKey: () => clearAiApiKey(win),
    clearCache: key => clearKnowledgeCache(win, key),
    abort() {
      try { activeAbort?.abort?.(); } catch { /* ignore */ }
      activeAbort = null;
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
      this.abort();
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

        // Instant open from localStorage cache when available (only when target scope actually has subtitles)
        const targetScopeHasSubtitle = effectiveScope === 'section'
          ? Boolean(data.sections.find(s => s.sectionId === focusSecId)?.hasSubtitle !== false && data.captionedSections > 0)
          : data.captionedSections > 0;
        if (!forceRefresh && targetScopeHasSubtitle && (useAi || preferCacheOnOpen)) {
          const cached = findCachedForData(data, useAi ? effectiveScope : (sectionId ? 'section' : null), focusSecId);
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

        const settings = loadAiSettings(win);
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
    seek({ sectionId, seconds }) {
      const state = controller?.getState?.();
      const queueRunning = Boolean(state && ['running', 'preparing', 'waiting'].includes(state.status));
      return seekCourseTime({ win, pageWin, adapter, sectionId, seconds, queueRunning });
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
  qa: 'wangda-assistant.ai.qa.v1',
  quiz: 'wangda-assistant.ai.quiz.v1',
};

const wdKtutMaxStoredSections = 30;
const wdKtutMaxMessagesPerSection = 24;
const wdKtutHistoryTurnsForPrompt = 6;
const wdKtutStyleId = 'wd-section-guide-entry-style';

function wdKtutStorage(win) {
  try { return win?.localStorage || null; } catch { return null; }
}

function buildTutorSectionKey(courseId, sectionId) {
  const cid = String(courseId || 'unknown').trim() || 'unknown';
  const sid = String(sectionId || 'current').trim() || 'current';
  return `${cid}::${sid}`;
}

function wdKtutReadStore(win, storageKey) {
  const ls = wdKtutStorage(win);
  try {
    const raw = ls?.getItem?.(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function wdKtutWriteStore(win, storageKey, map) {
  const ls = wdKtutStorage(win);
  if (!ls || typeof ls.setItem !== 'function') return false;
  const entries = Object.entries(map)
    .filter(([, v]) => v && typeof v === 'object')
    .sort((a, b) => (Number(b[1].updatedAt || b[1].cachedAt) || 0) - (Number(a[1].updatedAt || a[1].cachedAt) || 0));
  for (let limit = Math.min(entries.length, wdKtutMaxStoredSections); limit >= 1; limit -= 1) {
    try {
      ls.setItem(storageKey, JSON.stringify(Object.fromEntries(entries.slice(0, limit))));
      return true;
    } catch { /* evict oldest entry on quota error */ }
  }
  return false;
}

function loadSectionChat(win, courseId, sectionId) {
  const key = buildTutorSectionKey(courseId, sectionId);
  const entry = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.qa)[key];
  if (!entry || !Array.isArray(entry.messages)) return { key, messages: [], updatedAt: null };
  return { key, messages: entry.messages, updatedAt: entry.updatedAt || null };
}

function saveSectionChat(win, courseId, sectionId, messages) {
  const key = buildTutorSectionKey(courseId, sectionId);
  const map = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.qa);
  const trimmed = (Array.isArray(messages) ? messages : []).slice(-wdKtutMaxMessagesPerSection);
  map[key] = { updatedAt: Date.now(), messages: trimmed };
  return wdKtutWriteStore(win, WD_TUTOR_STORAGE_KEYS.qa, map);
}

function clearSectionChat(win, courseId, sectionId) {
  const ls = wdKtutStorage(win);
  if (!ls) return false;
  const key = buildTutorSectionKey(courseId, sectionId);
  const map = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.qa);
  delete map[key];
  try { ls.setItem(WD_TUTOR_STORAGE_KEYS.qa, JSON.stringify(map)); return true; } catch { return false; }
}

function loadSectionQuiz(win, courseId, sectionId) {
  const key = buildTutorSectionKey(courseId, sectionId);
  const entry = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.quiz)[key];
  if (!entry || !Array.isArray(entry.questions) || !entry.questions.length) return null;
  return entry;
}

function saveSectionQuiz(win, courseId, sectionId, quizRecord) {
  const key = buildTutorSectionKey(courseId, sectionId);
  const map = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.quiz);
  map[key] = { ...quizRecord, updatedAt: Date.now() };
  return wdKtutWriteStore(win, WD_TUTOR_STORAGE_KEYS.quiz, map);
}

function clearSectionQuiz(win, courseId, sectionId) {
  const ls = wdKtutStorage(win);
  if (!ls) return false;
  const key = buildTutorSectionKey(courseId, sectionId);
  const map = wdKtutReadStore(win, WD_TUTOR_STORAGE_KEYS.quiz);
  delete map[key];
  try { ls.setItem(WD_TUTOR_STORAGE_KEYS.quiz, JSON.stringify(map)); return true; } catch { return false; }
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
  const rawSegments = Array.isArray(section?.segments) && section.segments.length
    ? section.segments
    : Array.isArray(section?.timeline) && section.timeline.length
      ? section.timeline.map((t, idx) => ({
        index: t.index || idx + 1,
        startSec: Number.isFinite(t.startSec) ? t.startSec : 0,
        timestamp: t.timestamp || formatTimestamp(t.startSec || 0),
        text: t.text || t.headline || '',
      }))
      : cleanAndSegmentCues(section?.cues || []).segments;

  const headerLines = [];
  if (section?.summary) headerLines.push(`【课节概览】${section.summary}`);
  if (Array.isArray(section?.keyPoints) && section.keyPoints.length) {
    headerLines.push(`【核心要点】${section.keyPoints.map(k => `${k.text}${k.timestamp ? `(${k.timestamp})` : ''}`).join('；')}`);
  }
  const outline = Array.isArray(section?.outline) && section.outline.length ? section.outline : (section?.topics || []);
  if (outline.length) {
    headerLines.push(`【知识点大纲】${outline.map(t => `${t.name}: ${(t.points || []).map(p => `${p.text}${p.timestamp ? `(${p.timestamp})` : ''}`).join('、')}`).join(' | ')}`);
  }
  const headerText = headerLines.join('\n').slice(0, Math.floor(maxContextChars * 0.25));
  const segBudget = Math.max(800, maxContextChars - headerText.length - 80);

  const formatted = rawSegments.map((seg, idx) => {
    const startSec = Number.isFinite(seg.startSec) ? Math.floor(seg.startSec) : Math.floor((Number(seg.startMs) || 0) / 1000);
    const ts = seg.timestamp || formatTimestamp(startSec);
    const minute = Math.floor(startSec / 60) + 1;
    const line = `[${ts} · 约第${minute}分钟] ${String(seg.text || '').trim()}`;
    return { idx, startSec, ts, line, textLower: String(seg.text || '').toLowerCase() };
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
  const contextText = [headerText, '【带时间戳字幕片段】', transcriptBlock].filter(Boolean).join('\n\n');
  return {
    contextText,
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
  for (const m of String(text ?? '').matchAll(/(?<!\d)(\d{1,2}:\d{2}(?::\d{2})?)(?!\d)/gu)) {
    const sec = parseTimestampToSeconds(m[1]);
    if (sec === null) continue;
    const floorSec = Math.floor(sec);
    if (seen.has(floorSec)) continue;
    seen.add(floorSec);
    out.push({
      seconds: floorSec,
      timestamp: formatTimestamp(floorSec),
      minuteLabel: `约第 ${Math.floor(floorSec / 60) + 1} 分钟`,
      note: '',
    });
  }
  return out;
}

function wdKtutNormalizeCitations(rawCitations, answerText) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(rawCitations)) {
    for (const c of rawCitations) {
      if (!c) continue;
      const rawTime = typeof c === 'string' ? c : (c.time ?? c.timestamp ?? c.seconds);
      const sec = parseTimestampToSeconds(rawTime);
      if (sec === null) continue;
      const floorSec = Math.floor(sec);
      if (seen.has(floorSec)) continue;
      seen.add(floorSec);
      out.push({
        seconds: floorSec,
        timestamp: formatTimestamp(floorSec),
        minuteLabel: `约第 ${Math.floor(floorSec / 60) + 1} 分钟`,
        note: typeof c === 'object' ? String(c.note || c.reason || c.excerpt || '').trim().slice(0, 40) : '',
      });
    }
  }
  for (const item of extractTimestampsFromText(answerText)) {
    if (seen.has(item.seconds)) continue;
    seen.add(item.seconds);
    out.push(item);
  }
  return out.slice(0, 6);
}

function buildSectionQaMessages({ courseTitle, section, contextText, history = [], question }) {
  const system = [
    '你是网大课程的课节级学习问答助教。请严格依据下方提供的「本课节知识点与带时间戳字幕片段」回答学员问题。',
    '核心要求：',
    '1. 严禁凭空编造课程未讲过的内容；若字幕中未提及，请直接说明「本课节字幕未提及该内容」，不要瞎编；',
    '2. 回答必须标注依据大约在视频第几分钟以及精确 mm:ss 时间点（例如：「约第 2 分钟 (01:50)」）；',
    '3. 优先输出合法 JSON（无多余前后缀）：{"answer":"简明易懂的中文回答，文内引用 (mm:ss)","citations":[{"time":"mm:ss","note":"依据简述(<=24字)"}]}；',
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
  const endpoint = buildChatCompletionsUrl(settings.baseUrl);
  if (!settings.model?.trim()) throw new Error('未填写模型名');
  const res = await sendAiHttpRequest({
    transport: settings.transport,
    gmRequest,
    fetchFn,
    url: endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({ model: settings.model, temperature: 0.25, messages }),
    timeoutMs,
    signal,
  });
  if (res.status < 200 || res.status >= 300) {
    let detail = '';
    try { const obj = JSON.parse(res.text); detail = obj?.error?.message || obj?.message || ''; } catch { detail = ''; }
    if (res.status === 401 || res.status === 403) throw new Error(`API Key 无效或无权限（HTTP ${res.status}${detail ? `：${detail.slice(0, 80)}` : ''}）`);
    if (res.status === 402 || res.status === 429) throw new Error(`额度耗尽或请求受限（HTTP ${res.status}${detail ? `：${detail.slice(0, 80)}` : ''}）`);
    throw new Error(`接口返回错误（HTTP ${res.status}${detail ? `：${detail.slice(0, 80)}` : ''}）`);
  }
  let envelope;
  try { envelope = JSON.parse(res.text); } catch { throw new Error('接口响应体不是合法 JSON'); }
  const content = envelope?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型未返回有效回答内容');
  return { content: content.trim(), channel: res.channel };
}

async function askSectionQuestion({ win, courseTitle, courseId, section, question, settings, gmRequest, fetchFn, signal, maxContextChars = 7500, timeoutMs = 45000 }) {
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
  try { buildChatCompletionsUrl(cfg.baseUrl); } catch (err) {
    return { ok: false, needsAiConfig: true, error: `AI 配置无效（${err.message}），请检查「AI 设置」。` };
  }
  if (!cfg.model?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先在「AI 设置」中填写模型名。' };
  }

  const sectionId = section?.sectionId || 'current';
  const stored = loadSectionChat(win, courseId, sectionId);
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
      // Graceful plain-text fallback: keep full answer text & extract mm:ss timestamps
    }
    const citations = wdKtutNormalizeCitations(rawCitations, answer);
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
    const nextMessages = [...stored.messages, userMsg, assistantMsg].slice(-wdKtutMaxMessagesPerSection);
    saveSectionChat(win, courseId, sectionId, nextMessages);
    return { ok: true, message: assistantMsg, messages: nextMessages, contextMeta: assistantMsg.contextMeta, channel };
  } catch (err) {
    return { ok: false, error: `AI 提问失败：${err?.message || err}` };
  }
}

function buildSectionQuizPrompt({ courseTitle, section, contextText }) {
  const system = [
    '你是企业培训课程出题教练。请严格根据下方本课节知识点与带时间戳字幕，出 4 道高质量自测题（默认 2~3 道单选题 + 1~2 道简答题，总题数 3~5 题）。',
    '只输出合法 JSON，不要任何前言或解释。',
    'JSON Schema：',
    '{"questions":[{"type":"choice","question":"单选题干？","options":["A. 选项一","B. 选项二","C. 选项三","D. 选项四"],"correctIndex":0,"explanation":"解析并说明约在视频第几分钟讲到","time":"mm:ss"},{"type":"short","question":"简答题干？","referenceAnswer":"简洁参考答案要点","explanation":"解析与视频定位依据","time":"mm:ss"}]}',
    '规则：',
    '1. 题目必须紧扣本课节核心知识点，不得编造字幕未提及的考点；',
    '2. 每道选择题必须恰好 4 个清晰选项且 correctIndex 为 0~3 的整数；',
    '3. 每道题必须附带对应视频时间点 time (mm:ss) 与简明解析。',
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

function normalizeQuizPaper(data) {
  const rawList = Array.isArray(data?.questions) ? data.questions
    : Array.isArray(data?.quiz) ? data.quiz
    : Array.isArray(data?.items) ? data.items : [];
  const questions = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const qText = String(item.question || item.q || item.prompt || '').trim();
    if (!qText) continue;
    const sec = parseTimestampToSeconds(item.time ?? item.timestamp ?? item.seconds);
    const floorSec = sec === null ? null : Math.floor(sec);
    const ts = floorSec === null ? '' : formatTimestamp(floorSec);
    const rawOpts = Array.isArray(item.options) ? item.options.map(o => String(o ?? '').trim()).filter(Boolean) : [];
    const declaredType = String(item.type || '').toLowerCase();
    const isChoice = declaredType === 'choice' || declaredType === 'single' || declaredType === 'mcq' || rawOpts.length >= 2;
    const explanation = String(item.explanation || item.analysis || item.reason || '').trim();

    if (isChoice && rawOpts.length >= 2) {
      const options = rawOpts.slice(0, 4).map((opt, idx) => {
        const prefix = `${String.fromCharCode(65 + idx)}. `;
        return /^[A-D][.、:：\s]/iu.test(opt) ? opt : `${prefix}${opt}`;
      });
      const correctIndex = wdKtutParseChoiceIndex(item.correctIndex ?? item.answerIndex ?? item.answer, options.length);
      questions.push({
        id: `q-${questions.length + 1}`,
        type: 'choice',
        question: qText,
        options,
        correctIndex,
        answerLetter: String.fromCharCode(65 + correctIndex),
        explanation: explanation || `正确答案为 ${options[correctIndex]}${ts ? `（参见 ${ts}）` : ''}。`,
        seconds: floorSec,
        timestamp: ts,
      });
    } else {
      const referenceAnswer = String(item.referenceAnswer || item.answer || item.a || explanation || '').trim();
      if (!referenceAnswer) continue;
      questions.push({
        id: `q-${questions.length + 1}`,
        type: 'short',
        question: qText,
        referenceAnswer,
        explanation: explanation || (ts ? `详见视频约第 ${Math.floor(floorSec / 60) + 1} 分钟（${ts}）讲解。` : ''),
        seconds: floorSec,
        timestamp: ts,
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
  if (!forceRefresh) {
    const cached = loadSectionQuiz(win, courseId, sectionId);
    if (cached) return { ok: true, quiz: cached, fromCache: true };
  }
  const cfg = settings || loadAiSettings(win);
  if (!cfg?.apiKey?.trim()) {
    return { ok: false, needsAiConfig: true, error: '需先配置 AI：请先点击「AI 设置」填写 Provider、Base URL 与 API Key 后再使用「用 AI 出题」。' };
  }
  try { buildChatCompletionsUrl(cfg.baseUrl); } catch (err) {
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
    const questions = normalizeQuizPaper(parsed);
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
    const colWidths = [180, 220, 220, 280, 260];
    const rowHeight = 32;
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
      const textLabel = node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label;
      const boxWidth = Math.min(240, Math.max(92, textLabel.length * 11 + (node.timeText ? 54 : 20)));
      const rect = createSvg('rect', {
        x: 0,
        y: -12,
        width: boxWidth,
        height: 24,
        rx: 5,
        fill: level === 0 ? '#176ac2' : '#f4f9ff',
        stroke: color,
        'stroke-width': level === 0 ? '0' : '1',
      });
      const text = createSvg('text', {
        x: 8,
        y: 4,
        fill: level === 0 ? '#ffffff' : '#17344d',
        'font-size': level === 0 ? '13' : '12',
        'font-family': 'system-ui,"Microsoft YaHei",sans-serif',
      });
      text.textContent = textLabel;
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
    const totalHeight = Math.max(300, nextY * rowHeight + 48);
    svg.setAttribute('viewBox', `0 0 920 ${totalHeight}`);
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
    '.ai-privacy{font-size:11.5px;line-height:1.5;color:var(--accent-text);background:var(--accent-soft);border:1px solid var(--accent-border);border-radius:var(--radius-xs);padding:7px 9px;margin:0 0 8px}',
    '.ai-key-row{display:flex;gap:6px;align-items:center;margin-top:4px}.ai-key-row input{flex:1;min-width:0}.ai-note{display:block;margin:-4px 0 8px;font-size:11.5px;color:var(--text-3)}',
    '.kg-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.52);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.kg-dialog{width:min(960px,95vw);height:min(760px,90vh);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-modal);overflow:hidden}',
    '.kg-head{flex-shrink:0;padding:12px 16px 10px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px}',
    '.kg-head-top{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    '.kg-title-wrap{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap}',
    '.kg-title-wrap h2{margin:0;font-size:15px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px}',
    '.kg-head-controls{display:flex;align-items:center;gap:6px;flex-shrink:0}',
    '.kg-head-row2{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-badge{font-size:11px;font-weight:500;padding:2px 8px;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);flex-shrink:0}',
    '.kg-badge[data-tone=ai]{background:var(--success-soft);color:var(--success)}',
    '.kg-badge[data-tone=fallback]{background:var(--warn-soft);color:var(--warn)}',
    '.kg-badge[data-tone=cache]{background:var(--cache-soft);color:var(--cache)}',
    '.kg-badge[data-tone=scope]{background:var(--surface-2);color:var(--text-2)}',
    '.kg-badge[data-tone=nosub]{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn-border)}',
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
    '.kg-one-line{margin:0 0 10px;padding:9px 12px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:13px;color:var(--text);font-weight:500;line-height:1.55}',
    '.kg-subhead{font-size:12px;font-weight:600;color:var(--text-3);margin:12px 0 6px;display:flex;align-items:center;justify-content:space-between}',
    '.kg-kp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
    '.kg-kp-item{display:flex;align-items:center;gap:9px;padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;color:var(--text)}',
    '.kg-kp-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);font-size:11px;font-weight:600;flex-shrink:0}',
    '.kg-kp-text{flex:1;min-width:0;overflow-wrap:anywhere}',
    '.kg-fold-list{display:flex;flex-direction:column;gap:6px}',
    '.kg-topic-fold{margin:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);padding:7px 11px}',
    '.kg-topic-fold>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--text);font-weight:500}',
    '.kg-topic-fold>summary::before{content:"▸ ";font-size:11px;color:var(--accent)}.kg-topic-fold[open]>summary::before{content:"▾ "}',
    '.kg-topic-count{font-size:11px;color:var(--text-3);font-weight:400;margin-left:auto}',
    '.kg-points{list-style:none;margin:6px 0 2px;padding:0}',
    '.kg-points li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px dashed var(--border);font-size:12.5px;color:var(--text-2)}',
    '.kg-quiz-list{display:flex;flex-direction:column;gap:8px}',
    '.kg-quiz-item{border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;background:var(--surface)}',
    '.kg-quiz-q{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;font-size:13px;font-weight:500;color:var(--text)}',
    '.kg-quiz-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}',
    '.kg-quiz-ans{margin-top:8px;padding:7px 10px;background:var(--success-soft);border-left:3px solid var(--success);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:12.5px;color:var(--success)}',
    '.kg-glossary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}',
    '.kg-term-card{border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;background:var(--surface)}',
    '.kg-term-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px}.kg-term-head strong{font-size:12.5px;color:var(--text)}',
    '.kg-term-def{font-size:12px;color:var(--text-2);margin:0;line-height:1.45}',
    '.kg-timeline-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px dashed var(--border);font-size:12.5px}.kg-timeline-item:last-child{border-bottom:0}',
    '.kg-timeline-text{flex:1;min-width:0;color:var(--text-2);overflow-wrap:anywhere;line-height:1.55}',
    '.kg-time-btn{min-height:24px;padding:1px 8px;font-size:11px;font-variant-numeric:tabular-nums;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border);flex-shrink:0}',
    '.kg-mini-btn{min-height:24px;padding:2px 8px;font-size:11.5px;flex-shrink:0}',
    '.kg-md-pane{padding:14px 18px}.kg-md-pane pre{margin:0;max-height:100%;overflow:auto}',
    '.kg-sec-picker-wrap{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.kg-sec-picker{width:auto;max-width:300px;min-width:160px;padding:3px 8px;font-size:12px;min-height:28px}',
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
    node.addEventListener('click', async () => {
      if (node.disabled || busy.has(node)) return;
      busy.add(node); node.disabled = true;
      try { await handler(); } catch { showUiError('操作未完成，请查看当前状态后重试。'); }
      finally { busy.delete(node); node.disabled = false; render(controller.getState()); }
    });
    return node;
  };
  const isRunning = state => ['running', 'preparing', 'waiting'].includes(state.status) || state.phase === 'resuming';
  const runButton = button('run-toggle', '开始', headerButtons, () => isRunning(controller.getState()) ? controller.pause() : startQueue(), false);
  const toggle = button('toggle', '展开', headerButtons, () => setOpen(body.hidden), false); toggle.setAttribute('aria-expanded', 'false');
  const progress = element('div', '', header); progress.className = 'progress'; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
  const compact = element('div', '', header); compact.className = 'muted compact-course';
  const compactTime = element('div', '', header); compactTime.className = 'muted playback-time'; compactTime.dataset.playbackTime = '';
  const compactNotice = element('div', '', header); compactNotice.className = 'muted compact-notice';
  const execution = element('div', '', body); execution.className = 'status';
  const message = element('div', '', execution);
  const problemBox = element('div', '', body); problemBox.className = 'problem'; problemBox.dataset.problem = '';
  const problemText = element('div', '', problemBox); const problemActions = element('div', '', problemBox); problemActions.className = 'buttons';
  button('retry', '重试本课程', problemActions, () => controller.retry(latest.problem?.taskId, latest.problem?.courseId));
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

  // Group 3: AI 导览模型
  const aiGroup = element('div', '', settingsSheet); aiGroup.className = 'settings-group'; aiGroup.dataset.aiSettings = ''; aiGroup.dataset.settingsGroup = 'ai';
  element('p', 'AI 导览模型（选填）', aiGroup).className = 'settings-title';
  const aiPrivacy = element('p', kg.privacyNotice || WD_AI_PRIVACY_NOTICE, aiGroup); aiPrivacy.className = 'ai-privacy'; aiPrivacy.dataset.aiPrivacy = '';
  const aiProviderLabel = element('label', '服务商 (Provider)', aiGroup);
  const aiProvider = element('select', '', aiProviderLabel); aiProvider.name = 'ai-provider'; aiProvider.id = 'wd-ai-provider'; aiProviderLabel.htmlFor = aiProvider.id;
  for (const preset of (kg.providers || WD_AI_PROVIDERS)) {
    const opt = element('option', preset.label, aiProvider); opt.value = preset.id;
  }
  const aiProviderNote = element('small', '', aiGroup); aiProviderNote.className = 'muted ai-note'; aiProviderNote.dataset.aiProviderNote = '';
  const aiBaseUrlLabel = element('label', 'Base URL', aiGroup);
  const aiBaseUrl = element('input', '', aiBaseUrlLabel); aiBaseUrl.type = 'text'; aiBaseUrl.name = 'ai-base-url'; aiBaseUrl.id = 'wd-ai-base-url'; aiBaseUrlLabel.htmlFor = aiBaseUrl.id;
  aiBaseUrl.placeholder = 'https://api.deepseek.com/v1';
  const aiModelLabel = element('label', '模型名', aiGroup);
  const aiModel = element('input', '', aiModelLabel); aiModel.type = 'text'; aiModel.name = 'ai-model'; aiModel.id = 'wd-ai-model'; aiModelLabel.htmlFor = aiModel.id;
  aiModel.placeholder = 'deepseek-chat / qwen-plus / gpt-4o-mini';
  const aiKeyLabel = element('label', 'API Key', aiGroup);
  const aiKeyRow = element('div', '', aiKeyLabel); aiKeyRow.className = 'ai-key-row';
  const aiApiKey = element('input', '', aiKeyRow); aiApiKey.type = 'password'; aiApiKey.name = 'ai-api-key'; aiApiKey.id = 'wd-ai-api-key'; aiKeyLabel.htmlFor = aiApiKey.id;
  aiApiKey.autocomplete = 'off'; aiApiKey.placeholder = '留空默认零 AI';
  const aiToggleKey = button('ai-toggle-key', '显示', aiKeyRow, () => {
    const hidden = aiApiKey.type === 'password';
    aiApiKey.type = hidden ? 'text' : 'password';
    aiToggleKey.textContent = hidden ? '隐藏' : '显示';
  }, false);
  aiToggleKey.className = 'ghost';
  const aiTransportLabel = element('label', '请求通道', aiGroup);
  const aiTransport = element('select', '', aiTransportLabel); aiTransport.name = 'ai-transport'; aiTransport.id = 'wd-ai-transport'; aiTransportLabel.htmlFor = aiTransport.id;
  for (const [val, txt] of [['auto', '自动 (GM → fetch)'], ['gm', '仅 GM_xmlhttpRequest'], ['fetch', '仅页面 fetch']]) {
    const opt = element('option', txt, aiTransport); opt.value = val;
  }
  const aiActions = element('div', '', aiGroup); aiActions.className = 'buttons';
  const aiSaveStatus = element('small', '', aiGroup); aiSaveStatus.className = 'muted'; aiSaveStatus.dataset.aiSaveStatus = '';
  const syncAiForm = () => {
    const cfg = kg.getSettings();
    aiProvider.value = cfg.provider;
    aiBaseUrl.value = cfg.baseUrl;
    aiModel.value = cfg.model;
    aiApiKey.value = cfg.apiKey;
    aiTransport.value = cfg.transport;
    aiProviderNote.textContent = getAiProviderPreset(cfg.provider)?.note || '';
  };
  aiProvider.addEventListener('change', () => {
    const preset = getAiProviderPreset(aiProvider.value);
    if (preset && preset.id !== 'custom') {
      if (preset.baseUrl) aiBaseUrl.value = preset.baseUrl;
      if (preset.model) aiModel.value = preset.model;
    }
    aiProviderNote.textContent = preset?.note || '';
  });
  const aiSaveBtn = button('ai-save', '保存', aiActions, () => {
    const res = kg.saveSettings({
      provider: aiProvider.value,
      baseUrl: aiBaseUrl.value,
      model: aiModel.value,
      apiKey: aiApiKey.value,
      transport: aiTransport.value,
    });
    aiSaveStatus.textContent = res.ok
      ? (res.settings.apiKey ? '已保存到本地 localStorage' : '已保存（零 AI 档）')
      : (res.error || '保存失败');
  }, false);
  aiSaveBtn.className = 'primary';
  const aiResetBtn = button('ai-reset', '恢复默认', aiActions, () => {
    const def = getAiProviderPreset('deepseek');
    aiProvider.value = def.id;
    aiBaseUrl.value = def.baseUrl;
    aiModel.value = def.model;
    aiTransport.value = 'auto';
    aiProviderNote.textContent = def.note || '';
    const res = kg.saveSettings({
      provider: def.id,
      baseUrl: def.baseUrl,
      model: def.model,
      apiKey: aiApiKey.value,
      transport: 'auto',
    });
    aiSaveStatus.textContent = res.ok ? '已恢复默认模型配置（API Key 保留）' : (res.error || '恢复失败');
  }, false);
  aiResetBtn.className = 'ghost';
  const aiClearBtn = button('ai-clear-key', '清空 Key', aiActions, () => {
    const res = kg.clearApiKey();
    aiApiKey.value = '';
    aiApiKey.type = 'password';
    aiToggleKey.textContent = '显示';
    aiSaveStatus.textContent = res.ok ? '已清空本地 API Key' : (res.error || '清空失败');
  }, false);
  aiClearBtn.className = 'danger';
  syncAiForm();

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
  const createTimeBtn = (parent, sectionId, seconds, onSeek) => {
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    const sec = Math.floor(seconds);
    const tsBtn = element('button', formatTimestamp(sec), parent);
    tsBtn.type = 'button'; tsBtn.className = 'kg-time-btn'; tsBtn.dataset.seekSeconds = String(sec);
    tsBtn.title = `跳播至 ${formatTimestamp(sec)}`;
    tsBtn.addEventListener('click', ev => { ev.stopPropagation(); onSeek({ sectionId: sectionId || 'current', seconds: sec }); });
    return tsBtn;
  };
  const renderKnowledgeQuick = (container, tree, onSeek, onSwitchTab) => {
    container.replaceChildren();
    const sections = Array.isArray(tree?.sections) ? tree.sections : [];
    if (!sections.length) { element('p', '暂无可展示的课节或字幕内容。', container).className = 'muted'; return; }

    // Course-level overview card when multiple sections are present
    if (sections.length > 1) {
      const courseCard = element('div', '', container); courseCard.className = 'kg-card kg-card-course'; courseCard.dataset.kgCourseOverview = '';
      const head = element('div', '', courseCard); head.className = 'kg-card-head';
      element('h3', `整门课总览 · ${tree.scopeLabel || `共 ${sections.length} 节`}`, head);
      const mapJump = element('button', '查看全课导图 →', head); mapJump.type = 'button'; mapJump.className = 'kg-mini-btn ghost';
      mapJump.addEventListener('click', () => onSwitchTab('map'));
      if (tree.overview) {
        const lead = element('p', tree.overview, courseCard); lead.className = 'kg-one-line'; lead.dataset.kgOverview = '';
      }
      if (Array.isArray(tree.courseKeyPoints) && tree.courseKeyPoints.length) {
        element('div', '全课核心要点', courseCard).className = 'kg-subhead';
        const ol = element('ol', '', courseCard); ol.className = 'kg-kp-list';
        tree.courseKeyPoints.forEach((kp, idx) => {
          const li = element('li', '', ol); li.className = 'kg-kp-item';
          element('span', String(idx + 1), li).className = 'kg-kp-num';
          const textWrap = element('span', kp.sectionTitle ? `【${kp.sectionTitle}】${kp.text}` : kp.text, li); textWrap.className = 'kg-kp-text';
          createTimeBtn(li, kp.sectionId || 'current', kp.seconds, onSeek);
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
      const modeText = isNoSub
        ? (sec.mode === 'highlight' ? '平台看点' : '无字幕')
        : (sec.mode === 'ai' ? 'AI' : sec.mode === 'highlight' ? '看点' : sec.mode === 'placeholder' ? '占位' : '零 AI');
      const secBadge = element('span', modeText, head); secBadge.className = 'kg-badge';
      if (isNoSub) secBadge.dataset.tone = 'nosub';
      else if (sec.mode === 'ai') secBadge.dataset.tone = 'ai';

      if (isNoSub) {
        const noSubBox = element('div', '', card); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgNoSubtitle = sec.sectionId || 'current';
        element('strong', '本课无字幕', noSubBox);
        const detailReason = String(sec.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
        element('div', detailReason, noSubBox);
        if (sec.mode !== 'highlight') continue;
      }

      // 1. One-sentence summary
      if (sec.summary) {
        const sum = element('p', sec.summary, card); sum.className = 'kg-one-line'; sum.dataset.kgSectionSummary = '';
      }

      // 2. Core Key Points Card
      if (Array.isArray(sec.keyPoints) && sec.keyPoints.length) {
        element('div', `核心要点 · ${sec.keyPoints.length}`, card).className = 'kg-subhead';
        const ol = element('ol', '', card); ol.className = 'kg-kp-list'; ol.dataset.kgKeypoints = '';
        sec.keyPoints.forEach((kp, idx) => {
          const li = element('li', '', ol); li.className = 'kg-kp-item';
          element('span', String(idx + 1), li).className = 'kg-kp-num';
          element('span', kp.text || '', li).className = 'kg-kp-text';
          createTimeBtn(li, sec.sectionId || 'current', kp.seconds, onSeek);
        });
      }

      // Chunk summaries shown when long-section aggregation degraded
      if (Array.isArray(sec.chunkSummaries) && sec.chunkSummaries.length > 1) {
        element('div', `分段摘要 · ${sec.chunkSummaries.length}`, card).className = 'kg-subhead';
        const ul = element('ul', '', card); ul.className = 'kg-points'; ul.dataset.kgChunkSummaries = '';
        for (const cs of sec.chunkSummaries) {
          const li = element('li', '', ul);
          element('span', `第 ${cs.chunkIndex} 段：${cs.summary}`, li);
          createTimeBtn(li, sec.sectionId || 'current', cs.seconds, onSeek);
        }
      }

      // 3. 3-level Hierarchical Outline (default collapsed at 3rd level)
      const outline = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
      if (outline.length) {
        element('div', '知识大纲', card).className = 'kg-subhead';
        const foldList = element('div', '', card); foldList.className = 'kg-fold-list'; foldList.dataset.kgOutline = '';
        for (const topic of outline) {
          const details = element('details', '', foldList); details.className = 'kg-topic-fold'; details.open = false;
          const summary = element('summary', '', details);
          element('span', topic.name || '主题', summary);
          const pts = Array.isArray(topic.points) ? topic.points : [];
          element('span', `${pts.length}`, summary).className = 'kg-topic-count';
          const ul = element('ul', '', details); ul.className = 'kg-points';
          for (const pt of pts) {
            const li = element('li', '', ul);
            element('span', pt.text || '', li);
            createTimeBtn(li, sec.sectionId || 'current', pt.seconds, onSeek);
          }
        }
      }

      // 4. Q&A Self-Check
      if (Array.isArray(sec.quiz) && sec.quiz.length) {
        element('div', `自测 · ${sec.quiz.length}`, card).className = 'kg-subhead';
        const qList = element('div', '', card); qList.className = 'kg-quiz-list'; qList.dataset.kgQuiz = '';
        sec.quiz.forEach((item, idx) => {
          const qCard = element('div', '', qList); qCard.className = 'kg-quiz-item';
          const qTop = element('div', '', qCard); qTop.className = 'kg-quiz-q';
          element('span', `Q${idx + 1}. ${item.question}`, qTop);
          const qActions = element('div', '', qTop); qActions.className = 'kg-quiz-actions';
          createTimeBtn(qActions, sec.sectionId || 'current', item.seconds, onSeek);
          const ansBox = element('div', item.answer, qCard); ansBox.className = 'kg-quiz-ans'; ansBox.dataset.kgQuizAnswer = ''; ansBox.hidden = true;
          const revealBtn = element('button', '答案', qActions); revealBtn.type = 'button'; revealBtn.className = 'kg-mini-btn ghost'; revealBtn.dataset.action = `kg-quiz-toggle-${sec.sectionIndex || 1}-${idx}`;
          revealBtn.addEventListener('click', () => {
            ansBox.hidden = !ansBox.hidden;
            revealBtn.textContent = ansBox.hidden ? '答案' : '收起';
          });
        });
      }

      // 5. Glossary / Term Cards
      if (Array.isArray(sec.glossary) && sec.glossary.length) {
        element('div', `术语 · ${sec.glossary.length}`, card).className = 'kg-subhead';
        const grid = element('div', '', card); grid.className = 'kg-glossary-grid'; grid.dataset.kgGlossary = '';
        for (const g of sec.glossary) {
          const tCard = element('div', '', grid); tCard.className = 'kg-term-card';
          const tHead = element('div', '', tCard); tHead.className = 'kg-term-head';
          element('strong', g.term, tHead);
          createTimeBtn(tHead, sec.sectionId || 'current', g.seconds, onSeek);
          element('p', g.definition, tCard).className = 'kg-term-def';
        }
      }
    }
  };

  const renderKnowledgeDetail = (container, tree, onSeek) => {
    container.replaceChildren();
    const sections = Array.isArray(tree?.sections) ? tree.sections : [];
    if (!sections.length) { element('p', '暂无课节内容。', container).className = 'muted'; return; }
    const silentSkipMixed = sections.length > 1 && tree?.hasAnySubtitle === true;
    for (const sec of sections) {
      if (sec.hasSubtitle === false && silentSkipMixed && sec.mode !== 'highlight') continue;
      const card = element('div', '', container); card.className = 'kg-card';
      const head = element('div', '', card); head.className = 'kg-card-head';
      element('h3', `${sec.chapterTitle ? `${sec.chapterTitle} · ` : ''}${sec.title || '课节'}`, head);
      if (sec.hasSubtitle === false) {
        const badge = element('span', '无字幕', head); badge.className = 'kg-badge'; badge.dataset.tone = 'nosub';
        const noSubBox = element('div', '', card); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgNoSubtitleDetail = sec.sectionId || 'current';
        element('strong', '本课无字幕', noSubBox);
        const detailReason = String(sec.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
        element('div', detailReason, noSubBox);
        if (sec.mode !== 'highlight') continue;
      }
      if (sec.summary) element('p', sec.summary, card).className = 'kg-one-line';

      const outline = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
      if (outline.length) {
        element('div', '完整知识点', card).className = 'kg-subhead';
        for (const topic of outline) {
          const tHead = element('div', topic.name || '主题', card); tHead.className = 'settings-title';
          const ul = element('ul', '', card); ul.className = 'kg-points';
          for (const pt of (topic.points || [])) {
            const li = element('li', '', ul);
            element('span', pt.text || '', li);
            createTimeBtn(li, sec.sectionId || 'current', pt.seconds, onSeek);
          }
        }
      }

      if (Array.isArray(sec.timeline) && sec.timeline.length) {
        element('div', `字幕时间轴 · ${sec.timeline.length}`, card).className = 'kg-subhead';
        const tlBox = element('div', '', card); tlBox.dataset.kgTimeline = '';
        for (const item of sec.timeline) {
          const row = element('div', '', tlBox); row.className = 'kg-timeline-item';
          createTimeBtn(row, sec.sectionId || 'current', item.startSec, onSeek);
          element('div', item.text || item.headline || '', row).className = 'kg-timeline-text';
        }
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
    aiApiKey.focus();
  };

  const renderTextWithSeekLinks = (container, text, sectionId, onSeek) => {
    container.replaceChildren();
    const str = String(text ?? '');
    const regex = /(?<!\d)(\d{1,2}:\d{2}(?::\d{2})?)(?!\d)/gu;
    let last = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
      if (match.index > last) container.append(document.createTextNode(str.slice(last, match.index)));
      const parts = match[1].split(':').map(Number);
      const sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
      if (Number.isFinite(sec) && parts.at(-1) < 60 && parts.at(-2) < 60) {
        const btn = element('button', match[1], container);
        btn.type = 'button'; btn.className = 'kg-inline-time'; btn.dataset.seekSeconds = String(sec);
        btn.title = `跳播至 ${formatTimestamp(sec)}`;
        btn.addEventListener('click', () => onSeek({ sectionId: sectionId || 'current', seconds: sec }));
      } else {
        container.append(document.createTextNode(match[1]));
      }
      last = regex.lastIndex;
    }
    if (last < str.length) container.append(document.createTextNode(str.slice(last)));
  };

  const hasAnyCourseSubtitleCandidate = () => {
    const raw = Array.isArray(kgLastResult?.courseData?.sections) ? kgLastResult.courseData.sections : [];
    if (!raw.length) return false;
    if ((kgLastResult?.courseData?.captionedSections || 0) > 0) return true;
    return raw.some(s => s.hasSubtitle === true || (!s.subtitleChecked && s.hasSubtitle !== false && Boolean(s.captionVtt)));
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
    const stored = loadSectionChat(win, courseId, sectionId);
    const messages = stored.messages || [];

    kgModal.qaTitle.textContent = `💬 问答 · 《${sectionTitle}》${focusedHasSub ? ` (${messages.length})` : ''}`;
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
        ? `针对《${sectionTitle}》提问（回车发送）`
        : '需先配置 AI';
    kgModal.qaSendBtn.disabled = kgQaBusy || !hasKey || !focusedHasSub;
    kgModal.qaSendBtn.title = !focusedHasSub ? '本课无字幕，无法基于字幕提问' : '';
    kgModal.qaInput.disabled = kgQaBusy || !focusedHasSub;

    kgModal.qaThread.hidden = !kgQaExpanded;
    kgModal.qaThread.replaceChildren();
    if (kgQaExpanded) {
      if (!messages.length) {
        const emptyHint = !focusedHasSub
          ? '本课无字幕，暂不可提问。'
          : hasKey
            ? '暂无对话，输入问题后 AI 将依据本节字幕回答并标注时间点。'
            : '需先配置 AI 后方可提问。';
        element('p', emptyHint, kgModal.qaThread).className = 'muted';
      } else {
        for (const msg of messages) {
          const bubble = element('div', '', kgModal.qaThread);
          bubble.className = 'kg-qa-msg';
          bubble.dataset.role = msg.role;
          if (msg.role === 'assistant') {
            const textDiv = element('div', '', bubble);
            renderTextWithSeekLinks(textDiv, msg.content, sectionId, handleKgSeek);
            if (Array.isArray(msg.citations) && msg.citations.length) {
              const citeWrap = element('div', '', bubble); citeWrap.className = 'kg-qa-cites';
              for (const c of msg.citations) {
                const chip = element('button', `依据 · ${c.minuteLabel} (${c.timestamp})${c.note ? ` · ${c.note}` : ''}`, citeWrap);
                chip.type = 'button'; chip.className = 'kg-qa-cite'; chip.dataset.seekSeconds = String(c.seconds);
                chip.addEventListener('click', () => handleKgSeek({ sectionId, seconds: c.seconds }));
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
    setKgBanner(`正在结合《${focused.title}》字幕向 AI 提问…`, 'info');
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
        settings: kg.getSettings(),
        gmRequest: deps.gmRequest,
        fetchFn: deps.fetchFn,
        signal: kgQaAbort?.signal,
      });
      if (!kgModal) return;
      if (res.ok) {
        kgModal.qaInput.value = '';
        setKgBanner(res.contextMeta?.truncated
          ? `已回答（超长课节按相关性选取 ${res.contextMeta.selectedSegments}/${res.contextMeta.totalSegments} 段字幕，点击时间点可跳播）。`
          : '已回答，点击回复中的时间点可定位播放。', 'info');
      } else {
        setKgBanner(res.error || 'AI 提问失败。', 'warn');
      }
    } finally {
      kgQaBusy = false;
      renderQaDock();
    }
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
      createTimeBtn(qHead, sectionId, q.seconds, handleKgSeek);

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
          const fb = element('p', gInfo.correct ? '✅ 回答正确' : `❌ 回答有误（正确答案：${q.answerLetter}）`, qCard);
          fb.className = gInfo.correct ? 'muted' : 'status';
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
        renderTextWithSeekLinks(expText, `解析：${q.explanation}`, sectionId, handleKgSeek);
      }
      if (Number.isFinite(q.seconds) && q.seconds >= 0) {
        const jumpRow = element('div', '', expBody); jumpRow.className = 'row';
        element('small', `视频依据：约第 ${Math.floor(q.seconds / 60) + 1} 分钟`, jumpRow).className = 'muted';
        createTimeBtn(jumpRow, sectionId, q.seconds, handleKgSeek);
      }
    });

    if (!attempt.submitted) {
      const footer = element('div', '', container); footer.className = 'buttons';
      const submitBtn = element('button', '提交作答并判分', footer);
      submitBtn.type = 'button'; submitBtn.className = 'primary'; submitBtn.dataset.action = 'kg-quiz-submit';
      submitBtn.addEventListener('click', () => {
        const graded = gradeSectionQuiz(stored.questions, answers);
        persistAttempt({
          answers,
          submitted: true,
          submittedAt: Date.now(),
          choiceTotal: graded.choiceTotal,
          choiceCorrect: graded.choiceCorrect,
        });
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
      const kgBadge = element('span', '零 AI 速览', titleWrap); kgBadge.className = 'kg-badge'; kgBadge.dataset.kgMode = '';
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
        await runKnowledge({ scope: 'section', sectionId: kgFocusSectionId, useAi: false, preferCacheOnOpen: true });
      });
      const triggerRow = element('div', '', headRow2); triggerRow.className = 'diag-actions';
      const secAiBtn = button('kg-ai-section', 'AI 本节', triggerRow, () => runKnowledge({ scope: 'section', sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }), false); secAiBtn.className = 'primary';
      const courseAiBtn = button('kg-ai-course', 'AI 全课', triggerRow, () => runKnowledge({ scope: 'course', sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }), false);
      const quizAiBtn = button('kg-ai-quiz', '出题', triggerRow, () => runSectionQuiz({ forceRefresh: false }), false);
      const zeroBtn = button('kg-zero-ai', '零 AI', triggerRow, () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: false, forceRefresh: false }), false); zeroBtn.className = 'ghost';
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
      const qaTitle = element('strong', '💬 问答', qaBar); qaTitle.dataset.kgQaTitle = '';
      const qaBarActions = element('div', '', qaBar); qaBarActions.className = 'diag-actions';
      const qaToggleBtn = button('kg-qa-toggle', '对话 ▴', qaBarActions, () => { kgQaExpanded = !kgQaExpanded; renderQaDock(); }, false); qaToggleBtn.className = 'ghost';
      const qaClearBtn = button('kg-qa-clear', '清空', qaBarActions, () => {
        const sec = resolveFocusedSection();
        clearSectionChat(win, getCurrentCourseId(), sec?.sectionId || 'current');
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

      kgModal = { backdrop, kgTitle, kgBadge, kgScopeBadge, kgCacheBadge, zeroBtn, secAiBtn, courseAiBtn, quizAiBtn, regenBtn, abortBtn, secPickerWrap, secPicker, metaFold, metaSummary, estimateBar, banner, subDiagWrap, subDiagPre, tabButtons, fitBtn, quickPane, detailPane, quizPane, mapPane, svg, engineFoot, mdPane, mdPre, qaDock, qaTitle, qaToggleBtn, qaClearBtn, qaNoSub, qaNoAi, qaThread, qaInput, qaSendBtn };
    }
    kgFocusSectionId = targetSectionId || null;
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
        kgModal.kgBadge.textContent = 'AI 速览';
        kgModal.kgBadge.dataset.tone = 'ai';
      } else if (result.fallback) {
        kgModal.kgBadge.textContent = result.usedAi ? 'AI 部分成功 · 局部回退零 AI' : 'AI 失败 · 已回退零 AI';
        kgModal.kgBadge.dataset.tone = 'fallback';
      } else {
        kgModal.kgBadge.textContent = '零 AI 速览（默认）';
        kgModal.kgBadge.dataset.tone = 'zero';
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
      renderKnowledgeQuick(kgModal.quickPane, result.tree, handleKgSeek, switchKgTab);
      renderKnowledgeDetail(kgModal.detailPane, result.tree, handleKgSeek);
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
  const startQueue = async () => {
    if (starting) return;
    starting = true; render(controller.getState());
    try { if (await saveWindow()) await controller.start(); }
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
        const retry = item ? button(`retry-${item.id}-${course.id}`, '重试', label, () => controller.retry(item.id, course.id)) : null;
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
    const hasStarted = Boolean(state.currentCourseId) || state.tasks.some(item => item.current || item.done.length || item.skipped.length || item.deferred?.length);
    const completedCount = state.tasks.filter(item => completeTask(item) && !(running && item.id === state.activeTaskId)).length;
    clearCompleted.textContent = `清除已完成（${completedCount}）`;
    clearCompleted.hidden = !completedCount;
    clearCompleted.disabled = !completedCount || state.unavailable || state.status === 'preparing' || state.phase === 'resuming';
    addButton.className = state.tasks.length === 0 ? 'primary' : '';
    addButton.title = running ? '暂停后可添加专区' : '';
    runButton.textContent = running ? '暂停' : state.status === 'complete' ? '已完成' : hasStarted ? '继续' : '开始';
    runButton.className = !running && state.status !== 'complete' ? 'primary' : '';
    runButton.disabled = starting || (!running && cannotStart); toggle.disabled = false;
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
  const panel = { open() { setOpen(true); }, destroy() { sectionGuideEntries.destroy(); closeKnowledgeModal(); clearTimers(); unsubscribe(); host.remove(); } };
  host.wdPanel = panel; document.documentElement.append(host); render(controller.getState());
  return panel;
}






const wdMainVersion = "0.1.0-beta.16";

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
