#!/usr/bin/env node
/**
 * Generates config/genesis-levels.json from module metadata.
 * Scans module directories for metadata.genesis declarations.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { toCanonicalBrowserPath, toPosix } from './browser-tree-paths.js';
import { openBrowserTree } from '../server/browser-tree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SELF_ROOT = path.join(ROOT, 'self');

const TEMPLATE_PATH = path.join(SELF_ROOT, 'config', 'genesis-template.json');
const OUTPUT_PATH = path.join(SELF_ROOT, 'config', 'genesis-levels.json');
const SEARCH_ROOTS = ['core', 'infrastructure', 'capabilities', 'experimental', 'testing'];

/** Served paths of modules under the search roots, wherever their source root is. */
async function walkFiles() {
  const tree = await openBrowserTree();
  return tree.files.filter(served => served.endsWith('.js') && SEARCH_ROOTS.some(dir => served.startsWith(dir + '/')))
    .map(served => ({ served, absolute: tree.absolute(served) }));
}

const SKIP_BASENAMES = new Set(['verification-worker.js', 'worker-agent.js']);

const shouldSkipFile = (filePath) => SKIP_BASENAMES.has(path.basename(filePath));

async function loadModuleMetadata({ served, absolute: filePath }) {
  if (shouldSkipFile(filePath)) return null;
  try {
    const mod = await import(pathToFileURL(filePath).href);
    const metadata = mod?.default?.metadata;

    if (!metadata?.id || !metadata?.genesis?.introduced) {
      return null;
    }

    const relativePath = toCanonicalBrowserPath(served);
    const files = Array.isArray(metadata.files) && metadata.files.length > 0
      ? metadata.files.map(toPosix)
      : [relativePath];

    return {
      id: metadata.id,
      introduced: metadata.genesis.introduced,
      files
    };
  } catch (error) {
    console.warn(`[genesis-manifest] Skipping ${filePath}: ${error.message}`);
    return null;
  }
}

async function collectModules() {
  const modules = [];
  for (const file of await walkFiles()) {
    const metadata = await loadModuleMetadata(file);
    if (metadata) modules.push(metadata);
  }
  return modules;
}

async function main() {
  const templateRaw = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const template = JSON.parse(templateRaw);
  const levels = template.levels || {};

  // Reset template fields that will be regenerated
  for (const level of Object.keys(levels)) {
    levels[level].modules = [];
  }

  const modules = await collectModules();

  const moduleFiles = {};

  for (const mod of modules) {
    if (!levels[mod.introduced]) {
      console.warn(`[genesis-manifest] Unknown level "${mod.introduced}" for module ${mod.id}`);
      continue;
    }

    levels[mod.introduced].modules.push(mod.id);
    moduleFiles[mod.id] = mod.files;
  }

  // Sort module lists and moduleFiles keys for determinism
  for (const level of Object.keys(levels)) {
    levels[level].modules.sort((a, b) => a.localeCompare(b));
  }

  const sortedModuleFiles = {};
  for (const key of Object.keys(moduleFiles).sort()) {
    sortedModuleFiles[key] = moduleFiles[key];
  }

  const output = {
    ...template,
    levels,
    moduleFiles: sortedModuleFiles
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[genesis-manifest] Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[genesis-manifest] Failed to build manifest');
  console.error(err);
  process.exit(1);
});
