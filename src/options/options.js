/**
 * Options page.
 * Every control is bound to src/shared/settings.js; changes apply instantly
 * and sync to open reader surfaces through storage.
 */
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  onSettingsChanged,
  resolveTheme,
  saveSettings,
  watchColorScheme,
} from '../shared/settings.js';
import { createTranslator, detectLanguage } from '../shared/i18n.js';
import { strings } from '../ui/strings.js';
import { icons } from '../ui/icons.js';
import { applyI18n, createToast, qs, qsa } from '../ui/dom.js';
import { debounce, downloadText } from '../shared/util.js';

const t = createTranslator(strings, detectLanguage());
const ICON_MAP = {
  palette: icons.palette,
  book: icons.book,
  sparkles: icons.sparkles,
  sliders: icons.sliders,
  code: icons.code,
  shield: icons.shield,
  info: icons.info,
};

function prefersDark() {
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

function setsEqual(value, next) {
  return value === next;
}

async function main() {
  applyI18n(document, t);

  const toast = createToast(qs('#md-toast'));
  const previewPaper = qs('#md-preview-paper');
  const cssStatus = qs('#md-css-status');
  const resetDialog = qs('#md-reset-dialog');
  const importInput = qs('#md-import-file');
  const version = globalThis.chrome?.runtime?.getManifest?.()?.version || '1.0.0';

  document.title = t('optionsPageTitle');
  qs('#md-version').textContent = `v${version}`;
  const footerLeft = qs('[data-i18n-html="optionsFooterLeft"]');
  if (footerLeft) footerLeft.innerHTML = t('optionsFooterLeft', { version: `v${version}` });

  qs('#md-export-icon').innerHTML = icons.download;
  qs('#md-export-2-icon').innerHTML = icons.download;
  qs('#md-import-icon').innerHTML = icons.upload;
  qs('#md-import-2-icon').innerHTML = icons.upload;
  qs('#md-reset-icon').innerHTML = icons.refresh;
  qs('#md-reset-2-icon').innerHTML = icons.trash;
  qs('#md-info-icon').innerHTML = icons.info;
  qs('#md-preview-icon').innerHTML = icons.eye;
  for (const node of qsa('[data-icon]')) {
    node.innerHTML = ICON_MAP[node.dataset.icon] || icons.info;
  }

  let settings = await loadSettings();
  let pendingPatch = {};
  let cssStatusTimer = 0;

  const flushPatch = debounce(async () => {
    if (!Object.keys(pendingPatch).length) return;
    const patch = pendingPatch;
    pendingPatch = {};
    settings = await saveSettings(patch);
    paintPreview();
  }, 260);

  function queueSave(patch) {
    Object.assign(pendingPatch, patch);
    flushPatch();
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function paintTheme() {
    document.documentElement.dataset.mdTheme = resolveTheme(settings.theme, prefersDark());
    for (const tile of qsa('.md-theme-tile')) {
      const active = tile.dataset.value === settings.theme;
      tile.classList.toggle('is-active', active);
      tile.setAttribute('aria-pressed', String(active));
    }
  }

  function paintOutputs() {
    const font = clampNumber(settings.fontSize, 13, 22);
    const line = clampNumber(settings.lineHeight, 1.4, 2.2);
    const widthKey =
      { normal: 'widthNormalShort', wide: 'widthWideShort', full: 'widthFullShort' }[
        settings.contentWidth
      ] || 'widthNormalShort';
    qs('#out-fontSize').textContent = String(font);
    qs('#out-lineHeight').textContent = line.toFixed(2);
    qs('#md-preview-meta').textContent = `${font}px · ${line.toFixed(2)}`;
    qs('#md-preview-foot-meta').textContent = `${font} px · ${t(widthKey)}`;
  }

  function paintPreview() {
    const font = clampNumber(settings.fontSize, 13, 22);
    const line = clampNumber(settings.lineHeight, 1.4, 2.2);
    previewPaper.style.setProperty('--md-preview-font-size', `${font}px`);
    previewPaper.style.setProperty('--md-preview-line-height', String(line));
    previewPaper.dataset.font = settings.fontFamily === 'serif' ? 'serif' : 'sans';
    paintOutputs();
  }

  function paint() {
    paintTheme();

    for (const field of qsa('[data-setting]')) {
      if (field.tagName === 'BUTTON' || field.closest('.md-segmented')) continue;
      const key = field.dataset.setting;
      const value = settings[key];
      if (field.classList.contains('md-switch')) {
        field.checked = Boolean(value);
      } else if (field.type === 'range') {
        if (document.activeElement !== field) field.value = String(value);
      } else if (field.tagName === 'SELECT' || field.tagName === 'TEXTAREA') {
        field.value = value ?? '';
      }
    }

    for (const group of qsa('.md-segmented')) {
      const key = group.querySelector('[data-setting]')?.dataset.setting;
      if (!key) continue;
      for (const button of qsa('[data-value]', group)) {
        const active = button.dataset.value === settings[key];
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }

    paintPreview();
  }

  async function update(patch, { message = '', silent = true } = {}) {
    settings = await saveSettings(patch);
    paint();
    if (message && !silent) toast.show(message);
  }

  function showCssSaved() {
    cssStatus.classList.add('is-visible');
    clearTimeout(cssStatusTimer);
    cssStatusTimer = setTimeout(() => cssStatus.classList.remove('is-visible'), 1400);
  }

  /* ------------------------------------------------------------- events */
  document.addEventListener('click', (event) => {
    const choice = event.target.closest('.md-theme-tile[data-setting], .md-segmented [data-setting]');
    if (!choice) return;
    event.preventDefault();
    update({ [choice.dataset.setting]: choice.dataset.value });
  });

  document.addEventListener('input', (event) => {
    const field = event.target.closest('input[type="range"][data-setting]');
    if (!field) return;
    const key = field.dataset.setting;
    const value = Number(field.value);
    if (setsEqual(settings[key], value)) return;
    settings = { ...settings, [key]: value };
    paintTheme();
    paintPreview();
    queueSave({ [key]: value });
  });

  document.addEventListener('change', (event) => {
    const field = event.target.closest('[data-setting]');
    if (!field || field.tagName === 'BUTTON') return;
    const key = field.dataset.setting;
    if (field.classList.contains('md-switch')) {
      update({ [key]: field.checked });
    } else if (field.tagName === 'SELECT') {
      update({ [key]: field.value });
    } else if (field.tagName === 'TEXTAREA') {
      update({ [key]: field.value });
      showCssSaved();
    }
  });

  qs('#md-css-clear').addEventListener('click', () => {
    const textarea = qs('[data-setting="customCss"]');
    textarea.value = '';
    update({ customCss: '' });
    showCssSaved();
    toast.show(t('customCssReset'));
  });

  qs('#md-export').addEventListener('click', exportSettings);
  qs('#md-export-2').addEventListener('click', exportSettings);

  function exportSettings() {
    downloadText(
      'md-reader-pro-settings.json',
      JSON.stringify(settings, null, 2),
      'application/json',
    );
    toast.show(t('exportDone'));
  }

  for (const button of [qs('#md-import'), qs('#md-import-2')]) {
    button.addEventListener('click', () => {
      importInput.value = '';
      importInput.click();
    });
  }

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      settings = await saveSettings(normalizeSettings(data));
      paint();
      toast.show(t('importDone'));
    } catch {
      toast.show(t('importFailed'), { error: true });
    }
  });

  function openResetDialog() {
    resetDialog.showModal();
  }

  for (const button of [qs('#md-reset'), qs('#md-reset-2')]) {
    button.addEventListener('click', openResetDialog);
  }
  qs('#md-reset-cancel').addEventListener('click', () => resetDialog.close());
  resetDialog.addEventListener('click', (event) => {
    if (event.target === resetDialog) resetDialog.close();
  });
  qs('#md-reset-confirm').addEventListener('click', async () => {
    resetDialog.close();
    settings = await saveSettings({ ...DEFAULT_SETTINGS });
    paint();
    toast.show(t('resetDone'));
  });

  onSettingsChanged((next) => {
    settings = next;
    paint();
  });

  watchColorScheme(() => {
    if (settings.theme === 'auto') paintTheme();
  });

  paint();
}

main().catch((error) => console.error('[MD Reader Pro]', error));
