/**
 * Browser action popup (owner: ui-dev).
 * Shows the current tab, its render state and the primary action, plus
 * quick access to the standalone viewer and reading themes.
 */
import { loadSettings, resolveTheme, saveSettings, watchColorScheme } from '../shared/settings.js';
import { createTranslator, detectLanguage } from '../shared/i18n.js';
import { strings } from '../ui/strings.js';
import { icons } from '../ui/icons.js';
import { applyI18n, createToast, qs, qsa } from '../ui/dom.js';

const t = createTranslator(strings, detectLanguage());
const MD_LINK_RE = /\.(md|markdown|mdown|mkd|mdx)(?:[?#]|$)/i;
const THEME_LABELS = { light: 'themeLight', dark: 'themeDark', sepia: 'themeSepia', auto: 'themeAuto' };

function prefersDark() {
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

async function main() {
  applyI18n(document, t);

  const toast = createToast(qs('#md-toast'));
  const statusCard = qs('#status-card');
  const pageTitle = qs('#page-title');
  const pageUrl = qs('#page-url');
  const pageStatus = qs('#page-status');
  const hint = qs('#render-hint');
  const renderButton = qs('#render-page');
  const renderLabel = qs('#render-label');
  const renderIcon = qs('#render-icon');
  const favicon = qs('#page-favicon');
  const pageIcon = qs('#page-icon');

  qs('#open-options').innerHTML = icons.settings;
  qs('#open-file-icon').innerHTML = icons.folderOpen;
  qs('#open-viewer-icon').innerHTML = icons.book;
  pageIcon.innerHTML = icons.globe;
  renderIcon.innerHTML = icons.fileCode;

  const hasTabs = Boolean(globalThis.chrome?.tabs?.query);
  let settings = await loadSettings();
  let tab = null;

  if (globalThis.chrome?.runtime?.getManifest) {
    qs('#version').textContent = `v${chrome.runtime.getManifest().version}`;
  }

  function applyTheme() {
    document.documentElement.dataset.mdTheme = resolveTheme(settings.theme, prefersDark());
    for (const chip of qsa('.md-theme-chip')) {
      const active = chip.dataset.theme === settings.theme;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    }
    const name = t(THEME_LABELS[settings.theme] || 'themeAuto');
    qs('#theme-name').textContent = name;
  }

  function setState(state, { statusKey, hintKey, buttonKey, disabled = false }) {
    statusCard.dataset.state = state;
    pageStatus.textContent = t(statusKey);
    pageStatus.dataset.i18n = statusKey;
    hint.textContent = t(hintKey);
    hint.dataset.i18n = hintKey;
    renderLabel.textContent = t(buttonKey || 'actionRender');
    renderLabel.dataset.i18n = buttonKey || 'actionRender';
    renderButton.disabled = disabled;
  }

  function setBusy(busy) {
    renderButton.disabled = busy;
    if (busy) {
      renderIcon.innerHTML = '<span class="md-btn-spinner" aria-hidden="true"></span>';
      renderLabel.textContent = t('actionRendering');
    } else {
      renderIcon.innerHTML = icons.fileCode;
      renderLabel.textContent = t(renderLabel.dataset.i18n || 'actionRender');
    }
  }

  function prettyUrl(url) {
    if (!url) return '';
    return url.replace(/^https?:\/\//, '').replace(/^file:\/\//, '');
  }

  function showFavicon(src) {
    if (!src || !/^(https?:|data:)/i.test(src)) return;
    favicon.addEventListener(
      'load',
      () => {
        favicon.hidden = false;
        pageIcon.hidden = true;
      },
      { once: true },
    );
    favicon.addEventListener(
      'error',
      () => {
        favicon.hidden = true;
        pageIcon.hidden = false;
      },
      { once: true },
    );
    favicon.src = src;
  }

  async function renderCurrent() {
    if (!hasTabs || !tab?.id) {
      toast.show(t('previewHint'));
      return;
    }
    setBusy(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'render-active-tab' });
      if (result?.ok) {
        window.close();
        return;
      }
      toast.show(
        result?.reason === 'not-markdown' ? t('renderNotMarkdown') : t('renderFailed'),
        { error: true },
      );
    } catch {
      toast.show(t('renderUnavailable'), { error: true });
    }
    setBusy(false);
  }

  async function init() {
    applyTheme();

    if (!hasTabs) {
      pageTitle.textContent = 'MD Reader Pro';
      pageUrl.textContent = t('statusPreview');
      setState('blocked', {
        statusKey: 'statusPreview',
        hintKey: 'previewHint',
        disabled: true,
      });
      return;
    }

    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = active || null;
    } catch {
      tab = null;
    }

    const url = tab?.url || '';
    pageTitle.textContent = tab?.title || url || t('pageUnknownUrl');
    pageUrl.textContent = prettyUrl(url);
    pageUrl.title = url;
    showFavicon(tab?.favIconUrl);

    if (!/^https?:|^file:/i.test(url)) {
      setState('blocked', {
        statusKey: 'statusBlocked',
        hintKey: /^(chrome|edge|about|chrome-extension):/i.test(url)
          ? 'unsupportedHint'
          : 'blockedHint',
        disabled: true,
      });
      return;
    }

    try {
      const state = await chrome.tabs.sendMessage(tab.id, { type: 'get-state' });
      if (state?.mounted) {
        setState('rendered', {
          statusKey: 'statusRendered',
          hintKey: 'renderedHint',
          buttonKey: 'actionRerender',
        });
      } else if (state?.isMarkdown || MD_LINK_RE.test(url)) {
        setState('ready', {
          statusKey: MD_LINK_RE.test(url) && !state?.isMarkdown ? 'statusMarkdownLink' : 'statusMarkdown',
          hintKey: 'markdownReadyHint',
          buttonKey: 'actionRender',
        });
      } else {
        setState('warn', {
          statusKey: 'statusPlain',
          hintKey: 'forceRenderHint',
          buttonKey: 'actionForceRender',
        });
      }
    } catch {
      setState('warn', {
        statusKey: 'statusNoScript',
        hintKey: 'noScriptHint',
        buttonKey: 'actionForceRender',
      });
    }
  }

  renderButton.addEventListener('click', renderCurrent);

  qs('#open-file').addEventListener('click', () => {
    const url = globalThis.chrome?.runtime?.getURL?.('viewer.html?pick=1') || './viewer.html?pick=1';
    if (globalThis.chrome?.tabs?.create) {
      chrome.tabs.create({ url });
      window.close();
    } else {
      location.href = url;
    }
  });

  qs('#open-viewer').addEventListener('click', () => {
    const url = globalThis.chrome?.runtime?.getURL?.('viewer.html') || './viewer.html';
    if (globalThis.chrome?.tabs?.create) {
      chrome.tabs.create({ url });
      window.close();
    } else {
      location.href = url;
    }
  });

  qs('#open-options').addEventListener('click', () => {
    if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
    else location.href = './options.html';
  });

  for (const chip of qsa('.md-theme-chip')) {
    chip.addEventListener('click', async () => {
      if (settings.theme === chip.dataset.theme) return;
      settings = await saveSettings({ theme: chip.dataset.theme });
      applyTheme();
    });
  }

  watchColorScheme(() => {
    if (settings.theme === 'auto') applyTheme();
  });

  await init();
}

main().catch((error) => console.error('[MD Reader Pro]', error));
