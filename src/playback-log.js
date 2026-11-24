const wdPlaybackLogLimit = 400;

function wdPlaybackNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

export function createPlaybackLog(now) {
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
      control: media?.control ?? null, courseRetries, resumeFailures, ...details,
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
      media = page.media ? { ...page.media, id: page.player?.id, readyState: page.player?.readyState, control: page.player?.control } : null;
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
