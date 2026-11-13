/**
 * YAML front matter: parsing plus the "card" presentation.
 *
 * `frontMatter` option:
 *  - `card` (default): strip the block, show it as a metadata card;
 *  - `hide`: strip the block entirely;
 *  - `raw`: keep the original `---` block in the document body so the raw
 *    lines stay visible (they render as Markdown, not as YAML).
 */
import yaml from 'js-yaml';
import { escapeHtml } from '../shared/util.js';

const FRONT_MATTER_RE = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * @param {string} markdown
 * @returns {{ body: string, frontmatter: object|null, raw: string, error: string|null }}
 */
export function splitFrontMatter(markdown) {
  const source = String(markdown ?? '');
  const match = FRONT_MATTER_RE.exec(source);
  if (!match) return { body: source, frontmatter: null, raw: '', error: null };

  const raw = match[0];
  let frontmatter = null;
  let error = null;
  try {
    const parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA, json: false });
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed;
    } else if (parsed !== null && parsed !== undefined && parsed !== '') {
      error = 'front matter 顶层必须是键值对象';
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message.split('\n')[0] : String(thrown);
  }

  return { body: source.slice(raw.length), frontmatter, raw, error };
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).filter(Boolean).join(', ');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

/** Render the metadata card. Returns '' when there is nothing to show. */
export function renderFrontMatterCard(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object') return '';
  const entries = Object.entries(frontmatter).filter(([, value]) => formatValue(value) !== '');
  if (!entries.length) return '';

  const rows = entries
    .map(([key, value]) => {
      const label = escapeHtml(key);
      const text = escapeHtml(formatValue(value));
      return `<div class="md-frontmatter-item"><dt>${label}</dt><dd>${text}</dd></div>`;
    })
    .join('');

  return `<section class="md-frontmatter" aria-label="Front matter"><dl>${rows}</dl></section>\n`;
}
