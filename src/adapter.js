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

export function readPage(document, hash) {
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

export function createAdapter(win) {
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
