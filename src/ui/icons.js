/**
 * Inline SVG icon set (24×24, `currentColor`, 1.75 stroke).
 * No external assets, no fonts — every icon is markup.
 */
const wrap = (body, extra = '') =>
  `<svg class="md-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

export const icons = {
  /* navigation / chrome */
  toc: wrap('<path d="M4 6h9M4 12h9M4 18h6"/><path d="M17 6h3M17 12h3M17 18h3" opacity=".55"/>'),
  menu: wrap('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevronDown: wrap('<path d="m6 9 6 6 6-6"/>'),
  chevronRight: wrap('<path d="m9 6 6 6-6 6"/>'),
  chevronLeft: wrap('<path d="m15 6-6 6 6 6"/>'),
  arrowUp: wrap('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  arrowLeft: wrap('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  arrowRight: wrap('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  external: wrap('<path d="M14 4h6v6M20 4l-9 9"/><path d="M9 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),

  /* theme */
  sun: wrap('<circle cx="12" cy="12" r="3.6"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>'),
  moon: wrap('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
  auto: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>'),
  contrast: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none"/>'),

  /* typography / layout */
  minus: wrap('<path d="M5 12h14"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  width: wrap('<path d="M4 5v14M20 5v14M8 12h8M8 12l2.2-2.2M8 12l2.2 2.2M16 12l-2.2-2.2M16 12l-2.2 2.2"/>'),
  type: wrap('<path d="M4 7V5h16v2M9 5v14M15 5v14M7 19h4M13 19h4"/>'),
  palette: wrap('<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.9 0-.7-.4-1.2-.4-1.9 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4A8.5 8.5 0 0 0 12 3z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10.5" cy="6.8" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
  settings: wrap('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z"/>'),
  sliders: wrap('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),

  /* reader actions */
  code: wrap('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
  codeBlock: wrap('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m9.5 10-2 2 2 2M14.5 10l2 2-2 2"/>'),
  copy: wrap('<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15"/>'),
  check: wrap('<path d="m5 12.5 4.5 4.5L19 7"/>'),
  checkCircle: wrap('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>'),
  print: wrap('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>'),
  download: wrap('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>'),
  upload: wrap('<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9"/><path d="M4.5 19.5h15"/>'),
  refresh: wrap('<path d="M20 11a8 8 0 0 0-13.7-5L4 8"/><path d="M4 4.5V8h3.5"/><path d="M4 13a8 8 0 0 0 13.7 5L20 16"/><path d="M20 19.5V16h-3.5"/>'),
  eye: wrap('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  image: wrap('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="m4 17 4.5-4.5 4 4 2.5-2.5L20 18"/>'),

  /* files */
  file: wrap('<path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z"/><path d="M14 3.5v5h5"/><path d="M9 13h6M9 17h4"/>'),
  fileText: wrap('<path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z"/><path d="M14 3.5v5h5"/><path d="M9 12.5h6M9 16h3"/>'),
  fileCode: wrap('<path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z"/><path d="M14 3.5v5h5"/><path d="m10 12.5-2 2 2 2M14 12.5l2 2-2 2"/>'),
  folderOpen: wrap('<path d="M3.5 8.5V6.2A1.7 1.7 0 0 1 5.2 4.5h3.4l2 2.4h4.7a1.7 1.7 0 0 1 1.7 1.7v1"/><path d="M4.6 19.5h13.2a2 2 0 0 0 1.9-1.4l1.4-5a1.4 1.4 0 0 0-1.3-1.8H6.5a2 2 0 0 0-1.9 1.4l-1.5 5a1.4 1.4 0 0 0 1.3 1.8z"/>'),

  /* status */
  info: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
  alertTriangle: wrap('<path d="M12 4 21 20H3z"/><path d="M12 10v4M12 17h.01"/>'),
  alertCircle: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16h.01"/>'),
  loader: wrap('<path d="M12 3v3M12 18v3M4.5 12h3M16.5 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M17.7 6.3l-2.1 2.1M8.4 15.6l-2.1 2.1"/>'),
  shield: wrap('<path d="M12 3.5 19 6v5.4c0 4-2.9 7.6-7 8.9-4.1-1.3-7-4.9-7-8.9V6z"/><path d="m9 12 2 2 4-4.2"/>'),
  globe: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.3 3.5 8.5S14.3 18.2 12 20.5C9.7 18.2 8.5 15.2 8.5 12S9.7 5.8 12 3.5z"/>'),
  book: wrap('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2.5H20V22H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2.5z"/>'),
  keyboard: wrap('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M18 10h.01M7 14h10"/>'),
  sparkles: wrap('<path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>'),
  command: wrap('<path d="M9 6.5a2 2 0 1 0-2-2 2 2 0 0 0 2 2zM9 6.5v11M15 6.5a2 2 0 1 1 2-2 2 2 0 0 1-2 2zM15 6.5v11M9 17.5a2 2 0 1 1-2 2 2 2 0 0 1 2-2zM15 17.5a2 2 0 1 0 2 2 2 2 0 0 0-2-2zM9 6.5h6M9 17.5h6"/>'),
  trash: wrap('<path d="M4.5 7h15M9 7V5.2A1.7 1.7 0 0 1 10.7 3.5h2.6A1.7 1.7 0 0 1 15 5.2V7"/><path d="M6.5 7l.8 12.1A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.9L17.5 7"/><path d="M10 11v6M14 11v6"/>'),
  pin: wrap('<path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.4"/>'),
};

export default icons;
