/**
 * Mermaid rendering.
 *
 * `render()` only emits inert placeholders; `enhance()` lazily imports mermaid
 * (so the ~1 MB dependency stays in a lazy chunk), renders each placeholder,
 * sanitises the SVG and reports failures as visible cards instead of throwing.
 */
import { sanitizeSvg } from './sanitize.js';

const THEME_NAMES = Object.freeze({
  light: 'default',
  dark: 'dark',
  sepia: 'neutral',
  auto: 'default',
});

const MAX_ERROR_LENGTH = 600;

function messageOf(error) {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message || '')
      : String(error ?? '');
  const trimmed = message.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '未知错误';
  return trimmed.length > MAX_ERROR_LENGTH ? `${trimmed.slice(0, MAX_ERROR_LENGTH)}…` : trimmed;
}

function countErrors(blocks) {
  let errors = 0;
  for (const block of blocks) {
    if (block.dataset && block.dataset.mdError === '1') errors += 1;
  }
  return errors;
}

function clearError(block) {
  const box = block.querySelector('.md-mermaid-error');
  if (box) {
    box.hidden = true;
    box.textContent = '';
  }
  block.removeAttribute('data-md-error');
}

function showError(block, message, themeName, retryable = false) {
  block.dataset.mdError = '1';
  // Deterministic diagram errors are not retried for the same theme; a failed
  // lazy import is, so the next enhance() call can try again.
  block.dataset.theme = retryable ? '' : themeName;
  block.removeAttribute('data-md-rendered');
  const body = block.querySelector('.md-mermaid-body');
  if (body) body.textContent = '';
  const source = block.querySelector('.md-mermaid-src')?.textContent || '';
  const box = block.querySelector('.md-mermaid-error');
  if (box) {
    box.hidden = false;
    box.textContent = `Mermaid 渲染失败：${message}\n\n${source}`.trim();
  }
}

/** Remove the temporary element mermaid leaves behind while measuring. */
function cleanupRenderNode(id) {
  if (!id || typeof document === 'undefined') return;
  try {
    document.getElementById(id)?.remove();
  } catch {
    /* ignore */
  }
}

export function createMermaidRenderer() {
  /** @type {Promise<any>|null} */
  let loader = null;
  let initializedTheme = null;

  async function load() {
    if (!loader) {
      loader = import('mermaid')
        .then((module) => module.default || module)
        .catch((error) => {
          loader = null;
          throw error;
        });
    }
    return loader;
  }

  async function withTheme(themeName) {
    const mermaid = await load();
    if (initializedTheme !== themeName) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: themeName,
        fontFamily: 'inherit',
        suppressErrorRendering: true,
        htmlLabels: false,
        flowchart: { htmlLabels: false, useMaxWidth: true, curve: 'basis' },
        sequence: { useMaxWidth: true },
        gantt: { useMaxWidth: true },
        class: { htmlLabels: false, useMaxWidth: true },
        state: { useMaxWidth: true },
        er: { useMaxWidth: true },
        journey: { useMaxWidth: true },
        pie: { useMaxWidth: true },
      });
      initializedTheme = themeName;
    }
    return mermaid;
  }

  async function renderBlock(mermaid, block, themeName, index) {
    const body = block.querySelector('.md-mermaid-body');
    if (!body) return;
    const source = block.querySelector('.md-mermaid-src')?.textContent || '';
    if (!source.trim()) throw new Error('图表源码为空');

    const id = `md-mermaid-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    let svg = '';
    try {
      const result = await mermaid.render(id, source);
      svg = typeof result === 'string' ? result : result?.svg || '';
    } finally {
      cleanupRenderNode(id);
    }
    const clean = sanitizeSvg(svg);
    if (!clean || !clean.includes('<svg')) {
      throw new Error('图表未通过安全清洗');
    }
    body.innerHTML = clean;
    block.dataset.mdRendered = '1';
    block.dataset.theme = themeName;
    clearError(block);
  }

  async function enhance(root, themeName = 'light') {
    if (!root || typeof root.querySelectorAll !== 'function') return { mermaidErrors: 0 };
    const blocks = Array.from(root.querySelectorAll('.md-mermaid'));
    if (!blocks.length) return { mermaidErrors: 0 };

    const pending = [];
    for (const block of blocks) {
      const rendered = block.dataset?.mdRendered === '1';
      const errored = block.dataset?.mdError === '1';
      const sameTheme = block.dataset?.theme === themeName;
      if ((rendered || errored) && sameTheme) continue;
      if (rendered || errored) {
        // Theme changed (or a stale result): drop the previous output first.
        const body = block.querySelector('.md-mermaid-body');
        if (body) body.textContent = '';
        block.removeAttribute('data-md-rendered');
        clearError(block);
      }
      pending.push(block);
    }

    if (!pending.length) return { mermaidErrors: countErrors(blocks) };

    let mermaid;
    try {
      mermaid = await withTheme(themeName);
    } catch (error) {
      for (const block of pending) showError(block, messageOf(error), themeName, true);
      return { mermaidErrors: countErrors(blocks) };
    }

    let index = 0;
    for (const block of pending) {
      try {
        await renderBlock(mermaid, block, themeName, index);
        index += 1;
      } catch (error) {
        showError(block, messageOf(error), themeName);
        index += 1;
      }
    }
    return { mermaidErrors: countErrors(blocks) };
  }

  return { enhance };
}

export { THEME_NAMES };
