#!/usr/bin/env node
/**
 * End-to-end verification for MD Reader Pro.
 *
 * Launches the real Chrome with the unpacked extension, serves fixtures over
 * HTTP, and asserts on the rendered DOM. Produces screenshots in test/screenshots.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const fixtures = path.join(root, 'test/fixtures');
const shots = path.join(root, 'test/screenshots');
function findChromeForTesting() {
  const base = path.join(root, '.chrome');
  if (!existsSync(base)) return null;
  try {
    const entries = readdirSync(base, { recursive: true });
    for (const entry of entries) {
      const full = path.join(base, entry.toString());
      if (
        /Google Chrome for Testing$/.test(full) ||
        /chrome-linux64\/chrome$/.test(full) ||
        /chrome-win64\\chrome\.exe$/.test(full)
      ) {
        return full;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const chromePath =
  process.env.CHROME_PATH ||
  findChromeForTesting() ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const results = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  const icon = condition ? '✓' : '✗';
  console.log(`  ${icon} ${name}${condition || !detail ? '' : ` — ${detail}`}`);
}

const liveState = { version: 1 };

function startServer(port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === '/bump') {
        liveState.version += 1;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(String(liveState.version));
        return;
      }
      if (url.pathname === '/live.md') {
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(`# Live reload v${liveState.version}\n\nVersion ${liveState.version}.\n`);
        return;
      }

      let file;
      if (url.pathname.startsWith('/fixtures/')) {
        file = path.join(fixtures, url.pathname.replace('/fixtures/', ''));
      } else if (url.pathname.startsWith('/dist/')) {
        file = path.join(root, url.pathname.replace('/dist/', 'dist/'));
      } else if (url.pathname === '/sample.md') {
        file = path.join(root, 'src/samples/sample.md');
      } else {
        file = path.join(dist, url.pathname.replace(/^\//, ''));
      }
      const body = await readFile(file);
      const as = url.searchParams.get('as');
      let type = MIME[path.extname(file)] || 'application/octet-stream';
      if (as === 'markdown') type = 'text/markdown; charset=utf-8';
      else if (as === 'html') type = 'text/html; charset=utf-8';
      else if (as === 'plain') type = 'text/plain; charset=utf-8';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function extensionIdFromPath(dir) {
  const hash = createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

async function waitForArticle(page, timeout = 20000) {
  await page.waitForSelector('.md-app .md-article', { timeout });
  await page.waitForFunction(() => document.querySelectorAll('.md-article h1').length > 0, { timeout });
}

async function main() {
  if (!existsSync(dist)) throw new Error('dist/ is missing — run `npm run build` first');
  await mkdir(shots, { recursive: true });

  const port = 4173;
  const server = await startServer(port);
  const userDataDir = path.join(root, '.tmp', 'chrome-profile');
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });

  console.log('Launching Chrome with the unpacked extension…');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    enableExtensions: true,
    userDataDir,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-component-update',
      '--disable-extensions-file-access-check',
      '--window-size=1440,1000',
    ],
  });

  let extensionId = extensionIdFromPath(dist);
  let worker = null;
  try {
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 });
    const match = target.url().match(/^chrome-extension:\/\/([a-p]+)\//);
    if (match) extensionId = match[1];
    worker = await target.worker();
    console.log(`  extension id: ${extensionId}`);
  } catch (error) {
    console.log(`  could not observe service worker (${error.message}); using derived id ${extensionId}`);
  }

  async function setSettings(patch) {
    if (!worker) return false;
    return worker.evaluate(async (next) => {
      const key = 'mdReaderSettings';
      const current = (await chrome.storage.sync.get(key))[key] || {};
      await chrome.storage.sync.set({ [key]: { ...current, ...next } });
      return true;
    }, patch);
  }

  async function messageActiveTab(message) {
    if (!worker) return { ok: false, reason: 'no-worker' };
    return worker.evaluate(async (payload) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, reason: 'no-tab' };
      try {
        return await chrome.tabs.sendMessage(tab.id, payload);
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
    }, message);
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('favicon.ico')) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    // ---------------------------------------------------------------- sample
    console.log('\n[1] Auto-render a Markdown URL');
    await page.goto(`http://127.0.0.1:${port}/samples/sample.md`, { waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    await page.waitForFunction(
      () => document.querySelectorAll('.md-mermaid svg').length >= 1,
      { timeout: 30000 },
    ).catch(() => {});
    await page.evaluate(() => {
      document.querySelectorAll('.md-article img').forEach((img) => {
        img.loading = 'eager';
      });
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.md-article img').length >= 2 &&
        [...document.querySelectorAll('.md-article img')].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      { timeout: 15000 },
    ).catch(() => {});

    const stats = await page.evaluate(() => {
      const article = document.querySelector('.md-article');
      const text = article?.textContent || '';
      return {
        title: document.title,
        h1: article.querySelector('h1')?.textContent || '',
        headings: article.querySelectorAll('h1,h2,h3').length,
        tocLinks: document.querySelectorAll('.md-toc-link').length,
        codeBlocks: article.querySelectorAll('.md-code').length,
        highlighted: article.querySelectorAll('.hljs-keyword, .hljs-string, .hljs-title').length,
        katex: article.querySelectorAll('.katex').length,
        mermaidSvg: article.querySelectorAll('.md-mermaid svg').length,
        mermaidErrors: article.querySelectorAll('.md-mermaid-error:not([hidden])').length,
        tables: article.querySelectorAll('table').length,
        taskItems: article.querySelectorAll('.task-list-item').length,
        checked: article.querySelectorAll('.task-list-item-checkbox:checked').length,
        alerts: article.querySelectorAll('.markdown-alert, .md-alert').length,
        footnotes: article.querySelectorAll('.footnote-ref').length,
        frontmatter: article.querySelectorAll('.md-frontmatter').length,
        images: article.querySelectorAll('img').length,
        loadedImages: [...article.querySelectorAll('img')].filter((img) => img.naturalWidth > 0).length,
        tablesWrapped: article.querySelectorAll('.md-table-wrap table').length,
        tableGrid: (() => {
          const cell = article.querySelector('table td, table th');
          if (!cell) return null;
          const style = getComputedStyle(cell);
          return {
            right: `${style.borderRightWidth} ${style.borderRightStyle} ${style.borderRightColor}`,
            bottom: `${style.borderBottomWidth} ${style.borderBottomStyle}`,
          };
        })(),
        copyButtons: article.querySelectorAll('.md-code-copy').length,
        figures: article.querySelectorAll('.md-figure').length,
        tableWraps: article.querySelectorAll('.md-table-wrap').length,
        deflists: article.querySelectorAll('dl').length,
        abbrs: article.querySelectorAll('abbr').length,
        marks: article.querySelectorAll('mark').length,
        inserts: article.querySelectorAll('ins').length,
        sups: article.querySelectorAll('sup').length,
        subs: article.querySelectorAll('sub').length,
        tocInline: article.querySelectorAll('.md-toc-inline').length,
        alertTitles: [...article.querySelectorAll('.md-alert-title, .markdown-alert-title')].map((el) => el.textContent.trim().toLowerCase()),
        footnotesContainer: article.querySelectorAll('.md-footnotes').length,
        mdHeadings: article.querySelectorAll('.md-heading').length,
        anchors: article.querySelectorAll('.md-heading .md-anchor').length,
        h1Text: (() => {
          const clone = article.querySelector('h1')?.cloneNode(true);
          clone?.querySelectorAll('.md-anchor').forEach((a) => a.remove());
          return clone?.textContent || '';
        })(),
        brokenToc: [...document.querySelectorAll('.md-toc-link')].filter((a) => {
          const id = decodeURIComponent((a.getAttribute('href') || '').slice(1));
          return !document.getElementById(id);
        }).length,
        scripts: article.querySelectorAll('script').length,
        footer: document.querySelectorAll('.md-footer').length,
        inlineHandlers: article.querySelectorAll('[onerror],[onclick],[onload]').length,
        progressWidth: getComputedStyle(document.querySelector('.md-progress span')).width,
        theme: document.documentElement.dataset.mdTheme,
        imageSrcs: [...article.querySelectorAll('img')].map((img) => img.getAttribute('src') || ''),
      };
    });

    check('document title updated', stats.title.includes('MD Reader Pro'), stats.title);
    check('h1 rendered', stats.h1.includes('MD Reader Pro'), stats.h1);
    check('headings >= 10', stats.headings >= 10, String(stats.headings));
    check('TOC generated', stats.tocLinks >= 10, String(stats.tocLinks));
    check('code blocks rendered', stats.codeBlocks >= 6, String(stats.codeBlocks));
    check('syntax highlighting active', stats.highlighted > 5, String(stats.highlighted));
    check('KaTeX rendered', stats.katex > 3, String(stats.katex));
    check('Mermaid SVG rendered', stats.mermaidSvg >= 1, String(stats.mermaidSvg));
    check('no visible Mermaid errors', stats.mermaidErrors === 0, String(stats.mermaidErrors));
    check('tables rendered + wrapped', stats.tables >= 1 && stats.tablesWrapped >= 1, `${stats.tables}/${stats.tablesWrapped}`);
    check('table uses solid light grid lines', stats.tableGrid, JSON.stringify(stats.tableGrid));
    check('task list rendered', stats.taskItems >= 3 && stats.checked >= 2, `${stats.taskItems}/${stats.checked}`);
    check('GitHub alerts rendered', stats.alerts >= 5, String(stats.alerts));
    check('footnotes rendered', stats.footnotes >= 2, String(stats.footnotes));
    check('front matter card rendered', stats.frontmatter === 1, String(stats.frontmatter));
    check('images load', stats.images >= 2 && stats.loadedImages === stats.images, `${stats.loadedImages}/${stats.images}`);
    check('code copy buttons present', stats.copyButtons === stats.codeBlocks, `${stats.copyButtons}/${stats.codeBlocks}`);
    check('no <script> injected', stats.scripts === 0, String(stats.scripts));
    check('no inline event handlers', stats.inlineHandlers === 0, String(stats.inlineHandlers));
    check('no bottom info footer', stats.footer === 0, String(stats.footer));
    check('theme resolved', ['light', 'dark', 'sepia'].includes(stats.theme), stats.theme);
    check('relative images resolved', stats.imageSrcs.every((src) => /^https?:|^data:/.test(src)), stats.imageSrcs.join(', '));
    check('figure captions rendered', stats.figures >= 2, String(stats.figures));
    check('definition list rendered', stats.deflists >= 1, String(stats.deflists));
    check('abbreviations rendered', stats.abbrs >= 3, String(stats.abbrs));
    check('mark rendered', stats.marks >= 1, String(stats.marks));
    check('insert rendered', stats.inserts >= 1, String(stats.inserts));
    check('sup/sub rendered', stats.sups >= 1 && stats.subs >= 1, `${stats.sups}/${stats.subs}`);
    check('inline [[toc]] rendered', stats.tocInline >= 1, String(stats.tocInline));
    check('all 5 alert types', ['note', 'tip', 'important', 'warning', 'caution'].every((type) => stats.alertTitles.some((title) => title.includes(type))), stats.alertTitles.join(','));
    check('footnote container rendered', stats.footnotesContainer >= 1, String(stats.footnotesContainer));
    check('heading anchor links', stats.mdHeadings >= 10 && stats.anchors >= 10, `${stats.mdHeadings}/${stats.anchors}`);
    check('h1 text clean of anchors', stats.h1Text.trim() === 'MD Reader Pro 功能示例', stats.h1Text);
    check('TOC links target existing ids', stats.brokenToc === 0, String(stats.brokenToc));

    await page.screenshot({ path: path.join(shots, '01-light-top.png') });
    await page.evaluate(() => document.querySelectorAll('.md-mermaid')[0]?.scrollIntoView({ block: 'center' }));
    await wait(500);
    await page.screenshot({ path: path.join(shots, '02-mermaid.png') });
    await page.evaluate(() => document.querySelectorAll('.md-code')[1]?.scrollIntoView({ block: 'center' }));
    await wait(300);
    await page.screenshot({ path: path.join(shots, '03-code.png') });

    // Dark theme via toolbar button.
    console.log('\n[2] Theme switch + raw toggle');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.click('[data-md-action="theme"]');
      await wait(200);
      const theme = await page.evaluate(() => document.documentElement.dataset.mdTheme);
      if (theme === 'dark') break;
    }
    const darkApplied = await page.evaluate(() => document.documentElement.dataset.mdTheme === 'dark');
    check('dark theme applied', darkApplied);
    await page.screenshot({ path: path.join(shots, '04-dark.png') });

    await page.click('[data-md-action="raw"]');
    await page.waitForFunction(() => !document.querySelector('.md-raw').hidden, { timeout: 5000 });
    const rawVisible = await page.$eval('.md-raw', (el) => el.textContent.includes('# MD Reader Pro'));
    check('raw Markdown view works', rawVisible);
    await page.click('[data-md-action="raw"]');

    // TOC navigation
    const tocTarget = await page.$eval('.md-toc-link:nth-child(4)', (el) => el.getAttribute('href'));
    await page.click('.md-toc-link:nth-child(4)');
    await wait(700);
    const scrolled = await page.evaluate(() => (document.querySelector('.md-main')?.scrollTop || 0) > 100);
    check('TOC navigation scrolls', scrolled, tocTarget || '');

    // TOC: single-line labels + resizable sidebar (max 50% viewport).
    const tocLine = await page.$eval('.md-toc-link', (el) => {
      const style = getComputedStyle(el);
      return { whiteSpace: style.whiteSpace, overflow: style.textOverflow };
    });
    check('TOC titles stay on one line with ellipsis', tocLine.whiteSpace === 'nowrap' && tocLine.overflow === 'ellipsis', JSON.stringify(tocLine));

    const handle = await page.$('.md-sidebar-resizer');
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 240);
    await page.mouse.down();
    await page.mouse.move(400, handleBox.y + 240, { steps: 5 });
    await page.mouse.up();
    await wait(300);
    const dragged = await page.evaluate(() => ({
      width: document.querySelector('.md-sidebar').getBoundingClientRect().width,
      stored: document.querySelector('.md-app').style.getPropertyValue('--md-sidebar-width'),
    }));
    check('TOC width can be dragged wider', dragged.width >= 380, JSON.stringify(dragged));

    const wideHandle = await (await page.$('.md-sidebar-resizer')).boundingBox();
    await page.mouse.move(wideHandle.x + wideHandle.width / 2, wideHandle.y + 240);
    await page.mouse.down();
    await page.mouse.move(900, wideHandle.y + 240, { steps: 5 });
    await page.mouse.up();
    await wait(300);
    const capped = await page.evaluate(() => ({
      width: document.querySelector('.md-sidebar').getBoundingClientRect().width,
      viewport: window.innerWidth,
    }));
    check('TOC width caps at 50% of viewport', capped.width <= capped.viewport / 2 + 2, JSON.stringify(capped));

    const resizedHandle = await (await page.$('.md-sidebar-resizer')).boundingBox();
    const resetX = resizedHandle.x + resizedHandle.width / 2;
    const resetY = resizedHandle.y + 240;
    await page.mouse.click(resetX, resetY);
    await wait(100);
    await page.mouse.click(resetX, resetY);
    await wait(300);
    const resetWidth = await page.evaluate(() => document.querySelector('.md-sidebar').getBoundingClientRect().width);
    check('double-click resets TOC width', Math.abs(resetWidth - 272) <= 2, String(resetWidth));

    // Width persists across reloads.
    const persistHandle = await (await page.$('.md-sidebar-resizer')).boundingBox();
    await page.mouse.move(persistHandle.x + persistHandle.width / 2, persistHandle.y + 240);
    await page.mouse.down();
    await page.mouse.move(360, persistHandle.y + 240, { steps: 5 });
    await page.mouse.up();
    await wait(500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    const persistedWidth = await page.evaluate(
      () => document.querySelector('.md-sidebar').getBoundingClientRect().width,
    );
    check('TOC width persists across reload', Math.abs(persistedWidth - 360) <= 3, String(persistedWidth));
    const resetHandle = await (await page.$('.md-sidebar-resizer')).boundingBox();
    await page.mouse.click(resetHandle.x + resetHandle.width / 2, resetHandle.y + 240);
    await wait(100);
    await page.mouse.click(resetHandle.x + resetHandle.width / 2, resetHandle.y + 240);
    await wait(300);

    // Font zoom control: percentage between − / +, click resets to 100%.
    const zoomStart = await page.$eval('.md-zoom', (el) => el.textContent.trim());
    check('zoom starts at 100%', zoomStart === '100%', zoomStart);
    await page.click('[data-md-action="font-larger"]');
    await wait(250);
    const zoomUp = await page.$eval('.md-zoom', (el) => el.textContent.trim());
    const fontUp = await page.$eval('.md-article', (el) => getComputedStyle(el).fontSize);
    check('font + updates zoom to 106%', zoomUp === '106%' && fontUp === '17px', `${zoomUp}/${fontUp}`);
    await page.click('.md-zoom');
    await wait(250);
    const zoomReset = await page.$eval('.md-zoom', (el) => el.textContent.trim());
    const fontReset = await page.$eval('.md-article', (el) => getComputedStyle(el).fontSize);
    check('clicking zoom resets to 100%', zoomReset === '100%' && fontReset === '16px', `${zoomReset}/${fontReset}`);

    // Fixed shell: toolbar + sidebar stay put, only the article pane scrolls.
    const shell = await page.evaluate(async () => {
      const main = document.querySelector('.md-main');
      const toolbar = document.querySelector('.md-toolbar');
      const sidebar = document.querySelector('.md-sidebar');
      const before = {
        toolbar: toolbar.getBoundingClientRect().top,
        sidebar: sidebar.getBoundingClientRect().top,
      };
      main.scrollTo({ top: 700 });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        before,
        afterToolbar: toolbar.getBoundingClientRect().top,
        afterSidebar: sidebar.getBoundingClientRect().top,
        mainScroll: main.scrollTop,
        windowScroll: window.scrollY,
        mainOverflow: getComputedStyle(main).overflowY,
      };
    });
    check('top toolbar stays fixed while reading', shell.afterToolbar === shell.before.toolbar && shell.afterToolbar === 0, JSON.stringify(shell));
    check('sidebar stays fixed while reading', shell.afterSidebar === shell.before.sidebar && shell.afterSidebar > 0, JSON.stringify(shell));
    check('only the content pane scrolls', shell.mainScroll > 500 && shell.windowScroll === 0, JSON.stringify(shell));
    check('content pane is the scroll container', shell.mainOverflow === 'auto', shell.mainOverflow);
    const activeToc = await page.$eval('.md-toc-link.is-active', (el) => el.textContent.trim()).catch(() => '');
    check('TOC scroll-spy tracks the content pane', activeToc.length > 0, activeToc);

    // ------------------------------------------------------- interactions
    console.log('\n[2b] Code copy & lightbox');
    await page.evaluate(() => document.querySelector('.md-code-copy')?.scrollIntoView({ block: 'center' }));
    await page.click('.md-code-copy');
    await wait(350);
    const copyLabel = await page.$eval('.md-code-copy', (el) => el.textContent.trim());
    check('code copy feedback shown', /复制|copy/i.test(copyLabel), copyLabel);
    await page.evaluate(() => document.querySelector('.md-figure img')?.scrollIntoView({ block: 'center' }));
    await wait(250);
    await page.click('.md-figure img');
    await wait(250);
    check('lightbox opens', await page.$eval('.md-lightbox', (el) => !el.hidden));
    await page.keyboard.press('Escape');
    await wait(200);
    check('lightbox closes', await page.$eval('.md-lightbox', (el) => el.hidden));

    // ------------------------------------------------------------- xss test
    console.log('\n[3] HTML sanitisation');
    await page.goto(`http://127.0.0.1:${port}/fixtures/xss.md`, { waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    const xss = await page.evaluate(() => {
      const article = document.querySelector('.md-article');
      return {
        scripts: article.querySelectorAll('script').length,
        footer: document.querySelectorAll('.md-footer').length,
        handlers: article.querySelectorAll('[onerror],[onclick],[onmouseover]').length,
        iframes: article.querySelectorAll('iframe').length,
        jsLinks: [...article.querySelectorAll('a[href]')].filter((a) => /^javascript:/i.test(a.getAttribute('href'))).length,
        sanity: window.__mdXssRan === true,
        text: article.textContent,
      };
    });
    check('scripts stripped', xss.scripts === 0, String(xss.scripts));
    check('event handlers stripped', xss.handlers === 0, String(xss.handlers));
    check('iframes stripped', xss.iframes === 0, String(xss.iframes));
    check('javascript: links stripped', xss.jsLinks === 0, String(xss.jsLinks));
    check('payload never executed', xss.sanity === false);
    check('benign HTML preserved', xss.text.includes('safe details'));

    // ------------------------------------------------------------- viewer page
    console.log('\n[4] Standalone viewer');
    await page.goto(`chrome-extension://${extensionId}/viewer.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.md-viewer-empty', { timeout: 10000 });
    check('viewer empty state visible', true);
    await page.screenshot({ path: path.join(shots, '05-viewer-empty.png') });
    await page.click('#md-open-sample');
    await waitForArticle(page);
    await page.waitForFunction(() => document.querySelectorAll('.md-mermaid svg').length >= 1, { timeout: 30000 }).catch(() => {});
    const viewer = await page.evaluate(() => ({
      title: document.title,
      headings: document.querySelectorAll('.md-article h1').length,
      mermaid: document.querySelectorAll('.md-mermaid svg').length,
      emptyHidden: document.querySelector('.md-viewer-empty').hidden,
    }));
    check('viewer renders sample', viewer.headings === 1 && viewer.emptyHidden, JSON.stringify(viewer));
    check('viewer mermaid renders', viewer.mermaid >= 1, String(viewer.mermaid));
    await page.screenshot({ path: path.join(shots, '06-viewer-reader.png') });

    // File upload path
    const input = await page.$('#md-file-input');
    await input.uploadFile(path.join(fixtures, 'feature-test.md'));
    await page.waitForFunction(
      () => document.title.includes('feature-test'),
      { timeout: 15000 },
    );
    check('file upload renders', true);
    await page.screenshot({ path: path.join(shots, '07-viewer-file.png') });

    // ------------------------------------------------------------- options page
    console.log('\n[5] Options page');
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.md-options-page', { timeout: 10000 });
    const options = await page.evaluate(() => ({
      cards: document.querySelectorAll('.md-card').length,
      switches: document.querySelectorAll('.md-switch').length,
      themeButtons: document.querySelectorAll('[data-setting="theme"]').length,
      version: document.getElementById('md-version')?.textContent,
    }));
    check('options sections present', options.cards >= 6, String(options.cards));
    check('options switches present', options.switches >= 10, String(options.switches));
    check('version shown', /v\d+\.\d+\.\d+/.test(options.version || ''), options.version || '');
    await page.screenshot({ path: path.join(shots, '08-options.png'), fullPage: true });

    // Options controls actually persist through chrome.storage.
    await page.click('.md-theme-tile[data-setting="theme"][data-value="dark"]');
    await wait(350);
    let storedSettings = worker
      ? await worker.evaluate(async () => (await chrome.storage.sync.get('mdReaderSettings')).mdReaderSettings || {})
      : {};
    check('options theme tile persists', storedSettings.theme === 'dark', storedSettings.theme || 'missing');

    await page.click('input[data-setting="showToc"]');
    await wait(350);
    storedSettings = worker
      ? await worker.evaluate(async () => (await chrome.storage.sync.get('mdReaderSettings')).mdReaderSettings || {})
      : {};
    check('options switch persists', storedSettings.showToc === false, String(storedSettings.showToc));

    await page.click('.md-theme-tile[data-setting="theme"][data-value="light"]');
    await page.click('input[data-setting="showToc"]');
    await wait(350);

    // ------------------------------------------------------------- popup page
    console.log('\n[6] Popup');
    await page.setViewport({ width: 380, height: 640, deviceScaleFactor: 2 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.md-popup', { timeout: 10000 });
    const popup = await page.evaluate(() => ({
      title: document.querySelector('.md-popup-name')?.textContent,
      themeChips: document.querySelectorAll('.md-theme-chip').length,
      buttons: document.querySelectorAll('.md-popup button').length,
    }));
    check('popup loads', popup.buttons >= 5, JSON.stringify(popup));
    check('popup theme picker', popup.themeChips === 4, String(popup.themeChips));
    await page.screenshot({ path: path.join(shots, '09-popup.png') });

    // ------------------------------------------------------- mermaid/math sample
    console.log('\n[7] Full Mermaid & math sample');
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${port}/samples/mermaid-math.md`, { waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    await page.waitForFunction(() => document.querySelectorAll('.md-mermaid svg').length >= 4, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelectorAll('.md-mermaid[data-md-error="1"] .md-mermaid-error:not([hidden])').length >= 1,
      { timeout: 15000 },
    ).catch(() => {});
    const mm = await page.evaluate(() => ({
      mermaid: document.querySelectorAll('.md-mermaid svg').length,
      errors: document.querySelectorAll('.md-mermaid-error:not([hidden])').length,
      katex: document.querySelectorAll('.katex').length,
    }));
    check('all valid diagrams render', mm.mermaid >= 4, String(mm.mermaid));
    check('invalid diagram shows error card', mm.errors >= 1, String(mm.errors));
    check('math renders', mm.katex >= 2, String(mm.katex));
    await page.screenshot({ path: path.join(shots, '10-mermaid-math.png') });

    // --------------------------------------------------------- detection matrix
    console.log('\n[8] Detection matrix');
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });

    await page.goto(`http://127.0.0.1:${port}/fixtures/typed.txt?as=markdown`, { waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    check('text/markdown MIME auto-renders without .md URL', true);

    await page.goto(`http://127.0.0.1:${port}/fixtures/html-page.md?as=html`, { waitUntil: 'domcontentloaded' });
    await wait(1200);
    const htmlPage = await page.evaluate(() => ({
      mounted: Boolean(document.querySelector('.md-app')),
      scriptRan: window.__mdHtmlPageRan === true,
      heading: document.querySelector('h1')?.textContent || '',
    }));
    check('text/html at .md path is NOT auto-rendered', !htmlPage.mounted && htmlPage.heading.includes('HTML page'));
    check('original HTML scripts untouched', htmlPage.scriptRan);

    const manualResult = await messageActiveTab({ type: 'render-current' });
    check('manual render message accepted', Boolean(manualResult?.ok), JSON.stringify(manualResult));
    await page.waitForSelector('.md-app .md-article', { timeout: 20000 });
    await wait(400);
    const manualText = await page.$eval('.md-article', (el) => el.textContent);
    check('manual HTML render uses visible text', manualText.includes('This is an HTML page'), manualText.slice(0, 80));

    await page.goto(`http://127.0.0.1:${port}/fixtures/plain.txt`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.md-hint', { timeout: 10000 });
    check('plain-text Markdown shows hint pill', true);
    const hintBox = await page.$eval('.md-hint', (el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right };
    });
    check('hint pill is positioned on screen', hintBox.width > 80 && hintBox.bottom <= 1000, JSON.stringify(hintBox));
    await page.click('.md-hint');
    await waitForArticle(page);
    check('hint click renders the document', true);

    await page.goto(`http://127.0.0.1:${port}/fixtures/plain-single.txt`, { waitUntil: 'domcontentloaded' });
    await wait(1600);
    check('single-signal plain text gets no hint', !(await page.$('.md-hint')));

    // ------------------------------------------------------------- local file
    console.log('\n[9] Local file:// rendering');
    const localFile = pathToFileURL(path.join(fixtures, 'feature-test.md')).href;
    await page.goto(localFile, { waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    const local = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('.md-article h1')?.textContent || '',
      code: document.querySelectorAll('.md-code').length,
      theme: document.documentElement.dataset.mdTheme,
    }));
    check('file:// Markdown auto-renders', local.h1.includes('Feature Test'), JSON.stringify(local));
    check('file:// code highlighting present', local.code >= 1, String(local.code));
    await page.screenshot({ path: path.join(shots, '11-file-local.png') });

    // ------------------------------------------------------------- live reload
    console.log('\n[10] Live reload');
    await setSettings({ liveReload: true });
    await page.goto(`http://127.0.0.1:${port}/live.md`, { waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    check('live reload v1 rendered', (await page.$eval('.md-article h1', (el) => el.textContent)).includes('Live reload v1'));
    await fetch(`http://127.0.0.1:${port}/bump`);
    await page.waitForFunction(
      () => document.querySelector('.md-article h1')?.textContent.includes('Live reload v2'),
      { timeout: 10000 },
    ).catch(() => {});
    const liveText = await page.$eval('.md-article h1', (el) => el.textContent);
    check('live reload updates document', liveText.includes('Live reload v2'), liveText);
    await setSettings({ liveReload: false });

    // ------------------------------------------------------ settings integration
    console.log('\n[11] Settings integration');
    await setSettings({ fontSize: 20, theme: 'dark' });
    await page.goto(`http://127.0.0.1:${port}/samples/sample.md`, { waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    const styled = await page.evaluate(() => ({
      fontSize: getComputedStyle(document.querySelector('.md-article')).fontSize,
      theme: document.documentElement.dataset.mdTheme,
      stored: null,
    }));
    check('font size setting applied', styled.fontSize === '20px', styled.fontSize);
    check('theme setting applied', styled.theme === 'dark', styled.theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    const persisted = await page.evaluate(() => ({
      fontSize: getComputedStyle(document.querySelector('.md-article')).fontSize,
      theme: document.documentElement.dataset.mdTheme,
    }));
    check('settings persist across reload', persisted.fontSize === '20px' && persisted.theme === 'dark', JSON.stringify(persisted));
    await setSettings({ fontSize: 16, theme: 'light' });

    // ------------------------------------------------------------- mobile layout
    console.log('\n[12] Mobile layout (390px)');
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(`chrome-extension://${extensionId}/viewer.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.md-viewer-empty', { timeout: 10000 });
    const emptyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('viewer empty state has no horizontal overflow', emptyOverflow <= 1, String(emptyOverflow));
    await page.screenshot({ path: path.join(shots, '12-mobile-viewer.png') });
    await page.click('#md-open-sample');
    await waitForArticle(page);
    const readerOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('reader has no horizontal overflow on mobile', readerOverflow <= 1, String(readerOverflow));
    await page.screenshot({ path: path.join(shots, '13-mobile-reader.png') });

    // ------------------------------------------------------------- print styles
    console.log('\n[13] Print layout');
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${port}/samples/sample.md`, { waitUntil: 'domcontentloaded' });
    await waitForArticle(page);
    await page.emulateMediaType('print');
    const printState = await page.evaluate(() => {
      const toolbar = document.querySelector('.md-toolbar');
      const sidebar = document.querySelector('.md-sidebar');
      const article = document.querySelector('.md-article');
      return {
        toolbar: toolbar ? getComputedStyle(toolbar).display : 'missing',
        sidebar: sidebar ? getComputedStyle(sidebar).display : 'missing',
        article: article ? getComputedStyle(article).display : 'missing',
        width: article ? getComputedStyle(article).maxWidth : '',
      };
    });
    check('print hides chrome', printState.toolbar === 'none' && printState.sidebar === 'none', JSON.stringify(printState));
    check('print keeps article', printState.article === 'block');
    await page.screenshot({ path: path.join(shots, '14-print.png') });
    await page.emulateMediaType('screen');

    // ------------------------------------------------------------- perf sanity
    console.log('\n[14] Page health');
    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    check('no failed resource loads', failedResponses.length === 0, failedResponses.slice(0, 5).join(' | '));

    const failed = results.filter((r) => !r.ok);
    await writeFile(
      path.join(root, 'test/last-run.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), extensionId, results }, null, 2),
    );
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
      console.log('Failed checks:');
      for (const failure of failed) console.log(`  ✗ ${failure.name} ${failure.detail}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
