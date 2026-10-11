const wdCoreAutomaticTypes = new Set([1, 2, 5, 6, 7, 20]);

export function normalizeTitle(text) {
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

export function parseNotice(text) {
  const normalized = String(text ?? '').normalize('NFKC').replace(/\r\n?/gu, '\n');
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const target = wdCoreNoticeTarget(lines);
  const time = wdCoreNoticeWindow(normalized);
  const warnings = [];
  if (!target) warnings.push('未能明确识别课程或专区名称，请填写准确的学习目标。');
  if (time.warning) warnings.push(time.warning);
  return { target, scope: wdCoreScope(normalized), window: time.window, warnings, valid: Boolean(target) && time.valid };
}

export function isWithinWindow(date, window) {
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

export function chooseNextSection(sections, scope = 'all') {
  return (Array.isArray(sections) ? sections : []).find(section => section && wdCoreInScope(section, scope) && section.status !== 'completed') || null;
}

export function decideLearningAction(snapshot, task) {
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
