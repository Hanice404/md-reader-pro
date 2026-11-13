/** Small shared helpers used by every surface. */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

export function debounce(fn, wait = 150) {
  let timer = 0;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let timer = 0;
  let lastArgs;
  const invoke = () => {
    last = Date.now();
    timer = 0;
    fn(...lastArgs);
  };
  return (...args) => {
    lastArgs = args;
    const remaining = wait - (Date.now() - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = 0;
      invoke();
    } else if (!timer) {
      timer = setTimeout(invoke, remaining);
    }
  };
}

/** GitHub-flavoured heading slug with CJK support and duplicate suffixes. */
export function createSlugger() {
  const seen = new Map();
  return function slugify(text) {
    const base =
      String(text ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '-')
        .replace(/[^\p{L}\p{N}\-_]+/gu, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '') || 'section';
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** Approximate word count that also counts CJK characters individually. */
export function countWords(text) {
  const source = String(text ?? '');
  const cjk = (source.match(/[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g) || []).length;
  const latin = (source.replace(/[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
  return cjk + latin;
}

export function readingMinutes(wordCount) {
  return Math.max(1, Math.round(wordCount / 240));
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function baseName(pathOrUrl, fallback = '') {
  try {
    const clean = String(pathOrUrl).split(/[?#]/)[0];
    const name = decodeURIComponent(clean.split('/').filter(Boolean).pop() || '');
    return name || fallback;
  } catch {
    return fallback;
  }
}

export function isProbablyUrl(value) {
  return /^(https?|file):\/\//i.test(String(value || ''));
}

/** Resolve a possibly-relative link/image against the document URL. */
export function resolveUrl(href, baseUrl) {
  if (!href) return '';
  try {
    return new URL(href, baseUrl || undefined).href;
  } catch {
    return href;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadText(filename, text, type = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
