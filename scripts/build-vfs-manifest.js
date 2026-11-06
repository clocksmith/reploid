#!/usr/bin/env node
/**
 * Generates config/vfs-manifest.json from the served browser tree.
 */

import { promises as fs } from 'fs';
import { toCanonicalBrowserPath } from './browser-tree-paths.js';
import { buildHostingFileSet, resolveBrowserTree } from './hosting-file-set.js';

const OUTPUT_SERVED_PATH = 'config/vfs-manifest.json';

async function main() {
  const tree = await resolveBrowserTree();
  const files = await buildHostingFileSet({ tree });
  const relFiles = files.map(toCanonicalBrowserPath);
  const outputRel = toCanonicalBrowserPath(OUTPUT_SERVED_PATH);
  const outputPath = tree.writable(OUTPUT_SERVED_PATH);
  if (!relFiles.includes(outputRel)) {
    relFiles.push(outputRel);
  }
  relFiles.sort();

  const output = {
    version: 1,
    files: relFiles
  };

  const text = JSON.stringify(output, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await fs.readFile(outputPath, 'utf8') !== text) throw new Error('VFS manifest is stale');
    console.log(`[vfs-manifest] ${relFiles.length} served paths are current`);
  } else {
    await fs.writeFile(outputPath, text, 'utf8');
    console.log(`[vfs-manifest] Wrote ${outputPath}`);
  }
}

main().catch((err) => {
  console.error('[vfs-manifest] Failed to build manifest');
  console.error(err);
  process.exit(1);
});
