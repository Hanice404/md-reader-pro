/**
 * Content-script copy (zh / en).
 *
 * The reading UI owns its own dictionary in `src/ui/strings.js`; these strings
 * are only used by the page-level shell (hint pill, error card, raw fallback).
 */
export const contentStrings = {
  zh: {
    hintLabel: '以 Markdown 阅读',
    hintTitle: '检测到 Markdown 内容，点击用阅读模式打开',
    hintLarge: '文档较大，点击以 Markdown 阅读',
    errorTitle: '无法渲染此文档',
    errorLoad: 'Markdown 渲染器加载失败，原始内容已保留。',
    errorMount: '阅读器初始化失败，原始内容已保留。',
    errorEmpty: '没有检测到可阅读的 Markdown 内容。',
    errorUpdate: '更新文档时出错，已保留当前内容。',
    retry: '重试',
    viewSource: '查看源码',
    backToReader: '返回阅读视图',
    close: '关闭',
    sourceTitle: 'Markdown 源码',
    largeTitle: '文档较大',
    largeMessage: '该文档约 {size}，渲染可能需要几秒钟。是否继续？',
    largeContinue: '继续渲染',
    largeCancel: '取消',
    rawFallbackNotice: '原始文本',
  },
  en: {
    hintLabel: 'Read as Markdown',
    hintTitle: 'Markdown content detected — open it in the reader',
    hintLarge: 'Large document — click to read as Markdown',
    errorTitle: 'This document could not be rendered',
    errorLoad: 'The Markdown renderer failed to load. The original content is preserved.',
    errorMount: 'The reader failed to start. The original content is preserved.',
    errorEmpty: 'No readable Markdown content was found.',
    errorUpdate: 'The document could not be refreshed. The current content is preserved.',
    retry: 'Retry',
    viewSource: 'View source',
    backToReader: 'Back to reader',
    close: 'Close',
    sourceTitle: 'Markdown source',
    largeTitle: 'Large document',
    largeMessage: 'This document is about {size}. Rendering may take a few seconds. Continue?',
    largeContinue: 'Render anyway',
    largeCancel: 'Cancel',
    rawFallbackNotice: 'Original text',
  },
};

export default contentStrings;
