#!/usr/bin/env node
/**
 * Generates the deterministic byte manifest for the Firebase-served self/ tree.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildHostingFileSet } from './hosting-file-set.js';

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

async function main() {
  const files = await buildHostingFileSet({ selfDir: SELF_DIR });
  const entries = await Promise.all(files.filter(file => file !== BROWSER_BUNDLE_DESCRIPTOR_PATH)
    .map(async file => ({ path: file, bytes: new Uint8Array(await fs.readFile(path.join(SELF_DIR, file))) })));
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
