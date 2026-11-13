/**
 * MD Reader Pro — Markdown renderer.
 *
 * Public contract: docs/CONTRACT.md §3.
 *
 * `render()` is synchronous and safe: it never throws, always returns the
 * documented shape, and sanitises every byte of HTML it produces. Expensive
 * diagram work happens in the async `enhance()`.
 */
import { countWords, escapeAttr, escapeHtml, readingMinutes } from '../shared/util.js';
import { buildInlineToc, createMarkdown, TOC_MARKER } from './markdown.js';
import { renderFrontMatterCard, splitFrontMatter } from './frontmatter.js';
import { sanitizeHtml } from './sanitize.js';
import { createMermaidRenderer } from './mermaid.js';

export const DEFAULT_RENDER_OPTIONS = Object.freeze({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  math: true,
  mermaid: true,
  highlight: true,
  emoji: true,
  frontMatter: 'card',
  rawHtml: true,
  toc: true,
});

const FRONT_MATTER_MODES = new Set(['card', 'hide', 'raw']);
const LARGE_DOC_BYTES = 4 * 1024 * 1024;
const FALLBACK_LIMIT = 40000;

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function byteLength(text) {
  const value = String(text ?? '');
  if (encoder) return encoder.encode(value).length;
  try {
    return new Blob([value]).size;
  } catch {
    return value.length;
  }
}

function normalizeOptions(options) {
  const merged = { ...DEFAULT_RENDER_OPTIONS };
  if (!options || typeof options !== 'object') return merged;
  for (const key of Object.keys(DEFAULT_RENDER_OPTIONS)) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
    const value = options[key];
    if (key === 'frontMatter') {
      merged.frontMatter = FRONT_MATTER_MODES.has(value) ? value : DEFAULT_RENDER_OPTIONS.frontMatter;
    } else if (typeof DEFAULT_RENDER_OPTIONS[key] === 'boolean') {
      merged[key] = Boolean(value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function normalizeTheme(theme) {
  return theme === 'dark' || theme === 'sepia' ? theme : 'light';
}

/** Title value from front matter: only scalars/arrays make sense. */
function frontMatterTitle(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object') return '';
  const value = frontmatter.title ?? frontmatter.Title;
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(', ').trim();
  return '';
}

/**
 * Words in prose, not in code fences or URLs. CJK characters count
 * individually (shared `countWords`), Latin text counts whitespace tokens.
 */
function proseForCounting(markdown) {
  return String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[|*_~`=#]+/g, ' ');
}

function createEnv(context) {
  const ctx = context && typeof context === 'object' ? context : {};
  return {
    baseUrl: typeof ctx.baseUrl === 'string' ? ctx.baseUrl : '',
    docPath: typeof ctx.docPath === 'string' ? ctx.docPath : '',
    headings: [],
    slugger: null,
    tocUsed: false,
    tocExcludeIds: new Set(),
    features: { math: 0, mermaid: 0, code: 0 },
  };
}

/** Heading ids such as `location` are stripped by DOMPurify's DOM-clobbering
 * guard. Markdown headings are structured content, so put those ids back so
 * `headings[].id` always matches the DOM (and inline `#anchor` links work). */
function restoreHeadingIds(html, headings) {
  if (!headings.length) return html;
  const missing = headings.some((heading) => !html.includes(`id="${escapeAttr(heading.id)}"`));
  if (!missing) return html;
  try {
    const doc = new DOMParser().parseFromString(`<div id="md-render-root">${html}</div>`, 'text/html');
    const container = doc.getElementById('md-render-root');
    if (!container) return html;
    const nodes = container.querySelectorAll('h1,h2,h3,h4,h5,h6');
    const count = Math.min(nodes.length, headings.length);
    for (let index = 0; index < count; index += 1) {
      const node = nodes[index];
      if (!node.hasAttribute('id')) node.setAttribute('id', headings[index].id);
    }
    return container.innerHTML;
  } catch {
    return html;
  }
}

function fallbackHtml(source, message) {
  const excerpt = String(source ?? '').slice(0, FALLBACK_LIMIT);
  return (
    `<div class="md-render-error" role="alert"><p>${escapeHtml(message)}</p>` +
    `<pre>${escapeHtml(excerpt)}${source.length > FALLBACK_LIMIT ? '\n…' : ''}</pre></div>`
  );
}

export function createRenderer(options = {}) {
  const merged = normalizeOptions(options);
  const md = createMarkdown(merged);
  const mermaidRenderer = createMermaidRenderer();
  let currentTheme = 'light';

  return {
    options: merged,

    render(markdown, context = {}) {
      const source = String(markdown ?? '');
      const sourceBytes = byteLength(source);
      const warnings = [];
      const env = createEnv(context);

      try {
        const front = splitFrontMatter(source);
        if (front.error) warnings.push(`Front matter 解析失败（已忽略）：${front.error}`);

        let body = front.body;
        if (merged.frontMatter === 'raw' && front.raw) {
          body = front.raw.endsWith('\n') ? front.raw + body : `${front.raw}\n${body}`;
        }

        let html;
        try {
          html = md.render(body, env);
        } catch (error) {
          warnings.push(`Markdown 解析失败（已降级为原始文本）：${error?.message || error}`);
          html = fallbackHtml(body, 'Markdown 解析失败，已降级显示原始文本。');
          env.headings = [];
          env.features = { math: 0, mermaid: 0, code: 0 };
        }

        if (html.includes(TOC_MARKER)) {
          const toc = merged.toc ? buildInlineToc(env.headings, env.tocExcludeIds) : '';
          html = html.split(TOC_MARKER).join(toc);
        }

        const frontCard = merged.frontMatter === 'card' ? renderFrontMatterCard(front.frontmatter) : '';
        html = sanitizeHtml(frontCard + html, { baseUrl: env.baseUrl });

        if (sourceBytes > LARGE_DOC_BYTES) {
          warnings.push(
            `文档较大（${(sourceBytes / (1024 * 1024)).toFixed(1)} MB），渲染与滚动可能变慢。`,
          );
        }

        const headings = env.headings.filter((heading) => heading && heading.id);
        html = restoreHeadingIds(html, headings);
        const title =
          frontMatterTitle(front.frontmatter) ||
          headings.find((heading) => heading.level === 1 && heading.text)?.text ||
          String(context?.titleFallback ?? '').trim() ||
          '';

        const words = countWords(proseForCounting(body));

        return {
          html,
          meta: {
            title,
            frontmatter: front.frontmatter,
            hasMath: env.features.math > 0,
            hasMermaid: env.features.mermaid > 0,
            hasCode: env.features.code > 0,
            wordCount: words,
            readingMinutes: readingMinutes(words),
            warnings,
            sourceBytes,
          },
          headings: headings.map((heading) => ({
            level: heading.level,
            text: heading.text,
            id: heading.id,
          })),
          source,
        };
      } catch (error) {
        // Last-resort safety net: a renderer bug must not break the reader.
        warnings.push(`渲染失败：${error?.message || error}`);
        return {
          html: sanitizeHtml(fallbackHtml(source, '渲染失败，已降级显示原始文本。')),
          meta: {
            title: String(context?.titleFallback ?? '').trim(),
            frontmatter: null,
            hasMath: false,
            hasMermaid: false,
            hasCode: false,
            wordCount: countWords(proseForCounting(source)),
            readingMinutes: 1,
            warnings,
            sourceBytes,
          },
          headings: [],
          source,
        };
      }
    },

    setTheme(theme) {
      currentTheme = normalizeTheme(theme);
    },

    async enhance(rootElement, { theme } = {}) {
      const resolved = normalizeTheme(theme ?? currentTheme);
      currentTheme = resolved;
      if (!merged.mermaid) return { mermaidErrors: 0 };
      try {
        return await mermaidRenderer.enhance(rootElement, resolved);
      } catch {
        return { mermaidErrors: 0 };
      }
    },
  };
}

export default createRenderer;
