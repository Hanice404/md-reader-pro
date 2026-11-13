/**
 * Standalone viewer page.
 *
 * Works both as an extension page and as a plain static page (serve dist/
 * over http to test). The empty state, loading and error handling live here;
 * once a document is open the reader app takes over full screen.
 */
import {
  loadSettings,
  onSettingsChanged,
  resolveTheme,
  saveSettings,
  watchColorScheme,
} from '../shared/settings.js';
import { mountReaderApp } from '../ui/reader-app.js';
import { createTranslator, detectLanguage } from '../shared/i18n.js';
import { strings } from '../ui/strings.js';
import { icons } from '../ui/icons.js';
import { applyI18n, createToast, qs } from '../ui/dom.js';
import { baseName, formatBytes } from '../shared/util.js';

const t = createTranslator(strings, detectLanguage());

const THEME_ORDER = ['light', 'dark', 'sepia', 'auto'];
const THEME_ICONS = { light: icons.sun, dark: icons.moon, sepia: icons.contrast, auto: icons.auto };
const THEME_LABELS = { light: 'themeLight', dark: 'themeDark', sepia: 'themeSepia', auto: 'themeAuto' };

function prefersDark() {
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

async function main() {
  const emptyView = qs('#md-viewer-empty');
  const mountPoint = qs('#md-reader-mount');
  const fileInput = qs('#md-file-input');
  const dropzone = qs('#md-dropzone');
  const errorBox = qs('#md-viewer-error');
  const loading = qs('#md-viewer-loading');
  const themeButton = qs('#viewer-theme');
  const settingsButton = qs('#viewer-settings');
  const pasteDialog = qs('#md-paste-dialog');
  const pasteForm = qs('#md-paste-form');
  const pasteText = qs('#md-paste-text');
  const toastEl = qs('#md-toast');
  const toast = createToast(toastEl);

  applyI18n(document, t);

  qs('#md-dropzone-icon').innerHTML = icons.upload;
  qs('#md-pick-icon').innerHTML = icons.folderOpen;
  qs('#md-paste-icon').innerHTML = icons.copy;
  qs('#md-sample-icon').innerHTML = icons.sparkles;
  settingsButton.innerHTML = icons.settings;

  let settings = await loadSettings();
  let app = null;
  let opening = false;
  let loadingTimer = 0;

  const version = globalThis.chrome?.runtime?.getManifest?.()?.version || '1.0.0';
  const footerLeft = qs('[data-i18n-html="viewerFooterLeft"]');
  if (footerLeft) footerLeft.innerHTML = t('viewerFooterLeft', { version: `v${version}` });

  function applyPageTheme() {
    const theme = resolveTheme(settings.theme, prefersDark());
    const label = t(THEME_LABELS[settings.theme] || 'themeAuto');
    const tip = t('themeTooltip', { name: label });
    document.documentElement.dataset.mdTheme = theme;
    themeButton.innerHTML = THEME_ICONS[theme] || icons.sun;
    themeButton.dataset.tip = tip;
    themeButton.setAttribute('aria-label', tip);
    themeButton.dataset.theme = settings.theme;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function showToast(message, { error = false } = {}) {
    toast.show(message, { error });
  }

  function setLoading(active) {
    clearTimeout(loadingTimer);
    if (!active) {
      loading.hidden = true;
      return;
    }
    loadingTimer = setTimeout(() => {
      loading.hidden = false;
    }, 140);
  }

  function isReading() {
    return document.body.classList.contains('is-reading');
  }

  function restoreEmptyState() {
    app?.destroy();
    app = null;
    mountPoint.hidden = true;
    mountPoint.textContent = '';
    emptyView.hidden = false;
    document.body.classList.remove('is-reading');
    applyPageTheme();
    document.title = t('viewerPageTitle');
    window.scrollTo({ top: 0 });
  }

  function closeDocument() {
    if (!isReading()) return;
    restoreEmptyState();
    hideError();
    fileInput.value = '';
  }

  async function createRenderer() {
    const url = globalThis.chrome?.runtime?.getURL
      ? chrome.runtime.getURL('renderer.js')
      : './renderer.js';
    const mod = await import(url);
    return mod.createRenderer({
      html: settings.rawHtml,
      rawHtml: settings.rawHtml,
      math: settings.math,
      mermaid: settings.mermaid,
      emoji: settings.emoji,
      frontMatter: settings.frontMatter,
    });
  }

  async function openMarkdown({ markdown, name, path, kind = 'file' }) {
    const text = String(markdown ?? '');
    if (!text.trim()) {
      showError(t('viewerErrorEmpty'));
      return;
    }
    if (opening) return;
    opening = true;
    hideError();
    setLoading(true);
    try {
      const renderer = await createRenderer();
      app?.destroy();
      mountPoint.textContent = '';
      mountPoint.hidden = false;
      emptyView.hidden = true;
      document.body.classList.add('is-reading');
      document.documentElement.dataset.mdReader = 'viewer';
      app = await mountReaderApp({
        container: mountPoint,
        markdown: text,
        renderer,
        settings,
        source: {
          path: path || name || '',
          title: name || baseName(path || '') || '',
          kind,
        },
        capabilities: { raw: true, print: true, liveReload: false, openFile: true },
        callbacks: {
          onSettingsChange: async (patch) => {
            settings = await saveSettings(patch);
            return settings;
          },
          onReload: () => location.reload(),
          onOpenFile: () => closeDocument(),
        },
      });
      app?.scrollToTop?.();
      if (name) document.title = `${name} · MD Reader Pro`;
    } catch (error) {
      console.error('[MD Reader Pro]', error);
      restoreEmptyState();
      showError(t('viewerErrorRead'));
    } finally {
      opening = false;
      setLoading(false);
    }
  }

  async function readFile(file) {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      showToast(t('viewerLargeFile', { size: formatBytes(file.size) }));
    }
    try {
      const markdown = await file.text();
      await openMarkdown({ markdown, name: file.name, path: file.name, kind: 'file' });
    } catch {
      showError(t('viewerErrorRead'));
    }
  }

  function pickFile() {
    fileInput.value = '';
    fileInput.click();
  }

  async function openSample() {
    setLoading(true);
    try {
      const url = globalThis.chrome?.runtime?.getURL
        ? chrome.runtime.getURL('samples/sample.md')
        : new URL('./samples/sample.md', location.href).href;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const markdown = await response.text();
      setLoading(false);
      await openMarkdown({ markdown, name: 'sample.md', path: url, kind: 'url' });
    } catch (error) {
      console.warn('[MD Reader Pro] sample failed', error);
      setLoading(false);
      showError(t('viewerErrorSample'));
    }
  }

  async function openFromUrl(url) {
    setLoading(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const markdown = await response.text();
      setLoading(false);
      await openMarkdown({
        markdown,
        name: baseName(url, 'document.md'),
        path: url,
        kind: 'url',
      });
    } catch (error) {
      console.warn('[MD Reader Pro] url failed', error);
      setLoading(false);
      showError(t('viewerErrorUrl'));
    }
  }

  /* ----------------------------------------------------------- events */
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) readFile(file);
  });

  dropzone.addEventListener('click', pickFile);
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickFile();
    }
  });
  qs('#md-pick-file').addEventListener('click', pickFile);
  qs('#md-open-sample').addEventListener('click', openSample);

  qs('#md-paste').addEventListener('click', () => {
    pasteText.value = '';
    pasteText.setCustomValidity('');
    pasteDialog.showModal();
    pasteText.focus();
  });
  qs('#md-paste-cancel').addEventListener('click', () => pasteDialog.close());
  pasteText.addEventListener('input', () => pasteText.setCustomValidity(''));
  pasteDialog.addEventListener('click', (event) => {
    if (event.target === pasteDialog) pasteDialog.close();
  });
  pasteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = pasteText.value;
    if (!text.trim()) {
      pasteText.setCustomValidity(t('pasteEmpty'));
      pasteText.reportValidity();
      return;
    }
    pasteDialog.close();
    openMarkdown({ markdown: text, name: 'pasted.md', path: 'pasted.md', kind: 'paste' });
  });

  settingsButton.addEventListener('click', () => {
    if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
    else location.href = './options.html';
  });

  themeButton.addEventListener('click', async () => {
    const index = Math.max(0, THEME_ORDER.indexOf(settings.theme));
    const theme = THEME_ORDER[(index + 1) % THEME_ORDER.length];
    settings = await saveSettings({ theme });
    applyPageTheme();
    app?.setSettings({ theme });
  });

  /* drag & drop anywhere on the page */
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event) || isReading()) return;
    event.preventDefault();
    dragDepth += 1;
    dropzone.classList.add('is-dragover');
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('is-dragover');
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-dragover');
    if (isReading()) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });

  /* paste anywhere (when not typing and not reading) */
  window.addEventListener('paste', (event) => {
    if (isReading() || pasteDialog.open) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))
    ) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') || '';
    if (text.trim().length < 20) return;
    event.preventDefault();
    openMarkdown({ markdown: text, name: 'pasted.md', path: 'pasted.md', kind: 'paste' });
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isReading() && !app) restoreEmptyState();
  });

  onSettingsChanged((next) => {
    settings = next;
    applyPageTheme();
    app?.setSettings(next);
  });

  watchColorScheme(() => {
    if (settings.theme === 'auto') {
      applyPageTheme();
      app?.setSettings({});
    }
  });

  /* deep links: ?url=…, ?pick=1, ?sample=1 */
  const params = new URLSearchParams(location.search);
  applyPageTheme();
  document.title = t('viewerPageTitle');

  if (params.get('url')) openFromUrl(params.get('url'));
  else if (params.get('sample')) openSample();
  else if (params.get('pick')) setTimeout(pickFile, 220);
}

main().catch((error) => console.error('[MD Reader Pro]', error));
