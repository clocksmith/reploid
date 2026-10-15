/** Bundle the product UI; Doppler remains a separately pinned, lazily loaded runtime. */
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildProductEntry({ checkOnly = false } = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['self/ui/pool-home/index.js'],
    outfile: 'self/ui/pool-home/app.bundle.js',
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
