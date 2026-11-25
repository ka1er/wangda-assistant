const wdKvttAllowedVttHosts = host => typeof host === 'string' && (host === 'wangda.chinamobile.com' || host.endsWith('.wangda.chinamobile.com'));
const wdKvttCourseRoutePattern = /^#\/study\/course\/detail\/(?:subject-course\/)?([A-Za-z0-9_-]+)(?:\/(\d+)(?:\/([A-Za-z0-9_-]+))?)?$/u;
const wdKvttNoisePattern = /(?:\[音乐\]|\[掌声\]|\[笑声\]|\(音乐\)|\(掌声\)|（音乐）|（掌声）|[♪♫♬]+)/gu;
const wdKvttDiscoursePattern = /^(?:接下来|首先|其次|再次|第一|第二|第三|第四|最后|总结一下|总的来说|下面我们|那么下面|换句话说|另一方面|需要注意)/u;
const wdKvttStopWords = new Set(['我们', '你们', '他们', '这个', '那个', '就是', '然后', '所以', '因为', '可以', '一个', '一些', '这里', '那里', '大家', '其实', '如果', '那么', '什么', '怎么', '这样', '那样', '进行', '通过', '以及', '或者', '已经', '现在', '时候', '问题', '方面', '内容', '课程', '一下', '不是', '没有', '需要', '非常', '比较', '首先', '接下来', '介绍', '学习', '今天', '关于', '里面']);
const wdKvttSensitiveQueryParams = new Set(['token', 'access_token', 'auth_key', 'sign', 'signature', 'key', 'secret', 'ticket', 'pwd', 'password']);

export const SUBTITLE_FALLBACK_ORDER = [
  { id: 'captionVtt', label: '1. 课节 captionVtt 直链（app._modules trackUrl / trackList）' },
  { id: 'videojs-textTracks', label: '2. Video.js textTracks（含切换 AI 字幕开关后再读）' },
  { id: 'other-sources', label: '3. 页面/接口其它字幕来源（caption 接口 / 原生 video.textTracks / DOM <track>）' },
];

export function redactSubtitleUrl(rawUrl) {
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

export function formatSubtitleDiagnosticsText(diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  if (!list.length) return '暂无字幕抓取诊断记录。';
  return list.map((item, idx) => {
    const statusText = item.status !== null && item.status !== undefined ? `HTTP ${item.status}` : '非HTTP';
    const okTag = item.ok ? '成功' : '失败';
    const urlPart = item.url ? ` | url=${item.url}` : '';
    return `${idx + 1}. [${okTag}] 《${item.sectionTitle || item.sectionId || '当前课节'}》 ${item.pathLabel || item.path} | ${statusText} | cues=${item.cueCount ?? 0}${urlPart} | ${item.reason || ''}`;
  }).join('\n');
}

export function formatTimestamp(seconds) {
  const num = Number(seconds);
  if (!Number.isFinite(num) || num < 0) return '00:00';
  const total = Math.floor(num);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function parseTimestampToSeconds(value) {
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

export function escapeMarkdownText(text) {
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

export function parseWebVtt(rawText) {
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

export function cleanAndSegmentCues(rawCues, options = {}) {
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

export function estimateTextTokens(text) {
  const str = String(text ?? '');
  if (!str) return 0;
  const cjk = (str.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/gu) || []).length;
  const other = str.length - cjk;
  return Math.ceil(cjk * 0.75 + other * 0.3);
}

export function estimateKnowledgeTokens(courseData, scope = 'course', options = {}) {
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

export function buildSeekHref(sectionId, seconds) {
  const secNum = Math.max(0, Math.floor(Number(seconds) || 0));
  const safeId = encodeURIComponent(String(sectionId || 'current'));
  return `#wd-seek-${safeId}-${secNum}`;
}

export function parseSeekHref(href) {
  const match = /^#wd-seek-([^#]+)-(\d+)$/u.exec(String(href ?? '').trim());
  if (!match) return null;
  try {
    return { sectionId: decodeURIComponent(match[1]), seconds: Number(match[2]) };
  } catch {
    return { sectionId: match[1], seconds: Number(match[2]) };
  }
}

export function buildKnowledgeMarkdown(tree, options = {}) {
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

export function buildZeroAiSectionTree(section, highlights = []) {
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

export function buildScopeLabel(scope, sections) {
  const list = Array.isArray(sections) ? sections : [];
  const captioned = list.filter(s => s.hasSubtitle === true || (s.hasSubtitle !== false && s.mode !== 'placeholder' && (s.timeline?.length || s.outline?.length || s.topics?.length))).length;
  if (scope === 'section' || list.length <= 1) {
    const title = list[0]?.title || '当前课节';
    return list[0]?.hasSubtitle === false ? `当前课节（${title} · 无字幕）` : `当前课节（${title}）`;
  }
  return `整门课（共 ${list.length} 节，其中 ${captioned} 节含字幕）`;
}

export function buildZeroAiGuide(courseData, options = {}) {
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

export function selectCaptionTrack(tracks) {
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

export function resolveActiveVjsPlayer(pageWin, doc) {
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

export function readCourseHighlights(doc) {
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

export function parseCourseHash(hash) {
  const match = wdKvttCourseRoutePattern.exec(String(hash ?? ''));
  if (!match) return { isCourse: false, courseId: null, subjectId: null };
  return { isCourse: true, courseId: match[1], subjectId: match[3] || null };
}

export function probeCourseSubtitleHints(pageWin, doc) {
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

export function createSubtitleAvailabilityProber({ win, pageWin = win, httpGet, maxConcurrency = 2 } = {}) {
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

export async function collectCourseSubtitles({ win, pageWin = win, scope = 'course', sectionId = null, httpGet, signal, allowToggleCaptions = true, toggleWaitMs = 240 } = {}) {
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

export function seekCourseTime({ win, pageWin = win, adapter, sectionId, seconds, queueRunning = false } = {}) {
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
