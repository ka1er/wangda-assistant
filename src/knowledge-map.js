import { parseSeekHref } from './knowledge-vtt.js';

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

export async function loadMarkmapEngine({ importer, timeoutMs = 4500 } = {}) {
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

export function parseMarkdownOutline(markdown) {
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

export async function renderKnowledgeMindmap({ svg, markdown, onSeek, importer, skipCdn = false } = {}) {
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
