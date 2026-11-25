import { formatTimestamp, parseTimestampToSeconds, cleanAndSegmentCues } from './knowledge-vtt.js';

export const WD_CITATION_DEFAULTS = {
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

export function formatSegmentId(index) {
  const num = Math.max(1, Math.floor(Number(index) || 1));
  return `S${String(num).padStart(2, '0')}`;
}

export function formatSegmentDisplayId(segId) {
  const norm = normalizeSegmentId(segId);
  return norm ? `[${norm.segId}]` : String(segId || '');
}

export function buildSegmentRefKey(sectionId, segId) {
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

export function normalizeSegmentId(raw) {
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

export function assignStableSegmentIds(rawSegments, sectionId = 'current') {
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

export function buildSegmentIndex(sectionOrSegments, options = {}) {
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

export function buildCourseSegmentIndex(sections = []) {
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

export function normalizeCitationCompareText(text) {
  return wdKcitToHalfWidth(String(text ?? ''))
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function computeCitationLiteralOverlap(excerpt, sourceText) {
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

export function verifyCitation(rawInput, indexOrCourseIndex, options = {}) {
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

export function extractSegmentIdsFromText(text) {
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

export function tokenizeTextWithCitations(text) {
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
