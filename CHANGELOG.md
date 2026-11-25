# Changelog

All notable changes to **MD Reader Pro** are documented here.

## [1.0.3] — 2026-11-25

### Changed

- The reading-progress percentage is now plain text (no capsule background or border) in the toolbar metadata.
- All metadata separators, including the one before the progress percentage, use the same small dot.

[1.0.3]: https://github.com/Hanice404/md-reader-pro/releases/tag/v1.0.3

## [1.0.2] — 2026-11-25

### Changed

- The “N% 已读” capsule moved from the sidebar header to the toolbar metadata, immediately to the right of the reading-time estimate.
- The resizable TOC width now caps at **35%** of the viewport (was 50%).
- The resize divider no longer shows an accent/click highlight while dragging; it uses a neutral hairline only.

### Fixed

- Sidebar header is now just the “目录 / Contents” label.

[1.0.2]: https://github.com/Hanice404/md-reader-pro/releases/tag/v1.0.2

## [1.0.1] — 2026-11-25

### Added

- Table-of-contents labels now stay on one line and truncate with an ellipsis; the full heading is available as a tooltip.
- The TOC sidebar is resizable by dragging its right edge (or with the keyboard arrows when the handle is focused), capped at **50% of the viewport width**; double-click the handle to restore the default width. The width is persisted in settings.

### Changed

- Options copy now explains the resizable TOC.

[1.0.1]: https://github.com/Hanice404/md-reader-pro/releases/tag/v1.0.1

## [1.0.0] — 2026-11-13

### Added

- Chrome / Edge Manifest V3 extension that renders Markdown links, local `.md` files and Markdown-looking plain-text pages.
- Full rendering pipeline: CommonMark + GFM, tables, task lists, footnotes, definition lists, abbreviations, sub/sup, insert/mark, emoji, attributes, containers, GitHub Alerts, multi-line tables, YAML front matter, `[[toc]]`.
- KaTeX math (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`), lazy-loaded Mermaid diagrams and highlight.js code highlighting.
- Reading UI: fixed toolbar and table of contents, independent content scrolling, TOC scroll-spy, reading progress, raw source view, copy Markdown, code copy, image lightbox, print styles.
- Four themes (light / dark / sepia / system), adjustable font size, line height, reading width, serif/sans font, custom CSS.
- Font zoom percentage between the − / + toolbar buttons; click the percentage to reset to 100%.
- Standalone viewer with drag & drop, file picker, paste, sample document and `?url=` support.
- Popup, options page, import/export/reset settings, live reload for remote documents.
- Security: DOMPurify sanitisation, strict Mermaid security, no remote code, no telemetry.
- Automated checks: 91 end-to-end checks (real Chrome with unpacked extension) and 212 renderer checks.

### Changed

- Removed the reader footer (source URL / renderer credit) for a cleaner document ending.
- Tables now use a light solid grid.

[1.0.0]: https://github.com/Hanice404/md-reader-pro/releases/tag/v1.0.0
