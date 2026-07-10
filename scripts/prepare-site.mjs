#!/usr/bin/env node
/** Builds the minimal static artifact deployed to GitHub Pages. */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'dist');
const manifestPath = resolve(root, 'data/latest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const snapshotPath = manifest.tiles?.geojson_url;

if (!snapshotPath?.startsWith('data/')) throw new Error('The published snapshot must be a repository data path.');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of ['index.html', 'app.css', 'app.js', 'data/latest.json']) {
  const source = resolve(root, asset);
  const target = resolve(output, asset);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

const snapshotSource = resolve(root, snapshotPath);
const snapshotTarget = resolve(output, snapshotPath);
await mkdir(dirname(snapshotTarget), { recursive: true });
await copyFile(snapshotSource, snapshotTarget);
await writeFile(resolve(output, '.nojekyll'), '');
process.stdout.write(`Prepared Pages artifact with ${manifest.coverage.city_count.toLocaleString()} cities.\n`);
