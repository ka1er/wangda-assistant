const wdQueueStatuses = new Set(['completed', 'learning', 'not-started', 'unknown']);
const wdQueueId = /^[A-Za-z0-9_-]+$/u;
const wdQueueStrings = value => Array.isArray(value) && value.every(id => typeof id === 'string') && new Set(value).size === value.length;

export function validWindow(window) {
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

export function normalizeQueue(value) {
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

export function mergeCourses(previous, incoming, selectionMode = 'all-pending') {
  const old = new Map(previous.map(course => [course.id, course]));
  const result = incoming.map(({ id, title, route, required, status }) => ({ id, title, route, required: required === true, status: wdQueueStatuses.has(status) ? status : 'unknown', selected: old.has(id) ? old.get(id).selected : selectionMode !== 'specific' && ['learning', 'not-started'].includes(status) }));
  const seen = new Set(result.map(course => course.id));
  for (const course of previous) if (!seen.has(course.id)) result.push({ ...course, status: 'unknown' });
  return result;
}
