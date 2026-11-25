import { isTaskComplete } from './queue.js';
import { getStorageStatus } from './knowledge-storage.js';
import { formatTimestamp, buildKnowledgeMarkdown, formatSubtitleDiagnosticsText, sanitizeCompleteText } from './knowledge-vtt.js';
import { buildSegmentIndex, verifyCitation, tokenizeTextWithCitations, normalizeCitationCompareText } from './knowledge-citations.js';
import { createKnowledgeService, getAiProviderPreset, resolveAiProtocol, normalizeAiBaseUrl, WD_AI_PRIVACY_NOTICE, WD_AI_PROVIDERS } from './knowledge-ai.js';
import { sectionHasSubtitle, loadSectionChat, createSectionChatSession, switchSectionChatSession, clearSectionChat, askSectionQuestion, loadSectionQuiz, saveSectionQuiz, gradeSectionQuiz, submitSectionQuizAttempt, generateSectionQuiz, buildWrongQuestionDeepDivePrompt, mountSectionGuideButtons } from './knowledge-tutor.js';
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
    '.ai-privacy{font-size:11px;line-height:1.45;color:var(--accent-text);background:var(--accent-soft);border:1px solid var(--accent-border);border-radius:var(--radius-xs);padding:6px 8px;margin:0 0 9px}',
    '.ai-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px}',
    '.ai-card-head .settings-title{margin:0}',
    '.ai-status-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:var(--radius-pill);font-size:11px;font-weight:600;border:1px solid var(--border);background:var(--surface-2);color:var(--text-3);white-space:nowrap;flex-shrink:0}',
    '.ai-status-dot{width:6px;height:6px;border-radius:999px;background:currentColor;flex-shrink:0}',
    '.ai-status-pill[data-status="idle"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-status-pill[data-status="testing"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-status-pill[data-status="testing"] .ai-status-dot{animation:wdAiPulse 1.1s ease-in-out infinite}',
    '.ai-status-pill[data-status="ok"]{background:var(--success-soft);border-color:var(--success-border);color:var(--success)}',
    '.ai-status-pill[data-status="error"]{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '@keyframes wdAiPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.75)}}',
    '@keyframes wdAiSpin{to{transform:rotate(360deg)}}',
    '.ai-spinner{width:11px;height:11px;border:1.8px solid currentColor;border-right-color:transparent;border-radius:999px;display:inline-block;animation:wdAiSpin .7s linear infinite;flex-shrink:0}',
    '.ai-form-stack{display:flex;flex-direction:column;gap:10px}',
    '.ai-field{display:flex;flex-direction:column;gap:4px}',
    '.ai-field-head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}',
    '.ai-field-label{font-size:12px;font-weight:500;color:var(--text-2);margin:0;display:inline-flex;align-items:center;gap:5px}',
    '.ai-proto-chip{font-size:10.5px;font-weight:500;padding:1px 6px;border-radius:var(--radius-pill);background:var(--surface-2);border:1px solid var(--border);color:var(--text-3)}',
    '.ai-req-tag{font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:var(--radius-pill);background:var(--warn-soft);border:1px solid var(--warn-border);color:var(--warn)}',
    '.ai-cors-card{padding:7px 9px;border-radius:var(--radius-xs);border:1px solid var(--border);background:var(--bg);display:flex;flex-direction:column;gap:4px;margin-top:2px}',
    '.ai-cors-card[data-cors="direct"]{border-color:var(--success-border);background:var(--success-soft)}',
    '.ai-cors-card[data-cors="relay-needed"],.ai-cors-card[data-cors="proxy-or-relay"]{border-color:var(--warn-border);background:var(--warn-soft)}',
    '.ai-cors-card[data-cors="custom"],.ai-cors-card[data-cors="local"]{border-color:var(--accent-border);background:var(--accent-soft)}',
    '.ai-cors-head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}',
    '.ai-cors-badge{font-size:11px;font-weight:600;color:var(--text)}',
    '.ai-cors-card[data-cors="direct"] .ai-cors-badge{color:var(--success)}',
    '.ai-cors-card[data-cors="relay-needed"] .ai-cors-badge,.ai-cors-card[data-cors="proxy-or-relay"] .ai-cors-badge{color:var(--warn)}',
    '.ai-cors-card[data-cors="custom"] .ai-cors-badge,.ai-cors-card[data-cors="local"] .ai-cors-badge{color:var(--accent-text)}',
    '.ai-cors-endpoint{font-size:10.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text-3)}',
    '.ai-note{display:block;margin:0;font-size:11.5px;line-height:1.45;color:var(--text-2)}',
    '.ai-key-box{display:flex;align-items:center;border:1px solid var(--border-strong);border-radius:var(--radius-xs);background:var(--bg);transition:border-color .14s ease,box-shadow .14s ease;overflow:hidden}',
    '.ai-key-box:hover{border-color:var(--accent-border)}',
    '.ai-key-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 2.5px var(--ring)}',
    '.ai-key-box input{flex:1;min-width:0;border:0;border-radius:0;background:transparent;padding:6px 8px;min-height:32px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
    '.ai-key-box input:focus-visible{box-shadow:none}',
    '.ai-icon-btn{border:0;border-left:1px solid var(--border);border-radius:0;background:transparent;color:var(--text-2);min-width:34px;min-height:32px;padding:0 8px;flex-shrink:0}',
    '.ai-icon-btn:hover:not(:disabled){background:var(--surface-2);color:var(--text);border-color:var(--border)}',
    '.ai-icon-btn:focus-visible{box-shadow:inset 0 0 0 2px var(--ring)}',
    '.ai-eye-glyph{position:relative;display:inline-block;width:16px;height:10px;border:1.5px solid currentColor;border-radius:75% 75% 75% 75% / 90% 90% 90% 90%}',
    '.ai-eye-glyph::before{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;border-radius:999px;background:currentColor;transform:translate(-50%,-50%)}',
    '.ai-icon-btn[data-visible="false"] .ai-eye-glyph::after{content:"";position:absolute;left:-2px;top:50%;width:18px;height:1.6px;background:currentColor;transform:translateY(-50%) rotate(-32deg);border-radius:2px}',
    '.ai-url-input{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
    '.ai-field-error{font-size:11.5px;color:var(--danger);line-height:1.45;margin:0}',
    '.ai-inline-actions{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}',
    '.ai-compact-btn{min-height:26px;padding:2px 9px;font-size:11.5px;border-radius:var(--radius-xs)}',
    '.ai-model-combo{position:relative;display:flex;flex-direction:column;gap:0}',
    '.ai-model-input-wrap{display:flex;align-items:center;border:1px solid var(--border-strong);border-radius:var(--radius-xs);background:var(--bg);transition:border-color .14s ease,box-shadow .14s ease;overflow:hidden}',
    '.ai-model-input-wrap:hover{border-color:var(--accent-border)}',
    '.ai-model-input-wrap:focus-within{border-color:var(--accent);box-shadow:0 0 0 2.5px var(--ring)}',
    '.ai-model-input-wrap input{flex:1;min-width:0;border:0;border-radius:0;background:transparent;padding:6px 8px;min-height:32px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
    '.ai-model-input-wrap input:focus-visible{box-shadow:none}',
    '.ai-model-toggle-btn{border:0;border-left:1px solid var(--border);border-radius:0;background:transparent;color:var(--text-2);min-width:30px;min-height:32px;padding:0 7px;font-size:11px;flex-shrink:0}',
    '.ai-model-toggle-btn:hover:not(:disabled){background:var(--surface-2);color:var(--text);border-color:var(--border)}',
    '.ai-model-current-pill{font-size:11px;color:var(--text-3);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ai-model-dropdown{margin-top:5px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg);box-shadow:var(--shadow-panel);overflow:hidden;display:flex;flex-direction:column}',
    '.ai-model-search-bar{display:flex;align-items:center;gap:6px;padding:6px 7px;border-bottom:1px solid var(--border);background:var(--surface)}',
    '.ai-model-search-bar input{flex:1;min-width:0;min-height:26px;padding:3px 7px;font-size:12px}',
    '.ai-model-count{font-size:11px;color:var(--text-3);white-space:nowrap;font-variant-numeric:tabular-nums;flex-shrink:0}',
    '.ai-model-list{max-height:176px;overflow-y:auto;padding:4px;display:flex;flex-direction:column;gap:2px;overscroll-behavior:contain}',
    '.ai-model-option{width:100%;min-height:28px;padding:5px 8px;border:1px solid transparent;border-radius:var(--radius-xs);background:transparent;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;font-weight:400}',
    '.ai-model-option:hover:not(:disabled),.ai-model-option[data-focused="true"]{background:var(--surface-2);border-color:var(--border)}',
    '.ai-model-option[aria-selected="true"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-model-opt-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
    '.ai-model-opt-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ai-model-opt-sub{font-size:10.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ai-model-opt-tag{font-size:10px;padding:0 5px;border-radius:var(--radius-pill);background:var(--surface-2);border:1px solid var(--border);color:var(--text-3);flex-shrink:0}',
    '.ai-model-opt-check{font-size:12px;font-weight:700;color:var(--accent-text);flex-shrink:0}',
    '.ai-model-empty{padding:10px 8px;text-align:center;font-size:12px;color:var(--text-3);display:flex;flex-direction:column;gap:6px;align-items:center}',
    '.ai-model-drop-foot{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 8px;border-top:1px solid var(--border);background:var(--surface);font-size:11px;color:var(--text-3)}',
    '.ai-inline-feedback{margin-top:4px;padding:8px 10px;border-radius:var(--radius-xs);border:1px solid var(--border);background:var(--surface-2);color:var(--text-2);font-size:11.5px;line-height:1.5;display:flex;flex-direction:column;gap:4px}',
    '.ai-inline-feedback[data-tone="error"]{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '.ai-inline-feedback[data-tone="warn"]{background:var(--warn-soft);border-color:var(--warn-border);color:var(--warn)}',
    '.ai-inline-feedback[data-tone="ok"]{background:var(--success-soft);border-color:var(--success-border);color:var(--success)}',
    '.ai-inline-feedback[data-tone="info"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-fb-head{display:flex;align-items:center;justify-content:space-between;gap:6px;font-weight:600;flex-wrap:wrap}',
    '.ai-fb-hint{font-size:11.5px;line-height:1.45;opacity:.92;color:var(--text-2)}',
    '.ai-inline-feedback[data-tone="error"] .ai-fb-hint{color:var(--danger)}',
    '.ai-inline-feedback[data-tone="warn"] .ai-fb-hint{color:var(--warn)}',
    '.ai-test-card{padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);display:flex;flex-direction:column;gap:7px}',
    '.ai-test-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.ai-test-result{padding:7px 9px;border-radius:var(--radius-xs);border:1px solid var(--border);background:var(--surface);font-size:11.5px;line-height:1.5;color:var(--text-2);display:flex;flex-direction:column;gap:3px}',
    '.ai-test-result[data-tone="ok"]{background:var(--success-soft);border-color:var(--success-border);color:var(--success)}',
    '.ai-test-result[data-tone="partial"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-test-result[data-tone="error"]{background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '.ai-test-result[data-tone="info"]{background:var(--accent-soft);border-color:var(--accent-border);color:var(--accent-text)}',
    '.ai-test-summary{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;font-weight:600}',
    '.ai-test-meta{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.88}',
    '.ai-test-detail{font-size:11.5px;line-height:1.45;color:var(--text-2);overflow-wrap:anywhere}',
    '.ai-test-result[data-tone="error"] .ai-test-detail{color:var(--danger)}',
    '.ai-advanced{margin:0;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--bg);padding:6px 9px}',
    '.ai-advanced>summary{font-size:11.5px;color:var(--text-3);display:flex;align-items:center;justify-content:space-between;gap:6px}',
    '.ai-advanced>summary::after{content:"▸";font-size:10px}.ai-advanced[open]>summary::after{content:"▾"}',
    '.ai-advanced-body{margin-top:8px;display:flex;flex-direction:column;gap:6px}',
    '.ai-footer-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:2px}',
    '.ai-save-status{display:block;font-size:11.5px;color:var(--text-3);min-height:16px}',
    '.kg-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.52);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.kg-dialog{width:min(960px,95vw);height:min(760px,90vh);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-modal);overflow:hidden}',
    '.kg-head{flex-shrink:0;padding:12px 16px 10px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px}',
    '.kg-head-top{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    '.kg-title-wrap{display:flex;align-items:center;gap:7px;min-width:0;flex:1;flex-wrap:wrap}',
    '.kg-title-wrap h2{margin:0;font-size:15px;font-weight:600;color:var(--text);line-height:1.35;white-space:normal;overflow:visible;overflow-wrap:anywhere}',
    '.kg-head-controls{display:flex;align-items:center;gap:6px;flex-shrink:0}',
    '.kg-head-row2{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '.kg-badge{font-size:11px;font-weight:500;padding:2px 8px;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);flex-shrink:0}',
    '.kg-badge[data-tone=ai]{background:var(--success-soft);color:var(--success);border:1px solid var(--success-border);font-weight:600}',
    '.kg-badge[data-tone=local]{background:var(--surface-2);color:var(--text-2);border:1px solid var(--border-strong);font-weight:600}',
    '.kg-badge[data-tone=fallback]{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn-border);font-weight:600}',
    '.kg-badge[data-tone=cache]{background:var(--cache-soft);color:var(--cache)}',
    '.kg-badge[data-tone=scope]{background:var(--surface-2);color:var(--text-2)}',
    '.kg-badge[data-tone=nosub]{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn-border)}',
    '.kg-source-callout{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:11px 14px;border-radius:var(--radius-md);background:var(--warn-soft);border:1px solid var(--warn-border);color:var(--warn)}',
    '.kg-source-callout[data-tone=local]{background:var(--bg);border:1px solid var(--accent-border);border-left:3.5px solid var(--accent);color:var(--text)}',
    '.kg-source-callout[data-tone=fallback]{background:var(--warn-soft);border:1px solid var(--warn-border);border-left:3.5px solid var(--warn);color:var(--warn)}',
    '.kg-source-callout-body{flex:1;min-width:210px;display:flex;flex-direction:column;gap:3px}',
    '.kg-source-callout-title{font-size:13px;font-weight:600;line-height:1.45;color:inherit;overflow-wrap:anywhere}',
    '.kg-source-callout-desc{font-size:12px;line-height:1.5;color:var(--text-2);overflow-wrap:anywhere}',
    '.kg-source-callout[data-tone=fallback] .kg-source-callout-desc{color:var(--warn)}',
    '.kg-source-callout-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;align-self:center}',
    '.kg-card-head-right{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap}',
    '.kg-sec-fallback-note{margin:0 0 10px;padding:7px 10px;border-radius:var(--radius-xs);background:var(--warn-soft);border:1px solid var(--warn-border);color:var(--warn);font-size:12px;line-height:1.5;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
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
    '.kg-one-line{margin:0 0 10px;padding:10px 12px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:13px;color:var(--text);font-weight:500;line-height:1.6;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word}',
    '.kg-theme-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:0 0 10px}.kg-theme-label{font-size:11.5px;color:var(--text-3);font-weight:500}.kg-theme-chip{font-size:11.5px;padding:2px 8px;border-radius:var(--radius-pill);background:var(--surface-2);border:1px solid var(--border);color:var(--text-2);font-weight:500}',
    '.kg-subhead{font-size:12px;font-weight:600;color:var(--text-3);margin:12px 0 6px;display:flex;align-items:center;justify-content:space-between}',
    '.kg-kp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
    '.kg-kp-item{display:flex;align-items:flex-start;flex-wrap:wrap;gap:9px;padding:8px 11px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;color:var(--text);line-height:1.55;transition:background .15s ease,border-color .15s ease}',
    '.kg-kp-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-top:1px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);font-size:11px;font-weight:600;flex-shrink:0}',
    '.kg-kp-text{flex:1;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word;line-height:1.55}',
    '.kg-kp-meta{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}',
    '.kg-kp-sec-tag{font-size:11px;padding:1px 7px;border-radius:var(--radius-pill);background:var(--surface-2);color:var(--text-3);border:1px solid var(--border);white-space:nowrap}',
    '.kg-fold-list{display:flex;flex-direction:column;gap:6px}',
    '.kg-topic-fold{margin:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);padding:7px 11px}',
    '.kg-topic-fold>summary{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;font-size:13px;color:var(--text);font-weight:500;line-height:1.45}',
    '.kg-topic-fold>summary>span:first-child{flex:1;min-width:0;white-space:normal;overflow:visible;overflow-wrap:anywhere}',
    '.kg-topic-fold>summary::before{content:"▸ ";font-size:11px;color:var(--accent);flex-shrink:0}.kg-topic-fold[open]>summary::before{content:"▾ "}',
    '.kg-topic-count{font-size:11px;color:var(--text-3);font-weight:400;margin-left:auto;flex-shrink:0}',
    '.kg-points{list-style:none;margin:6px 0 2px;padding:0}',
    '.kg-points li{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:6px 4px;border-top:1px dashed var(--border);font-size:12.5px;color:var(--text-2);line-height:1.5;border-radius:var(--radius-xs);transition:background .15s ease}',
    '.kg-points li>span{flex:1;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word}',
    '.kg-quiz-list{display:flex;flex-direction:column;gap:8px}',
    '.kg-quiz-item{border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;background:var(--surface)}',
    '.kg-quiz-q{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;font-size:13px;font-weight:500;color:var(--text);line-height:1.5}',
    '.kg-quiz-q>span{flex:1;min-width:0;overflow-wrap:anywhere}',
    '.kg-quiz-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}',
    '.kg-quiz-ans{margin-top:8px;padding:7px 10px;background:var(--success-soft);border-left:3px solid var(--success);border-radius:0 var(--radius-xs) var(--radius-xs) 0;font-size:12.5px;color:var(--success);line-height:1.55;overflow-wrap:anywhere}',
    '.kg-glossary-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));gap:10px}',
    '.kg-term-card{border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;background:var(--surface);display:flex;flex-direction:column;gap:5px;min-width:0}',
    '.kg-term-head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}.kg-term-title-wrap{display:inline-flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}.kg-term-head strong{font-size:13px;color:var(--text);overflow-wrap:anywhere}',
    '.kg-term-tag{font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:var(--radius-pill);background:var(--surface-2);color:var(--text-3);border:1px solid var(--border)}',
    '.kg-term-tag[data-core="true"]{background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border)}',
    '.kg-term-def{font-size:12.5px;color:var(--text-2);margin:0;line-height:1.55;white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word}',
    '.kg-timeline-item{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px dashed var(--border);font-size:12.5px}.kg-timeline-item:last-child{border-bottom:0}',
    '.kg-timeline-text{flex:1;min-width:0;color:var(--text-2);overflow-wrap:anywhere;line-height:1.55}',
    '.kg-time-btn{min-height:24px;padding:1px 8px;font-size:11px;font-variant-numeric:tabular-nums;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border);flex-shrink:0}',
    '.kg-mini-btn{min-height:24px;padding:2px 8px;font-size:11.5px;flex-shrink:0}',
    '.kg-md-pane{padding:14px 18px}.kg-md-pane pre{margin:0;max-height:100%;overflow:auto}',
    '.kg-sec-picker-wrap{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.kg-sec-picker{width:100%;max-width:300px;min-width:0;padding:3px 8px;font-size:12px;min-height:28px}',
    '@media (max-width:600px){.kg-backdrop{padding:8px}.kg-dialog{width:100vw;height:94dvh;border-radius:var(--radius-md)}.kg-scroll{padding:12px}.kg-sec-picker-wrap{flex:1 1 100%}.kg-sec-picker{max-width:100%}.kg-kp-item{flex-wrap:wrap}.kg-glossary-grid{grid-template-columns:1fr}}',
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
    '.kg-cite-btn{min-height:24px;padding:1px 8px;font-size:11px;font-variant-numeric:tabular-nums;border-radius:var(--radius-pill);background:var(--accent-soft);color:var(--accent-text);border-color:var(--accent-border);flex-shrink:0}',
    '.kg-cite-btn[data-cite-active="true"],.kg-inline-cite[data-cite-active="true"]{background:#fef08a;border-color:#ca8a04;color:#713f12;font-weight:600}',
    '.kg-cite-unverified,.kg-inline-cite.kg-cite-unverified{background:var(--warn-soft);border:1px dashed var(--warn-border);color:var(--warn);font-weight:600}',
    '.kg-cite-unverified:hover:not(:disabled){background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)}',
    '.kg-inline-cite{display:inline;min-height:0;padding:0 5px;margin:0 2px;font-size:11.5px;font-weight:600;border-radius:4px;vertical-align:baseline;background:var(--accent-soft);border:1px solid var(--accent-border);color:var(--accent-text)}',
    '[data-cite-highlighted="true"]{background:rgba(254,240,138,.42)!important;border-color:#eab308!important}',
    '.kg-evidence-slot{flex:1 0 100%;width:100%;margin-top:6px}',
    '.kg-evidence-card{border:1px solid #eab308;border-left:3.5px solid #ca8a04;border-radius:var(--radius-sm);background:#fefce8;color:#422006;padding:9px 11px;font-size:12px;line-height:1.55;display:flex;flex-direction:column;gap:6px}',
    ':host([data-theme="dark"]) .kg-evidence-card{background:rgba(234,179,8,.14);border-color:rgba(250,204,21,.45);color:#fef9c3}',
    ':host([data-theme="dark"]) [data-cite-highlighted="true"]{background:rgba(234,179,8,.18)!important;border-color:rgba(250,204,21,.55)!important}',
    '@media (prefers-color-scheme:dark){:host(:not([data-theme="light"])) .kg-evidence-card{background:rgba(234,179,8,.14);border-color:rgba(250,204,21,.45);color:#fef9c3}:host(:not([data-theme="light"])) [data-cite-highlighted="true"]{background:rgba(234,179,8,.18)!important;border-color:rgba(250,204,21,.55)!important}}',
    '.kg-evidence-card.kg-evidence-unverified{background:var(--warn-soft);border:1px dashed var(--warn-border);border-left:3.5px solid var(--danger);color:var(--warn)}',
    '.kg-ev-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11.5px;font-weight:600}',
    '.kg-ev-neighbor{padding:5px 8px;border-radius:var(--radius-xs);background:rgba(15,23,42,.04);color:var(--text-3);font-size:11.5px;line-height:1.5}',
    '.kg-ev-neighbor span{display:block;font-size:10.5px;font-weight:600;margin-bottom:2px}',
    '.kg-ev-current{padding:7px 9px;border-radius:var(--radius-xs);background:rgba(254,240,138,.72);border:1px solid rgba(202,138,4,.45);color:#422006;font-size:12.5px;line-height:1.6}',
    ':host([data-theme="dark"]) .kg-ev-current{background:rgba(250,204,21,.22);color:#fefce8}',
    '@media (prefers-color-scheme:dark){:host(:not([data-theme="light"])) .kg-ev-current{background:rgba(250,204,21,.22);color:#fefce8}}',
    '.kg-ev-current span{display:block;font-size:11px;font-weight:600;margin-bottom:2px;opacity:.85}',
    '.kg-ev-current mark{background:#fde047;color:#422006;padding:0 2px;border-radius:3px;font-weight:600}',
    '.kg-ev-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px}',
    '.kg-ev-unverified-detail{padding:6px 8px;border-radius:var(--radius-xs);background:var(--bg);border:1px solid var(--border);color:var(--text-2);font-size:11.5px;line-height:1.5;display:flex;flex-direction:column;gap:3px}',
    '.kg-timeline-item{display:flex;align-items:flex-start;flex-wrap:wrap;gap:8px;padding:7px 6px;border-bottom:1px dashed var(--border);font-size:12.5px;border-radius:var(--radius-xs)}',
    '.kg-timeline-seg-badge{font-size:11px;font-weight:600;padding:1px 7px;border-radius:var(--radius-pill);background:var(--surface-2);color:var(--text-2);border:1px solid var(--border);font-variant-numeric:tabular-nums;flex-shrink:0}',
    '.kg-qa-session-wrap{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.kg-qa-session-select{width:auto;max-width:190px;min-height:24px;padding:1px 6px;font-size:11.5px}',
    '.kg-wrong-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:6px}',
    '.ai-storage-warn{font-size:11.5px;line-height:1.5;color:var(--warn);background:var(--warn-soft);border:1px solid var(--warn-border);border-radius:var(--radius-xs);padding:6px 9px;margin:0 0 8px}',
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
    node.addEventListener('click', async event => {
      if (node.disabled || busy.has(node)) return;
      busy.add(node); node.disabled = true;
      try { await handler(event); } catch { showUiError('操作未完成，请查看当前状态后重试。'); }
      finally { busy.delete(node); node.disabled = false; render(controller.getState()); }
    });
    return node;
  };
  const isRunning = state => ['running', 'preparing', 'waiting'].includes(state.status) || state.phase === 'resuming';
  const runButton = button('run-toggle', '开始', headerButtons, () => isRunning(controller.getState()) ? controller.pause() : startQueue(), false);
  const toggle = button('toggle', '展开', headerButtons, () => setOpen(body.hidden), false); toggle.setAttribute('aria-expanded', 'false');
  const playGesture = button('play-current', '播放当前课节', header, event => controller.playFromGesture(event), false);
  playGesture.className = 'primary';
  playGesture.style.marginTop = '8px';
  const progress = element('div', '', header); progress.className = 'progress'; progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
  const compact = element('div', '', header); compact.className = 'muted compact-course';
  const compactTime = element('div', '', header); compactTime.className = 'muted playback-time'; compactTime.dataset.playbackTime = '';
  const compactNotice = element('div', '', header); compactNotice.className = 'muted compact-notice';
  const execution = element('div', '', body); execution.className = 'status';
  const message = element('div', '', execution);
  const problemBox = element('div', '', body); problemBox.className = 'problem'; problemBox.dataset.problem = '';
  const problemText = element('div', '', problemBox); const problemActions = element('div', '', problemBox); problemActions.className = 'buttons';
  button('retry', '重试本课程', problemActions, () => controller.retry(latest.problem?.taskId, latest.problem?.courseId, 'panel-retry'));
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

  // Group 3: AI 导览模型（现代嵌入配置卡片：Provider → API Key → 获取并选择模型 → 测试连接）
  const aiGroup = element('div', '', settingsSheet); aiGroup.className = 'settings-group'; aiGroup.dataset.aiSettings = ''; aiGroup.dataset.settingsGroup = 'ai';
  const aiCardHead = element('div', '', aiGroup); aiCardHead.className = 'ai-card-head';
  element('p', 'AI 模型配置（选填）', aiCardHead).className = 'settings-title';
  const aiTopStatusPill = element('span', '', aiCardHead);
  aiTopStatusPill.className = 'ai-status-pill';
  aiTopStatusPill.dataset.aiStatusPill = '';
  aiTopStatusPill.dataset.status = 'unconfigured';
  element('span', '', aiTopStatusPill).className = 'ai-status-dot';
  const aiTopStatusText = element('span', '未配置', aiTopStatusPill);

  const aiPrivacy = element('p', kg.privacyNotice || WD_AI_PRIVACY_NOTICE, aiGroup); aiPrivacy.className = 'ai-privacy'; aiPrivacy.dataset.aiPrivacy = '';
  const aiStorageWarn = element('p', '', aiGroup); aiStorageWarn.className = 'ai-storage-warn'; aiStorageWarn.dataset.aiStorageWarn = ''; aiStorageWarn.hidden = true;
  const syncStorageWarning = () => {
    const st = kg.getStorageStatus ? kg.getStorageStatus() : getStorageStatus(win);
    const msgs = [];
    if (st?.degraded) msgs.push('⚠ 当前非油猴环境（GM_setValue 不可用），API Key 与学习资产已降级存至 localStorage。');
    if (st?.migration?.status === 'failed' || st?.migration?.status === 'partial') {
      msgs.push(`⚠ 旧数据迁移存在未完成项（已保留原始 localStorage 数据未丢弃）：${(st.migration.warnings || []).join('；')}`);
    }
    aiStorageWarn.textContent = msgs.join('\n');
    aiStorageWarn.hidden = msgs.length === 0;
  };
  syncStorageWarning();

  const aiFormStack = element('div', '', aiGroup); aiFormStack.className = 'ai-form-stack';

  // 1. Provider selector + CORS direct-connection card
  const aiProviderField = element('div', '', aiFormStack); aiProviderField.className = 'ai-field';
  const aiProviderHead = element('div', '', aiProviderField); aiProviderHead.className = 'ai-field-head';
  const aiProviderLabel = element('label', '服务商 (Provider)', aiProviderHead); aiProviderLabel.className = 'ai-field-label';
  const aiProtoChip = element('span', 'OpenAI 兼容', aiProviderHead); aiProtoChip.className = 'ai-proto-chip'; aiProtoChip.dataset.aiProtoChip = '';
  const aiProvider = element('select', '', aiProviderField); aiProvider.name = 'ai-provider'; aiProvider.id = 'wd-ai-provider'; aiProviderLabel.htmlFor = aiProvider.id;
  for (const preset of (kg.providers || WD_AI_PROVIDERS)) {
    const opt = element('option', preset.label, aiProvider); opt.value = preset.id;
  }
  const aiCorsCard = element('div', '', aiProviderField); aiCorsCard.className = 'ai-cors-card'; aiCorsCard.dataset.aiCorsCard = ''; aiCorsCard.dataset.cors = 'direct';
  const aiCorsHead = element('div', '', aiCorsCard); aiCorsHead.className = 'ai-cors-head';
  const aiCorsBadge = element('span', '', aiCorsHead); aiCorsBadge.className = 'ai-cors-badge'; aiCorsBadge.dataset.aiCorsBadge = '';
  const aiCorsEndpoint = element('span', '', aiCorsHead); aiCorsEndpoint.className = 'ai-cors-endpoint';
  const aiProviderNote = element('small', '', aiCorsCard); aiProviderNote.className = 'ai-note'; aiProviderNote.dataset.aiProviderNote = '';

  // 2. API Key (integrated password box + pure-CSS eye visibility toggle)
  const aiKeyField = element('div', '', aiFormStack); aiKeyField.className = 'ai-field';
  const aiKeyHead = element('div', '', aiKeyField); aiKeyHead.className = 'ai-field-head';
  const aiKeyLabel = element('label', 'API Key', aiKeyHead); aiKeyLabel.className = 'ai-field-label';
  element('span', '本地隔离保存', aiKeyHead).className = 'muted';
  const aiKeyBox = element('div', '', aiKeyField); aiKeyBox.className = 'ai-key-box';
  const aiApiKey = element('input', '', aiKeyBox); aiApiKey.type = 'password'; aiApiKey.name = 'ai-api-key'; aiApiKey.id = 'wd-ai-api-key'; aiKeyLabel.htmlFor = aiApiKey.id;
  aiApiKey.autocomplete = 'off'; aiApiKey.spellcheck = false; aiApiKey.placeholder = '输入对应服务商的 API Key（留空为零 AI 档）';
  const aiToggleKey = element('button', '', aiKeyBox);
  aiToggleKey.type = 'button';
  aiToggleKey.className = 'ai-icon-btn';
  aiToggleKey.dataset.action = 'ai-toggle-key';
  aiToggleKey.dataset.visible = 'false';
  aiToggleKey.setAttribute('aria-label', '显示 API Key');
  aiToggleKey.setAttribute('aria-pressed', 'false');
  aiToggleKey.title = '显示 API Key';
  const aiEyeGlyph = element('span', '', aiToggleKey); aiEyeGlyph.className = 'ai-eye-glyph'; aiEyeGlyph.setAttribute('aria-hidden', 'true');
  const setKeyVisible = visible => {
    aiApiKey.type = visible ? 'text' : 'password';
    aiToggleKey.dataset.visible = visible ? 'true' : 'false';
    aiToggleKey.setAttribute('aria-pressed', String(visible));
    aiToggleKey.setAttribute('aria-label', visible ? '隐藏 API Key' : '显示 API Key');
    aiToggleKey.title = visible ? '隐藏 API Key' : '显示 API Key';
  };
  aiToggleKey.addEventListener('click', () => setKeyVisible(aiApiKey.type === 'password'));

  // 3. Base URL (auto-filled by provider, editable, required on custom)
  const aiBaseUrlField = element('div', '', aiFormStack); aiBaseUrlField.className = 'ai-field';
  const aiBaseUrlHead = element('div', '', aiBaseUrlField); aiBaseUrlHead.className = 'ai-field-head';
  const aiBaseUrlLabel = element('label', 'Base URL', aiBaseUrlHead); aiBaseUrlLabel.className = 'ai-field-label';
  const aiBaseUrlTag = element('span', '可改填中转地址', aiBaseUrlHead); aiBaseUrlTag.className = 'muted'; aiBaseUrlTag.dataset.aiBaseUrlTag = '';
  const aiBaseUrl = element('input', '', aiBaseUrlField); aiBaseUrl.type = 'text'; aiBaseUrl.className = 'ai-url-input'; aiBaseUrl.name = 'ai-base-url'; aiBaseUrl.id = 'wd-ai-base-url'; aiBaseUrlLabel.htmlFor = aiBaseUrl.id;
  aiBaseUrl.spellcheck = false;
  aiBaseUrl.placeholder = 'https://api.deepseek.com/v1';
  const aiBaseUrlError = element('p', '', aiBaseUrlField); aiBaseUrlError.className = 'ai-field-error'; aiBaseUrlError.dataset.aiBaseUrlError = ''; aiBaseUrlError.hidden = true;

  // 4. Model Picker (Fetch Models + Searchable Dropdown + Manual Input Fallback)
  const aiModelField = element('div', '', aiFormStack); aiModelField.className = 'ai-field';
  const aiModelHead = element('div', '', aiModelField); aiModelHead.className = 'ai-field-head';
  const aiModelLabelWrap = element('div', '', aiModelHead); aiModelLabelWrap.className = 'ai-inline-actions';
  const aiModelLabel = element('label', '模型', aiModelLabelWrap); aiModelLabel.className = 'ai-field-label';
  const aiModelCurrentPill = element('span', '', aiModelLabelWrap); aiModelCurrentPill.className = 'ai-model-current-pill'; aiModelCurrentPill.dataset.aiModelCurrent = '';
  const aiModelActions = element('div', '', aiModelHead); aiModelActions.className = 'ai-inline-actions';
  const aiFetchModelsBtn = element('button', '获取模型', aiModelActions);
  aiFetchModelsBtn.type = 'button'; aiFetchModelsBtn.className = 'soft ai-compact-btn'; aiFetchModelsBtn.dataset.action = 'ai-fetch-models';
  const aiFetchModelsCancelBtn = element('button', '取消', aiModelActions);
  aiFetchModelsCancelBtn.type = 'button'; aiFetchModelsCancelBtn.className = 'ghost ai-compact-btn'; aiFetchModelsCancelBtn.dataset.action = 'ai-fetch-models-cancel'; aiFetchModelsCancelBtn.hidden = true;

  const aiModelCombo = element('div', '', aiModelField); aiModelCombo.className = 'ai-model-combo'; aiModelCombo.dataset.aiModelCombo = '';
  const aiModelInputWrap = element('div', '', aiModelCombo); aiModelInputWrap.className = 'ai-model-input-wrap';
  const aiModel = element('input', '', aiModelInputWrap); aiModel.type = 'text'; aiModel.name = 'ai-model'; aiModel.id = 'wd-ai-model'; aiModelLabel.htmlFor = aiModel.id;
  aiModel.autocomplete = 'off'; aiModel.spellcheck = false; aiModel.placeholder = '点击「获取模型」选取，或手动填写模型名';
  const aiModelDropdownToggle = element('button', '▾', aiModelInputWrap);
  aiModelDropdownToggle.type = 'button'; aiModelDropdownToggle.className = 'ai-model-toggle-btn'; aiModelDropdownToggle.dataset.action = 'ai-model-dropdown-toggle';
  aiModelDropdownToggle.setAttribute('aria-label', '展开或收起模型列表'); aiModelDropdownToggle.setAttribute('aria-expanded', 'false');

  const aiModelDropdown = element('div', '', aiModelCombo); aiModelDropdown.className = 'ai-model-dropdown'; aiModelDropdown.dataset.aiModelDropdown = ''; aiModelDropdown.hidden = true;
  const aiModelSearchBar = element('div', '', aiModelDropdown); aiModelSearchBar.className = 'ai-model-search-bar';
  const aiModelSearch = element('input', '', aiModelSearchBar); aiModelSearch.type = 'search'; aiModelSearch.name = 'ai-model-search'; aiModelSearch.dataset.aiModelSearch = '';
  aiModelSearch.placeholder = '搜索模型名称…'; aiModelSearch.setAttribute('aria-label', '搜索可用模型');
  const aiModelCount = element('span', '0 个', aiModelSearchBar); aiModelCount.className = 'ai-model-count'; aiModelCount.dataset.aiModelCount = '';
  const aiModelList = element('div', '', aiModelDropdown); aiModelList.className = 'ai-model-list'; aiModelList.setAttribute('role', 'listbox'); aiModelList.dataset.aiModelList = '';
  const aiModelDropFoot = element('div', '', aiModelDropdown); aiModelDropFoot.className = 'ai-model-drop-foot';
  const aiModelDropMeta = element('span', '点击选择模型', aiModelDropFoot); aiModelDropMeta.dataset.aiModelDropMeta = '';
  const aiModelManualBtn = element('button', '手动输入', aiModelDropFoot);
  aiModelManualBtn.type = 'button'; aiModelManualBtn.className = 'ghost ai-compact-btn'; aiModelManualBtn.dataset.action = 'ai-model-manual';

  const aiModelsFeedback = element('div', '', aiModelField); aiModelsFeedback.className = 'ai-inline-feedback'; aiModelsFeedback.dataset.aiModelsFeedback = ''; aiModelsFeedback.hidden = true;

  // 5. Test Connection Card (inline badge + latency + model + categorized feedback)
  const aiTestCard = element('div', '', aiFormStack); aiTestCard.className = 'ai-test-card'; aiTestCard.dataset.aiTestCard = '';
  const aiTestHead = element('div', '', aiTestCard); aiTestHead.className = 'ai-test-head';
  const aiTestActions = element('div', '', aiTestHead); aiTestActions.className = 'ai-inline-actions';
  const aiTestBtn = element('button', '测试连接', aiTestActions);
  aiTestBtn.type = 'button'; aiTestBtn.className = 'ai-compact-btn'; aiTestBtn.dataset.action = 'ai-test-connection';
  const aiTestCancelBtn = element('button', '取消', aiTestActions);
  aiTestCancelBtn.type = 'button'; aiTestCancelBtn.className = 'ghost ai-compact-btn'; aiTestCancelBtn.dataset.action = 'ai-test-cancel'; aiTestCancelBtn.hidden = true;
  const aiTestBadge = element('span', '', aiTestHead); aiTestBadge.className = 'ai-status-pill'; aiTestBadge.dataset.aiTestBadge = ''; aiTestBadge.dataset.status = 'unconfigured';
  element('span', '', aiTestBadge).className = 'ai-status-dot';
  const aiTestBadgeText = element('span', '未配置', aiTestBadge);
  const aiTestResult = element('div', '', aiTestCard); aiTestResult.className = 'ai-test-result'; aiTestResult.dataset.aiTestResult = '';

  // 6. Advanced Transport Fold
  const aiAdvanced = element('details', '', aiFormStack); aiAdvanced.className = 'ai-advanced'; aiAdvanced.dataset.aiAdvanced = '';
  element('summary', '高级选项 · 请求通道', aiAdvanced);
  const aiAdvancedBody = element('div', '', aiAdvanced); aiAdvancedBody.className = 'ai-advanced-body';
  const aiTransportLabel = element('label', '请求通道', aiAdvancedBody); aiTransportLabel.className = 'ai-field-label';
  const aiTransport = element('select', '', aiAdvancedBody); aiTransport.name = 'ai-transport'; aiTransport.id = 'wd-ai-transport'; aiTransportLabel.htmlFor = aiTransport.id;
  for (const [val, txt] of [['auto', '自动 (优先 GM_xmlhttpRequest → 回退 fetch)'], ['gm', '仅 GM_xmlhttpRequest（绕过浏览器 CORS）'], ['fetch', '仅页面 fetch（需端点放行 CORS）']]) {
    const opt = element('option', txt, aiTransport); opt.value = val;
  }
  element('small', '默认优先走油猴 GM 通道以绕过页面 CORS 限制；非油猴环境自动回退页面 fetch。', aiAdvancedBody).className = 'muted';

  // 7. Footer Actions
  const aiActions = element('div', '', aiFormStack); aiActions.className = 'ai-footer-bar';
  const aiSaveStatus = element('small', '', aiFormStack); aiSaveStatus.className = 'ai-save-status'; aiSaveStatus.dataset.aiSaveStatus = ''; aiSaveStatus.setAttribute('role', 'status');

  // State for fetched model picker & connection status
  let aiFetchedModels = [];
  let aiFetchedMeta = '';
  let aiDropdownOpen = false;
  let aiDropdownFocusedIdx = -1;
  let aiFetchingModels = false;
  let aiTestingConnection = false;
  let aiLastProviderId = null;

  const readAiFormValues = () => ({
    provider: aiProvider.value,
    baseUrl: aiBaseUrl.value.trim(),
    model: aiModel.value.trim(),
    apiKey: aiApiKey.value.trim(),
    transport: aiTransport.value,
  });

  const protoLabelOf = proto => (proto === 'gemini' ? 'Gemini 原生' : proto === 'anthropic' ? 'Anthropic 原生' : 'OpenAI 兼容');
  const channelLabelOf = ch => (ch === 'gm' ? 'GM' : ch === 'fetch' ? 'fetch' : '');

  const setAiConnBadge = (status, label) => {
    const map = { unconfigured: '未配置', idle: '待检测', testing: '检测中', ok: '可用', error: '不可用' };
    const safeStatus = map[status] ? status : 'idle';
    const text = label || map[safeStatus];
    aiTopStatusPill.dataset.status = safeStatus;
    aiTopStatusText.textContent = text;
    aiTestBadge.dataset.status = safeStatus;
    aiTestBadgeText.textContent = text;
  };

  const renderAiTestPlaceholder = () => {
    const vals = readAiFormValues();
    const preset = getAiProviderPreset(vals.provider);
    aiTestResult.replaceChildren();
    delete aiTestResult.dataset.tone;
    if (preset?.requiresApiKey && !vals.apiKey) {
      setAiConnBadge('unconfigured', '未配置');
      element('div', '未填写 API Key（当前为零 AI 本地摘要档）。填好 Key 后可点「获取模型」与「测试连接」。', aiTestResult).className = 'ai-test-detail';
    } else if (!vals.baseUrl) {
      setAiConnBadge('idle', '待配置');
      element('div', '请先填写 Base URL 后再测试连接。', aiTestResult).className = 'ai-test-detail';
    } else if (!vals.model) {
      setAiConnBadge('idle', '待检测');
      element('div', '尚未选择模型。点「测试连接」将先验证端点与 Key 连通性，建议先「获取模型」选取具体模型。', aiTestResult).className = 'ai-test-detail';
    } else {
      setAiConnBadge('idle', '待检测');
      element('div', `当前模型：${vals.model} · 点击「测试连接」验证 Key、端点与模型推理是否可用。`, aiTestResult).className = 'ai-test-detail';
    }
  };

  const syncAiCurrentModelPill = () => {
    const m = aiModel.value.trim();
    aiModelCurrentPill.textContent = m ? `当前：${m}` : '未选模型';
    aiModelCurrentPill.title = m || '尚未选择或填写模型';
  };

  const validateAiBaseUrlField = () => {
    const vals = readAiFormValues();
    const isCustom = vals.provider === 'custom';
    aiBaseUrlTag.textContent = isCustom ? '必填' : '可改填中转地址';
    aiBaseUrlTag.className = isCustom ? 'ai-req-tag' : 'muted';
    if (!vals.baseUrl) {
      if (isCustom) {
        aiBaseUrlError.textContent = '自定义模式必须填写 Base URL（如 https://your-relay.example/v1）';
        aiBaseUrlError.hidden = false;
      } else {
        aiBaseUrlError.hidden = true;
      }
      return false;
    }
    try {
      normalizeAiBaseUrl(vals.baseUrl);
      aiBaseUrlError.hidden = true;
      return true;
    } catch (err) {
      aiBaseUrlError.textContent = err?.message || 'Base URL 格式非法';
      aiBaseUrlError.hidden = false;
      return false;
    }
  };

  const syncProviderMetaUi = () => {
    const vals = readAiFormValues();
    const preset = getAiProviderPreset(vals.provider);
    const proto = resolveAiProtocol(vals);
    aiProtoChip.textContent = protoLabelOf(proto);
    aiCorsCard.dataset.cors = preset?.corsMode || 'custom';
    const prefix = preset?.corsMode === 'direct' ? '✓ ' : (preset?.corsMode === 'relay-needed' || preset?.corsMode === 'proxy-or-relay') ? '⚠ ' : '';
    aiCorsBadge.textContent = `${prefix}${preset?.corsBadge || '自定义端点'}`;
    aiCorsEndpoint.textContent = preset?.modelsEndpointHint || '';
    aiProviderNote.textContent = preset?.note || '';
    aiBaseUrl.placeholder = preset?.baseUrl || 'https://your-openai-compatible-relay.example/v1';
    validateAiBaseUrlField();
  };

  const showAiModelsFeedback = ({ tone = 'info', title = '', hint = '', allowManualFocus = false } = {}) => {
    aiModelsFeedback.replaceChildren();
    if (!title && !hint) {
      aiModelsFeedback.hidden = true;
      return;
    }
    aiModelsFeedback.dataset.tone = tone;
    aiModelsFeedback.hidden = false;
    if (title) {
      const head = element('div', '', aiModelsFeedback); head.className = 'ai-fb-head';
      element('span', title, head);
    }
    if (hint) element('div', hint, aiModelsFeedback).className = 'ai-fb-hint';
    if (allowManualFocus) {
      const fallbackRow = element('div', '', aiModelsFeedback); fallbackRow.className = 'ai-inline-actions';
      const manualBtn = element('button', '改为手动填写模型名', fallbackRow);
      manualBtn.type = 'button'; manualBtn.className = 'ghost ai-compact-btn'; manualBtn.dataset.action = 'ai-manual-fallback';
      manualBtn.addEventListener('click', () => {
        setModelDropdownOpen(false);
        aiModel.focus();
        try { aiModel.select?.(); } catch { /* ignore */ }
      });
    }
  };

  const setModelDropdownOpen = open => {
    aiDropdownOpen = Boolean(open);
    aiModelDropdown.hidden = !aiDropdownOpen;
    aiModelDropdownToggle.setAttribute('aria-expanded', String(aiDropdownOpen));
    aiModelDropdownToggle.textContent = aiDropdownOpen ? '▴' : '▾';
    if (aiDropdownOpen) {
      renderAiModelOptions();
    }
  };

  const selectAiModelId = (modelId, { persist = true, closeDropdown = true } = {}) => {
    const clean = String(modelId || '').trim();
    if (!clean) return;
    const changed = aiModel.value.trim() !== clean;
    aiModel.value = clean;
    syncAiCurrentModelPill();
    if (closeDropdown) setModelDropdownOpen(false);
    showAiModelsFeedback({});
    if (persist) {
      persistAiSettings(changed ? `已选择模型 ${clean} 并保存` : `已保存模型 ${clean}`);
    }
    if (changed) renderAiTestPlaceholder();
  };

  const getFilteredModelItems = () => {
    const rawQuery = aiModelSearch.value.trim().toLowerCase();
    const tokens = rawQuery ? rawQuery.split(/\s+/u).filter(Boolean) : [];
    const currentVal = aiModel.value.trim();
    const list = [...aiFetchedModels];
    if (currentVal && !list.some(item => item.id === currentVal)) {
      list.unshift({ id: currentVal, label: '当前已填（手动/历史配置）', ownedBy: '', nonChat: false, isCurrentCustom: true });
    }
    if (!tokens.length) return list;
    return list.filter(item => {
      const hay = `${item.id} ${item.label || ''} ${item.ownedBy || ''}`.toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
  };

  const renderAiModelOptions = () => {
    aiModelList.replaceChildren();
    const filtered = getFilteredModelItems();
    const total = aiFetchedModels.length;
    aiModelCount.textContent = total > 0
      ? (aiModelSearch.value.trim() ? `${filtered.length} / ${total}` : `共 ${total} 个`)
      : '未拉取';
    aiModelDropMeta.textContent = aiFetchedMeta || '点「获取模型」拉取远程列表';

    if (!filtered.length) {
      const emptyBox = element('div', '', aiModelList); emptyBox.className = 'ai-model-empty';
      const q = aiModelSearch.value.trim();
      if (q) {
        element('span', `未匹配到「${q}」`, emptyBox);
        const useManual = element('button', `直接使用「${q}」`, emptyBox);
        useManual.type = 'button'; useManual.className = 'soft ai-compact-btn'; useManual.dataset.action = 'ai-model-use-query';
        useManual.addEventListener('click', () => selectAiModelId(q));
      } else {
        element('span', '暂无已拉取的模型列表，请先点「获取模型」或在上方直接输入模型名。', emptyBox);
      }
      aiDropdownFocusedIdx = -1;
      return;
    }

    const currentVal = aiModel.value.trim();
    if (aiDropdownFocusedIdx >= filtered.length) aiDropdownFocusedIdx = filtered.length - 1;
    filtered.forEach((item, idx) => {
      const opt = element('button', '', aiModelList);
      opt.type = 'button';
      opt.className = 'ai-model-option';
      opt.setAttribute('role', 'option');
      opt.dataset.modelId = item.id;
      const isSelected = item.id === currentVal;
      opt.setAttribute('aria-selected', String(isSelected));
      if (idx === aiDropdownFocusedIdx) opt.dataset.focused = 'true';

      const main = element('span', '', opt); main.className = 'ai-model-opt-main';
      element('span', item.id, main).className = 'ai-model-opt-id';
      if (item.label) element('span', item.label, main).className = 'ai-model-opt-sub';
      if (item.isCurrentCustom) {
        element('span', '当前', opt).className = 'ai-model-opt-tag';
      } else if (item.nonChat) {
        element('span', '非对话', opt).className = 'ai-model-opt-tag';
      }
      if (isSelected) element('span', '✓', opt).className = 'ai-model-opt-check';

      opt.addEventListener('click', () => selectAiModelId(item.id));
    });
  };

  const persistAiSettings = (customOkText = '') => {
    const vals = readAiFormValues();
    const res = kg.saveSettings(vals);
    if (res.ok) {
      if (customOkText) {
        aiSaveStatus.textContent = customOkText;
      } else {
        aiSaveStatus.textContent = res.settings.apiKey
          ? (res.backend === 'gm' ? '已保存到 GM_setValue 隔离存储' : '已保存到本地 localStorage（非油猴降级模式）')
          : '已保存（零 AI 档）';
      }
    } else {
      aiSaveStatus.textContent = res.error || '保存失败';
    }
    syncStorageWarning();
    return res;
  };

  const setFetchModelsLoading = loading => {
    aiFetchingModels = loading;
    aiFetchModelsBtn.disabled = loading;
    aiFetchModelsCancelBtn.hidden = !loading;
    aiFetchModelsBtn.replaceChildren();
    if (loading) {
      element('span', '', aiFetchModelsBtn).className = 'ai-spinner';
      element('span', '获取中…', aiFetchModelsBtn);
    } else {
      aiFetchModelsBtn.textContent = '获取模型';
    }
  };

  const setTestConnLoading = loading => {
    aiTestingConnection = loading;
    aiTestBtn.disabled = loading;
    aiTestCancelBtn.hidden = !loading;
    aiTestBtn.replaceChildren();
    if (loading) {
      element('span', '', aiTestBtn).className = 'ai-spinner';
      element('span', '检测中…', aiTestBtn);
      setAiConnBadge('testing', '检测中');
    } else {
      aiTestBtn.textContent = '测试连接';
    }
  };

  const handleFetchModels = async () => {
    if (aiFetchingModels) return;
    if (typeof kg.fetchModels !== 'function') {
      showAiModelsFeedback({ tone: 'error', title: '当前服务未启用模型拉取能力', hint: '请直接手动填写模型名。', allowManualFocus: true });
      return;
    }
    const vals = readAiFormValues();
    setFetchModelsLoading(true);
    showAiModelsFeedback({ tone: 'info', title: '正在请求模型列表…', hint: '等待服务商返回，可随时点「取消」中断。' });
    try {
      const res = await kg.fetchModels(vals);
      if (res.aborted) {
        showAiModelsFeedback({ tone: 'warn', title: '已取消获取模型', hint: '可稍后重新获取或直接手动填写模型名。' });
        return;
      }
      if (!res.ok) {
        const statusPart = res.statusCode ? `（HTTP ${res.statusCode}）` : '';
        const title = `${res.label || '获取失败'}${statusPart}：${res.message || '无法拉取模型列表'}`;
        showAiModelsFeedback({
          tone: 'error',
          title,
          hint: `${res.hint || ''}（您仍可随时回退到手动填写模型名）`.trim(),
          allowManualFocus: true,
        });
        return;
      }
      aiFetchedModels = Array.isArray(res.models) ? res.models : [];
      const chText = channelLabelOf(res.channel);
      aiFetchedMeta = `${chText ? `${chText} · ` : ''}${res.latencyMs}ms · 共 ${aiFetchedModels.length} 个`;
      aiModelSearch.value = '';
      aiDropdownFocusedIdx = 0;
      setModelDropdownOpen(true);
      showAiModelsFeedback({
        tone: 'ok',
        title: `已获取 ${aiFetchedModels.length} 个模型（${res.latencyMs}ms）`,
        hint: '请在上方下拉框中搜索并点选模型；选定后自动写入并同步生效。',
      });
      try { aiModelSearch.focus(); } catch { /* ignore */ }
    } catch (err) {
      showAiModelsFeedback({
        tone: 'error',
        title: `获取模型异常：${err?.message || err}`,
        hint: '请检查网络配置或直接手动填写模型名。',
        allowManualFocus: true,
      });
    } finally {
      setFetchModelsLoading(false);
    }
  };

  const renderAiTestResult = res => {
    aiTestResult.replaceChildren();
    if (!res) {
      renderAiTestPlaceholder();
      return;
    }
    if (res.aborted) {
      delete aiTestResult.dataset.tone;
      setAiConnBadge('idle', '已取消');
      element('div', '已取消本次连接测试。', aiTestResult).className = 'ai-test-detail';
      return;
    }
    const chLabel = channelLabelOf(res.channel);
    const metaParts = [];
    if (res.model) metaParts.push(res.model);
    if (Number.isFinite(res.latencyMs) && res.latencyMs > 0) metaParts.push(`${res.latencyMs}ms`);
    if (chLabel) metaParts.push(chLabel);

    if (res.ok) {
      const isDegraded = Boolean(res.degradedScope);
      aiTestResult.dataset.tone = isDegraded ? 'partial' : 'ok';
      setAiConnBadge('ok', isDegraded ? '端点可用' : '可用');
      const sum = element('div', '', aiTestResult); sum.className = 'ai-test-summary';
      element('span', isDegraded ? '✓ 端点可用（未测模型）' : '✓ 可用', sum);
      if (metaParts.length) element('span', metaParts.join(' · '), sum).className = 'ai-test-meta';
      if (res.testedWhat) element('div', res.testedWhat, aiTestResult).className = 'ai-test-detail';
      if (res.notTestedWhat) element('div', res.notTestedWhat, aiTestResult).className = 'ai-test-detail';
      if (res.hint) element('div', res.hint, aiTestResult).className = 'ai-test-detail';
      return;
    }

    aiTestResult.dataset.tone = 'error';
    setAiConnBadge(res.badgeStatus === 'unconfigured' ? 'unconfigured' : 'error', res.statusLabel || '不可用');
    const sum = element('div', '', aiTestResult); sum.className = 'ai-test-summary';
    element('span', `✕ ${res.statusLabel || '不可用'}`, sum);
    if (metaParts.length) element('span', metaParts.join(' · '), sum).className = 'ai-test-meta';
    if (res.message) element('div', res.message, aiTestResult).className = 'ai-test-detail';
    if (res.hint) element('div', res.hint, aiTestResult).className = 'ai-test-detail';
    if (res.testedWhat) element('div', `范围：${res.testedWhat}${res.notTestedWhat ? `；${res.notTestedWhat}` : ''}`, aiTestResult).className = 'ai-test-detail';
  };

  const handleTestConnection = async () => {
    if (aiTestingConnection) return;
    if (typeof kg.testConnection !== 'function') {
      renderAiTestResult({ ok: false, statusLabel: '不可用', message: '当前服务未启用连接测试能力' });
      return;
    }
    const vals = readAiFormValues();
    setTestConnLoading(true);
    aiTestResult.replaceChildren();
    aiTestResult.dataset.tone = 'info';
    element('div', vals.model ? `正在向模型「${vals.model}」发送极小测试请求…` : '尚未选择模型，正在探测端点与 Key 连通性…', aiTestResult).className = 'ai-test-detail';
    try {
      const res = await kg.testConnection(vals);
      renderAiTestResult(res);
      if (res.ok) {
        if (Array.isArray(res.models) && res.models.length && !aiFetchedModels.length) {
          aiFetchedModels = res.models;
          aiFetchedMeta = `${channelLabelOf(res.channel) ? `${channelLabelOf(res.channel)} · ` : ''}${res.latencyMs}ms · 共 ${res.models.length} 个`;
        }
        persistAiSettings(res.degradedScope ? '端点连通并已保存配置（建议再选定模型复测）' : `连接可用（${res.latencyMs}ms），配置已自动保存`);
      }
    } catch (err) {
      renderAiTestResult({ ok: false, category: 'network_error', statusLabel: '网络不通', message: err?.message || String(err) });
    } finally {
      setTestConnLoading(false);
    }
  };

  const syncAiForm = () => {
    const cfg = kg.getSettings();
    aiProvider.value = cfg.provider;
    aiLastProviderId = cfg.provider;
    aiBaseUrl.value = cfg.baseUrl;
    aiModel.value = cfg.model;
    aiApiKey.value = cfg.apiKey;
    aiTransport.value = cfg.transport;
    syncProviderMetaUi();
    syncAiCurrentModelPill();
    renderAiTestPlaceholder();
  };

  aiProvider.addEventListener('change', () => {
    const prevPreset = getAiProviderPreset(aiLastProviderId);
    const nextPreset = getAiProviderPreset(aiProvider.value);
    aiLastProviderId = aiProvider.value;
    if (nextPreset) {
      if (nextPreset.id === 'custom') {
        if (prevPreset && aiBaseUrl.value.trim() === prevPreset.baseUrl) aiBaseUrl.value = '';
      } else if (nextPreset.baseUrl) {
        aiBaseUrl.value = nextPreset.baseUrl;
      }
      if (nextPreset.id !== 'custom') {
        const curModel = aiModel.value.trim();
        if (!curModel || (prevPreset && curModel === prevPreset.model)) {
          aiModel.value = nextPreset.model || '';
        }
      }
    }
    aiFetchedModels = [];
    aiFetchedMeta = '';
    setModelDropdownOpen(false);
    showAiModelsFeedback({});
    syncProviderMetaUi();
    syncAiCurrentModelPill();
    renderAiTestPlaceholder();
    persistAiSettings('已切换服务商并保存');
  });

  aiBaseUrl.addEventListener('input', () => {
    syncProviderMetaUi();
  });
  aiBaseUrl.addEventListener('change', () => {
    syncProviderMetaUi();
    renderAiTestPlaceholder();
    persistAiSettings('已更新 Base URL 并保存');
  });

  aiApiKey.addEventListener('input', () => {
    if (!aiTestingConnection) renderAiTestPlaceholder();
  });
  aiApiKey.addEventListener('change', () => {
    renderAiTestPlaceholder();
    persistAiSettings();
  });

  aiModel.addEventListener('input', () => {
    syncAiCurrentModelPill();
    if (aiDropdownOpen) renderAiModelOptions();
  });
  aiModel.addEventListener('change', () => {
    syncAiCurrentModelPill();
    renderAiTestPlaceholder();
    persistAiSettings();
  });
  aiModel.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' && !aiDropdownOpen && aiFetchedModels.length) {
      ev.preventDefault();
      setModelDropdownOpen(true);
      try { aiModelSearch.focus(); } catch { /* ignore */ }
    } else if (ev.key === 'Escape' && aiDropdownOpen) {
      ev.preventDefault();
      setModelDropdownOpen(false);
    }
  });

  aiModelDropdownToggle.addEventListener('click', () => {
    setModelDropdownOpen(!aiDropdownOpen);
    if (aiDropdownOpen) {
      try { aiModelSearch.focus(); } catch { /* ignore */ }
    }
  });
  shell.addEventListener('click', ev => {
    if (!aiDropdownOpen) return;
    if (aiModelCombo.contains(ev.target) || aiFetchModelsBtn.contains(ev.target)) return;
    setModelDropdownOpen(false);
  });
  aiModelManualBtn.addEventListener('click', () => {
    setModelDropdownOpen(false);
    aiModel.focus();
    try { aiModel.select?.(); } catch { /* ignore */ }
  });
  aiModelSearch.addEventListener('input', () => {
    aiDropdownFocusedIdx = 0;
    renderAiModelOptions();
  });
  aiModelSearch.addEventListener('keydown', ev => {
    const items = getFilteredModelItems();
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (items.length) {
        aiDropdownFocusedIdx = (aiDropdownFocusedIdx + 1) % items.length;
        renderAiModelOptions();
      }
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (items.length) {
        aiDropdownFocusedIdx = aiDropdownFocusedIdx <= 0 ? items.length - 1 : aiDropdownFocusedIdx - 1;
        renderAiModelOptions();
      }
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const targetItem = items[aiDropdownFocusedIdx] || items[0];
      if (targetItem) selectAiModelId(targetItem.id);
      else if (aiModelSearch.value.trim()) selectAiModelId(aiModelSearch.value.trim());
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      setModelDropdownOpen(false);
      aiModel.focus();
    }
  });

  aiTransport.addEventListener('change', () => {
    persistAiSettings('已更新请求通道并保存');
  });

  aiFetchModelsBtn.addEventListener('click', () => { void handleFetchModels(); });
  aiFetchModelsCancelBtn.addEventListener('click', () => { kg.abortFetchModels?.(); });
  aiTestBtn.addEventListener('click', () => { void handleTestConnection(); });
  aiTestCancelBtn.addEventListener('click', () => { kg.abortTestConnection?.(); });

  const aiSaveBtn = button('ai-save', '保存配置', aiActions, () => {
    persistAiSettings();
  }, false);
  aiSaveBtn.className = 'primary';
  const aiResetBtn = button('ai-reset', '恢复默认', aiActions, () => {
    const def = getAiProviderPreset('deepseek');
    aiProvider.value = def.id;
    aiLastProviderId = def.id;
    aiBaseUrl.value = def.baseUrl;
    aiModel.value = def.model;
    aiTransport.value = 'auto';
    aiFetchedModels = [];
    aiFetchedMeta = '';
    setModelDropdownOpen(false);
    showAiModelsFeedback({});
    syncProviderMetaUi();
    syncAiCurrentModelPill();
    const res = kg.saveSettings({
      provider: def.id,
      baseUrl: def.baseUrl,
      model: def.model,
      apiKey: aiApiKey.value,
      transport: 'auto',
    });
    aiSaveStatus.textContent = res.ok ? '已恢复默认模型配置（API Key 保留）' : (res.error || '恢复失败');
    renderAiTestPlaceholder();
  }, false);
  aiResetBtn.className = 'ghost';
  const aiClearBtn = button('ai-clear-key', '清空 Key', aiActions, () => {
    const res = kg.clearApiKey();
    aiApiKey.value = '';
    setKeyVisible(false);
    aiFetchedModels = [];
    aiFetchedMeta = '';
    setModelDropdownOpen(false);
    showAiModelsFeedback({});
    aiSaveStatus.textContent = res.ok ? '已清空本地 API Key' : (res.error || '清空失败');
    renderAiTestPlaceholder();
  }, false);
  aiClearBtn.className = 'danger';
  syncAiForm();

  const unsubscribeAiSettings = kg.onSettingsChange ? kg.onSettingsChange(() => {
    if (kgModal) {
      syncSubtitleControls();
      renderQaDock();
      renderQuizPane();
    }
  }) : () => {};

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
  const playbackDiagnostics = element('details', '', diagGroup); playbackDiagnostics.className = 'separator';
  element('summary', '播放诊断日志', playbackDiagnostics);
  const recordingLabel = element('label', '', playbackDiagnostics); recordingLabel.className = 'check-row';
  const recording = element('input', '', recordingLabel); recording.type = 'checkbox'; recording.name = 'playback-log';
  element('span', '记录播放诊断', recordingLabel);
  const logActions = element('div', '', playbackDiagnostics); logActions.className = 'buttons';
  let logText = null;
  const copyPlaybackLogBtn = button('copy-playback-log', '复制诊断日志', logActions, async () => {
    const text = controller.getPlaybackLogText();
    logText?.remove();
    logText = null;
    if (!text) { logFeedback.textContent = '暂无日志，请先开启记录并复现问题。'; return; }
    try {
      await win.navigator.clipboard.writeText(text);
      logFeedback.textContent = '诊断日志已复制。';
    } catch {
      logText = element('textarea', '', playbackDiagnostics);
      logText.style.cssText = 'width:100%;font:inherit;'; logText.rows = 6; logText.readOnly = true;
      logText.setAttribute('aria-label', '播放诊断日志文本');
      logText.value = text;
      logText.focus();
      logText.select();
      logFeedback.textContent = '浏览器未允许直接复制，日志已选中，可按 Ctrl+C 或 ⌘C 复制。';
    }
  }, false);
  copyPlaybackLogBtn.className = 'ghost';
  const logFeedback = element('p', '默认关闭。日志保留在当前标签页，刷新前请先复制。', playbackDiagnostics);
  logFeedback.className = 'muted'; logFeedback.setAttribute('role', 'status');
  recording.addEventListener('change', () => {
    controller.setPlaybackLogging(recording.checked);
    logFeedback.textContent = recording.checked ? '正在记录。复现后可复制诊断日志。' : '已停止记录，仍可复制已有日志。';
  });

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
  const getSectionSegmentIndex = sectionId => {
    const list = getAllCourseSections();
    const target = list.find(s => String(s.sectionId || 'current') === String(sectionId || 'current'))
      || resolveFocusedSection()
      || list[0]
      || null;
    if (!target) return null;
    return buildSegmentIndex(target, { sectionId: target.sectionId || sectionId || 'current', durationSec: target.durationSec });
  };

  const appendHighlightedExcerpt = (container, sourceText, quoteText = '') => {
    const src = String(sourceText || '');
    const rawQuote = String(quoteText || '').trim();
    if (!src) return;
    const cleanQuote = normalizeCitationCompareText(rawQuote);
    // Find best matching substring in sourceText (verbatim or 3+ char keyword chunks) safely using text nodes
    const ranges = [];
    if (rawQuote.length >= 2) {
      const exactIdx = src.toLowerCase().indexOf(rawQuote.toLowerCase());
      if (exactIdx >= 0) {
        ranges.push([exactIdx, exactIdx + rawQuote.length]);
      } else if (cleanQuote.length >= 3) {
        const keywords = rawQuote.split(/[\s，,。！？!?；;：:、（）()《》「」“”"'\[\]【】]+/u).filter(w => w.length >= 2);
        for (const kw of keywords.slice(0, 6)) {
          const idx = src.toLowerCase().indexOf(kw.toLowerCase());
          if (idx >= 0) ranges.push([idx, idx + kw.length]);
        }
      }
    }
    if (!ranges.length) {
      container.append(document.createTextNode(src));
      return;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [s, e] of ranges) {
      const prev = merged.at(-1);
      if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e);
      else merged.push([s, e]);
    }
    let pos = 0;
    for (const [s, e] of merged) {
      if (s > pos) container.append(document.createTextNode(src.slice(pos, s)));
      const mark = document.createElement('mark');
      mark.textContent = src.slice(s, e);
      container.append(mark);
      pos = e;
    }
    if (pos < src.length) container.append(document.createTextNode(src.slice(pos)));
  };

  const shortUnverifiedTag = reasonCode => {
    if (reasonCode === 'id_not_found') return 'ID不存在';
    if (reasonCode === 'time_out_of_bounds') return '时间越界';
    if (reasonCode === 'text_mismatch') return '原文不符';
    if (reasonCode === 'missing_source') return '无原字幕';
    return '待核实';
  };

  const focusDetailTimelineRow = refKey => {
    if (!kgModal || !refKey) return;
    switchKgTab('detail');
    const prevActive = kgModal.detailPane.querySelectorAll('[data-cite-highlighted="true"]');
    for (const node of prevActive) delete node.dataset.citeHighlighted;
    const row = [...kgModal.detailPane.querySelectorAll('[data-timeline-ref-key]')].find(el => el.dataset.timelineRefKey === refKey);
    if (row) {
      row.dataset.citeHighlighted = 'true';
      try { row.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    }
  };

  const toggleInlineEvidence = ({ hostEl, triggerBtn, citation, sectionId, segIdx, onSeek }) => {
    if (!hostEl || !citation) return;
    const existingSlot = hostEl.querySelector(':scope > .kg-evidence-slot');
    const sameTrigger = Boolean(existingSlot && triggerBtn?.dataset?.citeActive === 'true');
    // Clear previous active buttons inside this host
    for (const btn of hostEl.querySelectorAll('[data-cite-active="true"]')) delete btn.dataset.citeActive;
    if (existingSlot) existingSlot.remove();
    delete hostEl.dataset.citeHighlighted;
    if (sameTrigger) return;

    hostEl.dataset.citeHighlighted = 'true';
    if (triggerBtn) triggerBtn.dataset.citeActive = 'true';

    const slot = element('div', '', hostEl);
    slot.className = 'kg-evidence-slot';

    const closeSelf = () => {
      slot.remove();
      delete hostEl.dataset.citeHighlighted;
      if (triggerBtn) delete triggerBtn.dataset.citeActive;
    };

    if (citation.verified) {
      const resolvedSecId = citation.sectionId || sectionId || 'current';
      const resolvedIdx = segIdx || getSectionSegmentIndex(resolvedSecId);
      const neighbors = citation.segId && resolvedIdx ? resolvedIdx.getNeighbors(citation.segId) : { prev: citation.prevSegment || null, current: null, next: citation.nextSegment || null };
      const prevSeg = neighbors.prev || citation.prevSegment || null;
      const nextSeg = neighbors.next || citation.nextSegment || null;
      const curText = neighbors.current?.text || citation.excerpt || '';
      const displayId = citation.displayId || (citation.segId ? `[${citation.segId}]` : '');
      const timeRange = citation.endTimestamp && citation.endTimestamp !== citation.timestamp
        ? `${citation.timestamp}–${citation.endTimestamp}`
        : (citation.timestamp || formatTimestamp(citation.seconds || 0));

      const card = element('div', '', slot);
      card.className = 'kg-evidence-card';
      card.dataset.kgEvidenceCard = '';
      card.dataset.citeStatus = 'verified';
      if (citation.segId) card.dataset.segId = citation.segId;
      if (citation.refKey) card.dataset.refKey = citation.refKey;

      const head = element('div', '', card); head.className = 'kg-ev-head';
      element('span', `原字幕证据 · ${displayId ? `${displayId} · ` : ''}${timeRange}（已核对）`, head);
      const closeBtn = element('button', '收起', head);
      closeBtn.type = 'button'; closeBtn.className = 'kg-mini-btn ghost'; closeBtn.dataset.action = 'kg-evidence-close';
      closeBtn.addEventListener('click', ev => { ev.stopPropagation(); closeSelf(); });

      if (prevSeg && prevSeg.text) {
        const prevBox = element('div', '', card); prevBox.className = 'kg-ev-neighbor'; prevBox.dataset.evNeighbor = 'prev';
        element('span', `上一段 ${prevSeg.displayId || `[${prevSeg.segId}]`} · ${prevSeg.timestamp || formatTimestamp(prevSeg.startSec || 0)}`, prevBox);
        element('div', prevSeg.text, prevBox);
      }

      const curBox = element('div', '', card); curBox.className = 'kg-ev-current'; curBox.dataset.evCurrent = '';
      element('span', `命中原字幕 ${displayId} · ${timeRange}`, curBox);
      const curBody = element('div', '', curBox);
      appendHighlightedExcerpt(curBody, curText || '（原字幕片段已匹配）', citation.rawQuote || citation.rawNote || '');

      if (nextSeg && nextSeg.text) {
        const nextBox = element('div', '', card); nextBox.className = 'kg-ev-neighbor'; nextBox.dataset.evNeighbor = 'next';
        element('span', `下一段 ${nextSeg.displayId || `[${nextSeg.segId}]`} · ${nextSeg.timestamp || formatTimestamp(nextSeg.startSec || 0)}`, nextBox);
        element('div', nextSeg.text, nextBox);
      }

      const actions = element('div', '', card); actions.className = 'kg-ev-actions';
      const seekUnmuteBtn = element('button', '▶ 跳播并开声', actions);
      seekUnmuteBtn.type = 'button'; seekUnmuteBtn.className = 'kg-mini-btn primary';
      seekUnmuteBtn.dataset.action = 'kg-evidence-seek-unmute';
      seekUnmuteBtn.dataset.seekSeconds = String(Math.floor(citation.seconds || 0));
      seekUnmuteBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        (onSeek || handleKgSeek)({ sectionId: resolvedSecId, seconds: Math.floor(citation.seconds || 0), unmute: true });
      });

      const seekMutedBtn = element('button', '仅跳播', actions);
      seekMutedBtn.type = 'button'; seekMutedBtn.className = 'kg-mini-btn ghost';
      seekMutedBtn.dataset.action = 'kg-evidence-seek-only';
      seekMutedBtn.dataset.seekSeconds = String(Math.floor(citation.seconds || 0));
      seekMutedBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        (onSeek || handleKgSeek)({ sectionId: resolvedSecId, seconds: Math.floor(citation.seconds || 0), unmute: false });
      });

      if (citation.refKey) {
        const gotoDetailBtn = element('button', '在细读中定位', actions);
        gotoDetailBtn.type = 'button'; gotoDetailBtn.className = 'kg-mini-btn ghost';
        gotoDetailBtn.dataset.action = 'kg-evidence-goto-detail';
        gotoDetailBtn.addEventListener('click', ev => {
          ev.stopPropagation();
          focusDetailTimelineRow(citation.refKey);
        });
      }
      return;
    }

    // Unverified / untrusted citation inspection panel (NEVER shown as verified evidence!)
    const card = element('div', '', slot);
    card.className = 'kg-evidence-card kg-evidence-unverified';
    card.dataset.kgUnverifiedCard = '';
    card.dataset.citeStatus = 'unverified';
    if (citation.reasonCode) card.dataset.reasonCode = citation.reasonCode;

    const head = element('div', '', card); head.className = 'kg-ev-head';
    element('span', `⚠ 不可信 / 未核实引用（${shortUnverifiedTag(citation.reasonCode)}）`, head);
    const closeBtn = element('button', '收起', head);
    closeBtn.type = 'button'; closeBtn.className = 'kg-mini-btn ghost'; closeBtn.dataset.action = 'kg-evidence-close';
    closeBtn.addEventListener('click', ev => { ev.stopPropagation(); closeSelf(); });

    element('div', `核验失败原因：${citation.reason || '该引用未能与本课节原字幕核对一致，请勿当作已核实依据。'}`, card);

    const detailBox = element('div', '', card); detailBox.className = 'kg-ev-unverified-detail';
    element('div', `AI 原始引用：${citation.rawRef || citation.displayId || '（未提供有效编号）'}`, detailBox);
    if (citation.rawQuote) element('div', `AI 引述内容：「${citation.rawQuote}」`, detailBox);
    if (citation.rawNote && citation.rawNote !== citation.rawQuote) element('div', `AI 依据说明：${citation.rawNote}`, detailBox);
    if (citation.excerpt) {
      element('div', `该编号 ${citation.displayId || ''} 对应的实际原字幕：「${citation.excerpt}」`, detailBox);
    }
  };

  const resolveCitationForItem = (item, sectionId) => {
    if (!item || typeof item !== 'object') return null;
    if (item.citation && typeof item.citation === 'object') return item.citation;
    const segIdx = getSectionSegmentIndex(sectionId);
    const hasRef = Boolean(item.segId || (Number.isFinite(item.seconds) && item.seconds >= 0));
    if (!hasRef) return null;
    if (segIdx && segIdx.segments.length) {
      return verifyCitation({
        segId: item.segId,
        seconds: item.seconds,
        quote: item.quote,
        sectionId,
      }, segIdx, { claimText: item.text || item.question || item.definition || '', minClaimCheckChars: 9999 });
    }
    if (Number.isFinite(item.seconds) && item.seconds >= 0) {
      const floorSec = Math.floor(item.seconds);
      return {
        status: 'verified',
        verified: true,
        segId: item.segId || null,
        displayId: item.segId ? `[${item.segId}]` : formatTimestamp(floorSec),
        refKey: item.refKey || null,
        sectionId: sectionId || 'current',
        seconds: floorSec,
        timestamp: formatTimestamp(floorSec),
        endTimestamp: formatTimestamp(floorSec),
        minuteLabel: `约第 ${Math.floor(floorSec / 60) + 1} 分钟`,
        excerpt: item.excerpt || item.text || '',
        rawQuote: '',
      };
    }
    return null;
  };

  const createCitationBtn = (parent, { item, sectionId, hostEl, onSeek, labelPrefix = '' } = {}) => {
    const citation = resolveCitationForItem(item, sectionId);
    if (!citation) return null;
    const btn = element('button', '', parent);
    btn.type = 'button';
    btn.dataset.citeStatus = citation.verified ? 'verified' : 'unverified';
    if (citation.verified) {
      const idPart = citation.segId ? `[${citation.segId}] ` : '';
      const tsPart = citation.timestamp || formatTimestamp(citation.seconds || 0);
      btn.textContent = `${labelPrefix}${idPart}${tsPart}`;
      btn.className = 'kg-cite-btn';
      if (citation.segId) btn.dataset.segId = citation.segId;
      if (citation.refKey) btn.dataset.refKey = citation.refKey;
      btn.dataset.seekSeconds = String(Math.floor(citation.seconds || 0));
      btn.title = '点击原地标黄并展开原字幕证据（再决定是否跳播开声）';
    } else {
      btn.textContent = `⚠ 未核实 · ${shortUnverifiedTag(citation.reasonCode)}`;
      btn.className = 'kg-cite-btn kg-cite-unverified';
      if (citation.reasonCode) btn.dataset.reasonCode = citation.reasonCode;
      btn.title = '该引用未通过原字幕核验，点击查看详情与 AI 原始表述';
    }
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const segIdx = getSectionSegmentIndex(citation.sectionId || sectionId);
      toggleInlineEvidence({
        hostEl: hostEl || parent,
        triggerBtn: btn,
        citation,
        sectionId: citation.sectionId || sectionId || 'current',
        segIdx,
        onSeek,
      });
    });
    return btn;
  };
  const cleanDisplayText = (text, maxLen = 140) => sanitizeCompleteText(text, { maxLen, allowShort: true, stripPrefixes: true });

  const resolveSectionSourceBadge = (sec, resultMeta = {}) => {
    if (sec?.hasSubtitle === false) {
      return sec.mode === 'highlight'
        ? { text: '本地摘要（平台看点）', tone: 'local', source: 'local' }
        : { text: '无字幕', tone: 'nosub', source: 'nosub' };
    }
    if (sec?.mode === 'ai') return { text: 'AI 生成', tone: 'ai', source: 'ai' };
    if (sec?.mode === 'highlight') return { text: '本地摘要（平台看点）', tone: 'local', source: 'local' };
    if (sec?.mode === 'placeholder') return { text: '目录占位', tone: 'local', source: 'local' };
    if (sec?.fallbackReason || resultMeta?.fallback) {
      return { text: '本地摘要（降级）', tone: 'fallback', source: 'fallback' };
    }
    return { text: '本地摘要', tone: 'local', source: 'local' };
  };

  const renderSourceCallout = (container, tree, resultMeta = {}) => {
    if (!tree || tree.noSubtitle || resultMeta.noSubtitle) return;
    const usedAi = Boolean(resultMeta.usedAi ?? (tree.mode === 'ai' || tree.mode === 'ai-partial'));
    const failedList = Array.isArray(resultMeta.failedSections) && resultMeta.failedSections.length
      ? resultMeta.failedSections
      : (Array.isArray(tree.failedSections) ? tree.failedSections : []);
    const isFallback = Boolean(resultMeta.fallback || failedList.length > 0 || tree.mode === 'ai-partial');
    // Pure AI mode: keep existing clean AI reading experience completely untouched!
    if (usedAi && !isFallback) return;

    const hasKey = Boolean(kg.getSettings()?.apiKey?.trim());
    const isPartial = usedAi && isFallback;
    const callout = element('div', '', container);
    callout.className = 'kg-source-callout';
    callout.dataset.kgSourceCallout = '';
    callout.dataset.tone = isFallback ? 'fallback' : 'local';
    callout.dataset.sourceState = isPartial
      ? 'partial-fallback'
      : isFallback
        ? 'fallback-error'
        : hasKey
          ? 'local-ready'
          : 'local-no-key';

    const bodyBox = element('div', '', callout); bodyBox.className = 'kg-source-callout-body';
    const titleText = isPartial
      ? '部分课节为本地摘要（未使用 AI），开启/修复 AI 解读可获得完整讲解'
      : '当前为本地摘要（未使用 AI），开启/修复 AI 解读可获得完整讲解';
    const titleEl = element('div', titleText, bodyBox);
    titleEl.className = 'kg-source-callout-title';
    titleEl.dataset.kgSourceCalloutTitle = '';

    let descText = '';
    if (isPartial) {
      const detail = failedList.slice(0, 2).map(f => `《${f.title || '课节'}》（${f.reason || '调用失败'}）`).join('、');
      descText = detail
        ? `降级原因：${detail}${failedList.length > 2 ? ` 等 ${failedList.length} 节` : ''}调用失败，已自动降级为本地摘要；其余课节为 AI 生成。`
        : (tree.fallbackReason || '部分课节 AI 解读失败，已局部降级为本地摘要。');
    } else if (isFallback) {
      const rawReason = String(failedList[0]?.reason || tree.fallbackReason || 'AI 调用失败').trim();
      descText = rawReason.startsWith('降级原因') ? rawReason : `降级原因：${rawReason}`;
    } else if (!hasKey) {
      descText = '当前尚未配置 API Key，下方内容由本地字幕规则提炼（不消耗 token）；配置后即可使用 AI 解读。';
    } else {
      descText = '已检测到本地 AI 配置，当前展示为默认本地摘要（0 token）；点击「立即 AI 解读」即可生成完整讲解。';
    }
    const descEl = element('div', descText, bodyBox);
    descEl.className = 'kg-source-callout-desc';
    descEl.dataset.kgSourceCalloutDesc = '';

    const actions = element('div', '', callout); actions.className = 'kg-source-callout-actions';
    if (!isFallback && hasKey) {
      const runAiBtn = element('button', '立即 AI 解读', actions);
      runAiBtn.type = 'button'; runAiBtn.className = 'kg-mini-btn primary';
      runAiBtn.dataset.action = 'kg-callout-run-ai';
      runAiBtn.addEventListener('click', () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }));
      const cfgBtn = element('button', '前往 AI 设置', actions);
      cfgBtn.type = 'button'; cfgBtn.className = 'kg-mini-btn ghost';
      cfgBtn.dataset.action = 'kg-callout-settings';
      cfgBtn.addEventListener('click', openAiSettingsFromModal);
    } else {
      const cfgBtn = element('button', isFallback ? '修复 AI 设置' : '前往 AI 设置', actions);
      cfgBtn.type = 'button'; cfgBtn.className = 'kg-mini-btn primary';
      cfgBtn.dataset.action = 'kg-callout-settings';
      cfgBtn.addEventListener('click', openAiSettingsFromModal);
      if (isFallback && hasKey) {
        const retryBtn = element('button', '重试 AI 解读', actions);
        retryBtn.type = 'button'; retryBtn.className = 'kg-mini-btn ghost';
        retryBtn.dataset.action = 'kg-callout-retry-ai';
        retryBtn.addEventListener('click', () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: true, forceRefresh: true }));
      }
    }
  };

  const renderKnowledgeQuick = (container, tree, onSeek, onSwitchTab, resultMeta = {}) => {
    container.replaceChildren();
    const sections = Array.isArray(tree?.sections) ? tree.sections : [];
    if (!sections.length) { element('p', '暂无可展示的课节或字幕内容。', container).className = 'muted'; return; }

    renderSourceCallout(container, tree, resultMeta);

    const usedAi = Boolean(resultMeta.usedAi ?? (tree.mode === 'ai' || tree.mode === 'ai-partial'));
    const isFallback = Boolean(resultMeta.fallback || tree.mode === 'ai-partial');

    // Course-level overview card when multiple sections are present
    if (sections.length > 1) {
      const courseCard = element('div', '', container); courseCard.className = 'kg-card kg-card-course'; courseCard.dataset.kgCourseOverview = '';
      const head = element('div', '', courseCard); head.className = 'kg-card-head';
      element('h3', `整门课总览 · ${tree.scopeLabel || `共 ${sections.length} 节`}`, head);
      const headRight = element('div', '', head); headRight.className = 'kg-card-head-right';
      const courseSource = tree.noSubtitle
        ? { text: '无字幕', tone: 'nosub', source: 'nosub' }
        : (usedAi && !isFallback)
          ? { text: 'AI 生成', tone: 'ai', source: 'ai' }
          : (usedAi && isFallback)
            ? { text: 'AI 生成 · 局部降级', tone: 'fallback', source: 'fallback' }
            : isFallback
              ? { text: '本地摘要（降级）', tone: 'fallback', source: 'fallback' }
              : { text: '本地摘要', tone: 'local', source: 'local' };
      const courseSourceBadge = element('span', courseSource.text, headRight);
      courseSourceBadge.className = 'kg-badge';
      courseSourceBadge.dataset.tone = courseSource.tone;
      courseSourceBadge.dataset.kgSourceBadge = courseSource.source;
      const mapJump = element('button', '查看全课导图 →', headRight); mapJump.type = 'button'; mapJump.className = 'kg-mini-btn ghost';
      mapJump.addEventListener('click', () => onSwitchTab('map'));
      const themes = Array.isArray(tree.courseThemes) ? tree.courseThemes.map(t => cleanDisplayText(t, 24)).filter(Boolean) : [];
      if (themes.length) {
        const themeBar = element('div', '', courseCard); themeBar.className = 'kg-theme-bar'; themeBar.dataset.kgCourseThemes = '';
        element('span', '核心主题', themeBar).className = 'kg-theme-label';
        for (const t of themes.slice(0, 5)) {
          element('span', t, themeBar).className = 'kg-theme-chip';
        }
      }
      const cleanOverview = cleanDisplayText(tree.overview || '', 160);
      if (cleanOverview) {
        const lead = element('p', cleanOverview, courseCard); lead.className = 'kg-one-line'; lead.dataset.kgOverview = '';
      }
      const cleanCourseKps = (Array.isArray(tree.courseKeyPoints) ? tree.courseKeyPoints : [])
        .map(kp => ({ ...kp, text: cleanDisplayText(kp?.text || '', 80) }))
        .filter(kp => kp.text);
      if (cleanCourseKps.length) {
        element('div', `全课核心要点 · ${cleanCourseKps.length}`, courseCard).className = 'kg-subhead';
        const ol = element('ol', '', courseCard); ol.className = 'kg-kp-list'; ol.dataset.kgCourseKeypoints = '';
        cleanCourseKps.forEach((kp, idx) => {
          const li = element('li', '', ol); li.className = 'kg-kp-item';
          element('span', String(idx + 1), li).className = 'kg-kp-num';
          const textWrap = element('span', kp.text, li); textWrap.className = 'kg-kp-text';
          const meta = element('span', '', li); meta.className = 'kg-kp-meta';
          const secIdx = Number.isFinite(kp.sectionIndex) ? kp.sectionIndex
            : (sections.findIndex(s => String(s.sectionId) === String(kp.sectionId)) + 1 || null);
          if (Array.isArray(kp.coveredSections) && kp.coveredSections.length > 1) {
            const tag = element('span', `跨 ${kp.coveredSections.length} 节`, meta);
            tag.className = 'kg-kp-sec-tag';
            tag.title = `覆盖第 ${kp.coveredSections.join('、')} 节`;
          } else if (secIdx) {
            const tag = element('span', `第 ${secIdx} 节`, meta);
            tag.className = 'kg-kp-sec-tag';
            if (kp.sectionTitle) tag.title = kp.sectionTitle;
          }
          createCitationBtn(meta, { item: kp, sectionId: kp.sectionId || 'current', hostEl: li, onSeek });
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
      const srcInfo = resolveSectionSourceBadge(sec, resultMeta);
      const secBadge = element('span', srcInfo.text, head);
      secBadge.className = 'kg-badge';
      secBadge.dataset.tone = srcInfo.tone;
      secBadge.dataset.kgSourceBadge = srcInfo.source;

      if (isNoSub) {
        const noSubBox = element('div', '', card); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgNoSubtitle = sec.sectionId || 'current';
        element('strong', '本课无字幕', noSubBox);
        const detailReason = String(sec.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
        element('div', detailReason, noSubBox);
        if (sec.mode !== 'highlight') continue;
      }

      if (usedAi && sec.mode !== 'ai' && sec.fallbackReason) {
        const secNote = element('div', '', card); secNote.className = 'kg-sec-fallback-note'; secNote.dataset.kgSecFallbackNote = sec.sectionId || '';
        element('span', `本节 AI 解读失败（${sec.fallbackReason}），已降级为本地摘要。`, secNote);
        const fixBtn = element('button', 'AI 设置', secNote); fixBtn.type = 'button'; fixBtn.className = 'kg-mini-btn ghost';
        fixBtn.addEventListener('click', openAiSettingsFromModal);
      }

      // 1. Section summary (guarded against truncated ellipsis fragments)
      const cleanSecSummary = cleanDisplayText(sec.summary || '', 140);
      if (cleanSecSummary) {
        const sum = element('p', cleanSecSummary, card); sum.className = 'kg-one-line'; sum.dataset.kgSectionSummary = '';
      }

      // 2. Core Key Points Card (drop truncated fragments cleanly)
      const cleanSecKps = (Array.isArray(sec.keyPoints) ? sec.keyPoints : [])
        .map(kp => ({ ...kp, text: cleanDisplayText(kp?.text || '', 80) }))
        .filter(kp => kp.text);
      if (cleanSecKps.length) {
        element('div', `核心要点 · ${cleanSecKps.length}`, card).className = 'kg-subhead';
        const ol = element('ol', '', card); ol.className = 'kg-kp-list'; ol.dataset.kgKeypoints = '';
        cleanSecKps.forEach((kp, idx) => {
          const li = element('li', '', ol); li.className = 'kg-kp-item';
          element('span', String(idx + 1), li).className = 'kg-kp-num';
          element('span', kp.text, li).className = 'kg-kp-text';
          createCitationBtn(li, { item: kp, sectionId: sec.sectionId || 'current', hostEl: li, onSeek });
        });
      }

      // Chunk summaries shown when long-section aggregation degraded
      if (Array.isArray(sec.chunkSummaries) && sec.chunkSummaries.length > 1) {
        const cleanChunks = sec.chunkSummaries
          .map(cs => ({ ...cs, summary: cleanDisplayText(cs?.summary || '', 120) }))
          .filter(cs => cs.summary);
        if (cleanChunks.length > 1) {
          element('div', `分段摘要 · ${cleanChunks.length}`, card).className = 'kg-subhead';
          const ul = element('ul', '', card); ul.className = 'kg-points'; ul.dataset.kgChunkSummaries = '';
          for (const cs of cleanChunks) {
            const li = element('li', '', ul);
            element('span', `第 ${cs.chunkIndex} 段：${cs.summary}`, li);
            createCitationBtn(li, { item: cs, sectionId: sec.sectionId || 'current', hostEl: li, onSeek });
          }
        }
      }

      // 3. 3-level Hierarchical Outline (default collapsed at 3rd level)
      const outline = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
      const cleanOutline = outline
        .map(topic => ({
          name: cleanDisplayText(topic?.name || '主题', 40) || '主题',
          points: (Array.isArray(topic?.points) ? topic.points : [])
            .map(pt => ({ ...pt, text: cleanDisplayText(pt?.text || '', 80) }))
            .filter(pt => pt.text),
        }))
        .filter(topic => topic.points.length > 0);
      if (cleanOutline.length) {
        element('div', '知识大纲', card).className = 'kg-subhead';
        const foldList = element('div', '', card); foldList.className = 'kg-fold-list'; foldList.dataset.kgOutline = '';
        for (const topic of cleanOutline) {
          const details = element('details', '', foldList); details.className = 'kg-topic-fold'; details.open = false;
          const summary = element('summary', '', details);
          element('span', topic.name, summary);
          element('span', `${topic.points.length}`, summary).className = 'kg-topic-count';
          const ul = element('ul', '', details); ul.className = 'kg-points';
          for (const pt of topic.points) {
            const li = element('li', '', ul);
            element('span', pt.text, li);
            createCitationBtn(li, { item: pt, sectionId: sec.sectionId || 'current', hostEl: li, onSeek });
          }
        }
      }

      // 4. Q&A Self-Check
      const cleanQuiz = (Array.isArray(sec.quiz) ? sec.quiz : [])
        .map(item => ({
          ...item,
          question: cleanDisplayText(item?.question || '', 120),
          answer: cleanDisplayText(item?.answer || '', 220),
        }))
        .filter(item => item.question && item.answer);
      if (cleanQuiz.length) {
        element('div', `自测 · ${cleanQuiz.length}`, card).className = 'kg-subhead';
        const qList = element('div', '', card); qList.className = 'kg-quiz-list'; qList.dataset.kgQuiz = '';
        cleanQuiz.forEach((item, idx) => {
          const qCard = element('div', '', qList); qCard.className = 'kg-quiz-item';
          const qTop = element('div', '', qCard); qTop.className = 'kg-quiz-q';
          element('span', `Q${idx + 1}. ${item.question}`, qTop);
          const qActions = element('div', '', qTop); qActions.className = 'kg-quiz-actions';
          createCitationBtn(qActions, { item, sectionId: sec.sectionId || 'current', hostEl: qCard, onSeek });
          const ansBox = element('div', item.answer, qCard); ansBox.className = 'kg-quiz-ans'; ansBox.dataset.kgQuizAnswer = ''; ansBox.hidden = true;
          const revealBtn = element('button', '答案', qActions); revealBtn.type = 'button'; revealBtn.className = 'kg-mini-btn ghost'; revealBtn.dataset.action = `kg-quiz-toggle-${sec.sectionIndex || 1}-${idx}`;
          revealBtn.addEventListener('click', () => {
            ansBox.hidden = !ansBox.hidden;
            revealBtn.textContent = ansBox.hidden ? '答案' : '收起';
          });
        });
      }

      // 5. Glossary / Term Cards (complete plain-language definitions + importance tag, never truncated)
      const cleanGlossary = (Array.isArray(sec.glossary) ? sec.glossary : [])
        .map(g => ({
          ...g,
          term: cleanDisplayText(g?.term || '', 32),
          definition: cleanDisplayText(g?.definition || '', 90),
        }))
        .filter(g => g.term && g.definition);
      if (cleanGlossary.length) {
        element('div', `术语 · ${cleanGlossary.length}`, card).className = 'kg-subhead';
        const grid = element('div', '', card); grid.className = 'kg-glossary-grid'; grid.dataset.kgGlossary = '';
        for (const g of cleanGlossary) {
          const tCard = element('div', '', grid); tCard.className = 'kg-term-card';
          const tHead = element('div', '', tCard); tHead.className = 'kg-term-head';
          const tTitleWrap = element('span', '', tHead); tTitleWrap.className = 'kg-term-title-wrap';
          element('strong', g.term, tTitleWrap);
          if (g.importance) {
            const tag = element('span', g.importance, tTitleWrap);
            tag.className = 'kg-term-tag';
            tag.dataset.core = String(g.isCore === true || g.importance === '本课重点');
          }
          createCitationBtn(tHead, { item: g, sectionId: sec.sectionId || 'current', hostEl: tCard, onSeek });
          element('p', g.definition, tCard).className = 'kg-term-def';
        }
      }
    }
  };

  const renderKnowledgeDetail = (container, tree, onSeek, resultMeta = {}) => {
    container.replaceChildren();
    const sections = Array.isArray(tree?.sections) ? tree.sections : [];
    if (!sections.length) { element('p', '暂无课节内容。', container).className = 'muted'; return; }
    renderSourceCallout(container, tree, resultMeta);
    const silentSkipMixed = sections.length > 1 && tree?.hasAnySubtitle === true;
    for (const sec of sections) {
      if (sec.hasSubtitle === false && silentSkipMixed && sec.mode !== 'highlight') continue;
      const card = element('div', '', container); card.className = 'kg-card';
      const head = element('div', '', card); head.className = 'kg-card-head';
      element('h3', `${sec.chapterTitle ? `${sec.chapterTitle} · ` : ''}${sec.title || '课节'}`, head);
      const srcInfo = resolveSectionSourceBadge(sec, resultMeta);
      const badge = element('span', srcInfo.text, head);
      badge.className = 'kg-badge';
      badge.dataset.tone = srcInfo.tone;
      badge.dataset.kgSourceBadge = srcInfo.source;
      if (sec.hasSubtitle === false) {
        const noSubBox = element('div', '', card); noSubBox.className = 'kg-nosub-box'; noSubBox.dataset.kgNoSubtitleDetail = sec.sectionId || 'current';
        element('strong', '本课无字幕', noSubBox);
        const detailReason = String(sec.subtitleReason || '该课节没有可用的 AI 字幕，因此无法生成时间轴导览、AI 问答与出题。').replace(/^本课无字幕[：:]\s*/u, '');
        element('div', detailReason, noSubBox);
        if (sec.mode !== 'highlight') continue;
      }
      const cleanSecSummary = cleanDisplayText(sec.summary || '', 140);
      if (cleanSecSummary) element('p', cleanSecSummary, card).className = 'kg-one-line';

      const outline = Array.isArray(sec.outline) && sec.outline.length ? sec.outline : (Array.isArray(sec.topics) ? sec.topics : []);
      const cleanOutline = outline
        .map(topic => ({
          name: cleanDisplayText(topic?.name || '主题', 40) || '主题',
          points: (Array.isArray(topic?.points) ? topic.points : [])
            .map(pt => ({ ...pt, text: cleanDisplayText(pt?.text || '', 80) }))
            .filter(pt => pt.text),
        }))
        .filter(topic => topic.points.length > 0);
      if (cleanOutline.length) {
        element('div', '完整知识点', card).className = 'kg-subhead';
        for (const topic of cleanOutline) {
          const tHead = element('div', topic.name, card); tHead.className = 'settings-title';
          const ul = element('ul', '', card); ul.className = 'kg-points';
          for (const pt of topic.points) {
            const li = element('li', '', ul);
            element('span', pt.text, li);
            createCitationBtn(li, { item: pt, sectionId: sec.sectionId || 'current', hostEl: li, onSeek });
          }
        }
      }

      if (Array.isArray(sec.timeline) && sec.timeline.length) {
        element('div', `字幕时间轴 · ${sec.timeline.length}`, card).className = 'kg-subhead';
        const tlBox = element('div', '', card); tlBox.dataset.kgTimeline = '';
        sec.timeline.forEach((item, idx) => {
          const segId = item.segId || `S${String(item.index || idx + 1).padStart(2, '0')}`;
          const secId = sec.sectionId || 'current';
          const refKey = item.refKey || `${secId}#${segId}`;
          const row = element('div', '', tlBox);
          row.className = 'kg-timeline-item';
          row.dataset.timelineSegId = segId;
          row.dataset.timelineRefKey = refKey;
          const secNum = Number.isFinite(item.startSec) ? Math.floor(item.startSec) : 0;
          const badgeBtn = element('span', `[${segId}] ${item.timestamp || formatTimestamp(secNum)}`, row);
          badgeBtn.className = 'kg-timeline-seg-badge';
          element('div', item.text || item.headline || '', row).className = 'kg-timeline-text';
          const playBtn = element('button', '▶ 跳播并开声', row);
          playBtn.type = 'button'; playBtn.className = 'kg-mini-btn ghost';
          playBtn.dataset.action = 'kg-timeline-seek-unmute';
          playBtn.dataset.seekSeconds = String(secNum);
          playBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            onSeek({ sectionId: secId, seconds: secNum, unmute: true });
          });
        });
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
  let kgActiveChatSessionId = null;
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
    try { aiGroup.scrollIntoView?.({ block: 'nearest' }); } catch { /* ignore */ }
    if (aiApiKey.value.trim()) aiModel.focus();
    else aiApiKey.focus();
  };

  const renderTextWithCitations = (container, text, sectionId, hostEl, onSeek, knownCitations = []) => {
    container.replaceChildren();
    const tokens = tokenizeTextWithCitations(text);
    const segIdx = getSectionSegmentIndex(sectionId);
    const knownBySeg = new Map();
    for (const c of (Array.isArray(knownCitations) ? knownCitations : [])) {
      if (c?.segId && !knownBySeg.has(c.segId)) knownBySeg.set(c.segId, c);
    }

    const mountInlineCite = cite => {
      const btn = element('button', '', container);
      btn.type = 'button';
      btn.dataset.citeStatus = cite.verified ? 'verified' : 'unverified';
      if (cite.verified) {
        btn.className = 'kg-inline-cite';
        btn.textContent = cite.displayId || `[${cite.segId}]`;
        if (cite.segId) btn.dataset.segId = cite.segId;
        if (cite.refKey) btn.dataset.refKey = cite.refKey;
        btn.dataset.seekSeconds = String(Math.floor(cite.seconds || 0));
        btn.title = `点击原地标黄并展开原字幕 ${cite.displayId || ''}（${cite.timestamp}）`;
      } else {
        btn.className = 'kg-inline-cite kg-cite-unverified';
        btn.textContent = `⚠ 未核实(${cite.rawRef || cite.displayId || '?'})`;
        if (cite.reasonCode) btn.dataset.reasonCode = cite.reasonCode;
        btn.title = '该引用未通过原字幕核验，点击查看核验详情';
      }
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        toggleInlineEvidence({
          hostEl: hostEl || container,
          triggerBtn: btn,
          citation: cite,
          sectionId: cite.sectionId || sectionId || 'current',
          segIdx,
          onSeek,
        });
      });
    };

    for (const tok of tokens) {
      if (tok.type === 'text') {
        container.append(document.createTextNode(tok.text));
      } else if (tok.type === 'segRef') {
        for (const ref of tok.refs) {
          const matchedKnown = knownBySeg.get(ref.segId);
          const verified = matchedKnown || verifyCitation({ segId: ref.raw, sectionId: ref.sectionId || sectionId }, segIdx);
          mountInlineCite(verified);
        }
      } else if (tok.type === 'timeRef') {
        const verified = verifyCitation({ time: tok.raw, sectionId }, segIdx);
        mountInlineCite(verified);
      }
    }
  };

  const hasAnyCourseSubtitleCandidate = () => {
    const raw = Array.isArray(kgLastResult?.courseData?.sections) ? kgLastResult.courseData.sections : [];
    if (!raw.length) return false;
    if ((kgLastResult?.courseData?.captionedSections || 0) > 0) return true;
    return raw.some(s => s.hasSubtitle === true || (!s.subtitleChecked && s.hasSubtitle !== false));
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
    const stored = loadSectionChat(win, courseId, sectionId, kgActiveChatSessionId);
    kgActiveChatSessionId = stored.activeSessionId;
    const messages = stored.messages || [];
    const sessions = stored.sessions || [];
    const curSession = stored.session || null;

    kgModal.qaTitle.textContent = `💬 问答 · 《${sectionTitle}》${focusedHasSub ? ` (${messages.length})` : ''}`;
    if (kgModal.qaSessionSelect) {
      kgModal.qaSessionSelect.replaceChildren();
      for (const s of sessions) {
        const prefix = s.kind === 'deepdive' ? '[深挖] ' : '';
        const opt = element('option', `${prefix}${s.title} (${s.messages?.length || 0})`, kgModal.qaSessionSelect);
        opt.value = s.id;
      }
      kgModal.qaSessionSelect.value = kgActiveChatSessionId;
      kgModal.qaSessionSelect.hidden = sessions.length <= 1 && curSession?.kind !== 'deepdive';
    }
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
        ? (curSession?.kind === 'deepdive'
          ? '独立错题深挖会话（确认预填内容后按回车或点发送）'
          : `针对《${sectionTitle}》提问（回车发送）`)
        : '需先配置 AI';
    kgModal.qaSendBtn.disabled = kgQaBusy || !hasKey || !focusedHasSub;
    kgModal.qaSendBtn.title = !focusedHasSub ? '本课无字幕，无法基于字幕提问' : '';
    kgModal.qaInput.disabled = kgQaBusy || !focusedHasSub;

    kgModal.qaThread.hidden = !kgQaExpanded;
    kgModal.qaThread.replaceChildren();
    if (kgQaExpanded) {
      const segIdx = getSectionSegmentIndex(sectionId);
      if (!messages.length) {
        const emptyHint = !focusedHasSub
          ? '本课无字幕，暂不可提问。'
          : hasKey
            ? (curSession?.kind === 'deepdive'
              ? `当前为全新独立错题深挖会话「${curSession.title}」（不会混入历史对话），确认下方预填提问后点击「发送」。`
              : '暂无对话，输入问题后 AI 将只引用本节字幕编号 [Sxx] 并支持原地展开核验。')
            : '需先配置 AI 后方可提问。';
        element('p', emptyHint, kgModal.qaThread).className = 'muted';
      } else {
        for (const msg of messages) {
          const bubble = element('div', '', kgModal.qaThread);
          bubble.className = 'kg-qa-msg';
          bubble.dataset.role = msg.role;
          if (msg.role === 'assistant') {
            const textDiv = element('div', '', bubble);
            renderTextWithCitations(textDiv, msg.content, sectionId, bubble, handleKgSeek, msg.citations || []);
            if (Array.isArray(msg.citations) && msg.citations.length) {
              const citeWrap = element('div', '', bubble); citeWrap.className = 'kg-qa-cites';
              for (const rawC of msg.citations) {
                const c = typeof rawC?.verified === 'boolean'
                  ? rawC
                  : verifyCitation(rawC, segIdx, { claimText: rawC?.note || '' });
                const chip = element('button', '', citeWrap);
                chip.type = 'button';
                chip.dataset.citeStatus = c.verified ? 'verified' : 'unverified';
                if (c.verified) {
                  const idLabel = c.segId ? `[${c.segId}]` : '';
                  chip.textContent = `依据 ${idLabel} ${c.timestamp}${c.note ? ` · ${c.note}` : ''}`.trim();
                  chip.className = 'kg-qa-cite';
                  if (c.segId) chip.dataset.segId = c.segId;
                  if (c.refKey) chip.dataset.refKey = c.refKey;
                  chip.dataset.seekSeconds = String(Math.floor(c.seconds || 0));
                  chip.title = '点击原地标黄并展开原字幕证据';
                } else {
                  chip.textContent = `⚠ 未核实 · ${shortUnverifiedTag(c.reasonCode)} (${c.rawRef || '?'})`;
                  chip.className = 'kg-qa-cite kg-cite-unverified';
                  if (c.reasonCode) chip.dataset.reasonCode = c.reasonCode;
                  chip.title = '该引用未通过原字幕查表校验，点击查看详情';
                }
                chip.addEventListener('click', ev => {
                  ev.stopPropagation();
                  toggleInlineEvidence({
                    hostEl: bubble,
                    triggerBtn: chip,
                    citation: c,
                    sectionId: c.sectionId || sectionId,
                    segIdx,
                    onSeek: handleKgSeek,
                  });
                });
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
    setKgBanner(`正在结合《${focused.title}》带编号字幕向 AI 提问…`, 'info');
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
        sessionId: kgActiveChatSessionId,
        settings: kg.getSettings(),
        gmRequest: deps.gmRequest,
        fetchFn: deps.fetchFn,
        signal: kgQaAbort?.signal,
      });
      if (!kgModal) return;
      if (res.ok) {
        if (res.sessionId) kgActiveChatSessionId = res.sessionId;
        kgModal.qaInput.value = '';
        const unverifiedCount = (res.message?.citations || []).filter(c => c && !c.verified).length;
        setKgBanner(unverifiedCount > 0
          ? `已回答，检测到 ${unverifiedCount} 条未通过原字幕核验的引用（已标为「未核实」，点击可查看核验详情）。`
          : (res.contextMeta?.truncated
            ? `已回答（超长课节按相关性选取 ${res.contextMeta.selectedSegments}/${res.contextMeta.totalSegments} 段字幕，点击引用可先原地核对原字幕再决定跳播）。`
            : '已回答，点击引用编号可先原地标黄展开原字幕，再决定是否跳播并开声。'), unverifiedCount > 0 ? 'warn' : 'info');
      } else {
        setKgBanner(res.error || 'AI 提问失败。', 'warn');
      }
    } finally {
      kgQaBusy = false;
      renderQaDock();
    }
  };

  const startWrongQuestionDeepDive = (question, chosenIndex, focusedSection) => {
    if (!kgModal || !question) return;
    const courseId = getCurrentCourseId();
    const sectionId = focusedSection?.sectionId || 'current';
    const segIdx = getSectionSegmentIndex(sectionId);
    const shortLabel = String(question.question || '').slice(0, 16);
    const created = createSectionChatSession(win, courseId, sectionId, {
      kind: 'deepdive',
      title: `深挖：${shortLabel}`,
      quizQuestionId: question.id || null,
    });
    kgActiveChatSessionId = created.sessionId;
    const prefill = buildWrongQuestionDeepDivePrompt({
      question,
      chosenIndex,
      section: focusedSection,
      segmentIndex: segIdx,
    });
    kgQaExpanded = true;
    renderQaDock();
    kgModal.qaInput.value = prefill;
    try { kgModal.qaInput.focus(); } catch { /* ignore */ }
    setKgBanner('已创建独立错题深挖会话（不复用旧对话）并预填题干、选项、正确答案、解析与原字幕依据，确认后按回车或点击「发送」开始深挖。', 'info');
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
      createCitationBtn(qHead, { item: q, sectionId, hostEl: qCard, onSeek: handleKgSeek });

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
          const fbRow = element('div', '', qCard); fbRow.className = 'kg-wrong-bar';
          const fb = element('p', gInfo.correct ? '✅ 回答正确' : `❌ 回答有误（正确答案：${q.answerLetter}）`, fbRow);
          fb.className = gInfo.correct ? 'muted' : 'status';
          if (!gInfo.correct) {
            const deepBtn = element('button', '🔍 深挖这道题', fbRow);
            deepBtn.type = 'button';
            deepBtn.className = 'kg-mini-btn soft';
            deepBtn.dataset.action = 'kg-quiz-deepdive';
            deepBtn.dataset.questionId = q.id;
            deepBtn.title = '新建独立深挖会话并预填本题题干、选项、解析与原字幕依据';
            deepBtn.addEventListener('click', () => startWrongQuestionDeepDive(q, gInfo.chosen, focused));
          }
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
        renderTextWithCitations(expText, `解析：${q.explanation}`, sectionId, expBody, handleKgSeek, q.citation ? [q.citation] : []);
      }
      if (q.citation || (Number.isFinite(q.seconds) && q.seconds >= 0)) {
        const jumpRow = element('div', '', expBody); jumpRow.className = 'row';
        const isVerified = q.citation ? q.citation.verified : true;
        element('small', isVerified ? `原字幕依据：${q.segId ? `[${q.segId}] ` : ''}${Number.isFinite(q.seconds) ? `约第 ${Math.floor(q.seconds / 60) + 1} 分钟` : ''}` : '原字幕依据：未通过核验', jumpRow).className = 'muted';
        createCitationBtn(jumpRow, { item: q, sectionId, hostEl: expBody, onSeek: handleKgSeek });
      }
    });

    if (!attempt.submitted) {
      const footer = element('div', '', container); footer.className = 'buttons';
      const submitBtn = element('button', '提交作答并判分', footer);
      submitBtn.type = 'button'; submitBtn.className = 'primary'; submitBtn.dataset.action = 'kg-quiz-submit';
      submitBtn.addEventListener('click', () => {
        const res = submitSectionQuizAttempt(win, courseId, sectionId, stored, answers);
        stored.attempt = res.attempt;
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
      const kgBadge = element('span', '本地摘要（未使用 AI）', titleWrap); kgBadge.className = 'kg-badge'; kgBadge.dataset.tone = 'local'; kgBadge.dataset.kgMode = '';
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
        kgActiveChatSessionId = null;
        await runKnowledge({ scope: 'section', sectionId: kgFocusSectionId, useAi: false, preferCacheOnOpen: true });
      });
      const triggerRow = element('div', '', headRow2); triggerRow.className = 'diag-actions';
      const secAiBtn = button('kg-ai-section', 'AI 解读本节', triggerRow, () => runKnowledge({ scope: 'section', sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }), false); secAiBtn.className = 'primary';
      const courseAiBtn = button('kg-ai-course', 'AI 解读全课', triggerRow, () => runKnowledge({ scope: 'course', sectionId: kgFocusSectionId, useAi: true, forceRefresh: false }), false);
      const quizAiBtn = button('kg-ai-quiz', '出题', triggerRow, () => runSectionQuiz({ forceRefresh: false }), false);
      const zeroBtn = button('kg-zero-ai', '本地摘要', triggerRow, () => runKnowledge({ scope: kgLastScope, sectionId: kgFocusSectionId, useAi: false, forceRefresh: false }), false); zeroBtn.className = 'ghost'; zeroBtn.title = '切换为本地字幕规则摘要（不消耗 AI token）';
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
      const qaTitleWrap = element('div', '', qaBar); qaTitleWrap.className = 'kg-qa-session-wrap';
      const qaTitle = element('strong', '💬 问答', qaTitleWrap); qaTitle.dataset.kgQaTitle = '';
      const qaSessionSelect = element('select', '', qaTitleWrap); qaSessionSelect.className = 'kg-qa-session-select'; qaSessionSelect.dataset.kgQaSession = ''; qaSessionSelect.setAttribute('aria-label', '选择问答会话'); qaSessionSelect.hidden = true;
      qaSessionSelect.addEventListener('change', () => {
        const sec = resolveFocusedSection();
        kgActiveChatSessionId = qaSessionSelect.value || null;
        switchSectionChatSession(win, getCurrentCourseId(), sec?.sectionId || 'current', kgActiveChatSessionId);
        renderQaDock();
      });
      const qaBarActions = element('div', '', qaBar); qaBarActions.className = 'diag-actions';
      const qaNewSessionBtn = button('kg-qa-new-session', '+ 新会话', qaBarActions, () => {
        const sec = resolveFocusedSection();
        const created = createSectionChatSession(win, getCurrentCourseId(), sec?.sectionId || 'current', { kind: 'general' });
        kgActiveChatSessionId = created.sessionId;
        kgQaExpanded = true;
        renderQaDock();
      }, false); qaNewSessionBtn.className = 'ghost';
      const qaToggleBtn = button('kg-qa-toggle', '对话 ▴', qaBarActions, () => { kgQaExpanded = !kgQaExpanded; renderQaDock(); }, false); qaToggleBtn.className = 'ghost';
      const qaClearBtn = button('kg-qa-clear', '清空', qaBarActions, () => {
        const sec = resolveFocusedSection();
        clearSectionChat(win, getCurrentCourseId(), sec?.sectionId || 'current', kgActiveChatSessionId);
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

      kgModal = { backdrop, kgTitle, kgBadge, kgScopeBadge, kgCacheBadge, zeroBtn, secAiBtn, courseAiBtn, quizAiBtn, regenBtn, abortBtn, secPickerWrap, secPicker, metaFold, metaSummary, estimateBar, banner, subDiagWrap, subDiagPre, tabButtons, fitBtn, quickPane, detailPane, quizPane, mapPane, svg, engineFoot, mdPane, mdPre, qaDock, qaTitle, qaSessionSelect, qaNewSessionBtn, qaToggleBtn, qaClearBtn, qaNoSub, qaNoAi, qaThread, qaInput, qaSendBtn };
    }
    kgFocusSectionId = targetSectionId || null;
    kgActiveChatSessionId = null;
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
        kgModal.kgBadge.textContent = 'AI 生成';
        kgModal.kgBadge.dataset.tone = 'ai';
      } else if (result.fallback) {
        kgModal.kgBadge.textContent = result.usedAi ? 'AI 生成 · 局部降级本地摘要' : '本地摘要 · AI 失败已回退';
        kgModal.kgBadge.dataset.tone = 'fallback';
      } else {
        kgModal.kgBadge.textContent = '本地摘要（未使用 AI）';
        kgModal.kgBadge.dataset.tone = 'local';
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
      const renderMeta = {
        usedAi: Boolean(result.usedAi),
        fallback: Boolean(result.fallback),
        noSubtitle: isViewNoSubtitle,
        failedSections: result.failedSections || result.tree?.failedSections || [],
      };
      renderKnowledgeQuick(kgModal.quickPane, result.tree, handleKgSeek, switchKgTab, renderMeta);
      renderKnowledgeDetail(kgModal.detailPane, result.tree, handleKgSeek, renderMeta);
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
  const hasRunHistory = state => Boolean(state.currentCourseId) || state.tasks.some(item => item.current || item.done.length || item.skipped.length || item.deferred?.length);
  const startQueue = async () => {
    if (starting) return;
    starting = true; render(controller.getState());
    const continuing = hasRunHistory(controller.getState());
    try {
      if (await saveWindow()) {
        if (continuing) await controller.start(null, 'panel-continue');
        else await controller.start();
      }
    }
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
        const retry = item ? button(`retry-${item.id}-${course.id}`, '重试', label, () => controller.retry(item.id, course.id, 'panel-retry')) : null;
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
    const hasStarted = hasRunHistory(state);
    const completedCount = state.tasks.filter(item => completeTask(item) && !(running && item.id === state.activeTaskId)).length;
    clearCompleted.textContent = `清除已完成（${completedCount}）`;
    clearCompleted.hidden = !completedCount;
    clearCompleted.disabled = !completedCount || state.unavailable || state.status === 'preparing' || state.phase === 'resuming';
    addButton.className = state.tasks.length === 0 ? 'primary' : '';
    addButton.title = running ? '暂停后可添加专区' : '';
    runButton.textContent = running ? '暂停' : state.status === 'complete' ? '已完成' : hasStarted ? '继续' : '开始';
    runButton.className = !running && state.status !== 'complete' ? 'primary' : '';
    runButton.disabled = starting || (!running && cannotStart); toggle.disabled = false;
    playGesture.hidden = !state.playGesture;
    playGesture.disabled = !state.playGesture;
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
  const panel = { open() { setOpen(true); }, destroy() { unsubscribeAiSettings(); kg.abortFetchModels?.(); kg.abortTestConnection?.(); sectionGuideEntries.destroy(); closeKnowledgeModal(); clearTimers(); unsubscribe(); host.remove(); } };
  host.wdPanel = panel; document.documentElement.append(host); render(controller.getState());
  return panel;
}
