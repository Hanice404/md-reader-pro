#!/usr/bin/env node
/**
 * Generate the curated screenshots used by README / documentation.
 *
 * Usage:
 *   npx @puppeteer/browsers install chrome@stable --path .chrome   (once)
 *   npm run screenshots
 *
 * Requires `dist/` (run `npm run build` first).
 */
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'docs/screenshots');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function findChromeForTesting() {
  const base = path.join(root, '.chrome');
  if (!existsSync(base)) return null;
  for (const entry of readdirSync(base, { recursive: true })) {
    const full = path.join(base, entry.toString());
    if (
      /Google Chrome for Testing$/.test(full) ||
      /chrome-linux64\/chrome$/.test(full) ||
      /chrome-win64\\chrome\.exe$/.test(full)
    ) {
      return full;
    }
  }
  return null;
}

function extensionIdFromPath(dir) {
  const hash = createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function startServer(port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      const file = path.join(dist, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!existsSync(path.join(dist, 'manifest.json'))) {
    throw new Error('dist/ is missing — run `npm run build` first');
  }
  const chrome = process.env.CHROME_PATH || findChromeForTesting();
  if (!chrome) {
    throw new Error(
      'Chrome for Testing not found. Run:\n  npx @puppeteer/browsers install chrome@stable --path .chrome',
    );
  }
  await mkdir(out, { recursive: true });

  const port = 4188;
  const server = await startServer(port);
  const profile = path.join(root, '.tmp', 'screenshot-profile');
  await rm(profile, { recursive: true, force: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    enableExtensions: true,
    userDataDir: profile,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--disable-extensions-file-access-check',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,960',
    ],
  });

  let extensionId = extensionIdFromPath(dist);
  let worker = null;
  try {
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 });
    const match = target.url().match(/^chrome-extension:\/\/([a-p]+)\//);
    if (match) extensionId = match[1];
    worker = await target.worker();
  } catch {
    /* fall back to derived id */
  }

  const setSettings = async (patch) => {
    if (!worker) return;
    await worker.evaluate(async (next) => {
      const key = 'mdReaderSettings';
      const current = (await chrome.storage.sync.get(key))[key] || {};
      await chrome.storage.sync.set({ [key]: { ...current, ...next } });
    }, patch);
  };

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });
  const shot = async (name, options = {}) => {
    await page.mouse.move(2, 2);
    await wait(120);
    await page.screenshot({ path: path.join(out, `${name}.png`), ...options });
  };

  const openSample = async () => {
    await page.goto(`http://127.0.0.1:${port}/samples/sample.md`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.md-app .md-article', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.md-mermaid svg').length >= 1, {
      timeout: 30000,
    }).catch(() => {});
    await wait(500);
  };

  console.log('reader · light');
  await setSettings({ theme: 'light', fontSize: 16, showToc: true, readingProgress: true });
  await openSample();
  await shot('reader-light');

  console.log('reader · mermaid');
  await page.evaluate(() => {
    const diagram = document.querySelector('.md-mermaid');
    const main = document.querySelector('.md-main');
    if (!diagram || !main) return;
    main.scrollTo({
      top: diagram.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 170,
    });
  });
  await wait(400);
  await shot('reader-mermaid');

  console.log('reader · code');
  await page.evaluate(() => {
    const code = [...document.querySelectorAll('.md-code')].find((el) =>
      el.textContent.includes('readingProgress'),
    );
    const main = document.querySelector('.md-main');
    if (!code || !main) return;
    main.scrollTo({
      top: code.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 170,
    });
  });
  await wait(300);
  await shot('reader-code');

  console.log('reader · table');
  await page.evaluate(() => {
    const table = document.querySelector('.md-table-wrap');
    const main = document.querySelector('.md-main');
    if (!table || !main) return;
    main.scrollTo({
      top: table.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 170,
    });
  });
  await wait(300);
  await shot('reader-table');

  console.log('reader · bottom');
  await page.evaluate(() => {
    const main = document.querySelector('.md-main');
    if (main) main.scrollTo({ top: main.scrollHeight });
  });
  await wait(300);
  await shot('reader-bottom');

  console.log('reader · dark');
  await setSettings({ theme: 'dark' });
  await openSample();
  await shot('reader-dark');

  console.log('reader · sepia');
  await setSettings({ theme: 'sepia' });
  await openSample();
  await shot('reader-sepia');

  console.log('viewer · empty');
  await setSettings({ theme: 'light' });
  await page.goto(`chrome-extension://${extensionId}/viewer.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.md-viewer-empty', { timeout: 10000 });
  await wait(300);
  await shot('viewer-empty');

  console.log('viewer · reading');
  await page.click('#md-open-sample');
  await page.waitForSelector('.md-app .md-article', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.md-mermaid svg').length >= 1, {
    timeout: 30000,
  }).catch(() => {});
  await wait(500);
  await shot('viewer-reading');

  console.log('options');
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.md-options-page', { timeout: 10000 });
  await wait(300);
  await shot('options');

  console.log('popup');
  await page.setViewport({ width: 380, height: 660, deviceScaleFactor: 2 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.md-popup', { timeout: 10000 });
  await wait(300);
  await shot('popup');

  console.log('mobile');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`chrome-extension://${extensionId}/viewer.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.md-viewer-empty', { timeout: 10000 });
  await wait(300);
  await shot('viewer-mobile');
  await page.click('#md-open-sample');
  await page.waitForSelector('.md-app .md-article', { timeout: 20000 });
  await wait(500);
  await shot('reader-mobile');

  await browser.close();
  server.close();
  console.log(`\n✓ screenshots written to ${path.relative(root, out)}/`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
