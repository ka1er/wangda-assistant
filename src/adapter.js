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

export function readPage(document, hash) {
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

export function createAdapter(win) {
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
