/**
 * MD Reader Pro — reader UI.
 *
 * Contract: docs/CONTRACT.md §4. Owns the whole reading surface:
 * toolbar, table of contents (with scroll spy), reading progress, raw
 * source view, code copy, Mermaid source toggles, image lightbox,
 * print, front matter / footnote decoration and theme application.
 *
 * Public API (stable):
 *   mountReaderApp({ container, markdown, renderer, settings, source,
 *                    capabilities, callbacks }) -> Promise<ReaderApp>
 *   ReaderApp = { el, setMarkdown, setSettings, getSettings, destroy,
 *                 scrollToHeading, scrollToTop, toggleToc }
 */
import { createTranslator, detectLanguage } from '../shared/i18n.js';
import { resolveTheme, watchColorScheme } from '../shared/settings.js';
import { baseName, copyText, escapeHtml } from '../shared/util.js';
import { strings } from './strings.js';
import { icons } from './icons.js';
import { createToast, focusSilently, h, qs, qsa, scrollBehavior } from './dom.js';

const t = createTranslator(strings, detectLanguage());

const MOBILE_QUERY = '(max-width: 960px)';
const THEME_RING = ['light', 'dark', 'sepia', 'auto'];
const WIDTH_RING = ['normal', 'wide', 'full'];
const THEME_ICONS = { light: icons.sun, dark: icons.moon, sepia: icons.contrast, auto: icons.auto };
const THEME_LABELS = { light: 'themeLight', dark: 'themeDark', sepia: 'themeSepia', auto: 'themeAuto' };
const WIDTH_LABELS = { normal: 'widthNormal', wide: 'widthWide', full: 'widthFull' };
const REDECORATE_KEYS = ['codeLineNumbers', 'codeWrap', 'zoomImages', 'externalLinksNewTab'];

function prefersDark() {
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

function resolvedTheme(setting) {
  return resolveTheme(setting, prefersDark());
}

function clampFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return 16;
  return Math.min(22, Math.max(13, Math.round(size)));
}

function clampLineHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height)) return 1.75;
  return Math.min(2.2, Math.max(1.4, Math.round(height * 20) / 20));
}

function countLines(text) {
  return String(text ?? '').split(/\r\n|\r|\n/).length;
}

function makeIconButton(action, icon, label, extraClass = '') {
  return h('button', {
    type: 'button',
    class: `md-btn ${extraClass}`.trim(),
    'data-md-action': action,
    'data-tip': label,
    'aria-label': label,
    html: icon,
  });
}

export async function mountReaderApp({
  container,
  markdown,
  renderer,
  settings,
  source = {},
  capabilities = {},
  callbacks = {},
}) {
  const state = {
    markdown: String(markdown ?? ''),
    settings: { ...(settings || {}) },
    result: null,
    raw: false,
    drawerOpen: false,
    destroyed: false,
    images: [],
    imageIndex: 0,
    activeHeadingIndex: -1,
    appliedTheme: null,
    lastFocused: null,
  };

  const mobileQuery = window.matchMedia(MOBILE_QUERY);
  const isMobile = () => mobileQuery.matches;

  /* ------------------------------------------------------------- skeleton */
  const tocToggle = makeIconButton('toggle-toc', icons.toc, t('toggleToc'), 'md-toc-toggle');
  tocToggle.setAttribute('aria-controls', 'md-sidebar');
  tocToggle.setAttribute('aria-expanded', 'false');

  const titleText = h('span', { class: 'md-doc-title-text' });
  const fileChip = h('span', { class: 'md-doc-file', hidden: true });
  const docTitle = h('div', { class: 'md-doc-title' }, titleText, fileChip);
  const docMeta = h('div', { class: 'md-doc-meta' });
  const docProgress = h('span', {
    class: 'md-doc-progress',
    text: '0%',
    hidden: true,
    title: t('readingProgress'),
    'aria-label': t('readingProgress'),
  });
  const headingWrap = h('div', { class: 'md-heading-wrap' }, docTitle, docMeta);

  const themeButton = makeIconButton('theme', icons.sun, t('toggleTheme'));
  const fontSmaller = makeIconButton('font-smaller', icons.minus, t('fontSmaller'));
  const fontZoom = h('button', {
    type: 'button',
    class: 'md-btn md-zoom',
    'data-md-action': 'reset-font',
    'data-tip': t('fontZoom', { percent: 100 }),
  });
  const fontLarger = makeIconButton('font-larger', icons.plus, t('fontLarger'));
  const widthButton = makeIconButton('width', icons.width, t('contentWidth'));
  const rawButton = makeIconButton('raw', icons.code, t('toggleSource'));
  const copyButton = makeIconButton('copy', icons.copy, t('copyMarkdown'));
  const printButton = makeIconButton('print', icons.print, t('print'));
  const openFileButton = makeIconButton('open-file', icons.folderOpen, t('openAnother'));

  if (capabilities.raw === false) rawButton.hidden = true;
  if (capabilities.print === false) printButton.hidden = true;
  if (!capabilities.openFile) openFileButton.hidden = true;

  const dividerA = h('span', { class: 'md-toolbar-divider', 'aria-hidden': 'true' });
  const dividerB = h('span', { class: 'md-toolbar-divider', 'aria-hidden': 'true' });

  const toolbarActions = h(
    'div',
    { class: 'md-toolbar-actions' },
    themeButton,
    dividerA,
    fontSmaller,
    fontZoom,
    fontLarger,
    widthButton,
    dividerB,
    rawButton,
    copyButton,
    printButton,
    openFileButton,
  );

  const toolbar = h(
    'header',
    { class: 'md-toolbar', role: 'banner' },
    h('div', { class: 'md-toolbar-main' }, tocToggle, headingWrap),
    toolbarActions,
  );

  const tocNav = h('nav', { class: 'md-toc', 'aria-label': t('toc') });
  const sidebarInner = h(
    'div',
    { class: 'md-sidebar-inner' },
    h(
      'div',
      { class: 'md-sidebar-head' },
      h('span', { class: 'md-sidebar-title', text: t('toc') }),
    ),
    tocNav,
  );
  const sidebarResizer = h('div', {
    class: 'md-sidebar-resizer',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuemin': '200',
    'aria-valuenow': '272',
    tabindex: '0',
    title: t('resizeToc'),
    'aria-label': t('resizeToc'),
  });
  const sidebar = h(
    'aside',
    { class: 'md-sidebar', id: 'md-sidebar', 'aria-label': t('toc') },
    sidebarInner,
    sidebarResizer,
  );
  const scrim = h('div', { class: 'md-scrim', hidden: true, 'aria-hidden': 'true' });
  const progressSpan = h('span');
  const progressBar = h('div', { class: 'md-progress', 'aria-hidden': 'true' }, progressSpan);
  const notice = h('div', { class: 'md-notice', hidden: true, role: 'status' });

  const article = h('article', { class: 'md-article', id: 'md-content', tabindex: '-1' });

  const rawCount = h('span', { class: 'md-raw-count' });
  const rawCopyButton = h('button', {
    type: 'button',
    class: 'md-raw-copy',
    'data-md-action': 'copy-raw',
    html: `${icons.copy}<span>${t('copySource')}</span>`,
  });
  const rawPre = h('pre', { class: 'md-raw', hidden: true });
  const rawHead = h(
    'div',
    { class: 'md-raw-head' },
    h('span', {
      class: 'md-raw-title',
      html: `${icons.codeBlock}<span>${t('markdownSource')}</span>`,
    }),
    h('div', { class: 'md-raw-actions' }, rawCount, rawCopyButton),
  );
  const rawView = h('div', { class: 'md-raw-view', hidden: true }, rawHead, rawPre);

  const main = h('main', { class: 'md-main md-scroll' }, notice, article, rawView);

  const topButton = makeIconButton('top', icons.arrowUp, t('backToTop'), 'md-top');

  const lightboxImage = h('img', { alt: '' });
  const lightboxCaption = h('div', { class: 'md-lightbox-caption' });
  const lightboxCount = h('span', { class: 'md-lightbox-count' });
  const lightboxClose = h('button', {
    type: 'button',
    class: 'md-lightbox-close',
    'aria-label': t('close'),
    html: icons.close,
  });
  const lightboxPrev = h('button', {
    type: 'button',
    class: 'md-lightbox-nav',
    'data-dir': 'prev',
    'aria-label': t('previousImage'),
    html: icons.chevronLeft,
  });
  const lightboxNext = h('button', {
    type: 'button',
    class: 'md-lightbox-nav',
    'data-dir': 'next',
    'aria-label': t('nextImage'),
    html: icons.chevronRight,
  });
  const lightboxFigure = h(
    'figure',
    { class: 'md-lightbox-figure' },
    lightboxImage,
    lightboxCaption,
  );
  const lightbox = h(
    'div',
    {
      class: 'md-lightbox',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('imagePreview'),
    },
    h('div', { class: 'md-lightbox-bar' }, lightboxCount, lightboxClose),
    lightboxPrev,
    lightboxFigure,
    lightboxNext,
  );

  const toastElement = h('div', { class: 'md-toast', role: 'status', hidden: true });
  const toast = createToast(toastElement);

  const root = h('div', { class: 'md-app', dataset: { mdReader: '1', mdToc: 'open', mdRaw: '0' } });
  root.append(
    h('a', { class: 'md-skip-link', href: '#md-content', text: t('skipToContent') }),
    progressBar,
    toolbar,
    h('div', { class: 'md-body' }, sidebar, scrim, main),
    topButton,
    lightbox,
    toastElement,
  );

  container.append(root);
  document.documentElement.dataset.mdApp = '1';

  /* ------------------------------------------------------------- refs */
  const tocLinks = [];

  /* ------------------------------------------------------------- theming */
  let customSheet = null;
  let customStyleElement = null;

  function applyCustomCss() {
    if (customSheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== customSheet,
      );
      customSheet = null;
    }
    customStyleElement?.remove();
    customStyleElement = null;
    const css = String(state.settings.customCss || '').trim();
    if (!css) return;
    try {
      if (document.adoptedStyleSheets && typeof CSSStyleSheet === 'function') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        customSheet = sheet;
        return;
      }
    } catch {
      /* fall through to a style element */
    }
    customStyleElement = h('style', { class: 'md-custom-css' });
    customStyleElement.textContent = css;
    root.append(customStyleElement);
  }

  const TOC_DEFAULT_WIDTH = 272;
  const TOC_MIN_WIDTH = 200;

  function maxTocWidth() {
    return Math.max(TOC_MIN_WIDTH, Math.floor(window.innerWidth * 0.35));
  }

  function clampTocWidth(value) {
    const width = Number(value);
    const fallback = Number.isFinite(width) ? width : TOC_DEFAULT_WIDTH;
    return Math.min(maxTocWidth(), Math.max(TOC_MIN_WIDTH, Math.round(fallback)));
  }

  function applySidebarWidth() {
    const width = clampTocWidth(state.settings.tocWidth);
    state.settings.tocWidth = width;
    root.style.setProperty('--md-sidebar-width', `${width}px`);
    sidebarResizer.setAttribute('aria-valuenow', String(width));
    sidebarResizer.setAttribute('aria-valuemax', String(maxTocWidth()));
  }

  function setSidebarWidth(width, { persist = false } = {}) {
    const next = clampTocWidth(width);
    state.settings.tocWidth = next;
    root.style.setProperty('--md-sidebar-width', `${next}px`);
    sidebarResizer.setAttribute('aria-valuenow', String(next));
    sidebarResizer.setAttribute('aria-valuemax', String(maxTocWidth()));
    if (persist) commit({ tocWidth: next });
  }

  function applyTheme({ refreshDiagrams = true } = {}) {
    const html = document.documentElement;
    const theme = resolvedTheme(state.settings.theme);
    const themeChanged = state.appliedTheme !== null && state.appliedTheme !== theme;
    state.appliedTheme = theme;

    html.dataset.mdTheme = theme;
    if (!html.dataset.mdReader) html.dataset.mdReader = 'page';
    root.dataset.mdTheme = theme;
    root.dataset.mdWidth = state.settings.contentWidth || 'normal';
    root.dataset.mdFont = state.settings.fontFamily || 'sans';
    root.dataset.mdToc = state.settings.showToc === false ? 'closed' : 'open';
    applySidebarWidth();
    root.style.setProperty('--md-font-size', `${clampFontSize(state.settings.fontSize)}px`);
    root.style.setProperty('--md-line-height', String(clampLineHeight(state.settings.lineHeight)));
    applyCustomCss();
    updateThemeButton();
    updateZoomButton();
    updateWidthButton();
    updateTocButton();
    updateProgressVisibility();

    if (themeChanged && refreshDiagrams && state.result?.meta?.hasMermaid) {
      refreshDiagramTheme(theme);
    }
  }

  function refreshDiagramTheme(theme) {
    if (typeof renderer.enhance !== 'function') return;
    for (const block of qsa('.md-mermaid', article)) {
      delete block.dataset.mdRendered;
      delete block.dataset.mdError;
      const body = qs('.md-mermaid-body', block);
      if (body) body.textContent = '';
      const error = qs('.md-mermaid-error', block);
      if (error) {
        error.hidden = true;
        error.textContent = '';
      }
    }
    renderer.setTheme?.(theme);
    renderer.enhance(article, { theme }).catch(() => {});
  }

  function updateThemeButton() {
    const setting = state.settings.theme in THEME_LABELS ? state.settings.theme : 'auto';
    const effective = resolvedTheme(setting);
    const label = t(THEME_LABELS[setting]);
    const tip = t('themeTooltip', { name: label });
    themeButton.innerHTML = THEME_ICONS[effective] || icons.sun;
    themeButton.dataset.tip = tip;
    themeButton.setAttribute('aria-label', tip);
    themeButton.dataset.theme = setting;
  }

  function updateZoomButton() {
    const size = clampFontSize(state.settings.fontSize);
    const percent = Math.round((size / 16) * 100);
    fontZoom.textContent = `${percent}%`;
    const label = t('fontZoom', { percent });
    fontZoom.dataset.tip = label;
    fontZoom.setAttribute('aria-label', label);
    fontZoom.title = label;
  }

  function updateWidthButton() {
    const width = WIDTH_RING.includes(state.settings.contentWidth)
      ? state.settings.contentWidth
      : 'normal';
    const label = t(WIDTH_LABELS[width]);
    widthButton.dataset.tip = label;
    widthButton.setAttribute('aria-label', label);
    widthButton.dataset.width = width;
  }

  function updateTocButton() {
    const expanded = state.raw ? false : isMobile() ? state.drawerOpen : state.settings.showToc !== false;
    tocToggle.setAttribute('aria-expanded', String(Boolean(expanded)));
    tocToggle.classList.toggle('is-active', Boolean(expanded));
  }

  function updateRawButton() {
    rawButton.classList.toggle('is-active', state.raw);
    rawButton.setAttribute('aria-pressed', String(state.raw));
    const label = state.raw ? t('togglePreview') : t('toggleSource');
    rawButton.dataset.tip = label;
    rawButton.setAttribute('aria-label', label);
  }

  function updateProgressVisibility() {
    progressBar.hidden = state.settings.readingProgress === false;
  }

  function applySettings(patch, { persist = false } = {}) {
    if (!patch || typeof patch !== 'object') return;
    const redecorate = REDECORATE_KEYS.some((key) => key in patch);
    Object.assign(state.settings, patch);
    applyTheme();
    if ('showToc' in patch) updateTocVisibility();
    if (redecorate) decorateArticle();
    if (persist) callbacks.onSettingsChange?.({ ...patch });
  }

  function commit(patch) {
    applySettings(patch, { persist: true });
  }

  /* ------------------------------------------------------------- toc */
  let headingEls = [];

  function buildToc(headings) {
    tocNav.textContent = '';
    tocLinks.length = 0;
    if (!headings.length) {
      tocNav.append(h('div', { class: 'md-toc-empty', text: t('noHeadings') }));
      return;
    }
    const minLevel = Math.min(...headings.map((heading) => heading.level));
    for (const heading of headings) {
      const level = Math.min(6, Math.max(1, heading.level - minLevel + 1));
      const label = heading.text || t('untitled');
      const link = h('a', {
        class: 'md-toc-link',
        href: `#${heading.id}`,
        title: label,
        dataset: { level: String(level), id: heading.id },
      });
      link.textContent = label;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        scrollToHeading(heading.id);
      });
      tocNav.append(link);
      tocLinks.push(link);
    }
  }

  function setActiveHeading(index) {
    if (index === state.activeHeadingIndex) return;
    state.activeHeadingIndex = index;
    tocLinks.forEach((link, i) => {
      const active = i === index;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    scrollActiveTocIntoView();
  }

  function scrollActiveTocIntoView() {
    const link = tocLinks[state.activeHeadingIndex];
    if (!link || isMobile() || !sidebarInner.isConnected) return;
    const linkRect = link.getBoundingClientRect();
    const boxRect = sidebarInner.getBoundingClientRect();
    if (!boxRect.height) return;
    if (linkRect.top < boxRect.top + 46) {
      sidebarInner.scrollBy({ top: linkRect.top - boxRect.top - 46, behavior: scrollBehavior() });
    } else if (linkRect.bottom > boxRect.bottom - 24) {
      sidebarInner.scrollBy({ top: linkRect.bottom - boxRect.bottom + 24, behavior: scrollBehavior() });
    }
  }

  function scrollToHeading(id) {
    const target = article.querySelector(`#${CSS.escape(id)}`);
    if (!target) return;
    const offset = 20;
    const top =
      target.getBoundingClientRect().top -
      main.getBoundingClientRect().top +
      main.scrollTop -
      offset;
    main.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
    try {
      history.replaceState(null, '', `#${id}`);
    } catch {
      /* history may be unavailable on some pages */
    }
    closeDrawer();
    const index = headingEls.indexOf(target);
    if (index >= 0) setActiveHeading(index);
    focusSilently(target);
    target.classList.add('md-focus-target');
    setTimeout(() => target.classList.remove('md-focus-target'), 1200);
  }

  /* ------------------------------------------------------------- drawer */
  function updateTocVisibility() {
    root.dataset.mdToc = state.settings.showToc === false ? 'closed' : 'open';
    if (state.settings.showToc === false) closeDrawer();
    updateTocButton();
  }

  function openDrawer() {
    if (state.settings.showToc === false || !isMobile()) return;
    state.drawerOpen = true;
    root.dataset.mdDrawer = 'open';
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add('is-visible'));
    document.documentElement.classList.add('md-drawer-open');
    updateTocButton();
  }

  function closeDrawer() {
    if (!state.drawerOpen) {
      root.dataset.mdDrawer = 'closed';
      return;
    }
    state.drawerOpen = false;
    root.dataset.mdDrawer = 'closed';
    scrim.classList.remove('is-visible');
    document.documentElement.classList.remove('md-drawer-open');
    setTimeout(() => {
      if (!state.drawerOpen) scrim.hidden = true;
    }, 240);
    updateTocButton();
  }

  function toggleToc() {
    if (isMobile()) {
      if (state.settings.showToc === false) {
        applySettings({ showToc: true }, { persist: true });
        openDrawer();
        return;
      }
      if (state.drawerOpen) closeDrawer();
      else openDrawer();
      return;
    }
    commit({ showToc: state.settings.showToc === false });
  }

  /* ------------------------------------------------------------- scroll */
  let scrollFrame = 0;

  function requestScrollUpdate() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      updateScroll();
    });
  }

  function updateScroll() {
    if (state.destroyed) return;
    const max = main.scrollHeight - main.clientHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, main.scrollTop / max)) : 0;
    progressSpan.style.width = `${(ratio * 100).toFixed(2)}%`;
    const percent = Math.round(ratio * 100);
    docProgress.hidden = ratio < 0.005;
    docProgress.textContent = t('percentRead', { percent });
    docProgress.title = t('readingProgress');
    docProgress.setAttribute('aria-label', t('percentRead', { percent }));
    topButton.classList.toggle('is-visible', main.scrollTop > 520);
    updateProgressVisibility();

    if (state.raw) return;

    const threshold = main.getBoundingClientRect().top + 120;
    let active = headingEls.length ? 0 : -1;
    for (let i = 0; i < headingEls.length; i += 1) {
      if (headingEls[i].getBoundingClientRect().top <= threshold) active = i;
      else break;
    }
    if (active === -1) {
      setActiveHeading(-1);
      return;
    }
    const atBottom = main.scrollTop + main.clientHeight >= main.scrollHeight - 6;
    if (atBottom && headingEls.length) active = headingEls.length - 1;
    setActiveHeading(active);
  }

  /* ------------------------------------------------------------- render */
  function updateHeader() {
    const meta = state.result?.meta || {};
    const fallback = source.title || baseName(source.url || source.path || '') || '';
    const title = String(meta.title || fallback || t('untitled')).trim();
    titleText.textContent = title;
    docTitle.title = title;

    const fileName = baseName(source.path || source.url || '');
    if (fileName && fileName !== title) {
      fileChip.textContent = fileName;
      fileChip.title = fileName;
      fileChip.hidden = false;
    } else {
      fileChip.hidden = true;
    }

    const metaNodes = [];
    const addMeta = (node) => {
      if (metaNodes.length) {
        metaNodes.push(h('span', { class: 'md-dot', 'aria-hidden': 'true' }));
      }
      metaNodes.push(node);
    };
    if (meta.wordCount) addMeta(h('span', { text: t('wordCount', { count: meta.wordCount }) }));
    if (meta.readingMinutes) {
      addMeta(h('span', { text: t('readingTime', { minutes: meta.readingMinutes }) }));
      addMeta(docProgress);
    }
    if (meta.hasMath) addMeta(h('span', { text: 'KaTeX' }));
    if (meta.hasMermaid) addMeta(h('span', { text: 'Mermaid' }));
    docMeta.replaceChildren(...metaNodes);

    rawCount.textContent = t('rawLines', { count: countLines(state.markdown) });

    if (typeof document !== 'undefined') {
      document.title = title ? `${title} · MD Reader Pro` : 'MD Reader Pro';
    }
  }

  function renderNotice(warnings) {
    notice.textContent = '';
    if (!warnings || !warnings.length) {
      notice.hidden = true;
      return;
    }
    const dismiss = h('button', {
      type: 'button',
      class: 'md-notice-dismiss',
      'aria-label': t('dismiss'),
      html: icons.close,
      onclick: () => {
        notice.hidden = true;
      },
    });
    notice.hidden = false;
    notice.append(
      h('span', { class: 'md-notice-icon', html: icons.alertTriangle }),
      h('span', {
        class: 'md-notice-text',
        text: t('renderWarningsText', { details: warnings.slice(0, 3).join(' · ') }),
      }),
      dismiss,
    );
  }

  function render() {
    const baseUrl =
      source.url ||
      (/^(https?|file):\/\//i.test(source.path || '') ? source.path : '');
    let result;
    try {
      result = renderer.render(state.markdown, {
        baseUrl,
        docPath: source.path || '',
        titleFallback: source.title || baseName(source.url || source.path || ''),
      });
    } catch (error) {
      result = {
        html: `<div class="md-render-error">${escapeHtml(error?.message || 'Render failed')}</div>`,
        meta: { title: source.title || '', warnings: [String(error?.message || '')] },
        headings: [],
        source: state.markdown,
      };
    }

    state.result = result;
    article.innerHTML = result.html;
    rawPre.textContent = state.markdown;
    state.activeHeadingIndex = -1;

    headingEls = (result.headings || [])
      .map((heading) => article.querySelector(`#${CSS.escape(heading.id)}`))
      .filter(Boolean);

    buildToc(result.headings || []);
    updateHeader();
    renderNotice(result.meta?.warnings);
    decorateArticle();
    updateScroll();

    const theme = resolvedTheme(state.settings.theme);
    renderer.setTheme?.(theme);
    if (typeof renderer.enhance === 'function') {
      renderer.enhance(article, { theme }).catch(() => {});
    }

  }

  /* ------------------------------------------------------------- decorate */
  function decorateLinks() {
    const newTab = state.settings.externalLinksNewTab !== false;
    for (const link of qsa('a[href]', article)) {
      const href = link.getAttribute('href') || '';
      if (!/^https?:/i.test(href)) continue;
      if (newTab) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else {
        link.removeAttribute('target');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    }
  }

  function decorateImages() {
    const zoom = state.settings.zoomImages !== false;
    const images = qsa('img', article);
    images.forEach((image, index) => {
      if (!image.hasAttribute('loading')) {
        image.loading = index < 3 ? 'eager' : 'lazy';
      }
      image.decoding = 'async';
      const insideLink = Boolean(image.closest('a'));
      if (zoom && !insideLink) {
        image.classList.add('md-zoomable');
        image.setAttribute('tabindex', '0');
        image.setAttribute('role', 'button');
        image.setAttribute(
          'aria-label',
          image.alt ? t('imagePreviewOf', { alt: image.alt }) : t('imagePreview'),
        );
      } else {
        image.classList.remove('md-zoomable');
        if (image.getAttribute('role') === 'button') image.removeAttribute('role');
        image.removeAttribute('tabindex');
        image.removeAttribute('aria-label');
      }
    });
  }

  function decorateCode() {
    const lineNumbers = Boolean(state.settings.codeLineNumbers);
    const wrap = Boolean(state.settings.codeWrap);
    for (const block of qsa('.md-code', article)) {
      block.classList.toggle('md-code-wrap', wrap);
      const pre = qs('pre', block);
      const code = pre?.querySelector('code');
      let gutter = qs('.md-code-gutter', block);
      if (!lineNumbers || !code) {
        gutter?.remove();
        block.classList.remove('has-gutter');
        continue;
      }
      if (!gutter) {
        gutter = h('div', { class: 'md-code-gutter', 'aria-hidden': 'true' });
        pre.before(gutter);
      }
      const lines = Math.max(1, countLines(code.textContent.replace(/\n+$/, '')));
      if (gutter.dataset.count !== String(lines)) {
        gutter.textContent = Array.from({ length: lines }, (_, i) => String(i + 1)).join('\n');
        gutter.dataset.count = String(lines);
      }
      block.classList.add('has-gutter');
      const copy = qs('.md-code-copy', block);
      if (copy && !copy.dataset.labelReady) {
        copy.textContent = t('copyCode');
        copy.dataset.labelReady = '1';
      }
    }
  }

  function decorateMermaid() {
    for (const block of qsa('.md-mermaid', article)) {
      block.setAttribute('role', 'group');
      block.setAttribute('aria-label', t('mermaidDiagram'));
      if (qs('.md-mermaid-toolbar', block)) continue;
      const toggle = h('button', {
        type: 'button',
        class: 'md-mermaid-toggle',
        'data-md-mermaid-toggle': '',
        'aria-expanded': 'false',
        text: t('showDiagramSource'),
      });
      block.prepend(
        h(
          'div',
          { class: 'md-mermaid-toolbar' },
          h('span', {
            class: 'md-mermaid-label',
            html: `${icons.sparkles}<span>Mermaid</span>`,
          }),
          toggle,
        ),
      );
    }
  }

  function decorateFootnotes() {
    for (const section of qsa('.footnotes, .md-footnotes', article)) {
      section.classList.add('md-footnotes');
      if (!qs('.md-footnotes-title', section)) {
        section.prepend(h('div', { class: 'md-footnotes-title', text: t('footnotes') }));
      }
    }
  }

  function decorateFrontMatter() {
    for (const card of qsa('.md-frontmatter', article)) {
      if (!qs('.md-frontmatter-title', card)) {
        card.prepend(h('div', { class: 'md-frontmatter-title', text: t('documentInfo') }));
      }
    }
  }

  function decorateArticle() {
    decorateLinks();
    decorateImages();
    decorateCode();
    decorateMermaid();
    decorateFootnotes();
    decorateFrontMatter();
  }

  /* ------------------------------------------------------------- actions */
  function setRaw(next) {
    state.raw = Boolean(next);
    root.dataset.mdRaw = state.raw ? '1' : '0';
    article.hidden = state.raw;
    rawView.hidden = !state.raw;
    rawPre.hidden = !state.raw;
    if (state.raw) closeDrawer();
    updateRawButton();
    updateTocButton();
    requestScrollUpdate();
  }

  function cycleTheme() {
    const setting = state.settings.theme === 'auto' ? resolvedTheme('auto') : state.settings.theme;
    const index = Math.max(0, THEME_RING.indexOf(setting));
    commit({ theme: THEME_RING[(index + 1) % THEME_RING.length] });
  }

  function changeFont(delta) {
    const next = clampFontSize(clampFontSize(state.settings.fontSize) + delta);
    if (next === clampFontSize(state.settings.fontSize)) return;
    commit({ fontSize: next });
  }

  function cycleWidth() {
    const current = WIDTH_RING.includes(state.settings.contentWidth)
      ? state.settings.contentWidth
      : 'normal';
    const index = WIDTH_RING.indexOf(current);
    commit({ contentWidth: WIDTH_RING[(index + 1) % WIDTH_RING.length] });
  }

  async function copyMarkdown(button, text = state.markdown) {
    const ok = await copyText(text);
    if (!ok) {
      toast.show(t('copyFailedToast'), { error: true });
      return;
    }
    toast.show(t('markdownCopied'));
    if (!button) return;
    const label = button.dataset.tip;
    button.classList.add('is-success');
    button.innerHTML = icons.check;
    button.dataset.tip = t('copied');
    button.setAttribute('aria-label', t('copied'));
    setTimeout(() => {
      if (button.dataset.mdAction === 'copy-raw') {
        button.innerHTML = `${icons.copy}<span>${t('copySource')}</span>`;
      } else {
        button.innerHTML = icons.copy;
      }
      button.classList.remove('is-success');
      if (label) button.dataset.tip = label;
      button.setAttribute('aria-label', label || t('copyMarkdown'));
    }, 1600);
  }

  async function copyCode(button) {
    const code = button.closest('.md-code')?.querySelector('code');
    if (!code) return;
    const ok = await copyText(code.textContent);
    button.textContent = ok ? t('copied') : t('copyFailed');
    button.classList.toggle('is-success', ok);
    button.classList.toggle('is-error', !ok);
    setTimeout(() => {
      button.textContent = t('copyCode');
      button.classList.remove('is-success', 'is-error');
    }, 1600);
  }

  /* ------------------------------------------------------------- lightbox */
  function collectImages() {
    return qsa('img.md-zoomable', article).filter((image) => !image.closest('a'));
  }

  function showLightboxImage() {
    const image = state.images[state.imageIndex];
    if (!image) return;
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt || '';
    const caption = image.closest('figure')?.querySelector('figcaption')?.textContent?.trim();
    const text = caption || image.alt || '';
    lightboxCaption.textContent = text;
    lightboxCaption.hidden = !text;
    lightboxCount.textContent =
      state.images.length > 1
        ? t('imageCount', { current: state.imageIndex + 1, total: state.images.length })
        : '';
    const multiple = state.images.length > 1;
    lightboxPrev.hidden = !multiple;
    lightboxNext.hidden = !multiple;
  }

  function openLightbox(image) {
    state.images = collectImages();
    const index = state.images.indexOf(image);
    state.imageIndex = index >= 0 ? index : 0;
    if (!state.images.length) return;
    state.lastFocused = document.activeElement;
    showLightboxImage();
    lightbox.hidden = false;
    document.documentElement.classList.add('md-lightbox-open');
    lightboxClose.focus({ preventScroll: true });
  }

  function stepImage(delta) {
    if (state.images.length < 2) return;
    state.imageIndex = (state.imageIndex + delta + state.images.length) % state.images.length;
    showLightboxImage();
  }

  function closeLightbox() {
    if (lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxImage.removeAttribute('src');
    state.images = [];
    document.documentElement.classList.remove('md-lightbox-open');
    if (state.lastFocused && typeof state.lastFocused.focus === 'function') {
      state.lastFocused.focus({ preventScroll: true });
    }
    state.lastFocused = null;
  }

  function trapLightboxFocus(event) {
    const focusables = [lightboxClose, lightboxPrev, lightboxNext].filter(
      (node) => !node.hidden,
    );
    if (!focusables.length) return;
    const index = focusables.indexOf(document.activeElement);
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        focusables[focusables.length - 1].focus();
      }
    } else if (index === -1 || index === focusables.length - 1) {
      event.preventDefault();
      focusables[0].focus();
    }
  }

  /* ------------------------------------------------------------- events */
  function handleAction(action, button) {
    switch (action) {
      case 'toggle-toc':
        toggleToc();
        break;
      case 'theme':
        cycleTheme();
        break;
      case 'font-smaller':
        changeFont(-1);
        break;
      case 'font-larger':
        changeFont(1);
        break;
      case 'reset-font':
        commit({ fontSize: 16 });
        break;
      case 'width':
        cycleWidth();
        break;
      case 'raw':
        setRaw(!state.raw);
        break;
      case 'copy':
        copyMarkdown(button);
        break;
      case 'copy-raw':
        copyMarkdown(button, state.markdown);
        break;
      case 'print':
        closeLightbox();
        window.print();
        break;
      case 'top':
        main.scrollTo({ top: 0, behavior: scrollBehavior() });
        break;
      case 'open-file':
        callbacks.onOpenFile?.();
        break;
      default:
        break;
    }
  }

  const onRootClick = (event) => {
    const actionButton = event.target.closest('[data-md-action]');
    if (actionButton) {
      handleAction(actionButton.dataset.mdAction, actionButton);
      return;
    }
    if (event.target.closest('.md-scrim')) closeDrawer();
  };

  const onArticleClick = (event) => {
    const codeButton = event.target.closest('[data-md-copy], .md-code-copy');
    if (codeButton) {
      event.preventDefault();
      copyCode(codeButton);
      return;
    }
    const mermaidToggle = event.target.closest('[data-md-mermaid-toggle]');
    if (mermaidToggle) {
      event.preventDefault();
      const block = mermaidToggle.closest('.md-mermaid');
      if (block) {
        const open = block.classList.toggle('is-src');
        mermaidToggle.setAttribute('aria-expanded', String(open));
        mermaidToggle.textContent = open ? t('hideDiagramSource') : t('showDiagramSource');
      }
      return;
    }
    const image = event.target.closest('img.md-zoomable');
    if (image) {
      event.preventDefault();
      openLightbox(image);
      return;
    }
    const link = event.target.closest('a[href^="#"]');
    if (link) {
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      if (id && article.querySelector(`#${CSS.escape(id)}`)) {
        event.preventDefault();
        scrollToHeading(id);
      }
    }
  };

  const onArticleKeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const image = event.target.closest('img.md-zoomable');
    if (image) {
      event.preventDefault();
      openLightbox(image);
    }
  };

  const onScrimClick = () => closeDrawer();

  const onLightboxClick = (event) => {
    if (event.target === lightbox || event.target === lightboxFigure) {
      closeLightbox();
      return;
    }
    if (event.target.closest('.md-lightbox-close')) {
      closeLightbox();
      return;
    }
    const nav = event.target.closest('[data-dir]');
    if (nav) stepImage(nav.dataset.dir === 'prev' ? -1 : 1);
  };

  const onKeydown = (event) => {
    if (!lightbox.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepImage(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepImage(1);
      } else if (event.key === 'Tab') {
        trapLightboxFocus(event);
      }
      return;
    }
    if (event.key === 'Escape' && state.drawerOpen) closeDrawer();
  };

  const onResize = () => {
    if (!isMobile() && state.drawerOpen) closeDrawer();
    applySidebarWidth();
    updateTocButton();
    requestScrollUpdate();
  };

  const onMediaChange = () => {
    if (!isMobile()) closeDrawer();
    updateTocButton();
  };

  const onScroll = () => requestScrollUpdate();

  /* ------------------------------------------------------- toc resizer */
  let resizePointerId = null;
  let lastResizeDown = 0;

  function onResizeStart(event) {
    if (isMobile() || event.button !== 0) return;
    event.preventDefault();
    const now = Date.now();
    if (event.detail >= 2 || now - lastResizeDown < 350) {
      lastResizeDown = 0;
      commit({ tocWidth: TOC_DEFAULT_WIDTH });
      return;
    }
    lastResizeDown = now;
    resizePointerId = event.pointerId;
    root.dataset.mdResizing = '1';
    sidebarResizer.classList.add('is-dragging');
    window.addEventListener('pointermove', onResizeMove, { passive: true });
    window.addEventListener('pointerup', onResizeEnd);
    window.addEventListener('pointercancel', onResizeEnd);
  }

  function onResizeMove(event) {
    if (event.pointerId !== resizePointerId) return;
    setSidebarWidth(event.clientX);
  }

  function onResizeEnd(event) {
    if (event.pointerId !== resizePointerId) return;
    resizePointerId = null;
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onResizeEnd);
    window.removeEventListener('pointercancel', onResizeEnd);
    sidebarResizer.classList.remove('is-dragging');
    delete root.dataset.mdResizing;
    commit({ tocWidth: state.settings.tocWidth });
  }

  function onResizeKeydown(event) {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      commit({
        tocWidth: state.settings.tocWidth + (event.key === 'ArrowLeft' ? -step : step),
      });
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault();
      commit({ tocWidth: TOC_DEFAULT_WIDTH });
    }
  }

  sidebarResizer.addEventListener('pointerdown', onResizeStart);
  sidebarResizer.addEventListener('keydown', onResizeKeydown);
  sidebarResizer.addEventListener('dblclick', () => commit({ tocWidth: TOC_DEFAULT_WIDTH }));

  /* ------------------------------------------------------------- wiring */
  root.addEventListener('click', onRootClick);
  article.addEventListener('click', onArticleClick);
  article.addEventListener('keydown', onArticleKeydown);
  scrim.addEventListener('click', onScrimClick);
  lightbox.addEventListener('click', onLightboxClick);
  lightboxPrev.addEventListener('click', () => stepImage(-1));
  lightboxNext.addEventListener('click', () => stepImage(1));
  main.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);
  mobileQuery.addEventListener?.('change', onMediaChange);
  const stopColorSchemeWatch = watchColorScheme(() => {
    if (state.settings.theme === 'auto') applyTheme();
  });

  /* ------------------------------------------------------------- boot */
  root.dataset.mdDrawer = 'closed';
  applyTheme({ refreshDiagrams: false });
  render();
  setRaw(false);
  updateScroll();

  // Deep link: scroll to the heading in the URL once the article exists.
  if (location.hash.length > 1) {
    const initialId = decodeURIComponent(location.hash.slice(1));
    if (article.querySelector(`#${CSS.escape(initialId)}`)) {
      setTimeout(() => scrollToHeading(initialId), 80);
    }
  }

  return {
    el: root,

    setMarkdown(next) {
      if (state.destroyed) return;
      const max = main.scrollHeight - main.clientHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, main.scrollTop / max)) : 0;
      state.markdown = String(next ?? '');
      render();
      requestAnimationFrame(() => {
        const nextMax = main.scrollHeight - main.clientHeight;
        if (nextMax > 0 && ratio > 0) {
          main.scrollTo({ top: Math.round(nextMax * ratio) });
        }
        requestScrollUpdate();
      });
    },

    setSettings(patch) {
      if (state.destroyed) return;
      applySettings(patch, { persist: false });
      if ('showToc' in (patch || {})) updateTocVisibility();
      if ('readingProgress' in (patch || {})) updateProgressVisibility();
    },

    getSettings() {
      return { ...state.settings };
    },

    scrollToHeading(id) {
      scrollToHeading(id);
    },

    scrollToTop() {
      main.scrollTo({ top: 0, behavior: scrollBehavior() });
    },

    toggleToc() {
      toggleToc();
    },

    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      root.removeEventListener('click', onRootClick);
      article.removeEventListener('click', onArticleClick);
      article.removeEventListener('keydown', onArticleKeydown);
      scrim.removeEventListener('click', onScrimClick);
      lightbox.removeEventListener('click', onLightboxClick);
      main.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', onResize);
      mobileQuery.removeEventListener?.('change', onMediaChange);
      stopColorSchemeWatch?.();
      toast.hide();
      if (customSheet) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          (sheet) => sheet !== customSheet,
        );
        customSheet = null;
      }
      customStyleElement?.remove();
      customStyleElement = null;
      document.documentElement.classList.remove('md-lightbox-open', 'md-drawer-open');
      delete document.documentElement.dataset.mdApp;
      root.remove();
    },
  };
}

export default mountReaderApp;
