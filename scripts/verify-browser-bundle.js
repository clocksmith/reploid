#!/usr/bin/env node
/**
 * Verifies that every locally declared browser-bundle byte is served unchanged.
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
const MANIFEST_PATH = path.join(SELF_DIR, BROWSER_BUNDLE_DESCRIPTOR_PATH);
const args = process.argv.slice(2);

const valueArg = (name) => {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const positionalUrl = args.find((arg) => !arg.startsWith('-'));
const baseUrl = String(
  valueArg('--url')
  || positionalUrl
  || process.env.REPLOID_POOL_RELEASE_URL
  || process.env.REPLOID_POOL_DEPLOYMENT_URL
  || ''
).replace(/\/+$/, '');
const allowLocal = args.includes('--allow-local');

if (!baseUrl) {
  console.error('[browser-bundle] A deployed URL is required');
  process.exit(1);
}
const parsedUrl = new URL(baseUrl);
const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname);
if (isLocal && !allowLocal) {
  console.error('[browser-bundle] Local verification requires --allow-local');
  process.exit(1);
}

const publicUrl = (relativePath, bundleHash) => {
  const pathname = relativePath.split('/').map(encodeURIComponent).join('/');
  const url = new URL(`/${pathname}`, `${baseUrl}/`);
  url.searchParams.set('browser-bundle', bundleHash);
  return url;
};

async function fetchEntry(file, bundleHash) {
  const url = publicUrl(file.path, bundleHash);
  const response = await fetch(url, {
    headers: {
      Accept: '*/*',
      'Cache-Control': 'no-cache'
    }
  });
  if (!response.ok) throw new Error(`${file.path} returned HTTP ${response.status}`);
  return { path: file.path, bytes: new Uint8Array(await response.arrayBuffer()) };
}

async function fetchAll(files, bundleHash, concurrency = 8) {
  const results = new Array(files.length);
  const failures = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await fetchEntry(files[index], bundleHash);
      } catch (error) {
        failures.push(error.message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  if (failures.length > 0) {
    throw new Error(`deployed browser bundle is incomplete:\n- ${failures.join('\n- ')}`);
  }
  return results;
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const manifestValidation = await validateBrowserBundleManifest(manifest);
  if (!manifestValidation.ok) {
    throw new Error(`local browser bundle manifest is invalid: ${manifestValidation.reasons.join('; ')}`);
  }
  const deployedDescriptor = await fetchEntry({ path: BROWSER_BUNDLE_DESCRIPTOR_PATH }, manifest.bundleHash);
  let deployedDeclaredManifest;
  try {
    deployedDeclaredManifest = JSON.parse(new TextDecoder().decode(deployedDescriptor.bytes));
  } catch (error) {
    throw new Error(`deployed browser bundle descriptor is invalid JSON: ${error.message}`);
  }
  const deployedDescriptorValidation = await validateBrowserBundleManifest(deployedDeclaredManifest);
  if (!deployedDescriptorValidation.ok) {
    throw new Error(`deployed browser bundle descriptor is invalid: ${deployedDescriptorValidation.reasons.join('; ')}`);
  }
  if (JSON.stringify(deployedDeclaredManifest) !== JSON.stringify(manifest)) {
    throw new Error(
      `deployed browser bundle descriptor ${deployedDeclaredManifest.bundleHash} `
      + `does not match local ${manifest.bundleHash}`
    );
  }
  const deployedEntries = await fetchAll(manifest.files, manifest.bundleHash);
  const deployedManifest = await buildBrowserBundleManifest(deployedEntries);
  if (JSON.stringify(deployedManifest) !== JSON.stringify(manifest)) {
    const expectedFiles = new Map(manifest.files.map((file) => [file.path, file]));
    const changed = deployedManifest.files.filter((file) => {
      const expected = expectedFiles.get(file.path);
      return !expected || expected.byteLength !== file.byteLength || expected.sha256 !== file.sha256;
    }).map((file) => file.path);
    throw new Error(
      `deployed browser bytes do not match ${manifest.bundleHash}`
      + `${changed.length ? `: ${changed.join(', ')}` : ''}`
    );
  }
  console.log(`[browser-bundle] verified ${manifest.files.length} deployed files at ${baseUrl} as ${manifest.bundleHash}`);
}

main().catch((error) => {
  console.error(`[browser-bundle] ${error.message}`);
  process.exit(1);
});
