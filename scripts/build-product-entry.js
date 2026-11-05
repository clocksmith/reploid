/** Bundle the product UI; Doppler remains a separately pinned, lazily loaded runtime. */
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { resolveBrowserTree } from './hosting-file-set.js';

const root = fileURLToPath(new URL('../', import.meta.url));
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
  const output = result.outputFiles[0];
  if (checkOnly) {
    const current = await readFile(output.path).catch(() => null);
    if (!current?.equals(Buffer.from(output.contents))) {
      throw new Error('Product entry bundle is stale; run npm run build:browser-bundle');
    }
  } else await writeFile(output.path, output.contents);
}
