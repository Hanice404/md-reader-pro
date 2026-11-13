/**
 * Minimal i18n helper shared by the extension surfaces.
 *
 * Each surface owns its own dictionary file (strings.js) and calls
 * `createTranslator(strings)`; this module only handles language detection
 * and placeholder interpolation.
 */

export function detectLanguage() {
  const uiLanguage =
    (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    'en';
  return /^zh/i.test(uiLanguage) ? 'zh' : 'en';
}

export function interpolate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars || {}, key) ? String(vars[key]) : match,
  );
}

/**
 * @param {{zh: Record<string,string>, en: Record<string,string>}} strings
 * @param {'zh'|'en'} [lang]
 */
export function createTranslator(strings, lang = detectLanguage()) {
  const dict = strings[lang] || strings.en || {};
  const fallback = strings.en || {};
  return function t(key, vars) {
    const template = dict[key] ?? fallback[key] ?? key;
    return interpolate(template, vars);
  };
}
