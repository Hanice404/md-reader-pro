#!/usr/bin/env node
/**
 * Renderer-focused smoke test (optional; Lead owns the full E2E).
 *
 * Serves the project root over HTTP, opens `test/render/harness.html` in
 * headless Chrome and prints the harness results. The harness exercises the
 * DOM contract from docs/CONTRACT.md §3 in a real browser: headings/TOC,
 * tables, code blocks, KaTeX, figures, footnotes, alerts, sanitisation,
 * Mermaid (including failures and theme re-render) and a >4 MB document.
 *
 * Usage: npm run build && node test/render/check.mjs
 * Requires the already-installed puppeteer-core + a local Chrome/Chromium.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'dist');
const harness = path.join(root, 'test/render/harness.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(root, relative || 'test/render/harness.html');
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      await stat(file);
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  if (!existsSync(path.join(dist, 'renderer.js'))) {
    console.error('dist/renderer.js is missing — run `npm run build` first.');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(harness)) {
    console.error('test/render/harness.html is missing.');
    process.exitCode = 1;
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    console.log('No Chrome/Chromium found (set CHROME_PATH). Skipping renderer check.');
    return;
  }

  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--window-size=1280,900'],
  });

  const pageErrors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Ignore resource-loading noise (fixture images intentionally do not exist).
      if (/Failed to load resource/i.test(text)) return;
      pageErrors.push(`console: ${text}`);
    });

    await page.goto(`http://127.0.0.1:${port}/test/render/harness.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForFunction(() => window.__mdDone === true, { timeout: 180000 });
    const results = await page.evaluate(() => window.__mdResults || []);
    const failed = results.filter((item) => !item.ok);

    console.log('\nMD Reader Pro · renderer harness');
    let lastGroup = '';
    for (const item of results) {
      const groupName = item.name.includes('] ') ? item.name.slice(0, item.name.indexOf('] ') + 1) : '';
      if (groupName !== lastGroup) {
        lastGroup = groupName;
        if (groupName) console.log(`\n${groupName}`);
      }
      const label = groupName ? item.name.slice(groupName.length).trim() : item.name;
      console.log(`  ${item.ok ? '✓' : '✗'} ${label}${!item.ok && item.detail ? ` — ${item.detail}` : ''}`);
    }
    for (const error of pageErrors) console.log(`  ✗ page error — ${error}`);

    const total = results.length + pageErrors.length;
    const failures = failed.length + pageErrors.length;
    console.log(`\n${total - failures}/${total} checks passed`);
    if (failures) {
      console.log('Failed checks:');
      for (const item of failed) console.log(`  ✗ ${item.name} ${item.detail}`);
      for (const error of pageErrors) console.log(`  ✗ page error ${error}`);
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
