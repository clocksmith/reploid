/** Bundle the product UI; Doppler remains a separately pinned, lazily loaded runtime. */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resolveBrowserTree } from './hosting-file-set.js';
import { buildDesignIndex, OUTPUT as DESIGN_INDEX, renderDesignIndex } from './build-poolday-design-index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** React entries built from apps/poolday-react into the served tree, and the package they compose. */
export const REACT_ENTRIES = Object.freeze([
  { source: 'apps/poolday-react/src/main-design.tsx', served: 'ui/react/design.js' }
]);
const REACT_ALIASES = { '@reploid/poolday-ui': path.join(root, 'packages/poolday-ui/src/index.ts') };

async function emit(output, checkOnly, label) {
  if (checkOnly) {
    const current = await readFile(output.path).catch(() => null);
    if (!current?.equals(Buffer.from(output.contents))) {
      throw new Error(`${label} is stale; run npm run build:browser-bundle`);
    }
  } else {
    await mkdir(path.dirname(output.path), { recursive: true });
    await writeFile(output.path, output.contents);
  }
}

export async function buildProductEntry({ checkOnly = false, tree } = {}) {
  const source = await resolveBrowserTree({ tree });
  const result = await build({
    absWorkingDir: root,
    entryPoints: [source.source('ui/pool-home/index.js')],
    outfile: source.source('ui/pool-home/app.bundle.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, legalComments: 'eof', write: false,
    external: ['https://*', 'http://*']
  });
  await emit(result.outputFiles[0], checkOnly, 'Product entry bundle');

  // The design index is generated from the design system's sources; a stale one fails the check.
  const index = renderDesignIndex(buildDesignIndex());
  const currentIndex = await readFile(DESIGN_INDEX, 'utf8').catch(() => '');
  if (currentIndex !== index) {
    if (checkOnly) throw new Error('Poolday design index is stale; run npm run build:browser-bundle');
    await writeFile(DESIGN_INDEX, index);
  }
  for (const entry of REACT_ENTRIES) {
    const react = await build({
      absWorkingDir: root,
      entryPoints: [path.join(root, entry.source)],
      outfile: path.join(root, 'apps/poolday', entry.served),
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      minify: true, legalComments: 'eof', write: false,
      jsx: 'automatic', alias: REACT_ALIASES, external: ['https://*', 'http://*'],
      define: { 'process.env.NODE_ENV': '"production"' }
    });
    await emit(react.outputFiles[0], checkOnly, `React entry ${entry.served}`);
  }
}
