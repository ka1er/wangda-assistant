import { isTaskComplete } from './queue.js';
import { formatTimestamp, buildKnowledgeMarkdown, formatSubtitleDiagnosticsText } from './knowledge-vtt.js';
import { createKnowledgeService, getAiProviderPreset, WD_AI_PRIVACY_NOTICE, WD_AI_PROVIDERS } from './knowledge-ai.js';
import { sectionHasSubtitle, loadSectionChat, clearSectionChat, askSectionQuestion, loadSectionQuiz, saveSectionQuiz, gradeSectionQuiz, generateSectionQuiz, mountSectionGuideButtons } from './knowledge-tutor.js';
import { renderKnowledgeMindmap } from './knowledge-map.js';

export function createPanel(win, controller, version, knowledge = null) {
  const document = win.document;
  const existing = document.getElementById('wangda-assistant');
  if (existing?.wdPanel) return existing.wdPanel;
  const kg = knowledge || createKnowledgeService({ win, pageWin: win, controller });
  const host = document.createElement('div');
  host.id = 'wangda-assistant';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  const wdUiThemeKey = 'wangda-assistant.ui.theme';
  const loadUiTheme = () => {
    try {
      const val = win.localStorage?.getItem?.(wdUiThemeKey);
      return ['auto', 'light', 'dark'].includes(val) ? val : 'auto';
    } catch { return 'auto'; }
  };
  const applyUiTheme = mode => {
    const valid = ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto';
    host.dataset.theme = valid;
    try { win.localStorage?.setItem?.(wdUiThemeKey, valid); } catch { /* ignore */ }
    return valid;
  };
  host.dataset.theme = loadUiTheme();
  const element = (tag, text = '', parent = root) => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  element('style', [
    ':host{all:initial;--bg:#ffffff;--surface:#f8fafc;--surface-2:#f1f5f9;--surface-hover:#e9eef5;--border:rgba(15,23,42,.10);--border-strong:rgba(15,23,42,.18);--text:#0f172a;--text-2:#475569;--text-3:#64748b;--accent:#2563eb;--accent-hover:#1d4ed8;--accent-soft:rgba(37,99,235,.08);--accent-border:rgba(37,99,235,.26);--accent-text:#1d4ed8;--success:#15803d;--success-soft:#ecfdf5;--success-border:#a7f3d0;--warn:#9a3412;--warn-soft:#fff7ed;--warn-border:#fed7aa;--danger:#dc2626;--danger-hover:#b91c1c;--danger-soft:#fef2f2;--danger-border:#fecaca;--cache:#6d28d9;--cache-soft:#f5f3ff;--ring:rgba(37,99,235,.32);--radius-xs:6px;--radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-pill:999px;--shadow-panel:0 12px 36px rgba(15,23,42,.14),0 2px 8px rgba(15,23,42,.06);--shadow-modal:0 24px 64px rgba(2,6,23,.32),0 4px 16px rgba(2,6,23,.14);color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Inter","PingFang SC","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}',
    '@media (prefers-color-scheme:dark){:host(:not([data-theme="light"])){--bg:#0f172a;--surface:#162032;--surface-2:#1e293b;--surface-hover:#263449;--border:rgba(148,163,184,.18);--border-strong:rgba(148,163,184,.30);--text:#f1f5f9;--text-2:#cbd5e1;--text-3:#94a3b8;--accent:#3b82f6;--accent-hover:#60a5fa;--accent-soft:rgba(59,130,246,.16);--accent-border:rgba(96,165,250,.36);--accent-text:#93c5fd;--success:#4ade80;--success-soft:rgba(34,197,94,.14);--success-border:rgba(74,222,128,.32);--warn:#fdba74;--warn-soft:rgba(249,115,22,.14);--warn-border:rgba(251,146,60,.34);--danger:#f87171;--danger-hover:#ef4444;--danger-soft:rgba(239,68,68,.15);--danger-border:rgba(248,113,113,.34);--cache:#c4b5fd;--cache-soft:rgba(139,92,246,.18);--ring:rgba(96,165,250,.45);--shadow-panel:0 14px 40px rgba(0,0,0,.48),0 2px 10px rgba(0,0,0,.32);--shadow-modal:0 28px 72px rgba(0,0,0,.64),0 6px 20px rgba(0,0,0,.4)}}',
    ':host([data-theme="dark"]){--bg:#0f172a;--surface:#162032;--surface-2:#1e293b;--surface-hover:#263449;--border:rgba(148,163,184,.18);--border-strong:rgba(148,163,184,.30);--text:#f1f5f9;--text-2:#cbd5e1;--text-3:#94a3b8;--accent:#3b82f6;--accent-hover:#60a5fa;--accent-soft:rgba(59,130,246,.16);--accent-border:rgba(96,165,250,.36);--accent-text:#93c5fd;--success:#4ade80;--success-soft:rgba(34,197,94,.14);--success-border:rgba(74,222,128,.32);--warn:#fdba74;--warn-soft:rgba(249,115,22,.14);--warn-border:rgba(251,146,60,.34);--danger:#f87171;--danger-hover:#ef4444;--danger-soft:rgba(239,68,68,.15);--danger-border:rgba(248,113,113,.34);--cache:#c4b5fd;--cache-soft:rgba(139,92,246,.18);--ring:rgba(96,165,250,.45);--shadow-panel:0 14px 40px rgba(0,0,0,.48),0 2px 10px rgba(0,0,0,.32);--shadow-modal:0 28px 72px rgba(0,0,0,.64),0 6px 20px rgba(0,0,0,.4)}',
    '*{box-sizing:border-box}[hidden]{display:none!important}button,input,select{font:inherit}',
    'button{cursor:pointer;border:1px solid var(--border-strong);background:var(--surface);border-radius:var(--radius-sm);padding:4px 10px;min-height:30px;color:var(--text);font-size:12.5px;font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:4px;transition:background .14s ease,border-color .14s ease,color .14s ease,transform .1s ease}',
    'button:hover:not(:disabled){background:var(--surface-hover);border-color:var(--border-strong)}button:active:not(:disabled){transform:scale(.98)}button:disabled{opacity:.46;cursor:not-allowed;filter:grayscale(.3)}',
    'button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.primary:hover:not(:disabled){background:var(--accent-hover);border-color:var(--accent-hover)}',
    'button.soft{background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border)}button.soft:hover:not(:disabled){background:var(--accent-border)}',
    'button.danger{color:var(--danger);border-color:var(--danger-border);background:var(--danger-soft)}button.danger:hover:not(:disabled){background:var(--danger-border)}',
    'button.danger-confirm{background:var(--danger);color:#fff;border-color:var(--danger)}button.danger-confirm:hover:not(:disabled){background:var(--danger-hover)}',
    'button.ghost{background:transparent;border-color:var(--border);color:var(--text-2)}button.ghost:hover:not(:disabled){background:var(--surface-2);color:var(--text)}',
    'section{width:372px;max-width:calc(100vw - 32px);display:flex;flex-direction:column;max-height:calc(100dvh - 32px);background:var(--bg);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-panel);overflow:hidden}',
    'header{flex-shrink:0;padding:12px 14px 10px;background:var(--surface);border-bottom:1px solid var(--border)}',
    'header strong{font-size:14px;font-weight:600;letter-spacing:-0.01em;color:var(--text)}.brand-wrap{display:flex;align-items:center;gap:7px}.brand-dot{width:8px;height:8px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);flex-shrink:0}',
    '.headline,.buttons,.row{display:flex;align-items:center;gap:6px}.headline{justify-content:space-between}.buttons{flex-wrap:wrap;margin:8px 0}.detail-actions{justify-content:space-between}.leave-bar{margin:0 0 10px}.row{align-items:flex-start}.row label{flex:1;min-width:0}',
    'small,.muted{font-size:12px;color:var(--text-3)}.progress{margin-top:6px;font-size:12px;color:var(--text-2);font-variant-numeric:tabular-nums}',
    '.body{padding:12px 14px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:2px}.body>*{flex-shrink:0}',
    '.quick-bar{display:flex;align-items:center;gap:6px;margin-bottom:8px}.quick-bar button{flex:1;min-height:32px}',
    '.status,.problem,.ui-error{padding:9px 11px;background:var(--accent-soft);color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12.5px;border:1px solid var(--accent-border)}',
    '.problem{background:var(--warn-soft);border-color:var(--warn-border);color:var(--warn)}',
    '.ui-error{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger);display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.ui-error button{min-width:24px;min-height:24px;padding:0 6px;line-height:1;flex-shrink:0}',
    'h2{font-size:13px;font-weight:600;margin:6px 0;color:var(--text-2);letter-spacing:-0.01em}p{margin:5px 0;overflow-wrap:anywhere}label{display:block;margin-bottom:8px;font-size:12px;color:var(--text-2)}',
    'input[type=text],input[type=password],input[type=search],select{width:100%;border:1px solid var(--border-strong);border-radius:var(--radius-xs);background:var(--bg);color:var(--text);padding:6px 8px;min-height:30px;font-size:12.5px;transition:border-color .14s ease,box-shadow .14s ease}',
    'input[type=text]:hover,input[type=password]:hover,input[type=search]:hover,select:hover{border-color:var(--accent-border)}',
    'input[type=checkbox]{margin:3px 0;flex-shrink:0;accent-color:var(--accent)}',
    'input:focus-visible,button:focus-visible,summary:focus-visible,select:focus-visible{outline:none;box-shadow:0 0 0 2.5px var(--ring)}',
    'article{border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;margin:6px 0;background:var(--surface);transition:border-color .15s ease,background .15s ease}article h3{font-size:13px;font-weight:600;margin:0 0 4px;overflow-wrap:anywhere;color:var(--text)}',
    '.course{display:flex;align-items:flex-start;gap:7px;margin:0;padding:7px 0;border-bottom:1px solid var(--border);color:var(--text)}.course:last-child{border-bottom:0}.course span{flex:1;overflow-wrap:anywhere}.course small{display:block}.course button{font-size:12px;min-height:26px;padding:2px 8px;flex-shrink:0}',
    'details{margin:6px 0}summary{cursor:pointer;color:var(--text-2);font-weight:500;font-size:12.5px;list-style:none}summary::-webkit-details-marker{display:none}',
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:6px 0;padding:8px 10px;background:var(--surface-2);color:var(--text-2);border:1px solid var(--border);border-radius:var(--radius-xs)}',
    '.candidate{width:100%;text-align:left;justify-content:flex-start;overflow-wrap:anywhere;margin:4px 0}',
    '.separator{border-top:1px solid var(--border);margin-top:8px;padding-top:8px}',
    'details[data-settings]{margin:8px 0 0;padding:0;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);overflow:hidden}',
    'details[data-settings]>summary{padding:9px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--text);font-size:12.5px;font-weight:500;transition:background .14s ease}',
    'details[data-settings]>summary:hover{background:var(--surface-2)}',
    'details[data-settings]>summary::after{content:"▸";color:var(--text-3);font-size:11px}details[data-settings][open]>summary::after{content:"▾"}',
    'details[data-settings][open]>summary{border-bottom:1px solid var(--border);background:var(--surface-2)}',
    '.settings-sheet{padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px;background:var(--bg)}',
    '.settings-group{margin:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}',
    '.settings-group label:last-child{margin-bottom:0}',
    '.settings-title{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.02em;color:var(--text-3);margin:0 0 8px}',
    '.check-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer;color:var(--text);font-size:12.5px}',
    '.diag-bar{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:6px}.diag-actions{display:flex;gap:6px;align-items:center}.diag-actions button{min-height:26px;padding:2px 8px;font-size:12px}',
    '.version-meta{font-size:11.5px;color:var(--text-3);display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}',
  ].join(''));
  element('style', [
    '.ai-privacy{font-size:11.5px;line-height:1.5;color:var(--accent-text);background:var(--accent-soft);border:1px solid var(--accent-border);border-radius:var(--radius-xs);padding:7px 9px;margin:0 0 8px}',
    '.ai-key-row{display:flex;gap:6px;align-items:center;margin-top:4px}.ai-key-row input{flex:1;min-width:0}.ai-note{display:block;margin:-4px 0 8px;font-size:11.5px;color:var(--text-3)}',
    '.kg-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.52);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.kg-dialog{width:min(960px,95vw);height:min(760px,90vh);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-modal);overflow:hidden}',
    '.kg-head{flex-shrink:0;padding:12px 16px 10px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px}',
    '.kg-head-top{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    '.kg-title-wrap{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap}',
    '.kg-title-wrap h2{margin:0;font-size:15px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px}',
    '.kg-head-controls{display:flex;align-items:center;gap:6px;flex-shrink:0}',
    '.kg-head-row2{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-badge{font-size:11px;font-weight:500;padding:2px 8px;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);flex-shrink:0}',
    '.kg-badge[data-tone=ai]{background:var(--success-soft);color:var(--success)}',
    '.kg-badge[data-tone=fallback]{background:var(--warn-soft);color:var(--warn)}',
    '.kg-badge[data-tone=cache]{background:var(--cache-soft);color:var(--cache)}',
    '.kg-badge[data-tone=scope]{background:var(--surface-2);color:var(--text-2)}',
    '.kg-badge[data-tone=nosub]{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn-border)}',
    '.kg-meta-fold{flex-shrink:0;margin:0;border-bottom:1px solid var(--border);background:var(--bg);font-size:12px}',
    '.kg-meta-fold>summary{padding:5px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--text-3);font-weight:500}',
    '.kg-meta-fold>summary:hover{background:var(--surface);color:var(--text-2)}',
    '.kg-meta-fold>summary::after{content:"▸";font-size:10px}.kg-meta-fold[open]>summary::after{content:"▾"}',
    '.kg-meta-body{padding:6px 16px 10px;border-top:1px dashed var(--border);display:flex;flex-direction:column;gap:6px;background:var(--surface)}',
    '.kg-estimate{font-size:11.5px;color:var(--text-2);display:flex;flex-direction:column;gap:2px}',
    '.kg-banner{flex-shrink:0;font-size:12px;padding:7px 16px;background:var(--warn-soft);border-bottom:1px solid var(--warn-border);color:var(--warn);white-space:pre-wrap}',
    '.kg-banner[data-tone=info]{background:var(--accent-soft);border-bottom-color:var(--accent-border);color:var(--accent-text)}',
    '.kg-toolbar{flex-shrink:0;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--bg);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:var(--radius-sm);background:var(--surface-2);border:1px solid var(--border)}',
    '.kg-tabs button{min-height:26px;padding:2px 10px;border:0;background:transparent;color:var(--text-2);border-radius:var(--radius-xs);font-size:12px}',
    '.kg-tabs button:hover:not(:disabled){color:var(--text);background:var(--surface-hover)}',
    '.kg-tabs button[aria-selected=true]{background:var(--bg);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.10)}',
    '.kg-body{flex:1;min-height:0;overflow:auto;position:relative;background:var(--surface)}',
    '.kg-pane{height:100%;width:100%;display:flex;flex-direction:column}',
    '.kg-svg-wrap{flex:1;min-height:0;position:relative;overflow:hidden;background:var(--bg)}.kg-svg-wrap svg{width:100%;height:100%;display:block}.kg-svg-wrap .markmap-node a{color:var(--accent-text);text-decoration:underline;cursor:pointer;font-weight:600}',
    '.kg-engine-foot{font-size:11px;color:var(--text-3);padding:6px 14px;border-top:1px solid var(--border);background:var(--surface)}',
    '.kg-scroll{padding:16px 20px;display:flex;flex-direction:column;gap:14px}',
    '.kg-card{border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 16px;background:var(--bg);box-shadow:0 1px 2px rgba(15,23,42,.03)}',
    '.kg-card-course{border-color:var(--accent-border)}',
    '.kg-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}',
    '.kg-card-head h3{margin:0;font-size:14px;font-weight:600;color:var(--text);letter-spacing:-0.01em}',
    '.kg-one-line{margin:0 0 10px;padding:9px 12px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:13px;color:var(--text);font-weight:500;line-height:1.55}',
    '.kg-subhead{font-size:12px;font-weight:600;color:var(--text-3);margin:12px 0 6px;display:flex;align-items:center;justify-content:space-between}',
    '.kg-kp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
    '.kg-kp-item{display:flex;align-items:center;gap:9px;padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;color:var(--text)}',
    '.kg-kp-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);font-size:11px;font-weight:600;flex-shrink:0}',
    '.kg-kp-text{flex:1;min-width:0;overflow-wrap:anywhere}',
    '.kg-fold-list{display:flex;flex-direction:column;gap:6px}',
    '.kg-topic-fold{margin:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);padding:7px 11px}',
    '.kg-topic-fold>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--text);font-weight:500}',
    '.kg-topic-fold>summary::before{content:"▸ ";font-size:11px;color:var(--accent)}.kg-topic-fold[open]>summary::before{content:"▾ "}',
    '.kg-topic-count{font-size:11px;color:var(--text-3);font-weight:400;margin-left:auto}',
    '.kg-points{list-style:none;margin:6px 0 2px;padding:0}',
    '.kg-points li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px dashed var(--border);font-size:12.5px;color:var(--text-2)}',
    '.kg-quiz-list{display:flex;flex-direction:column;gap:8px}',
    '.kg-quiz-item{border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;background:var(--surface)}',
    '.kg-quiz-q{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;font-size:13px;font-weight:500;color:var(--text)}',
    '.kg-quiz-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}',
    '.kg-quiz-ans{margin-top:8px;padding:7px 10px;background:var(--success-soft);border-left:3px solid var(--success);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:12.5px;color:var(--success)}',
    '.kg-glossary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}',
    '.kg-term-card{border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;background:var(--surface)}',
    '.kg-term-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px}.kg-term-head strong{font-size:12.5px;color:var(--text)}',
    '.kg-term-def{font-size:12px;color:var(--text-2);margin:0;line-height:1.45}',
    '.kg-timeline-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px dashed var(--border);font-size:12.5px}.kg-timeline-item:last-child{border-bottom:0}',
    '.kg-timeline-text{flex:1;min-width:0;color:var(--text-2);overflow-wrap:anywhere;line-height:1.55}',
    '.kg-time-btn{min-height:24px;padding:1px 8px;font-size:11px;font-variant-numeric:tabular-nums;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border);flex-shrink:0}',
    '.kg-mini-btn{min-height:24px;padding:2px 8px;font-size:11.5px;flex-shrink:0}',
    '.kg-md-pane{padding:14px 18px}.kg-md-pane pre{margin:0;max-height:100%;overflow:auto}',
    '.kg-sec-picker-wrap{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.kg-sec-picker{width:auto;max-width:300px;min-width:160px;padding:3px 8px;font-size:12px;min-height:28px}',
    '.kg-qa-dock{flex-shrink:0;border-top:1px solid var(--border);background:var(--bg);display:flex;flex-direction:column}',
    '.kg-qa-bar{padding:7px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--surface);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-2)}.kg-qa-bar strong{font-size:12.5px;color:var(--text);font-weight:600}',
    '.kg-qa-thread{max-height:210px;overflow-y:auto;padding:10px 16px;display:flex;flex-direction:column;gap:8px;background:var(--surface);border-bottom:1px solid var(--border)}',
    '.kg-qa-msg{padding:8px 12px;border-radius:var(--radius-md);font-size:12.5px;line-height:1.55;max-width:88%;overflow-wrap:anywhere}',
    '.kg-qa-msg[data-role=user]{align-self:flex-end;background:var(--accent);color:#fff}',
    '.kg-qa-msg[data-role=assistant]{align-self:flex-start;background:var(--bg);border:1px solid var(--border);color:var(--text)}',
    '.kg-qa-cites{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}',
    '.kg-qa-cite{display:inline-flex;align-items:center;gap:4px;font-size:11px;min-height:22px;padding:1px 8px;border-radius:var(--radius-pill);background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.kg-inline-time{display:inline;min-height:0;padding:0 5px;margin:0 2px;font-size:11.5px;font-weight:600;border-radius:4px;vertical-align:baseline;background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.kg-qa-meta{font-size:11px;color:var(--text-3);margin-top:4px}',
    '.kg-qa-noai{padding:6px 16px;background:var(--warn-soft);border-bottom:1px solid var(--warn-border);color:var(--warn);font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.kg-qa-nosub{padding:6px 16px;background:var(--surface-2);border-bottom:1px solid var(--border);color:var(--text-3);font-size:12px}',
    '.kg-qa-input-row{padding:8px 16px;display:flex;align-items:center;gap:8px;background:var(--bg)}.kg-qa-input-row input{flex:1;min-width:0;padding:6px 10px}.kg-qa-input-row input:disabled{background:var(--surface-2);color:var(--text-3);cursor:not-allowed}',
    '.kg-score-bar{padding:10px 14px;border-radius:var(--radius-sm);background:var(--success-soft);border:1px solid var(--success-border);color:var(--success);font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-opt-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}',
    '.kg-opt-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer;margin:0;font-size:12.5px;color:var(--text);transition:border-color .14s ease,background .14s ease}',
    '.kg-opt-row:hover{border-color:var(--accent-border);background:var(--surface-hover)}',
    '.kg-opt-row[data-grade=correct]{background:var(--success-soft);border-color:var(--success-border);color:var(--success)}',
    '.kg-opt-row[data-grade=wrong]{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '.kg-short-input{margin:8px 0 4px}',
    '.kg-explain-fold{margin:8px 0 0;border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 10px;background:var(--surface)}.kg-explain-fold summary{font-size:12px;color:var(--text-2)}.kg-explain-body{margin-top:6px;font-size:12.5px;color:var(--text-2);display:flex;flex-direction:column;gap:5px}',
    '.kg-nosub-box{padding:12px 14px;border-radius:var(--radius-sm);background:var(--warn-soft);border:1px solid var(--warn-border);color:var(--warn);font-size:12.5px;line-height:1.55;margin:4px 0}.kg-nosub-box strong{display:block;font-size:13px;margin-bottom:3px}',
    '.kg-skipped-box{margin-top:8px;padding:7px 10px;border-radius:var(--radius-xs);background:var(--surface);border:1px solid var(--border);color:var(--text-2);font-size:12px}',
    '.kg-diag-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}.kg-diag-pre{max-height:130px;overflow:auto;margin:4px 0 0;font-size:11px}',
  ].join(''));
  const shell = element('section'); shell.setAttribute('aria-label', '网大助手');
  element('style', [
    '.task-head{display:flex;align-items:flex-start;gap:7px}.task-head h3{flex:1;min-width:0}.sort-actions{display:flex;gap:4px;flex-shrink:0}.sort-actions button{min-width:26px;min-height:26px;padding:2px 6px;font-size:12px;line-height:1}.sort-handle{cursor:grab}.sort-handle:active{cursor:grabbing}article[data-drop=before]{border-top:2px solid var(--accent)}article[data-drop=after]{border-bottom:2px solid var(--accent)}article[data-dragging]{opacity:.55}',
    '.filter-input{margin:0 0 6px}',
    'article[data-state=active]{background:var(--accent-soft);border-color:var(--accent-border);box-shadow:inset 3px 0 var(--accent)}article[data-state=completed]{background:var(--surface-2);border-color:var(--border);color:var(--text-3)}article[data-state=attention]{background:var(--warn-soft);border-color:var(--warn-border)}',
    '.task-priority{margin:2px 0 4px}.task-current{font-size:12px;color:var(--accent-text);white-space:pre-wrap;margin:6px 0}',
    '.course[data-state=active]{background:var(--accent-soft);border-radius:var(--radius-xs);padding:8px;border-left:3px solid var(--accent)}.course[data-state=active]>span>span,.course[data-state=active] small{color:var(--accent-text)}.course[data-state=active]>span>span{font-weight:600}.course[data-state=completed]{color:var(--text-3)}.course[data-state=attention] small{color:var(--warn)}',
    'progress{display:block;width:100%;height:4px;margin:6px 0 8px;border:0;border-radius:999px;overflow:hidden;background:var(--surface-2);accent-color:var(--accent)}progress::-webkit-progress-bar{background:var(--surface-2)}progress::-webkit-progress-value{background:var(--accent);border-radius:999px}progress::-moz-progress-bar{background:var(--accent)}article[data-state=completed] progress{accent-color:var(--text-3)}article[data-state=completed] progress::-webkit-progress-value{background:var(--text-3)}.course progress{margin-bottom:2px}.playback-time{margin-top:4px;font-variant-numeric:tabular-nums}.completed-actions{margin:6px 0}',
    '.compact-course,.course-caption,.current-name,.task-head h3{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.course>span{min-width:0}.one-line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.current-name{font-weight:600}.task-current small{color:inherit}.compact-notice{margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere}.task-current .playback-time{margin-top:3px}.task-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}.task-meta p{margin:0;flex:1;min-width:0;font-size:12px;color:var(--text-2)}.detail-toggle{min-height:26px;padding:2px 8px;font-size:12px;flex-shrink:0}',
  ].join(''));
  const header = element('header', '', shell);
  const headline = element('div', '', header); headline.className = 'headline';
  const title = element('div', '', headline); title.className = 'brand-wrap';
  element('span', '', title).className = 'brand-dot';
  element('strong', '网大助手', title);
  const headerButtons = element('div', '', headline); headerButtons.className = 'row';
  const busy = new Set(); const editors = new Set(); let adding = false; let starting = false; let reordering = false; let draggedTaskId = null;
  let pendingRemoveId = null; let pendingRemoveTimer = null; let windowSavedTimer = null; let copyDiagTimer = null;
  let latest = controller.getState();
  const clearRemoveConfirm = () => { if (pendingRemoveTimer !== null) { win.clearTimeout(pendingRemoveTimer); pendingRemoveTimer = null; } pendingRemoveId = null; };
  const clearTimers = () => {
    clearRemoveConfirm();
    if (windowSavedTimer !== null) { win.clearTimeout(windowSavedTimer); windowSavedTimer = null; }
    if (copyDiagTimer !== null) { win.clearTimeout(copyDiagTimer); copyDiagTimer = null; }
  };
  const body = element('div', '', shell); body.className = 'body'; body.hidden = true;
  const uiErrorBox = element('div', '', body); uiErrorBox.className = 'ui-error'; uiErrorBox.setAttribute('role', 'alert'); uiErrorBox.hidden = true;
  const uiErrorText = element('span', '', uiErrorBox);
  const closeUiError = element('button', '×', uiErrorBox); closeUiError.type = 'button'; closeUiError.className = 'ghost'; closeUiError.setAttribute('aria-label', '关闭提示');
  closeUiError.addEventListener('click', () => { uiErrorBox.hidden = true; uiErrorText.textContent = ''; });
  const showUiError = text => { uiErrorText.textContent = text; uiErrorBox.hidden = false; body.scrollTop = 0; };
  const button = (action, text, parent, handler, edit = true) => {
    const node = element('button', text, parent); node.type = 'button'; node.dataset.action = action;
    if (edit) editors.add(node);
    node.addEventListener('click', async () => {
      if (node.disabled || busy.has(node)) return;
      busy.add(node); node.disabled = true;
      try { await handler(); } catch { showUiError('操作未完成，请查看当前状态后重试。'); }
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
  const execution = element('div', '', body); execution.className = 'status';
  const message = element('div', '', execution);
  const problemBox = element('div', '', body); problemBox.className = 'problem'; problemBox.dataset.problem = '';
  const problemText = element('div', '', problemBox); const problemActions = element('div', '', problemBox); problemActions.className = 'buttons';
  button('retry', '重试本课程', problemActions, () => controller.retry(latest.problem?.taskId, latest.problem?.courseId));
  button('skip', '跳过并继续', problemActions, () => controller.skipCurrent());
  const leaveBar = element('div', '', body); leaveBar.className = 'buttons leave-bar'; leaveBar.hidden = true;
  const leaveLearningButton = button('stop-learning', '退出学习页', leaveBar, () => controller.pause(), false);
  const quickBar = element('div', '', body); quickBar.className = 'quick-bar'; quickBar.dataset.quickBar = '';
  const guideTrigger = button('knowledge-open', '💡 AI 导览', quickBar, () => openKnowledgeModal(), false);
  guideTrigger.className = 'soft';
  const queueView = element('div', '', body); queueView.dataset.view = 'queue';
  const queueHeading = element('div', '', queueView); queueHeading.className = 'headline'; element('h2', '任务队列', queueHeading);
  const queueHeaderActions = element('div', '', queueHeading); queueHeaderActions.className = 'row';
  const clearCompleted = button('clear-completed', '清除已完成', queueHeaderActions, () => controller.clearCompletedTasks(), false);
  clearCompleted.className = 'ghost';
  clearCompleted.title = '清理已完成专区，保留执行中、未完成和待处理任务。';
  const addButton = button('add', '添加专区', queueHeaderActions, () => { adding = true; clearRemoveConfirm(); render(controller.getState()); target.focus(); });
  const empty = element('p', '暂无学习任务', queueView); empty.className = 'muted';
  const taskList = element('div', '', queueView);
  const addView = element('div', '', body); addView.dataset.view = 'add';
  const exitAddView = async () => { if (await controller.discardDraft() !== false) { adding = false; target.value = ''; } };
  const addHeading = element('div', '', addView); addHeading.className = 'headline';
  element('h2', '添加专区', addHeading);
  const backButton = button('back', '← 返回', addHeading, exitAddView); backButton.className = 'ghost';
  const searchBox = element('div', '', addView);
  const labelInput = (caption, name, parent) => { const label = element('label', caption, parent); const input = element('input', '', label); input.type = 'text'; input.name = name; input.id = `wd-${name}`; label.htmlFor = input.id; editors.add(input); return input; };
  const target = labelInput('专区名称', 'target', searchBox);
  target.placeholder = '输入名称后按回车搜索';
  const searchActions = element('div', '', searchBox); searchActions.className = 'buttons';
  const searchButton = button('search', '搜索', searchActions, () => controller.search(target.value.trim())); searchButton.className = 'primary';
  button('collect', '读取当前页', searchActions, () => controller.collectDraft());
  target.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchButton.click(); } });
  const candidates = element('div', '', addView); candidates.dataset.candidates = '';
  const draftBox = element('div', '', addView); draftBox.dataset.draft = '';
  const draftTitle = element('h3', '', draftBox);
  const draftCourses = createCourseList(draftBox);
  const addActions = element('div', '', draftBox); addActions.className = 'buttons';
  const addDraftButton = button('add-draft', '加入队列', addActions, async () => { if (await controller.addDraft()) { adding = false; target.value = ''; } }); addDraftButton.className = 'primary';
  const cancelDraftButton = button('cancel-draft', '取消', addActions, exitAddView); cancelDraftButton.className = 'ghost';
  const settingsBox = element('details', '', body); settingsBox.dataset.settings = '';
  const settingsSummary = element('summary', '⚙ 设置', settingsBox);
  const settingsSheet = element('div', '', settingsBox); settingsSheet.className = 'settings-sheet';
  const runningEditHint = element('p', '运行中仅可查看，暂停后可修改。', settingsSheet); runningEditHint.className = 'muted'; runningEditHint.hidden = true;

  // Group 1: 挂课与学习
  const windowGroup = element('div', '', settingsSheet); windowGroup.className = 'settings-group'; windowGroup.dataset.settingsGroup = 'study';
  element('p', '挂课与时段（北京时间）', windowGroup).className = 'settings-title';
  const windowRow = element('div', '', windowGroup); windowRow.className = 'row';
  const fields = { start: labelInput('开始时间', 'start', windowRow), end: labelInput('结束时间', 'end', windowRow) };
  fields.start.placeholder = '09:00'; fields.end.placeholder = '24:00';
  const dirty = new Set(); for (const [name, field] of Object.entries(fields)) field.addEventListener('input', () => dirty.add(name));
  const windowActions = element('div', '', windowGroup); windowActions.className = 'buttons';
  const saveWindowButton = button('save-window', '保存', windowActions, async () => {
    if (await saveWindow()) {
      saveWindowButton.textContent = '已保存';
      if (windowSavedTimer !== null) win.clearTimeout(windowSavedTimer);
      windowSavedTimer = win.setTimeout(() => { windowSavedTimer = null; saveWindowButton.textContent = '保存'; }, 2000);
    }
  });
  saveWindowButton.className = 'primary';
  const resetWindowButton = button('reset-window', '恢复默认', windowActions, async () => {
    fields.start.value = '09:00';
    fields.end.value = '24:00';
    dirty.clear();
    if (await controller.setWindow({ start: '09:00', end: '24:00' })) {
      resetWindowButton.textContent = '已恢复';
      if (windowSavedTimer !== null) win.clearTimeout(windowSavedTimer);
      windowSavedTimer = win.setTimeout(() => { windowSavedTimer = null; resetWindowButton.textContent = '恢复默认'; }, 2000);
    }
  });
  resetWindowButton.className = 'ghost';
  function automaticInput(name, caption, parent) {
    const label = element('label', '', parent); label.className = 'check-row';
    const input = element('input', '', label); input.type = 'checkbox'; input.name = name; editors.add(input);
    element('span', caption, label);
    input.addEventListener('change', async () => {
      if (input.disabled) return;
      busy.add(input); input.disabled = true;
      try { await controller.setAutomation({ enabled: automatic.checked, resumeOnReload: automatic.checked && resumeOnReload.checked, mute: mute.checked }); }
      catch { showUiError('自动设置保存失败，请重试。'); }
      finally { busy.delete(input); render(controller.getState()); }
    }); return input;
  }
  const mute = automaticInput('mute', '自动静音课程', windowGroup);
  mute.title = '开启期间持续静音；需要声音时请暂停后关闭。';
  const automatic = automaticInput('automatic', '异常自动重试并跳过人工课', windowGroup);
  const resumeOnReload = automaticInput('resumeOnReload', '刷新页面后自动恢复队列', windowGroup);
  const autoHint = element('small', '需保持页面打开；手动暂停将停止续学。', windowGroup); autoHint.className = 'muted'; autoHint.hidden = true;

  // Group 2: 外观
  const themeGroup = element('div', '', settingsSheet); themeGroup.className = 'settings-group'; themeGroup.dataset.settingsGroup = 'appearance';
  element('p', '外观', themeGroup).className = 'settings-title';
  const uiThemeLabel = element('label', '主题', themeGroup);
  const uiThemeSelect = element('select', '', uiThemeLabel); uiThemeSelect.name = 'ui-theme'; uiThemeSelect.id = 'wd-ui-theme'; uiThemeLabel.htmlFor = uiThemeSelect.id;
  for (const [val, txt] of [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']]) {
    const opt = element('option', txt, uiThemeSelect); opt.value = val;
  }
  uiThemeSelect.value = host.dataset.theme || 'auto';
  uiThemeSelect.addEventListener('change', () => { applyUiTheme(uiThemeSelect.value); });

  // Group 3: AI 导览模型
  const aiGroup = element('div', '', settingsSheet); aiGroup.className = 'settings-group'; aiGroup.dataset.aiSettings = ''; aiGroup.dataset.settingsGroup = 'ai';
  element('p', 'AI 导览模型（选填）', aiGroup).className = 'settings-title';
  const aiPrivacy = element('p', kg.privacyNotice || WD_AI_PRIVACY_NOTICE, aiGroup); aiPrivacy.className = 'ai-privacy'; aiPrivacy.dataset.aiPrivacy = '';
  const aiProviderLabel = element('label', '服务商 (Provider)', aiGroup);
  const aiProvider = element('select', '', aiProviderLabel); aiProvider.name = 'ai-provider'; aiProvider.id = 'wd-ai-provider'; aiProviderLabel.htmlFor = aiProvider.id;
  for (const preset of (kg.providers || WD_AI_PROVIDERS)) {
    const opt = element('option', preset.label, aiProvider); opt.value = preset.id;
  }
  const aiProviderNote = element('small', '', aiGroup); aiProviderNote.className = 'muted ai-note'; aiProviderNote.dataset.aiProviderNote = '';
  const aiBaseUrlLabel = element('label', 'Base URL', aiGroup);
  const aiBaseUrl = element('input', '', aiBaseUrlLabel); aiBaseUrl.type = 'text'; aiBaseUrl.name = 'ai-base-url'; aiBaseUrl.id = 'wd-ai-base-url'; aiBaseUrlLabel.htmlFor = aiBaseUrl.id;
  aiBaseUrl.placeholder = 'https://api.deepseek.com/v1';
  const aiModelLabel = element('label', '模型名', aiGroup);
  const aiModel = element('input', '', aiModelLabel); aiModel.type = 'text'; aiModel.name = 'ai-model'; aiModel.id = 'wd-ai-model'; aiModelLabel.htmlFor = aiModel.id;
  aiModel.placeholder = 'deepseek-chat / qwen-plus / gpt-4o-mini';
  const aiKeyLabel = element('label', 'API Key', aiGroup);
  const aiKeyRow = element('div', '', aiKeyLabel); aiKeyRow.className = 'ai-key-row';
  const aiApiKey = element('input', '', aiKeyRow); aiApiKey.type = 'password'; aiApiKey.name = 'ai-api-key'; aiApiKey.id = 'wd-ai-api-key'; aiKeyLabel.htmlFor = aiApiKey.id;
  aiApiKey.autocomplete = 'off'; aiApiKey.placeholder = '留空默认零 AI';
  const aiToggleKey = button('ai-toggle-key', '显示', aiKeyRow, () => {
    const hidden = aiApiKey.type === 'password';
    aiApiKey.type = hidden ? 'text' : 'password';
    aiToggleKey.textContent = hidden ? '隐藏' : '显示';
  }, false);
  aiToggleKey.className = 'ghost';
  const aiTransportLabel = element('label', '请求通道', aiGroup);
  const aiTransport = element('select', '', aiTransportLabel); aiTransport.name = 'ai-transport'; aiTransport.id = 'wd-ai-transport'; aiTransportLabel.htmlFor = aiTransport.id;
  for (const [val, txt] of [['auto', '自动 (GM → fetch)'], ['gm', '仅 GM_xmlhttpRequest'], ['fetch', '仅页面 fetch']]) {
    const opt = element('option', txt, aiTransport); opt.value = val;
  }
  const aiActions = element('div', '', aiGroup); aiActions.className = 'buttons';
  const aiSaveStatus = element('small', '', aiGroup); aiSaveStatus.className = 'muted'; aiSaveStatus.dataset.aiSaveStatus = '';
  const syncAiForm = () => {
    const cfg = kg.getSettings();
    aiProvider.value = cfg.provider;
    aiBaseUrl.value = cfg.baseUrl;
    aiModel.value = cfg.model;
    aiApiKey.value = cfg.apiKey;
    aiTransport.value = cfg.transport;
    aiProviderNote.textContent = getAiProviderPreset(cfg.provider)?.note || '';
  };
  aiProvider.addEventListener('change', () => {
    const preset = getAiProviderPreset(aiProvider.value);
    if (preset && preset.id !== 'custom') {
      if (preset.baseUrl) aiBaseUrl.value = preset.baseUrl;
      if (preset.model) aiModel.value = preset.model;
    }
    aiProviderNote.textContent = preset?.note || '';
  });
  const aiSaveBtn = button('ai-save', '保存', aiActions, () => {
    const res = kg.saveSettings({
      provider: aiProvider.value,
      baseUrl: aiBaseUrl.value,
      model: aiModel.value,
      apiKey: aiApiKey.value,
      transport: aiTransport.value,
    });
    aiSaveStatus.textContent = res.ok
      ? (res.settings.apiKey ? '已保存到本地 localStorage' : '已保存（零 AI 档）')
      : (res.error || '保存失败');
  }, false);
  aiSaveBtn.className = 'primary';
  const aiResetBtn = button('ai-reset', '恢复默认', aiActions, () => {
    const def = getAiProviderPreset('deepseek');
    aiProvider.value = def.id;
    aiBaseUrl.value = def.baseUrl;
    aiModel.value = def.model;
    aiTransport.value = 'auto';
    aiProviderNote.textContent = def.note || '';
    const res = kg.saveSettings({
      provider: def.id,
      baseUrl: def.baseUrl,
      model: def.model,
      apiKey: aiApiKey.value,
      transport: 'auto',
    });
    aiSaveStatus.textContent = res.ok ? '已恢复默认模型配置（API Key 保留）' : (res.error || '恢复失败');
  }, false);
  aiResetBtn.className = 'ghost';
  const aiClearBtn = button('ai-clear-key', '清空 Key', aiActions, () => {
    const res = kg.clearApiKey();
    aiApiKey.value = '';
    aiApiKey.type = 'password';
    aiToggleKey.textContent = '显示';
    aiSaveStatus.textContent = res.ok ? '已清空本地 API Key' : (res.error || '清空失败');
  }, false);
  aiClearBtn.className = 'danger';
  syncAiForm();

  // Group 4: 诊断与版本（收进设置，默认不露在首屏）
  const diagGroup = element('div', '', settingsSheet); diagGroup.className = 'settings-group'; diagGroup.dataset.settingsGroup = 'diagnostics';
  element('p', '诊断与版本', diagGroup).className = 'settings-title';
  const versionRow = element('div', '', diagGroup); versionRow.className = 'version-meta'; versionRow.dataset.versionInfo = '';
  element('span', `网大助手 ${version}`, versionRow);
  element('span', 'beta-channel · 本地存储', versionRow);
  const diagBar = element('div', '', diagGroup); diagBar.className = 'diag-bar';
  const diagTrigger = button('diagnose', '页面诊断', diagBar, () => {
    const baseDiag = controller.diagnose();
    const subDiag = kg.getLastDiagnostics?.() || null;
    const payload = subDiag && baseDiag && typeof baseDiag === 'object' ? { ...baseDiag, subtitleDiagnostics: subDiag } : baseDiag;
    diagnostic.textContent = JSON.stringify(payload, null, 2);
    diagnosticBox.hidden = false;
  }, false);
  diagTrigger.className = 'ghost';
  const diagnosticBox = element('div', '', diagGroup); diagnosticBox.dataset.diagnosticBox = ''; diagnosticBox.hidden = true;
  const diagControls = element('div', '', diagnosticBox); diagControls.className = 'diag-bar';
  element('small', '诊断快照', diagControls);
  const diagActions = element('div', '', diagControls); diagActions.className = 'diag-actions';
  const copyDiagButton = button('copy-diagnose', '复制', diagActions, async () => {
    if (!diagnostic.textContent) return;
    if (win.navigator?.clipboard?.writeText) {
      await win.navigator.clipboard.writeText(diagnostic.textContent);
      copyDiagButton.textContent = '已复制';
      if (copyDiagTimer !== null) win.clearTimeout(copyDiagTimer);
      copyDiagTimer = win.setTimeout(() => { copyDiagTimer = null; copyDiagButton.textContent = '复制'; }, 2000);
    }
  }, false);
  copyDiagButton.className = 'ghost';
  const closeDiagButton = button('close-diagnose', '收起', diagActions, () => { diagnosticBox.hidden = true; }, false);
  closeDiagButton.className = 'ghost';
  const diagnostic = element('pre', '', diagnosticBox);

  let kgModal = null;
  let kgMapHandle = null;
  let kgLastResult = null;
  let kgActiveTab = 'quick';
  let kgRunning = false;
  let kgLastScope = 'course';
  let kgLastUsedAi = false;
  let kgMapRenderedFor = null;
  const destroyKgMap = () => { try { kgMapHandle?.destroy?.(); } catch { /* ignore */ } kgMapHandle = null; kgMapRenderedFor = null; };
  const closeKnowledgeModal = () => {
    kg.abort();
    try { kgQaAbort?.abort?.(); } catch { /* ignore */ }
    try { kgQuizAbort?.abort?.(); } catch { /* ignore */ }
    kgRunning = false;
    kgQaBusy = false;
    kgQuizBusy = false;
    destroyKgMap();
    if (kgModal) { kgModal.backdrop.remove(); kgModal = null; }
  };
  const createTimeBtn = (parent, sectionId, seconds, onSeek) => {
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    const sec = Math.floor(seconds);
    const tsBtn = element('button', formatTimestamp(sec), parent);
    tsBtn.type = 'button'; tsBtn.className = 'kg-time-btn'; tsBtn.dataset.seekSeconds = String(sec);
    tsBtn.title = `跳播至 ${formatTimestamp(sec)}`;
    tsBtn.addEventListener('click', ev => { ev.stopPropagation(); onSeek({ sectionId: sectionId || 'current', seconds: sec }); });
    return tsBtn;
  };
  const renderKnowledgeQuick = (container, tree, onSeek, onSwitchTab) => {
    container.replaceChildren();
    const sections = Array.isArray(tree?.sections) ? tree.sections : [];
    if (!sections.length) { element('p', '暂无可展示的课节或字幕内容。', container).className = 'muted'; return; }

    // Course-level overview card when multiple sections are present
    if (sections.length > 1) {
      const courseCard = element('div', '', container); courseCard.className = 'kg-card kg-card-course'; courseCard.dataset.kgCourseOverview = '';
      const head = element('div', '', courseCard); head.className = 'kg-card-head';
      element('h3', `整门课总览 · ${tree.scopeLabel || `共 ${sections.length} 节`}`, head);
      const mapJump = element('button', '查看全课导图 →', head); mapJump.type = 'button'; mapJump.className = 'kg-mini-btn ghost';
      mapJump.addEventListener('click', () => onSwitchTab('map'));
      if (tree.overview) {
        const lead = element('p', tree.overview, courseCard); lead.className = 'kg-one-line'; lead.dataset.kgOverview = '';
      }
      if (Array.isArray(tree.courseKeyPoints) && tree.courseKeyPoints.length) {
        element('div', '全课核心要点', courseCard).className = 'kg-subhead';
        const ol = element('ol', '', courseCard); ol.className = 'kg-kp-list';
        tree.courseKeyPoints.forEach((kp, idx) => {
          const li = element('li', '', ol); li.className = 'kg-kp-item';
          element('span', String(idx + 1), li).className = 'kg-kp-num';
          const textWrap = element('span', kp.sectionTitle ? `【${kp.sectionTitle}】${kp.text}` : kp.text, li); textWrap.className = 'kg-kp-text';
          createTimeBtn(li, kp.sectionId || 'current', kp.seconds, onSeek);
        });
      }
      if (Array.isArray(tree.skippedNoSubtitleSections) && tree.skippedNoSubtitleSections.length) {
        const skipBox = element('div', '', courseCard); skipBox.className = 'kg-skipped-box'; skipBox.dataset.kgSkippedList = '';
        const names = tree.skippedNoSubtitleSections.map(s => `《${s.title}》`).join('、');
        skipBox.textContent = `已静默跳过 ${tree.skippedNoSubtitleSections.length} 个无字幕课节：${names}`;
      }
    }

    const silentSkipMixed = sections.length > 1 && tree?.hasAnySubtitle === true;
    for (const sec of sections) {
      const isNoSub = sec.hasSubtitle === false;
      if (isNoSub && silentSkipMixed && sec.mode !== 'highlight') continue;
      const card = element('div', '', container); card.className = 'kg-card'; card.dataset.kgSectionCard = sec.sectionId || '';
      const head = element('div', '', card); head.className = 'kg-card-head';
      const titleText = `${sec.chapterTitle ? `${sec.chapterTitle} · ` : ''}${sec.title || '课节'}`;
      element('h3', titleText, head);
      const modeText = isNoSub
        ? (sec.mode === 'highlight' ? '平台看点' : '无字幕')
        : (sec.mode === 'ai' ? 'AI' : sec.mode === 'highlight' ? '看点' : sec.mode === 'placeholder' ? '占位' : '零 AI');
      const secBadge = element('span', modeText, head); secBadge.className = 'kg-badge';
      if (isNoSub) secBadge.dataset.tone = 'nosub';
      else if (sec.mode === 'ai') secBadge.dataset.tone = 'ai';

      if (isNoSub) {
        const noSubBox = element('div', '', card); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgNoSubtitle = sec.sectionId || 'current';
        element('strong', '本课无字幕', noSubBox);
        const detailReason = String(sec.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
        element('div', detailReason, noSubBox);
        if (sec.mode !== 'highlight') continue;
      }

      // 1. One-sentence summary
      if (sec.summary) {
        const sum = element('p', sec.summary, card); sum.className = 'kg-one-line'; sum.dataset.kgSectionSummary = '';
      }

      // 2. Core Key Points Card
      if (Array.isArray(sec.keyPoints) && sec.keyPoints.length) {
        element('div', `核心要点 · ${sec.keyPoints.length}`, card).className = 'kg-subhead';
        const ol = element('ol', '', card); ol.className = 'kg-kp-list'; ol.dataset.kgKeypoints = '';
        sec.keyPoints.forEach((kp, idx) => {
          const li = element('li', '', ol); li.className = 'kg-kp-item';
          element('span', String(idx + 1), li).className = 'kg-kp-num';
          element('span', kp.text || '', li).className = 'kg-kp-text';
          createTimeBtn(li, sec.sectionId || 'current', kp.seconds, onSeek);
        });
      }

      // Chunk summaries shown when long-section aggregation degraded
      if (Array.isArray(sec.chunkSummaries) && sec.chunkSummaries.length > 1) {
        element('div', `分段摘要 · ${sec.chunkSummaries.length}`, card).className = 'kg-subhead';
        const ul = element('ul', '', card); ul.className = 'kg-points'; ul.dataset.kgChunkSummaries = '';
        for (const cs of sec.chunkSummaries) {
          const li = element('li', '', ul);
          element('span', `第 ${cs.chunkIndex} 段：${cs.summary}`, li);
          createTimeBtn(li, sec.sectionId || 'current', cs.seconds, onSeek);
        }
      }

      // 3. 3-level Hierarchical Outline (default collapsed at 3rd level)
      const outline = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
      if (outline.length) {
        element('div', '知识大纲', card).className = 'kg-subhead';
        const foldList = element('div', '', card); foldList.className = 'kg-fold-list'; foldList.dataset.kgOutline = '';
        for (const topic of outline) {
          const details = element('details', '', foldList); details.className = 'kg-topic-fold'; details.open = false;
          const summary = element('summary', '', details);
          element('span', topic.name || '主题', summary);
          const pts = Array.isArray(topic.points) ? topic.points : [];
          element('span', `${pts.length}`, summary).className = 'kg-topic-count';
          const ul = element('ul', '', details); ul.className = 'kg-points';
          for (const pt of pts) {
            const li = element('li', '', ul);
            element('span', pt.text || '', li);
            createTimeBtn(li, sec.sectionId || 'current', pt.seconds, onSeek);
          }
        }
      }

      // 4. Q&A Self-Check
      if (Array.isArray(sec.quiz) && sec.quiz.length) {
        element('div', `自测 · ${sec.quiz.length}`, card).className = 'kg-subhead';
        const qList = element('div', '', card); qList.className = 'kg-quiz-list'; qList.dataset.kgQuiz = '';
        sec.quiz.forEach((item, idx) => {
          const qCard = element('div', '', qList); qCard.className = 'kg-quiz-item';
          const qTop = element('div', '', qCard); qTop.className = 'kg-quiz-q';
          element('span', `Q${idx + 1}. ${item.question}`, qTop);
          const qActions = element('div', '', qTop); qActions.className = 'kg-quiz-actions';
          createTimeBtn(qActions, sec.sectionId || 'current', item.seconds, onSeek);
          const ansBox = element('div', item.answer, qCard); ansBox.className = 'kg-quiz-ans'; ansBox.dataset.kgQuizAnswer = ''; ansBox.hidden = true;
          const revealBtn = element('button', '答案', qActions); revealBtn.type = 'button'; revealBtn.className = 'kg-mini-btn ghost'; revealBtn.dataset.action = `kg-quiz-toggle-${sec.sectionIndex || 1}-${idx}`;
          revealBtn.addEventListener('click', () => {
            ansBox.hidden = !ansBox.hidden;
            revealBtn.textContent = ansBox.hidden ? '答案' : '收起';
          });
        });
      }

      // 5. Glossary / Term Cards
      if (Array.isArray(sec.glossary) && sec.glossary.length) {
        element('div', `术语 · ${sec.glossary.length}`, card).className = 'kg-subhead';
        const grid = element('div', '', card); grid.className = 'kg-glossary-grid'; grid.dataset.kgGlossary = '';
        for (const g of sec.glossary) {
          const tCard = element('div', '', grid); tCard.className = 'kg-term-card';
          const tHead = element('div', '', tCard); tHead.className = 'kg-term-head';
          element('strong', g.term, tHead);
          createTimeBtn(tHead, sec.sectionId || 'current', g.seconds, onSeek);
          element('p', g.definition, tCard).className = 'kg-term-def';
        }
      }
    }
  };

  const renderKnowledgeDetail = (container, tree, onSeek) => {
    container.replaceChildren();
    const sections = Array.isArray(tree?.sections) ? tree.sections : [];
    if (!sections.length) { element('p', '暂无课节内容。', container).className = 'muted'; return; }
    const silentSkipMixed = sections.length > 1 && tree?.hasAnySubtitle === true;
    for (const sec of sections) {
      if (sec.hasSubtitle === false && silentSkipMixed && sec.mode !== 'highlight') continue;
      const card = element('div', '', container); card.className = 'kg-card';
      const head = element('div', '', card); head.className = 'kg-card-head';
      element('h3', `${sec.chapterTitle ? `${sec.chapterTitle} · ` : ''}${sec.title || '课节'}`, head);
      if (sec.hasSubtitle === false) {
        const badge = element('span', '无字幕', head); badge.className = 'kg-badge'; badge.dataset.tone = 'nosub';
        const noSubBox = element('div', '', card); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgNoSubtitleDetail = sec.sectionId || 'current';
        element('strong', '本课无字幕', noSubBox);
        const detailReason = String(sec.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
        element('div', detailReason, noSubBox);
        if (sec.mode !== 'highlight') continue;
      }
      if (sec.summary) element('p', sec.summary, card).className = 'kg-one-line';

      const outline = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
      if (outline.length) {
        element('div', '完整知识点', card).className = 'kg-subhead';
        for (const topic of outline) {
          const tHead = element('div', topic.name || '主题', card); tHead.className = 'settings-title';
          const ul = element('ul', '', card); ul.className = 'kg-points';
          for (const pt of (topic.points || [])) {
            const li = element('li', '', ul);
            element('span', pt.text || '', li);
            createTimeBtn(li, sec.sectionId || 'current', pt.seconds, onSeek);
          }
        }
      }

      if (Array.isArray(sec.timeline) && sec.timeline.length) {
        element('div', `字幕时间轴 · ${sec.timeline.length}`, card).className = 'kg-subhead';
        const tlBox = element('div', '', card); tlBox.dataset.kgTimeline = '';
        for (const item of sec.timeline) {
          const row = element('div', '', tlBox); row.className = 'kg-timeline-item';
          createTimeBtn(row, sec.sectionId || 'current', item.startSec, onSeek);
          element('div', item.text || item.headline || '', row).className = 'kg-timeline-text';
        }
      }
    }
  };

  const ensureKgMapRendered = async () => {
    if (!kgModal || !kgLastResult?.markdown) return;
    const token = `${kgLastResult.tree?.generatedAt || ''}:${kgLastResult.markdown.length}`;
    const fitSoon = () => {
      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => kgMapHandle?.fit?.());
      else kgMapHandle?.fit?.();
      if (typeof win.setTimeout === 'function') win.setTimeout(() => kgMapHandle?.fit?.(), 120);
    };
    if (kgMapRenderedFor === token && kgMapHandle) {
      if (kgActiveTab === 'map') fitSoon();
      return;
    }
    destroyKgMap();
    kgModal.engineFoot.textContent = '正在渲染交互导图…';
    kgMapHandle = await renderKnowledgeMindmap({
      svg: kgModal.svg,
      markdown: kgLastResult.markdown,
      onSeek: handleKgSeek,
      ...(kg.mapOptions || {}),
    });
    kgMapRenderedFor = token;
    if (kgModal) {
      kgModal.engineFoot.textContent = kgMapHandle.engine === 'markmap'
        ? '导图引擎：markmap（支持滚轮缩放、拖拽、点击节点折叠及点击 mm:ss 跳播）'
        : '导图引擎：内置交互 SVG 导图（markmap CDN 未加载或离线降级，支持缩放/拖拽/折叠/点击 mm:ss 跳播）';
      if (kgActiveTab === 'map') fitSoon();
    }
  };

  let kgFocusSectionId = null;
  let kgQaExpanded = false;
  let kgQaBusy = false;
  let kgQuizBusy = false;
  let kgQaAbort = null;
  let kgQuizAbort = null;

  const getAllCourseSections = () => {
    const raw = Array.isArray(kgLastResult?.courseData?.sections) ? kgLastResult.courseData.sections : [];
    const treeSecs = Array.isArray(kgLastResult?.tree?.sections) ? kgLastResult.tree.sections : [];
    const merged = [];
    const byId = new Map();
    for (const s of raw) {
      const id = String(s.sectionId || 'current');
      const copySec = { ...s };
      byId.set(id, copySec);
      merged.push(copySec);
    }
    for (const t of treeSecs) {
      const id = String(t.sectionId || 'current');
      const hit = byId.get(id);
      if (hit) {
        Object.assign(hit, {
          hasSubtitle: typeof hit.hasSubtitle === 'boolean' ? hit.hasSubtitle : t.hasSubtitle,
          subtitleStatus: hit.subtitleStatus && hit.subtitleStatus !== 'pending' ? hit.subtitleStatus : t.subtitleStatus,
          subtitleReason: hit.subtitleReason || t.subtitleReason || '',
          subtitleLogs: hit.subtitleLogs?.length ? hit.subtitleLogs : (t.subtitleLogs || []),
          summary: t.summary || hit.summary || '',
          keyPoints: t.keyPoints || hit.keyPoints || [],
          outline: t.outline || t.topics || hit.outline || [],
          topics: t.topics || t.outline || hit.topics || [],
          timeline: t.timeline?.length ? t.timeline : hit.timeline,
        });
      } else {
        const copyTree = { ...t };
        byId.set(id, copyTree);
        merged.push(copyTree);
      }
    }
    return merged;
  };

  const resolveFocusedSection = () => {
    const list = getAllCourseSections();
    if (!list.length) return null;
    if (kgFocusSectionId) {
      const match = list.find(s => String(s.sectionId) === String(kgFocusSectionId));
      if (match) return match;
    }
    return list.find(s => s.active) || list[0];
  };

  const getCurrentCourseId = () => kgLastResult?.courseData?.courseId || kgLastResult?.tree?.courseId || 'unknown';

  const openAiSettingsFromModal = () => {
    closeKnowledgeModal();
    setOpen(true);
    settingsBox.open = true;
    syncAiForm();
    aiApiKey.focus();
  };

  const renderTextWithSeekLinks = (container, text, sectionId, onSeek) => {
    container.replaceChildren();
    const str = String(text ?? '');
    const regex = /(?<!\d)(\d{1,2}:\d{2}(?::\d{2})?)(?!\d)/gu;
    let last = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
      if (match.index > last) container.append(document.createTextNode(str.slice(last, match.index)));
      const parts = match[1].split(':').map(Number);
      const sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
      if (Number.isFinite(sec) && parts.at(-1) < 60 && parts.at(-2) < 60) {
        const btn = element('button', match[1], container);
        btn.type = 'button'; btn.className = 'kg-inline-time'; btn.dataset.seekSeconds = String(sec);
        btn.title = `跳播至 ${formatTimestamp(sec)}`;
        btn.addEventListener('click', () => onSeek({ sectionId: sectionId || 'current', seconds: sec }));
      } else {
        container.append(document.createTextNode(match[1]));
      }
      last = regex.lastIndex;
    }
    if (last < str.length) container.append(document.createTextNode(str.slice(last)));
  };

  const hasAnyCourseSubtitleCandidate = () => {
    const raw = Array.isArray(kgLastResult?.courseData?.sections) ? kgLastResult.courseData.sections : [];
    if (!raw.length) return false;
    if ((kgLastResult?.courseData?.captionedSections || 0) > 0) return true;
    return raw.some(s => s.hasSubtitle === true || (!s.subtitleChecked && s.hasSubtitle !== false && Boolean(s.captionVtt)));
  };

  const syncSectionPicker = () => {
    if (!kgModal) return;
    const list = getAllCourseSections();
    const focused = resolveFocusedSection();
    kgModal.secPicker.replaceChildren();
    for (const sec of list) {
      const noSubTag = sec.hasSubtitle === false ? ' [无字幕]' : '';
      const opt = element('option', `${sec.sectionIndex || ''}${sec.sectionIndex ? '. ' : ''}${sec.title || '课节'}${noSubTag}`, kgModal.secPicker);
      opt.value = String(sec.sectionId || 'current');
    }
    if (focused) {
      kgFocusSectionId = String(focused.sectionId || 'current');
      kgModal.secPicker.value = kgFocusSectionId;
    }
    kgModal.secPickerWrap.hidden = list.length === 0;
  };

  const syncSubtitleDiagnosticsView = () => {
    if (!kgModal) return;
    const logs = kgLastResult?.courseData?.subtitleDiagnostics || kgLastResult?.tree?.subtitleDiagnostics || [];
    const hasLogs = logs.length > 0;
    const failCount = logs.filter(item => !item.ok).length;
    const okCount = logs.length - failCount;
    kgModal.subDiagWrap.hidden = !hasLogs;
    kgModal.subDiagPre.textContent = hasLogs ? formatSubtitleDiagnosticsText(logs) : '';
    const estCourse = kgLastResult?.estimates?.course;
    const tokenHint = estCourse && estCourse.totalTokens > 0
      ? `~${estCourse.totalTokens >= 1000 ? `${(estCourse.totalTokens / 1000).toFixed(1)}k` : estCourse.totalTokens} tokens`
      : '0 tokens';
    kgModal.metaSummary.textContent = hasLogs
      ? (okCount === 0
        ? `ⓘ 估算与诊断 · ${tokenHint} · 字幕 ${logs.length} 路未命中`
        : `ⓘ 估算与诊断 · ${tokenHint} · 诊断 ${logs.length} 条`)
      : `ⓘ 预估 · ${tokenHint}`;
  };

  const syncSubtitleControls = () => {
    if (!kgModal) return;
    const focused = resolveFocusedSection();
    const focusedHasSub = sectionHasSubtitle(focused);
    const courseCanAnalyze = hasAnyCourseSubtitleCandidate();
    const noSubTip = '本课无字幕：该课节没有 AI 字幕，无法生成时间轴导览/问答/出题';
    const courseNoSubTip = '本课无字幕：整门课未检测到可用 AI 字幕';

    kgModal.secAiBtn.disabled = kgRunning || !focusedHasSub;
    kgModal.secAiBtn.title = !focusedHasSub ? noSubTip : '仅使用 AI 分析当前选中的课节';
    kgModal.quizAiBtn.disabled = kgRunning || kgQuizBusy || !focusedHasSub;
    kgModal.quizAiBtn.title = !focusedHasSub ? noSubTip : '依据当前课节字幕用 AI 出题';
    kgModal.courseAiBtn.disabled = kgRunning || !courseCanAnalyze;
    kgModal.courseAiBtn.title = !courseCanAnalyze ? courseNoSubTip : '按课节分段分析整门课（自动跳过无字幕课节）';
    const canRegen = kgLastScope === 'section' ? focusedHasSub : courseCanAnalyze;
    kgModal.regenBtn.disabled = kgRunning || !canRegen;
    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    kgModal.qaInput.disabled = kgQaBusy || !focusedHasSub;
    kgModal.qaSendBtn.disabled = kgQaBusy || !hasKey || !focusedHasSub;
  };

  const renderQaDock = () => {
    if (!kgModal) return;
    const focused = resolveFocusedSection();
    const focusedHasSub = sectionHasSubtitle(focused);
    const courseId = getCurrentCourseId();
    const sectionId = focused?.sectionId || 'current';
    const sectionTitle = focused?.title || '当前课节';
    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    const stored = loadSectionChat(win, courseId, sectionId);
    const messages = stored.messages || [];

    kgModal.qaTitle.textContent = `💬 问答 · 《${sectionTitle}》${focusedHasSub ? ` (${messages.length})` : ''}`;
    kgModal.qaToggleBtn.textContent = kgQaExpanded ? '收起 ▾' : `对话 (${messages.length}) ▴`;
    kgModal.qaClearBtn.hidden = messages.length === 0;
    kgModal.qaNoSub.hidden = focusedHasSub;
    if (!focusedHasSub) {
      kgModal.qaNoSub.textContent = '本课无字幕，暂不可提问';
    }
    kgModal.qaNoAi.hidden = !focusedHasSub || hasKey;
    kgModal.qaInput.placeholder = !focusedHasSub
      ? '本课无字幕，暂不可提问'
      : hasKey
        ? `针对《${sectionTitle}》提问（回车发送）`
        : '需先配置 AI';
    kgModal.qaSendBtn.disabled = kgQaBusy || !hasKey || !focusedHasSub;
    kgModal.qaSendBtn.title = !focusedHasSub ? '本课无字幕，无法基于字幕提问' : '';
    kgModal.qaInput.disabled = kgQaBusy || !focusedHasSub;

    kgModal.qaThread.hidden = !kgQaExpanded;
    kgModal.qaThread.replaceChildren();
    if (kgQaExpanded) {
      if (!messages.length) {
        const emptyHint = !focusedHasSub
          ? '本课无字幕，暂不可提问。'
          : hasKey
            ? '暂无对话，输入问题后 AI 将依据本节字幕回答并标注时间点。'
            : '需先配置 AI 后方可提问。';
        element('p', emptyHint, kgModal.qaThread).className = 'muted';
      } else {
        for (const msg of messages) {
          const bubble = element('div', '', kgModal.qaThread);
          bubble.className = 'kg-qa-msg';
          bubble.dataset.role = msg.role;
          if (msg.role === 'assistant') {
            const textDiv = element('div', '', bubble);
            renderTextWithSeekLinks(textDiv, msg.content, sectionId, handleKgSeek);
            if (Array.isArray(msg.citations) && msg.citations.length) {
              const citeWrap = element('div', '', bubble); citeWrap.className = 'kg-qa-cites';
              for (const c of msg.citations) {
                const chip = element('button', `依据 · ${c.minuteLabel} (${c.timestamp})${c.note ? ` · ${c.note}` : ''}`, citeWrap);
                chip.type = 'button'; chip.className = 'kg-qa-cite'; chip.dataset.seekSeconds = String(c.seconds);
                chip.addEventListener('click', () => handleKgSeek({ sectionId, seconds: c.seconds }));
              }
            }
            if (msg.contextMeta?.truncated) {
              element('div', `上下文：超长课节已按相关性精选 ${msg.contextMeta.selectedSegments}/${msg.contextMeta.totalSegments} 段字幕`, bubble).className = 'kg-qa-meta';
            }
          } else {
            bubble.textContent = msg.content;
          }
        }
        kgModal.qaThread.scrollTop = kgModal.qaThread.scrollHeight;
      }
    }
  };

  const handleQaSend = async () => {
    if (!kgModal || kgQaBusy) return;
    const focused = resolveFocusedSection();
    if (!focused) {
      setKgBanner('当前未识别到课节上下文，无法提问。', 'warn');
      return;
    }
    if (!sectionHasSubtitle(focused)) {
      setKgBanner(focused.subtitleReason || '本课无字幕：该课节没有 AI 字幕，因此无法基于字幕进行 AI 问答。', 'warn');
      renderQaDock();
      return;
    }
    const question = kgModal.qaInput.value.trim();
    if (!question) return;
    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    if (!hasKey) {
      setKgBanner('需先配置 AI：请先点击「AI 设置」填写 Provider、Base URL 与 API Key 后再向 AI 提问。', 'warn');
      renderQaDock();
      return;
    }
    kgQaBusy = true;
    kgQaExpanded = true;
    renderQaDock();
    setKgBanner(`正在结合《${focused.title}》字幕向 AI 提问…`, 'info');
    try {
      kgQaAbort?.abort?.();
      kgQaAbort = typeof AbortController === 'function' ? new AbortController() : null;
      const deps = kg.getTransportDeps ? kg.getTransportDeps() : {};
      const res = await askSectionQuestion({
        win,
        courseTitle: kgLastResult?.tree?.courseTitle || '当前课程',
        courseId: getCurrentCourseId(),
        section: focused,
        question,
        settings: kg.getSettings(),
        gmRequest: deps.gmRequest,
        fetchFn: deps.fetchFn,
        signal: kgQaAbort?.signal,
      });
      if (!kgModal) return;
      if (res.ok) {
        kgModal.qaInput.value = '';
        setKgBanner(res.contextMeta?.truncated
          ? `已回答（超长课节按相关性选取 ${res.contextMeta.selectedSegments}/${res.contextMeta.totalSegments} 段字幕，点击时间点可跳播）。`
          : '已回答，点击回复中的时间点可定位播放。', 'info');
      } else {
        setKgBanner(res.error || 'AI 提问失败。', 'warn');
      }
    } finally {
      kgQaBusy = false;
      renderQaDock();
    }
  };

  const renderQuizPane = () => {
    if (!kgModal) return;
    const container = kgModal.quizPane;
    container.replaceChildren();
    const focused = resolveFocusedSection();
    const focusedHasSub = sectionHasSubtitle(focused);
    const courseId = getCurrentCourseId();
    const sectionId = focused?.sectionId || 'current';
    const sectionTitle = focused?.title || '当前课节';
    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    const stored = loadSectionQuiz(win, courseId, sectionId);

    const headCard = element('div', '', container); headCard.className = 'kg-card';
    const headRow = element('div', '', headCard); headRow.className = 'kg-card-head';
    element('h3', `课节出题自测 · 《${sectionTitle}》`, headRow);
    const actions = element('div', '', headRow); actions.className = 'diag-actions';
    const genBtn = element('button', stored ? '重新出题' : '用 AI 出题', actions);
    genBtn.type = 'button'; genBtn.className = stored ? 'ghost' : 'primary';
    genBtn.dataset.action = stored ? 'kg-quiz-regenerate' : 'kg-quiz-generate';
    genBtn.disabled = kgQuizBusy || !focusedHasSub;
    if (!focusedHasSub) genBtn.title = '本课无字幕，无法基于字幕出题';
    genBtn.addEventListener('click', () => runSectionQuiz({ forceRefresh: Boolean(stored) }));

    if (!focusedHasSub) {
      const noSubBox = element('div', '', headCard); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgQuizNosub = '';
      element('strong', '本课无字幕', noSubBox);
      const detailReason = String(focused?.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
      element('div', detailReason, noSubBox);
      if (!stored) return;
    }

    if (stored) {
      const tm = formatCacheClock(stored.cachedAt);
      const badge = element('span', `本地缓存试题${tm ? ` · ${tm}` : ''}（0 token）`, headCard);
      badge.className = 'kg-badge'; badge.dataset.tone = 'cache'; badge.dataset.kgQuizCache = '';
    }

    if (!hasKey && !stored) {
      const noAi = element('div', '', headCard); noAi.className = 'kg-qa-noai'; noAi.dataset.kgQuizNoai = '';
      element('span', '需先配置 AI 才可出题', noAi);
      const goCfg = element('button', '去设置', noAi); goCfg.type = 'button'; goCfg.className = 'kg-mini-btn primary';
      goCfg.addEventListener('click', openAiSettingsFromModal);
      return;
    }

    if (!stored) {
      element('p', '点击右上角「用 AI 出题」，依据本节字幕生成 3–5 道自测题并缓存。', headCard).className = 'muted';
      return;
    }

    const attempt = stored.attempt || { answers: {}, submitted: false };
    const answers = { ...(attempt.answers || {}) };
    const persistAttempt = nextAttempt => {
      stored.attempt = nextAttempt;
      saveSectionQuiz(win, courseId, sectionId, stored);
    };

    if (attempt.submitted) {
      const graded = gradeSectionQuiz(stored.questions, answers);
      const scoreBar = element('div', '', container); scoreBar.className = 'kg-score-bar'; scoreBar.dataset.kgQuizScore = '';
      const scoreText = graded.choiceTotal > 0
        ? `选择题得分：${graded.choiceCorrect} / ${graded.choiceTotal}（${graded.percent}%）${graded.shortTotal ? ` · 含 ${graded.shortTotal} 道简答题（供对照自评，不自动判分）` : ''}`
        : `共 ${graded.shortTotal} 道简答题（供对照自评，不做自动判分）`;
      element('span', scoreText, scoreBar);
      const resetAns = element('button', '重做本题组', scoreBar); resetAns.type = 'button'; resetAns.className = 'kg-mini-btn ghost';
      resetAns.addEventListener('click', () => {
        persistAttempt({ answers: {}, submitted: false, submittedAt: null });
        renderQuizPane();
      });
    }

    const gradedMap = attempt.submitted ? gradeSectionQuiz(stored.questions, answers).details : {};
    stored.questions.forEach((q, idx) => {
      const qCard = element('div', '', container); qCard.className = 'kg-card'; qCard.dataset.kgQuizItem = q.id;
      const qHead = element('div', '', qCard); qHead.className = 'kg-card-head';
      const typeLabel = q.type === 'choice' ? '选择题' : '简答题';
      element('h3', `${idx + 1}. [${typeLabel}] ${q.question}`, qHead);
      createTimeBtn(qHead, sectionId, q.seconds, handleKgSeek);

      if (q.type === 'choice') {
        const optList = element('div', '', qCard); optList.className = 'kg-opt-list';
        const gInfo = gradedMap[q.id];
        q.options.forEach((optText, optIdx) => {
          const label = element('label', '', optList); label.className = 'kg-opt-row';
          const radio = element('input', '', label);
          radio.type = 'radio'; radio.name = `wd-quiz-${sectionId}-${q.id}`; radio.value = String(optIdx);
          radio.checked = answers[q.id] === optIdx;
          radio.disabled = Boolean(attempt.submitted);
          radio.addEventListener('change', () => {
            answers[q.id] = optIdx;
            persistAttempt({ ...attempt, answers });
          });
          element('span', optText, label);
          if (gInfo) {
            if (optIdx === q.correctIndex) label.dataset.grade = 'correct';
            else if (optIdx === gInfo.chosen && !gInfo.correct) label.dataset.grade = 'wrong';
          }
        });
        if (gInfo) {
          const fb = element('p', gInfo.correct ? '✅ 回答正确' : `❌ 回答有误（正确答案：${q.answerLetter}）`, qCard);
          fb.className = gInfo.correct ? 'muted' : 'status';
        }
      } else {
        const shortInput = element('input', '', qCard);
        shortInput.type = 'text'; shortInput.className = 'kg-short-input';
        shortInput.name = `wd-short-${q.id}`;
        shortInput.placeholder = '在此记录你的简答思路（自动保存，提交后对照参考答案自评）';
        shortInput.value = String(answers[q.id] ?? '');
        shortInput.addEventListener('input', () => {
          answers[q.id] = shortInput.value;
          persistAttempt({ ...attempt, answers });
        });
        element('small', '简答题不做自动判分，展开下方参考答案与解析自行核对。', qCard).className = 'muted';
      }

      const expFold = element('details', '', qCard); expFold.className = 'kg-explain-fold'; expFold.open = Boolean(attempt.submitted);
      element('summary', q.type === 'choice' ? '查看答案与解析' : '查看参考答案与解析', expFold);
      const expBody = element('div', '', expFold); expBody.className = 'kg-explain-body';
      if (q.type === 'choice') {
        element('div', `正确答案：${q.options[q.correctIndex] || q.answerLetter}`, expBody);
      } else {
        element('div', `参考答案：${q.referenceAnswer}`, expBody);
      }
      if (q.explanation) {
        const expText = element('div', '', expBody);
        renderTextWithSeekLinks(expText, `解析：${q.explanation}`, sectionId, handleKgSeek);
      }
      if (Number.isFinite(q.seconds) && q.seconds >= 0) {
        const jumpRow = element('div', '', expBody); jumpRow.className = 'row';
        element('small', `视频依据：约第 ${Math.floor(q.seconds / 60) + 1} 分钟`, jumpRow).className = 'muted';
        createTimeBtn(jumpRow, sectionId, q.seconds, handleKgSeek);
      }
    });

    if (!attempt.submitted) {
      const footer = element('div', '', container); footer.className = 'buttons';
      const submitBtn = element('button', '提交作答并判分', footer);
      submitBtn.type = 'button'; submitBtn.className = 'primary'; submitBtn.dataset.action = 'kg-quiz-submit';
      submitBtn.addEventListener('click', () => {
        const graded = gradeSectionQuiz(stored.questions, answers);
        persistAttempt({
          answers,
          submitted: true,
          submittedAt: Date.now(),
          choiceTotal: graded.choiceTotal,
          choiceCorrect: graded.choiceCorrect,
        });
        renderQuizPane();
      });
    }
  };

  const runSectionQuiz = async ({ forceRefresh = false } = {}) => {
    if (!kgModal || kgQuizBusy) return;
    const focused = resolveFocusedSection();
    if (!focused) { setKgBanner('当前未识别到课节，无法出题。', 'warn'); return; }
    if (!sectionHasSubtitle(focused)) {
      switchKgTab('quiz');
      setKgBanner(focused.subtitleReason || '本课无字幕：该课节没有 AI 字幕，因此无法基于字幕出题。', 'warn');
      return;
    }
    switchKgTab('quiz');
    kgQuizBusy = true;
    renderQuizPane();
    setKgBanner(forceRefresh ? `正在为《${focused.title}》重新生成题目…` : `正在加载或生成《${focused.title}》自测题…`, 'info');
    try {
      kgQuizAbort?.abort?.();
      kgQuizAbort = typeof AbortController === 'function' ? new AbortController() : null;
      const deps = kg.getTransportDeps ? kg.getTransportDeps() : {};
      const res = await generateSectionQuiz({
        win,
        courseTitle: kgLastResult?.tree?.courseTitle || '当前课程',
        courseId: getCurrentCourseId(),
        section: focused,
        settings: kg.getSettings(),
        forceRefresh,
        gmRequest: deps.gmRequest,
        fetchFn: deps.fetchFn,
        signal: kgQuizAbort?.signal,
      });
      if (!kgModal) return;
      if (res.ok) {
        setKgBanner(res.fromCache
          ? `已加载《${focused.title}》本地缓存试题（0 token）；可继续作答或点「重新出题」。`
          : `已为《${focused.title}》生成 ${res.quiz.questions.length} 道自测题并缓存到本地。`, 'info');
      } else {
        setKgBanner(res.error || 'AI 出题失败。', 'warn');
      }
    } finally {
      kgQuizBusy = false;
      renderQuizPane();
    }
  };

  const openKnowledgeModal = async ({ targetSectionId = null, scope = null, initialTab = 'quick' } = {}) => {
    if (!kgModal) {
      const backdrop = element('div', '', root); backdrop.className = 'kg-backdrop'; backdrop.dataset.knowledgeModal = '';
      const dialog = element('div', '', backdrop); dialog.className = 'kg-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', '课程知识点导览与导图');
      const head = element('div', '', dialog); head.className = 'kg-head';
      const headTop = element('div', '', head); headTop.className = 'kg-head-top';
      const titleWrap = element('div', '', headTop); titleWrap.className = 'kg-title-wrap';
      const kgTitle = element('h2', 'AI 导览', titleWrap); kgTitle.dataset.kgTitle = '';
      const kgBadge = element('span', '零 AI 速览', titleWrap); kgBadge.className = 'kg-badge'; kgBadge.dataset.kgMode = '';
      const kgScopeBadge = element('span', '', titleWrap); kgScopeBadge.className = 'kg-badge'; kgScopeBadge.dataset.tone = 'scope'; kgScopeBadge.dataset.kgScope = ''; kgScopeBadge.hidden = true;
      const kgCacheBadge = element('span', '', titleWrap); kgCacheBadge.className = 'kg-badge'; kgCacheBadge.dataset.tone = 'cache'; kgCacheBadge.dataset.kgCache = ''; kgCacheBadge.hidden = true;
      const headControls = element('div', '', headTop); headControls.className = 'kg-head-controls';
      const cfgBtn = button('kg-open-settings', '⚙ 设置', headControls, openAiSettingsFromModal, false); cfgBtn.className = 'ghost kg-mini-btn'; cfgBtn.title = 'AI 设置';
      const closeBtn = button('kg-close', '✕', headControls, () => closeKnowledgeModal(), false); closeBtn.className = 'ghost kg-mini-btn'; closeBtn.setAttribute('aria-label', '关闭');

      const headRow2 = element('div', '', head); headRow2.className = 'kg-head-row2';
      const secPickerWrap = element('div', '', headRow2); secPickerWrap.className = 'kg-sec-picker-wrap'; secPickerWrap.hidden = true;
      const secPicker = element('select', '', secPickerWrap); secPicker.className = 'kg-sec-picker'; secPicker.dataset.kgSectionPicker = ''; secPicker.setAttribute('aria-label', '选择当前查看与问答的课节');
      secPicker.addEventListener('change', async () => {
        kgFocusSectionId = secPicker.value || null;
        await runKnowledge({ scope: 'section', sectionId: kgFocusSectionId, useAi: false, preferCacheOnOpen: true });
      });
      const triggerRow = element('div', '', headRow2); triggerRow.className = 'diag-actions';
      const secAiBtn = button('kg-ai-section', 'AI 本节', triggerRow, () => runKnowledge({ scope: 'section', sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }), false); secAiBtn.className = 'primary';
      const courseAiBtn = button('kg-ai-course', 'AI 全课', triggerRow, () => runKnowledge({ scope: 'course', sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }), false);
      const quizAiBtn = button('kg-ai-quiz', '出题', triggerRow, () => runSectionQuiz({ forceRefresh: false }), false);
      const zeroBtn = button('kg-zero-ai', '零 AI', triggerRow, () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: false, forceRefresh: false }), false); zeroBtn.className = 'ghost';
      const regenBtn = button('kg-regenerate', '重生成', triggerRow, () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: true, forceRefresh: true }), false); regenBtn.className = 'ghost'; regenBtn.hidden = true;
      const abortBtn = button('kg-abort', '停止', triggerRow, () => { kg.abort(); kgQaAbort?.abort?.(); kgQuizAbort?.abort?.(); }, false); abortBtn.className = 'danger'; abortBtn.hidden = true;

      const metaFold = element('details', '', dialog); metaFold.className = 'kg-meta-fold'; metaFold.dataset.kgMetaFold = ''; metaFold.open = false;
      const metaSummary = element('summary', 'ⓘ 估算与诊断', metaFold); metaSummary.dataset.kgMetaSummary = '';
      const metaBody = element('div', '', metaFold); metaBody.className = 'kg-meta-body';
      const estimateBar = element('div', '', metaBody); estimateBar.className = 'kg-estimate'; estimateBar.dataset.kgEstimate = '';
      const subDiagWrap = element('div', '', metaBody); subDiagWrap.dataset.kgSubDiag = ''; subDiagWrap.hidden = true;
      const subDiagHead = element('div', '', subDiagWrap); subDiagHead.className = 'kg-diag-head';
      element('small', '字幕诊断（captionVtt → Video.js → 课程接口）', subDiagHead).className = 'muted';
      const copySubDiagBtn = button('kg-copy-sub-diag', '复制诊断', subDiagHead, async () => {
        const text = subDiagPre.textContent;
        if (!text) return;
        if (win.navigator?.clipboard?.writeText) {
          await win.navigator.clipboard.writeText(text);
          setKgBanner('已复制诊断日志', 'info');
        }
      }, false); copySubDiagBtn.className = 'kg-mini-btn ghost';
      const subDiagPre = element('pre', '', subDiagWrap); subDiagPre.className = 'kg-diag-pre'; subDiagPre.dataset.kgSubDiagLog = '';

      const banner = element('div', '', dialog); banner.className = 'kg-banner'; banner.dataset.kgBanner = ''; banner.hidden = true;
      const toolbar = element('div', '', dialog); toolbar.className = 'kg-toolbar';
      const tabs = element('div', '', toolbar); tabs.className = 'kg-tabs';
      const tabButtons = {};
      for (const [id, label] of [['quick', '速览'], ['detail', '细读'], ['quiz', '自测'], ['map', '导图'], ['md', 'MD']]) {
        const tb = button(`kg-tab-${id}`, label, tabs, () => switchKgTab(id), false);
        tb.setAttribute('aria-selected', String(id === kgActiveTab));
        tabButtons[id] = tb;
      }
      const toolRight = element('div', '', toolbar); toolRight.className = 'diag-actions';
      const fitBtn = button('kg-fit', '适应', toolRight, () => kgMapHandle?.fit?.(), false); fitBtn.className = 'ghost';
      const copyMdBtn = button('kg-copy-md', '复制', toolRight, async () => {
        const fullMd = kgLastResult?.tree ? buildKnowledgeMarkdown(kgLastResult.tree, { includeExtras: true }) : kgLastResult?.markdown;
        if (!fullMd) return;
        if (win.navigator?.clipboard?.writeText) {
          await win.navigator.clipboard.writeText(fullMd);
          setKgBanner('已复制 Markdown', 'info');
        } else {
          setKgBanner('请切至 MD 标签手动复制', 'info');
        }
      }, false); copyMdBtn.className = 'ghost';
      const dlMdBtn = button('kg-download-md', '导出', toolRight, () => {
        const fullMd = kgLastResult?.tree ? buildKnowledgeMarkdown(kgLastResult.tree, { includeExtras: true }) : kgLastResult?.markdown;
        if (!fullMd || typeof win.Blob !== 'function' || typeof win.URL?.createObjectURL !== 'function') return;
        const blob = new win.Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
        const url = win.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = String(kgLastResult.tree?.courseTitle || '课程导览').replace(/[\\/:*?"<>|\x00-\x1f]+/gu, '_').slice(0, 60);
        a.href = url; a.download = `${safeName}-知识点导览.md`; a.click();
        win.URL.revokeObjectURL(url);
      }, false); dlMdBtn.className = 'ghost';
      const kgBody = element('div', '', dialog); kgBody.className = 'kg-body';
      const quickPane = element('div', '', kgBody); quickPane.className = 'kg-scroll'; quickPane.dataset.kgPane = 'quick';
      const detailPane = element('div', '', kgBody); detailPane.className = 'kg-scroll'; detailPane.dataset.kgPane = 'detail'; detailPane.hidden = true;
      const quizPane = element('div', '', kgBody); quizPane.className = 'kg-scroll'; quizPane.dataset.kgPane = 'quiz'; quizPane.hidden = true;
      const mapPane = element('div', '', kgBody); mapPane.className = 'kg-pane'; mapPane.dataset.kgPane = 'map'; mapPane.hidden = true;
      const svgWrap = element('div', '', mapPane); svgWrap.className = 'kg-svg-wrap';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.dataset.kgSvg = ''; svgWrap.append(svg);
      const engineFoot = element('div', '导图加载中…', mapPane); engineFoot.className = 'kg-engine-foot'; engineFoot.dataset.kgEngine = '';
      const mdPane = element('div', '', kgBody); mdPane.className = 'kg-md-pane'; mdPane.dataset.kgPane = 'md'; mdPane.hidden = true;
      const mdPre = element('pre', '', mdPane); mdPre.dataset.kgMd = '';

      // Persistent bottom section-level AI Q&A dock
      const qaDock = element('div', '', dialog); qaDock.className = 'kg-qa-dock'; qaDock.dataset.kgQaDock = '';
      const qaBar = element('div', '', qaDock); qaBar.className = 'kg-qa-bar';
      const qaTitle = element('strong', '💬 问答', qaBar); qaTitle.dataset.kgQaTitle = '';
      const qaBarActions = element('div', '', qaBar); qaBarActions.className = 'diag-actions';
      const qaToggleBtn = button('kg-qa-toggle', '对话 ▴', qaBarActions, () => { kgQaExpanded = !kgQaExpanded; renderQaDock(); }, false); qaToggleBtn.className = 'ghost';
      const qaClearBtn = button('kg-qa-clear', '清空', qaBarActions, () => {
        const sec = resolveFocusedSection();
        clearSectionChat(win, getCurrentCourseId(), sec?.sectionId || 'current');
        renderQaDock();
      }, false); qaClearBtn.className = 'ghost'; qaClearBtn.hidden = true;
      const qaNoSub = element('div', '', qaDock); qaNoSub.className = 'kg-qa-nosub'; qaNoSub.dataset.kgQaNosub = ''; qaNoSub.hidden = true;
      const qaNoAi = element('div', '', qaDock); qaNoAi.className = 'kg-qa-noai'; qaNoAi.dataset.kgQaNoai = ''; qaNoAi.hidden = true;
      element('span', '需先配置 AI 才可提问', qaNoAi);
      const qaGoCfg = button('kg-qa-go-settings', '去设置', qaNoAi, openAiSettingsFromModal, false); qaGoCfg.className = 'kg-mini-btn primary';
      const qaThread = element('div', '', qaDock); qaThread.className = 'kg-qa-thread'; qaThread.dataset.kgQaThread = ''; qaThread.hidden = true;
      const qaInputRow = element('div', '', qaDock); qaInputRow.className = 'kg-qa-input-row';
      const qaInput = element('input', '', qaInputRow); qaInput.type = 'text'; qaInput.name = 'kg-qa-input'; qaInput.dataset.kgQaInput = ''; qaInput.setAttribute('aria-label', '向 AI 提问');
      qaInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); void handleQaSend(); } });
      const qaSendBtn = button('kg-qa-send', '发送', qaInputRow, () => handleQaSend(), false); qaSendBtn.className = 'primary';

      kgModal = { backdrop, kgTitle, kgBadge, kgScopeBadge, kgCacheBadge, zeroBtn, secAiBtn, courseAiBtn, quizAiBtn, regenBtn, abortBtn, secPickerWrap, secPicker, metaFold, metaSummary, estimateBar, banner, subDiagWrap, subDiagPre, tabButtons, fitBtn, quickPane, detailPane, quizPane, mapPane, svg, engineFoot, mdPane, mdPre, qaDock, qaTitle, qaToggleBtn, qaClearBtn, qaNoSub, qaNoAi, qaThread, qaInput, qaSendBtn };
    }
    kgFocusSectionId = targetSectionId || null;
    kgActiveTab = initialTab || 'quick';
    const openScope = scope || (targetSectionId ? 'section' : 'course');
    await runKnowledge({ scope: openScope, sectionId: targetSectionId, useAi: false, preferCacheOnOpen: true });
  };
  const setKgBanner = (text, tone = 'warn') => {
    if (!kgModal) return;
    kgModal.banner.textContent = text || '';
    kgModal.banner.dataset.tone = tone;
    kgModal.banner.hidden = !text;
  };
  const switchKgTab = id => {
    kgActiveTab = id;
    if (!kgModal) return;
    for (const [k, btn] of Object.entries(kgModal.tabButtons)) btn.setAttribute('aria-selected', String(k === id));
    kgModal.quickPane.hidden = id !== 'quick';
    kgModal.detailPane.hidden = id !== 'detail';
    kgModal.quizPane.hidden = id !== 'quiz';
    kgModal.mapPane.hidden = id !== 'map';
    kgModal.mdPane.hidden = id !== 'md';
    kgModal.fitBtn.hidden = id !== 'map';
    if (id === 'quiz') renderQuizPane();
    if (id === 'map') void ensureKgMapRendered();
  };
  const handleKgSeek = targetSeek => {
    const res = kg.seek(targetSeek);
    setKgBanner(res.message, res.ok && !res.degraded ? 'info' : 'warn');
  };
  const setKgBusy = active => {
    kgRunning = active;
    if (!kgModal) return;
    kgModal.zeroBtn.disabled = active;
    kgModal.secAiBtn.disabled = active;
    kgModal.courseAiBtn.disabled = active;
    kgModal.quizAiBtn.disabled = active;
    kgModal.regenBtn.disabled = active;
    kgModal.abortBtn.hidden = !active;
    if (!active) syncSubtitleControls();
  };
  const formatCacheClock = ts => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
  };
  const runKnowledge = async ({ scope, sectionId = null, useAi, forceRefresh = false, preferCacheOnOpen = false }) => {
    if (!kgModal || kgRunning) return;
    setKgBusy(true);
    setKgBanner(useAi ? (forceRefresh ? '正在重新请求 AI 生成结构化学习卡片…' : '正在读取课程字幕并生成 AI 学习卡片…') : '正在读取课程字幕并加载速览…', 'info');
    try {
      const result = await kg.analyze({
        scope,
        sectionId,
        useAi,
        forceRefresh,
        preferCacheOnOpen,
        onProgress: p => {
          if (!kgModal) return;
          if (p.stage === 'section') setKgBanner(`AI 分段分析进度：${p.done + 1}/${p.total} · ${p.title || ''}`, 'info');
          else if (p.stage === 'section-aggregate') setKgBanner(p.title || '正在收敛长课节要点…', 'info');
          else if (p.stage === 'aggregate') setKgBanner(p.title || '正在聚合整门课知识地图与总览…', 'info');
        },
      });
      if (!kgModal) return;
      kgLastResult = result;
      kgLastScope = result.tree?.scope || scope;
      kgLastUsedAi = Boolean(result.usedAi);
      if (sectionId) kgFocusSectionId = String(sectionId);
      else if (!kgFocusSectionId && result.tree?.activeSectionId) kgFocusSectionId = String(result.tree.activeSectionId);

      kgModal.kgTitle.textContent = result.tree?.courseTitle || '课程知识点导览';
      const isViewNoSubtitle = Boolean(result.noSubtitle || result.tree?.noSubtitle);
      if (isViewNoSubtitle) {
        kgModal.kgBadge.textContent = '本课无字幕';
        kgModal.kgBadge.dataset.tone = 'nosub';
      } else if (result.usedAi && !result.fallback) {
        kgModal.kgBadge.textContent = 'AI 速览';
        kgModal.kgBadge.dataset.tone = 'ai';
      } else if (result.fallback) {
        kgModal.kgBadge.textContent = result.usedAi ? 'AI 部分成功 · 局部回退零 AI' : 'AI 失败 · 已回退零 AI';
        kgModal.kgBadge.dataset.tone = 'fallback';
      } else {
        kgModal.kgBadge.textContent = '零 AI 速览（默认）';
        kgModal.kgBadge.dataset.tone = 'zero';
      }
      const scopeText = result.tree?.scopeLabel || '';
      kgModal.kgScopeBadge.textContent = scopeText ? `范围：${scopeText}` : '';
      kgModal.kgScopeBadge.hidden = !scopeText;
      if (result.fromCache) {
        const tm = formatCacheClock(result.cachedAt);
        kgModal.kgCacheBadge.textContent = `本地缓存${tm ? ` · ${tm}` : ''}（0 token）`;
        kgModal.kgCacheBadge.hidden = false;
      } else {
        kgModal.kgCacheBadge.hidden = true;
      }
      kgModal.regenBtn.hidden = !(result.fromCache || result.usedAi);

      kgModal.estimateBar.replaceChildren();
      if (result.estimates?.section) element('div', `当前课节预估：${result.estimates.section.summaryText}`, kgModal.estimateBar);
      if (result.estimates?.course) element('div', `整门课程预估：${result.estimates.course.summaryText}`, kgModal.estimateBar);
      const notices = [];
      if (result.fromCache) notices.push('已秒开本地缓存结果，未消耗 token；如需刷新请点「重新生成」。');
      if (isViewNoSubtitle) {
        notices.push('本课无字幕 · 已禁用 AI 分析、问答与出题');
      } else if (result.tree?.fallbackReason) {
        notices.push(result.tree.fallbackReason);
      }
      if (result.tree?.skippedSummary && !notices.includes(result.tree.skippedSummary)) notices.push(result.tree.skippedSummary);
      if (result.tree?.warnings?.length) {
        for (const w of result.tree.warnings.slice(0, 2)) {
          if (!notices.includes(w)) notices.push(w);
        }
      }
      setKgBanner(notices.join('\n'), (result.fallback || isViewNoSubtitle) ? 'warn' : 'info');

      // Sync confirmed subtitle availability back to section-list "AI 导览" gate
      const statusMap = {};
      for (const sec of (result.courseData?.sections || [])) {
        if (sec.sectionId && (sec.subtitleChecked || sec.hasSubtitle === false)) {
          statusMap[sec.sectionId] = { hasSubtitle: Boolean(sec.hasSubtitle), status: sec.subtitleStatus, reason: sec.subtitleReason };
        }
      }
      sectionGuideEntries.setSubtitleStatuses(statusMap, result.courseData?.courseId || null);

      syncSectionPicker();
      syncSubtitleDiagnosticsView();
      kgModal.mdPre.textContent = result.tree ? buildKnowledgeMarkdown(result.tree, { includeExtras: true }) : (result.markdown || '');
      renderKnowledgeQuick(kgModal.quickPane, result.tree, handleKgSeek, switchKgTab);
      renderKnowledgeDetail(kgModal.detailPane, result.tree, handleKgSeek);
      renderQuizPane();
      renderQaDock();
      switchKgTab(kgActiveTab);
      setKgBusy(false);
      void ensureKgMapRendered();
    } catch (err) {
      setKgBanner(`导览生成异常：${err?.message || err}`, 'warn');
    } finally {
      setKgBusy(false);
    }
  };
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
  const phaseLabels = { paused: '已暂停', preparing: '正在准备', running: '学习中', complete: '已完成', retrying: '正在重试', waiting: '等待学习时段', offline: '等待网络', resuming: '正在恢复', confirming: '等待平台确认' };
  const phaseLabel = state => phaseLabels[state.phase || state.status] || '等待确认';
  const playbackFor = (item, courseId) => {
    const value = latest.currentPlayback;
    return currentTask(item) && latest.status === 'running' && !['retrying', 'offline', 'resuming'].includes(latest.phase) && value?.taskId === item.id && value.courseId === courseId ? value : null;
  };
  const executionLabel = (item, courseId = latest.currentCourseId) => {
    if (latest.status !== 'running' || ['retrying', 'offline', 'resuming'].includes(latest.phase)) return latest.status === 'paused' ? '当前' : phaseLabel(latest);
    if (isDone(item, courseId)) return '正在切换课程';
    const playback = playbackFor(item, courseId);
    if (playback) return playback.ended ? '等待平台确认完成' : playback.paused ? '正在准备播放' : '正在播放';
    return latest.currentSectionTitle ? '学习中' : '正在进入课程';
  };
  const clock = value => { const seconds = Math.floor(value); const minutes = Math.floor(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  const playbackText = value => Number.isFinite(value?.currentTime) && Number.isFinite(value?.duration) && value.currentTime >= 0 && value.duration > 0 ? `${clock(Math.min(value.currentTime, value.duration))} / ${clock(value.duration)}` : '';
  const quietMessages = new Set([
    '已暂停', '已完成', '执行中', '学习中',
    '已暂停，确认配置和课程后点击开始。', '已暂停，继续学习需手动点击开始。',
    '正在按平台课节状态连续学习。', '等待平台确认当前课节完成。',
    '所选课程已全部完成。', '已进入学习时段，正在继续队列。', '正在重新进入课程。',
    '已读取待添加清单，请核对课程勾选后添加。',
    '请点击确认要学习的专题。', '请点击确认要学习的专区。',
    '有待学课程，请手动点击开始继续。',
  ]);
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
    try { if (!await controller.moveTask(id, index)) showUiError('顺序未保存，请查看当前提示后重试。'); }
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
    const scopeId = taskId || 'draft';
    const modeLabel = element('label', '学习范围', parent); const mode = element('select', '', modeLabel); mode.name = `course-mode-${scopeId}`; mode.title = '切换范围将重设当前勾选'; editors.add(mode);
    for (const [value, text] of [['all-pending', '全部待学'], ['specific', '仅学指定课程']]) { const option = element('option', text, mode); option.value = value; }
    mode.addEventListener('change', async () => {
      if (mode.disabled) return; busy.add(mode); mode.disabled = true;
      try { await controller.setTaskMode(taskId, mode.value); } catch { showUiError('学习范围未保存，请重试。'); }
      finally { busy.delete(mode); render(controller.getState()); }
    });
    const filter = element('input', '', parent); filter.type = 'search'; filter.className = 'filter-input'; filter.name = `course-filter-${scopeId}`; filter.setAttribute('aria-label', '筛选课程名称'); filter.placeholder = '筛选课程名称';
    filter.addEventListener('input', () => render(controller.getState()));
    const selection = element('p', '', parent); selection.className = 'muted';
    const controls = element('div', '', parent); controls.className = 'buttons';
    for (const [modeName, caption] of [['unfinished', '全选待学'], ['required', '仅选必修'], ['none', '清空']]) {
      const btn = button(`select-${modeName}-${scopeId}`, caption, controls, () => controller.selectCourses(taskId, modeName));
      if (modeName === 'none') btn.className = 'ghost';
    }
    const pending = element('div', '', parent); const completed = element('details', '', parent); completed.dataset.completed = '';
    const summary = element('summary', '已完成课程', completed);
    const completedActions = element('div', '', completed); completedActions.className = 'buttons completed-actions';
    button(`select-completed-${scopeId}`, '全选已完成', completedActions, () => controller.selectCourses(taskId, 'completed'));
    if (taskId !== null) button(`recheck-${taskId}`, '复查已选', completedActions, () => controller.recheckCompleted(taskId));
    const completeList = element('div', '', completed);
    const noMatches = element('p', '没有匹配的课程。', parent); noMatches.dataset.noMatches = ''; noMatches.className = 'muted';
    return { pending, completed, summary, completeList, nodes: new Map(), mode, filter, selection, noMatches };
  }
  function updateCourses(view, courses, item = null) {
    const ids = new Set(courses.map(course => course.id));
    for (const [id, row] of view.nodes) if (!ids.has(id)) { editors.delete(row.input); if (row.retry) editors.delete(row.retry); row.label.remove(); view.nodes.delete(id); }
    let completedCount = 0, visibleCount = 0, matchedCompleted = 0, selectedCount = 0, hiddenSelectedCount = 0;
    const query = view.filter.value.trim().toLocaleLowerCase();
    view.mode.value = (item || latest.draft)?.selectionMode || 'all-pending';
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
          catch { showUiError('勾选未能保存，请重试。'); }
          finally { busy.delete(input); render(controller.getState()); }
        });
        const retry = item ? button(`retry-${item.id}-${course.id}`, '重试', label, () => controller.retry(item.id, course.id)) : null;
        row = { label, input, caption, meta, section, retry, time, playback }; view.nodes.set(course.id, row);
      }
      const recheck = item?.recheck?.includes(course.id);
      const current = item && currentTask(item) && latest.currentCourseId === course.id && !isDone(item, course.id);
      const done = !current && !recheck && (isDone(item, course.id) || course.status === 'completed'); const skipped = item?.skipped.includes(course.id);
      const deferred = item?.deferred?.find(entry => entry.courseId === course.id);
      const status = deferred ? `待处理：${deferred.reason.replace(/[。.]$/u, '')}` : skipped ? '已跳过' : current ? (latest.status === 'paused' ? '当前课程' : executionLabel(item, course.id)) : recheck ? '待复查课节' : isDone(item, course.id) ? '已完成' : ({ completed: '已完成', learning: '学习中', 'not-started': '未开始', unknown: '待确认' }[course.status] || '待确认');
      row.label.dataset.state = current ? 'active' : deferred || skipped ? 'attention' : done ? 'completed' : 'pending';
      const playback = current ? playbackFor(item, course.id) : null; const timeText = playbackText(playback);
      row.time.textContent = timeText; row.time.hidden = !timeText; row.playback.hidden = !timeText;
      row.playback.max = timeText ? playback.duration : 1; row.playback.value = timeText ? Math.min(playback.currentTime, playback.duration) : 0;
      row.caption.textContent = course.title; row.caption.title = course.title;
      const reqTag = course.required ? '必修' : '选修';
      row.meta.textContent = deferred ? `${reqTag} · ${status}` : `${status} · ${reqTag}`; row.input.checked = course.selected;
      row.section.textContent = current && latest.currentSectionTitle ? `课节 · ${latest.currentSectionTitle}` : ''; row.section.title = latest.currentSectionTitle || ''; row.section.hidden = !row.section.textContent;
      row.input.disabled = latest.unavailable || ['running', 'preparing', 'waiting'].includes(latest.status) || Boolean(item?.scope === 'required' && !course.required);
      row.input.dataset.legacyDisabled = String(Boolean(item?.scope === 'required' && !course.required));
      if (row.retry) row.retry.hidden = !skipped && !deferred;
      const container = done && !skipped && !deferred ? view.completeList : view.pending;
      if (row.label.parentNode !== container) container.append(row.label);
      if (done && !skipped && !deferred) completedCount += 1;
      row.label.hidden = Boolean(query && !course.title.toLocaleLowerCase().includes(query));
      const isSelected = Boolean(course.selected && (item?.scope !== 'required' || course.required));
      if (isSelected) { selectedCount += 1; if (row.label.hidden) hiddenSelectedCount += 1; }
      if (!row.label.hidden) { visibleCount += 1; if (container === view.completeList) matchedCompleted += 1; }
    }
    view.selection.textContent = query && hiddenSelectedCount
      ? `已选 ${selectedCount}/${courses.length} 门（含 ${hiddenSelectedCount} 门未显示）`
      : `已选 ${selectedCount}/${courses.length} 门`;
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
        const up = button(`move-up-${item.id}`, '↑', sorting, () => movePriority(item.id, -1), false);
        const down = button(`move-down-${item.id}`, '↓', sorting, () => movePriority(item.id, 1), false);
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
          const from = latest.tasks.findIndex(task => task.id === id), targetIdx = latest.tasks.findIndex(task => task.id === item.id);
          const insertion = targetIdx + Number(after(event)); clearDrag();
          if (from < 0 || targetIdx < 0 || id === item.id || completeTask(latest.tasks[from])) return;
          try { await moveDisplayedTask(id, insertion - Number(from < insertion)); }
          catch { showUiError('顺序未保存，请查看当前提示后重试。'); }
        });
        const priority = element('p', '', article); priority.className = 'task-priority muted';
        const metaRow = element('div', '', article); metaRow.className = 'task-meta';
        const summary = element('p', '', metaRow); summary.dataset.taskSummary = item.id;
        const detailButton = button(`detail-${item.id}`, '详情 ▾', metaRow, () => { detail.hidden = !detail.hidden; detailButton.textContent = detail.hidden ? '详情 ▾' : '收起 ▴'; detailButton.setAttribute('aria-expanded', String(!detail.hidden)); }, false); detailButton.className = 'ghost detail-toggle'; detailButton.setAttribute('aria-expanded', 'false');
        const completion = element('progress', '', article); completion.dataset.taskProgress = item.id;
        const current = element('div', '', article); current.className = 'task-current';
        const currentName = element('div', '', current); currentName.className = 'current-name';
        const currentSection = element('small', '', current); currentSection.className = 'one-line';
        const currentTime = element('small', '', current); currentTime.className = 'playback-time';
        const detail = element('div', '', article); detail.dataset.taskDetail = item.id; detail.hidden = true;
        const legacy = element('p', '旧任务仅执行必修课程和课节；需要包含选修可移出后重新添加专区。', detail); legacy.className = 'muted';
        const courses = createCourseList(detail, item.id); const actions = element('div', '', detail); actions.className = 'buttons detail-actions';
        const refresh = button(`refresh-${item.id}`, '刷新课程', actions, () => controller.refreshTask(item.id));
        const remove = button(`remove-${item.id}`, '移出队列', actions, async () => {
          if (pendingRemoveId !== item.id) {
            clearRemoveConfirm();
            pendingRemoveId = item.id;
            pendingRemoveTimer = win.setTimeout(() => { clearRemoveConfirm(); render(controller.getState()); }, 3000);
            return;
          }
          clearRemoveConfirm();
          await controller.removeTask(item.id);
        });
        remove.className = 'danger';
        view = { article, title, sorting, priority, summary, completion, current, currentName, currentSection, currentTime, detail, legacy, courses, refresh, remove, handle, up, down }; taskNodes.set(item.id, view);
      }
      const subjectTitle = item.subject?.title || item.target;
      view.title.textContent = subjectTitle; view.title.title = subjectTitle;
      view.handle.setAttribute('aria-label', `拖动排序：${subjectTitle}`);
      view.up.setAttribute('aria-label', `上移：${subjectTitle}`);
      view.down.setAttribute('aria-label', `下移：${subjectTitle}`);
      const sortable = sortableTasks(); const priorityIndex = sortable.findIndex(task => task.id === item.id); const completed = completeTask(item), current = currentTask(item, state);
      const showSort = !completed && sortable.length >= 2;
      view.sorting.hidden = !showSort;
      view.handle.disabled = !canSort() || !showSort; view.handle.draggable = !view.handle.disabled;
      view.up.disabled = !canSort() || !showSort || priorityIndex <= 0; view.down.disabled = !canSort() || !showSort || priorityIndex === sortable.length - 1;
      view.up.title = '上移优先级（当前课程继续）'; view.down.title = '下移优先级（当前课程继续）';
      const confirmingRemove = pendingRemoveId === item.id && !isRunning(state) && !state.unavailable;
      view.remove.textContent = confirmingRemove ? '确认移出？' : '移出队列';
      view.remove.className = confirmingRemove ? 'danger danger-confirm' : 'danger';
      const total = counts(item);
      const issues = [['待处理', total.deferred], ['跳过', item.skipped.length], ['待复查', item.recheck?.length || 0]].filter(([, count]) => count).map(([name, count]) => `${name} ${count}`);
      view.article.dataset.state = current ? 'active' : completed ? 'completed' : issues.length ? 'attention' : 'pending';
      view.priority.textContent = `优先级 ${priorityIndex + 1}`; view.priority.hidden = completed || sortable.length < 2;
      if (!item.subject) view.summary.textContent = '尚未读取专区，请移出后重新添加';
      else if (!total.selected) view.summary.textContent = '尚未选择课程';
      else if (completed) view.summary.textContent = `已完成 ${total.selected} 门`;
      else if (current) view.summary.textContent = `${executionLabel(item)} · 完成 ${total.done}/${total.selected} 门${issues.length ? ` · ${issues.join(' · ')}` : ''}`;
      else if (issues.length) view.summary.textContent = `完成 ${total.done}/${total.selected} 门 · ${issues.join(' · ')}`;
      else view.summary.textContent = `待学习 · 完成 ${total.done}/${total.selected} 门`;
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
    const all = state.tasks.reduce((sum, task) => { const c = counts(task); return { done: sum.done + c.done, selected: sum.selected + c.selected, deferred: sum.deferred + c.deferred }; }, { done: 0, selected: 0, deferred: 0 });
    progress.textContent = `${phaseLabels[state.phase || state.status] || state.status} · 总完成 ${all.done}/${all.selected} 门${all.deferred ? ` · 待处理 ${all.deferred}` : ''}`;
    compact.textContent = active?.courses.find(course => course.id === state.currentCourseId)?.title || ''; compact.title = compact.textContent; compact.hidden = !body.hidden || !compact.textContent;
    compactTime.textContent = active ? playbackText(playbackFor(active, state.currentCourseId)) : ''; compactTime.hidden = !body.hidden || !compactTime.textContent;
    const rawNotice = quietMessages.has(state.message) ? '' : String(state.message || '').replace(/有待学课程，请手动点击开始继续。$/u, '').trim();
    const notice = quietMessages.has(rawNotice) ? '' : rawNotice;
    message.textContent = notice; execution.hidden = !notice || notice === state.problem?.reason;
    compactNotice.textContent = notice || state.problem?.reason || ''; compactNotice.hidden = !body.hidden || !compactNotice.textContent;
    problemBox.hidden = !state.problem;
    if (state.problem) { const item = state.tasks.find(task => task.id === state.problem.taskId); problemText.textContent = `${item?.subject?.title || item?.target || '专区'} · ${item?.courses.find(course => course.id === state.problem.courseId)?.title || '课程'}\n${state.problem.reason}`; }
    if (state.draft) adding = true;
    else if (draftSubjectId && state.tasks.some(item => item.subject?.id === draftSubjectId)) adding = false;
    draftSubjectId = state.draft?.subject.id || null;
    queueView.hidden = adding; addView.hidden = !adding; searchBox.hidden = Boolean(state.draft); draftBox.hidden = !state.draft;
    quickBar.hidden = adding;
    settingsBox.hidden = adding;
    empty.hidden = state.tasks.length > 0;
    for (const [name, field] of Object.entries(fields)) if (!dirty.has(name) && root.activeElement !== field) field.value = state.window[name];
    updateTasks(state);
    const signature = JSON.stringify(state.candidates);
    if (candidateSignature !== signature) { candidateSignature = signature; for (const control of candidates.querySelectorAll('button')) editors.delete(control); candidates.replaceChildren(); if (state.candidates.length) element('p', '选择要添加的专区：', candidates); for (const item of state.candidates) { const candidate = button(`candidate-${item.id}`, item.title, candidates, () => controller.chooseCandidate(item.id)); candidate.className = 'candidate'; } }
    candidates.hidden = !adding || Boolean(state.draft) || running || !state.candidates.length;
    if (state.draft) { draftTitle.textContent = state.draft.subject.title; updateCourses(draftCourses, state.draft.courses); }
    for (const control of editors) control.disabled = running || state.unavailable || control.dataset.legacyDisabled === 'true';
    automatic.checked = state.automation?.enabled === true; resumeOnReload.checked = state.automation?.resumeOnReload === true; mute.checked = state.automation?.mute !== false;
    resumeOnReload.disabled ||= !automatic.checked;
    autoHint.hidden = !automatic.checked;
    runningEditHint.hidden = !running;
    settingsSummary.textContent = `⚙ 设置 · ${state.window.start}–${state.window.end}${automatic.checked ? ' · 自动' : ''}${mute.checked ? ' · 已静音' : ''}`;
    for (const control of problemActions.querySelectorAll('button')) if (control !== leaveLearningButton) control.disabled ||= adding;
    const showLeave = !running && !adding && Boolean(state.onOwnedLearningPage);
    if (showLeave) {
      const targetParent = state.problem ? problemActions : leaveBar;
      if (leaveLearningButton.parentNode !== targetParent) targetParent.append(leaveLearningButton);
    }
    leaveLearningButton.hidden = !showLeave;
    leaveLearningButton.disabled = !showLeave || state.unavailable;
    leaveBar.hidden = !showLeave || Boolean(state.problem);
    if (running || state.unavailable) clearRemoveConfirm();
    const hasPending = state.tasks.some(item => item.subject && eligible(item).some(course => !isDone(item, course.id) && !item.skipped.includes(course.id) && !item.deferred?.some(entry => entry.courseId === course.id)));
    const cannotStart = starting || state.unavailable || adding || Boolean(state.draft) || !hasPending;
    const hasStarted = Boolean(state.currentCourseId) || state.tasks.some(item => item.current || item.done.length || item.skipped.length || item.deferred?.length);
    const completedCount = state.tasks.filter(item => completeTask(item) && !(running && item.id === state.activeTaskId)).length;
    clearCompleted.textContent = `清除已完成（${completedCount}）`;
    clearCompleted.hidden = !completedCount;
    clearCompleted.disabled = !completedCount || state.unavailable || state.status === 'preparing' || state.phase === 'resuming';
    addButton.className = state.tasks.length === 0 ? 'primary' : '';
    addButton.title = running ? '暂停后可添加专区' : '';
    runButton.textContent = running ? '暂停' : state.status === 'complete' ? '已完成' : hasStarted ? '继续' : '开始';
    runButton.className = !running && state.status !== 'complete' ? 'primary' : '';
    runButton.disabled = starting || (!running && cannotStart); toggle.disabled = false;
    if (kgModal) syncSubtitleControls();
    for (const control of busy) control.disabled = true;
  }
  const sectionGuideEntries = mountSectionGuideButtons({
    win,
    pageWin: kg.getPageWin?.() || win,
    httpGet: kg.httpGetSubtitle || null,
    onOpenSection: ({ sectionId }) => openKnowledgeModal({ targetSectionId: sectionId, scope: 'section', initialTab: 'quick' }),
  });
  const unsubscribe = controller.subscribe(render);
  const panel = { open() { setOpen(true); }, destroy() { sectionGuideEntries.destroy(); closeKnowledgeModal(); clearTimers(); unsubscribe(); host.remove(); } };
  host.wdPanel = panel; document.documentElement.append(host); render(controller.getState());
  return panel;
}
