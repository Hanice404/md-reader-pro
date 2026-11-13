/**
 * Small DOM helpers shared by the reader UI and the extension pages.
 * Kept dependency-free and framework-free; everything is plain DOM.
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {Record<string, any>} [props] class, text, html, dataset, style,
 *   event handlers (on click etc.) and plain attributes
 * @param {...any} children
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Replace static page copy with localized strings.
 * Supports data-i18n (text), data-i18n-html (markup), data-i18n-title,
 * data-i18n-placeholder and data-i18n-aria.
 */
export function applyI18n(root, t) {
  for (const node of qsa('[data-i18n]', root)) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of qsa('[data-i18n-html]', root)) {
    node.innerHTML = t(node.dataset.i18nHtml);
  }
  for (const node of qsa('[data-i18n-title]', root)) {
    const label = t(node.dataset.i18nTitle);
    node.title = label;
    if (node.hasAttribute('aria-label')) node.setAttribute('aria-label', label);
  }
  for (const node of qsa('[data-i18n-placeholder]', root)) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of qsa('[data-i18n-aria]', root)) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  }
}

/** Bottom-anchored transient status message. */
export function createToast(element) {
  let timer = 0;
  return {
    show(message, { error = false, timeout = 2800 } = {}) {
      if (!element) return;
      element.textContent = message;
      element.classList.toggle('is-error', Boolean(error));
      element.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        element.hidden = true;
      }, timeout);
    },
    hide() {
      clearTimeout(timer);
      if (element) element.hidden = true;
    },
  };
}

export function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function scrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/** Resolve after the browser has painted once. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** Focus an element without scrolling the whole page. */
export function focusSilently(element) {
  if (!element) return;
  element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: true });
}

/** Add a one-shot animation class and clean it up afterwards. */
export function pulse(element, className = 'is-pulsing') {
  if (!element) return;
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), 900);
}
