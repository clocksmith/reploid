// Build the public Daily origin locally. The ranked server and its state are hosted separately.
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dailyPages, poolImports, poolStyles } from '../server/daily/public-assets.js';

const { values } = parseArgs({ options: {
  'api-origin': { type: 'string' }, out: { type: 'string' }, name: { type: 'string', default: 'reploid-daily' },
} });
if (!values['api-origin'] || !values.out) {
  throw Error('Use --api-origin https://your-api.example --out NEW_DIRECTORY [--name your-worker-name].');
}
const api = new URL(values['api-origin']);
// Only a serialized origin can enter the HTML attribute and CSP host expression.
if (api.protocol !== 'https:' || api.origin !== values['api-origin'] || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?$/i.test(api.host)) {
  throw Error('Supply one exact HTTPS API origin without a path, credentials, wildcards or trailing slash.');
}
if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(values.name)) throw Error('Invalid Worker name.');

const root = fileURLToPath(new URL('../', import.meta.url));
const site = path.join(root, 'server/daily/site');
const styles = path.join(root, 'apps/poolday/styles/poolday');
const destination = path.resolve(values.out);
const exists = await lstat(destination).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (exists) throw Error('Choose a new output directory to keep existing files intact.');
await mkdir(path.dirname(destination), { recursive: true });
const staging = await mkdtemp(path.join(path.dirname(destination), '.daily-static-'));
try {
  const assets = path.join(staging, 'public');
  await mkdir(assets);
  for (const file of dailyPages) {
    if (file === 'index.html') {
      const html = await readFile(path.join(site, file), 'utf8');
      if (html.split('<head>').length !== 2 || html.includes('name="daily-api-origin"')) throw Error('Unexpected Daily HTML template.');
      await writeFile(path.join(assets, file), html.replace('<head>', `<head>\n  <meta name="daily-api-origin" content="${api.origin}">`));
    } else {
      await copyFile(path.join(site, file), path.join(assets, file));
    }
  }
  for (const file of poolStyles) {
    const target = path.join(assets, 'styles/poolday', file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(styles, file), target);
  }
  await copyFile(path.join(styles, 'tokens.css'), path.join(assets, 'pool-tokens.css'));
  await copyFile(path.join(root, 'docs/daily-game.md'), path.join(assets, 'host-guide.txt'));
  await copyFile(path.join(root, 'shared/favicon.svg'), path.join(assets, 'favicon.svg'));
  await writeFile(path.join(assets, 'pool.css'), poolImports + '\n');
  await writeFile(path.join(assets, '_headers'), [
    '/*', '  Cache-Control: no-store', '  Referrer-Policy: no-referrer', '  X-Content-Type-Options: nosniff',
    `  Content-Security-Policy: default-src 'self'; connect-src 'self' ${api.origin}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, '',
  ].join('\n'));
  const config = { name: values.name, compatibility_date: '2026-11-21', workers_dev: true, preview_urls: false,
    assets: { directory: './public', not_found_handling: 'none', run_worker_first: false }, observability: { enabled: false } };
  await writeFile(path.join(staging, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
  await rename(staging, destination);
  console.log(`Prepared Reploid Daily assets in ${destination}`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
