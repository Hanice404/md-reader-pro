/**
 * MD Reader Pro — content script.
 *
 * Detects Markdown documents, takes over the page and mounts the reader UI.
 * Contract: docs/CONTRACT.md §5; owner: shell-dev.
 *
 * Design notes
 * ------------
 * - The script runs on every http(s)/file page, so detection is synchronous and
 *   cheap; settings are only read once a page actually needs the reader.
 * - Nothing is cleared until `mountReaderApp()` has succeeded, so a failing
 *   renderer never turns the page blank.
 * - Every user visible surface (hint pill, large-file prompt, error card, raw
 *   source view) is rendered with CSSOM styles so it cannot be broken by the
 *   host page's stylesheet and does not require inline `<style>` (MV3 CSP).
 */
import { loadSettings, onSettingsChanged, saveSettings } from '../shared/settings.js';
import { mountReaderApp } from '../ui/reader-app.js';
import { createTranslator, detectLanguage } from '../shared/i18n.js';
import { baseName, formatBytes } from '../shared/util.js';
import { contentStrings } from './strings.js';

const t = createTranslator(contentStrings, detectLanguage());

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/** Markdown file extensions accepted in URL paths (case-insensitive). */
const MD_EXT_RE = /\.(md|markdown|mdown|mkd|mdx)$/i;

/** MIME types that unambiguously mean "this document is Markdown". */
const MARKDOWN_TYPES = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/x-web-markdown',
  'application/markdown',
]);

/** Types that mean "Chrome is showing a web page" — never auto-render these. */
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

const PDF_TYPES = new Set(['application/pdf']);

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

/** Documents above this size ask for confirmation before rendering. */
const MAX_AUTO_BYTES = 8 * 1024 * 1024;

/** Live reload interval (http/https only, opt-in). */
const LIVE_RELOAD_INTERVAL = 2000;

/** Sample size used by the plain-text Markdown heuristic. */
const SIGNAL_SAMPLE_BYTES = 200_000;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let app = null;
let mounted = false;
let rendering = false;
let currentMarkdown = '';
let currentInfo = null;
let currentSettings = null;
let originalTitle = '';

let hintEl = null;
let settingsBound = false;
let persistLock = 0;
let largeConfirmed = false;

let liveTimer = 0;
let liveBusy = false;
let sourceEtag = '';
let sourceLastModified = '';

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function hasExtensionApis() {
  try {
    return Boolean(globalThis.chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function isTopFrame() {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function contentType() {
  const raw = String(document.contentType || '').toLowerCase();
  return raw.split(';')[0].trim();
}

function urlPath(href) {
  try {
    return new URL(href).pathname || '/';
  } catch {
    return String(href || '').split(/[?#]/)[0];
  }
}

function isHttpUrl() {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

function isTextLikeType(type) {
  return (
    !type ||
    type.startsWith('text/') ||
    type === 'application/octet-stream' ||
    type === 'application/markdown' ||
    type === 'application/x-markdown'
  );
}

function byteSize(text) {
  try {
    return new Blob([String(text ?? '')]).size;
  } catch {
    return String(text ?? '').length * 2;
  }
}

/**
 * True for URL shapes that serve a single raw file rather than a web page.
 * Only paths with a Markdown extension or without any extension qualify, so a
 * raw `package.json` / `.py` keeps the normal plain-text treatment.
 */
function isRawMarkdownUrl(path) {
  const host = String(location.hostname || '').toLowerCase();
  if (!host) return false;
  const lastSegment = String(path).split('/').filter(Boolean).pop() || '';
  const hasExtension = /\.[a-z0-9]{1,10}$/i.test(lastSegment);
  const mdPath = MD_EXT_RE.test(path);

  const isRawHost =
    host === 'raw.githubusercontent.com' ||
    host === 'gist.githubusercontent.com' ||
    host === 'raw.gitlab.com' ||
    host === 'gist.gitlab.com' ||
    host.endsWith('.githubusercontent.com') ||
    (host === 'github.com' && /^\/[^/]+\/[^/]+\/raw\//.test(path)) ||
    ((host === 'gitlab.com' || host.endsWith('.gitlab.com')) && /\/-\/raw\//.test(path)) ||
    ((host === 'gitee.com' || host.endsWith('.gitee.com')) && /\/raw\//.test(path)) ||
    (host === 'bitbucket.org' && /\/raw\//.test(path)) ||
    (host === 'codeberg.org' && /\/raw\//.test(path));

  return isRawHost && (mdPath || !hasExtension);
}

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

/**
 * Classify the current document without touching the network or storage.
 *
 * mode:
 *   auto — render immediately (Markdown MIME or Markdown-looking URL)
 *   hint — text/plain page that may be Markdown; a hint pill is offered
 *   none — never auto-render (HTML, PDF, unsupported scheme…)
 */
function classifyPage() {
  const type = contentType();
  const path = urlPath(location.href);
  const base = {
    type,
    path,
    isHtml: false,
    canRenderManually: false,
    mode: 'none',
    reason: 'unsupported',
  };

  if (!SUPPORTED_PROTOCOLS.has(location.protocol)) {
    return { ...base, reason: 'unsupported-scheme' };
  }
  if (PDF_TYPES.has(type) || /\.pdf$/i.test(path)) {
    return { ...base, reason: 'pdf' };
  }
  if (HTML_TYPES.has(type)) {
    // A real web page: never auto-render, even when the path ends in `.md`.
    return { ...base, isHtml: true, canRenderManually: true, reason: 'html-page' };
  }

  const markdownType = MARKDOWN_TYPES.has(type);
  const markdownUrl = MD_EXT_RE.test(path) || isRawMarkdownUrl(path);
  const textLike = isTextLikeType(type);

  if (markdownType) {
    return { ...base, mode: 'auto', canRenderManually: true, reason: 'markdown-mime' };
  }
  if (markdownUrl && textLike) {
    return { ...base, mode: 'auto', canRenderManually: true, reason: 'markdown-url' };
  }
  if (type === 'text/plain' || type === '') {
    return { ...base, mode: 'hint', canRenderManually: true, reason: 'plain-text' };
  }
  return { ...base, canRenderManually: textLike, reason: 'unsupported-content-type' };
}

/** Apply the user's `autoRender` preference on top of the static detection. */
function decidePage(settings) {
  const info = classifyPage();
  if (info.mode === 'auto' && settings?.autoRender === false) {
    return { ...info, mode: 'hint', reason: 'auto-disabled' };
  }
  return info;
}

/**
 * Count distinct Markdown signal categories in a plain-text document.
 * Contract §5 requires at least two before the hint pill is shown.
 */
const SIGNAL_PATTERNS = [
  // Headings: ATX (`# Title`) or setext (`Title` + `===` / `---` underline).
  /^#{1,6}[ \t]+\S/m,
  /^[^\n]{1,120}\r?\n(?:=+|-{3,})[ \t]*\r?$/m,
  // Tables.
  /^[ \t]*\|[^\n]*\|[ \t]*$/m,
  // Fenced code blocks.
  /^[ \t]{0,3}(?:```|~~~)/m,
  // Task list items.
  /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+\S/m,
  // Inline links / images.
  /!?\[[^\]\n]{1,200}\]\([^()\s]{1,500}(?:[ \t]+"[^"\n]*")?\)/,
  // YAML front matter.
  /^---[ \t]*\r?\n[\s\S]{0,5000}?\r?\n---[ \t]*(?:\r?\n|$)/,
];
const SIGNAL_GROUP = [0, 0, 1, 2, 3, 4, 5];

function markdownSignalStats(text) {
  const sample = String(text || '').slice(0, SIGNAL_SAMPLE_BYTES);
  if (sample.trim().length < 20) return { count: 0, signals: [] };
  const seen = new Set();
  const signals = [];
  for (let index = 0; index < SIGNAL_PATTERNS.length; index += 1) {
    if (!SIGNAL_PATTERNS[index].test(sample)) continue;
    const group = SIGNAL_GROUP[index];
    if (seen.has(group)) continue;
    seen.add(group);
    signals.push(['heading', 'table', 'fence', 'task', 'link', 'frontmatter'][group]);
  }
  return { count: signals.length, signals };
}

function markdownSignalCount(text) {
  return markdownSignalStats(text).count;
}

/* ------------------------------------------------------------------ *
 * Text acquisition
 * ------------------------------------------------------------------ */

/**
 * Extract text from a single dominant `<pre>` block (how Chrome renders
 * text/plain documents). Returns '' when the page is a normal HTML document
 * with many incidental code blocks.
 */
function readPreText() {
  const body = document.body;
  if (!body) return '';
  const pres = body.querySelectorAll('pre');
  if (!pres.length) return '';
  if (pres.length === 1) return pres[0].textContent || '';
  const preText = Array.from(pres, (pre) => pre.textContent || '').join('\n');
  const bodyText = body.innerText || '';
  return preText.length >= bodyText.length * 0.9 ? preText : '';
}

function readBodyText() {
  const body = document.body;
  if (!body) return '';
  const text = body.innerText;
  if (typeof text === 'string' && text.trim()) return text;
  return body.textContent || '';
}

/**
 * Fetch the document at `location.href` as text. Only used for http(s) pages
 * that are not HTML — a page's own HTML source must never be rendered as
 * Markdown.
 */
async function fetchSource({ conditional = false } = {}) {
  if (!isHttpUrl()) return null;
  const headers = {};
  if (conditional && sourceEtag) headers['If-None-Match'] = sourceEtag;
  if (conditional && sourceLastModified) headers['If-Modified-Since'] = sourceLastModified;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 20_000) : 0;
  try {
    const response = await fetch(location.href, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'follow',
      headers,
      signal: controller?.signal,
    });
    if (response.status === 304) return { text: null, notModified: true };
    if (!response.ok) return null;
    const type = String(response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type && HTML_TYPES.has(type)) return null;
    if (type && !isTextLikeType(type)) return null;
    const text = await response.text();
    return {
      text,
      notModified: false,
      etag: response.headers.get('etag') || '',
      lastModified: response.headers.get('last-modified') || '',
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Priority: dominant `<pre>` textContent → fetch(location.href) → body.innerText.
 * HTML pages (forced renders) skip the network entirely and read visible text.
 */
async function acquireText(info) {
  if (!info?.isHtml) {
    const pre = readPreText();
    if (pre.trim().length >= 20) return { text: pre, via: 'pre' };
    const fetched = await fetchSource();
    if (fetched?.text && fetched.text.trim()) {
      return {
        text: fetched.text,
        via: 'fetch',
        etag: fetched.etag || '',
        lastModified: fetched.lastModified || '',
      };
    }
  }
  return { text: readBodyText(), via: 'innerText' };
}

/* ------------------------------------------------------------------ *
 * View helpers (all styling is inline so the host page cannot break them)
 * ------------------------------------------------------------------ */

function makeElement(tag, { className, text, attrs, styles } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null) continue;
    node.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(styles || {})) {
    node.style.setProperty(name, String(value), 'important');
  }
  return node;
}

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

function overlayRoot(id) {
  return makeElement('div', {
    attrs: { id },
    styles: {
      position: 'fixed',
      'z-index': '2147483647',
      'box-sizing': 'border-box',
      font: `14px/1.55 ${FONT_STACK}`,
      color: '#111827',
    },
  });
}

function buttonStyle(primary) {
  return {
    display: 'inline-flex',
    'align-items': 'center',
    'justify-content': 'center',
    gap: '6px',
    'min-height': '32px',
    padding: '0 14px',
    border: `1px solid ${primary ? '#4f46e5' : 'rgba(17,24,39,0.18)'}`,
    'border-radius': '8px',
    background: primary ? '#4f46e5' : '#fff',
    color: primary ? '#fff' : '#111827',
    font: `600 13px/1 ${FONT_STACK}`,
    cursor: 'pointer',
  };
}

/* ------------------------------------------------------------------ *
 * Hint pill
 * ------------------------------------------------------------------ */

function removeHint() {
  if (!hintEl) return;
  if (hintEl._mdEsc) document.removeEventListener('keydown', hintEl._mdEsc, true);
  hintEl.remove();
  hintEl = null;
}

function showHint({ label, title } = {}) {
  if (hintEl || mounted || !document.body) return;
  const text = label || t('hintLabel');
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'md-reader-hint';
  button.className = 'md-hint';
  button.setAttribute('aria-label', text);
  if (title) button.title = title;

  const logo = document.createElement('span');
  logo.className = 'md-hint-logo';
  logo.setAttribute('aria-hidden', 'true');
  logo.textContent = 'M↓';
  const labelEl = document.createElement('span');
  labelEl.textContent = text;
  button.append(logo, labelEl);

  button.addEventListener('click', () => {
    removeHint();
    startRender({ forced: true, trigger: 'hint' });
  });

  const onEscape = (event) => {
    if (event.key === 'Escape') removeHint();
  };
  document.addEventListener('keydown', onEscape, true);
  button._mdEsc = onEscape;

  document.body.append(button);
  hintEl = button;

  // `reader.css` normally styles `.md-hint`; if it is missing (or the page
  // strips it), apply a self-contained fallback.
  requestAnimationFrame(() => {
    if (!hintEl || hintEl !== button) return;
    try {
      if (getComputedStyle(button).position !== 'static') return;
    } catch {
      /* ignore */
    }
    const fallback = {
      position: 'fixed',
      right: '22px',
      bottom: '22px',
      'z-index': '2147483000',
      display: 'inline-flex',
      'align-items': 'center',
      gap: '9px',
      padding: '10px 16px 10px 12px',
      border: '1px solid rgba(255,255,255,0.16)',
      'border-radius': '999px',
      background: 'linear-gradient(145deg,#4f46e5,#7c3aed)',
      color: '#fff',
      font: `600 13px/1.5 ${FONT_STACK}`,
      'box-shadow': '0 12px 30px rgba(79,70,229,0.38)',
      cursor: 'pointer',
    };
    for (const [name, value] of Object.entries(fallback)) {
      button.style.setProperty(name, value, 'important');
    }
    for (const [name, value] of Object.entries({
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      width: '24px',
      height: '24px',
      'border-radius': '7px',
      background: 'rgba(255,255,255,0.18)',
      'font-size': '11px',
      'font-weight': '800',
      'line-height': '1',
    })) {
      logo.style.setProperty(name, value, 'important');
    }
  });
}

function maybeShowHint(info) {
  if (!info || mounted || rendering) return;
  if (info.reason === 'auto-disabled') {
    showHint({ title: t('hintTitle') });
    return;
  }
  if (info.reason !== 'plain-text' || !currentSettings?.plainTextHint) return;
  const text = readPreText() || readBodyText();
  if (markdownSignalCount(text) < 2) return;
  showHint({ title: t('hintTitle') });
}

/* ------------------------------------------------------------------ *
 * Large-document confirmation
 * ------------------------------------------------------------------ */

function removeLargePrompt() {
  document.getElementById('md-reader-large')?.remove();
}

function askToRenderLarge(size) {
  return new Promise((resolve) => {
    if (!document.body) {
      resolve(true);
      return;
    }
    removeLargePrompt();
    const box = overlayRoot('md-reader-large');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', t('largeTitle'));
    for (const [name, value] of Object.entries({
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      width: 'min(440px, calc(100vw - 32px))',
      padding: '16px 18px',
      'border-radius': '12px',
      background: '#111827',
      color: '#f9fafb',
      'box-shadow': '0 18px 48px rgba(0,0,0,0.35)',
    })) {
      box.style.setProperty(name, value, 'important');
    }

    const title = makeElement('div', {
      text: t('largeTitle'),
      styles: { font: `700 14px/1.4 ${FONT_STACK}`, 'margin-bottom': '4px' },
    });
    const message = makeElement('div', {
      text: t('largeMessage', { size: formatBytes(size) }),
      styles: { font: `13px/1.5 ${FONT_STACK}`, color: 'rgba(249,250,251,0.82)' },
    });
    const actions = makeElement('div', {
      styles: {
        display: 'flex',
        gap: '8px',
        'justify-content': 'flex-end',
        'margin-top': '12px',
        'flex-wrap': 'wrap',
      },
    });
    const cancel = makeElement('button', {
      text: t('largeCancel'),
      attrs: { type: 'button' },
      styles: {
        ...buttonStyle(false),
        background: 'transparent',
        color: '#e5e7eb',
        'border-color': 'rgba(255,255,255,0.24)',
      },
    });
    const proceed = makeElement('button', {
      text: t('largeContinue'),
      attrs: { type: 'button' },
      styles: buttonStyle(true),
    });
    actions.append(cancel, proceed);
    box.append(title, message, actions);

    const finish = (value) => {
      document.removeEventListener('keydown', onKey, true);
      box.remove();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };
    cancel.addEventListener('click', () => finish(false));
    proceed.addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKey, true);
    document.body.append(box);
    proceed.focus();
  });
}

/* ------------------------------------------------------------------ *
 * Error card + source overlay
 * ------------------------------------------------------------------ */

function removeError() {
  document.getElementById('md-reader-error')?.remove();
}

function showError(message, { markdown = '', retry = null } = {}) {
  if (!document.body) return;
  removeError();
  const box = overlayRoot('md-reader-error');
  box.setAttribute('role', 'alert');
  for (const [name, value] of Object.entries({
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    width: 'min(520px, calc(100vw - 32px))',
    padding: '14px 16px',
    'border-radius': '12px',
    background: '#fff',
    border: '1px solid rgba(17,24,39,0.12)',
    'border-left': '4px solid #dc2626',
    'box-shadow': '0 18px 48px rgba(0,0,0,0.22)',
  })) {
    box.style.setProperty(name, value, 'important');
  }

  const head = makeElement('div', {
    styles: {
      display: 'flex',
      'align-items': 'flex-start',
      gap: '10px',
      'justify-content': 'space-between',
    },
  });
  const title = makeElement('div', {
    text: t('errorTitle'),
    styles: { font: `700 14px/1.4 ${FONT_STACK}` },
  });
  const close = makeElement('button', {
    text: '×',
    attrs: { type: 'button', 'aria-label': t('close'), title: t('close') },
    styles: {
      border: '0',
      background: 'transparent',
      color: '#6b7280',
      font: `20px/1 ${FONT_STACK}`,
      cursor: 'pointer',
      padding: '0 2px',
      'margin-top': '-2px',
    },
  });
  head.append(title, close);

  const body = makeElement('div', {
    text: message,
    styles: {
      font: `13px/1.55 ${FONT_STACK}`,
      color: '#374151',
      'margin-top': '4px',
      'word-break': 'break-word',
    },
  });
  box.append(head, body);

  const actions = makeElement('div', {
    styles: {
      display: 'flex',
      gap: '8px',
      'justify-content': 'flex-end',
      'margin-top': '12px',
      'flex-wrap': 'wrap',
    },
  });
  if (markdown) {
    const source = makeElement('button', {
      text: t('viewSource'),
      attrs: { type: 'button' },
      styles: buttonStyle(false),
    });
    source.addEventListener('click', () => {
      showSourceOverlay(markdown);
    });
    actions.append(source);
  }
  if (typeof retry === 'function') {
    const retryButton = makeElement('button', {
      text: t('retry'),
      attrs: { type: 'button' },
      styles: buttonStyle(true),
    });
    retryButton.addEventListener('click', () => {
      removeError();
      retry();
    });
    actions.append(retryButton);
  }
  if (actions.childElementCount) box.append(actions);

  close.addEventListener('click', () => box.remove());
  document.body.append(box);
}

function removeSourceOverlay() {
  const overlay = document.getElementById('md-reader-source');
  if (!overlay) return;
  overlay.remove();
  if (overlay._mdEsc) document.removeEventListener('keydown', overlay._mdEsc, true);
  if (overlay._mdOverflow) {
    document.documentElement.style.setProperty('overflow', overlay._mdOverflow, 'important');
  } else {
    document.documentElement.style.removeProperty('overflow');
  }
  const returnFocus = overlay._mdReturnFocus;
  if (returnFocus && typeof returnFocus.focus === 'function' && returnFocus.isConnected) {
    try {
      returnFocus.focus();
    } catch {
      /* ignore */
    }
  }
}

function showSourceOverlay(markdown) {
  if (!document.body || !markdown) return;
  removeSourceOverlay();

  const previousOverflow =
    document.documentElement.style.getPropertyValue('overflow') || '';
  const returnFocus = document.activeElement;
  const overlay = overlayRoot('md-reader-source');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('sourceTitle'));
  for (const [name, value] of Object.entries({
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    display: 'flex',
    'flex-direction': 'column',
    background: '#fff',
    font: `14px/1.55 ${FONT_STACK}`,
  })) {
    overlay.style.setProperty(name, value, 'important');
  }

  const bar = makeElement('div', {
    styles: {
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      gap: '12px',
      padding: '10px 16px',
      border: '1px solid rgba(17,24,39,0.12)',
      'border-width': '0 0 1px 0',
      background: '#f9fafb',
    },
  });
  const title = makeElement('div', {
    text: t('sourceTitle'),
    styles: { font: `700 13px/1.4 ${FONT_STACK}` },
  });
  const close = makeElement('button', {
    text: t('backToReader'),
    attrs: { type: 'button' },
    styles: buttonStyle(false),
  });
  bar.append(title, close);

  const pre = makeElement('pre', {
    styles: {
      margin: '0',
      padding: '16px 20px 32px',
      flex: '1',
      'overflow': 'auto',
      'white-space': 'pre-wrap',
      'word-break': 'break-word',
      font: `13px/1.6 ${MONO_STACK}`,
      color: '#111827',
      background: '#fff',
      'tab-size': '4',
    },
  });
  pre.textContent = markdown;
  overlay.append(bar, pre);

  const closeAll = () => removeSourceOverlay();
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAll();
    }
  };
  close.addEventListener('click', closeAll);
  overlay._mdEsc = onKey;
  overlay._mdOverflow = previousOverflow;
  overlay._mdReturnFocus = returnFocus;
  document.addEventListener('keydown', onKey, true);
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  document.body.append(overlay);
  close.focus();
}

/* ------------------------------------------------------------------ *
 * Raw text fallback
 * ------------------------------------------------------------------ */

/** Replace the page with a readable `<pre>` of the Markdown source. */
function restoreRawText(markdown, info) {
  if (!document.body) return;
  removeSourceOverlay();
  const pre = makeElement('pre', {
    attrs: { id: 'md-reader-fallback', 'aria-label': t('rawFallbackNotice') },
    styles: {
      margin: '0',
      padding: '18px 20px 40px',
      'white-space': 'pre-wrap',
      'word-break': 'break-word',
      font: `13px/1.65 ${MONO_STACK}`,
      color: '#111827',
      background: '#fff',
      'min-height': '100vh',
      'box-sizing': 'border-box',
    },
  });
  pre.textContent = markdown;
  delete document.documentElement.dataset.mdReader;
  document.body.replaceChildren(pre);
  document.body.className = '';
  document.body.removeAttribute('style');
  if (originalTitle) document.title = originalTitle;
  if (info) currentInfo = info;
}

/** Ensure the page still shows readable text (used when mounting fails). */
function ensureReadableFallback(markdown, info) {
  const visible = (document.body?.innerText || '').trim();
  if (visible.length >= 20) return false;
  restoreRawText(markdown, info);
  return true;
}

/* ------------------------------------------------------------------ *
 * Renderer / mount
 * ------------------------------------------------------------------ */

async function createRenderer(settings) {
  const url = globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL('renderer.js')
    : './renderer.js';
  const mod = await import(url);
  if (typeof mod.createRenderer !== 'function') {
    throw new Error('renderer module does not export createRenderer');
  }
  return mod.createRenderer({
    html: settings.rawHtml,
    rawHtml: settings.rawHtml,
    math: settings.math,
    mermaid: settings.mermaid,
    emoji: settings.emoji,
    frontMatter: settings.frontMatter,
    highlight: true,
  });
}

function updateTitleFromApp() {
  const appTitle = (app?.el?.querySelector('.md-doc-title')?.textContent || '').trim();
  if (!appTitle) return;
  const suffix = 'MD Reader Pro';
  if (document.title.includes(suffix)) return;
  document.title = `${appTitle} · ${suffix}`;
}

function buildSource(info) {
  const file = location.protocol === 'file:';
  let path = '';
  try {
    path = decodeURIComponent(new URL(location.href).pathname);
  } catch {
    path = info.path;
  }
  return {
    url: location.href,
    path: file ? path : undefined,
    title: originalTitle || baseName(location.href, 'Markdown'),
    kind: file ? 'file' : 'url',
  };
}

function applyLiveReload() {
  stopLiveReload();
  const enabled =
    mounted && Boolean(currentSettings?.liveReload) && isHttpUrl() && !document.hidden;
  if (!enabled) {
    if (mounted && currentSettings?.liveReload && isHttpUrl()) {
      // Hidden tab: watch for visibility so polling resumes when it is shown.
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return;
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  liveTimer = setInterval(pollSource, LIVE_RELOAD_INTERVAL);
}

function onVisibilityChange() {
  if (document.hidden) return;
  if (mounted && currentSettings?.liveReload && isHttpUrl() && !liveTimer) {
    pollSource();
    liveTimer = setInterval(pollSource, LIVE_RELOAD_INTERVAL);
  }
}

function stopLiveReload() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = 0;
  liveBusy = false;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

async function pollSource() {
  if (!mounted || liveBusy || document.hidden) return;
  if (byteSize(currentMarkdown) > MAX_AUTO_BYTES) return;
  liveBusy = true;
  try {
    const result = await fetchSource({ conditional: true });
    if (!result || result.notModified) return;
    if (typeof result.text !== 'string') return;
    if (result.etag) sourceEtag = result.etag;
    if (result.lastModified) sourceLastModified = result.lastModified;
    if (result.text === currentMarkdown) return;
    currentMarkdown = result.text;
    try {
      app?.setMarkdown(result.text);
    } catch (error) {
      console.warn('[MD Reader Pro] live reload failed to render', error);
      showError(t('errorUpdate'), { markdown: currentMarkdown });
      return;
    }
    updateTitleFromApp();
  } catch {
    /* transient network errors are ignored; the next tick retries */
  } finally {
    liveBusy = false;
  }
}

async function reloadSource() {
  if (!mounted) return { ok: false, reason: 'not-mounted' };
  if (!isHttpUrl() || currentInfo?.isHtml) {
    location.reload();
    return { ok: true, reloading: true };
  }
  const fetched = await fetchSource();
  if (!fetched || typeof fetched.text !== 'string') {
    return { ok: false, reason: 'fetch-failed' };
  }
  if (fetched.etag) sourceEtag = fetched.etag;
  if (fetched.lastModified) sourceLastModified = fetched.lastModified;
  if (fetched.text === currentMarkdown) return { ok: true, changed: false };
  currentMarkdown = fetched.text;
  try {
    app?.setMarkdown(fetched.text);
  } catch (error) {
    console.warn('[MD Reader Pro] refresh failed to render', error);
    showError(t('errorUpdate'), { markdown: currentMarkdown });
    return { ok: false, reason: 'render-failed' };
  }
  updateTitleFromApp();
  return { ok: true, changed: true };
}

let renderingPromise = null;

/**
 * Render the current document into the reader UI.
 *
 * @param {{ forced?: boolean, trigger?: string }} options
 */
async function startRender({ forced = false, trigger = 'auto' } = {}) {
  if (mounted) {
    if (forced) return { ...(await reloadSource()), ok: true, alreadyMounted: true };
    return { ok: true, alreadyMounted: true };
  }
  // A render may already be in flight (auto-render racing with a manual render
  // injected by the background worker). Wait for it instead of failing.
  if (renderingPromise) {
    await renderingPromise.catch(() => {});
    if (mounted) return { ok: true, alreadyMounted: true };
    return { ok: false, reason: 'busy' };
  }

  rendering = true;
  const task = performRender({ forced, trigger });
  renderingPromise = task;
  try {
    return await task;
  } finally {
    if (renderingPromise === task) renderingPromise = null;
    rendering = false;
  }
}

async function performRender({ forced = false, trigger = 'auto' } = {}) {
  if (!document.body) return { ok: false, reason: 'no-body' };

  const info = classifyPage();
  if (!forced && info.mode !== 'auto') return { ok: false, reason: info.reason };
  if (forced && !info.canRenderManually) {
    if (info.reason !== 'pdf') showError(t('errorEmpty'));
    return { ok: false, reason: info.reason };
  }

  const settings = await ensureSettings();
  if (!forced && settings.autoRender === false) {
    showHint({ title: t('hintTitle') });
    return { ok: false, reason: 'auto-disabled' };
  }
  removeHint();

  const acquired = await acquireText(info);
  const markdown = String(acquired.text || '');
  if (!markdown.trim()) {
    if (forced) showError(t('errorEmpty'));
    return { ok: false, reason: 'empty' };
  }

  const bytes = byteSize(markdown);
  if (bytes > MAX_AUTO_BYTES && !largeConfirmed) {
    const proceed = await askToRenderLarge(bytes);
    if (!proceed) {
      removeHint();
      showHint({ label: t('hintLarge'), title: t('hintTitle') });
      return { ok: false, reason: 'too-large' };
    }
    largeConfirmed = true;
  }

  let renderer;
  try {
    renderer = await createRenderer(settings);
  } catch (error) {
    console.warn('[MD Reader Pro] renderer failed to load', error);
    ensureReadableFallback(markdown, info);
    removeError();
    showError(t('errorLoad'), {
      markdown,
      retry: () => startRender({ forced: true, trigger: 'retry' }),
    });
    return { ok: false, reason: 'renderer-load-failed', error: String(error?.message || error) };
  }

  // Mount into a temporary host while the original page is still intact, so
  // a failure cannot leave the reader looking at a blank document.
  const host = document.createElement('div');
  host.id = 'md-reader-root';
  host.className = 'md-reader-root';
  document.body.append(host);

  let instance;
  try {
    instance = await mountReaderApp({
      container: host,
      markdown,
      renderer,
      settings,
      source: buildSource(info),
      capabilities: { raw: true, print: true, liveReload: isHttpUrl() },
      callbacks: {
        onSettingsChange: handleAppSettingsChange,
        onReload: reloadSource,
      },
    });
  } catch (error) {
    host.remove();
    console.warn('[MD Reader Pro] mount failed', error);
    ensureReadableFallback(markdown, info);
    removeError();
    showError(t('errorMount'), {
      markdown,
      retry: () => startRender({ forced: true, trigger: 'retry' }),
    });
    return { ok: false, reason: 'mount-failed', error: String(error?.message || error) };
  }

  app = instance;
  mounted = true;
  currentMarkdown = markdown;
  currentInfo = info;
  sourceEtag = acquired.etag || sourceEtag;
  sourceLastModified = acquired.lastModified || sourceLastModified;

  document.documentElement.dataset.mdReader = 'page';
  document.body.replaceChildren(host);
  document.body.className = '';
  document.body.removeAttribute('style');
  removeHint();
  removeError();
  updateTitleFromApp();
  applyLiveReload();

  return {
    ok: true,
    mounted: true,
    mode: info.mode,
    reason: info.reason,
    trigger,
    via: acquired.via,
    bytes,
  };
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

async function ensureSettings() {
  if (!currentSettings) currentSettings = await loadSettings();
  if (!settingsBound) {
    settingsBound = true;
    onSettingsChanged(handleExternalSettings);
  }
  return currentSettings;
}

/** UI toolbars persist their own changes through this callback. */
async function handleAppSettingsChange(patch) {
  if (persistLock > 0) return { ...(currentSettings || {}) };
  currentSettings = await saveSettings(patch);
  applyLiveReload();
  return currentSettings;
}

/** Settings changed from another surface (options page, popup…). */
function handleExternalSettings(next) {
  currentSettings = next;
  if (mounted && app) {
    persistLock += 1;
    try {
      app.setSettings(next);
    } catch (error) {
      console.warn('[MD Reader Pro] could not apply settings', error);
    } finally {
      persistLock -= 1;
    }
  }
  applyLiveReload();
  if (!mounted && !rendering) refreshHint();
}

function refreshHint() {
  if (!currentSettings) return removeHint();
  const decision = decidePage(currentSettings);
  if (decision.mode !== 'hint') {
    removeHint();
    return;
  }
  if (decision.reason === 'auto-disabled') {
    showHint({ title: t('hintTitle') });
    return;
  }
  if (!currentSettings.plainTextHint) {
    removeHint();
    return;
  }
  maybeShowHint(decision);
}

/* ------------------------------------------------------------------ *
 * State + messaging
 * ------------------------------------------------------------------ */

function getState() {
  const info = currentInfo && mounted ? currentInfo : classifyPage();
  let signalCount = 0;
  if (!mounted && info.reason === 'plain-text') {
    signalCount = markdownSignalCount(readPreText() || readBodyText());
  }
  const isMarkdown =
    mounted ||
    info.mode === 'auto' ||
    (info.reason === 'plain-text' && signalCount >= 2);
  return {
    mounted,
    isMarkdown,
    supported: info.canRenderManually !== false,
    mode: info.mode,
    reason: info.reason,
    contentType: contentType(),
    url: location.href,
    title: document.title,
    hint: Boolean(hintEl?.isConnected),
    signals: signalCount,
    bytes: currentMarkdown ? byteSize(currentMarkdown) : 0,
    liveReload: Boolean(liveTimer),
  };
}

function handleMessage(message, _sender, sendResponse) {
  if (!message || typeof message !== 'object') return undefined;

  if (message.type === 'render-current') {
    startRender({ forced: true, trigger: message.trigger || 'message' })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, reason: 'error', error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'get-state') {
    sendResponse(getState());
    return undefined;
  }

  if (message.type === 'toggle-raw') {
    const button = document.querySelector('.md-app [data-md-action="raw"]');
    if (!mounted || !button) {
      sendResponse({ ok: false, reason: mounted ? 'no-raw-view' : 'not-mounted' });
      return undefined;
    }
    button.click();
    const rawView = document.querySelector('.md-app .md-raw');
    sendResponse({ ok: true, raw: rawView ? !rawView.hidden : null });
    return undefined;
  }

  if (message.type === 'ping') {
    sendResponse({ ok: true, mounted });
    return undefined;
  }

  return undefined;
}

function bindMessages() {
  try {
    chrome.runtime.onMessage.addListener(handleMessage);
  } catch {
    /* extension context invalidated */
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  // Expose a tiny probe API for the background service worker (same isolated
  // world, never reachable from the page itself).
  window.__mdReaderState = () => {
    try {
      return getState();
    } catch {
      return { mounted: false, supported: false, reason: 'error' };
    }
  };
  window.__mdReaderRender = (options) =>
    startRender({ forced: true, trigger: 'api', ...(options || {}) });

  const info = classifyPage();
  if (info.mode === 'none' && !info.canRenderManually) return; // PDF / unsupported scheme

  originalTitle = document.title || '';
  currentInfo = info;
  bindMessages();

  // Normal web pages are left completely alone until the user explicitly asks
  // for the reader (popup, context menu or keyboard shortcut).
  if (info.mode === 'none') return;

  await ensureSettings();
  const decision = decidePage(currentSettings);
  if (decision.mode === 'auto') {
    await startRender({ trigger: 'auto' });
  } else {
    maybeShowHint(decision);
  }
}

if (isTopFrame() && hasExtensionApis() && !window.__mdReaderShellLoaded) {
  window.__mdReaderShellLoaded = true;
  window.addEventListener('pagehide', stopLiveReload, { once: true });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) applyLiveReload();
  });
  boot().catch((error) => {
    console.warn('[MD Reader Pro] content script failed', error);
  });
}
