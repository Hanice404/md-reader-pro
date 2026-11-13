# MD Reader Pro — 开发与模块契约

> 本文档描述各模块的职责、公共接口与 DOM 契约，供贡献者参考。跨模块接口变更时请同步更新本文档。
> 项目根目录：`md-reader-pro/`，所有命令都在该目录执行。

## 1. 模块与职责

| 模块 | 目录 |
| --- | --- |
| Markdown 渲染 | `src/render/**`、`test/render/**` |
| 阅读界面 / 设置 UI | `src/ui/**`、`src/viewer/**`、`src/popup/**`、`src/options/**` |
| 扩展外壳 | `src/content/**`、`src/background/**`、`manifest.json` |
| 构建 / 共享 / 测试 | `build.mjs`、`package.json`、`src/shared/**`、`test/e2e.mjs`、`src/samples/**`、`scripts/**` |

`src/shared/**` 提供设置、i18n 与通用工具，修改时请确认三个入口（content / viewer / options）仍然兼容。

## 2. 构建产物（`dist/`，由 `build.mjs` 生成，勿手写）

```
dist/
  renderer.js        ESM，导出 { createRenderer, DEFAULT_RENDER_OPTIONS }
  chunks/*.js        按需加载的 mermaid 等大依赖
  content.js         IIFE，内容脚本（动态 import renderer.js）
  background.js      IIFE，service worker
  viewer.js          IIFE，独立查看页（动态 import renderer.js）
  popup.js           IIFE
  options.js         IIFE
  reader.css         全部样式（内容页 / viewer / popup / options 共用）
  fonts/*            KaTeX 字体
  manifest.json
  viewer.html  popup.html  options.html
  icons/*.png
```

页面 HTML 位于 `src/viewer|popup|options/*.html`，构建时复制到 `dist/` 根目录，因此页面里引用
`./reader.css`、`./viewer.js`。**不要**在 HTML 内写内联 `<script>`（MV3 CSP 禁止）。

内容脚本与 viewer 都用同一方式加载渲染器：

```js
const url = globalThis.chrome?.runtime?.getURL
  ? chrome.runtime.getURL('renderer.js')
  : './renderer.js';
const { createRenderer } = await import(url);
```

## 3. 渲染器 API（`src/render/index.js`）

```js
export const DEFAULT_RENDER_OPTIONS = {
  html: true,          // 允许 raw HTML（随后用 DOMPurify 清洗）
  linkify: true,
  typographer: true,
  breaks: false,
  math: true,          // KaTeX
  mermaid: true,       // ```mermaid -> 图表
  highlight: true,     // highlight.js
  emoji: true,
  frontMatter: 'card', // card | hide | raw
  rawHtml: true,
  toc: true,           // [[toc]] 支持
};

export function createRenderer(options = {}) {
  return {
    /** 同步渲染 Markdown 源码 -> 渲染结果 */
    render(markdown, context = {}) {},
    /** 异步增强：给根节点中的 mermaid 占位符出图。可重复调用。 */
    async enhance(rootElement, { theme = 'light' } = {}) {},
    /** 主题切换后让 mermaid 重绘（由 enhance 内部使用即可） */
    setTheme(theme) {},
    /** 当前实际生效的选项 */
    options,
  };
}
```

`render(markdown, context)` 返回：

```js
{
  html: string,        // 已清洗的 HTML 片段（直接 innerHTML 到 .md-article）
  meta: {
    title: string,             // 第一个 h1 或 front matter title 或 ''（不含锚点文本）
    frontmatter: object|null,  // YAML 解析结果
    hasMath: boolean,
    hasMermaid: boolean,
    hasCode: boolean,
    wordCount: number,
    readingMinutes: number,
    warnings: string[],
    sourceBytes: number,
  },
  headings: [{ level: 1, text: 'Hello', id: 'hello' }], // 与 HTML 中标题 id 一致
  source: string,      // 原始输入（未删 front matter）
}
```

`context`：`{ baseUrl?: string, docPath?: string, titleFallback?: string }`。
`baseUrl` 用于把相对图片/链接解析成绝对 URL（渲染器负责改写 `src`/`href` 中的相对地址）。

### 3.1 渲染器必须支持（验收项）

- CommonMark + GFM：标题、段落、强调、删除线、链接、图片、引用、有序/无序/嵌套列表、
  任务列表、表格（含对齐）、围栏/缩进代码、水平线、自动链接、HTML 实体。
- 扩展：脚注、定义列表、缩写、上标/下标、`++ins++`、`==mark==`、emoji shortcode、
  `[[toc]]`、属性 `{#id .class key=value}`、`::: tip` 容器、GitHub Alerts（`> [!NOTE]`）、
  多行表格（rowspan/colspan）、front matter（YAML）。
- 数学：`$...$`、`$$...$$`、`\(...\)`、`\[...\]`（KaTeX，`throwOnError:false`）。
- Mermaid：```mermaid 渲染为图；源码保留在占位符里，`enhance()` 异步出图；
  出错时显示错误卡片（不抛出），并提供“查看源码”。
- 代码高亮：highlight.js，语言未知时安全转义；生成复制按钮（仅标记，不绑定事件）。
- 安全：raw HTML 经 DOMPurify 清洗；禁止 `script`、事件属性、`javascript:`；
  KaTeX 使用 `trust:false`；mermaid 使用 `securityLevel:'strict'`，出图后再 DOMPurify 清洗 SVG。
- 标题 id：CJK 友好 slug，重复标题自动加 `-1`；返回的 `headings[].id` 必须与 DOM 一致。
- 相对路径：`context.baseUrl` 存在时，把相对的 `img src`、`a href` 解析为绝对 URL
  （锚点 `#foo` 保持原样）。
- 大文档：> 4 MB 时返回 `warnings`，仍尝试渲染。

### 3.2 渲染器输出的 DOM 契约（UI 依赖这些 class，必须遵守）

```html
<article class="md-article">
  <section class="md-frontmatter">...</section>          <!-- 可选 -->
  <h1 id="slug" class="md-heading">Title<a class="md-anchor" href="#slug" aria-hidden="true">#</a></h1>
  <div class="md-table-wrap"><table>...</table></div>
  <div class="md-code" data-lang="js">
    <div class="md-code-head"><span class="md-code-lang">js</span>
      <button class="md-code-copy" type="button" data-md-copy>复制</button></div>
    <pre><code class="hljs language-js">...</code></pre>
  </div>
  <div class="md-mermaid" data-theme="light">
    <div class="md-mermaid-body"></div>
    <pre class="md-mermaid-src">graph TD; ...</pre>
    <div class="md-mermaid-error" hidden></div>
  </div>
  <div class="md-alert md-alert-note"><p class="md-alert-title">NOTE</p>...</div>
  <figure class="md-figure"><img ...><figcaption>alt</figcaption></figure>
  <div class="md-footnotes">...</div>
  <nav class="md-toc-inline">...</nav>
</article>
```

- 代码块复制按钮文案由 CSS/JS 决定，渲染器只输出空按钮 + `data-md-copy`（UI 负责绑定并更新文案）。
- 图片：有 alt 时包 `<figure class="md-figure">`，否则裸 `<img>`；UI 负责灯箱。
- 任务列表：`<ul class="contains-task-list"><li class="task-list-item">...<input type="checkbox" disabled checked>`。
- 脚注：`markdown-it-footnote` 默认输出即可，外加容器 class。
- `enhance()` 完成后，每个 mermaid 容器加 `data-md-rendered="1"`；失败加 `data-md-error="1"`。

## 4. 阅读 UI API（`src/ui/reader-app.js`）

```js
export async function mountReaderApp({
  container,          // HTMLElement，UI 把自己挂进去（内容页传 <body> 内的容器）
  markdown,           // string
  renderer,           // createRenderer() 实例
  settings,           // 完整 settings（见 src/shared/settings.js）
  source,             // { url?, path?, title?, kind: 'url'|'file'|'paste'|'string' }
  capabilities,       // { raw: boolean, print: boolean, liveReload: boolean }
  callbacks,          // { onSettingsChange(patch), onReload(), onOpenSource?() }
}) -> Promise<ReaderApp>

ReaderApp = {
  el,                  // 根元素
  setMarkdown(text),   // 重新渲染（保留滚动位置策略由 UI 决定）
  setSettings(partial),// 应用并重渲染需要重渲染的部分
  getSettings(),
  destroy(),
  scrollToHeading(id),
}
```

- UI 负责：完整页面骨架、顶部工具栏、TOC 与滚动高亮、主题/字号/宽度应用、源码切换、
  复制 Markdown、打印、图片灯箱、代码复制、阅读进度、front matter 展示、空状态（viewer 用）。
- UI 自己持久化设置：调用 `callbacks.onSettingsChange(patch)`；外壳会写回 storage。
- UI 文本使用 `src/ui/strings.js` 中的 zh/en 字典 + `createTranslator`。
- 主题：把解析后的主题写到 `document.documentElement.dataset.mdTheme = 'light'|'dark'|'sepia'`，
  并在根元素加 `data-md-reader="1"`。所有 CSS 变量在 `src/ui/styles/tokens.css` 定义。
- 内容页上 `<html>`/`<body>` 会被 UI 重置样式，但选择器必须限定在
  `html[data-md-reader]` / `.md-app` 内，避免污染扩展页面。

## 5. 扩展外壳

- **检测**（`src/content/content.js`）：
  - `document.contentType` 为 `text/markdown`、`text/x-markdown` → 自动渲染；
  - URL path 以 `.md/.markdown/.mdown/.mkd/.mdx` 结尾（允许 query/hash）→ 自动渲染；
  - `text/plain` 且内容有 ≥2 类 Markdown 特征（标题/表格/围栏/任务列表/链接）→ 显示悬浮提示按钮，
    用户点击才渲染（`plainTextHint` 设置控制）；
  - 其他页面不注入 UI。
- 文本获取优先级：`document.body` 的 `<pre>` `textContent` → `fetch(location.href)` → `innerText`。
- 渲染后：`document.title` 使用 `meta.title`；`document.documentElement.dataset.mdReader='page'`；
  清空 body 并挂载 UI。
- 监听 `chrome.runtime.onMessage`：`render-current`、`toggle-raw`、`get-state`。
- 手动入口：popup 按钮、右键菜单、快捷键（`Alt+Shift+M`，`commands` 中定义）。
- **背景**：安装时写默认设置；处理 action/命令/右键菜单；不注入远程代码。
- **权限**：`storage`、`activeTab`、`scripting`、`contextMenus`；`host_permissions: ["<all_urls>"]`；
  内容脚本在 `<all_urls>` + `file:///*` 上运行（file 需用户勾选“允许访问文件网址”）。
- 设置读取统一用 `src/shared/settings.js`，不要直接碰 `chrome.storage` key。

## 6. 样式与资源

- 单一 CSS 入口 `src/ui/styles/reader.css`，`@import` KaTeX CSS 与各分片样式；构建后输出 `dist/reader.css`。
- 颜色/间距全部走 `src/ui/styles/tokens.css` 的 CSS 变量；四套主题：
  `light`、`dark`、`sepia`、`auto`（auto 由 JS 解析成 light/dark，data-md-theme 永远不含 auto）。
- 字体：系统字体栈（含 PingFang SC / Microsoft YaHei / Noto Sans CJK）；不加载远程字体。
- 图标：内联 SVG（`src/ui/icons.js`），不要新增图片资源。
- 禁止网络请求（除文档内图片本身）；禁止 `eval`/`new Function`；禁止内联脚本。
- 需兼容 Chrome 110+（ES2022 可用）。

## 7. 命令与验收

```bash
npm run build   # 生成 dist/
npm test        # Puppeteer 端到端（需 Chrome for Testing）
npm run zip     # 打包 dist 为 zip
```

各自完成后至少自查：
- `npm run build` 无报错；
- 用 `python3 -m http.server` 打开 `src/samples/sample.md`（或自建 fixture）人工/脚本验证；
- 不引入新的裸依赖；新增依赖请同时更新 `package.json` 与 `package-lock.json`。
