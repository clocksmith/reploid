/** Bundle the React product UI and the /design page; Doppler remains a separately pinned, lazily loaded runtime. */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resolveBrowserTree } from './hosting-file-set.js';
import { buildDesignIndex, OUTPUT as DESIGN_INDEX, renderDesignIndex } from './build-poolday-design-index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** React entries built from apps/poolday-react into the served tree, and the package they compose. */
export const REACT_ENTRIES = Object.freeze([
  { source: 'apps/poolday-react/src/main-design.tsx', served: 'ui/react/design.js' },
  // The product shell for every route.
  { source: 'apps/poolday-react/src/main-app.tsx', served: 'ui/react/app.js' }
]);
export const REACT_ALIASES = { '@reploid/poolday-ui': path.join(root, 'packages/poolday-ui/src/index.ts') };

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

/** The served modules each React entry compiles in (apps/poolday, self and shared files), from esbuild's metafile. */
export async function reactEntryInputs() {
  const inputs = {};
  for (const entry of REACT_ENTRIES) {
    const result = await build({
      absWorkingDir: root, entryPoints: [path.join(root, entry.source)], bundle: true, write: false, metafile: true,
      format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', alias: REACT_ALIASES,
      external: ['https://*', 'http://*'], logLevel: 'silent'
    });
    inputs[entry.served] = Object.keys(result.metafile.inputs);
  }
  return inputs;
}

export async function buildProductEntry({ checkOnly = false, tree } = {}) {
  // Resolving the tree checks that every served path has one source before anything is bundled.
  await resolveBrowserTree({ tree });

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
