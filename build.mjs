#!/usr/bin/env node
/**
 * Build script for MD Reader Pro.
 *
 * Produces a self-contained, MV3-safe extension in dist/:
 *  - no remote code, no inline scripts, no eval
 *  - one shared ESM renderer bundle (lazy chunks for mermaid)
 *  - one shared stylesheet for every surface
 */
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

const shared = {
  bundle: true,
  target: ['chrome110'],
  legalComments: 'none',
  logLevel: 'info',
  sourcemap: dev ? 'linked' : false,
  minify: !dev,
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
  },
};

const assetLoader = {
  '.woff': 'file',
  '.woff2': 'dataurl',
  '.ttf': 'file',
  '.otf': 'file',
  '.png': 'file',
  '.svg': 'file',
};

/** @type {import('esbuild').BuildOptions[]} */
const jobs = [
  {
    ...shared,
    entryPoints: [{ in: path.join(root, 'src/render/index.js'), out: 'renderer' }],
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    outdir: dist,
    entryNames: '[name]',
    assetNames: 'fonts/[name]-[hash]',
    loader: assetLoader,
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'src/content/content.js')],
    outfile: path.join(dist, 'content.js'),
    format: 'iife',
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'src/background/background.js')],
    outfile: path.join(dist, 'background.js'),
    format: 'iife',
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'src/viewer/viewer.js')],
    outfile: path.join(dist, 'viewer.js'),
    format: 'iife',
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'src/popup/popup.js')],
    outfile: path.join(dist, 'popup.js'),
    format: 'iife',
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'src/options/options.js')],
    outfile: path.join(dist, 'options.js'),
    format: 'iife',
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'src/ui/styles/reader.css')],
    outfile: path.join(dist, 'reader.css'),
    loader: assetLoader,
    assetNames: 'fonts/[name]-[hash]',
  },
];

const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['src/viewer/viewer.html', 'viewer.html'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/options/options.html', 'options.html'],
];

async function copyStatic() {
  for (const [from, to] of staticFiles) {
    const source = path.join(root, from);
    if (!existsSync(source)) continue;
    await mkdir(path.dirname(path.join(dist, to)), { recursive: true });
    await cp(source, path.join(dist, to), { force: true });
  }
  const icons = path.join(root, 'assets/icons');
  if (existsSync(icons)) {
    await cp(icons, path.join(dist, 'icons'), { recursive: true, force: true });
  }
  const locales = path.join(root, '_locales');
  if (existsSync(locales)) {
    await cp(locales, path.join(dist, '_locales'), { recursive: true, force: true });
  }
  const samples = path.join(root, 'src/samples');
  if (existsSync(samples)) {
    await cp(samples, path.join(dist, 'samples'), { recursive: true, force: true });
  }
}

async function checkManifest() {
  const manifestPath = path.join(dist, 'manifest.json');
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const referenced = new Set();
  const add = (p) => p && !p.includes('*') && referenced.add(p);
  add(manifest.background?.service_worker);
  for (const script of manifest.content_scripts || []) {
    (script.js || []).forEach(add);
    (script.css || []).forEach(add);
  }
  add(manifest.action?.default_popup);
  add(manifest.options_ui?.page);
  for (const icon of Object.values(manifest.icons || {})) add(icon);
  for (const res of manifest.web_accessible_resources || []) {
    for (const entry of res.resources || []) if (!entry.includes('*')) add(entry);
  }
  const missing = [];
  for (const file of referenced) {
    if (!existsSync(path.join(dist, file))) missing.push(file);
  }
  if (missing.length) {
    console.warn(`\n⚠ manifest references missing files:\n  ${missing.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ manifest: ${referenced.size} referenced files present`);
  }
}

async function run() {
  if (!watch) await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await copyStatic();

  if (watch) {
    for (const job of jobs) {
      const ctx = await context(job);
      await ctx.watch();
    }
    console.log('👀 watching…');
    // Keep process alive; static assets are copied once. Re-run manually if edited.
    return;
  }

  await Promise.all(jobs.map((job) => build(job)));
  await checkManifest();

  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
  const sizes = await Promise.all(
    ['renderer.js', 'content.js', 'background.js', 'viewer.js', 'reader.css'].map(
      async (name) => {
        try {
          const info = await stat(path.join(dist, name));
          return `${name} ${(info.size / 1024).toFixed(1)} KB`;
        } catch {
          return `${name} (missing)`;
        }
      },
    ),
  );
  console.log(`\n✓ built ${manifest.name} v${manifest.version}`);
  console.log('  ' + sizes.join(' | '));
}

await run();
