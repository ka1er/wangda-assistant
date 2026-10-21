// ==UserScript==
// @name         网大助手
// @namespace    wangda-assistant
// @version      0.1.0-beta.14
// @updateURL    https://raw.githubusercontent.com/ka1er/wangda-assistant/refs/heads/beta-channel/dist/wangda-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/ka1er/wangda-assistant/refs/heads/beta-channel/dist/wangda-assistant.user.js
// @description  手动勾选课程、管理多专区任务队列，按平台完成状态连续学习
// @match        https://wangda.chinamobile.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
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

function wdAdapterCourseElements(document) {
  return [...document.querySelectorAll('.content.new .img.course-item [id*="studyBtns-"], .content.new .img.course-item [id*="studyBtn-"]')];
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
  const win = element.ownerDocument.defaultView;
  for (let current = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true' || current.classList.contains('hidden') || (current.tagName === 'DIALOG' && !current.hasAttribute('open'))) return false;
    const style = win?.getComputedStyle(current);
    if (style && (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0')) return false;
  }
  return element.isConnected;
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
  if (page.kind === 'unknown') page.issues.push('无法识别当前页面路由');
  if (page.kind === 'subject') {
    page.title = wdAdapterTitle(document.querySelector('.subject-banner .title-row .h3, .banner-info .title-row .h3'));
    page.subjectTitleSource = page.title ? 'banner' : 'none';
    const seen = new Set();
    const ignored = new Map();
    for (const element of wdAdapterCourseElements(document)) {
      const id = wdAdapterAttribute(element, 'resource-id');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const type = wdAdapterAttribute(element, 'section-type');
      if (type !== '10') {
        ignored.set(type || 'unknown', (ignored.get(type || 'unknown') || 0) + 1);
        continue;
      }
      if (!new RegExp(`^${wdAdapterIdPattern}$`, 'u').test(id)) {
        page.issues.push('课程标识格式无法识别');
        continue;
      }
      const card = element.closest('.content.new');
      page.courses.push({
        id, title: wdAdapterTitle(card.querySelector('.title')),
        status: wdAdapterStatus(card.querySelectorAll('.study-status')),
        required: wdAdapterText(card.querySelector('.cont-class-type')) !== '选修',
        route: `#/study/course/detail/subject-course/${id}/6/${page.subjectId}`,
      });
    }
    // The subject loader sets document.title for every layout, including those without a banner.
    // Only use it on a recognized subject route with valid course cards; the controller still matches SID and title.
    if (!page.title && page.courses.length) {
      page.title = (document.title || '').trim();
      if (page.title) page.subjectTitleSource = 'document';
    }
    for (const [type, count] of ignored) page.issues.push(`已忽略非课程资源：类型 ${/^\d+$/u.test(type) ? type : 'unknown'}，数量 ${count}`);
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
    const players = document.querySelectorAll('video,audio'); const media = players[0];
    if (media) {
      page.media = { ended: Boolean(media.ended), paused: Boolean(media.paused) };
      const currentTime = media.currentTime, duration = media.duration;
      page.media.currentTime = players.length === 1 && Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : null;
      page.media.duration = players.length === 1 && Number.isFinite(duration) && duration > 0 ? duration : null;
    }
    else if (active.some(section => [5, 6].includes(section.type))) page.issues.push('未识别本页媒体播放器');
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
    for (const media of win.document.querySelectorAll('video,audio')) {
      try { media.pause(); } catch { /* A removed or unavailable media element cannot be paused. */ }
    }
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
      let applied = false;
      for (const media of win.document.querySelectorAll('video,audio')) {
        try { if (!media.muted) media.muted = true; applied = true; } catch { /* Unavailable players do not prevent the course from loading. */ }
      }
      return applied;
    },
    leaveLearning(subjectRoute) {
      if (read().kind !== 'course') return false;
      pauseMedia();
      if (!navigate(subjectRoute, 'subject')) navigate('#/home', 'home');
      return true;
    },
    async playCurrentMedia(mute = true) {
      if (read().kind !== 'course') return false;
      const media = [...win.document.querySelectorAll('video,audio')].find(item => item.paused && !item.ended);
      if (!media) return false;
      try { if (mute) media.muted = true; await media.play(); return true; } catch { return false; }
    },
    diagnose() {
      const page = read();
      const types = {};
      const statuses = { 'not-started': 0, learning: 0, completed: 0, unknown: 0 };
      for (const item of [...page.courses, ...page.sections]) statuses[item.status] += 1;
      for (const section of page.sections) types[section.type] = (types[section.type] || 0) + 1;
      return { kind: page.kind, courses: page.courses.length, candidates: page.candidates.length, sections: page.sections.length, types, statuses, issues: page.issues,
        ...(page.kind === 'subject' ? { subjectTitleSource: page.subjectTitleSource } : {}) };
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
  const getState = () => ({ status, phase: restorePending ? 'resuming' : recovery?.network ? 'offline' : recovery ? 'retrying' : status, message, unavailable: blocked, window: copy(record?.window || defaultWindow), automation: copy(record?.automation || defaultAutomation), tasks: copy(record?.tasks || []), activeTaskId: record?.activeTaskId || null, currentCourseId: task?.current || null, currentSectionTitle, currentPlayback: copy(currentPlayback), candidates: copy(candidates), draft: copy(draft), problem: copy(problem) });
  const emit = () => { const state = getState(); for (const listener of listeners) listener(state); };
  const tell = text => { message = text; emit(); return false; };
  const milliseconds = () => now().getTime();
  const notify = text => { try { options.notify?.(`网大助手：${text}`); } catch { /* Notifications are optional. */ } };
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
      return page.kind === 'course' && task.current === page.courseId && task.subject.id === page.subjectId && task.courses.some(course => course.id === page.courseId && course.route === page.route);
    } catch { return true; /* Stop the last known learning page if its snapshot fails. */ }
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
    preparing = pending = grace = loading = recovery = null;
    mediaPending = null;
    if (wasRunning && !complete && task?.current && /人工|播放|媒体已暂停|课节|超时|页面操作未成功|页面读取或操作异常/u.test(text)) problem = { taskId: task.id, courseId: task.current, reason: text };
    status = complete ? 'complete' : 'paused';
    message = text;
    if (wasRunning && ownsCurrentLearningPage()) {
      try { adapter.pauseMedia(); if (leave) adapter.leaveLearning(task.subject.route); } catch { message += ' 页面操作未能完成，请手动停止学习。'; }
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
    if (!validPage(page, existing?.subject)) return tell('请进入对应专题课程列表，等待标题和课程加载完成后再读取。');
    if (refreshId) {
      if (!existing) return false;
      existing.courses = mergeCourses(existing.courses, page.courses, existing.selectionMode);
      if (!persist()) return false;
      message = '课程清单已刷新，勾选和学习记录已保留。' + (nextEntry() ? pendingNotice : ''); emit(); return true;
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
    if (record?.tasks.some(item => item.subject?.id === draft.subject.id)) return tell('该专题已在任务队列中，请刷新已有清单。');
    ensureRecord(); const next = { id: unique(), ...copy(draft), scope: 'all', done: [], skipped: [], current: null };
    record.tasks.push(next); if (!record.activeTaskId) record.activeTaskId = next.id;
    if (!persist()) return false; draft = null; candidates = []; target = ''; message = '专题已加入队列，可继续添加其他专题。' + (nextEntry() ? pendingNotice : ''); emit(); return true;
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
    message = `已安排 ${ids.length} 门课程复查，请点击开始；将核对课节状态，只学习未完成内容。`; emit(); return true;
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
    status = 'preparing'; preparing = { stage: 'subject', candidate, refreshId, since: milliseconds() }; message = '正在打开专题，请等待课程加载。'; watch(); emit();
    if (!adapter.openSubject(candidate)) { stop('无法打开专题，请手动打开后读取。'); return false; } return true;
  };
  const subjectTitleIssue = page => {
    if (preparing?.stage !== 'subject' || page.kind !== 'subject' || page.subjectId !== preparing.candidate.id || !page.courses?.length) return '';
    if (!page.title?.trim()) return '未识别当前专题标题，已暂停。请查看页面诊断后重试读取。';
    if (normalizeTitle(page.title) !== normalizeTitle(preparing.candidate.title)) return '当前专题标题与所选结果不一致，已暂停。请核对专区后重试。';
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
    target = value.trim(); draft = null; status = 'preparing'; candidates = []; preparing = { stage: 'search-page', since: milliseconds() }; message = '正在打开专题搜索。'; watch(); emit();
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
    if (!editable() || !record || !record.tasks.length) return tell('请先添加专题任务。');
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
    generation += 1; restorePending = false; status = isWithinWindow(now(), record.window) ? 'running' : 'waiting'; needOpen = true; played.clear(); seenPlaying.clear(); resumeAttempts.clear(); retries.clear(); pending = grace = loading = recovery = null;
    message = status === 'waiting' ? `等待学习时段 ${record.window.start}—${record.window.end}（北京时间），到时自动继续。` : '正在按平台课节状态连续学习。';
    if (status === 'waiting') waitWindow();
    else { watchMedia(); muteCourse(entry.course); }
    watch(); emit(); return true;
  };
  const pause = async () => {
    restorePending = false;
    if (!held && record?.runRequested && !await acquire()) { stop('无法暂停其他标签正在执行的任务，请到执行标签点击暂停。'); return false; }
    if (status !== 'running' && status !== 'preparing' && ownsCurrentLearningPage()) {
      try { adapter.pauseMedia(); adapter.leaveLearning(task.subject.route); } catch { stop('页面未能停止，请手动退出学习页。'); return false; }
    }
    stop('已暂停，继续学习需手动点击开始。', true); return true;
  };
  const waitFor = (key, reason) => {
    if (loading?.key !== key) loading = { key, since: milliseconds() };
    if (milliseconds() - loading.since >= 30000) recover(`${reason}，加载超时。`);
  };
  const action = (fn, expectation) => {
    if (!verify() || status !== 'running') return;
    currentPlayback = null;
    if (!fn()) { recover('页面操作未成功。'); return; }
    pending = { ...expectation, since: milliseconds() };
    loading = null;
  };
  const nextCourse = page => {
    currentPlayback = null;
    const entry = nextEntry();
    if (!entry) {
      const count = record.tasks.reduce((n, item) => n + (item.deferred?.length || 0), 0);
      if (count) { stop(`队列已执行完，仍有 ${count} 门待处理课程${record.tasks.some(item => item.skipped.length) ? '及跳过课程' : ''}；请在详情中查看原因并重试。`, true); notify(message); return; }
      if (record.tasks.some(item => item.skipped.length)) { stop('其他课程已核对，仍有跳过课程未完成，请重试。', true); return; }
      stop('所选课程已全部完成。', true, true); notify('所选课程已完成。'); return;
    }
    generation += 1; mediaPending = null;
    record.activeTaskId = entry.item.id; task = entry.item; task.current = entry.course.id;
    if (!persist()) return;
    grace = loading = recovery = null; currentSectionTitle = '';
    if (matchesCourse(page, entry.course)) { pending = null; return; }
    action(() => adapter.openCourse(entry.course), { kind: 'course', id: entry.course.id, before: page.route });
  };
  const deferCurrent = reason => {
    if (!verify() || status !== 'running') return;
    generation += 1; mediaPending = null; pending = grace = loading = recovery = null;
    const page = adapter.read();
    if (ownsCurrentLearningPage()) {
      adapter.pauseMedia();
      if (adapter.leaveLearning(task.subject.route) === false) { stop('未能退出当前学习页，请手动退出后继续。'); notify(message); return; }
    }
    task.deferred = [...(task.deferred || []).filter(item => item.courseId !== task.current), { courseId: task.current, reason }];
    if (!persist()) return;
    message = `课程已放入待处理：${reason} 继续后续课程。`; emit();
    nextCourse(page);
  };
  const recover = reason => {
    currentPlayback = null;
    if (!record?.automation.enabled) { stop(`${reason} 已暂停并退出学习页，请人工确认。`, true); return; }
    if (!verify() || status !== 'running') return;
    const key = `${task.id}:${task.current}`, attempt = (retries.get(key) || 0) + 1;
    if (attempt > 3) { deferCurrent(`${reason} 已重试三次。`); return; }
    generation += 1; mediaPending = null; pending = grace = loading = null;
    retries.set(key, attempt);
    if (ownsCurrentLearningPage()) {
      adapter.pauseMedia();
      if (adapter.leaveLearning(task.subject.route) === false) { stop('重试前未能退出学习页，请手动退出后继续。'); notify(message); return; }
    }
    recovery = { until: milliseconds() + [5000, 10000, 20000][attempt - 1], attempt, reason, before: adapter.read().route };
    message = `${reason} 正在等待重试 ${attempt}/3。`; emit();
  };
  const waitWindow = () => {
    currentPlayback = null;
    stopMediaWatch?.(); stopMediaWatch = null;
    if (!record.automation.enabled) { stop('已到学习时段边界，已停止媒体并退出学习页。', true); return; }
    if (ownsCurrentLearningPage()) {
      try { adapter.pauseMedia(); if (adapter.leaveLearning(task.subject.route) === false) throw Error(); }
      catch { stop('学习时段结束，但未能退出学习页，请手动停止。', true); notify(message); return; }
    }
    generation += 1; mediaPending = null; pending = grace = loading = recovery = null; needOpen = true;
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
          generation += 1; mediaPending = null; pending = grace = loading = null;
          if (ownsCurrentLearningPage()) {
            adapter.pauseMedia();
            if (adapter.leaveLearning(task.subject.route) === false) { stop('断网后未能退出学习页，请手动退出。'); notify(message); return; }
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
        if (milliseconds() - preparing.since >= 30000) { stop(subjectTitleIssue(page) || '搜索或专题加载超时，请手动打开专题后读取。'); return; }
        if (preparing.stage === 'search-page' && page.kind === 'search') {
          if (adapter.searchKeyword(target)) preparing = { stage: 'results', since: milliseconds() };
        } else if (preparing.stage === 'results' && page.kind === 'search' && page.candidates?.length) {
          candidates = page.candidates.map(({ id, title, route }) => ({ id, title, route }));
          const exact = candidates.filter(item => normalizeTitle(item.title) === normalizeTitle(target));
          if (exact.length === 1) {
            preparing = { stage: 'subject', candidate: exact[0], since: milliseconds() };
            if (!adapter.openSubject(exact[0])) stop('无法打开专题，请手动打开后读取。');
          } else stop('请点击确认要学习的专题。');
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
        if (page.route !== recovery.before && page.route !== task.subject.route && !matchesCourse(page, current)) { stop('页面已离开目标课程，请确认后重新开始。'); return; }
        if (!recovery.network && milliseconds() < recovery.until) return;
        recovery = null; played.clear(); seenPlaying.clear();
        message = '正在重新进入课程。'; emit();
        action(() => adapter.openCourse(current), { kind: 'course', id: current.id, before: page.route }); return;
      }
      if (needOpen) {
        needOpen = false;
        if (!matchesCourse(page, current)) { action(() => adapter.openCourse(current), { kind: 'course', id: current.id, before: page.route }); return; }
      }
      if (pending) {
        const arrived = matchesCourse(page, current) && (pending.kind === 'course' ? page.courseId === pending.id : page.activeSectionId === pending.id);
        if (arrived) pending = null;
        else {
          if (page.route !== pending.before && !matchesCourse(page, current)) { stop('页面已离开目标课程，请确认后重新开始。'); return; }
          if (milliseconds() - pending.since >= 30000) recover('页面切换超时。');
          return;
        }
      }
      if (!matchesCourse(page, current)) {
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
      muteCourse(current);
      if (isDone(task, current.id)) {
        if (!grace || milliseconds() - grace.since >= 6000) nextCourse(page);
        return;
      }
      const sections = page.sections || [];
      const structuralIssue = page.issues?.some(issue => !issue.includes('未识别本页媒体播放器'));
      if (structuralIssue || !sections.length || sections.some(item => item.courseId !== current.id) || sections.filter(item => item.active).length > 1) { waitFor('structure', '课程课节尚未可靠加载'); return; }
      const inScope = sections.filter(item => task.scope === 'all' || item.required);
      if (inScope.some(item => !['learning', 'not-started', 'completed'].includes(item.status))) { waitFor('status', '课节状态无法识别'); return; }
      const active = sections.find(item => item.id === page.activeSectionId);
      if (active && (task.scope === 'all' || active.required) && [5, 6].includes(active.type) && page.media) {
        currentPlayback = { taskId: task.id, courseId: current.id, sectionId: active.id, paused: Boolean(page.media.paused), ended: Boolean(page.media.ended),
          currentTime: Number.isFinite(page.media.currentTime) && page.media.currentTime >= 0 ? page.media.currentTime : null,
          duration: Number.isFinite(page.media.duration) && page.media.duration > 0 ? page.media.duration : null };
      }
      currentSectionTitle = active?.title || '';
      const decision = decideLearningAction(page, { status, scope: task.scope });
      if (decision.type === 'manual') { if (record.automation.enabled) deferCurrent('此课节需要人工处理，请完成后重试。'); else { stop('此课节需要人工处理，请在当前页面完成后再继续。'); notify(message); } return; }
      if (page.activeSectionId && !active) { waitFor('focus', '当前课节无法确认'); return; }
      if (decision.type === 'course-complete') {
        if (!task.done.includes(current.id)) task.done.push(current.id);
        task.recheck = (task.recheck || []).filter(id => id !== current.id);
        if (!persist()) return;
        if (!nextEntry()) { nextCourse(page); return; }
        grace = { key: `course:${current.id}`, since: milliseconds() }; loading = null; return;
      }
      if (decision.type === 'select-section') {
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
          if (!page.media) { waitFor(`player:${active.id}`, '未识别本页媒体播放器'); return; }
          loading = null;
          const key = `${task.id}:${current.id}:${active.id}`;
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
            } else if (played.has(key)) { recover('媒体未能开始播放。'); return; }
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
                if (!success) { if (record.automation.enabled) recover('浏览器未能自动播放。'); else { stop('浏览器未能自动播放，请在当前页手动播放后再继续。'); notify(message); } }
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
                if (record.automation.enabled) recover('播放失败。'); else { stop('播放失败，请手动播放后再继续。'); notify(message); }
              } catch { if (generation === token && status === 'running') stop('页面读取或操作异常，已暂停并退出学习页，请人工确认。', true); }
            });
          }
        } else loading = null;
      } else waitFor('active', '等待平台确认当前课节');
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
      if (preparing?.stage === 'subject') {
        const page = adapter.read();
        return { ...diagnostic, preparingStage: 'subject', subjectIdMatches: page.kind === 'subject' && page.subjectId === preparing.candidate.id,
          subjectTitleMatches: Boolean(page.title?.trim()) && normalizeTitle(page.title) === normalizeTitle(preparing.candidate.title) };
      }
      return diagnostic;
    },
    destroy({ preserveRun = false } = {}) { if (destroyed) return; const keep = preserveRun && record?.automation.enabled && record.automation.resumeOnReload && ['running', 'waiting'].includes(status); stop('面板已关闭，任务已暂停。', true, false, keep); destroyed = true; listeners.clear(); },
  };
}



function createPanel(win, controller, version) {
  const document = win.document;
  const existing = document.getElementById('wangda-assistant');
  if (existing?.wdPanel) return existing.wdPanel;
  const host = document.createElement('div');
  host.id = 'wangda-assistant';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  const element = (tag, text = '', parent = root) => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  element('style', ':host{all:initial;color:#17344d;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif}*{box-sizing:border-box}[hidden]{display:none!important}button,input{font:inherit}button{cursor:pointer;border:1px solid #a8c6e6;background:#f5faff;border-radius:5px;padding:5px 9px;color:#155a9b}button:hover{background:#e6f2ff}button:disabled{opacity:.5;cursor:default}button.primary{background:#176ac2;color:#fff;border-color:#176ac2}section{width:380px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #a9c5e1;border-radius:10px;box-shadow:0 5px 28px #12345630;overflow:hidden}header{padding:10px 12px;background:#edf5ff}header strong{font-size:15px}.headline,.buttons,.row{display:flex;align-items:center;gap:7px}.headline{justify-content:space-between}.buttons{flex-wrap:wrap;margin:9px 0}.row{align-items:flex-start}.row label{flex:1;min-width:0}small,.muted{font-size:12px;color:#56748f}.progress{margin-top:7px;font-size:12px}.body{padding:12px;max-height:calc(100dvh - 155px);overflow-y:auto;overscroll-behavior:contain}.status,.problem{padding:9px;background:#eff6fd;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:5px;margin-bottom:10px}.problem{background:#fff6e8;border:1px solid #edc88d}h2{font-size:14px;margin:10px 0}p{margin:6px 0;overflow-wrap:anywhere}label{display:block;margin-bottom:8px}input[type=text]{width:100%;border:1px solid #b8c9d9;border-radius:4px;background:#fff;color:#17344d;padding:6px}input[type=checkbox]{margin:3px 0;flex-shrink:0}input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid #176ac2;outline-offset:2px}article{border:1px solid #d2e1ef;border-radius:6px;padding:10px;margin:8px 0}article h3{font-size:13px;margin:0 0 5px;overflow-wrap:anywhere}.course{display:flex;align-items:flex-start;gap:7px;margin:0;padding:7px 0;border-bottom:1px solid #edf2f7}.course:last-child{border-bottom:0}.course span{flex:1;overflow-wrap:anywhere}.course small{display:block}.course button{font-size:12px;padding:2px 5px}details{margin:8px 0}summary{cursor:pointer;color:#155a9b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace;margin:6px 0}.candidate{width:100%;text-align:left;overflow-wrap:anywhere;margin:4px 0}.separator{border-top:1px solid #e2ebf3;margin-top:12px;padding-top:3px}');
  const shell = element('section'); shell.setAttribute('aria-label', '网大助手');
  element('style', 'section{display:flex;flex-direction:column;max-height:calc(100dvh - 32px)}header{flex-shrink:0}.body{min-height:0}');
  element('style', '.task-head{display:flex;align-items:flex-start;gap:7px}.task-head h3{flex:1;min-width:0}.sort-actions{display:flex;gap:4px;flex-shrink:0}.sort-actions button{padding:2px 5px;font-size:12px}.sort-handle{cursor:grab}.sort-handle:active{cursor:grabbing}article[data-drop=before]{border-top:3px solid #176ac2}article[data-drop=after]{border-bottom:3px solid #176ac2}article[data-dragging]{opacity:.6}');
  element('style', 'select,input[type=search]{font:inherit;width:100%;border:1px solid #b8c9d9;border-radius:4px;background:#fff;color:#17344d;padding:6px}');
  element('style', 'article[data-state=active]{background:#edf6ff;border-color:#72a9df;box-shadow:inset 3px 0 #176ac2}article[data-state=completed]{background:#f3f4f6;border-color:#d8dee5;color:#65727f}article[data-state=attention]{background:#fff9ef;border-color:#e9c78f}.task-priority{margin:3px 0 7px}.task-current{font-size:12px;color:#155a9b;white-space:pre-wrap}.course[data-state=active]{background:#dfedfc;border-radius:4px;padding:8px;border-left:3px solid #176ac2}.course[data-state=active]>span>span,.course[data-state=active] small{color:#155a9b}.course[data-state=active]>span>span{font-weight:600}.course[data-state=completed]{color:#6b7885}.course[data-state=attention] small{color:#8a5716}progress{display:block;width:100%;height:6px;margin:6px 0 9px;border:0;border-radius:4px;overflow:hidden;background:#e1e8ef;accent-color:#176ac2}progress::-webkit-progress-bar{background:#e1e8ef}progress::-webkit-progress-value{background:#176ac2}progress::-moz-progress-bar{background:#176ac2}article[data-state=completed] progress{accent-color:#8b98a5}article[data-state=completed] progress::-webkit-progress-value{background:#8b98a5}article[data-state=completed] progress::-moz-progress-bar{background:#8b98a5}.course progress{margin-bottom:2px}.playback-time{margin-top:4px;font-variant-numeric:tabular-nums}');
  element('style', '.compact-course,.course-caption,.current-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.course>span{min-width:0}.one-line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.task-current{margin:8px 0}.current-name{font-weight:600}.task-current small{color:inherit}.compact-notice{margin-top:5px;white-space:pre-wrap;overflow-wrap:anywhere}.task-priority{margin-bottom:3px}.task-current .playback-time{margin-top:3px}');
  const header = element('header', '', shell);
  const headline = element('div', '', header); headline.className = 'headline';
  const title = element('div', '', headline); element('strong', '网大助手', title); element('small', ` ${version}`, title);
  const headerButtons = element('div', '', headline); headerButtons.className = 'row';
  const busy = new Set(); const editors = new Set(); let adding = false; let starting = false; let reordering = false; let draggedTaskId = null; let latest = controller.getState();
  const button = (action, text, parent, handler, edit = true) => {
    const node = element('button', text, parent); node.type = 'button'; node.dataset.action = action;
    if (edit) editors.add(node);
    node.addEventListener('click', async () => {
      if (node.disabled || busy.has(node)) return;
      busy.add(node); node.disabled = true;
      try { await handler(); } catch { diagnostic.textContent = '操作未完成，请查看当前状态后重试。'; }
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
  const body = element('div', '', shell); body.className = 'body'; body.hidden = true;
  const execution = element('div', '', body); execution.className = 'status';
  const message = element('div', '', execution);
  const problemBox = element('div', '', body); problemBox.className = 'problem'; problemBox.dataset.problem = '';
  const problemText = element('div', '', problemBox); const problemActions = element('div', '', problemBox); problemActions.className = 'buttons';
  button('retry', '重试本课程', problemActions, () => controller.retry(latest.problem?.taskId, latest.problem?.courseId));
  button('skip', '跳过并继续', problemActions, () => controller.skipCurrent());
  const queueView = element('div', '', body); queueView.dataset.view = 'queue';
  const queueHeading = element('div', '', queueView); queueHeading.className = 'headline'; element('h2', '任务队列', queueHeading);
  button('add', '添加专区', queueHeading, () => { adding = true; render(controller.getState()); target.focus(); });
  element('p', '拖动 ↕ 调整优先级', queueView).className = 'muted';
  const clearCompleted = button('clear-completed', '清除已完成', queueView, () => controller.clearCompletedTasks(), false);
  clearCompleted.title = '清理已完成专区，保留执行中、未完成和待处理任务。';
  const empty = element('p', '还没有任务，点击“添加专区”开始。', queueView); empty.className = 'muted';
  const taskList = element('div', '', queueView);
  const queueControls = element('div', '', queueView); queueControls.className = 'buttons';
  const startButton = button('start', '开始 / 继续队列', queueControls, () => startQueue()); startButton.className = 'primary';
  const addView = element('div', '', body); addView.dataset.view = 'add';
  element('h2', '添加专区', addView);
  const searchBox = element('div', '', addView);
  const labelInput = (caption, name, parent) => { const label = element('label', caption, parent); const input = element('input', '', label); input.type = 'text'; input.name = name; input.id = `wd-${name}`; label.htmlFor = input.id; editors.add(input); return input; };
  const target = labelInput('专区名称', 'target', searchBox);
  const searchActions = element('div', '', searchBox); searchActions.className = 'buttons';
  button('search', '搜索专区', searchActions, () => controller.search(target.value.trim()));
  button('collect', '读取当前专区', searchActions, () => controller.collectDraft());
  const candidates = element('div', '', addView); candidates.dataset.candidates = '';
  const draftBox = element('div', '', addView); draftBox.dataset.draft = '';
  const draftTitle = element('h3', '', draftBox);
  const draftHelp = element('p', '核对课程后加入队列；已完成和待确认课程默认不勾选。', draftBox); draftHelp.className = 'muted';
  const draftCourses = createCourseList(draftBox);
  const addActions = element('div', '', draftBox); addActions.className = 'buttons';
  const addDraftButton = button('add-draft', '加入队列', addActions, async () => { if (await controller.addDraft()) { adding = false; target.value = ''; } }); addDraftButton.className = 'primary';
  button('back', '取消添加，返回队列', addView, async () => { if (await controller.discardDraft() !== false) { adding = false; target.value = ''; } });
  const windowBox = element('details', '', body); windowBox.className = 'separator'; element('summary', '学习时段（北京时间）', windowBox);
  const windowRow = element('div', '', windowBox); windowRow.className = 'row';
  const fields = { start: labelInput('开始时间', 'start', windowRow), end: labelInput('结束时间（支持24:00）', 'end', windowRow) };
  const dirty = new Set(); for (const [name, field] of Object.entries(fields)) field.addEventListener('input', () => dirty.add(name));
  button('save-window', '保存学习时段', windowBox, () => saveWindow());
  const autoBox = element('div', '', body); autoBox.className = 'separator'; element('h2', '自动模式', autoBox);
  function automaticInput(name, caption) {
    const label = element('label', '', autoBox); const input = element('input', '', label); input.type = 'checkbox'; input.name = name; editors.add(input);
    element('span', ` ${caption}`, label);
    input.addEventListener('change', async () => {
      if (input.disabled) return;
      busy.add(input); input.disabled = true;
      try { await controller.setAutomation({ enabled: automatic.checked, resumeOnReload: automatic.checked && resumeOnReload.checked, mute: mute.checked }); }
      catch { diagnostic.textContent = '自动设置保存失败，请重试。'; }
      finally { busy.delete(input); render(controller.getState()); }
    }); return input;
  }
  const automatic = automaticInput('automatic', '自动重试、暂存异常课程并续学');
  const resumeOnReload = automaticInput('resumeOnReload', '刷新或重新打开后恢复已开始的队列');
  const mute = automaticInput('mute', '自动静音课程');
  mute.title = '开启时持续保持静音；需要声音时请暂停任务后关闭此选项。';
  element('p', '自动重试开启后，按学习时段续学；主动暂停会取消自动执行。需保持网大页面打开。', autoBox).className = 'muted';
  const utility = element('div', '', body); utility.className = 'buttons';
  button('stop-learning', '停止学习并退出', utility, () => controller.pause(), false);
  button('diagnose', '页面诊断', utility, () => { diagnostic.textContent = JSON.stringify(controller.diagnose(), null, 2); }, false);
  const diagnostic = element('pre', '', body);
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
  const phaseLabel = state => ({ paused: '已暂停', preparing: '正在准备', running: '学习中', complete: '已完成', retrying: '正在重试', waiting: '等待学习时段', offline: '等待网络', resuming: '正在恢复' }[state.phase || state.status] || '等待确认');
  const playbackFor = (item, courseId) => {
    const value = latest.currentPlayback;
    return currentTask(item) && latest.status === 'running' && !['retrying', 'offline', 'resuming'].includes(latest.phase) && value?.taskId === item.id && value.courseId === courseId ? value : null;
  };
  const executionLabel = (item, courseId = latest.currentCourseId) => {
    if (latest.status !== 'running' || ['retrying', 'offline', 'resuming'].includes(latest.phase)) return phaseLabel(latest);
    if (isDone(item, courseId)) return '正在切换课程';
    const playback = playbackFor(item, courseId);
    if (playback) return playback.ended ? '等待平台确认完成' : playback.paused ? '正在准备播放' : '正在播放';
    return latest.currentSectionTitle ? '学习中' : '正在进入课程';
  };
  const clock = value => { const seconds = Math.floor(value); const minutes = Math.floor(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  const playbackText = value => Number.isFinite(value?.currentTime) && Number.isFinite(value?.duration) && value.currentTime >= 0 && value.duration > 0 ? `${clock(Math.min(value.currentTime, value.duration))} / ${clock(value.duration)}` : '';
  const quietMessages = new Set(['已暂停', '已完成', '执行中', '学习中', '已暂停，确认配置和课程后点击开始。', '已暂停，继续学习需手动点击开始。', '正在按平台课节状态连续学习。', '等待平台确认当前课节完成。', '所选课程已全部完成。', '已进入学习时段，正在继续队列。', '正在重新进入课程。']);
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
    try { if (!await controller.moveTask(id, index)) diagnostic.textContent = '顺序未保存，请查看当前提示后重试。'; }
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
    const modeLabel = element('label', '学习范围', parent); const mode = element('select', '', modeLabel); mode.name = `course-mode-${taskId || 'draft'}`; editors.add(mode);
    for (const [value, text] of [['all-pending', '专区全部待学（可调整勾选）'], ['specific', '指定课程（只学手动选择）']]) { const option = element('option', text, mode); option.value = value; }
    element('p', '切换范围会重设勾选。', parent).className = 'muted';
    mode.addEventListener('change', async () => {
      if (mode.disabled) return; busy.add(mode); mode.disabled = true;
      try { await controller.setTaskMode(taskId, mode.value); } catch { diagnostic.textContent = '学习范围未保存，请重试。'; }
      finally { busy.delete(mode); render(controller.getState()); }
    });
    const filterLabel = element('label', '筛选课程名称', parent); const filter = element('input', '', filterLabel); filter.type = 'search'; filter.name = `course-filter-${taskId || 'draft'}`; filter.placeholder = '输入课程名称或关键词';
    filter.addEventListener('input', () => render(controller.getState()));
    const selection = element('p', '', parent); selection.className = 'muted';
    element('p', '筛选不会取消隐藏勾选；批量操作作用于整份清单。', parent).className = 'muted';
    const controls = element('div', '', parent); controls.className = 'buttons';
    for (const [mode, caption] of [['unfinished', '全部未完成'], ['required', '仅必修'], ['none', '清空选择'], ['completed', '勾选已完成']]) button(`select-${mode}-${taskId || 'draft'}`, caption, controls, () => controller.selectCourses(taskId, mode));
    const pending = element('div', '', parent); const completed = element('details', '', parent); completed.dataset.completed = '';
    const summary = element('summary', '已完成课程', completed); const completeList = element('div', '', completed);
    const noMatches = element('p', '没有匹配的课程，请调整关键词。', parent); noMatches.dataset.noMatches = ''; noMatches.className = 'muted';
    return { pending, completed, summary, completeList, nodes: new Map(), mode, filter, selection, noMatches };
  }
  function updateCourses(view, courses, item = null) {
    const ids = new Set(courses.map(course => course.id));
    for (const [id, row] of view.nodes) if (!ids.has(id)) { editors.delete(row.input); if (row.retry) editors.delete(row.retry); row.label.remove(); view.nodes.delete(id); }
    let completedCount = 0, visibleCount = 0, matchedCompleted = 0;
    const query = view.filter.value.trim().toLocaleLowerCase();
    view.mode.value = (item || latest.draft)?.selectionMode || 'all-pending';
    view.selection.textContent = `已选 ${courses.filter(course => course.selected && (item?.scope !== 'required' || course.required)).length} 门 / 共 ${courses.length} 门`;
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
          catch { diagnostic.textContent = '勾选未能保存，请重试。'; }
          finally { busy.delete(input); render(controller.getState()); }
        });
        const retry = item ? button(`retry-${item.id}-${course.id}`, '重试', label, () => controller.retry(item.id, course.id)) : null;
        row = { label, input, caption, meta, section, retry, time, playback }; view.nodes.set(course.id, row);
      }
      const recheck = item?.recheck?.includes(course.id);
      const current = item && currentTask(item) && latest.currentCourseId === course.id && !isDone(item, course.id);
      const done = !current && !recheck && (isDone(item, course.id) || course.status === 'completed'); const skipped = item?.skipped.includes(course.id);
      const deferred = item?.deferred?.find(entry => entry.courseId === course.id);
      const status = deferred ? `待处理：${deferred.reason}` : skipped ? '已跳过' : current ? executionLabel(item, course.id) : recheck ? '待复查课节' : isDone(item, course.id) ? '已完成' : ({ completed: '已完成', learning: '学习中', 'not-started': '未开始', unknown: '待确认' }[course.status] || '待确认');
      row.label.dataset.state = current ? 'active' : deferred || skipped ? 'attention' : done ? 'completed' : 'pending';
      const playback = current ? playbackFor(item, course.id) : null; const timeText = playbackText(playback);
      row.time.textContent = timeText; row.time.hidden = !timeText; row.playback.hidden = !timeText;
      row.playback.max = timeText ? playback.duration : 1; row.playback.value = timeText ? Math.min(playback.currentTime, playback.duration) : 0;
      row.caption.textContent = course.title; row.caption.title = course.title; row.meta.textContent = `${status} · ${course.required ? '必修' : '选修'}`; row.input.checked = course.selected;
      row.section.textContent = current && latest.currentSectionTitle ? `课节 · ${latest.currentSectionTitle}` : ''; row.section.title = latest.currentSectionTitle || ''; row.section.hidden = !row.section.textContent;
      row.input.disabled = latest.unavailable || ['running', 'preparing', 'waiting'].includes(latest.status) || Boolean(item?.scope === 'required' && !course.required);
      row.input.dataset.legacyDisabled = String(Boolean(item?.scope === 'required' && !course.required));
      if (row.retry) row.retry.hidden = !skipped && !deferred;
      const container = done && !skipped && !deferred ? view.completeList : view.pending;
      if (row.label.parentNode !== container) container.append(row.label);
      if (done && !skipped && !deferred) completedCount += 1;
      row.label.hidden = Boolean(query && !course.title.toLocaleLowerCase().includes(query));
      if (!row.label.hidden) { visibleCount += 1; if (container === view.completeList) matchedCompleted += 1; }
    }
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
        const up = button(`move-up-${item.id}`, '上移', sorting, () => movePriority(item.id, -1), false);
        const down = button(`move-down-${item.id}`, '下移', sorting, () => movePriority(item.id, 1), false);
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
          const from = latest.tasks.findIndex(task => task.id === id), target = latest.tasks.findIndex(task => task.id === item.id);
          const insertion = target + Number(after(event)); clearDrag();
          if (from < 0 || target < 0 || id === item.id || completeTask(latest.tasks[from])) return;
          try { await moveDisplayedTask(id, insertion - Number(from < insertion)); }
          catch { diagnostic.textContent = '顺序未保存，请查看当前提示后重试。'; }
        });
        const priority = element('p', '', article); priority.className = 'task-priority muted';
        const summary = element('p', '', article); summary.dataset.taskSummary = item.id;
        const completion = element('progress', '', article); completion.dataset.taskProgress = item.id;
        const current = element('div', '', article); current.className = 'task-current';
        const currentName = element('div', '', current); currentName.className = 'current-name';
        const currentSection = element('small', '', current); currentSection.className = 'one-line';
        const currentTime = element('small', '', current); currentTime.className = 'playback-time';
        const detailButton = button(`detail-${item.id}`, '查看详情', article, () => { detail.hidden = !detail.hidden; detailButton.textContent = detail.hidden ? '查看详情' : '收起详情'; detailButton.setAttribute('aria-expanded', String(!detail.hidden)); }, false); detailButton.setAttribute('aria-expanded', 'false');
        const detail = element('div', '', article); detail.dataset.taskDetail = item.id; detail.hidden = true;
        const legacy = element('p', '旧任务仅执行必修课程和课节；需要包含选修可移出后重新添加专区。', detail); legacy.className = 'muted';
        const courses = createCourseList(detail, item.id); const actions = element('div', '', detail); actions.className = 'buttons';
        const refresh = button(`refresh-${item.id}`, '更新清单', actions, () => controller.refreshTask(item.id));
        button(`recheck-${item.id}`, '复查所选已完成课程', actions, () => controller.recheckCompleted(item.id));
        button(`remove-${item.id}`, '移出队列', actions, () => controller.removeTask(item.id));
        view = { article, title, priority, summary, completion, current, currentName, currentSection, currentTime, detail, legacy, courses, refresh, handle, up, down }; taskNodes.set(item.id, view);
      }
      view.title.textContent = item.subject?.title || item.target;
      view.handle.setAttribute('aria-label', `拖动排序：${item.subject?.title || item.target}`);
      const sortable = sortableTasks(); const priorityIndex = sortable.findIndex(task => task.id === item.id); const completed = completeTask(item), current = currentTask(item, state);
      view.handle.disabled = !canSort() || completed || sortable.length < 2; view.handle.draggable = !view.handle.disabled;
      view.up.disabled = !canSort() || completed || priorityIndex <= 0; view.down.disabled = !canSort() || completed || priorityIndex === sortable.length - 1;
      view.up.title = '提高执行优先级，当前课程继续'; view.down.title = '降低执行优先级，当前课程继续';
      const total = counts(item);
      const status = !item.subject ? '尚未读取专区，请移出后重新添加' : !total.selected ? '尚未选择课程' : current ? executionLabel(item) : total.deferred ? '有待处理课程' : item.skipped.length ? '有跳过课程待重试' : item.recheck?.length ? '有待复查课程' : completed ? '全部完成' : '待学习';
      view.article.dataset.state = current ? 'active' : completed ? 'completed' : total.deferred || item.skipped.length || item.recheck?.length ? 'attention' : 'pending';
      view.priority.textContent = `优先级 ${priorityIndex + 1}`; view.priority.hidden = completed;
      const issues = [['待处理', total.deferred], ['跳过', item.skipped.length], ['待复查', item.recheck?.length || 0]].filter(([, count]) => count).map(([name, count]) => `${name} ${count}`);
      view.summary.textContent = completed ? `已完成 ${total.selected} 门` : `${status} · 完成 ${total.done}/${total.selected} 门${issues.length ? ` · ${issues.join(' · ')}` : ''}`;
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
    const labels = { paused: '已暂停', preparing: '正在准备', running: '学习中', complete: '已完成', retrying: '正在重试', waiting: '等待学习时段', offline: '等待网络', resuming: '正在恢复' };
    const all = state.tasks.reduce((sum, task) => { const c = counts(task); return { done: sum.done + c.done, selected: sum.selected + c.selected, deferred: sum.deferred + c.deferred }; }, { done: 0, selected: 0, deferred: 0 });
    progress.textContent = `${labels[state.phase || state.status] || state.status} · 总完成 ${all.done}/${all.selected} 门${all.deferred ? ` · 待处理 ${all.deferred}` : ''}`;
    compact.textContent = active?.courses.find(course => course.id === state.currentCourseId)?.title || ''; compact.title = compact.textContent; compact.hidden = !body.hidden || !compact.textContent;
    compactTime.textContent = active ? playbackText(playbackFor(active, state.currentCourseId)) : ''; compactTime.hidden = !body.hidden || !compactTime.textContent;
    const notice = quietMessages.has(state.message) ? '' : state.message;
    message.textContent = notice; execution.hidden = !notice || notice === state.problem?.reason;
    compactNotice.textContent = notice || state.problem?.reason || ''; compactNotice.hidden = !body.hidden || !compactNotice.textContent;
    problemBox.hidden = !state.problem;
    if (state.problem) { const item = state.tasks.find(task => task.id === state.problem.taskId); problemText.textContent = `${item?.subject?.title || item?.target || '专区'} · ${item?.courses.find(course => course.id === state.problem.courseId)?.title || '课程'}\n${state.problem.reason}`; }
    if (state.draft) adding = true;
    else if (draftSubjectId && state.tasks.some(item => item.subject?.id === draftSubjectId)) adding = false;
    draftSubjectId = state.draft?.subject.id || null;
    queueView.hidden = adding; addView.hidden = !adding; searchBox.hidden = Boolean(state.draft); draftBox.hidden = !state.draft;
    empty.hidden = state.tasks.length > 0;
    for (const [name, field] of Object.entries(fields)) if (!dirty.has(name) && root.activeElement !== field) field.value = state.window[name];
    updateTasks(state);
    const signature = JSON.stringify(state.candidates);
    if (candidateSignature !== signature) { candidateSignature = signature; for (const control of candidates.querySelectorAll('button')) editors.delete(control); candidates.replaceChildren(); if (state.candidates.length) element('p', '请选择要添加的专区：', candidates); for (const item of state.candidates) { const candidate = button(`candidate-${item.id}`, item.title, candidates, () => controller.chooseCandidate(item.id)); candidate.className = 'candidate'; } }
    candidates.hidden = !adding || Boolean(state.draft) || running || !state.candidates.length;
    if (state.draft) { draftTitle.textContent = state.draft.subject.title; updateCourses(draftCourses, state.draft.courses); }
    for (const control of editors) control.disabled = running || state.unavailable || control.dataset.legacyDisabled === 'true';
    automatic.checked = state.automation?.enabled === true; resumeOnReload.checked = state.automation?.resumeOnReload === true; mute.checked = state.automation?.mute !== false;
    resumeOnReload.disabled ||= !automatic.checked;
    for (const control of problemActions.querySelectorAll('button')) control.disabled ||= adding;
    const hasPending = state.tasks.some(item => item.subject && eligible(item).some(course => !isDone(item, course.id) && !item.skipped.includes(course.id) && !item.deferred?.some(entry => entry.courseId === course.id)));
    const cannotStart = starting || state.unavailable || adding || Boolean(state.draft) || !hasPending;
    const hasStarted = Boolean(state.currentCourseId) || state.tasks.some(item => item.current || item.done.length || item.skipped.length || item.deferred?.length);
    startButton.disabled = running || cannotStart;
    const completedCount = state.tasks.filter(item => completeTask(item) && !(running && item.id === state.activeTaskId)).length;
    clearCompleted.textContent = `清除已完成${completedCount ? `（${completedCount}）` : ''}`;
    clearCompleted.disabled = !completedCount || state.unavailable || state.status === 'preparing' || state.phase === 'resuming';
    runButton.textContent = running ? '暂停' : state.status === 'complete' ? '已完成' : hasStarted ? '继续' : '开始';
    runButton.disabled = starting || (!running && cannotStart); toggle.disabled = false;
    for (const control of busy) control.disabled = true;
  }
  const unsubscribe = controller.subscribe(render);
  const panel = { open() { setOpen(true); }, destroy() { unsubscribe(); host.remove(); } };
  host.wdPanel = panel; document.documentElement.append(host); render(controller.getState());
  return panel;
}





const wdMainVersion = "0.1.0-beta.14";

function wdMainBootstrap(win) {
  if (win.location.protocol !== 'https:' || win.location.hostname !== 'wangda.chinamobile.com' || win.top !== win.self) return;
  if (win.__wangdaAssistantInstance) return;
  const storage = typeof GM_getValue === 'function' && typeof GM_setValue === 'function'
    ? { get: key => GM_getValue(key), set: (key, value) => GM_setValue(key, value) } : null;
  const controller = createController({ adapter: createAdapter(win), storage, locks: win.navigator.locks,
    setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win),
    notify: text => { if (typeof GM_notification === 'function') GM_notification({ title: '网大助手', text }); },
  });
  const panel = createPanel(win, controller, wdMainVersion);
  const destroy = event => { controller.destroy({ preserveRun: event?.type === 'beforeunload' }); panel.destroy(); win.removeEventListener('beforeunload', destroy); delete win.__wangdaAssistantInstance; };
  win.__wangdaAssistantInstance = { destroy };
  win.addEventListener('beforeunload', destroy);
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('打开网大助手', () => panel.open());
}

if (typeof window !== 'undefined') wdMainBootstrap(window);

})();
