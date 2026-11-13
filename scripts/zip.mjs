#!/usr/bin/env node
/**
 * Package `dist/` into `release/md-reader-pro-v<version>.zip`.
 *
 * Uses the system `zip` binary (macOS/Linux) so no extra dependency is needed.
 * Build first (`npm run build`), then run `npm run zip`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const release = path.join(root, 'release');

const EXCLUDED_DIRS = new Set(['__MACOSX', '.git', 'node_modules']);
const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const EXCLUDED_EXTENSIONS = new Set(['.map']);

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function isExcluded(name, isDirectory) {
  if (isDirectory) return EXCLUDED_DIRS.has(name);
  if (EXCLUDED_FILES.has(name)) return true;
  return EXCLUDED_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Walk `directory` and return the packaged file count and byte size. */
async function collect(directory) {
  let files = 0;
  let bytes = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (isExcluded(entry.name, entry.isDirectory())) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await collect(full);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await stat(full)).size;
    }
  }
  return { files, bytes };
}

async function main() {
  const manifestPath = path.join(dist, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error('✗ dist/manifest.json not found — run `npm run build` first.');
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const version = manifest.version || '0.0.0';
  const packageJson = await readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  if (packageJson.version && packageJson.version !== version) {
    console.warn(`⚠ package.json version (${packageJson.version}) differs from manifest (${version}); using manifest.`);
  }

  const fileName = `md-reader-pro-v${version}.zip`;
  const target = path.join(release, fileName);

  await mkdir(release, { recursive: true });
  await rm(target, { force: true });

  try {
    execFileSync(
      'zip',
      [
        '-r',
        '-q',
        '-X',
        target,
        '.',
        '-x',
        '.DS_Store',
        '*/.DS_Store',
        'Thumbs.db',
        '*/.git/*',
        '*/__MACOSX/*',
        '*.map',
        '*/*.map',
      ],
      { cwd: dist, stdio: 'inherit' },
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.error('✗ the `zip` command was not found. Install it (macOS ships with it) and retry.');
    } else {
      console.error('✗ zip failed:', error?.message || error);
    }
    process.exitCode = 1;
    return;
  }

  const [{ files, bytes }, zipInfo] = await Promise.all([collect(dist), stat(target)]);
  console.log(`✓ release/${fileName}`);
  console.log(
    `  ${files} files · dist ${formatBytes(bytes)} · zip ${formatBytes(zipInfo.size)} (${zipInfo.size} bytes)`,
  );
}

await main();
