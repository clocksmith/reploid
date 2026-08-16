#!/usr/bin/env node
/**
 * Generates the deterministic byte manifest for the Firebase-served self/ tree.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  BROWSER_BUNDLE_DESCRIPTOR_PATH,
  buildBrowserBundleManifest,
  validateBrowserBundleManifest
} from '../self/pool/browser-release-identity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SELF_DIR = path.join(ROOT, 'self');
const OUTPUT_PATH = path.join(SELF_DIR, BROWSER_BUNDLE_DESCRIPTOR_PATH);
const checkOnly = process.argv.includes('--check');

const isFirebaseIgnored = (relativePath) => relativePath
  .split('/')
  .some((segment) => segment.startsWith('.') || segment === 'node_modules');

async function walkPublicFiles(directory = SELF_DIR) {
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const dirent of dirents) {
    const filePath = path.join(directory, dirent.name);
    const relativePath = path.relative(SELF_DIR, filePath).split(path.sep).join('/');
    if (isFirebaseIgnored(relativePath)) continue;
    if (dirent.isDirectory()) {
      files.push(...await walkPublicFiles(filePath));
    } else if (dirent.isFile() && relativePath !== BROWSER_BUNDLE_DESCRIPTOR_PATH) {
      files.push({ path: relativePath, bytes: new Uint8Array(await fs.readFile(filePath)) });
    }
  }
  return files;
}

async function main() {
  const entries = await walkPublicFiles();
  const manifest = await buildBrowserBundleManifest(entries);
  if (checkOnly) {
    let existing;
    try {
      existing = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
    } catch {
      throw new Error(`browser bundle manifest is missing or invalid: ${OUTPUT_PATH}`);
    }
    const validation = await validateBrowserBundleManifest(existing, { entries });
    if (!validation.ok) {
      throw new Error(`browser bundle manifest is stale: ${validation.reasons.join('; ')}`);
    }
    console.log(`[browser-bundle] ${entries.length} served files match ${existing.bundleHash}`);
    return;
  }
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[browser-bundle] Wrote ${OUTPUT_PATH} with ${entries.length} served files as ${manifest.bundleHash}`);
}

main().catch((error) => {
  console.error(`[browser-bundle] ${error.message}`);
  process.exit(1);
});
