import { createAdapter } from './adapter.js';
import { createController } from './controller.js';
import { createPanel } from './panel.js';

const wdMainVersion = '__WD_VERSION__';

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
