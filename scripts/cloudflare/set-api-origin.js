#!/usr/bin/env node
/**
 * Point the page at a backend origin: '' (same origin: Firebase Hosting rewrites to Cloud Run) or the
 * reploid-api Worker (`--cloudflare`). Writes shared/config/hosted-api.json and the one inline call in
 * apps/poolday/index.html (landing counts), which cannot import the config. Run `npm run build` after.
 *
 *   node scripts/cloudflare/set-api-origin.js --cloudflare | --same-origin | --origin https://...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = path.join(root, 'shared/config/hosted-api.json');
const PAGE = path.join(root, 'apps/poolday/index.html');
const ATTRIBUTION_CALL = /void fetch\('[^']*\/api\/landing-attribution', \{\n(\s+)method: 'POST', headers: \{ 'Content-Type': 'application\/json' \},\n(\s+)body: JSON\.stringify\(\{ v: tag \}\), credentials: 'omit',\n(\s+)referrerPolicy: 'no-referrer', mode: '(same-origin|cors)', keepalive: true/;

/** The inline landing call the page should carry for an API origin. */
export function attributionCall(apiOrigin, indent = ['            ', '            ', '            ']) {
  return `void fetch('${apiOrigin}/api/landing-attribution', {\n${indent[0]}method: 'POST', headers: { 'Content-Type': 'application/json' },\n`
    + `${indent[1]}body: JSON.stringify({ v: tag }), credentials: 'omit',\n${indent[2]}referrerPolicy: 'no-referrer', mode: '${apiOrigin ? 'cors' : 'same-origin'}', keepalive: true`;
}

/** Throws unless the page's inline call matches the configured origin. */
export function checkApiOrigin({ config = JSON.parse(readFileSync(CONFIG, 'utf8')), page = readFileSync(PAGE, 'utf8') } = {}) {
  const match = ATTRIBUTION_CALL.exec(page);
  if (!match) throw new Error('apps/poolday/index.html has no recognizable landing-attribution call');
  if (match[0] !== attributionCall(config.apiOrigin, [match[1], match[2], match[3]])) throw new Error(`index.html landing call does not use apiOrigin "${config.apiOrigin}"`);
  return config.apiOrigin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { cloudflare: { type: 'boolean' }, 'same-origin': { type: 'boolean' }, origin: { type: 'string' } } });
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  let origin = values.origin;
  if (values['same-origin']) origin = '';
  if (values.cloudflare) origin = config.cloudflareApiOrigin;
  if (origin === undefined) throw new Error('Pass --cloudflare, --same-origin or --origin');
  if (origin && new URL(origin).origin !== origin) throw new Error(`Not a serialized origin: ${origin}`);
  const page = readFileSync(PAGE, 'utf8');
  const match = ATTRIBUTION_CALL.exec(page);
  if (!match) throw new Error('apps/poolday/index.html has no recognizable landing-attribution call');
  writeFileSync(PAGE, page.replace(match[0], attributionCall(origin, [match[1], match[2], match[3]])));
  writeFileSync(CONFIG, `${JSON.stringify({ ...config, apiOrigin: origin }, null, 2)}\n`);
  checkApiOrigin();
  console.log(`apiOrigin = ${origin || '(same origin)'}; now run npm run build`);
}
