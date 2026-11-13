/**
 * DOMPurify configuration for the reader.
 *
 * Two profiles are used:
 *  - `sanitizeHtml` for the rendered Markdown fragment. It keeps benign HTML,
 *    SVG and the MathML that KaTeX emits, while stripping scripts, event
 *    handlers, `javascript:` URLs and other active content.
 *  - `sanitizeSvg` for Mermaid output. Mermaid renders trusted-by-construction
 *    SVG from user source, but it still goes through DOMPurify so a malicious
 *    diagram label can never smuggle `<script>` or event handlers.
 *
 * A single DOMPurify hook handles two jobs that are awkward to do on token
 * level (they also need to cover raw HTML that Markdown passes through):
 *  - resolve relative `href`/`src` against `context.baseUrl`;
 *  - add `rel="noopener noreferrer"` to links.
 */
import DOMPurify from 'dompurify';
import { escapeHtml, resolveUrl } from '../shared/util.js';

const MATHML_TAGS = ['semantics', 'annotation'];

/** Attributes KaTeX / Mermaid / benign HTML need but DOMPurify may drop. */
const EXTRA_ATTRS = [
  'style',
  'xmlns',
  'encoding',
  'align',
  'colspan',
  'rowspan',
  'start',
  'type',
  'checked',
  'disabled',
  'open',
  'datetime',
  'display',
  'displaystyle',
  'scriptlevel',
  'lspace',
  'rspace',
  'stretchy',
  'symmetric',
  'maxsize',
  'minsize',
  'movablelimits',
  'accent',
  'accentunder',
  'linethickness',
  'columnalign',
  'rowalign',
  'columnlines',
  'rowlines',
  'frame',
  'framespacing',
  'equalrows',
  'equalcolumns',
  'side',
  'minlabelspacing',
  'voffset',
  'width',
  'height',
  'depth',
];

const HTML_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: MATHML_TAGS,
  ADD_ATTR: EXTRA_ATTRS,
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta', 'link', 'template'],
  FORBID_ATTR: ['srcdoc', 'formaction', 'action'],
  KEEP_CONTENT: true,
  RETURN_TRUSTED_TYPE: false,
};

const SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ['style', 'foreignObject'],
  ADD_ATTR: [
    'style',
    'xmlns',
    'xmlns:xlink',
    'xlink:href',
    'dominant-baseline',
    'text-anchor',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-dasharray',
    'stroke-linecap',
    'stroke-linejoin',
    'marker-end',
    'marker-start',
    'paint-order',
    'transform',
    'transform-origin',
    'vector-effect',
    'lengthAdjust',
    'textLength',
    'side',
    'aria-roledescription',
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form'],
  KEEP_CONTENT: false,
  RETURN_TRUSTED_TYPE: false,
};

let hooksInstalled = false;
let activeBaseUrl = '';

function isAbsoluteOrAnchor(value) {
  return !value || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!node || node.nodeType !== 1) return;
    // Only touch HTML nodes: mermaid SVG uses its own namespace and gets no
    // `rel`/URL rewriting (its links are internal `#id` references anyway).
    if (node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    const tag = (node.tagName || '').toLowerCase();

    if (tag === 'a') {
      const href = node.getAttribute('href');
      if (href) {
        if (href.startsWith('#')) {
          // DOMPurify percent-encodes non-ASCII fragments; the UI resolves
          // heading ids from the raw `#中文标题` form, so restore it.
          const raw = href.slice(1);
          let decoded = raw;
          try {
            decoded = decodeURIComponent(raw);
          } catch {
            decoded = raw;
          }
          if (decoded !== raw) node.setAttribute('href', `#${decoded}`);
        } else {
          if (activeBaseUrl && !isAbsoluteOrAnchor(href)) {
            node.setAttribute('href', resolveUrl(href, activeBaseUrl));
          }
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }
      return;
    }

    if (tag === 'img' || tag === 'source' || tag === 'track' || tag === 'audio' || tag === 'video') {
      const src = node.getAttribute('src');
      if (src && activeBaseUrl && !isAbsoluteOrAnchor(src)) {
        node.setAttribute('src', resolveUrl(src, activeBaseUrl));
      }
      if (tag === 'video') {
        const poster = node.getAttribute('poster');
        if (poster && activeBaseUrl && !isAbsoluteOrAnchor(poster)) {
          node.setAttribute('poster', resolveUrl(poster, activeBaseUrl));
        }
      }
    }
  });
}

/**
 * Sanitize the rendered article HTML.
 * On any failure the fragment is escaped instead of being trusted.
 */
export function sanitizeHtml(html, { baseUrl = '' } = {}) {
  const source = String(html ?? '');
  try {
    installHooks();
    activeBaseUrl = baseUrl || '';
    return DOMPurify.sanitize(source, HTML_CONFIG);
  } catch {
    return escapeHtml(source);
  } finally {
    activeBaseUrl = '';
  }
}

/**
 * Sanitize a Mermaid-produced SVG. Returns '' when the output cannot be
 * trusted, so callers can show their error card instead of injecting it.
 */
export function sanitizeSvg(svg) {
  const source = String(svg ?? '');
  if (!source) return '';
  try {
    installHooks();
    activeBaseUrl = '';
    const clean = DOMPurify.sanitize(source, SVG_CONFIG);
    return typeof clean === 'string' ? clean : '';
  } catch {
    return '';
  }
}
