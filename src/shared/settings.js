/**
 * Shared settings schema and storage helpers.
 *
 * These defaults are the single source of truth for every surface:
 * content script, reader UI, popup and options page.
 */

export const SETTINGS_KEY = 'mdReaderSettings';
export const SETTINGS_STORAGE_AREA = 'sync';

export const DEFAULT_SETTINGS = Object.freeze({
  /** auto | light | dark | sepia */
  theme: 'auto',
  /** Base reading font size in px (13 - 22). */
  fontSize: 16,
  /** Line height multiplier (1.4 - 2.2). */
  lineHeight: 1.75,
  /** normal | wide | full */
  contentWidth: 'normal',
  /** sans | serif */
  fontFamily: 'sans',
  /** Show the table-of-contents sidebar. */
  showToc: true,
  /** Sidebar width in px (200 - 50% of viewport). */
  tocWidth: 272,
  /** Add line numbers to fenced code blocks. */
  codeLineNumbers: false,
  /** Soft-wrap long code lines. */
  codeWrap: false,
  /** Show the reading progress bar. */
  readingProgress: true,
  /** Click an image to open the lightbox. */
  zoomImages: true,
  /** Open external http(s) links in a new tab. */
  externalLinksNewTab: true,
  /** card | hide | raw */
  frontMatter: 'card',
  /** Render $...$ / $$...$$ with KaTeX. */
  math: true,
  /** Render ```mermaid blocks as diagrams. */
  mermaid: true,
  /** Allow sanitized raw HTML inside Markdown. */
  rawHtml: true,
  /** Enable :emoji: shortcodes. */
  emoji: true,
  /** Automatically render Markdown-looking documents. */
  autoRender: true,
  /** Show the "render as Markdown" hint on ambiguous plain-text pages. */
  plainTextHint: true,
  /** Poll the source URL and re-render when it changes. */
  liveReload: false,
  /** User supplied CSS appended inside the reader surface. */
  customCss: '',
});

export const SETTINGS_SCHEMA = Object.freeze({
  theme: { type: 'enum', values: ['auto', 'light', 'dark', 'sepia'] },
  fontSize: { type: 'number', min: 13, max: 22, step: 1 },
  lineHeight: { type: 'number', min: 1.4, max: 2.2, step: 0.05 },
  contentWidth: { type: 'enum', values: ['normal', 'wide', 'full'] },
  fontFamily: { type: 'enum', values: ['sans', 'serif'] },
  showToc: { type: 'boolean' },
  tocWidth: { type: 'number', min: 200, max: 1600, step: 1 },
  codeLineNumbers: { type: 'boolean' },
  codeWrap: { type: 'boolean' },
  readingProgress: { type: 'boolean' },
  zoomImages: { type: 'boolean' },
  externalLinksNewTab: { type: 'boolean' },
  frontMatter: { type: 'enum', values: ['card', 'hide', 'raw'] },
  math: { type: 'boolean' },
  mermaid: { type: 'boolean' },
  rawHtml: { type: 'boolean' },
  emoji: { type: 'boolean' },
  autoRender: { type: 'boolean' },
  plainTextHint: { type: 'boolean' },
  liveReload: { type: 'boolean' },
  customCss: { type: 'string' },
});

/** Coerce arbitrary stored data into a valid, fully populated settings object. */
export function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;

  for (const [key, rule] of Object.entries(SETTINGS_SCHEMA)) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (rule.type === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
    } else if (rule.type === 'number') {
      const num = Number(value);
      if (Number.isFinite(num)) {
        out[key] = Math.min(rule.max, Math.max(rule.min, num));
      }
    } else if (rule.type === 'enum') {
      if (rule.values.includes(value)) out[key] = value;
    } else if (rule.type === 'string') {
      if (typeof value === 'string') out[key] = value.slice(0, 100_000);
    }
  }
  return out;
}

function hasExtensionStorage() {
  try {
    return Boolean(
      globalThis.chrome?.storage?.[SETTINGS_STORAGE_AREA]?.get &&
        globalThis.chrome?.runtime?.id,
    );
  } catch {
    return false;
  }
}

function storageGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage[SETTINGS_STORAGE_AREA].get(key, (result) => {
        if (chrome.runtime?.lastError) resolve(undefined);
        else resolve(result?.[key]);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function storageSet(key, value) {
  return new Promise((resolve) => {
    try {
      chrome.storage[SETTINGS_STORAGE_AREA].set({ [key]: value }, () => {
        resolve(!chrome.runtime?.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Load settings on any surface (extension page, content script, plain web page). */
export async function loadSettings() {
  let stored;
  if (hasExtensionStorage()) {
    stored = await storageGet(SETTINGS_KEY);
  } else {
    try {
      stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    } catch {
      stored = null;
    }
  }
  return normalizeSettings(stored);
}

/** Merge a patch into the stored settings and resolve to the full new value. */
export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...patch });
  if (hasExtensionStorage()) {
    await storageSet(SETTINGS_KEY, next);
  } else {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* storage may be unavailable in private mode */
    }
  }
  return next;
}

/** Subscribe to settings changes across surfaces. Returns an unsubscribe fn. */
export function onSettingsChanged(callback) {
  if (hasExtensionStorage() && chrome.storage?.onChanged) {
    const listener = (changes, area) => {
      if (area !== SETTINGS_STORAGE_AREA || !changes[SETTINGS_KEY]) return;
      callback(normalizeSettings(changes[SETTINGS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const listener = (event) => {
    if (event.key !== SETTINGS_KEY) return;
    try {
      callback(normalizeSettings(JSON.parse(event.newValue || 'null')));
    } catch {
      /* ignore malformed values */
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

/** Resolve `auto` against the OS color scheme. */
export function resolveTheme(theme, prefersDark = false) {
  if (theme === 'auto') return prefersDark ? 'dark' : 'light';
  return theme === 'dark' || theme === 'sepia' ? theme : 'light';
}

/** Watch `prefers-color-scheme`. Returns an unsubscribe fn. */
export function watchColorScheme(callback) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (event) => callback(event.matches);
  query.addEventListener?.('change', listener);
  return () => query.removeEventListener?.('change', listener);
}
