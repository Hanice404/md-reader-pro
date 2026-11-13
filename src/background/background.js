/**
 * MD Reader Pro — MV3 service worker.
 *
 * Responsibilities (contract docs/CONTRACT.md §5):
 *  - seed default settings on install;
 *  - context menu ("以 Markdown 阅读") and the Alt+Shift+M command;
 *  - route popup / viewer requests;
 *  - fall back to programmatic injection when the content script is missing;
 *  - classify restricted pages (chrome://, Web Store, PDF, file access off).
 *
 * No remote code is fetched or executed from here.
 */
import {
  SETTINGS_KEY,
  SETTINGS_STORAGE_AREA,
  loadSettings,
} from '../shared/settings.js';

const MENU_ID = 'md-reader-render-page';
const CONTENT_SCRIPT = 'content.js';
const CONTENT_CSS = 'reader.css';

/** Schemes that can never be scripted by an extension. */
const RESTRICTED_SCHEME_RE =
  /^(?:chrome|chrome-untrusted|devtools|edge|brave|about|view-source|data|blob|filesystem|chrome-extension):/i;

/** Pages Chrome blocks extensions from scripting. */
const RESTRICTED_HOST_RE =
  /^https?:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)\//i;

const PDF_URL_RE = /\.pdf(?:[?#]|$)/i;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function i18n(key, fallback) {
  try {
    return chrome.i18n.getMessage(key) || fallback;
  } catch {
    return fallback;
  }
}

function isRestrictedUrl(url) {
  const value = String(url || '');
  if (!value) return true;
  return RESTRICTED_SCHEME_RE.test(value) || RESTRICTED_HOST_RE.test(value);
}

function isPdfUrl(url) {
  return PDF_URL_RE.test(String(url || ''));
}

function warn(...args) {
  try {
    console.warn('[MD Reader Pro]', ...args);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Settings seeding
 * ------------------------------------------------------------------ */

/**
 * Merge the built-in defaults into whatever is already stored. `loadSettings`
 * normalises and fills missing keys, so writing it back seeds a complete
 * settings object without clobbering user choices.
 */
async function seedSettings() {
  try {
    const current = await loadSettings();
    await chrome.storage[SETTINGS_STORAGE_AREA].set({ [SETTINGS_KEY]: current });
  } catch (error) {
    warn('could not seed settings', error);
  }
}

/* ------------------------------------------------------------------ *
 * Context menu
 * ------------------------------------------------------------------ */

function ensureMenus() {
  const create = () => {
    try {
      chrome.contextMenus.create(
        {
          id: MENU_ID,
          title: i18n('contextMenuRead', '以 Markdown 阅读'),
          contexts: ['page'],
          documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
        },
        () => {
          // Reading lastError clears the "duplicate id" warning during reloads.
          void chrome.runtime.lastError;
        },
      );
    } catch (error) {
      warn('could not create context menu', error);
    }
  };

  try {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      create();
    });
  } catch (error) {
    warn('could not reset context menus', error);
    create();
  }
}

/* ------------------------------------------------------------------ *
 * Tab messaging + injection fallback
 * ------------------------------------------------------------------ */

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: false },
      files: [CONTENT_CSS],
    });
  } catch {
    // The stylesheet is usually already injected by the manifest; a failure
    // here is not fatal as long as the script itself loads.
  }
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: [CONTENT_SCRIPT],
  });
}

/** Read the content script's state from the extension's isolated world. */
async function probeState(tabId) {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: () => (typeof window.__mdReaderState === 'function' ? window.__mdReaderState() : null),
    });
    return frame?.result || null;
  } catch {
    return null;
  }
}

function classifyInjectionError(error, tabUrl) {
  const message = String(error?.message || error || '');
  if (/^file:/i.test(String(tabUrl || '')) || /file:\/\//i.test(message)) {
    return {
      ok: false,
      reason: 'file-access',
      message: i18n(
        'fileAccessHint',
        '请在扩展详情页开启「允许访问文件网址」后重试。',
      ),
    };
  }
  return { ok: false, reason: 'restricted-page', message };
}

/**
 * Ask the current tab to render itself. If the content script is missing (the
 * page was opened before the extension was installed, or the manifest did not
 * match), inject it and retry once.
 */
async function requestRender(tab) {
  const tabId = tab?.id;
  const url = tab?.url || tab?.pendingUrl || '';
  if (!tabId) return { ok: false, reason: 'no-tab' };
  // Chrome hides the URL of protected pages (chrome://, Web Store…), so an
  // empty URL almost always means a restricted tab rather than a real page.
  if (!url) return { ok: false, reason: 'restricted-page' };
  if (isRestrictedUrl(url)) return { ok: false, reason: 'restricted-page' };
  if (isPdfUrl(url)) return { ok: false, reason: 'pdf' };

  const direct = await sendToTab(tabId, { type: 'render-current' });
  if (direct) return direct;

  try {
    await injectContentScript(tabId);
  } catch (error) {
    warn('injection failed', error);
    return classifyInjectionError(error, url);
  }

  const retried = await sendToTab(tabId, { type: 'render-current' });
  if (retried) return retried;

  const state = await probeState(tabId);
  if (state) {
    if (state.mounted) return { ok: true, mounted: true, alreadyMounted: true };
    return { ok: false, reason: state.reason || 'not-markdown', state };
  }
  return { ok: false, reason: 'unreachable' };
}

async function renderActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab) return { ok: false, reason: 'no-tab' };
  return requestRender(tab);
}

/* ------------------------------------------------------------------ *
 * Viewer / options routing
 * ------------------------------------------------------------------ */

async function openViewer(message = {}) {
  const params = new URLSearchParams();
  if (typeof message.url === 'string' && /^(?:https?|file):\/\//i.test(message.url)) {
    params.set('url', message.url);
  }
  if (message.pick) params.set('pick', '1');
  const query = params.toString();
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`viewer.html${query ? `?${query}` : ''}`),
  });
  return { ok: true };
}

async function openOptions() {
  await chrome.runtime.openOptionsPage();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener((details) => {
  ensureMenus();
  if (details?.reason === 'install' || details?.reason === 'update') {
    seedSettings();
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (tab) {
    requestRender(tab).catch((error) => warn('context menu render failed', error));
    return;
  }
  renderActiveTab().catch((error) => warn('context menu render failed', error));
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-markdown') return;
  (async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id) return;
    const state = await sendToTab(tab.id, { type: 'get-state' });
    if (state?.mounted) {
      await sendToTab(tab.id, { type: 'toggle-raw' });
      return;
    }
    await requestRender(tab);
  })().catch((error) => warn('command failed', error));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  try {
    switch (message.type) {
      case 'render-active-tab':
        renderActiveTab()
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, reason: 'error', message: String(error?.message || error) }));
        return true;

      case 'open-viewer':
        openViewer(message)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, reason: 'error', message: String(error?.message || error) }));
        return true;

      case 'open-options':
        openOptions()
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, reason: 'error', message: String(error?.message || error) }));
        return true;

      case 'get-settings':
        loadSettings()
          .then((settings) => sendResponse(settings))
          .catch(() => sendResponse(null));
        return true;

      case 'get-active-tab':
        chrome.tabs
          .query({ active: true, currentWindow: true })
          .then((tabs) => sendResponse(tabs?.[0] || null))
          .catch(() => sendResponse(null));
        return true;

      default:
        return undefined;
    }
  } catch (error) {
    sendResponse({ ok: false, reason: 'error', message: String(error?.message || error) });
    return undefined;
  }
});
