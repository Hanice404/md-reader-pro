/**
 * The Markdown pipeline: markdown-it + the extension plugins + the renderer
 * rules that produce the DOM contract in docs/CONTRACT.md §3.2.
 *
 * The renderer is deliberately split from `index.js`: this module owns tokens
 * and HTML production, `index.js` owns the public API, metadata and sanitising.
 */
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import attrs from 'markdown-it-attrs';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import deflist from 'markdown-it-deflist';
import abbr from 'markdown-it-abbr';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import ins from 'markdown-it-ins';
import mark from 'markdown-it-mark';
import { full as emoji } from 'markdown-it-emoji';
import container from 'markdown-it-container';
import multimdTable from 'markdown-it-multimd-table';
import githubAlerts from 'markdown-it-github-alerts';
import katexPlugin from '@traptitech/markdown-it-katex';
import katex from 'katex';
import { createSlugger, escapeAttr, escapeHtml } from '../shared/util.js';
import { highlightCode, normalizeInfoLang } from './highlight.js';

/** Placeholder inserted where `[[toc]]` appeared; replaced after the render. */
export const TOC_MARKER = '<nav class="md-toc-inline" data-md-toc="1"></nav>';

const TOC_SYNTAX = /^\[\[?\s*(?:_?toc_?)\s*\]\]?$/i;

const KATEX_OPTIONS = Object.freeze({
  throwOnError: false,
  trust: false,
  strict: 'ignore',
  errorColor: '#d1242f',
  output: 'htmlAndMathml',
});

/** Container type -> alert flavour, so `::: tip` reuses the alert styling. */
const CONTAINER_ALERT = Object.freeze({
  tip: 'tip',
  hint: 'tip',
  success: 'tip',
  note: 'note',
  info: 'note',
  important: 'important',
  warning: 'warning',
  warn: 'warning',
  danger: 'caution',
  caution: 'caution',
  error: 'caution',
  bug: 'caution',
});

const CONTAINER_TITLES = Object.freeze({
  tip: 'TIP',
  hint: 'TIP',
  success: 'TIP',
  note: 'NOTE',
  info: 'INFO',
  important: 'IMPORTANT',
  warning: 'WARNING',
  warn: 'WARNING',
  danger: 'DANGER',
  caution: 'CAUTION',
  error: 'ERROR',
  bug: 'BUG',
});

let decoder = null;

/** Decode the few HTML entities that can appear in inline HTML in a heading. */
function decodeEntities(text) {
  if (!text || text.indexOf('&') === -1) return text;
  try {
    if (!decoder && typeof document !== 'undefined') decoder = document.createElement('textarea');
    if (decoder) {
      decoder.innerHTML = text;
      return decoder.value;
    }
  } catch {
    /* fall through */
  }
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (match, name) => {
    if (name === 'amp') return '&';
    if (name === 'lt') return '<';
    if (name === 'gt') return '>';
    if (name === 'quot') return '"';
    if (name === 'nbsp') return ' ';
    return "'";
  });
}

/**
 * Plain text of an inline token, matching what the reader sees in the heading.
 * Markdown syntax is dropped: no backticks, no `:emoji:` shortcodes, no anchor.
 */
function inlinePlainText(inlineToken) {
  if (!inlineToken) return '';
  const children = inlineToken.children || [];
  let text = '';
  for (const child of children) {
    switch (child.type) {
      case 'text':
      case 'code_inline':
      case 'emoji':
        text += child.content;
        break;
      case 'image': {
        const alt = child.children?.length
          ? inlinePlainText({ children: child.children })
          : decodeEntities(child.content || '');
        text += alt;
        break;
      }
      case 'softbreak':
      case 'hardbreak':
        text += ' ';
        break;
      case 'html_inline':
        text += ` ${decodeEntities(String(child.content || '').replace(/<[^>]*>/g, ' '))} `;
        break;
      default:
        break;
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function parseContainerInfo(info) {
  const raw = String(info || '').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const rawType = (parts.shift() || 'note').toLowerCase();
  const type = rawType.replace(/[^a-z0-9-]/g, '') || 'note';
  const title = parts.join(' ').trim() || CONTAINER_TITLES[type] || type.toUpperCase();
  return { type, title };
}

function renderContainer(tokens, idx) {
  const token = tokens[idx];
  if (token.nesting === 1) {
    const { type, title } = parseContainerInfo(token.info);
    const flavour = CONTAINER_ALERT[type] || 'note';
    return (
      `<div class="md-container md-container-${escapeAttr(type)} md-alert md-alert-${flavour}">` +
      `<p class="md-alert-title">${escapeHtml(title)}</p>\n`
    );
  }
  return '</div>\n';
}

function mathToHtml(latex, displayMode, env) {
  if (env?.features) env.features.math += 1;
  try {
    return katex.renderToString(String(latex ?? ''), { ...KATEX_OPTIONS, displayMode });
  } catch (error) {
    // `throwOnError: false` should make this unreachable, but never let a
    // formula take down the whole document.
    return `<span class="katex-error" title="${escapeAttr(error?.message || 'KaTeX error')}">${escapeHtml(latex)}</span>`;
  }
}

/* ------------------------------------------------------------------ *
 * Inline math: \(...\) and \[...\] (KaTeX renderer; registered before
 * the backslash-escape rule so those delimiters are not eaten).
 * ------------------------------------------------------------------ */

function mathInlineDelimiter(open, close, displayMode) {
  return function mathInlineRule(state, silent) {
    const start = state.pos;
    if (state.src.slice(start, start + open.length) !== open) return false;
    const end = state.src.indexOf(close, start + open.length);
    if (end === -1 || end + close.length > state.posMax) return false;
    if (end === start + open.length) return false;
    if (silent) return true;
    const latex = state.src.slice(start + open.length, end);
    const token = state.push(displayMode ? 'math_inline_display' : 'math_inline_paren', 'math', 0);
    token.content = latex;
    token.markup = open;
    state.pos = end + close.length;
    return true;
  };
}

function mathBlockDelimiter(open, close, displayMode) {
  return function mathBlockRule(state, startLine, endLine, silent) {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.src.slice(start, start + open.length) !== open) return false;
    if (silent) return true;

    const firstLine = state.src.slice(start + open.length, max);
    const sameLineEnd = firstLine.indexOf(close);
    let content;
    let nextLine;

    if (sameLineEnd !== -1) {
      content = firstLine.slice(0, sameLineEnd);
      nextLine = startLine + 1;
    } else {
      const lines = [firstLine];
      let found = false;
      let line = startLine + 1;
      for (; line < endLine; line += 1) {
        const lineStart = state.bMarks[line] + state.tShift[line];
        const lineMax = state.eMarks[line];
        const text = state.src.slice(lineStart, lineMax);
        if (state.sCount[line] < state.blkIndent) break;
        const closeIndex = text.indexOf(close);
        if (closeIndex !== -1) {
          lines.push(text.slice(0, closeIndex));
          found = true;
          line += 1;
          break;
        }
        lines.push(text);
      }
      if (!found) return false;
      content = lines.join('\n');
      nextLine = line;
    }

    const token = state.push(displayMode ? 'math_block_bracket' : 'math_block_paren', 'math', 0);
    token.block = true;
    token.content = content;
    token.markup = open;
    token.map = [startLine, nextLine];
    state.line = nextLine;
    return true;
  };
}

/* ------------------------------------------------------------------ *
 * [[toc]]
 * ------------------------------------------------------------------ */

function tocBlockRule(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.sCount[startLine] < state.blkIndent) return false;
  const line = state.src.slice(start, max).trim();
  if (!TOC_SYNTAX.test(line)) return false;
  if (silent) return true;
  const token = state.push('md_toc', '', 0);
  token.block = true;
  token.map = [startLine, startLine + 1];
  state.line = startLine + 1;
  return true;
}

/**
 * Build the nested list used by `[[toc]]`. Headings that are the document
 * title (h1) or the heading that introduced the TOC itself are skipped.
 */
export function buildInlineToc(headings, excludeIds) {
  const list = (headings || []).filter(
    (heading) => heading && heading.id && heading.text && !excludeIds?.has?.(heading.id),
  );
  if (!list.length) return '';

  const hasH1 = list.some((heading) => heading.level === 1);
  const minLevel = Math.min(...list.map((heading) => heading.level));
  const baseLevel = hasH1 && minLevel < 2 ? 2 : minLevel;
  const items = list.filter((heading) => heading.level >= baseLevel);
  if (!items.length) return '';

  const root = { children: [] };
  const stack = [{ level: baseLevel - 1, node: root }];
  for (const heading of items) {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1].node : root;
    const node = { heading, children: [] };
    parent.children.push(node);
    stack.push({ level: heading.level, node });
  }

  const renderNodes = (nodes) =>
    `<ul>${nodes
      .map(
        (node) =>
          `<li><a href="#${escapeAttr(node.heading.id)}">${escapeHtml(node.heading.text)}</a>${
            node.children.length ? renderNodes(node.children) : ''
          }</li>`,
      )
      .join('')}</ul>`;

  return `<nav class="md-toc-inline" data-md-toc="1" aria-label="Table of contents">${renderNodes(
    root.children,
  )}</nav>`;
}

/* ------------------------------------------------------------------ *
 * Images: a standalone image with alt text becomes a figure + caption.
 * ------------------------------------------------------------------ */

function findStandaloneImage(inlineToken) {
  const children = (inlineToken.children || []).filter((child) => {
    if ((child.type === 'text' || child.type === 'html_inline') && !String(child.content || '').trim()) {
      return false;
    }
    return child.type !== 'softbreak' && child.type !== 'hardbreak';
  });
  if (children.length === 1 && children[0].type === 'image') {
    return { image: children[0], href: '' };
  }
  if (
    children.length === 3 &&
    children[0].type === 'link_open' &&
    children[1].type === 'image' &&
    children[2].type === 'link_close'
  ) {
    return { image: children[1], href: children[0].attrGet('href') || '' };
  }
  return null;
}

function figureTransform(state) {
  const tokens = state.tokens;
  for (let index = 0; index < tokens.length; index += 1) {
    const open = tokens[index];
    if (open.type !== 'paragraph_open') continue;
    const inline = tokens[index + 1];
    const close = tokens[index + 2];
    if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue;
    const found = findStandaloneImage(inline);
    if (!found) continue;

    const image = found.image;
    const src = image.attrGet('src') || '';
    if (!src) continue;
    const alt = image.children?.length
      ? state.md.renderer.renderInlineAsText(image.children, state.md.options, state.env)
      : String(image.content || '');
    const altText = alt.replace(/\s+/g, ' ').trim();
    if (!altText) continue; // no alt -> plain <img> per contract

    const title = image.attrGet('title') || '';
    let img = `<img src="${escapeAttr(src)}" alt="${escapeAttr(altText)}"`;
    if (title) img += ` title="${escapeAttr(title)}"`;
    img += '>';
    if (found.href) img = `<a href="${escapeAttr(found.href)}">${img}</a>`;

    const token = new state.Token('html_block', '', 0);
    token.block = true;
    token.content = `<figure class="md-figure">${img}<figcaption>${escapeHtml(altText)}</figcaption></figure>`;
    token.map = open.map;
    tokens.splice(index, 3, token);
  }
}

/* ------------------------------------------------------------------ *
 * markdown-it instance
 * ------------------------------------------------------------------ */

/**
 * @param {object} options merged renderer options
 */
export function createMarkdown(options) {
  const md = new MarkdownIt({
    html: Boolean(options.html && options.rawHtml),
    linkify: Boolean(options.linkify),
    typographer: Boolean(options.typographer),
    breaks: Boolean(options.breaks),
    highlight: false,
  });

  /* ---------------------------------------------------------- plugins */

  // markdown-it's default `validateLink` rejects `data:image/svg+xml` (and
  // other image types), which makes perfectly valid inline data-URI images
  // disappear into plain text. Allow image data URIs only; every other URL
  // still goes through markdown-it's allow-list and DOMPurify afterwards.
  const defaultValidateLink = md.validateLink ? md.validateLink.bind(md) : () => false;
  const IMAGE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|avif|svg\+xml)(?:[;,]|$)/i;
  md.validateLink = (url) => {
    const value = String(url ?? '').trim();
    if (IMAGE_DATA_URI.test(value)) return true;
    try {
      return defaultValidateLink(value);
    } catch {
      return false;
    }
  };

  md.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    tabIndex: false,
    // Per-render slugger: ids are stable between renders and duplicates get
    // `-1`, `-2`, ... suffixes (see docs/CONTRACT.md §3.1).
    slugifyWithState(text, state) {
      if (!state.env.slugger) state.env.slugger = createSlugger();
      return state.env.slugger(text);
    },
    permalink: false,
    failOnNonUnique: false,
    // The anchor link is added by the heading_close renderer instead, so the
    // heading text used for TOC/title never contains it.
    getTokensText: (tokens) => inlinePlainText({ children: tokens }),
  });

  md.use(attrs, { allowedAttributes: ['id', 'class', 'target', 'rel', 'width', 'height', 'title', 'align'] });
  md.use(footnote);
  md.use(taskLists, { enabled: false, label: false });
  md.use(deflist);
  md.use(abbr);
  md.use(sub);
  md.use(sup);
  md.use(ins);
  md.use(mark);
  if (options.emoji) md.use(emoji);
  md.use(container, 'md-container', { validate: () => true, render: renderContainer });
  md.use(multimdTable, { multiline: true, rowspan: true, headerless: true });
  md.use(githubAlerts, {
    classPrefix: 'md-alert',
    icons: {},
    titles: { note: 'NOTE', tip: 'TIP', important: 'IMPORTANT', warning: 'WARNING', caution: 'CAUTION' },
  });

  if (options.math) {
    // The plugin mutates its options (`blockClass`, `displayMode`), so it must
    // receive a plain copy — never the frozen shared defaults.
    md.use(katexPlugin, { ...KATEX_OPTIONS });
    // Wrap the plugin renderers so meta.hasMath reflects real usage.
    for (const ruleName of ['math_inline', 'math_block']) {
      const original = md.renderer.rules[ruleName];
      if (typeof original !== 'function') continue;
      md.renderer.rules[ruleName] = (tokens, idx, mdOptions, env, self) => {
        if (env?.features) env.features.math += 1;
        return original(tokens, idx, mdOptions, env, self);
      };
    }
    md.inline.ruler.before('escape', 'math_inline_paren', mathInlineDelimiter('\\(', '\\)', false));
    md.inline.ruler.before('escape', 'math_inline_bracket', mathInlineDelimiter('\\[', '\\]', true));
    md.inline.ruler.before('math_inline', 'math_inline_display', mathInlineDelimiter('$$', '$$', true));
    md.block.ruler.before('paragraph', 'math_block_bracket', mathBlockDelimiter('\\[', '\\]', true));
    md.renderer.rules.math_inline_paren = (tokens, idx, mdOptions, env) =>
      mathToHtml(tokens[idx].content, false, env);
    md.renderer.rules.math_inline_display = (tokens, idx, mdOptions, env) =>
      mathToHtml(tokens[idx].content, true, env);
    md.renderer.rules.math_block_bracket = (tokens, idx, mdOptions, env) =>
      mathToHtml(tokens[idx].content, true, env);
  }

  if (options.toc) {
    md.block.ruler.before('paragraph', 'md_toc', tocBlockRule);
    md.renderer.rules.md_toc = (tokens, idx, mdOptions, env) => {
      env.tocUsed = true;
      for (let back = idx - 1; back >= 0; back -= 1) {
        const candidate = tokens[back];
        if (candidate.type === 'heading_open') {
          const id = candidate.attrGet('id');
          if (id) env.tocExcludeIds.add(id);
          break;
        }
      }
      return TOC_MARKER;
    };
  }

  /* --------------------------------------------------------- headings */

  md.renderer.rules.heading_open = (tokens, idx, mdOptions, env, self) => {
    const token = tokens[idx];
    const level = Number(String(token.tag || 'h1').slice(1)) || 1;
    const inline = tokens[idx + 1];
    const text = inlinePlainText(inline);
    const id = token.attrGet('id') || '';
    env.headings.push({ level, text, id });
    token.attrJoin('class', 'md-heading');
    return self.renderToken(tokens, idx, mdOptions, env, self);
  };

  md.renderer.rules.heading_close = (tokens, idx, mdOptions, env, self) => {
    const open = tokens[idx - 2];
    const id = open && open.attrGet ? open.attrGet('id') : '';
    const anchorLink = id
      ? `<a class="md-anchor" href="#${escapeAttr(id)}" aria-hidden="true">#</a>`
      : '';
    return `${anchorLink}${self.renderToken(tokens, idx, mdOptions, env, self)}`;
  };

  /* ------------------------------------------------------- code fences */

  const renderCodeBlock = (code, lang, env) => {
    if (env?.features) env.features.code += 1;
    const { html: highlighted } = options.highlight
      ? highlightCode(code, lang)
      : { html: escapeHtml(code) };
    const languageClass = lang ? ` language-${escapeAttr(lang)}` : '';
    const label = lang || 'text';
    return (
      `<div class="md-code" data-lang="${escapeAttr(lang || 'text')}">` +
      '<div class="md-code-head">' +
      `<span class="md-code-lang">${escapeHtml(label)}</span>` +
      '<button class="md-code-copy" type="button" data-md-copy aria-label="Copy code"></button>' +
      '</div>' +
      `<pre><code class="hljs${languageClass}">${highlighted}</code></pre>` +
      '</div>'
    );
  };

  md.renderer.rules.fence = (tokens, idx, mdOptions, env) => {
    const token = tokens[idx];
    const lang = normalizeInfoLang(token.info);
    const code = token.content;

    if (options.mermaid && lang === 'mermaid') {
      if (env?.features) env.features.mermaid += 1;
      return (
        '<div class="md-mermaid" data-theme="light">' +
        '<div class="md-mermaid-body"></div>' +
        `<pre class="md-mermaid-src">${escapeHtml(code)}</pre>` +
        '<div class="md-mermaid-error" hidden></div>' +
        '</div>'
      );
    }

    return renderCodeBlock(code, lang, env);
  };

  // Indented code blocks get the same chrome as fenced ones.
  md.renderer.rules.code_block = (tokens, idx, mdOptions, env) =>
    renderCodeBlock(tokens[idx].content, '', env);

  /* ----------------------------------------------------------- tables */

  md.renderer.rules.table_open = (tokens, idx, mdOptions, env, self) =>
    `<div class="md-table-wrap">${self.renderToken(tokens, idx, mdOptions, env, self)}`;
  md.renderer.rules.table_close = (tokens, idx, mdOptions, env, self) =>
    `${self.renderToken(tokens, idx, mdOptions, env, self)}</div>\n`;

  /* -------------------------------------------------------- footnotes */

  md.renderer.rules.footnote_block_open = () =>
    '<div class="md-footnotes">\n<hr class="footnotes-sep">\n<section class="footnotes">\n<ol class="footnotes-list">\n';
  md.renderer.rules.footnote_block_close = () => '</ol>\n</section>\n</div>\n';

  /* ---------------------------------------------------- token passes */

  // Standalone images -> <figure> after all inline plugins have run.
  md.core.ruler.push('mdreader_figures', figureTransform);

  return md;
}
