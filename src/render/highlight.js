/**
 * Syntax highlighting via the highlight.js "common" bundle (36 languages,
 * typed/see-through, no auto-detection so output is deterministic).
 *
 * Unknown or plain languages fall back to escaped text: the code is always
 * HTML-escaped, never injected raw.
 */
import hljs from 'highlight.js/lib/common';
import { escapeHtml } from '../shared/util.js';

/** Short aliases people actually type in fences. */
const LANGUAGE_ALIASES = Object.freeze({
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  bash: 'bash',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'markdown',
  htm: 'xml',
  html: 'xml',
  svg: 'xml',
  jsonc: 'json',
  gql: 'graphql',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  'objective-c': 'objectivec',
  objc: 'objectivec',
  golang: 'go',
  kt: 'kotlin',
  ps1: 'powershell',
  dockerfile: 'bash',
  docker: 'bash',
  text: '',
  txt: '',
  plain: '',
  plaintext: '',
  none: '',
  raw: '',
});

/** Strip a markdown-it-attrs suffix such as `{.line-numbers}` from fence info. */
export function normalizeInfoLang(info) {
  const raw = String(info || '').trim();
  if (!raw) return '';
  const first = raw.split(/\s+/)[0];
  // ` ```js {.foo}` / ```` ```{.js} ```` / ```js{data-x=1}```
  const cleaned = first
    .replace(/^\{+/, '')
    .replace(/\}+$/, '')
    .replace(/^\./, '')
    .split(/[=,]/)[0]
    .trim();
  return cleaned.toLowerCase();
}

export function resolveLanguage(lang) {
  const key = String(lang || '').toLowerCase();
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_ALIASES, key)) {
    return LANGUAGE_ALIASES[key];
  }
  return hljs.getLanguage(key) ? key : '';
}

/**
 * @returns {{ html: string, language: string, highlighted: boolean }}
 */
export function highlightCode(code, lang) {
  const source = String(code ?? '');
  const requested = normalizeInfoLang(lang);
  const language = resolveLanguage(requested);

  if (!language || !hljs.getLanguage(language)) {
    return { html: escapeHtml(source), language: '', highlighted: false };
  }

  try {
    const result = hljs.highlight(source, { language, ignoreIllegals: true });
    return { html: result.value, language, highlighted: true };
  } catch {
    return { html: escapeHtml(source), language: '', highlighted: false };
  }
}
